# Handoff — Session 23/07/2026 (รวม 3 Session)

## Project Context

**LabVenture / AquaDAT Scientist Recorder**  
Full-stack web app for recording water quality data at โรงงานผลิตน้ำมหาสวัสดิ์ (plant_id=2).  
Stack: Node.js/Express + React+Vite + SQLite + LINE push.  
Entry points: `server/index.js` (port 443 via proxy), `client/src/pages/OpRecord.jsx`.

---

## Session 1 — Daily Report Bug Fixes & Recycle Tab

### 1. Bug — PACL Phase 2 ค่าผิด (14.275 TON แสดงแทน ~11.657 TON)

**Root cause** (`server/services/dailyReport.js`):  
`getDelta()` query slot `'00:00'` ของ nextDate แต่ historyMap ไม่มี dimension ของ date → ได้ค่า `'00:00'` ของ currentDate แทน → delta = 0 → net = gross

**Fix** (~line 42): เปลี่ยนให้ใช้ slot `'24:00'` ของ currentDate จาก historyMap (AquaDAT remaps end-of-day → `'24:00'`) พร้อม SQLite fallback

### 2. สูตร PACl Actual Dose — `/ 2` → `× 0.35`

```
// เดิม (alum และ PACl เหมือนกัน)
actual_dose = use_TON / 2 × 1e6 / raw_water_m3

// ใหม่ (เฉพาะ PACl ทุก phase)
actual_dose = use_TON × 0.35 × 1e6 / raw_water_m3
```

แก้ทั้ง 4 phases (`pacl_actual_p1..p4`) ~line 300–313. Alum ยังใช้สูตรเดิม

### 3. configID ตะกอนเฟส 2

`sl_ph2`: cfgID 242 (ผิด) → **241**  
`server/services/dailyReport.js` ~line 388

### 4. เพิ่ม Tab "RECYCLE WATER" ใน Daily Report

- State `recycleSettings` (4 items `{ on: true, pct: 100 }`)
- Toggle ON/OFF + Pin bar 0–100% (ทีละ 10%) ต่อ phase
- `adjWaterLoss = water_loss_pct - (totalRecycled / rw_total × 100)`
- Sankey และ Water Loss KPI reflect ค่า adjusted อัตโนมัติ
- Volume ดึงจาก `washSummary[i].totalVol` (ต้องกด QUERY ก่อน)

### 5. DPS Energy / SS3-Bldg. Energy

```js
// DPS (SS1A): เอาหาร 1000 ออก
const e_dps = DDS([883, 885], 'DPS');

// Bldg. (SS3): cfgID 9775/9776 → 6775/6776
const e_bldg = DDS([6775, 6776], 'TPS');
```

---

## Session 2 — Sankey Chart Redesign (SUMMARY Tab)

### ภาพรวม

Sankey เดิมใช้ `@nivo/sankey` ที่ layout ผิด ถูก **redesign ทั้งหมด** เป็น custom SVG component ชื่อ `WaterSankeyChart` ใน `client/src/pages/OpRecord.jsx` (~line 1177)

### Topology (Fan-out)

```
                    ┌─ TPS Water      (90% x, top-right)
Raw Water ──────────┤
                    └─ DPS intermediate (55% x)
                              ├─ DPS Line A  (90% x)
                              └─ DPS Line B  (90% x)

           ↓ Rainbow arcs ↓

Loss(10%) | Wash Water(40%) | Service Water(70%) | Sludge Drain(100%)
```

### Key Implementation — `WaterSankeyChart`

**sankeyProps** (`~line 2076`) ปัจจุบันใช้ค่า adjusted จาก RECYCLE WATER tab:

```js
const sankeyProps = d ? {
  rw:           d.card1_raw_water.total ?? 0,
  tps:          d.card3_pumped.tps ?? 0,
  dpsA:         d.card3_pumped.dps_lineA ?? 0,
  dpsB:         d.card3_pumped.dps_lineB ?? 0,
  sludge:       d.card11_sludge.total ?? 0,
  serviceWater: d.summary.service_water_m3 ?? 0,
  washWater:    totalRecycled,          // ← ใช้ค่าจาก RECYCLE WATER tab (ไม่ใช่ totalWashWater)
  loss:         adjWaterLoss != null    // ← ใช้ loss ที่ปรับ recycle แล้ว
                  ? Math.max(0, (adjWaterLoss / 100) * (d.card1_raw_water.total ?? 0))
                  : null,
} : { ... };
```

### Chemical REMAINING Section

เปลี่ยนจาก 1 ตาราง (มี cost) → **2 ตาราง** (ไม่มี cost):
- Table 1: PA1/PA2/AL1/AL2/CL1/CL2 พร้อมแถว m³/TON และ Day
- Table 2: Alum (USE/INCOME) | PACl (USE/INCOME) | CHLORINE (USE/INCOME/RETURN)
- Cost ยังคำนวณ backend แต่ไม่ render

---

## Session 3 — Filter Availability & Chlorine Income/Return

### 1. Sankey Interactive กับ RECYCLE WATER

แก้ `sankeyProps` ให้ใช้ `totalRecycled` (จาก recycleSettings) แทน `totalWashWater` และ `adjWaterLoss` แทน raw `water_loss_pct` → Sankey อัปเดต real-time เมื่อ toggle/pin ใน RECYCLE WATER tab

### 2. Filter Availability (`server/services/dailyReport.js`)

เพิ่มฟังก์ชันและ config:

```js
// ฟังก์ชันอ่าน TEXT value (ON/STANDBY/REPAIR) จาก historyMap หรือ SQLite
function getTextAt(configparam_id, stationId, date, time, historyMap)

// Config บ่อกรองทั้ง 4 phase
const FILTER_PHASES = [
  { phase: 1, stationId: 'FWS1', cap: 8,  cfgIds: [314,324,334,344,354,364,374,384] },
  { phase: 2, stationId: 'FWS1', cap: 8,  cfgIds: [396,406,416,426,436,446,456,466] },
  { phase: 3, stationId: 'FWS2', cap: 14, cfgIds: [476,486,496,506,516,526,536,546,556,566,576,586,596,606] },
  { phase: 4, stationId: 'FWS2', cap: 14, cfgIds: [618,628,638,648,658,668,678,688,698,708,718,728,738,748] },
];

// คำนวณ: นับ REPAIR ที่ slot 24:00 → available = cap - repair
function getFilterAvailability(date, historyMap)
// return: [{ phase, cap, repair, available }, ...]
```

Return object เพิ่ม `filter_availability` array

**AquaDAT pattern ที่ต้องเพิ่ม** (`server/services/aquadatHistory.js`):

```js
// เดิม
{ sid: 'FWS1', patterns: [109, 1] },
{ sid: 'FWS2', patterns: [110, 28] },

// ใหม่ — เพิ่ม pattern 10 (STATUS P#12) และ 11 (STATUS P#34)
{ sid: 'FWS1', patterns: [109, 1, 10] },
{ sid: 'FWS2', patterns: [110, 28, 11] },
```

**Display** (`client/src/pages/OpRecord.jsx`):  
Card "Filter Availability" ที่อยู่ข้างๆ SERVICE WATER ใน SUMMARY tab:
- แสดง `7 | 8 | 14 | 13` (เฉพาะตัวเลข `available` คั่นด้วย ` | `)
- **สีเขียว** (`#16a34a`) เมื่อ available === cap
- **สีส้ม** (`#f97316`) เมื่อ available < cap

### 3. Chlorine INCOME & RETURN (`server/services/dailyReport.js`)

```js
// configID 4333/4339 = income, 4334/4340 = return (unit: ท่อ/int)
// อยู่ใน pattern 346 (CHEM1) และ 347 (CHEM2) ซึ่ง fetch อยู่แล้ว
const cl_income = (V(4333, 'CHEM1', '24:00') ?? 0) + (V(4339, 'CHEM2', '24:00') ?? 0);
const cl_return = (V(4334, 'CHEM1', '24:00') ?? 0) + (V(4340, 'CHEM2', '24:00') ?? 0);
```

Return object: `cl_income`, `cl_return`  
Display: ตาราง Chemical Table 2 คอลัมน์ INCOME และ RETURN ของ CHLORINE แสดงเป็น `N ท่อ`  
Null fallback: `d.cl_income ?? 0` ก่อน fmt เพื่อป้องกัน "null ท่อ"

---

## Files Changed

| File | การเปลี่ยนแปลง |
|---|---|
| `server/services/dailyReport.js` | getDelta() fix, PACl ×0.35, sludge P2 cfgID 241, e_dps ไม่หาร 1000, e_bldg cfgID 6775/6776, getTextAt(), FILTER_PHASES, getFilterAvailability(), filter_availability ใน return, cl_income, cl_return |
| `server/services/aquadatHistory.js` | FWS1 patterns เพิ่ม 10, FWS2 patterns เพิ่ม 11 |
| `client/src/pages/OpRecord.jsx` | RECYCLE WATER tab, WaterSankeyChart (custom SVG), sankeyProps ใช้ totalRecycled+adjWaterLoss, Chemical REMAINING 2-table, fmtV comma format, Filter Availability card (ข้างๆ SERVICE WATER), cl_income/cl_return display |

---

## Key Architecture Notes

- `getDelta(id, sid, date, historyMap)` — ใช้ `'24:00'` ของ currentDate เป็น end value  
- `getTextAt(id, sid, date, time, historyMap)` — อ่าน TEXT value (ไม่ parseFloat) จาก historyMap → SQLite fallback  
- `washSummary[i].totalVol` — backwash volume ต่อ phase จาก `parseBWPhase()` ต้องกด QUERY ก่อน  
- `totalRecycled` — sum ของ `washSummary[i].totalVol × recycleSettings[i].pct/100` เฉพาะ phase ที่ on=true  
- `adjWaterLoss` — water_loss_pct หลังหัก recycle (ใช้ใน KPI และ Sankey)  
- `lossProp` prop ใน WaterSankeyChart: ถ้า null จะ fallback คำนวณจาก `rw - tps - dps - sludge - svc - wash`  
- `@nivo/sankey` import ยังอยู่แต่ไม่ได้ใช้ render แล้ว  
- `cl_income` / `cl_return` หน่วยเป็น int (ท่อ) ไม่ใช่ kg

---

## Pending / Next Steps

- [ ] Commit การเปลี่ยนแปลงทั้งหมด
- [ ] ทดสอบ Filter Availability กับข้อมูลจริง (pattern 10/11 ต้องมีข้อมูล slot 24:00)
- [ ] ทดสอบ Sankey กับข้อมูลจริง วันที่มี washWater > 0 ครบทุก phase
- [ ] พิจารณา persist `recycleSettings` ลง sessionStorage ตาม date
- [ ] ตรวจสอบ e_dps (SS1A–DPS) และ e_bldg (SS3–Bldg.) ว่าค่าถูกต้อง
- [ ] ลบ `@nivo/sankey` import ที่ไม่ได้ใช้แล้ว
- [ ] `SANKEY_DATA_UNUSED` — ลบออกได้ (dead code)

---

## Suggested Skills

- `scrutinize` — review code changes ก่อน commit โดยเฉพาะ dailyReport.js และ aquadatHistory.js
- `anthropic-skills:xlsx` — หากต้องการ export daily report เป็น Excel
- `dataviz` — หากต้องการปรับ chart/Sankey เพิ่มเติม
