# Handoff — LabVenture Lazy Loading & Number Formatting (2026-07-19)

**Project:** LabVenture — AquaDAT Scientist Recorder  
**Working dir:** `C:\Users\peera\OneDrive\Desktop\LabVenture`  
**Session date:** 2026-07-19  
**Branch:** master  
**Previous handoff:** `handoff/handoff1807.md`

---

## ภาพรวม Session นี้

Session นี้ทำ 3 งานหลัก:

1. **Lazy load station definition** — เปลี่ยนจาก fetch ทุก station พร้อมกันมาเป็นต่อ station
2. **Lazy load history per topic** — เปลี่ยนจาก fetch ทุก topic ของ station พร้อมกันมาเป็นต่อ topic (on demand)
3. **Number formatting** — แสดงตัวเลขในตาราง RecordingTable ด้วย comma กั้น 3 หลัก

---

## ส่วนที่ 1 — Lazy load station definition

### ปัญหาเดิม
`GET /api/operator/nodes` ส่งคืน JSON ของทุก station (~11 stations) ทุกครั้งที่โหลดหน้า

### การแก้ไข

**Server:** `server/routes/operator.js` — เพิ่ม `?station_id=` support

```js
// เดิม: คืน { stations: [...all...] }
// ใหม่: ถ้ามี ?station_id=RWS1 → คืน { station: {...single...} }
router.get('/nodes', (req, res) => {
  const data = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
  const { station_id } = req.query;
  if (station_id) {
    const station = (data.stations || []).find(s => s.id === station_id) ?? null;
    return res.json({ station });
  }
  res.json(data); // backward compat — full list ยังใช้ได้
});
```

**Client:** `client/src/pages/OpRecord.jsx`

```js
// เดิม
const { data: opNodes } = useQuery({ queryKey: ['op-nodes'], queryFn: () => get('/api/operator/nodes') });
const stationDef = opNodes?.stations?.find(s => s.id === activeStation) ?? null;

// ใหม่
const { data: stationNode } = useQuery({
  queryKey: ['op-node', activeStation],
  queryFn: () => get(`/api/operator/nodes?station_id=${encodeURIComponent(activeStation)}`),
  staleTime: 300000,
  enabled: !!activeStation,
});
const stationDef = stationNode?.station ?? null;
```

React Query cache แยกต่อ station — switch station ครั้งแรก fetch, ครั้งต่อไป instant

---

## ส่วนที่ 2 — Lazy load history per topic

### ปัญหาเดิม
History fetch ส่ง request ไปทุก pattern ของ station พร้อมกัน:
```
[history/aquadat] Flow pattern 348: 47 values
[history/aquadat] Status pattern 122: 45 values
[history/aquadat] Power pattern 121: 40 values
... (7 patterns พร้อมกัน)
```

### Root cause ที่ซ่อนอยู่ (Gotcha #1)

Topic names ใน `aquadat_patterns.json` **ไม่ตรง**กับ topic names ใน `operator_nodes.json`:

| aquadat_patterns.json | operator_nodes.json (RWS1) |
|----------------------|---------------------------|
| `Flow` | `FLOW RPS1` |
| `Status` | `PUMP STATUS` |
| `Power` | `POWER / SPEED / BATTERY` |
| `Energy Feeder` | `FEEDER 5&6` |
| `Temperature` | `CURRENT TEMP`, `Temperature` |
| `Compensate` | `COMPENSATE` |
| `PUMP TOTALIZER & IHM` | `PUMP TOTALIZER & IHM` ✓ |

ดังนั้นการส่ง `?topic=FLOW RPS1` ไปหา server แล้ว filter ด้วย `p.topic === topic_filter` จะหาไม่เจอ → return `{}` → ดูเหมือนไม่โหลด

### การแก้ไข

**`server/config/aquadat_patterns.json`** — เพิ่ม field `node_topics` ในทุก entry:

```json
{ "topic": "Flow", "pattern_id": 348, "node_topics": ["FLOW RPS1"] }
{ "topic": "Temperature", "pattern_id": 123, "node_topics": ["CURRENT TEMP", "Temperature"] }
```

ครบทุก station: RWS1, RWS2, CHEM1, CHEM2, TPS, DPS, CWS1, CWS2, FWS1, FWS2

**`server/routes/operator.js`** — อัปเดต filter logic:

```js
const patterns = topic_filter
  ? allPatterns.filter(p =>
      (Array.isArray(p.node_topics) && p.node_topics.includes(topic_filter)) ||
      p.topic === topic_filter   // fallback legacy
    )
  : allPatterns;
```

**`client/src/pages/OpRecord.jsx`** — เปลี่ยน history fetch effect:

```js
const loadedTopicsRef = useRef(new Set()); // ref ไม่ใช่ state — ไม่ trigger re-render

// Reset เมื่อ station หรือ date เปลี่ยน
useEffect(() => {
  setHistory({});
  loadedTopicsRef.current = new Set();
}, [activeStation, selectedDate]);

// Fetch เฉพาะ activeTopic เมื่อยังไม่เคยโหลด
useEffect(() => {
  if (!activeStation || !activeTopic) return;
  if (loadedTopicsRef.current.has(activeTopic)) return; // cache hit

  setHistoryLoading(true);
  const qs = new URLSearchParams({ station_id: activeStation, date: selectedDate, topic: activeTopic });
  get(`/api/operator/history?${qs}`)
    .then(data => {
      if (data && typeof data === 'object') {
        setHistory(prev => ({ ...prev, ...data })); // merge (ไม่ replace)
        loadedTopicsRef.current.add(activeTopic);
      }
    })
    .catch(e => console.warn('[history]', activeStation, activeTopic, e.message))
    .finally(() => setHistoryLoading(false));
}, [activeStation, activeTopic, selectedDate]);
```

### พฤติกรรมใหม่
- เปิดหน้า `?station=RWS1` → โหลดแค่ topic แรก (FLOW RPS1)
- สลับ topic → โหลดเฉพาะ topic นั้น (ครั้งแรก)
- กลับมา topic เดิม → instant จาก `loadedTopicsRef` cache
- เปลี่ยน station/date → reset ทุกอย่าง เริ่มใหม่

### Gotcha #2 — formula cross-topic
Widget และ formula column บางตัวอ้างอิง configparam_id จาก topic อื่นผ่าน `allHistory` (liveHistory) — ถ้า topic นั้นยังไม่โหลด formula จะเห็นค่า `0` แทนค่าจริง นี่คือ trade-off ที่ยอมรับได้ เพราะ formula ภายใน topic เดียวกันทำงานถูกต้องเสมอ

---

## ส่วนที่ 3 — Number formatting

`formatDisplayVal()` ใน `RecordingTable` (`client/src/pages/OpRecord.jsx`)

```js
function formatDisplayVal(val, type) {
  if (val === '' || val == null) return val;
  const t = (type || '').trim();
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  function addCommas(str) {
    const [int, dec] = str.split('.');
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec !== undefined ? '.' + dec : '');
  }
  if (t === 'INT') return addCommas(String(Math.round(num)));
  const m = t.match(/^FLOAT\((\d+)\)$/);
  if (m) return addCommas(num.toFixed(parseInt(m[1], 10)));
  return addCommas(String(num));
}
```

กฎ: comma ใส่หลัง format ทศนิยม — ทศนิยมยังตาม type (INT, FLOAT(2) ฯลฯ), TEXT ไม่เปลี่ยน

---

## ไฟล์ที่เปลี่ยนใน Session นี้

| ไฟล์ | การเปลี่ยน |
|------|-----------|
| `server/routes/operator.js` | `/nodes` endpoint รับ `?station_id`; history filter ใช้ `node_topics` |
| `server/config/aquadat_patterns.json` | เพิ่ม `node_topics` ทุก entry ทุก station |
| `client/src/pages/OpRecord.jsx` | lazy load stationDef per station; lazy load history per topic; comma formatting |

---

## Gotcha สรุป

| # | เรื่อง | รายละเอียด |
|---|--------|-----------|
| 1 | Topic name mismatch | `aquadat_patterns.json` ใช้ชื่อ legacy (Flow, Status...) แต่ `operator_nodes.json` ใช้ชื่อใหม่ (FLOW RPS1, PUMP STATUS...) → แก้ด้วย `node_topics` array |
| 2 | Formula cross-topic | formula ที่ reference cfgId จาก topic อื่นจะเห็น 0 ถ้า topic นั้นยังไม่โหลด |
| 3 | loadedTopicsRef เป็น ref | ใช้ ref ไม่ใช่ state เพื่อหลีกเลี่ยง stale closure และ unnecessary re-render |

