# Handoff — LabVenture (2026-07-20, updated end-of-day)

> รวมทุก session ในวันนี้เป็นเอกสารเดียว สำหรับ agent รุ่นถัดไปสามารถอ่านและทำงานต่อได้ทันที

---

## 1. Project Overview

**LabVenture** — AquaDAT Scientist Recorder  
Stack: **React (Vite)** client + **Express** server (port 3001) + **SQLite**, proxied ผ่าน BellBeast ที่ port 443  
Previous handoffs: `handoff/handoff1807.md`, `handoff/handoff1907.md`

URL หลัก: `http://localhost:443/labventure/op-record`

---

## 2. Architecture

```
Browser (port 443/labventure/)
  └─ React SPA (client/dist)       ← ต้อง npm run build ทุกครั้งที่แก้ client
       ├─ /labventure/api/*  →  BellBeast proxy → Express server (port 3001)
       └─ stage polling every 30s → GET /api/operator/stage

Express Server (port 3001)
  ├─ stage=0: Uroboros mode  → fetchUroborosHistory() → BellBeast :443/api/operator/data
  ├─ stage=1: AquaDAT mode   → fetchDailyReportHistory() → GraphQL (aquadat.mwa.co.th)
  └─ stage=2: Syncing mode

Uroboros (C# service)
  └─ /api/operator/data?configIDs=...&date=YYYY-MM-DD
       → AquadatFast.ReadOperatorDataAsync → SQLite (AQ_readings_operator_v1)
       → 25 rows per configID per day: [D 00:00] .. [D 23:00] + [D+1 00:00] (= slot 24:00)
```

**Key files:**

| File | หน้าที่ |
|---|---|
| `server/routes/dailyReport.js` | SSE stream endpoints สำหรับ DAILY tab |
| `server/routes/operator.js` | history endpoint + fetchUroborosHistory |
| `server/services/dailyReport.js` | `computeDailyReport` — logic คำนวณรายงาน (หลัก) |
| `server/services/aquadatHistory.js` | `fetchDailyReportHistory` + DAILY_REPORT_ENTRIES (stage=1) |
| `client/src/pages/OpRecord.jsx` | main page (~2900 lines); DailyReportTab อยู่ line ~1553 |
| `server/config/operator_nodes.json` | station/topic/param definitions (รวม formula) |
| `server/config/aquadat_patterns.json` | AquaDAT pattern_ids สำหรับ stage=1 |

---

## 3. โมเดลเวลา (สำคัญมาก)

ระบบเก็บ **13 slot** ต่อวัน (00:00–22:00 ทุก 2h + 24:00):

| Timestamp ใน DB | ความหมาย | แสดงเป็น |
|---|---|---|
| `date D, 00:00:00` | เที่ยงคืนต้นวัน | slot `00:00` |
| `date D+1, 00:00:00` | เที่ยงคืนท้ายวัน | slot `24:00` |

**Remap logic:** Sort by `ts` ascending → `00:00` แรกคือ slot `00:00`, `00:00` ที่สองคือ `24:00` (`seenMidnight[cid]` flag ใน operator.js & dailyReport.js)

---

## 4. กฎที่ห้ามละเมิด

> **ห้ามแก้ `time_slot` ของ topic ใดๆ โดยไม่ได้รับคำสั่งโดยตรง**  
> TPS/DPS FLOW = **25 slots** (ทุก 1h), RWS = **13 slots** (ทุก 2h), บาง topic = **9 slots** (ทุก 3h)

---

## 5. Helper Functions ใน `dailyReport.js` (สำคัญ)

### 5.1 `weightedAvgDR(flowId, drId, stationId, historyMap)`
คำนวณ weighted average dosing rate:
```
TARGET = Σ(Flow[h] × DR[h]) / Σ(Flow[h])   สำหรับ h ที่ f > 0 AND dr > 0
```
> **⚠️ ต้อง filter `dr > 0` ด้วยเสมอ** — ถ้าไม่กรอง slot ที่ pump หยุดจ่าย (DR=0) จะ dilute average ผิด  
> Bug นี้เคยเกิดกับ CHEM2 pre-cl: TARGET ออก 0.61 แทน 1.50 เพราะ flow ต่อเนื่องแต่ DR=0 หลัง 10:00

