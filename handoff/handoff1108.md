# Handoff — LabVenture Daily Report Tab (11 Aug 2026)

## Context & Goal

Session ต่อจาก handoff2507.md — งานหลักคือ refactor **Operator Daily Report tab** ใน `OpRecord.jsx` จาก SSE streaming เป็น REST-based fetch แบบ batch

ปัจจุบัน: ระบบเปลี่ยนมาใช้ `/quick` (SQLite-only instant load) + `/fetch-all` (single batch query) + `/fetch-station` (per-station re-query) เรียบร้อยแล้ว

---

## สถาปัตยกรรมใหม่ (Daily Report Data Flow)

### Endpoints (server/routes/dailyReport.js)

| Endpoint | หน้าที่ |
|---|---|
| `GET /quick?date=` | SQLite-only, ไม่ fetch AquaDAT/Uroboros — ใช้แสดงผลทันทีหลัง date เปลี่ยน |
| `GET /fetch-all?date=` | Batch fetch ทุก station ใน 1 request — stage=0: Uroboros, stage=1: `/api/process` |
| `GET /fetch-station?date=&station=` | Re-query รายสถานี, อัปเดต historyCache แล้ว recompute |

### `/fetch-all` Logic

- **Stage = 0 (Uroboros):** รวม configID ทุกตัวจาก `DR_CONFIGIDS` → `fetchUroborosHistory` call เดียว → split rows ด้วย `CFG_TO_STATION` reverse lookup
- **Stage = 1 (AquaDAT):** `fetchDailyReportDirect()` → POST ไปที่ BellBeast `http://172.16.198.150:443/api/process` → parse CSV response ด้วย `parseCsvToHistoryMap()` → historyMap

### Config File ใหม่

**`server/config/dr_aquadat_configs.json`** — Single source of truth สำหรับ configID ที่ Daily Report ใช้ พร้อม `aquadat_station` ที่ถูกต้อง:

```json
{
  "endpoint": "http://172.16.198.150:443/api/process",
  "plant": "MS",
  "stations": {
    "RWS1":  { "aquadat_station": "RWS",  "configIDs": [...] },
    "RWS2":  { "aquadat_station": "RWS",  "configIDs": [...] },
    "CHEM1": { "aquadat_station": "CHEM", "configIDs": [...] },
    "CHEM2": { "aquadat_station": "CHEM", "configIDs": [...] },
    "TPS":   { "aquadat_station": "TPS",  "configIDs": [...] },
    "DPS":   { "aquadat_station": "DPS",  "configIDs": [...] },
    "FWS1":  { "aquadat_station": "FWS",  "configIDs": [...] },
    "FWS2":  { "aquadat_station": "FWS",  "configIDs": [...] },
    "CWS1":  { "aquadat_station": "CWS",  "configIDs": [...] },
    "CWS2":  { "aquadat_station": "CWS",  "configIDs": [...] }
  }
}
```

> **สำคัญ:** AquaDAT ไม่มี sub-group (ไม่มี FWS1/FWS2, RWS1/RWS2, CHEM1/CHEM2, CWS1/CWS2) — ใช้ชื่อแบบไม่มีตัวเลข (FWS, RWS, CHEM, CWS) ตลอด ส่วน TPS/DPS เป็น single station คงเดิม

### `CFG_TO_STATION` Reverse Lookup

สร้างตอน module load จาก `DR_CONFIGIDS` ใน `dailyReport.js`:
```js
// configID string → LabVenture station ID (CHEM1, FWS2, etc.)
const CFG_TO_STATION = {};
for (const [sid, ids] of Object.entries(DR_CONFIGIDS)) {
  for (const id of ids) CFG_TO_STATION[String(id)] = sid;
}
```
ใช้ใน `parseCsvToHistoryMap` เพื่อ route แต่ละ column ใน CSV กลับไปหา station ที่ถูกต้อง

### `parseCsvToHistoryMap(csvText, cfgToStation)`

Parse CSV จาก `/api/process` → historyMap `{ [sid]: { [cid]: { [slot_HH:mm]: value } } }`

- Row 0 = headers: `Date, Time, DateTime, configID...`
- Rows 1–3 = metadata (plant, param labels, units) — ข้าม
- Rows 4+ = data
- **Time normalization** (แก้ session นี้): ใช้ regex `/^(\d{1,2}):(\d{2})/` + `padStart(2,'0')` เพื่อ handle `"0:00"`, `"00:00:00"`, `"1:00"` → `"00:00"`, `"01:00"`
- **seenMidnight logic**: row แรกที่ time=`"00:00"` → slot `"00:00"`, row ที่สอง → slot `"24:00"` (วัดปลายวัน)

