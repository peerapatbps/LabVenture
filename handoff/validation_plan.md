# LabVenture — Validation System Plan
_Updated: 2026-07-17_

---

## Progress Summary

### ✅ Completed (Session 1 — 2026-07-17)

| งาน | ไฟล์ | หมายเหตุ |
|-----|------|----------|
| RWS1 validator (steps 1–9) | `server/services/dailyValidator_RWS.js` | port จาก VB.NET ครบ 9 steps, ทดสอบกับข้อมูลจริง Uroboros แล้ว |
| RWS2 validator | `server/services/dailyValidator_RWS.js` | เพิ่ม `validateRWS2()` ในไฟล์เดียวกัน, SP unit ต่าง (m³/hr vs m³/s) |
| TPS validator (11 steps) | `server/services/dailyValidator_TPS.js` | flow, totalizer/net, pump groups 1H+3H, energy, IHM, feeder, building tot |
| DPS validator (7 steps) | `server/services/dailyValidator_TPS.js` | flow, totalizer/net, level cross-check, pump groups, energy, IHM, feeder |
| FWS1 validator (16 filters, 4 steps) | `server/services/dailyValidator_FWS.js` | total flow vs status, per-filter flow, turbidity >1 NTU, daily totalizer |
| FWS2 validator (28 filters, 4 steps) | `server/services/dailyValidator_FWS.js` | ตรรกะเดียวกับ FWS1 แต่ 4 groups × 7 filters |
| CWS1 validator (5 steps) | `server/services/dailyValidator_CWS.js` | Pulsator clarifier: inlet flow, outlet turb, level/flow, daily vol, chem dosing |
| CWS2 validator (6 steps) | `server/services/dailyValidator_CWS.js` | Solid Contact clarifier: เพิ่ม stirrer speed check |
| CHEM1 validator (5 steps) | `server/services/dailyValidator_CHEM.js` | Alum/PACl/Chlorine/Lime/KMnO4/Polymer: dosing rate, tank level, totalizer, monotonic, Cl safety |
| CHEM2 validator (5 steps) | `server/services/dailyValidator_CHEM.js` | เหมือน CHEM1 ต่าง configID |
| POST /validate endpoint (ครบทุก station) | `server/routes/operator.js` | dispatch switch RWS1/RWS2/TPS/DPS/FWS1/FWS2/CWS1/CWS2/CHEM1/CHEM2 |
| ValidationPanel UI + cellMarks | `client/src/pages/OpRecord.jsx` | right panel toggle Dashboard/Validate, step accordion, bg-red/bg-orange on cells |

### ⚠️ ต้องทวนความถูกต้อง (ConfigID Accuracy)

**สถานะ**: Logic ครบทุก station แล้ว แต่ configID หลายตัว **ใช้ค่าประมาณ/pattern** — ยังไม่ได้ verify กับ `DailyReportValidator.vb` จริงครบทุกตัว

ลำดับที่ควร verify ก่อน:

| Station | ความเสี่ยง | เหตุผล |
|---------|-----------|--------|
| **RWS1** | ต่ำ | ทดสอบกับข้อมูลจริงแล้ว — พบ negative NetA จริง |
| **RWS2** | ปานกลาง | ใช้ configID จาก VB แต่ยังไม่ได้ run กับข้อมูลจริง |
| **TPS** | สูง | tempIds, pressure (suction/discharge), speedId บางตัวเดา pattern |
| **DPS** | สูง | currentIds หลายตัว, pressure cross-check configID |
| **FWS1** | สูง | configID สร้างจาก offset pattern (888, +16/filter) — อาจ drift |
| **FWS2** | สูง | buildFWS2Filters() ใช้ base=1145, +16/filter — ต้องเช็ค VB จริง |
| **CWS1/CWS2** | สูง | drainStatusId, drainTotId, stirrerId เดา pattern |
| **CHEM1/CHEM2** | สูง | tankId, statusId, rateId, totId ยึดจาก comment ไม่ใช่ VB จริง |

