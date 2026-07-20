# Handoff — Session 2007 (2026-07-20)

## Context
Project: **LabVenture** — AquaDAT Scientist Recorder  
Stack: React (Vite) client + Express server (port 3001) + SQLite, proxied behind BellBeast at port 443.  
Previous handoffs: `handoff/handoff1807.md`, `handoff/handoff1907.md`

---

## What Was Done This Session

### Goal
เพิ่มการ Query ข้อมูลสำหรับ **stage=0 (Offline/Uroboros mode)** ในหน้า DAILY tab (`/op-record?station=DAILY`)

ก่อนหน้านี้ปุ่ม **QUERY DATA** → popup → **▶ All Query** และ **re-query** รายสถานี ทำงานได้เฉพาะ stage=1 (AquaDAT connected) เท่านั้น

---

### Changes Made

#### 1. Server — `server/routes/dailyReport.js`

เพิ่ม 2 SSE endpoints ใหม่สำหรับ stage=0:

**`GET /api/daily-report/stream-stage0?date=YYYY-MM-DD`**  
- อ่าน `operator_nodes.json` ดึง configIds ของทุก station ทุก topic  
- วนลูปแต่ละ station → `fetchUroborosHistory(configIds)` → build historyMap  
- Stream `type:'step'` progress ทีละ station  
- สุดท้าย `computeDailyReport(date, settings, historyMap)` → stream `type:'done'`

**`GET /api/daily-report/stream-station-stage0?date=&station=`**  
- เหมือนกันแต่ทำเฉพาะ 1 station  
- Merge ผลเข้า `historyCache[date]` แล้ว recompute report  

ยังเพิ่ม helper ใน file เดียวกัน:
```js
const http = require('http');
const NODES_PATH = path.join(__dirname, '..', 'config', 'operator_nodes.json');
const BELLBEAST_HOST/PORT = ...
function fetchUroborosHistory(configIds) { ... } // dup จาก operator.js
```

#### 2. Client — `client/src/pages/OpRecord.jsx`

**`DailyReportTab` component** — เพิ่ม `stage` prop:
```jsx
// line 1553
function DailyReportTab({ selectedDate, stage }) { ... }

// line 2701
<DailyReportTab selectedDate={selectedDate} stage={stage} />
```

**`handleAllQuery`** — branch ตาม stage:
```js
const streamUrl = stage === 0
  ? `${BASE}/api/daily-report/stream-stage0?date=${selectedDate}`
  : `${BASE}/api/daily-report/stream?date=${selectedDate}`;
```

**`handleReQuery(sid)`** — branch ตาม stage:
```js
const url = stage === 0
  ? `${BASE}/api/daily-report/stream-station-stage0?date=${selectedDate}&station=${sid}`
  : `${BASE}/api/daily-report/stream-station?date=${selectedDate}&station=${sid}`;
```

---

## Problems & Gotchas

### 🔴 Gotcha #1: Vite Minifier + Cross-Component Scope

**อาการ**: กด All Query แล้วไม่มีอะไรเกิดขึ้น, ไม่มี network request, ไม่มี error บน console  
**Root cause**: `handleAllQuery` อยู่ใน `DailyReportTab` (sub-component ตั้งแต่ line 1553) แต่ `stage` state ถูก declare ใน main component (line 2314) — ดังนั้น `stage` ไม่อยู่ใน scope ของ DailyReportTab เลย

**วิธีตรวจพบ**: เรียก React fiber onClick ตรงๆ แล้ว catch error:
```js
const fk = Object.keys(btn).find(k => k.startsWith('__reactFiber'));
const onClick = btn[fk]?.memoizedProps?.onClick;
try { await onClick(); } catch(e) { console.log(e.message); }
// → "stage is not defined"
```

**Vite behavior**: ตัว minifier เห็น `stage` เป็น free variable (ไม่มีใน local scope) จึงไม่ rename และ runtime ก็ throw ReferenceError  
**แก้**: ส่ง `stage` เป็น prop ของ `DailyReportTab`

### 🟡 Gotcha #2: `button.click()` ไม่ trigger React synthetic event เสมอไป

**อาการ**: เรียก `button.click()` จาก JS console แต่ React handler ไม่ทำงาน  
**สาเหตุ**: React event delegation + timing issue เมื่อเรียกจากนอก React lifecycle  
**วิธีแก้ตอน test**: ดึง handler ผ่าน React fiber โดยตรง (`memoizedProps.onClick`)

### 🟡 Gotcha #3: Production ใช้ built dist files ไม่ใช่ Vite dev server

- Browser ที่ `localhost:443/labventure/` ใช้ไฟล์จาก `client/dist/`
- แก้โค้ด JS ต้อง `npm run build` ทุกครั้งถึงจะเห็นผล
- API path ใน production คือ `/labventure/api/...` (BASE = `/labventure`)
- `/api/...` ที่ port 443 → 404 (BellBeast ไม่รู้จัก) ต้องใช้ `/labventure/api/...`

### 🟡 Gotcha #4: stage=0 — `/api/operator/history` ไม่รับ `date` param

ใน stage=0 และ 2, history endpoint ดึงจาก Uroboros ซึ่งมีแค่ข้อมูลวันปัจจุบัน  
`date` param ถูก ignore — ต่างจาก stage=1 ที่ต้องการ `date` เพื่อ query AquaDAT

---

## Architecture Reference

