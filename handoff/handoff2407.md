# Handoff — 2026-07-24 (Session 2407)

## Project
LabVenture — AquaDAT Scientist + Operator Recorder  
Root: `C:\Users\peera\OneDrive\Desktop\LabVenture`  
Stack: React+Vite client (dev port 5173) + Express server (port 3001) proxied via BellBeast at port 443.

## Context documents
- `handoff/op-progress-track_plan.md` — architecture for the operator progress-tracking feature
- `handoff/handoff2007.md` — slot schedule overview (TPS/DPS=25 slot, RWS=13 slot, etc.)
- `handoff/handoff1807.md` — TPS/DPS topic time_slot changes (FLOW/IHM: 13→25, SUCTION/TEMP: 9)
- `server/config/operator_nodes.json` — station/topic/param definitions (READ ONLY — do not modify)

---

## What was done this session

### Problem
`/labventure/op-dashboard` progress bar used a fixed 12-dot grid (`SLOTS_2H` — odd hours 01:00–23:00) borrowed from the scientist dashboard. This was wrong: each station records at different intervals (13, 25, 9 slots, or explicit arrays) as defined in `operator_nodes.json`. The "done" count also required ALL configIDs at ALL slots to be fully filled.

### Fix 1 — Client: dynamic dots per station (ACTIVE ✅)
**File:** `client/src/pages/OpDashboard.jsx`

Old: `SLOTS_2H.map(...)` — fixed 12 odd-hour dots, ±1h window matching  
New: `slotKeys.map(...)` — dots derived from `slotSummary` keys returned by server

```js
// Line 76 — inside StationTimeline component
const slotKeys = Object.keys(stationProgress?.slotSummary ?? {}).sort();

// Line 78 — getDotStatus uses exact slot key, no window
function getDotStatus(slot) {
  const s = stationProgress?.slotSummary?.[slot];
  if (!s) return 'empty';
  const slotH = parseInt(slot, 10);
  const nowH = selectedDate === todayStr
    ? new Date(Date.now() + 7 * 3600000).getUTCHours() : 99;
  const isPast = slotH <= nowH;
  if (s.done) return 'done';
  if (s.partial) return 'partial';
  if (isPast) return 'missed';
  return 'future';
}

// Line 131 — render
{slotKeys.map((slot) => (
  <StationDot key={slot} slot={slot} status={getDotStatus(slot)} />
))}
```

Verified dot counts per station:
| Station | Old dots | New dots | Schedule |
|---------|----------|----------|----------|
| RWS1, RWS2 | 12 | 25 | time_slot=25 (FEEDER/PUMP TOTALIZER) |
| CHEM1, CHEM2 | 12 | 13 | time_slot=13 (every 2h) |
| TPS, DPS | 12 | 25 | mix 25+9 slots |
| CWS1 | 12 | 10 | explicit time array |
| CWS2 | 12 | 13 | combined |
| FWS1, FWS2 | 12 | 7 | every 4h (00:00–24:00) |

Note: `SLOTS_2H` constant (line 11) is still declared but no longer used in the timeline section. Safe to remove in future cleanup.

### Fix 2 — Server: stRec counts partial slots (ACTIVE ✅)
**File:** `server/routes/operator.js` line ~118

Old: `if (done) stRec++;`  
New: `if (done || partial) stRec++;`

- `done` = ALL inputParams of a topic have a value at this slot
- `partial` = SOME (but not all) inputParams have a value at this slot
- Change means stRec now counts any slot where at least one param was recorded

The server file has been saved with this change. Whether the running Node process has reloaded depends on when the user last restarted the server (server runs `node index.js`, no `--watch`).

---

## Pending / Next session

### 1. Verify server restart applied the stRec change
After server restarts, progress cache rebuilds (5-min poll). Check that X/Y numbers per station make sense compared to what op-record shows. Old value: CWS1 was 4/11; expected after fix: ~9/11.

### 2. `24:00` slot handling
Some topics use explicit `time_slots` containing `"24:00"`. The `isPast` check uses `parseInt("24:00") = 24` which is always > current hour. Verify these slots display correctly as `future` until end of day or `missed` the next day. May need special handling for 24:00 → treat as midnight boundary.