### 5.2 `sumFlowDR(flowId, drId, stationId, historyMap)`
คืน `Σ(flow × DR)` (raw sum ไม่หาร) ใช้เป็น **proportion weight** กรณีไม่มี totalizer  
Filter: `f > 0 AND dr > 0`

### 5.3 `sumDeltaFlowDR(totId, totStation, drId, drStation, historyMap)`
คืน `{ sumFD, sumF }` จากการคำนวณ 2h totalizer delta:
```
flow[slot] = (totalizer[slot] - totalizer[slot-2h]) × 100   (m³)
```
วน slot 02:00, 04:00, ..., 24:00 (ไม่มี 00:00 เป็น cur — 00:00 เป็นแค่ prev ของ 02:00)  
Filter: `flow > 0 AND dr > 0`
- `sumFD` ใช้คำนวณ actual dose weight สำหรับ chlorine ไม่ได้ใช้ตรงๆ
- **`sumF`** ใช้เป็น **ACTUAL denominator** (m³ ช่วงที่มีการจ่ายสาร)

### 5.4 `clLineUsed(cfgId, sid)` — inner closure ใน `computeDailyReport`
คำนวณปริมาณคลอรีนสุทธิที่ใช้ต่อ Line โดย handle กรณีสลับถัง:
```
delta = v24:00 - v00:00

ถ้า delta ≤ 0 (ปกติ):   used = -delta
ถ้า delta > 0 (สลับถัง): used = v00:00 - min(slot 01:00..24:00)
```
ข้อสมมติ: ถังคลอรีนแต่ละ line บรรจุ 6,000 kg; ถ้าสลับถังในวันเดียว ส่วนของถังใหม่จะนับพรุ่งนี้

---

## 6. สูตรคำนวณ DAILY Donut Card — ครบทุกสาร

### 6.1 ALUM (CHEM1: P1+P2, CHEM2: P3+P4)

**Split ratio:** ใช้ totalizer delta (DD = 24:00 − 00:00)

```
CHEM1:
  A = DD(88,  'CHEM1')       ← totalizer P1
  B = DD(91,  'CHEM1')       ← totalizer P2
  C = DD(93) + DD(96)        ← tank A+B delta (m³)
  D = V(8037, '24:00')       ← received (TON, pattern 346)
  NET = D - C × 1.33
  use_p1 = A/(A+B) × NET
  use_p2 = B/(A+B) × NET

CHEM2:
  A = DD(150, 'CHEM2')      ← totalizer P3
  B = DD(153, 'CHEM2')      ← totalizer P4
  C = DD(155) + DD(158)     ← tank C+D delta (m³)
  D = V(8036, '24:00')      ← received (TON, pattern 347)
  NET = D - C × 1.33
  use_p3 = A/(A+B) × NET
  use_p4 = B/(A+B) × NET
```

**ACTUAL:**
```
actual_p1 (mg/L) = use_p1 / 2 × 1,000,000 / rw_ph1
actual_p2 (mg/L) = use_p2 / 2 × 1,000,000 / rw_ph2
actual_p3 (mg/L) = use_p3 / 2 × 1,000,000 / rw_ph3
actual_p4 (mg/L) = use_p4 / 2 × 1,000,000 / rw_ph4
```

### 6.2 PACl (CHEM1: P1+P2, CHEM2: P3+P4)

**ไม่มี totalizer** → ใช้ `sumFlowDR` เป็น split ratio

```
CHEM1:
  A = sumFlowDR(1,  8402, 'CHEM1')   ← Σ(flow_p1 × DR_pacl_p1)
  B = sumFlowDR(2,  8404, 'CHEM1')   ← Σ(flow_p2 × DR_pacl_p2)
  C = D(8405) + D(8407)              ← tank A+B delta (m³, getDelta = nextDay00 - today00)
  D = V(8423, '24:00')               ← received (TON)
  NET = D - C × 1.19                 ← SG PACl = 1.19
  use_p1 = A/(A+B) × NET
  use_p2 = B/(A+B) × NET

CHEM2:
  A = sumFlowDR(39, 8416, 'CHEM2')   ← P3
  B = sumFlowDR(40, 8418, 'CHEM2')   ← P4
  C = D(8419) + D(8421)              ← tank C+D delta (m³)
  D = V(8424, '24:00')               ← received (TON)
  NET = D - C × 1.19
  use_p3 = A/(A+B) × NET
  use_p4 = B/(A+B) × NET
```

