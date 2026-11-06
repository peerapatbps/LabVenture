# Plan: OpDashboard Progress Cross-Check (เชื่อม op-record → op-dashboard)

## Context

`/labventure/op-dashboard` ยังไม่มีการ cross-check ข้อมูลจริง — timeline dots แสดงสีตาม wall-clock เท่านั้น (`isActive` always false) ไม่มี progress bar และ `OpTodoPanel` เป็น stub คืน `[]` เสมอ

เป้าหมาย: ให้ op-dashboard ทำงานเหมือนกับ dashboard↔record — ดึงข้อมูลที่บันทึกจาก Uroboros (`AQ_readings_operator_v1`) มาเปรียบเทียบกับ config ที่คาดหวัง → แสดงผล dot สี/progress bar/todo เหมือนกัน

---

## Concept Design

### ภาพรวมระบบ

```
┌─────────────────────────────────────────────────────────┐
│                     Uroboros (port 443)                 │
│  AQ_readings_operator_v1   AQ_readings_narrow_v2        │
│  (operator-entered)        (auto sensor)                │
└──────────────────────┬──────────────────────────────────┘
                       │  GET /api/operator/data
                       │  ?configIDs=...&date=...
                       ▼
┌─────────────────────────────────────────────────────────┐
│              LabVenture Server (port 3001)               │
│                                                         │
│  operator.js module load                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │  refreshProgressCache()  ← ทันที + ทุก 5 นาที  │   │
│  │                                                 │   │
│  │  1. อ่าน operator_nodes.json (config)           │   │
│  │  2. รวบ configparam_id ทั้งหมด (!formula)       │   │
│  │  3. fetchUroborosHistory(allIds, today)          │   │
│  │  4. buildProgressData(nodes, rows, today)        │   │
│  │  5. เก็บผลใน _progressCache (in-memory)         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  GET /api/operator/progress?date=  ← คืน cache ทันที  │
│  GET /api/operator/todos           ← derive จาก cache  │
└──────────────────────┬──────────────────────────────────┘
                       │  poll ทุก 5 นาที (today only)
                       ▼
┌─────────────────────────────────────────────────────────┐
│           Client — OpDashboard.jsx                      │
│                                                         │
│  useQuery(['op-progress', date])                        │
│    → progressData.stations[].slotSummary                │
│                                                         │
│  progressByStation = { station_id → stationProgress }  │
│                                                         │
│  StationRow ← stationProgress prop                      │
│    getDotStatus(displaySlot)                            │
│      window [H-1:00 … H+1:00] → keys in slotSummary    │
│      done → green | partial → amber                     │
│      missed → red | future → gray | empty → faded       │
│                                                         │
│  Progress Bar:  totalRecorded / totalExpected           │
│  Station Badge: stRec / stExp (per station)             │
│  OpTodoPanel:   /api/operator/todos → station list     │
└─────────────────────────────────────────────────────────┘
```

### กฎการนับ "expected" vs "recorded"

```
operator_nodes.json
  station.topics[]
    topic.time_slot: 13  →  slotsForTopic()  →  ['00:00','02:00',...,'24:00']
    topic.params[].formula  →  ข้าม (computed ไม่ใช่ user-entered)
    topic.params[].configparam_id  →  inputParams

per slot:
  done    = inputParams.every(p → recorded[p.id].has(slot))
  partial = inputParams.some(p → recorded[p.id].has(slot))
  missed  = !done && !partial && slot ผ่านไปแล้ว (nowH > H+1)
  future  = !done && !partial && slot ยังไม่ถึง
```

### Dot window mapping

Display slots (SLOTS_2H) เป็น odd-hours: `01:00, 03:00, ..., 23:00`  
แต่ละ dot ครอบคลุม window ±1h → map กับ expected slots (even-hours):

```
display 01:00  →  window 00:00–02:00  →  expected slots: 00:00, 02:00
display 03:00  →  window 02:00–04:00  →  expected slots: 02:00, 04:00
...
display 23:00  →  window 22:00–24:00  →  expected slots: 22:00, 24:00
```

### Caching strategy