### 🔲 ยังไม่ได้ทำ

| งาน | ไฟล์ | หมายเหตุ |
|-----|------|----------|
| DAILY page QUERY button | `client/src/pages/OpRecord.jsx` | parallel fetch history ทุก station |
| DAILY page VALIDATE ALL button | `client/src/pages/OpRecord.jsx` | loop validate ทุก station แล้วเก็บ state |
| StationValidationCard component | `client/src/pages/OpRecord.jsx` | summary card grid พร้อม navigate ไปหน้าย่อย |

---

---

## ภาพรวม

ระบบ Validation ของ LabVenture ทำหน้าที่ตรวจสอบความถูกต้องของข้อมูลที่ Operator บันทึกในแต่ละ station ก่อนที่จะสรุปเป็นรายงานประจำวัน โดย port logic มาจาก `DailyReportValidator.vb` ใน Sword (VB.NET)

### สัญลักษณ์

| สัญลักษณ์ | ความหมาย | ผลต่อรายงาน |
|-----------|----------|-------------|
| ✓ | ผ่านเกณฑ์ทุก step | ใช้ทำรายงานได้ปกติ |
| ✗ | ไม่ผ่านเกณฑ์ (FAILED) | **block การทำรายงาน** |
| ⚠ | เตือน (WARNING) | แสดงเตือนแต่ยังทำรายงานได้ |

### Cell Color Marking

| สี | ความหมาย |
|----|----------|
| 🔴 red (`bg-red-100`, `ring-red-500`) | ข้อมูลหายไป / อยู่ผิดตำแหน่ง / totalizer mismatch |
| 🟠 orange (`bg-orange-100`, `ring-orange-400`) | ค่าผิดปกติ / เบี่ยงเบน / pump inconsistency |

---

## Architecture

### File Structure

```
server/
  services/
    dailyValidator_RWS.js    ✅ done — validateRWS1 (steps 1–9) + validateRWS2
    dailyValidator_TPS.js    ✅ done — validateTPS (11 steps) + validateDPS (7 steps)
    dailyValidator_FWS.js    ✅ done — validateFWS1 (16 filters) + validateFWS2 (28 filters)
    dailyValidator_CWS.js    ✅ done — validateCWS1 (Pulsator) + validateCWS2 (Solid Contact)
    dailyValidator_CHEM.js   ✅ done — validateCHEM1 + validateCHEM2
  routes/
    operator.js              ✅ done — POST /api/operator/validate (dispatch ครบ 10 stations)

client/src/pages/
  OpRecord.jsx               ✅ done — ValidationPanel + cellMarks + rightPanel toggle
                             🔲 todo — DAILY page: QUERY + VALIDATE ALL + StationValidationCard
```

### Data Flow

```
หน้าย่อย (e.g. RWS1)
  ├─ liveHistory = merge(history, dirtyValues)
  │   format: { [configparam_id]: { [slot]: value_string } }
  │
  ├─ [▶ Run] → POST /api/operator/validate
  │   body: { station_id: "RWS1", date, data: liveHistory }
  │
  └─ response: ValidationResult
       ├─ station: "RWS1"
       ├─ steps: [ { index, label, status, messages[], cellMarks[] } ]
       ├─ cellMarks: [ { configparam_id, slot, color } ]   ← deduplicated
       └─ summary: { errors, warnings }

OpRecord.jsx
  ├─ validationResult state → ValidationPanel (right 30%)
  └─ validationResult.cellMarks → RecordingTable prop → bg-red-100 / bg-orange-100
```

### API Contract

**Request:** `POST /api/operator/validate`
```json
{
  "station_id": "RWS1",
  "date": "2026-07-17",
  "data": {
    "1":    { "00:00": "4.50", "02:00": "4.50" },
    "3":    { "00:00": "4.55", "02:00": "4.47" },
    "8384": { "02:00": "33000.00" }
  }
}
```