**ACTUAL:**
```
actual_p1 (mg/L) = use_p1 / 2 × 1,000,000 / rw_ph1
(เหมือน Alum — /2 เป็น dilution factor ของสารละลาย)
```

### 6.3 Chlorine (CHEM1: P1+P2 pre+post, CHEM2: P3+P4 pre+post)

**หลักคิด:** 1 phase มีทั้ง pre-cl และ post-cl → แบ่งเค้กด้วย weight รวม 4 ส่วน

```
CHEM1 Weights (sumFlowDR — flow rate m³/s × DR mg/L):
  W_pre_p1  = sumFlowDR(1,  129, 'CHEM1')   ← pre-cl P1
  W_pre_p2  = sumFlowDR(2,  131, 'CHEM1')   ← pre-cl P2
  W_post_p1 = sumFlowDR(1,  133, 'CHEM1')   ← post-cl P1
  W_post_p2 = sumFlowDR(2,  135, 'CHEM1')   ← post-cl P2
  W_total = W_pre_p1 + W_pre_p2 + W_post_p1 + W_post_p2

NET_cl1 (kg) = clLineUsed(127, 'CHEM1') + clLineUsed(128, 'CHEM1')

cl_use_pre_p1  = W_pre_p1  / W_total × NET_cl1   (kg)
cl_use_pre_p2  = W_pre_p2  / W_total × NET_cl1
cl_use_post_p1 = W_post_p1 / W_total × NET_cl1
cl_use_post_p2 = W_post_p2 / W_total × NET_cl1

CHEM2 Weights:
  W_pre_p3  = sumFlowDR(39, 192, 'CHEM2')
  W_pre_p4  = sumFlowDR(40, 194, 'CHEM2')
  W_post_p3 = sumFlowDR(39, 196, 'CHEM2')
  W_post_p4 = sumFlowDR(40, 198, 'CHEM2')
NET_cl2 (kg) = clLineUsed(190, 'CHEM2') + clLineUsed(191, 'CHEM2')
```

**ACTUAL denominator — ใช้ `sumDeltaFlowDR(...).sumF` (ไม่ใช่ rw_ph ทั้ง 24h):**
```
cl_actual_pre_p1  = use_pre_p1_kg  × 1,000 / sumDeltaFlowDR(4,  'RWS1', 129, 'CHEM1').sumF
cl_actual_post_p1 = use_post_p1_kg × 1,000 / sumDeltaFlowDR(4,  'RWS1', 133, 'CHEM1').sumF
cl_actual_pre_p2  = use_pre_p2_kg  × 1,000 / sumDeltaFlowDR(7,  'RWS1', 131, 'CHEM1').sumF
cl_actual_post_p2 = use_post_p2_kg × 1,000 / sumDeltaFlowDR(7,  'RWS1', 135, 'CHEM1').sumF

CHEM2: ใช้ totalizer cfgId 42 (LINE C, RWS2) สำหรับ P3 และ 44 (LINE D, RWS2) สำหรับ P4
```

**หน่วย ACTUAL Chlorine:** `mg/L = use_kg × 1,000 / rw_m3`  
(ไม่มี /2 เพราะ chlorine เป็น dry weight; ไม่มี SG เพราะเป็น kg อยู่แล้ว)

**เหตุที่ ACTUAL denominator ≠ rw_ph:**  
`rw_ph1` = total 24h flow LINE A; แต่สำหรับ pre-cl ที่จ่ายแค่ช่วง 00:00-10:00 ต้องใช้ volume เฉพาะช่วงที่จ่ายสารเท่านั้น → `sumDeltaFlowDR.sumF` กรองแค่ slot ที่ DR > 0