---

## Client Side (OpRecord.jsx — DailyReportTab)

### State

```js
const [reportData, setReportData] = useState(null);   // from /quick หรือ /fetch-all
const [fwsBW, setFwsBW] = useState(null);             // backwash records จาก SQLite
const [fwsBWLoading, setFwsBWLoading] = useState(false);
const [querying, setQuerying] = useState(false);
const [stationRows, setStationRows] = useState({});   // สถานะแต่ละ station ใน QueryModal
```

### Auto-load Flow

```
date เปลี่ยน
  → ลอง sessionStorage cache ก่อน
  → ไม่มี: GET /api/daily-report/quick?date= (SQLite-only, instant)
  → setReportData(d.report)
```

### handleAllQuery (กด All Query ใน QueryModal)

```
GET /api/daily-report/fetch-all?date=
  → setReportData(d.report)
  → sessionStorage cache
  → setStationRows(...done)
  → Promise.all([3 × FWS BW calls จาก /api/operator/history])  ← SQLite, ไม่ใช่ AquaDAT
    → setFwsBW({ p12, p3, p4 })
```

> **หมายเหตุ:** 3 FWS BW calls เป็น SQLite calls ที่แยกออกมาต่างหาก ไม่ใช่ parallel AquaDAT calls — ต้องคงไว้เพื่อ Filtration tab

### handleReQuery(sid) (กด re-query รายสถานี)

```
GET /api/daily-report/fetch-station?date=&station=
  → setReportData(d.report)
```

> `/fetch-station` ยังใช้ pattern-based fetching สำหรับ stage=1 (ยังไม่ migrate เป็น configID-based)

### QueryModal Component

`<QueryModal>` เป็น component แยก (ไม่ใช่ Portal) ใช้ inline style `position:fixed; top:0; left:0; right:0; bottom:0; zIndex:9999` พร้อม `backgroundColor:'#fff'` เพื่อแก้ปัญหา modal ไม่แสดงบน content / background โปร่งใส

---

## Tabs ใน Daily Report Right Panel

| Tab | ข้อมูลจาก | ต้อง Query ก่อน? |
|---|---|---|
| SUMMARY | `reportData` (SQLite + AquaDAT) | บางส่วน |
| CHEMICAL | `reportData.card5–10` (tank delta) + `card14_chem_dosing` (dosing rates) | **ใช่** — ค่า tank sensor ไม่อยู่ใน SQLite |
| FILTRATION | `fwsBW` จาก `/api/operator/history` (SQLite) | ใช่ (FWS BW calls) |
| RECYCLE WATER | `fwsBW` + `recycleSettings` state | ใช่ (FWS BW calls) |

---

## การแก้ไขใน Session นี้

### 1. แก้ `aquadat_station` ผิดใน config file

**ก่อน:** `"FWS1"`, `"FWS2"`, `"RWS1"`, `"RWS2"`, `"CHEM1"`, `"CHEM2"`, `"CWS1"`, `"CWS2"`  
**หลัง:** `"FWS"`, `"FWS"`, `"RWS"`, `"RWS"`, `"CHEM"`, `"CHEM"`, `"CWS"`, `"CWS"`

Root cause ของ Sankey/donut แสดงผลว่างเปล่าหลัง query: station names ผิดทำให้ `/api/process` return empty → `computeDailyReport` ได้ null values ทั้งหมด

### 2. คืน FWS BW calls ใน `handleAllQuery`

ถูกตัดออกใน session ก่อน (เข้าใจผิด) — คืนกลับแล้ว ทำให้ FILTRATION tab ทำงานอีกครั้ง

### 3. Time normalization ใน `parseCsvToHistoryMap`

เพิ่ม regex normalize time column ก่อน store เป็น slot key เพื่อรองรับ format ที่ต่างกัน (`"0:00"`, `"00:00:00"`)

---

## ไฟล์ที่เปลี่ยนแปลงใน Session นี้

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `server/config/dr_aquadat_configs.json` | แก้ `aquadat_station` ให้ตรงกับ AquaDAT จริง |
| `server/routes/dailyReport.js` | แก้ time normalization ใน `parseCsvToHistoryMap` |
| `client/src/pages/OpRecord.jsx` | คืน FWS BW calls กลับใน `handleAllQuery` |