### 3. `slotSummary` OR semantics
`slotSummary[slot].done` is `true` if ANY topic at that station is fully done at that slot. `partial` is true if any topic is partial. This means a slot can appear "done" even if other topics at the same slot are partial. Confirm this matches the intended UX.

### 4. Overall progress % on dashboard
`totalRecorded / totalExpected` is summed across all stations. After the stRec fix this number will increase. Confirm the displayed percentage makes sense operationally.

---

## Constraints (do NOT violate)
- **DO NOT modify anything in `/labventure/op-record`** — `client/src/pages/OpRecord.jsx` is read-only
- **DO NOT change `time_slot` values in `operator_nodes.json`** without explicit user instruction
- **DO NOT modify `server/config/operator_nodes.json`** — it is read-only config

---

## Key server functions
- `slotsForTopic(topic)` in `server/routes/operator.js` — generates expected slots from `time_slot`/`time_slots`
- `buildProgressData(date)` — builds `{ totalExpected, totalRecorded, stations[], slotSummary }` from Uroboros data
- Progress cache: `_progressCache` / `_progressDate` — server polls Uroboros every 5 min

---

## Suggested skills
- `/handoff` — to write the next handoff at end of session

---

---

# Session 2407-B — 2026-07-24 (ต่อจาก Session 2407)

## สิ่งที่ทำในเซสชันนี้

### 1. สร้าง `server/config/schedule_overrides.json` (ใหม่ ✅)

ไฟล์กลางสำหรับ override schedule ของแต่ละ configID โดยไม่แตะ `operator_nodes.json`

โครงสร้าง:
```json
{
  "optional_stations": ["CHEM1", "CHEM2", "FWS1", "FWS2"],
  "excluded_configids": [...],
  "configid_slots": { "33": ["00:00","09:00","22:00","24:00"], ... }
}
```

**สิ่งที่ override:**
| กลุ่ม | configIDs | Slots จริง |
|-------|-----------|------------|
| RWS1 FEEDER 5&6 | 33,34,35,36 | ["00:00","09:00","22:00","24:00"] |
| RWS1 PUMP TOTALIZER + COMPENSATE | 14,6369,19,6378,24,6387,28,6396,32,6405,8776,8777 | ["00:00","24:00"] |
| RWS2 FEEDER 5&6 | 75,76,77,78 | ["00:00","09:00","22:00","24:00"] |
| RWS2 PUMP TOTALIZER | 51,6414,57,6422,62,6430,68,6438,74,6446 | ["00:00","24:00"] |
| TPS I.H.M (IHM group) | 768,784,800,7989 | ["00:00","24:00"] |
| TPS I.H.M (ENERGY group) | 776,792,808,7997 | ["00:00","09:00","22:00","24:00"] |
| DPS FEEDER/IHM (IHM) | 819,832,845,860,884,886 | ["00:00","24:00"] |
| DPS FEEDER/IHM (FEEDER) | 828,841,856,871,883,885 | ["00:00","09:00","22:00","24:00"] |
| CWS1 %SLUDGE P#12 (20 IDs) | 207-211,219-223,231-235,243-247 | ["02:00","06:00","10:00","14:00","18:00","22:00"] |
| CWS2 %SLUDGE P#34 (18 IDs) | 260-264,277-281,294-297,310-313 | ["02:00","06:00","10:00","14:00","18:00","22:00"] |
| CWS2 DRAIN (4 IDs) | 6926,6927,6928,6929 | ["08:00","16:00","24:00"] |

**excluded_configids (ไม่นับใน expected เลย):**
- CWS1 OVERVIEW ที่ไม่บันทึก: 206, 218, 230, 242
- FWS1 LEVEL P#12: 316,326,336,346,356,366,376,386,398,408,418,428,438,448,458,468
- FWS2 LEVEL P#34: 6692-6719 (28 IDs)

### 2. แก้ `server/routes/operator.js` — buildProgressData ใหม่ทั้งหมด ✅

**เปลี่ยนสำคัญ 3 ข้อ:**

**A) เพิ่ม `slotsForParam(configID, topic)`** — lookup per-configID override ก่อน fallback ไป topic default
```js
function slotsForParam(configID, topic) {
  const cid = String(configID);
  if (_excludedSet.has(cid)) return [];
  if (_cidSlots[cid]) return _cidSlots[cid];
  return slotsForTopic(topic);
}
```