**Response:**
```json
{
  "station": "RWS1",
  "summary": { "errors": 2, "warnings": 5 },
  "steps": [
    {
      "index": 3,
      "label": "Totalizer vs Net",
      "status": "FAILED",
      "messages": ["08:00 TotA/NetA: diff=2.40 เกิน 1.0"],
      "cellMarks": [
        { "configparam_id": 4,    "slot": "08:00", "color": "red" },
        { "configparam_id": 8384, "slot": "08:00", "color": "red" }
      ]
    }
  ],
  "cellMarks": [...]
}
```

---

## UI Design

### หน้าย่อย (RecordingTable + ValidationPanel)

```
┌── RecordingTable (flex-[7]) ──────────────────────┐ ┌── Right panel (flex-[3]) ──────────────┐
│  [FLOW RPS1][CURRENT TEMP][FEEDER]...              │ │ [Dashboard] [Validate ✗2]  [▶ Run]    │
│                                                    │ ├────────────────────────────────────────┤
│  Time │ SP1 │ SP2 │ FLOW │ TOT  │ NET  │ ...      │ │ ✗ 2 error  ⚠ 5 warning               │
│  00:00│ 4.50│ 4.50│ 4.55 │315061│  0   │ ...      │ ├────────────────────────────────────────┤
│  02:00│ 4.50│ 4.50│ 4.47 │315094│33000 │ ...      │ │ ⚠ Blank/Null Check        WARNING  ▶  │
│  04:00│     │     │      │      │      │ ...      │ │ ⚠ Negative Values         WARNING  ▶  │
│  ...  │     │🟠   │      │🔴    │🔴    │ ...      │ │ ✗ Totalizer vs Net        FAILED   ▼  │
│  08:00│     │     │      │🔴    │🔴    │ ...      │ │   • 08:00 TotA diff=2.4 เกิน 1.0     │
│       │     │     │      │      │      │          │ │ ✓ Daily at Midnight       PASSED      │
│                                                    │ │ ✓ Setpoint vs Actual      PASSED      │
│  (cell highlight สีแดง/ส้ม ตาม cellMarks)         │ │ ⚠ Energy Feeder           WARNING  ▶  │
│                                                    │ │ ⚠ Pump Groups             WARNING  ▶  │
│                                                    │ │ ⚠ Daily Energy vs Σ kW    WARNING  ▶  │
│                                                    │ │ ✗ Pump Runtime IHM        FAILED   ▶  │
└────────────────────────────────────────────────────┘ └────────────────────────────────────────┘
```

### State ใน OpRecord.jsx

```js
const [validationResult, setValidationResult] = useState(null);
// null = ยังไม่รัน
// { station, steps, cellMarks, summary } = ผลการรัน
// { error: "..." } = เกิด error

const [validating, setValidating]   = useState(false);
const [rightPanel, setRightPanel]   = useState('dashboard'); // 'dashboard' | 'validate'
```

---

## RWS1 — Validation Steps

### ConfigID Groups

```js
statusIds       = [10, 15, 20, 25, 29]      // pump status (ON/STANDBY/0/1)
setpoint2H      = [1, 2, 8384, 8385]        // setpoint + net: ทุก 2h
hourlyRequired  = [3, 4, 6, 7, 9]           // flow, tot, level: ทุก 1h
zeroNotAllowed  = [9]                        // level: 0 = error
totA=4, totB=7, netA=8384, netB=8385
feederActive    = [33, 35]
feederReactive  = [34, 36]
pump2H          = [12,17,22,27,31, 13,18,23,
                   6371–6377, 6380–6386,
                   6389–6395, 6398–6404, 6407–6413]
dailyTotalizer  = [14, 19, 24, 28, 32]      // MWhr: ที่ 00:00 เท่านั้น
dailyRuntime    = [6369, 6378, 6387, 6396, 6405]  // IHM hr: ที่ 00:00 เท่านั้น
```

### Pump Map