---

## สถานะงานจาก handoff1807

- [x] Formula columns RWS1/2, TPS, DPS, CHEM1, CHEM2 — เสร็จแล้ว (session ก่อน)
- [ ] Verify TPS/DPS formula (browser) — ยังค้างอยู่
- [ ] Verify RWS2 LINE C/D formula — ยังค้างอยู่

---

## Suggested Skills

- `/verify` — ทดสอบ lazy load ใน browser: เปิด RWS1, ดู network tab ว่า request เดียวต่อ topic switch
- `/verify` — ยืนยัน TPS/DPS formula column จาก handoff1807 ที่ยังค้าง
- `js_refer/col_formula.md` — reference formula syntax ถ้า session ถัดไปเกี่ยวกับ formula
- `/handoff` — เมื่อจบ session ถัดไป

---

## Session เพิ่มเติม — CHEM2 Chlorine dual-pattern fix (2026-07-19)

### ปัญหา

หน้า `CHEM2 → CHLORINE P#34` โหลด `pattern_id: 352` ถูกต้องแล้ว แต่ฝั่ง Aquadat server ส่งข้อมูลมาไม่ครบ — pattern 352 ขาด 6 configID สุดท้ายของหน้า:

- P-PRE3A, P-PRE4A, P-POS3A, P-POS3B, P-POS4A, P-POS4B

### การแก้ไข

**`server/config/aquadat_patterns.json`** — เพิ่ม entry ที่สองสำหรับ CHEM2 Chlorine set ให้ fetch `pattern_id: 9` ควบคู่กัน:

```json
"CHEM2": [
  ...
  { "topic": "Chlorine set", "pattern_id": 352, "node_topics": ["CHLORINE P#34"] },
  { "topic": "Chlorine set", "pattern_id": 9,   "node_topics": ["CHLORINE P#34"] },
  ...
]
```

`fetchAquadatHistory` วน loop ทั้งสอง entry และ merge ผลเข้า `out` map เดียวกัน — 6 configID จาก pattern 9 จึงปรากฏในหน้าด้วย

### หมายเหตุ

- ไม่ต้องเปลี่ยนโค้ด server/client ใด ๆ เพิ่ม — แค่เพิ่ม entry ใน JSON
- Pattern 9 จะถูก fetch เฉพาะเมื่อ topic "CHLORINE P#34" ถูกเปิด (lazy load ทำงานปกติ)
- ถ้า station อื่นมีปัญหาเดียวกัน (pattern เดียวไม่ครบ) ใช้แนวทางเดียวกัน: เพิ่ม entry ที่สองใน JSON

---

## Session เพิ่มเติม — Loading screen & re-fetch on topic switch (2026-07-19)

### ปัญหา 1: สลับ sub-tab ไม่ re-fetch (ได้ข้อมูลเก่า)

`loadedTopicsRef` cache ทำให้ topic ที่เคยโหลดแล้วไม่ถูก fetch อีก แม้ข้อมูลอาจเปลี่ยนจากคนอื่นบันทึก

### ปัญหา 2: สลับ station ใหม่ไม่มี loading screen

`historyLoading` เริ่มต้น `false` — มี render หนึ่งช่วงที่ history ว่างแล้วแต่ overlay ยังไม่ขึ้น เพราะ `setHistoryLoading(true)` ถูกเรียกใน effect หลัง render

### ปัญหา 3 (Gotcha #4) — Race condition ทำให้ loading screen หายกลางคัน

เมื่อสลับ station ขณะที่ fetch เก่ายังทำงานอยู่:
1. สลับ CHEM#1 → RWS#1: fetch CHEM#1 ยังค้างอยู่
2. สลับกลับ CHEM#1: `setHistoryLoading(true)` + เริ่ม fetch CHEM#1 ใหม่
3. **fetch CHEM#1 เก่า** เสร็จ → `.finally(() => setHistoryLoading(false))` ← ปิด overlay ก่อนกำหนด!
4. fetch CHEM#1 ใหม่ยังทำงานอยู่ แต่ overlay หายไปแล้ว

### การแก้ไข

**`client/src/api.js`** — เพิ่ม `opts` parameter ให้ `get()`:

```js
// เดิม
export const get = (path) => api(path);

// ใหม่
export const get = (path, opts) => api(path, opts);
```

**`client/src/pages/OpRecord.jsx`** — 3 การเปลี่ยนแปลง:

```js
// 1. ลบ loadedTopicsRef ทิ้ง — ให้ fetch ใหม่ทุกครั้งที่สลับ topic

// 2. Reset + เปิด loading ทันทีเมื่อ station/date เปลี่ยน
useEffect(() => {
  setHistory({});
  setHistoryLoading(true);  // ← เพิ่ม: แสดง overlay ก่อน fetch เริ่ม
}, [activeStation, selectedDate]);

// 3. ใช้ AbortController ยกเลิก fetch เก่า
useEffect(() => {
  if (!activeStation || !activeTopic) return;

  const controller = new AbortController();
  setHistoryLoading(true);
  const qs = new URLSearchParams({ station_id: activeStation, date: selectedDate, topic: activeTopic });
  get(`/api/operator/history?${qs}`, { signal: controller.signal })
    .then(data => {
      if (data && typeof data === 'object') setHistory(prev => ({ ...prev, ...data }));
    })
    .catch(e => { if (e?.name !== 'AbortError') console.warn('[history]', ...); })
    .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); }); // ← ตรวจก่อนปิด
  return () => controller.abort(); // ← cleanup ยกเลิก fetch เก่า
}, [activeStation, activeTopic, selectedDate]);
```

### พฤติกรรมใหม่

- สลับ sub-tab ใด ๆ → fetch ใหม่เสมอ + แสดง loading overlay
- สลับ station → loading overlay แสดงทันที ก่อน fetch เริ่ม
- สลับ station เร็ว ๆ → fetch เก่าถูก abort ทันที, overlay ไม่หายกลางคัน
- ข้อมูลจาก fetch ที่ถูก abort จะถูก ignore ทั้งหมด

---

## Gotcha สรุป (อัปเดต)

| # | เรื่อง | รายละเอียด |
|---|--------|-----------|
| 1 | Topic name mismatch | `aquadat_patterns.json` ใช้ชื่อ legacy (Flow...) ≠ `operator_nodes.json` (FLOW RPS1...) → แก้ด้วย `node_topics` |
| 2 | Formula cross-topic | formula อ้างอิง cfgId จาก topic อื่นจะเห็น 0 ถ้า topic นั้นยังไม่โหลด |
| 3 | loadedTopicsRef เป็น ref | (ตอนนี้ลบออกแล้ว — ไม่ cache topic อีกต่อไป) |
| 4 | Race condition fetch เก่า | fetch เก่าที่ยังไม่เสร็จจะเรียก `setHistoryLoading(false)` ทับ loading ของ request ใหม่ → แก้ด้วย AbortController + ตรวจ `signal.aborted` ก่อน finally |

---

## Session เพิ่มเติม — FILTRATION Tab Redesign (2026-07-19)

### ภาพรวม

ออกแบบและ implement ส่วน FILTRATION ใน Daily Report tab ใหม่ทั้งหมด โดยแสดง 4 phase rows จำแนกตาม filter bed phase ของ FWS#1 (Phase 1+2) และ FWS#2 (Phase 3+4)

---

### Phase Config (`client/src/pages/OpRecord.jsx`)

**Constants ก่อน `DailyReportTab` function (บรรทัดประมาณ ~1388):**

```js
// FWS2 level IDs อยู่ใน range แยก (7944-7971) ไม่ได้ follow stride +2
const P3_LEVEL_IDS = [7944,7951,7945,7952,7946,7953,7947,7954,7948,7955,7949,7956,7950,7957];
const P4_LEVEL_IDS = [7958,7965,7959,7966,7960,7967,7961,7968,7962,7969,7963,7970,7964,7971];

const FWS_BW_PHASES = [
  { id: 'P1', src: 'FWS#1', totalBeds: 8,  startNo: 1,  station: 'FWS1', topic: 'BACKWASHING P#12', base: 317 },
  { id: 'P2', src: 'FWS#1', totalBeds: 8,  startNo: 9,  station: 'FWS1', topic: 'BACKWASHING P#12', base: 399 },
  { id: 'P3', src: 'FWS#2', totalBeds: 14, startNo: 1,  station: 'FWS2', topic: 'BACKWASHING P#3',  base: 479, levelIds: P3_LEVEL_IDS },
  { id: 'P4', src: 'FWS#2', totalBeds: 14, startNo: 1,  station: 'FWS2', topic: 'BACKWASHING P#4',  base: 621, levelIds: P4_LEVEL_IDS },
];

const BW_SLOTS = ['08:00', '16:00', '24:00']; // 00:00 ไม่นับ (เป็นข้อมูลวันก่อน)
```