**B) เปลี่ยน granularity จาก (topic, slot) → (configID, slot)** — ใช้ `slotTrack` เก็บ `{exp, rec}` ต่อ slot

**C) Threshold 60% สำหรับ `done`** — slot ถือว่า "ครบ" เมื่อ `rec/exp > 0.6` (ไม่ต้องครบ 100%)
```js
const done    = ratio > 0.6;
const partial = !done && rec > 0;
```

**D) นับ `stExp/stRec` ที่ระดับ slot** (ไม่ใช่ per-configID pair) — แต่ละ slot นับ 1 expected, นับ 1 recorded ถ้า done

**E) Optional stations** (CHEM, FWS) มี `isOptional: true` ใน response, ไม่นับใน `totalExpected/totalRecorded`

### 3. แก้ `client/src/pages/OpDashboard.jsx` ✅

- อ่าน `isOptional` จาก `stationProgress.isOptional`
- `getDotStatus`: optional stations ไม่แสดงสถานะ `'missed'` → แสดง `'future'` แทน
- `showTimeline`: แสดง timeline ถ้ามี `slotKeys.length > 0` ด้วย (ครอบคลุม optional stations ที่มีข้อมูล)

---

## สถานะ API หลัง implement (ข้อมูล 2026-07-24)

```
totalExpected: 4329 → เปลี่ยนเป็น slot-level count (mandatory stations เท่านั้น)
CHEM1, CHEM2: isOptional=true, totalExpected=0
FWS1, FWS2:   isOptional=true, totalExpected=0
```

**Debug snapshot per station (ก่อน 60% threshold):**
| Station | rec/exp | Slots missed (0%) | Slots partial |
|---------|---------|-------------------|---------------|
| RWS1 | 544/989 | 09:00 (FEEDER ยังไม่บันทึก) | ทุก slot อื่น |
| RWS2 | 558/859 | - | ทุก slot |
| TPS | 529/979 | - | ทุก slot |
| DPS | 472/878 | 17:00–24:00 | 00:00–16:00 |
| CWS1 | 164/216 | 18:00, 22:00 | 08:00,16:00,24:00 |
| CWS2 | 232/408 | 04:00, 06:00, 08:00 | ที่เหลือ |

---

## Pending / Next session

### 1. Restart server และตรวจ progress ใหม่
Server ยังไม่ได้ restart — ทุก change (schedule_overrides.json, buildProgressData, 60% threshold) ยังไม่มีผล

```bash
node index.js
```

หลัง restart: ตรวจ `/api/operator/progress` ดูว่า:
- CHEM/FWS มี `isOptional: true` และ `totalExpected: 0`
- RWS1 `stExp` ลดลงจาก 989 → จำนวน slots จริง (~14)
- slot ที่ >60% บันทึกแล้ว → `done: true`

### 2. Open questions ที่ยังไม่ได้ verify
- **CWS1 OVERVIEW อื่นๆ** (ที่ไม่ใช่ 206/218/230/242): ยืนยันว่าบันทึก ["00:00","08:00","16:00","24:00"] ครบไหม?
- **TPS I.H.M — configIDs อื่น** (6775, 6776, 6534, 9278, 9277): ใช้ 25-slot topic default หรือมี override เพิ่ม?
- **RWS CURRENT TEMP topic** (39 IDs ใน RWS1) — ทำไมทุก slot เป็น partial? บาง configID ไม่บันทึกหรือเปล่า?

### 3. Todos endpoint จะ auto-fix หลัง server restart
`/api/operator/todos` กรอง `stExp > 0` อยู่แล้ว → CHEM/FWS จะหายออกจาก "รายการค้างวันนี้" อัตโนมัติ

---

## Constraints (ยังคงเดิม)
- **DO NOT modify `server/config/operator_nodes.json`** — read-only
- **DO NOT modify `client/src/pages/OpRecord.jsx`** — read-only
- แก้ schedule → แก้ที่ `server/config/schedule_overrides.json` เท่านั้น

---