| ระดับ | กลไก | TTL |
|---|---|---|
| Server ← Uroboros | `setInterval` polling | 5 นาที |
| Server memory | `_progressCache` + `_progressDate` | ถึง poll รอบถัดไป |
| Client ← Server | React Query `refetchInterval` | 5 นาที (today only) |
| Historical date | on-demand, ไม่ cache | — |

Server restart → cache หาย → `refreshProgressCache()` ทำงานทันทีที่ module load → พร้อมใน ~1–2s

---

## ข้อมูลสำคัญ

### operator_nodes.json
- `time_slot: 13` = 13 slots ทุก 2h: `00:00, 02:00, 04:00 ... 24:00`
- `time_slot: 25` = 25 slots ทุก 1h
- `formula` param = computed ไม่ใช่ user-entered → **ต้อง skip** ใน progress count
- Path: `server/config/operator_nodes.json`

### Uroboros connection
- `fetchUroborosHistory(configIds, date)` มีอยู่แล้วที่ `server/routes/operator.js:42`
- เรียก `GET BELLBEAST_HOST:BELLBEAST_PORT/api/operator/data?configIDs=...&date=...`
- คืน `[{ configID, ts, value, value_text }]` — `ts` = `"YYYY-MM-DD HH:mm:ss"`
- `24:00` slot: Uroboros เก็บเป็น `00:00` ของวันเดิม (second midnight) → ต้อง promote ด้วย `seenMidnight` logic เหมือน `/history` route

### Reference Pattern (Dashboard ↔ Record)
- `GET /api/progress/nodes-today?date=` → `server/routes/progress.js` → queries `node_records` SQLite
- `buildNodeDots()` จัด slot → green/red/amber/future
- Dashboard refetch ทุก 60s เมื่อ view today

### Architecture การ refresh (ตัดสินใจแล้ว)
- **Server:** LabVenture poll Uroboros ทุก **5 นาที** → cache ไว้ใน memory
- **Client:** poll LabVenture ทุก **5 นาที** → ได้ cached result ทันที

---

## Files ที่ต้องแก้

| File | การเปลี่ยนแปลง |
|---|---|
| `server/routes/operator.js` | เพิ่ม helpers + polling cache + route `/progress` + แก้ `/todos` |
| `client/src/pages/OpDashboard.jsx` | เพิ่ม useQuery progress + แก้ getDotStatus + progress bar + todo fix |

---

## Implementation Steps

### 1. `server/routes/operator.js` — เพิ่ม helpers (ก่อน route definitions)

```js
// Thai date string helper (เหมือน progress.js:18)
function thaiDateStr() {
  return new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];
}

// แปลง topic → expected slots array
function slotsForTopic(topic) {
  if (Array.isArray(topic.time_slots) && topic.time_slots.length > 0) return topic.time_slots;
  const count = topic.time_slot ?? 0;
  return Array.from({ length: count }, (_, i) => {
    const h = Math.round((i * 24) / Math.max(count - 1, 1));
    return `${String(h).padStart(2,'0')}:00`;
  });
}

// คำนวณ progress จาก config + Uroboros rows
function buildProgressData(nodes, rows, date) {
  // Index recorded: { configID_str → Set<slot> }
  const recorded = {};
  const seenMid = {};
  const sorted = [...(rows || [])].sort((a, b) => (a.ts ?? '') < (b.ts ?? '') ? -1 : 1);
  for (const r of sorted) {
    const cid = String(r.configID ?? '');
    const tsTime = (r.ts ?? '').slice(11, 16);
    let slot = tsTime;
    if (tsTime === '00:00') { if (seenMid[cid]) slot = '24:00'; else seenMid[cid] = true; }
    if (!cid || !slot) continue;
    if (!recorded[cid]) recorded[cid] = new Set();
    recorded[cid].add(slot);
  }

  let totalExpected = 0, totalRecorded = 0;
  const stations = [];
  for (const station of (nodes.stations ?? [])) {
    let stExp = 0, stRec = 0;
    const slotSummary = {};
    for (const topic of (station.topics ?? [])) {
      const slots = slotsForTopic(topic);
      const inputParams = (topic.params ?? []).filter(p => p.configparam_id && !p.formula);
      if (inputParams.length === 0) continue;
      for (const slot of slots) {
        stExp++;
        const done = inputParams.every(p => recorded[String(p.configparam_id)]?.has(slot));
        const partial = !done && inputParams.some(p => recorded[String(p.configparam_id)]?.has(slot));
        if (done) stRec++;
        if (!slotSummary[slot]) slotSummary[slot] = { done: false, partial: false, count: 0 };
        const s = slotSummary[slot];
        s.count++;
        if (done) s.done = true;
        if (partial) s.partial = true;
      }
    }
    totalExpected += stExp;
    totalRecorded += stRec;
    stations.push({ station_id: station.id, label: station.label,
      totalExpected: stExp, totalRecorded: stRec, slotSummary });
  }
  return { date, totalExpected, totalRecorded, stations };
}
```