**ตรวจสอบกับข้อมูล 2026-07-01 (CHEM1):**

| | sumFD (weight) | USE (kg) | RW Cal (m³) | ACTUAL (mg/L) |
|---|---|---|---|---|
| pre-cl P1 | 51.75 | 297.83 | 160,000 | **1.86** |
| pre-cl P2 | 45.00 | 258.98 | 164,000 | **1.58** |
| post-cl P1 | 138.60 | 797.67 | 385,000 | **2.07** |
| post-cl P2 | 127.80 | 735.51 | 392,000 | **1.88** |
| **NET cl1** | | **2,090 kg** | | |

---

## 7. configID Reference

### Raw Water Flow
| Variable | cfgId | Station | Description |
|---|---|---|---|
| rw_ph1 | 4 | RWS1 | LINE A totalizer → DD×100 (m³) |
| rw_ph2 | 7 | RWS1 | LINE B totalizer → DD×100 (m³) |
| rw_ph3 | 42 | RWS2 | LINE C totalizer → DD×100 (m³) |
| rw_ph4 | 44 | RWS2 | LINE D totalizer → DD×100 (m³) |
| flow_p1 | 1 | CHEM1 | flow rate P1 (m³/s, hourly) |
| flow_p2 | 2 | CHEM1 | flow rate P2 (m³/s, hourly) |
| flow_p3 | 39 | CHEM2 | flow rate P3 (m³/hr, 2h interval) |
| flow_p4 | 40 | CHEM2 | flow rate P4 (m³/hr, 2h interval) |

> หมายเหตุ unit: cfgId 1/2 ใน CHEM1 = m³/s; cfgId 39/40 ใน CHEM2 = m³/hr  
> ไม่มีผลต่อ weighted average (หน่วยหักล้างกัน) แต่ต้องจำไว้สำหรับการตรวจสอบ

### CHEM1 Dosing
| cfgId | ชื่อ |
|---|---|
| 89 | ALUM DR P1 |
| 92 | ALUM DR P2 |
| 8402 | PACl DR P1 |
| 8404 | PACl DR P2 |
| 129 | PRE-CL DR P1 |
| 131 | PRE-CL DR P2 |
| 133 | POST-CL DR P1 |
| 135 | POST-CL DR P2 |
| 88 | ALUM totalizer P1 |
| 91 | ALUM totalizer P2 |
| 93, 96 | ALUM tank A, B (m³) |
| 8037 | ALUM received (TON, pattern 346) |
| 8405, 8407 | PACl tank A, B (m³) |
| 8423 | PACl received (TON) |
| 127, 128 | Cl Line A, B weight (kg) |

### CHEM2 Dosing
| cfgId | ชื่อ |
|---|---|
| 151 | ALUM DR P3 |
| 154 | ALUM DR P4 |
| 8416 | PACl DR P3 |
| 8418 | PACl DR P4 |
| 192 | PRE-CL DR P3 |
| 194 | PRE-CL DR P4 |
| 196 | POST-CL DR P3 |
| 198 | POST-CL DR P4 |
| 150 | ALUM totalizer P3 |
| 153 | ALUM totalizer P4 |
| 155, 158 | ALUM tank C, D (m³) |
| 8036 | ALUM received (TON, pattern 347) |
| 8419, 8421 | PACl tank C, D (m³) |
| 8424 | PACl received (TON) |
| 190, 191 | Cl Line C, D weight (kg) |

### Formula Columns (operator_nodes.json)
| cfgId | Station | สูตร |
|---|---|---|
| 8384 | RWS1 | LINE A FLOW: `[slot]==="00:00" ? 0 : ({4}-{4,-1})*100` |
| 8385 | RWS1 | LINE B FLOW: `[slot]==="00:00" ? 0 : ({7}-{7,-1})*100` |
| 8386 | RWS2 | LINE C FLOW: `[slot]==="00:00" ? 0 : ({42}-{42,-1})*100` |
| 8387 | RWS2 | LINE D FLOW: `[slot]==="00:00" ? 0 : ({44}-{44,-1})*100` |
| 8388 | TPS | SERVICE FLOW: `[slot]==="00:00" ? undefined : [slot]==="01:00" ? {759}*100 : ({759}-{759,-1})*100` |
| 8389 | DPS | LINE A FLOW |
| 8390 | DPS | LINE B FLOW |