---

## สิ่งที่ยังค้างอยู่

### High Priority

1. **Verify `/api/process` response format** — ยังไม่ได้ทดสอบกับ BellBeast จริง ต้องดู:
   - ตัวคั่น (tab หรือ comma)
   - Time column format จริงๆ ว่าเป็น `"HH:MM"` หรืออื่น
   - ว่า configID ใน header row เป็นตัวเลขล้วน หรือมี prefix/suffix
   - ว่า `/api/process` return data ถูกต้องสำหรับทุก station

2. **`/fetch-station` stage=1 ยังใช้ pattern-based** — ควร migrate ให้ใช้ configID-based เหมือน `/fetch-all` (POST `/api/process` ด้วยเฉพาะ station นั้นๆ)

### Medium Priority

3. **ยืนยัน `aquadat_station` names ครบทุก station** — user ยืนยันแค่ FWS และ TPS/DPS ชัดเจน ส่วน RWS, CHEM, CWS อนุมานจาก pattern แต่ยังไม่ได้ verify จริง

4. **CHEMICAL tab still empty** — ถ้า stage=0 (Uroboros) ค่า CHEM sensor readings (PACl tank level, Alum tank, Chlorine tank) ควรมาจาก Uroboros configID หากยังว่างอยู่หลัง Query ต้องตรวจสอบว่า Uroboros มี configIDs พวกนี้จริงหรือเปล่า

---

## Suggested Skills

- ไม่มี skill เฉพาะที่จำเป็น
- ถ้าต้องการ review code ให้ใช้ `/scrutinize` หรือ `/code-review`
- ถ้าต้องการ debug live ให้ใช้ `/run`

---

## Reference Files

- Plan ปัจจุบัน: `C:\Users\peera\.claude\plans\daily-report-tab-noble-eclipse.md`
- Config: `server/config/dr_aquadat_configs.json`
- Server route: `server/routes/dailyReport.js`
- Service (compute): `server/services/dailyReport.js` — `computeDailyReport()` + `DR_CONFIGIDS`
- Client: `client/src/pages/OpRecord.jsx` — `DailyReportTab`, `QueryModal`, `handleAllQuery`
- Previous handoffs: `handoff/handoff2507.md`, `handoff/handoff2407.md`

---

---

# Handoff — LabVenture Daily Report (Session ต่อ, 11 Aug 2026 — ช่วงบ่าย)

## สิ่งที่ทำใน Session นี้ (ต่อจากบล็อกบน)

### 1. ย้าย configID 1, 2, 39, 40 จาก CHEM → RWS

**Root cause:** configID 1, 2 เป็น flow sensor LINE A/B ของ RWS1 และ 39, 40 เป็น LINE C/D ของ RWS2 — แต่อยู่ใน `CHEM1`/`CHEM2` ทั้งใน `DR_CONFIGIDS` และ `dr_aquadat_configs.json`

**แก้ไข:**
- `DR_CONFIGIDS` ใน `server/services/dailyReport.js`:
  - `RWS1: [1, 2, 4, 7, 9, 33, 35]`
  - `RWS2: [39, 40, 41, 42, 43, 44, 75, 77]`
  - `CHEM1` / `CHEM2`: ลบ 1, 2 และ 39, 40 ออก
- `server/config/dr_aquadat_configs.json`: อัปเดตตามเดิม

**ผลกระทบต่อ calculation:** `weightedAvgDR` และ `sumFlowDR` ใช้ flowID 1/2/39/40 เป็น weight สำหรับ CHEM dosing — เพิ่ม param `flowStation` (5th arg) เพื่อ lookup flow จาก RWS1/RWS2 แทนที่จะ lookup จาก CHEM:

```js
function weightedAvgDR(flowId, drId, stationId, historyMap, flowStation) {
  const flowMap = historyMap?.[flowStation || stationId];
  const drMap   = historyMap?.[stationId];
  ...
}
```

Callers อัปเดตแล้ว:
- CHEM1 dosing: `weightedAvgDR(1, ..., 'CHEM1', hm, 'RWS1')`
- CHEM2 dosing: `weightedAvgDR(39, ..., 'CHEM2', hm, 'RWS2')`

---

### 2. เพิ่ม BW (Backwash) configIDs ใน FWS1/FWS2