---

### ConfigParam Stride

**FWS1 BACKWASHING P#12** — stride 10 per bed, ทุก field อยู่ใน range เดียว:

| offset | field |
|--------|-------|
| +0 | BACK WASHING BY SHIFT (INT) |
| +1 | FILTER RUN BEFORE BACKWASH (h) |
| +2 | LEVEL BEFORE BACKWASH (m) ✓ |
| +3 | START TIME (hh:mm) |
| +4 | (unused/other) |
| +5 | END TIME (hh:mm) |
| +6 | WASH WATER QUANTITY (m³) |

- P1 No.1 base = **317**, P1 No.2 = 327, ... P1 No.8 = 387
- P2 No.9 base = **399** (ไม่ใช่ 397 — gap 6 IDs หลัง P1)

**FWS2 BACKWASHING P#3 / P#4** — same stride สำหรับ 5 fields แต่ **LEVEL อยู่คนละ range**:

- P#3 base = **479**, P#4 base = **621**
- LEVEL ของ FWS2: `P3_LEVEL_IDS` / `P4_LEVEL_IDS` (ดู constants ด้านบน)
- pattern: interleaved 2 groups, ไม่มี formula คำนวณ ต้อง hardcode เท่านั้น

---

### `parseBWPhase` Function

```js
// signature: parseBWPhase(history, base, count, startNo = 1, levelIds = null)
// แสดง bed ถ้า ANY ใน 6 fields ไม่ null
// complete = true ถ้าครบทั้ง 6 → card สีเขียว, false → card สีแดง
function parseBWPhase(history, base, count, startNo = 1, levelIds = null) {
  if (!history) return null;
  return Array.from({ length: count }, (_, i) => {
    const b           = base + i * 10;
    const levelId     = levelIds ? levelIds[i] : b + 2;
    const fieldIds    = [b, b+1, levelId, b+3, b+5, b+6]; // byShift, run, level, start, end, qty
    const washes = [];
    for (const slot of BW_SLOTS) {
      const vals = fieldIds.map(id => history[String(id)]?.[slot]);
      if (vals.some(v => v !== null && v !== undefined && v !== '')) {
        const allPresent = vals.every(v => v !== null && v !== undefined && v !== '');
        washes.push({
          slot,
          shift:     parseInt(history[String(b)]?.[slot], 10) is valid ? `Shift N` : slot,
          filterRun: parseFloat(...) or null,
          washQty:   parseFloat(...) or null,
          complete:  allPresent,
        });
      }
    }
    return { no: startNo + i, byShiftId: b, washes };
  });
}
```

---

### Card Color Logic

```js
const allComplete = bed.washes.every(w => w.complete);
// green = ข้อมูลครบ 6 fields ทุก wash slot
// red   = ข้อมูลไม่ครบบาง field (เตือน operator)
const cardBg     = allComplete ? '#d1fae5' : '#fee2e2';
const cardBorder = allComplete ? '#6ee7b7' : '#fca5a5';
const accentBar  = allComplete ? '#10b981' : '#ef4444';
```

- **> 6 beds washed** ใน phase เดียว → layout เปลี่ยนเป็น `grid grid-cols-6` + `overflow-y-auto` (maxHeight 260px)
- **≤ 6 beds** → `flex overflow-x-auto` ปกติ

---

### Card Click → Navigate + Cell Focus

```js
// ใน washedBeds.map():
onClick={() => navigate(
  `/op-record?station=${ph.station}&date=${selectedDate}` +
  `&topic=${encodeURIComponent(ph.topic)}&focus=${bed.byShiftId}`
)}
```

**URL params ที่รองรับใน `OpRecordPage`:**

```js
const urlTopic = searchParams.get('topic');  // auto-select topic
const urlFocus = searchParams.get('focus');  // focus cell (configparam_id)
```

**Station sync useEffect** — เพิ่มเพื่อให้ programmatic navigation เปลี่ยน station ได้:

```js
useEffect(() => {
  const s = searchParams.get('station');
  if (s && ACTIVE_STATIONS.has(s)) setActiveStation(s);
}, [searchParams]);
```

