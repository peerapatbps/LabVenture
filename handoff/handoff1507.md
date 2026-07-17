# Handoff — 15 July 2026

## Project
**LabVenture AquaDAT Operator Recorder — Stage Workflow & History Fix**
Stack: React 18 (Vite) · Node/Express (port 3001) · BellBeast ASP.NET (port 443, HTTP)

Working directories:
- LabVenture: `C:\Users\peera\OneDrive\Desktop\LabVenture`
- Client: `C:\Users\peera\OneDrive\Desktop\LabVenture\client`
- Server: `C:\Users\peera\OneDrive\Desktop\LabVenture\server`

Build: `cd client && npm run build` → BellBeast serve `client/dist` อัตโนมัติ (ไม่ต้อง restart BellBeast)
Server restart: ต้องทำทุกครั้งที่แก้ไฟล์ใน `server/`
URL ทดสอบ: `http://localhost:443/labventure/op-record?station=RWS1`

---

## Context — Session นี้แก้อะไร

Session นี้ debug และแก้ **stage-aware history workflow** ที่ค้างจาก handoff1407.md ซึ่ง focus ไปที่ UI ของ RecordingTable แต่ยังไม่ได้ wire data flow จาก Aquadat/Uroboros จริงๆ

**อาการที่พบ**: เปิดหน้า `/op-record?station=RWS1` แล้วตาราง history ว่างเปล่าเสมอ แม้ stage=1 และ Aquadat online

Architecture reference: `handoff/plan.md` (stage machine, data flow, IotRoom protocol)

---

## Bug ที่พบและวิธีแก้

### Bug 1 — Side effects ใน `setStage()` callback (React correctness)
**ไฟล์**: `client/src/pages/OpRecord.jsx` บรรทัดเดิม ~1850

**ปัญหา**: `handleDateChange()`, `qc.invalidateQueries()`, และ `prevStageRef.current = s` ถูกเรียกอยู่ **ภายใน** state updater function ของ `setStage()` — React อาจ invoke updater หลายครั้ง (Strict Mode) ทำให้ side effects ไม่ deterministic

**แก้**: ย้าย side effects ออกมาทำงาน **ก่อน** `setStage(s)` โดยใช้ `prevStageRef.current` ที่ update ทันที แทนการ capture ด้วย `prev` ใน callback

```js
// ก่อน (ผิด)
setStage(prev => {
  if (s === 0 && selectedDate !== today) handleDateChange(today);  // side effect ใน updater!
  qc.invalidateQueries(...);
  prevStageRef.current = s;
  return s;
});

// หลัง (ถูก)
const prev = prevStageRef.current;
if (s === 0 && selectedDate !== today) handleDateChange(today);
if (prev !== 0 && s === 0) qc.invalidateQueries({ queryKey: ['me'] });
if (s !== 1) hadNonNormalStageRef.current = true;
if (s === 1 && hadNonNormalStageRef.current) { hadNonNormalStageRef.current = false; setShowLoginOverlay(true); }
prevStageRef.current = s;
setStage(s);
```

---

### Bug 2 — Client ตัดสิน endpoint เองตาม stage (race condition)
**ไฟล์**: `client/src/pages/OpRecord.jsx`

**ปัญหา**: มี 2 effects แยกกัน:
- stage===1 → `POST /api/operator/graphql-proxy` (ไป Aquadat)
- stage===0 → `GET /api/operator/history` (ไป Uroboros)

เมื่อ component mount ค่า `stage` เป็น `1` เสมอ (useState default) แม้ server จะรู้ว่า stage=0 อยู่แล้ว เพราะ polling ยังไม่ return — ทำให้ stage=0 จะ query Aquadat ก่อนเสมอ

**แก้**: รวมเป็น effect เดียว เรียก `GET /api/operator/history` เสมอ ปล่อยให้ **server** ตัดสินใจตาม `getStage()` ฝั่ง server

```js
// หลัง — effect เดียว, ไม่ depend on stage
useEffect(() => {
  if (!activeStation) return;
  setHistoryLoading(true);
  const qs = new URLSearchParams({ station_id: activeStation, date: selectedDate });
  get(`/api/operator/history?${qs}`)
    .then(data => { if (data && typeof data === 'object') setHistory(data); })
    .catch(e => console.warn('[history]', activeStation, e.message))
    .finally(() => setHistoryLoading(false));
}, [activeStation, selectedDate]);  // ไม่ต้องมี stage, activeTopic
```