## Key files เพิ่มเติม
- `server/config/schedule_overrides.json` — per-configID slot overrides (สร้างใหม่ session นี้)
- `server/routes/operator.js` — `slotsForParam()`, `buildProgressData()` (แก้ session นี้)
- `client/src/pages/OpDashboard.jsx` — `getDotStatus()`, `showTimeline` (แก้ session นี้)
- `C:\Users\peera\.claude\plans\specific-rws1-configid-woolly-stroustrup.md` — plan ที่ approved

## Suggested skills
- `/handoff` — เขียน handoff ต่อท้ายไฟล์เดิม
- `dataviz` — สำหรับ debug visualization ข้อมูล progress

---

# Session 2407-C — 2026-07-24 (ต่อจาก Session 2407-B)

## สิ่งที่ทำในเซสชันนี้

### 1. วิเคราะห์ root cause — FWS2 slot 00:00 และ 08:00 แสดง "บันทึกไม่ครบ" ผิด ✅

**ปัญหา:** FWS2 slot 00:00 และ 08:00 แสดงว่าข้อมูลไม่ครบ ทั้งที่ข้อมูลใน Uroboros บันทึกครบ

**Root cause — Ghost/Phantom null records:**
Uroboros สร้าง placeholder records ที่ shift boundaries (00:00, 08:00, 16:00, 24:00) สำหรับ BACKWASHING params ทุกชุดล้าง โดย record เหล่านี้มี `value: null, value_text: ""` (ไม่ใช่ข้อมูลจริง)

ผลกระทบ 2 จุด:
- **00:00:** Ghost BWS record สำหรับ P#3 NO.12 (configID 589) ถูกนับก่อน → เรียก `seenMidnight[589] = true` → เมื่อ real BWS (val=4) มาถึง ถูก push ไป slot 24:00 แทน 00:00 → P#3 NO.12 ดูเหมือนหายจาก 00:00
- **08:00:** Ghost records สำหรับ P#4 NO.3 (4 configIDs) ถูกนับเป็น "บันทึกแล้ว" ที่ 08:00 → rec เกินจริง ทั้งที่ข้อมูลจริงของ NO.3 อยู่ที่ 16:00 ทั้งหมด

### 2. แก้ ghost null record filter ใน `server/routes/operator.js` ✅

**ไฟล์:** `server/routes/operator.js` — ใน `buildProgressData`, loop `for (const r of sorted)`

```js
// เพิ่มบรรทัดนี้หลัง validation cid/tsTime
if (r.value == null && !r.value_text) continue;  // skip ghost null records
```

**ทำไม check ทั้งสองฟิลด์:** STATUS params มี `value: null, value_text: "ON"` (ข้อมูลจริง) → ต้อง check ว่า value_text ก็ว่างด้วยถึงจะ skip

**⚠️ Server ยังไม่ได้ restart** — fix นี้ยังไม่มีผล ต้อง restart ด้วย `node index.js` แล้วรอ cache rebuild (5 นาที) หรือกด Sync บน UI

### 3. เพิ่ม ACTIVE_STATIONS ใน `client/src/pages/OpDashboard.jsx` ✅

**ไฟล์:** `client/src/pages/OpDashboard.jsx` บรรทัด 25

เดิม:
```js
const ACTIVE_STATIONS = new Set(['RWS1', 'RWS2']);
```

ใหม่:
```js
const ACTIVE_STATIONS = new Set(['RWS1', 'RWS2', 'CHEM1', 'CHEM2', 'FWS1', 'FWS2', 'TPS', 'DPS', 'CWS1', 'CWS2']);
```

→ ทุกสถานีแสดงปุ่ม `บันทึก →` แทน chip `เร็วๆ นี้`

### 4. เพิ่ม slot count badge สำหรับ optional stations ✅

**ไฟล์:** `client/src/pages/OpDashboard.jsx` — `StationRow` component

Optional stations (CHEM, FWS) มี `totalExpected = 0` เพราะถูก exclude จาก mandatory count → badge `stRec/stExp` ไม่แสดง

**Fix:** เพิ่ม fallback นับ slot done/total จาก `slotSummary`:

```js
// เพิ่มหลัง stExp/stRec
const slotSummary = stationProgress?.slotSummary ?? {};
const slotTotal = slotKeys.length;
const slotDone = slotKeys.filter(s => slotSummary[s]?.done).length;

// Render badge
{stExp === 0 && slotTotal > 0 && (
  <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full border
    ${slotDone === slotTotal ? 'text-green-700 bg-green-50 border-green-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
    {slotDone}/{slotTotal}
  </span>
)}
```

**ผล (verify ผ่าน browser ✅):**
| Station | Badge แสดง |
|---------|------------|
| CHEM1 | 13/13 |
| CHEM2 | 13/13 |
| FWS1 | 6/7 (ghost fix ยังไม่มีผล) |
| FWS2 | 6/7 (ghost fix ยังไม่มีผล) |

---

## Pending / Next session

### 1. ⚠️ Restart server (สำคัญมาก)
Ghost null record fix (ข้อ 2 ข้างบน) ยังไม่มีผล เพราะ server ไม่มี `--watch` และ `Stop-Process` ถูก deny permission

```bash
# Ctrl+C process เดิมก่อน แล้ว:
node index.js
```

หลัง restart: FWS2 slot 00:00 และ 08:00 ควรเปลี่ยนจาก partial → done

### 2. Verify FWS2 หลัง restart
ตรวจที่ `http://localhost:3001/api/operator/debug/station/FWS2`
- 00:00 → P#3 NO.12 ควรมี 6/6 params (BWS กลับมาที่ 00:00 แทน 24:00)
- 08:00 → P#4 NO.3 ควรหายจาก 08:00 (ย้ายไปอยู่ที่ 16:00 ตามข้อมูลจริง)

### 3. Open questions (ต่อจาก 2407-B)
- CWS1 OVERVIEW 206/218/230/242 — verify ว่า excluded แล้วถูกต้อง
- TPS I.H.M configIDs 6775/6776/6534/9278/9277 — ใช้ default 25-slot ถูกไหม?
- RWS CURRENT TEMP 39 IDs — ทำไมทุก slot partial?

---

## Constraints (ยังคงเดิม)
- **DO NOT modify `server/config/operator_nodes.json`** — read-only
- **DO NOT modify `client/src/pages/OpRecord.jsx`** — read-only
- แก้ schedule → แก้ที่ `server/config/schedule_overrides.json` เท่านั้น

---

## Key files ที่แก้ใน session นี้
- `server/routes/operator.js` — ghost null record filter ใน `buildProgressData`
- `client/src/pages/OpDashboard.jsx` — `ACTIVE_STATIONS` + slot badge สำหรับ optional stations

## Suggested skills
- `/handoff` — เขียน handoff ต่อท้ายไฟล์เดิม (`handoff/handoff2407.md`)

---

# Session 2407-D — 2026-07-24 (ต่อจาก Session 2407-C)

## สิ่งที่ทำในเซสชันนี้

### 1. ส่วน "หมายเหตุจาก AquaDAT" — ขยายสถานีให้ครบทั้งสองหน้า ✅

**ปัญหา:** `OpDashboard` มีแค่ 4 สถานี (RWS1, RWS2, TPS, DPS) ต่างจาก `Dashboard` (Sci) ที่มี 11 สถานี

**แก้:** เพิ่ม `AQUADAT_STATIONS` ใน `client/src/pages/OpDashboard.jsx` ให้ครบ 11 สถานี และเปลี่ยน `grid-cols-2` → `grid-cols-3`

### 2. Single-query + client-side filter สำหรับ AquadatRemarks (ทั้ง 2 หน้า) ✅

**หน้าที่แก้:**
- `client/src/pages/OpDashboard.jsx` — `AquadatRemarks`
- `client/src/pages/Dashboard.jsx` — `AquadatRemarks`

**Logic ใหม่:**
- Query ครั้งเดียวด้วย `station_id=0` → ดึงทุกสถานีในวันเดียวกัน
- Cache ไว้ใน query key `['aquadat-remarks-op', dt]` / `['aquadat-remarks', dt]`
- กดปุ่มสถานี → filter `allRemarks` ด้วย `trans_type` (ไม่ fetch ใหม่)
- ปุ่มที่มีข้อมูล (`typesWithData.has(st.trans_type)`) → highlight `text-brand border-brand`