---

## 8. Client — `card14_chem_dosing` Output & Donut Mapping

### Output keys จาก server (`computeDailyReport` return):
```js
card14_chem_dosing: {
  // TARGET (mg/L) — weightedAvgDR
  alum_p1, alum_p2, alum_p3, alum_p4,
  pacl_p1, pacl_p2, pacl_p3, pacl_p4,
  pre_cl_p1, post_cl_p1, pre_cl_p2, post_cl_p2,
  pre_cl_p3, post_cl_p3, pre_cl_p4, post_cl_p4,
  // ALUM USE (TON) + ACTUAL (mg/L)
  alum_use_p1, alum_use_p2, alum_use_p3, alum_use_p4,
  alum_actual_p1, alum_actual_p2, alum_actual_p3, alum_actual_p4,
  // PACl USE (TON) + ACTUAL (mg/L)
  pacl_use_p1, pacl_use_p2, pacl_use_p3, pacl_use_p4,
  pacl_actual_p1, pacl_actual_p2, pacl_actual_p3, pacl_actual_p4,
  // Chlorine USE (kg) + ACTUAL (mg/L)
  cl_use_pre_p1, cl_use_post_p1, cl_use_pre_p2, cl_use_post_p2,
  cl_use_pre_p3, cl_use_post_p3, cl_use_pre_p4, cl_use_post_p4,
  cl_actual_pre_p1, cl_actual_post_p1, cl_actual_pre_p2, cl_actual_post_p2,
  cl_actual_pre_p3, cl_actual_post_p3, cl_actual_pre_p4, cl_actual_post_p4,
}
```

### `ChemDonutCard` Component (`OpRecord.jsx:~1326`)
Props: `{ phase, useUnit, doseUnit, use, target, actual, pct, noData }`

```js
// PCT formula
pct = target > 0
  ? Math.max(0, Math.round((target - Math.abs(actual - target)) / target * 100))
  : 0

// Color threshold
color = pct >= 80 ? '#16a34a'   // เขียว
      : pct >= 70 ? '#d97706'   // ส้ม
      :             '#dc2626'   // แดง

// Inactive state (ไม่มีข้อมูลจาก server)
noData = v == null && a == null   // ตรวจจาก raw value ก่อน toFixed
inactive = noData === true
  → arc สีเทา '#9ca3af', แสดง '—' แทนตัวเลข
```

> **⚠️ อย่าใช้ `target === 0 && actual === 0` เป็น inactive** — ค่า 0.004 mg/L ที่ toFixed(2) กลายเป็น 0.00 จะ trigger ผิด  
> ต้องใช้ `noData` flag ที่ดูจาก raw `v` และ `a` ก่อน round

---

## 9. AquaDAT Patterns ที่ fetch สำหรับ Daily Report

```js
DAILY_REPORT_ENTRIES = [
  { sid: 'RWS1',  patterns: [111] },
  { sid: 'RWS2',  patterns: [112] },
  { sid: 'CHEM1', patterns: [113, 346, 350, 351, 367] },
  // 113=daily summary (flow cfgId 1,2 + alum DR + pacl DR + cl DR)
  // 346=Alum received(8037), 350=Alum DR, 351=Chlorine DR, 367=PACl DR
  { sid: 'CHEM2', patterns: [114, 347, 323, 366, 352] },
  // 114=daily summary (flow cfgId 39,40), 347=Alum received(8036)
  // 323=Alum DR, 366=PACl DR, 352=Chlorine DR
  { sid: 'FWS1',  patterns: [109, 1] },
  { sid: 'FWS2',  patterns: [110, 28] },
  { sid: 'TPS',   patterns: [116, 255] },
  { sid: 'DPS',   patterns: [115] },
  { sid: 'CWS1',  patterns: [3] },
  { sid: 'CWS2',  patterns: [14] },
]
```

AquaDAT retry: timeout **20s**, **1 retry** (delay 3s) — pattern 114 มัก timeout