Side effect เพิ่ม: ลบ `aqPatterns` state และ `GET /api/operator/patterns` fetch ออกทั้งหมด (ไม่ใช้แล้ว)

---

### Bug 3 — `var_data` parse error ใน `fetchOnePattern()` (root cause ที่ทำให้ได้ `{}`)
**ไฟล์**: `server/routes/operator.js` ฟังก์ชัน `fetchOnePattern()`

**ปัญหา**: Aquadat ส่ง `var_data` เป็น array elements **ไม่มี `[]` ครอบ** เช่น:
```
{...},{...},{...}
```
แต่โค้ดเดิมใช้ `JSON.parse(row.var_data)` ตรงๆ → parse fail → `catch { continue }` → ข้ามทุก row → คืน `{}`

Client เดิม (ก่อน refactor) แก้ด้วย `JSON.parse('[' + row.var_data + ']')` แต่โค้ดฝั่ง server ไม่ได้ทำตาม

**แก้**: ใช้ pattern เดียวกับ client เดิม + handle nested arrays:

```js
// ก่อน (ผิด)
let items;
try { items = JSON.parse(row.var_data); } catch { continue; }
if (!Array.isArray(items)) continue;
for (const item of items) { ... }

// หลัง (ถูก)
let outerArr;
try { outerArr = JSON.parse('[' + row.var_data + ']'); } catch { continue; }
if (!Array.isArray(outerArr)) continue;
for (const slotArr of outerArr) {
  const items = Array.isArray(slotArr) ? slotArr : [slotArr];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.bgColor === 'time_series' || !item._id || !item._time) continue;
    const val = item.value;
    if (val == null || val === '') continue;
    if (typeof val === 'string' && val.startsWith('=')) continue;
    ...
  }
}
```

---

### Bug 4 — Topic name mismatch ระหว่าง `operator_nodes.json` กับ `aquadat_patterns.json` (root cause ของ `{}` ใน stage 1)
**ไฟล์**: `server/config/aquadat_patterns.json` vs `server/config/operator_nodes.json`

**ปัญหา**: ชื่อ topic ทั้งสองไฟล์ไม่ตรงกัน:

| operator_nodes.json (UI topic) | aquadat_patterns.json (Aquadat pattern) |
|---|---|
| `"FLOW RPS1"` | `"Flow"` |
| `"CURRENT TEMP"` | `"Temperature"` |
| `"POWER / SPEED / BATTERY"` | `"Power"` |
| `"PUMP STATUS"` | `"Status"` |
| `"COMPENSATE"` | `"Compensate"` |
| `"FEEDER 5&6"` | `"Energy Feeder"` |

`fetchAquadatHistory()` filter ด้วย `p.topic === topic_filter` → ไม่เจอ → คืน `{}`

**แก้**: เปลี่ยน client ให้ส่ง **ไม่มี `topic` filter** — fetch ทุก pattern ของ station ครั้งเดียว server loop ทุก pattern แล้วคืน map ตาม `configparam_id` ทั้งหมด client ใช้ข้อมูลตาม `configparam_id` ที่แต่ละ topic รู้จักอยู่แล้ว

ผลพลอยได้: topic switching เป็น instant เพราะข้อมูลโหลดมาครั้งเดียวต่อ station+date

---

## Scenario Flow หลัง Fix

### Stage 1 (Aquadat ปกติ)
```
Client → GET /api/operator/history?station_id=RWS1&date=2026-07-15
Server  → getStage() = 1
        → fetchAquadatHistory(station_id, null, date, token)
        → loop ALL patterns ใน aquadat_patterns.json[station_id]
        → fetchOnePattern() → HTTPS aquadat.mwa.co.th/graphql
        → parse var_data ด้วย '[' + var_data + ']'
        → return { [configparam_id]: { "HH:mm": value } }

Client → POST /api/operator/record
Server  → getStage() = 1
        → writeData(token, records) → HTTPS Aquadat GraphQL
```

### Stage 0 (Aquadat ล่ม)
```
Client → GET /api/operator/history?station_id=RWS1&date=2026-07-15
Server  → getStage() = 0
        → fetchUroborosHistory(configIds ทุก topic ของ station)
        → HTTP BellBeast:443/api/operator/data?configIDs=...
        → BellBeast proxy → Uroboros:8888
        → return rows จาก AQ_readings_narrow_v2 (synced=0)

Client → POST /api/operator/record
Server  → getStage() = 0
        → forwardToUroboros() → BellBeast:443/api/operator/record
        → Uroboros → INSERT synced=0
```