**Focus useEffect ใน `RecordingTable`:**

```js
useEffect(() => {
  if (!focusId || !topic?.params) return;
  const pi = topic.params.findIndex(p => String(p.configparam_id) === String(focusId));
  if (pi >= 0) setSelCell({ si: 0, pi });
}, [focusId, topic?.params]);

// Reset effect — skip reset ถ้า focusId มีค่า (มิฉะนั้น reset จะทับ focus)
useEffect(() => {
  if (!focusId) setSelCell({ si: 0, pi: 0 }); // ← บรรทัดนี้แก้แล้ว
  setSelAnchor(null);
  setEditCell(null);
  setCopiedRange(null);
  ...
}, [topic.topic]);
```

---

### Data Fetching ใน DailyReportTab

```js
// Lazy fetch เฉพาะเมื่อ FILTRATION tab active
useEffect(() => {
  if (rightSubTab !== 'FILTRATION') return;
  setFwsBWLoading(true);
  Promise.all([
    get(`/api/operator/history?station_id=FWS1&date=${selectedDate}&topic=BACKWASHING+P%2312`),
    get(`/api/operator/history?station_id=FWS2&date=${selectedDate}&topic=BACKWASHING+P%233`),
    get(`/api/operator/history?station_id=FWS2&date=${selectedDate}&topic=BACKWASHING+P%234`),
  ]).then(([p12, p3, p4]) => setFwsBW({ p12, p3, p4 }))
    .catch(e => console.warn('[FWS BW]', e.message))
    .finally(() => setFwsBWLoading(false));
}, [rightSubTab, selectedDate]);
```

---

### Gotcha FILTRATION

| # | เรื่อง | รายละเอียด |
|---|--------|-----------|
| G1 | P2 base = 399 ไม่ใช่ 397 | P1 ends at cfgId 393, P2 starts 399 (gap 6 IDs) — ตรวจยืนยันจาก `operator_nodes.json` |
| G2 | 00:00 slot = วันก่อน | `BW_SLOTS = ['08:00','16:00','24:00']` — ไม่รวม 00:00 |
| G3 | FWS2 LEVEL IDs ไม่ใช่ stride | Level ของ P3/P4 อยู่ใน 7944-7971 แบบ interleaved — ต้อง `P3_LEVEL_IDS` / `P4_LEVEL_IDS` hardcode |
| G4 | Reset effect ทับ focus | `RecordingTable` reset effect รัน**หลัง** focus effect → `selCell` ถูก reset เป็น {0,0} → แก้: skip reset ถ้า `focusId` มีค่า |
| G5 | navigate path double prefix | ใช้ `/op-record?...` ไม่ใช่ `/labventure/op-record?...` (Router base คือ `/labventure`) |
| G6 | activeStation ไม่ sync จาก URL | `useState(initStation)` อ่านแค่ครั้งแรก — programmatic navigate ไม่เปลี่ยน state → แก้: เพิ่ม `useEffect` ที่ watch `searchParams` |

---

## Suggested Skills