---

## 10. Known Gotchas

| # | อาการ | Root cause | แก้ |
|---|---|---|---|
| 1 | กด All Query ไม่มีอะไรเกิด | `stage` ไม่ใช่ prop → ReferenceError | ส่ง `stage` เป็น prop |
| 2 | `button.click()` ไม่ trigger | Event delegation + timing | ใช้ React fiber memoizedProps.onClick |
| 3 | แก้ JS แล้วไม่เห็นผล | Production ใช้ `client/dist/` | ต้อง `npm run build` |
| 4 | PowerShell เขียน JSON → HTTP 500 | UTF-8 BOM | ใช้ Node.js `fs.writeFileSync` |
| 5 | `time_slot` เปลี่ยนเองโดย agent | อ่านข้อมูลผิดแล้วสรุปผิด | ห้ามแก้ time_slot โดยไม่ได้รับคำสั่ง |
| 6 | slot `24:00` หายจาก history | nextDate comparison เปราะ | ใช้ seenMidnight approach |
| 7 | Pattern 114 timeout | AquaDAT network unstable | 20s timeout + 1 retry (3s) |
| 8 | Duplicate parallel fetches | client+server fetch พร้อมกัน | ย้าย computation ไป server-side |
| 9 | CHEM2 TARGET pre-cl ผิด (0.61 แทน 1.50) | `weightedAvgDR` ไม่ filter `dr > 0` → dilute | เพิ่ม `dr > 0` ใน filter |
| 10 | Donut แสดงสีแดง 0% ทั้งที่ไม่มีข้อมูล | `inactive = target===0 && actual===0` trigger เมื่อ toFixed round เป็น 0 | ใช้ `noData = v==null && a==null` แทน |

---

## 11. Current State

| รายการ | สถานะ |
|---|---|
| Stage-0 All Query + re-query stream | ✅ |
| seenMidnight remap | ✅ |
| Formula columns RWS1/RWS2/TPS/DPS | ✅ |
| computeFormula empty→NaN fix | ✅ |
| Backwash START/END TIME → FLOAT(2) | ✅ |
| DAILY donut TARGET (weightedAvgDR, dr>0 filter) | ✅ CHEM1+CHEM2 ทุก chemical |
| DAILY donut ALUM USE+ACTUAL — CHEM1+CHEM2 | ✅ |
| DAILY donut PACl USE+ACTUAL — CHEM1+CHEM2 | ✅ |
| DAILY donut Chlorine USE+ACTUAL — CHEM1+CHEM2 | ✅ |
| DAILY donut PCT + สี + inactive state | ✅ |
| USE/ACTUAL สำหรับ POST-CL (ตัวเลข verify แล้ว 2026-07-01) | ✅ |
| USE/ACTUAL สำหรับ PRE-CL CHEM2 (verify แล้ว) | ✅ |
| client/dist build | ✅ (ล่าสุด) |
| Express server restart | ⚠️ ต้อง restart เพื่อโหลด logic ใหม่ |

---

## 12. Suggested Next Steps

1. Restart Express server → query DAILY วันที่ 1 กรกฎาคม 2026 ตรวจ USE/ACTUAL/PCT ทุก chemical ทุก phase
2. ตรวจ CHEM2 chlorine USE/ACTUAL ด้วยข้อมูล LINE B (cfgId 191) ที่ลดจาก 3,430→1,410 kg
3. ทำ USE + ACTUAL สำหรับ **POST-CL** unit เป็น kg ครบทั้ง CHEM1+CHEM2 (ปัจจุบันทำแล้ว แต่ยังไม่ได้ verify CHEM2)
4. พิจารณา **Chlorine received** — ปัจจุบันไม่มีข้อมูลรับ ใช้แค่ tank delta; ถ้าต้องการ NET แม่นขึ้นต้องหา pattern ที่มี received
5. เขียนรายงานจากผลคำนวณ โดยใช้ตารางใน section 6 เป็น template

---

## 13. Suggested Skills

- `/handoff` — สำหรับ session ถัดไป
- `/run` — start dev server ถ้าต้องการทดสอบ client-side