### 2. Server-side polling cache (5-minute interval)

**Architecture:** LabVenture server เป็นฝั่ง active poller — ไม่ใช่ on-demand per request

```js
let _progressCache = null;   // cached result ล่าสุด
let _progressDate = null;    // date ที่ cache นี้เป็นของ

async function computeProgress(date) {
  const nodes = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
  const allIds = [];
  for (const st of (nodes.stations ?? []))
    for (const t of (st.topics ?? []))
      for (const p of (t.params ?? []))
        if (p.configparam_id && !p.formula) allIds.push(p.configparam_id);
  const rows = await fetchUroborosHistory([...new Set(allIds)], date);
  return buildProgressData(nodes, Array.isArray(rows) ? rows : [], date);
}

// เรียกตอน server start ครั้งแรก และทุก 5 นาที
async function refreshProgressCache() {
  try {
    const today = thaiDateStr();
    _progressCache = await computeProgress(today);
    _progressDate = today;
    console.log(`[op-progress] refreshed — ${_progressCache.totalRecorded}/${_progressCache.totalExpected}`);
  } catch (e) {
    console.warn('[op-progress] refresh failed:', e.message);
  }
}

// เริ่ม polling ทันทีที่ module โหลด
refreshProgressCache();
setInterval(refreshProgressCache, 5 * 60 * 1000);  // ทุก 5 นาที
```

> `setInterval` อยู่ใน module scope ของ `operator.js` — เริ่มทำงานพร้อม `require()` ใน `server/index.js`

### 3. เพิ่ม route `GET /api/operator/progress`

คืน cache ทันที (ไม่ call Uroboros ต่อ request):

```js
router.get('/progress', (req, res) => {
  // ถ้าเป็น today คืน cache, ถ้าเป็น historical คำนวณ on-demand (ไม่ cache)
  const date = req.query.date || thaiDateStr();
  if (date === _progressDate && _progressCache) return res.json(_progressCache);
  computeProgress(date).then(r => res.json(r)).catch(e => res.status(500).json({ error: e.message }));
});
```

### 4. แก้ `/todos` stub → ใช้ cache เดียวกัน

```js
router.get('/todos', (req, res) => {
  const progress = _progressCache;
  if (!progress) return res.json({ todos: [] });
  const todos = (progress.stations ?? [])
    .filter(s => s.totalExpected > 0 && s.totalRecorded < s.totalExpected)
    .map(s => ({ station_id: s.station_id, label: s.label,
      message: `ยังไม่ได้บันทึก ${s.totalExpected - s.totalRecorded} ช่วงเวลา`,
      pending: s.totalExpected - s.totalRecorded }));
  res.json({ todos });
});
```

---

### 5. `client/src/pages/OpDashboard.jsx` — เพิ่ม useQuery

Client poll ทุก 5 นาที (สอดคล้องกับ server-side cache interval):

```js
const isToday = selectedDate === today;

const { data: progressData } = useQuery({
  queryKey: ['op-progress', selectedDate],
  queryFn: () => get(`/api/operator/progress?date=${selectedDate}`),
  refetchInterval: isToday ? 5 * 60 * 1000 : false,   // 5 นาที เฉพาะ today
  staleTime: isToday ? 4.5 * 60 * 1000 : 300000,
});

const progressByStation = useMemo(() => {
  const map = {};
  for (const st of (progressData?.stations ?? []))
    map[st.station_id] = st;
  return map;
}, [progressData]);
```

### 6. แก้ `StationRow` — `getDotStatus` ใช้ข้อมูลจริง

`StationRow` รับ prop `stationProgress` เพิ่มเติม:

```js
// DISPLAY_SLOTS = ['01:00','03:00','05:00',...,'23:00']  (เหมือนเดิม)
function getDotStatus(displaySlot, stationProgress, selectedDate, today) {
  const summary = stationProgress?.slotSummary ?? {};
  const dH = parseInt(displaySlot, 10);  // 1,3,5...23
  const windowStart = `${String(dH - 1).padStart(2,'0')}:00`;
  const windowEnd   = `${String(dH + 1).padStart(2,'0')}:00`;
  const keys = Object.keys(summary).filter(s => s >= windowStart && s <= windowEnd);

  if (keys.length === 0) return { status: 'empty' };
  const allDone   = keys.every(k => summary[k]?.done);
  const anyDone   = keys.some(k => summary[k]?.done);
  const nowH = selectedDate === today
    ? new Date(Date.now() + 7*3600000).getUTCHours() : 99;
  const isPast = dH + 1 <= nowH;

  if (allDone)   return { status: 'done' };     // green
  if (anyDone)   return { status: 'partial' };  // amber
  if (isPast)    return { status: 'missed' };   // red
  return { status: 'future' };                   // gray
}
```

**`StationDot` สี mapping:**

| status | class |
|---|---|
| `done` | `bg-green-500` |
| `partial` | `bg-amber-400` |
| `missed` | `bg-red-400 border border-red-600` |
| `future` | `bg-earth-border` |
| `empty` | `bg-earth-DEFAULT opacity-30` |

### 7. เพิ่ม Progress Bar ใน OpDashboard left column

```jsx
{progressData && (
  <div className="mb-3 px-1">
    <div className="flex justify-between text-xs text-earth-ink3 mb-1">
      <span>ความคืบหน้าวันนี้</span>
      <span className="font-mono font-semibold text-earth-ink">
        {progressData.totalRecorded} / {progressData.totalExpected}
      </span>
    </div>
    <div className="h-2 rounded-full bg-earth-border overflow-hidden">
      <div className="h-full rounded-full bg-green-500 transition-all duration-500"
        style={{ width: `${progressData.totalExpected > 0
          ? Math.round(progressData.totalRecorded / progressData.totalExpected * 100) : 0}%` }} />
    </div>
  </div>
)}
```

### 8. แก้ `OpTodoPanel` query key

```js
queryKey: ['op-todos', selectedDate],
refetchInterval: selectedDate === today ? 5 * 60 * 1000 : false,
```

### 9. ลบ `ACTIVE_STATIONS` gate สำหรับ timeline

เปลี่ยนจาก `ACTIVE_STATIONS.has(station.id)` เป็น:

```js
const showTimeline = (progressByStation[station.id]?.totalExpected ?? 0) > 0;
```

Stations ที่ไม่มี config params ยังแสดง "เร็วๆ นี้" เหมือนเดิม

---

## Response Shape — `/api/operator/progress`

```json
{
  "date": "2026-07-24",
  "totalExpected": 312,
  "totalRecorded": 198,
  "stations": [
    {
      "station_id": "RWS1",
      "label": "สถานีน้ำดิบ 1",
      "totalExpected": 91,
      "totalRecorded": 78,
      "slotSummary": {
        "00:00": { "done": true,  "partial": false, "count": 3 },
        "02:00": { "done": true,  "partial": false, "count": 3 },
        "04:00": { "done": false, "partial": true,  "count": 3 },
        "06:00": { "done": false, "partial": false, "count": 3 }
      }
    }
  ]
}
```

---

## Verification

1. `curl "http://localhost:443/api/operator/progress?date=YYYY-MM-DD"` → `totalExpected > 0`, stations ถูกต้อง
2. `curl "http://localhost:443/api/operator/todos"` → todos array ไม่ใช่ `[]`
3. Server log แสดง `[op-progress] refreshed — X/Y` ทุก 5 นาที
4. เปิด `/labventure/op-dashboard` เลือกวันที่มีข้อมูล → dots บันทึกแล้ว = green, ผ่านไปแล้วไม่บันทึก = red
5. Progress bar แสดง % ถูกต้อง อัปเดตเมื่อ client poll ใหม่
6. OpTodoPanel แสดงสถานีที่ค้างบันทึก