configID สำหรับ `BACKWASHING P#12` (FWS1), `BACKWASHING P#3`, `BACKWASHING P#4` (FWS2) เพิ่มเข้าใน `DR_CONFIGIDS` (FWS1/FWS2) และ `dr_aquadat_configs.json` ครบแล้ว

pattern configID ต่อ bed (stride 10):
- base + 0 = by shift, +1 = filter run, +2 or levelId = level, +3 = start time, +5 = end time, +6 = wash qty
- FWS1 P#12: bed 1–8 (base 317, phase 2 base 399), 8 beds × 2 phases
- FWS2 P#3: bed 1–14 (base 479), P#4: bed 1–14 (base 621), รวมทั้ง level IDs พิเศษ (7944–7957, 7958–7971)

---

### 3. ลบ SQLite BW calls ออกจาก `handleAllQuery` — ใช้ `fwsMap` จาก `/fetch-all` แทน

**ก่อน:** `handleAllQuery` เรียก 3 calls แยก: `history?station_id=FWS1&topic=BACKWASHING P#12`, P#3, P#4

**หลัง:** `/fetch-all` endpoint return `fwsMap: { FWS1: historyMap['FWS1'], FWS2: historyMap['FWS2'] }` ใน response — client ใช้ `d.fwsMap` set ลง `fwsBW`:

```js
if (d.fwsMap) {
  const bw = { p12: d.fwsMap.FWS1, p3: d.fwsMap.FWS2, p4: d.fwsMap.FWS2 };
  setFwsBW(bw);
  sessionStorage.setItem(`dr_fwsbw_${selectedDate}`, JSON.stringify(bw));
}
```

ลบ state `fwsBWLoading` ทิ้ง — ใช้ `querying` แทนใน 3 JSX locations

---

### 4. Redesign `parseBWPhase` — flat events แทน nested beds

**ก่อน:** return `beds[]` โดยแต่ละ bed มี `washes[]` array — ทำให้แสดง 3 row ใน 1 card

**หลัง:** return `events[]` flat array — 1 event = 1 slot ที่มีข้อมูล:

```js
function parseBWPhase(history, base, count, startNo = 1, levelIds = null) {
  const events = [];
  for (let i = 0; i < count; i++) {
    const b = base + i * 10;
    // byShiftId, filterRunId, levelId, startTimeId, endTimeId, washQtyId
    for (const slot of BW_SLOTS) {
      const vals = fieldIds.map(id => history[String(id)]?.[slot]);
      const anyNonZero = vals.some(v => v !== null && v !== undefined && v !== '' && parseFloat(v) !== 0);
      if (!anyNonZero) continue; // all null/zero → ไม่แสดง card
      events.push({ no, slot, shift, filterRun, washQty, complete: allNonZero });
    }
  }
  return events;
}
```

Logic การแสดงผล:
- `anyNonZero = false` → ไม่แสดง card (ไม่มีการล้างบ่อ)
- `complete = true` (ทุก field มีค่า != 0) → card สีเขียว
- `complete = false` (บาง field = 0 หรือ null) → card สีแดง

---

### 5. แก้ Cache Restore bug

**ก่อน:** `useEffect` restore fwsBW หลัง early return ทำให้ fwsBW ไม่ถูก restore จาก cache

**หลัง:** ย้าย fwsBW restore ก่อน early return:

```js
useEffect(() => {
  // restore fwsBW ก่อน
  const cachedBW = sessionStorage.getItem(`dr_fwsbw_${selectedDate}`);
  setFwsBW(cachedBW ? JSON.parse(cachedBW) : null);
  // แล้วค่อย check report cache
  const cached = sessionStorage.getItem(`dr_report_${selectedDate}`);
  if (cached) { setReportData(JSON.parse(cached)); return ...; }
  ...
}, [selectedDate]);
```

---

### 6. แก้ Sankey blank เมื่อ `rw = 0`

**ก่อน:** `useMemo` ใน `WaterSankeyChart` คืน `null` เมื่อ `rw` prop เป็น 0/null

**หลัง:** fallback ไปใช้ pumped total (TPS + DPS):

```js
const effectiveRw = (rw && rw > 0) ? rw : ((tps ?? 0) + dpsTotal) || 0;
if (effectiveRw <= 0) return null;
// ใช้ effectiveRw ใน px() และ layout calculations ทั้งหมด
```

---

### 7. แก้ JS TDZ crash (Critical bug ที่ทำให้หน้าขาวทั้งหมด)