| ปั๊ม | statusId | power | speed | tempIds | totId | rtId |
|------|----------|-------|-------|---------|-------|------|
| 1P01A | 10 | 12 | 13 | 6371–6377 | 14 | 6369 |
| 1P01B | 15 | 17 | 18 | 6380–6386 | 19 | 6378 |
| 1P01C | 20 | 22 | 23 | 6389–6395 | 24 | 6387 |
| 1P02A | 25 | 27 | — | 6398–6404 | 28 | 6396 |
| 1P02B | 29 | 31 | — | 6407–6413 | 32 | 6405 |

### Steps Detail

#### Step 1 — Blank/Null Check → ⚠ WARNING
```
FOR each slot in SLOTS_1H (00:00–24:00 every 1h):
  FOR cfgId IN hourlyRequired [3,4,6,7,9]:
    IF value == null   → cell RED
    IF cfgId==9 AND value==0 → cell ORANGE

FOR each slot in SLOTS_2H (00:00–24:00 every 2h):
  FOR cfgId IN setpoint2H + pump2H:
    IF value == null   → cell RED

FOR cfgId IN dailyTotalizer + dailyRuntime:
  AT slot "00:00": IF null OR value≤0 → RED (null) or ORANGE (≤0)
  AT other slots:  IF value>0 → RED (ไม่ควรมีค่าที่นี่)
```

#### Step 2 — Negative Values → ⚠ WARNING
```
FOR all configIDs (ยกเว้น statusIds):
  IF value < 0 → cell ORANGE
```

#### Step 3 — Totalizer vs Net → ✗ FAILED
```
Formula: computed = (totNow - totPrev) × 100
Tolerance: |computed - netNow| > 1.0 → FAIL

Check pairs:
  TotA (cfg4) vs NetA (cfg8384) — at each 2H slot (02:00–24:00)
  TotB (cfg7) vs NetB (cfg8385) — at each 2H slot (02:00–24:00)

IF fail → cell RED (both totId and netId at that slot)
```

#### Step 4 — Daily Totals at Midnight → ⚠ WARNING
```
FOR cfgId IN dailyTotalizer + dailyRuntime:
  AT "00:00": value must be non-null AND > 0
  → null  → RED
  → ≤ 0   → ORANGE
```
*(ซ้ำกับ step 1 บางส่วน แต่แยก focus เรื่อง daily totals)*

#### Step 5 — Setpoint vs Actual → ⚠ WARNING
```
Pairs: (cfg1, cfg3), (cfg2, cfg6)
Tolerance: 15%

Formula: deviation = |sp - actual| / max(|sp|, |actual|)
IF deviation > 0.15 → cell ORANGE (both sp and actual)

Check at every SLOTS_2H
```

#### Step 6 — Energy Feeder → ⚠ WARNING
```
feederActive  = [33, 35]
feederReactive = [34, 36]

IF any value null at any SLOTS_2H slot → cell ORANGE
```

#### Step 7 — Pump Groups → ⚠ WARNING
```
FOR each pump, FOR each slot in SLOTS_2H:
  running = parse status (ON/1/TRUE = running)

  IF running:
    power == null OR 0   → power + statusId ORANGE
    speed == null OR 0   → speed ORANGE  (pumps with speed only)
    any tempId null      → tempId ORANGE

  IF NOT running:
    power > 0            → power + statusId ORANGE

  Temperature spike detection:
    |temp_now - temp_prev| > 20°C → tempId ORANGE
```

#### Step 8 — Daily Energy vs Σ kW → ⚠ WARNING
```
Formula:
  sumKwh = Σ(power_kW[slot] × 2h)    (for each 2H slot 00:00–22:00)
  expectedMWhr = sumKwh / 1000
  dailyMWhr = value at totId, slot="00:00"

Tolerance: |daily - expected| / expected > 10%
→ WARNING (no cell mark — summary only)
```

#### Step 9 — Pump Runtime IHM → ✗/⚠
```
dailyRt  = value at rtId, slot="00:00"
runHours = count(slots where status==running) × 2h

Tolerance: |dailyRt - runHours| > 4h → WARNING
           |dailyRt - runHours| > 8h → FAILED
→ summary message only (no cell mark)
```

---