- `/handoff` — เมื่อจบ session ถัดไป บันทึกต่อที่ไฟล์นี้
- `js_refer/col_formula.md` — reference ถ้า session ถัดไปเกี่ยวกับ formula
- ตรวจสอบ P4_LEVEL_IDS ว่าถูกต้อง (ยืนยันจาก `operator_nodes.json` BACKWASHING P#4 No.2-14)

---

## Session เพิ่มเติม — Daily Report AquaDAT Integration & Query Modal (2026-07-20)

### ภาพรวม

Session นี้ผูก Daily Report เข้ากับ AquaDAT จริง (Stage 1) ด้วยการดึงข้อมูลแบบ serial พร้อม SSE progress popup และ RAM cache รองรับ re-query ต่อ station

---

### สถาปัตยกรรมใหม่ — Daily Report Data Flow

```
กด QUERY DATA → popup เปิดทันที (ไม่ fetch)
    ↓
กด "▶ All Query" → fetch serial ทีละ pattern ผ่าน SSE
    ↓
backend เก็บ historyMap ใน RAM (historyCache[date])
    ↓
computeDailyReport(date, settings, historyMap) คำนวณจาก RAM
    ↓
frontend รับ report object → แสดงผล
```

---

### ไฟล์ที่เปลี่ยน (Session นี้)

| ไฟล์ | การเปลี่ยน |
|------|-----------|
| `server/services/aquadatHistory.js` | เพิ่ม `DAILY_REPORT_ENTRIES`, `fetchDailyReportHistory`, export `fetchOnePattern` |
| `server/routes/dailyReport.js` | เพิ่ม `historyCache` (RAM), `/stream` SSE, `/stream-station` SSE, `/debug` (temp) |
| `server/services/dailyReport.js` | แก้ cfgIds sludge, CWT level, energy; เพิ่ม `getDayDeltaSum`/`DDS`; แก้ `peakOffPeak` |
| `client/src/pages/OpRecord.jsx` | เปลี่ยน QUERY → modal; เพิ่ม `handleAllQuery`, `handleReQuery`, `runStream` |
| `client/src/api.js` | export `BASE` สำหรับใช้ใน fetch call ตรง |
| `client/vite.config.js` | เพิ่ม SSE proxy config (disable buffering) |

---

### Curated Patterns สำหรับ Daily Report

ไม่ดึง ALL patterns ของแต่ละ station — ใช้เฉพาะ pattern ที่คัดมาแล้ว:

```js
// server/services/aquadatHistory.js
const DAILY_REPORT_ENTRIES = [
  { sid: 'RWS1',  patterns: [111] },
  { sid: 'RWS2',  patterns: [112] },
  { sid: 'CHEM1', patterns: [113] },
  { sid: 'CHEM2', patterns: [114] },
  { sid: 'FWS1',  patterns: [109, 1] },   // 109=main, 1=energy RMU301A/302A
  { sid: 'FWS2',  patterns: [110, 28] },  // 110=main, 28=energy RMU301B/302B
  { sid: 'TPS',   patterns: [116, 255] }, // 116=flow/service, 255=SS1B+SS3 energy
  { sid: 'DPS',   patterns: [115] },
  { sid: 'CWS1',  patterns: [3] },
  { sid: 'CWS2',  patterns: [14] },
];
```

Pattern ดึง **serial ทีละ pattern** ไม่มี parallel — เหตุผล: AquaDAT timeout เมื่อ concurrent requests มากเกินไป (ยืนยันจาก log: มีแค่ pattern 348 ที่รอดเมื่อ parallel 40+ requests)

---

### RAM Cache ใน Backend

```js
// server/routes/dailyReport.js
const historyCache = {}; // { [date]: { [stationId]: { [cfgId]: { [slot]: value } } } }

// /stream → เก็บทุก station
Object.assign(historyCache[date], result);

// /stream-station → อัปเดต station เดียว
historyCache[date][station] = out;

// GET / → ใช้ cache ถ้ามี
computeDailyReport(date, loadSettings(), historyCache[date] || null);
```

Cache ไม่มี TTL — clear เมื่อ server restart หรือ fetch ใหม่ทับ

---

### SSE Streaming ผ่าน Vite Proxy

EventSource (`new EventSource(...)`) **ไม่ทำงาน** ผ่าน Vite dev proxy — เปลี่ยนเป็น `fetch` + `ReadableStream` แทน:

```js
const resp = await fetch(`${BASE}/api/daily-report/stream?date=${selectedDate}`, {
  credentials: 'include',
  headers: { Accept: 'text/event-stream' },
});
const reader = resp.body.getReader();
// อ่าน chunk → split '\n\n' → parse JSON
```

Production (`BASE = '/labventure'`): SSE ผ่าน BellBeast proxy ทำงานได้ปกติ

---

### Query Modal UI

```
┌─────────────────────────────────────────┐
│ ดึงข้อมูล AquaDAT  2026-07-18  [▶ All Query] │
├─────────────────────────────────────────┤
│ ○  RWS1    0 values           [re-query] │
│ ✅ RWS2    396 values         [re-query] │
│ ❌ CHEM1   0 values           [re-query] │
│ ...                                      │
├─────────────────────────────────────────┤
│                              [  ปิด   ] │
└─────────────────────────────────────────┘
```

- QUERY DATA → เปิด modal ทันที, stations เป็น `○ pending`
- **▶ All Query** → เริ่ม SSE stream, update status realtime
- **re-query** → `/stream-station?station=SID` → fetch station เดียว, recompute

---

### cfgIds ที่ใช้ใน computeDailyReport

| Card | ค่า | Station | cfgId | วิธีคำนวณ |
|------|-----|---------|-------|-----------|
| Card 1 | RW Phase 1 | RWS1 | 4 | `getDayDelta × 100` |
| Card 1 | RW Phase 2 | RWS1 | 7 | `getDayDelta × 100` |
| Card 1 | RW Phase 3 | RWS2 | 42 | `getDayDelta × 100` |
| Card 1 | RW Phase 4 | RWS2 | 44 | `getDayDelta × 100` |
| Card 2 | CWT Level @24:00 | DPS | 876 | `V(24:00) × 0.01` (cm→m) |
| Card 2 | CWT min/max | DPS | 876 | `getMinMax × 0.01` |
| Card 2 | RW Basin min/max | RWS1 | 9 | `getMinMax` |
| Card 3 | DPS Line A | DPS | 873 | `V(24:00) × 100` |
| Card 3 | DPS Line B | DPS | 875 | `V(24:00) × 100` |
| Card 3 | TPS | TPS | 759 | `V(24:00) × 100` |
| Card 4 | DPS pressure min/max | DPS | 878 | `getMinMax` |
| Card 4 | TPS pressure min/max | TPS | 809 | `getMinMax` |
| Card 11 | Sludge P1 | CWS1 | 205, 217 | `V(24:00)` sum |
| Card 11 | Sludge P2 | CWS1 | 229, 242 | `V(24:00)` sum |
| Card 11 | Sludge P3 | CWS2 | 6001, 6002 | `V(24:00)` sum |
| Card 11 | Sludge P4 | CWS2 | 6003, 6004 | `V(24:00)` sum |
| Card 12 | SS1A DPS | DPS | 883, 885 | `getDayDeltaSum × 0.001` (kWh→MWh) |
| Card 12 | SS1B TPS | TPS | 9278, 9277 | `getDayDeltaSum` (MWh, pattern 255) |
| Card 12 | SS3A WS1 | FWS1 | 9273, 9274 | `getDayDeltaSum` (pattern 1) |
| Card 12 | SS3B WS2 | FWS2 | 9276, 9275 | `getDayDeltaSum` (pattern 28) |
| Card 12 | SS2A RW1 | RWS1 | 33, 35 | `getDayDeltaSum` |
| Card 12 | SS2B RW2 | RWS2 | 75, 77 | `getDayDeltaSum` |
| Card 12 | SS3 Bldg | TPS | 9775, 9776 | `getDayDeltaSum` (pattern 255) |
| Summary | Service Water | TPS | 6534 | `getDayDelta` |

---

### getDayDelta vs getDelta (Critical Gotcha)

`getValueAt(cfgId, station, **date**, time, historyMap)` — historyMap lookup **ไม่ใช้ `date`** เป็น key!

ดังนั้น `getDelta` ที่เรียก `getValueAt(..., nextDate, '00:00', historyMap)` จะได้ค่าเดียวกับ `getValueAt(..., date, '00:00', historyMap)` → delta = 0 เสมอ

**กฎ: ถ้าข้อมูลมาจาก historyMap (AquaDAT) ต้องใช้ `getDayDelta` หรือ `getDayDeltaSum` เท่านั้น**  
`getDelta` / `getDeltaSum` ใช้ได้เฉพาะ SQLite (Stage 2) ที่มี `date` แยกจริง

---

### Gotcha Session นี้

| # | เรื่อง | รายละเอียด |
|---|--------|-----------|
| G1 | Parallel → AquaDAT timeout | 40+ concurrent requests ทำให้ทุก pattern timeout ยกเว้นอันแรก — แก้: serial ทีละ pattern |
| G2 | EventSource ผ่าน Vite proxy | EventSource ไม่ทำงานผ่าน Vite http-proxy — แก้: fetch + ReadableStream |
| G3 | Production prefix `/labventure` | fetch ต้องใช้ `${BASE}/api/...` ใน production (BellBeast proxy) |
| G4 | historyMap ไม่ใช้ date เป็น key | getDelta กับ historyMap ให้ delta=0 เสมอ — ต้องใช้ getDayDelta แทน |
| G5 | DPS energy unit kWh ≠ MWh | cfgId 883, 885 เก็บเป็น kWh ทั้งที่ node config บอก MWh — ต้องหาร 1000 |
| G6 | CWT level cfgId 8469 ไม่อยู่ใน pattern 115 | ต้องใช้ cfgId 876 (SUCTION LEVEL, unit cm, ×0.01 = m) |