**Bug:** `const rw = effectiveRw` ใน useMemo shadow prop `rw` → Temporal Dead Zone violation → `ReferenceError: Cannot access 'k' before initialization` ที่ minified bundle → React tree crash → หน้าแสดงว่างเปล่า

**แก้:** ลบ shadow declaration ออก แล้วเปลี่ยน `rw` ทุกที่ใน layout calculations ให้ใช้ `effectiveRw`:
- `px = v => (v / effectiveRw) * totalBar`
- `rwH = px(effectiveRw)`
- `loss = Math.max(0, effectiveRw - ...)`

**rebuild:** `npm run build` → bundle ใหม่ `index-5UFSH8lO.js`

---

### 8. แก้ Browser Cache — server ไม่ cache index.html

เพิ่ม `Cache-Control: no-store` บน `/labventure/*` fallback route และ `{ etag: false }` บน static middleware:

```js
app.use('/labventure', express.static(CLIENT_DIST, { etag: false }));
app.get('/labventure/*', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});
```

---

## สถานะปัจจุบัน (ณ สิ้นสุด session)

| รายการ | สถานะ |
|---|---|
| JS crash (TDZ rw shadow) | ✅ แก้แล้ว, rebuild แล้ว |
| Sankey fallback เมื่อ rw=0 | ✅ แก้แล้ว |
| Cache restore fwsBW | ✅ แก้แล้ว |
| BW configIDs ใน FWS1/FWS2 | ✅ เพิ่มแล้ว |
| parseBWPhase flat events | ✅ แก้แล้ว |
| flowStation param ใน CHEM dosing | ✅ แก้แล้ว |
| Server browser cache fix | ✅ แก้แล้ว |
| Verify หน้าโหลดได้จริงในชีวิตจริง | ⏳ ยังไม่ verify — browser pane ของ Claude ไม่สามารถเข้า localhost:443 ได้ |

---

## สิ่งที่ยังค้างอยู่ (ต่อจาก session ก่อน)

1. **Verify หน้า Daily Report โหลดและแสดงผลได้จริง** — ให้ user กด **Ctrl+Shift+R** ใน Chrome แล้วเปิด `http://localhost:443/labventure/op-record?station=DAILY` ตรวจดู:
   - SUMMARY tab แสดงตัวเลขถูกต้อง
   - FILTRATION tab แสดง BW event cards (สีเขียว/แดงตามความสมบูรณ์)
   - CHEMICAL tab แสดงค่า dosing (ถ้ายังว่างอยู่ → อาจเป็น data issue จาก AquaDAT/Uroboros)
   - Sankey แสดงเมื่อมีข้อมูล RW flow

2. **CHEMICAL tab ยังอาจแสดง 0** — ถ้าเป็น stage=0 (Uroboros) ต้องตรวจว่า CHEM configID เหล่านั้น Uroboros มีจริงหรือเปล่า ถ้าเป็น stage=1 ต้องตรวจ BellBeast response

3. **`/fetch-station` stage=1 ยังใช้ pattern-based** — medium priority, migrate ให้ใช้ configID-based เหมือน `/fetch-all`

4. **ยืนยัน `aquadat_station` names** สำหรับ RWS, CHEM, CWS — ยังอนุมานจาก pattern ยังไม่ได้ verify จากระบบจริง

---

## ไฟล์ที่เปลี่ยนแปลงใน Session นี้ (ชุดที่ 2)

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `server/services/dailyReport.js` | `DR_CONFIGIDS` ย้าย 1,2,39,40 → RWS1/RWS2; เพิ่ม FWS BW IDs; `weightedAvgDR`/`sumFlowDR` เพิ่ม `flowStation` param; callers อัปเดต |
| `server/config/dr_aquadat_configs.json` | RWS1/RWS2 เพิ่ม 1,2,39,40; FWS1/FWS2 เพิ่ม BW configIDs ครบ |
| `server/routes/dailyReport.js` | `/fetch-all` return `fwsMap` ใน response body |
| `server/index.js` | เพิ่ม `etag: false` + `Cache-Control: no-store` บน index.html route |
| `client/src/pages/OpRecord.jsx` | `parseBWPhase` flat events; ลบ BW SQLite calls + ใช้ `fwsMap`; แก้ cache restore; `WaterSankeyChart` `effectiveRw` fallback; แก้ TDZ crash |

---

## Suggested Skills

- `/handoff` — สร้าง handoff session ถัดไป
- `/code-review` — ถ้าต้องการตรวจ logic ก่อน merge