## RWS2 — Validation Steps (✅ implemented)

อ้างอิง `ValidateRws2DailyReport()` จาก `DailyReportValidator.vb` line 1637

| กลุ่ม | RWS2 configID | หมายเหตุ |
|-------|--------------|----------|
| totC, totD | 42, 44 | scale ×100 เหมือน RWS1 |
| netC, netD | 8386, 8387 | |
| statusIds | 46, 52, 58, 63, 69 | pumps 2P01A–2P02B |
| feederActive | 75, 77 | |
| feederReactive | 76, 78 | |
| hourlyRequired | 42, 44, 45 | non-zero check |

Step 5 ต่าง: SP หน่วย m³/hr, Actual หน่วย m³/s → compare SP vs actual×3600

---

## TPS/DPS — Validation Steps (✅ implemented)

### TPS (11 steps) — `dailyValidator_TPS.js`

| Step | เนื้อหา |
|------|---------|
| 2 | cfg758 flow null/0 → WARNING |
| 3 | Totalizer cfg759 vs Net cfg8388 (×100, tol 1.0) → FAILED |
| 4 | cfg760 null/0 เมื่อ cfg8388 ≥ 3000 → FAILED |
| 5 | cfg809/810 pressure/level → WARNING |
| 6 | Pump groups 4 ตัว: power 1H, current/speed/temp/pressure 3H → WARNING |
| 7 | cfg813/814/815 @3H vs pump status → WARNING |
| 8 | Daily MWhr vs Σ MW (tol 10%) → WARNING |
| 9 | IHM runtime vs สถานะ (tol ±2h) → WARNING/FAILED |
| 10 | cfg6534 service water delta > 1000 m³ → FAILED |
| 11 | Feeder cfg9278/9277 @key times monotonic → FAILED |
| 12 | cfg6775/6776 building totalizer delta > 0 → FAILED |

### DPS (7 steps) — `dailyValidator_TPS.js`

- Flow inst cfg872/874, Totalizer cfg873/875 vs Net cfg8389/8390
- Level cross-check cfg876 (cm) vs cfg8469 (m) ratio ~100
- Pump groups 4 ตัว (DPS-1A/1B/2A/2B): current 3H, temp 3H, speed 1H

---

## FWS1/FWS2 — Validation Steps (✅ implemented)

### FWS1 (16 filters, 4 steps) — `dailyValidator_FWS.js`

- 4 groups (A/B/C/D) × 4 filters = 16 filters
- configID pattern: Group A base=888, +16/filter; B base=952; C base=1016; D base=1080
- Step 1: Total flow (cfg887) = 0 เมื่อมี filter ON → FAILED
- Step 2: Per-filter flow vs status consistency → WARNING
- Step 3: Turbidity > 1.0 NTU เมื่อ filter running → WARNING
- Step 4: Daily totalizer at 00:00 ≤ 0 → WARNING

### FWS2 (28 filters, 4 steps) — `dailyValidator_FWS.js`

- 4 groups (A/B/C/D) × 7 filters = 28 filters
- configID: `buildFWS2Filters()` base=1145, +16/filter
- logic เหมือน FWS1

> ⚠️ **configID ต้อง verify**: FWS1 และ FWS2 ใช้ offset pattern — ต้องเทียบกับ `DailyReportValidator.vb` line 11002 และ 11901

---

## CWS1/CWS2 — Validation Steps (✅ implemented)

### CWS1 — Pulsator (5 steps)
- 4 clarifiers: Clarifier 1–4
- configID: base 1395, +18/clarifier
- Steps: inlet flow, outlet turb ≤2 NTU, per-clarifier level/flow/turb, daily volume, ALUM/PACl dosing

### CWS2 — Solid Contact (6 steps)
- 4 SC clarifiers: base 1470, +18/clarifier
- เพิ่ม step 6: stirrer speed (cfg1469) ต้อง > 0 เมื่อ clarifier ON