```
Browser (port 443/labventure/)
  └─ React SPA (client/dist)
       ├─ /labventure/api/*  →  BellBeast proxy → LabVenture server (port 3001)
       └─ stage polling every 30s → GET /api/operator/stage

LabVenture Server (port 3001)
  ├─ stage=0: Uroboros mode  → fetchUroborosHistory() → port 443 /api/operator/data
  ├─ stage=1: AquaDAT mode   → fetchAquadatHistory() → GraphQL
  └─ stage=2: Syncing mode
```

**Key files:**
- `server/routes/dailyReport.js` — SSE stream endpoints (แก้ session นี้)
- `server/routes/operator.js` — history endpoint + fetchUroborosHistory (original)
- `server/services/dailyReport.js` — computeDailyReport logic
- `server/services/aquadatHistory.js` — fetchDailyReportHistory (stage=1)
- `client/src/pages/OpRecord.jsx` — main page (~2850 lines, DailyReportTab อยู่ line 1553)
- `server/config/operator_nodes.json` — station/topic/configparam definitions
- `server/config/aquadat_patterns.json` — AquaDAT pattern_ids สำหรับ stage=1

---

## Current State

- **All Query (stage=0)**: ✅ ทำงาน — `/stream-stage0` ดึง Uroboros ทุก station ได้ถูกต้อง (ทดสอบ: RWS1 = 74 values)
- **re-query per station (stage=0)**: ✅ โค้ดถูกต้อง (ยังไม่ได้ทดสอบแยก แต่ logic เหมือนกัน)
- **stage=1 behavior**: ✅ ไม่เปลี่ยน
- **Built & deployed**: ✅ `client/dist` อัปเดตแล้ว

---

## Suggested Next Steps

1. ทดสอบ re-query รายสถานีใน stage=0 (กด re-query button ทีละปุ่ม)
2. ตรวจสอบว่า `computeDailyReport` ใช้ historyMap จาก Uroboros ได้ถูกต้อง (ค่าตัวเลขใน report ตรงกับที่บันทึกมั้ย)
3. พิจารณา dedup `fetchUroborosHistory` — ปัจจุบัน copy อยู่ทั้งใน `operator.js` และ `dailyReport.js` อาจ extract ไปไว้ใน shared service

## Suggested Skills

- `/run` — ถ้าต้องการ start dev server เพื่อ test
- `/handoff:handoff` — สำหรับ session ต่อไป

---

## Session 2 (2026-07-20 — ต่อเนื่องวันเดียวกัน)

### Goal
เปลี่ยน column **START TIME** และ **END TIME** ในทุก Backwashing topic (FWS1, FWS2, CWS1, CWS2 และทุก phase) จาก `"type": "TEXT"` เป็น `"type": "FLOAT(2)"` เพื่อให้รับค่าแบบ `XX.XX` (เช่น `13.45` = 13:45)

### Changes Made

**`server/config/operator_nodes.json`**
- 88 params ที่มี `param_name` เป็น `"START TIME"` หรือ `"END TIME"` และ `type: "TEXT"`:
  - `type` → `"FLOAT(2)"`
  - `unit` → `"HH.MM"` (เดิม `"hh:mm"`)

### Incident — UTF-8 BOM

**อาการ**: หลังแก้ไขด้วย PowerShell ทุกหน้าได้ HTTP 500 จาก `/api/operator/nodes`

**Root cause**: `[System.IO.File]::WriteAllText(..., [System.Text.Encoding]::UTF8)` ใน PowerShell เขียนไฟล์ด้วย **UTF-8 BOM** (0xEF 0xBB 0xBF นำหน้า) — `JSON.parse(fs.readFileSync(..., 'utf8'))` ใน Express throw error แต่ `node -e "require(...)"` ไม่จับเพราะ Node strip BOM ให้อัตโนมัติเวลา `require` JSON

**แก้ไข**: restore ไฟล์จาก git แล้วใช้ Node.js parse/modify/write แทน:
```js
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
// แก้ field ใน object โดยตรง
fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf8' });
```

**บทเรียน**: ห้ามใช้ PowerShell regex replace บน raw JSON string — ให้ parse เป็น object เสมอ และใช้ Node เขียนกลับเพื่อหลีกเลี่ยง BOM

### Design Note — FLOAT(2) สำหรับเวลา

- `9.40` เก็บเป็น float ปกติ ระบบไม่แปลงเป็นเวลาอัตโนมัติ
- ต้องมี convert module (`floatToMinutes`) ก่อนคำนวณ duration
- Validation ควร reject ค่าที่ minute part > 59 (เช่น `9.65`)
- ถ้ามี convert module พร้อมแล้ว การใช้ FLOAT(2) ก็ไม่มีปัญหา

### Current State

- `operator_nodes.json` — ✅ แก้ไขครบ 88 params, JSON valid, API `/nodes` ตอบ 200 ปกติ
- ไม่มีการแก้ไข client หรือ server routes

### Suggested Next Steps

1. ทดสอบหน้า FWS1 Backwashing P#12 และ FWS2 Backwashing P#3/P#4 ว่า column START TIME/END TIME รับ input ตัวเลขได้ถูกต้อง และ format เป็น `XX.XX`
2. ตรวจสอบ convert module ว่า handle `FLOAT(2)` → minutes ได้ครบทุก edge case (เที่ยงคืน, ค่า null)
3. พิจารณาเพิ่ม validation warning เมื่อ minute part > 59