### Stage 2 (กำลัง sync)
```
READ  → เหมือน Stage 0 (ดึงจาก Uroboros)
WRITE → 503 "กำลัง sync ข้อมูล" (ห้ามบันทึก)
```

---

## สิ่งที่ต้อง Deploy หลัง Session นี้

| Action | เหตุผล |
|---|---|
| Restart LabVenture Node server | `server/routes/operator.js` เปลี่ยน (fetchOnePattern fix) |
| `cd client && npm run build` | `client/src/pages/OpRecord.jsx` เปลี่ยน (3 bugs) |
| Hard refresh browser `Ctrl+Shift+R` | bundle hash เปลี่ยนทุก build |

---

## การ Scale ไปยัง Station อื่น (Op Record Pages)

### สิ่งที่ **ไม่ต้องแก้** สำหรับ station ใหม่
- `client/src/pages/OpRecord.jsx` — data flow ทุกอย่าง driven จาก config 100%
- `server/routes/operator.js` history/record routing — stage-aware อยู่แล้ว

### สิ่งที่ **ต้องตรวจ/เพิ่ม** สำหรับ station ใหม่

#### 1. `server/config/operator_nodes.json`
ตรวจว่า station นั้นมี topics และ params ครบ:
```json
{
  "id": "RWS2",
  "label": "สถานีน้ำดิบ 2",
  "trans_type": "RWS",
  "plant_id": 2,
  "topics": [
    {
      "topic": "FLOW RPS2",
      "time_slot": 13,
      "params": [
        { "configparam_id": <ID>, "equipment_name": "...", "param_name": "...", "unit": "...", "type": "FLOAT(2)" }
      ]
    }
  ]
}
```
ถ้า params ขาด → อ่าน `record_opt.xlsx` ด้วย `/xlsx` skill แล้ว map

#### 2. `server/config/aquadat_patterns.json`
ตรวจว่า station มี pattern_id ครบ — ไฟล์นี้ map **สำหรับ stage 1 fetch จาก Aquadat เท่านั้น**
topic name ใน aquadat_patterns.json **ไม่จำเป็นต้องตรงกับ** operator_nodes.json อีกต่อไป (เพราะ fetch ทุก pattern แล้ว filter ด้วย configparam_id)
```json
"RWS2": [
  { "topic": "Flow",        "pattern_id": 349 },
  { "topic": "Status",      "pattern_id": 124 },
  ...
]
```

#### 3. Uroboros `operator_configids.json` (Stage 0 path)
ตรวจว่า configparam_id ของ station ใหม่ทุกตัวอยู่ในไฟล์ `Uroboros/operator_configids.json`
ถ้าไม่มี → เพิ่ม + republish Uroboros

#### 4. ทดสอบ
```
http://localhost:443/labventure/op-record?station=RWS2
```
- Network tab: `GET /api/operator/history?station_id=RWS2&date=...` ต้องคืน object ไม่ใช่ `{}`
- ตารางต้องมีข้อมูลจาก Aquadat (stage 1) หรือ Uroboros (stage 0)
- บันทึกค่าแล้ว POST ต้องไม่ error

---

## Files ที่แก้ใน Session นี้

| File | การเปลี่ยนแปลง |
|---|---|
| `client/src/pages/OpRecord.jsx` | แก้ side effects ใน setStage, รวม history effects เป็นเดียว, ลบ aqPatterns state+fetch |
| `server/routes/operator.js` | `fetchOnePattern()`: แก้ var_data parse ด้วย `'['+var_data+']'`, handle nested arrays, skip formula values |

---

## Previous Handoffs

- `handoff/handoff1407.md` — RecordingTable Excel UI (copy/paste, keyboard nav, formatting)
- `handoff/handoff1207.md` — Stage 0 offline history fetch (Uroboros integration)
- `handoff/plan.md` — stage machine architecture, IotRoom protocol, SQLite schema

---

## Suggested Skills

- `/xlsx` — อ่าน `record_opt.xlsx` เพื่อ map columns → `operator_nodes.json` params สำหรับ station ที่ยังขาด
- `/handoff` — เมื่อ session ถัดไปเสร็จ
- `/code-review` — ตรวจ operator.js หลังเพิ่ม station ใหม่
- `/verify` — รัน verify flow หลัง deploy