> ⚠️ **configID ต้อง verify**: sludge (CWS1: 205,217,229,241 / CWS2: 6001–6004) ยังไม่ได้ใส่ใน implementation ปัจจุบัน — ต้องเพิ่มหลัง verify

---

## CHEM1/CHEM2 — Validation (✅ implemented)

### configID จริงจาก VB (ต้อง verify)

| Station | Chemical | tankId | statusId | rateId | totId |
|---------|----------|--------|----------|--------|-------|
| CHEM1 | Alum | 1545 | 1546 | 1547 | 1548 |
| CHEM1 | PACl | 1552 | 1553 | 1554 | 1555 |
| CHEM1 | Chlorine | 1559 | 1560 | 1561 | 1562 |
| CHEM1 | Lime | 1565 | 1566 | 1567 | 1568 |
| CHEM1 | KMnO4 | 1571 | 1572 | 1573 | 1574 |
| CHEM1 | Polymer | 1577 | 1578 | 1579 | 1580 |
| CHEM2 | Alum | 1585 | 1586 | 1587 | 1588 |
| CHEM2 | PACl | 1592 | 1593 | 1594 | 1595 |
| CHEM2 | Chlorine | 1599 | 1600 | 1601 | 1602 |
| CHEM2 | Lime | 1605 | 1606 | 1607 | 1608 |
| CHEM2 | KMnO4 | 1611 | 1612 | 1613 | 1614 |

> configID เหล่านี้ **ยึดจาก pattern ไม่ใช่ VB จริง** — ต้อง cross-check กับ `DailyReportValidator.vb` และ `operator_nodes.json`

> VB จริงมี configID ต่างออกไป: CHEM1 ALUM=89/92/93/96/8037, PACl=8402+, Cl=127/128/6972

Steps (5 ต่อ station):
1. Dosing rate vs pump status
2. Tank level < 10% → WARNING, < 5% → RED
3. Daily totalizer = 0 เมื่อมีการจ่ายสาร → FAILED
4. Totalizer monotonic → FAILED
5. Chlorine safety limit ≤ 15 mg/L → FAILED

---

## หน้าหลัก DAILY — QUERY + VALIDATE ALL (todo)

### QUERY button
```
กด QUERY → parallel fetch history สำหรับทุก station:
  await Promise.all([
    GET /api/operator/history?station_id=RWS1&date=...,
    GET /api/operator/history?station_id=RWS2&date=...,
    ... (ทุก station)
  ])
→ เก็บใน allStationHistory: { [stationId]: historyData }
```

### VALIDATE ALL button
```
กด VALIDATE ALL → sequential validate ทุก station:
  FOR each station in [RWS1, RWS2, TPS, DPS, FWS1, FWS2, CWS1, CWS2, CHEM1, CHEM2]:
    POST /api/operator/validate { station_id, date, data: allStationHistory[station_id] }
→ เก็บใน allValidationResults: { [stationId]: ValidationResult }
```

### DAILY page layout
```
┌── DAILY page ──────────────────────────────────────────────────────────┐
│  วันที่ [picker]    [QUERY]    [VALIDATE ALL]                          │
│                                                                        │
│  ┌─ RWS1 ──────┐ ┌─ RWS2 ──┐ ┌─ CHEM1 ──┐ ┌─ CHEM2 ─┐ ...         │
│  │ ✗ 2 error   │ │ ✓ OK    │ │ ⚠ 2 warn │ │ ✓ OK    │              │
│  │ ⚠ 5 warning │ │         │ │ (ALUM)   │ │         │              │
│  └─────────────┘ └─────────┘ └──────────┘ └─────────┘              │
│                                                                        │
│  (คลิก card → navigate ไปหน้าย่อยนั้น)                              │
└────────────────────────────────────────────────────────────────────────┘
```