**trans_type mapping เพิ่มใน `AQUADAT_STATIONS`:**
```js
{ key: 'RWS1', label: 'RWS#1', station_id: 13, trans_type: 'rws' },
{ key: 'RWS2', label: 'RWS#2', station_id: 14, trans_type: 'rws' },
{ key: 'CDS1', label: 'CDS#1', station_id: 15, trans_type: 'cds' },
{ key: 'CDS2', label: 'CDS#2', station_id: 62, trans_type: 'cds' },
// CWS→'cws', FWS→'fws', TPS→'tps', DPS→'dps', QWS→'qws'
```

**Root cause ที่ต้องแก้ก่อน:** GraphQL query ใน `server/services/aquadat.js` ไม่ได้ select `trans_type` และ `station_id`

**แก้ที่ server:** `server/services/aquadat.js` — เพิ่ม 2 field ใน selection:
```js
// บรรทัดใน readRemarks query body
station_id
station_name_th
trans_type    // ← เพิ่ม
trans_remark_date
```

### 3. หน้า Login พื้นหลังขาว ✅

**ไฟล์:** `client/src/pages/Login.jsx` บรรทัด 55

เดิม: `bg-gradient-to-br from-brand to-sky-800`  
ใหม่: `bg-white`

### 4. Logo icon ใน Header ✅

**ไฟล์:** `client/src/components/Layout.jsx`

เดิม: div สีน้ำเงิน `bg-brand` มีข้อความ "LV"  
ใหม่: `<img src="/labventure/icon.png" className="w-7 h-7 rounded-lg shrink-0 object-contain" />`

**วิธี serve icon:**
- Copy `server/pic/icon.png` → `client/public/icon.png`
- Vite base `/labventure` → ไฟล์ถูก serve ที่ `/labventure/icon.png`
- ไม่ต้อง restart server
- (Server route `/api/pic` ถูกเพิ่มใน `server/index.js` ด้วย แต่ไม่ได้ใช้แล้ว — ปล่อยไว้ได้)

---

## Pending / Next session

### 1. ⚠️ Restart server (ยังค้างจาก 2407-C)
- Ghost null record fix
- `trans_type`/`station_id` field ใน GraphQL

```bash
node index.js
```

### 2. ⚠️ Build client (ถ้ารัน production)
```bash
cd client && npm run build
```
เพราะ `icon.png` ถูก copy ไปที่ `client/public/` ซึ่งจะถูก bundle ตอน build เท่านั้น

### 3. Open questions (ต่อจาก 2407-C ยังไม่ได้ verify)
- CWS1 OVERVIEW 206/218/230/242 — excluded ถูกต้องไหม?
- TPS I.H.M configIDs 6775/6776/6534/9278/9277 — ใช้ default 25-slot ถูกไหม?
- RWS CURRENT TEMP 39 IDs — ทำไมทุก slot partial?
- FWS2 slot 00:00 และ 08:00 หลัง ghost fix

---

## Constraints (ยังคงเดิม)
- **DO NOT modify `server/config/operator_nodes.json`** — read-only
- **DO NOT modify `client/src/pages/OpRecord.jsx`** — read-only
- แก้ schedule → แก้ที่ `server/config/schedule_overrides.json` เท่านั้น

---

## Key files ที่แก้ใน session นี้
- `server/services/aquadat.js` — เพิ่ม `station_id`, `trans_type` ใน `readRemarks` GraphQL selection
- `server/index.js` — เพิ่ม `app.use('/api/pic', express.static(...))` (ไม่ได้ใช้งานจริง)
- `client/src/pages/OpDashboard.jsx` — `AQUADAT_STATIONS` ครบ 11 สถานี + `trans_type` + single-query pattern
- `client/src/pages/Dashboard.jsx` — `AQUADAT_STATIONS` เพิ่ม `trans_type` + single-query pattern
- `client/src/pages/Login.jsx` — พื้นหลังขาว
- `client/src/components/Layout.jsx` — logo icon
- `client/public/icon.png` — copy จาก `server/pic/icon.png`

## Suggested skills
- `/handoff` — เขียน handoff ต่อท้ายไฟล์เดิม (`handoff/handoff2407.md`)