### Station summary card component (todo)
```jsx
function StationValidationCard({ stationId, label, result, onClick }) {
  // result = null (ยังไม่ validate) | loading | ValidationResult
  const errors   = result?.summary?.errors   ?? null;
  const warnings = result?.summary?.warnings ?? null;
  return (
    <div onClick={onClick} className="cursor-pointer rounded-xl border p-3 ...">
      <div className="font-bold">{label}</div>
      {errors === null ? <span className="text-gray-400 text-xs">ยังไม่ validate</span> :
       errors > 0     ? <span className="text-red-600">✗ {errors} error</span> :
       warnings > 0   ? <span className="text-amber-500">⚠ {warnings} warning</span> :
                        <span className="text-emerald-600">✓ OK</span>}
    </div>
  );
}
```

---

## Implement Roadmap

| Priority | งาน | ไฟล์ | สถานะ |
|----------|-----|------|-------|
| 1 | RWS1 validator (steps 1–9) | `dailyValidator_RWS.js` | ✅ Done — ทดสอบกับข้อมูลจริงแล้ว |
| 2 | POST /validate endpoint | `operator.js` | ✅ Done — dispatch ครบ 10 stations |
| 3 | ValidationPanel UI + cellMarks | `OpRecord.jsx` | ✅ Done — accordion, color marks |
| 4 | RWS2 validator | `dailyValidator_RWS.js` | ✅ Done — verify configID ยังขาด |
| 5 | TPS + DPS validator | `dailyValidator_TPS.js` | ✅ Done — verify configID ยังขาด |
| 6 | FWS1 + FWS2 validator | `dailyValidator_FWS.js` | ✅ Done — configID offset pattern (risk) |
| 7 | CWS1 + CWS2 validator | `dailyValidator_CWS.js` | ✅ Done — sludge steps ยังไม่ครบ |
| 8 | CHEM1 + CHEM2 validator | `dailyValidator_CHEM.js` | ✅ Done — configID ต้อง verify จาก VB |
| 9 | **Verify configIDs ทุก station** | VB + operator_nodes.json | 🔲 **Next priority** |
| 10 | DAILY page QUERY + VALIDATE ALL | `OpRecord.jsx` | 🔲 Todo |
| 11 | StationValidationCard component | `OpRecord.jsx` | 🔲 Todo |

---

## Reference Files

| ไฟล์ | ความสำคัญ |
|------|----------|
| `C:\Users\peera\OneDrive\Desktop\DDD\Sword\DailyReportValidator.vb` | Source of truth สำหรับ validation rules ทุก station |
| `C:\Users\peera\OneDrive\Desktop\DDD\Sword\base.vb` | `fusion_Validate_All()` ลำดับการ validate + UI rendering |
| `server/config/operator_nodes.json` | configparam_id ทุกตัวสำหรับทุก station |
| `server/services/dailyReport.js` | configID reference สำหรับ daily summary calculations |
| `server/services/dailyValidator_RWS.js` | RWS1 implementation (ใช้เป็น template สำหรับ station อื่น) |

---

## Key Implementation Notes

1. **Data format input**: `data[configparam_id_string][slot_string] = value_string` — validator ต้อง `parseFloat` เองเสมอ

2. **Status parsing**: ค่า pump status อาจเป็น `"ON"`, `"STANDBY"`, `"1"`, `"0"`, `"TRUE"`, `"FALSE"` ขึ้นกับ Aquadat config

3. **Slot format**: `"00:00"` ถึง `"24:00"` (ไม่ใช่ `"23:59"`) — `"24:00"` คือ midnight ของวันถัดไป

4. **CellMark deduplication**: red ชนะ orange เมื่อ cell เดียวกันมี 2 marks จาก 2 steps

5. **Totalizer scale**: TotA/TotB หน่วยเป็น `m³×100` ดังนั้นต้อง ×100 เพื่อเทียบกับ Net (m³) → `(totNow - totPrev) × 100 ≈ netNow`

6. **CHEM validators**: return format ต่างกัน (plain string จาก VB) ต้อง wrap ให้เป็น `ValidationResult` format เดียวกัน

7. **Performance**: validate แต่ละ station เป็น synchronous pure function — ไม่ต้อง DB query ใดๆ ทั้งสิ้น เพราะ data ส่งมาจาก client แล้ว
