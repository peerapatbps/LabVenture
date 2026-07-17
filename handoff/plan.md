# Aquadat Offline Resilience — Stage-Aware Data Pipeline

## ภาพรวมระบบ

3 components ทำงานร่วมกันสำหรับบันทึกข้อมูลโรงงานผลิตน้ำประปา:

| ระบบ | Stack | Port | Path |
|---|---|---|---|
| **Uroboros** | C# .NET 10 + SQLite | 8888 | `C:\Users\peera\OneDrive\Desktop\Uroboros\Uroboros\Uroboros\` |
| **BellBeast** | ASP.NET Core 9 Razor Pages | 443 (HTTP ไม่ใช่ HTTPS) | `C:\Users\peera\OneDrive\Desktop\BellBeast\BellBeast\BellBeast\` |
| **LabVenture** | Node.js/Express + React/Vite | 3001 (server) + Vite dev | `C:\Users\peera\OneDrive\Desktop\LabVenture\` |

Production publish ไปที่: `C:\Users\peera\OneDrive\Desktop\Fullscale_V2\`

External: **Aquadat** API ที่ `aquadat.mwa.co.th`
- REST login: `http://aquadat.mwa.co.th:12007/api/aquaDATService/Enroll`
- GraphQL write: `https://aquadat.mwa.co.th/graphql`

---

## Stage State Machine

```
ping OK & stage was 0  →  Stage 2 (syncing)
ping OK & stage was 2  →  retry sync
ping OK & stage was 1  →  stay Stage 1
ping FAIL & stage was 1 →  Stage 0 (offline)
sync complete (pending=0) →  Stage 1
```

| Stage | ความหมาย | Aquadat.refresh | LabVenture เขียนไปที่ | Login |
|---|---|---|---|---|
| **1** | ปกติ | รัน → AQ_readings_narrow_v2 (synced=1) | Aquadat โดยตรง | Aquadat token จริง |
| **0** | Aquadat ล่ม | หยุด | Uroboros ผ่าน BellBeast → AQ_readings_narrow_v2 (synced=0) | Auto bypass JWT |
| **2** | กำลัง sync | หยุด | ปฏิเสธ 503 | Auto bypass JWT |

Stage source of truth: **Uroboros RAM** + `stage.json` (persist ข้าม restart)
Stage broker: **BellBeast IotRoom** device `"aquadat-connector"` → LabVenture poll `/api/stage`

---

## Data Flow

```
Stage 1 (normal):
  Uroboros Aquadat.ping (60s) → 200 → stay stage 1
  Uroboros Aquadat.refresh (30s) → ดึงข้อมูล → AQ_readings_narrow_v2 (synced=1)
  LabVenture /op-record → POST /api/operator/record → writeData() ไป Aquadat โดยตรง

Stage 0 (offline):
  Uroboros Aquadat.ping → fail → SetStage(0) → POST state ไป BellBeast IotRoom
  LabVenture stageMonitor poll /api/stage → รับ stage=0
  LabVenture /login → auto bypass JWT (operator_bypass / scientist_bypass)
  LabVenture /op-record → POST /api/operator/record
    → forwardToUroboros() → BellBeast:443/api/operator/record
    → Uroboros:8888/api/operator/record
    → INSERT AQ_readings_narrow_v2 (synced=0)

Stage 2 (sync):
  Uroboros Aquadat.ping → 200 & prevStage==0 → SetStage(2) → spawn SyncPendingAsync()
  SyncPendingAsync: SELECT synced=0 LIMIT 100 → GraphQL write → UPDATE synced=1
  เมื่อ pending=0 → SetStage(1)
  LabVenture /op-record → 503 "กำลัง sync ข้อมูล"
```

---

## SQLite Table: AQ_readings_narrow_v2

| Column | Type | หมายเหตุ |
|---|---|---|
| ts | TEXT | `"yyyy-MM-dd HH:mm"` (ไม่มี seconds) |
| trans_type | TEXT | RWS / CDS / TPS / DPS / FWS |
| plant_id | INTEGER | 2 เสมอ |
| configID | INTEGER | = configparam_id |
| station | TEXT | ชื่อ station |
| header | TEXT | |
| value | REAL | |
| value_text | TEXT | |
| updated_at | TEXT | |
| **synced** | INTEGER | 0=pending (stage 0), 1=synced |

GraphQL mutation time format: `"HH:mm"` (5 chars, varchar(5) ใน Aquadat PostgreSQL)

---

## IotRoom Protocol

Uroboros ทำตัวเป็น IoT device:
```
POST /api/iot/room/join  body: { deviceName, deviceType, roomCode }  → { key }
POST /api/iot/room/data  header: X-Device-Key  body: { stage, aquadat_reachable, last_ping_ms, pending_count }
POST /api/iot/room/poll  header: X-Device-Key  (heartbeat ทุก 60s ป้องกัน expire 5 นาที)
```

BellBeast IotRoom URL: `http://localhost:443` (HTTP ไม่ใช่ HTTPS)

---

## Progress Timeline

| วันที่ | Session | สิ่งที่ทำ | Handoff ref |
|--------|---------|-----------|-------------|
| 11 Jul | Scientist Recorder | TW1/TW2 Temp configIDs 4345/4346 เพิ่มใน nodes.json + excel_cell_map; compare_sheets.py noise filter fix; server restart needed เพื่อ apply LEGACY_CONFIG_TIME_OVERRIDES fix | `handoff1107.md` |
| 12 Jul | Stage 0 Offline History | AQ_readings_operator_v1 table ใหม่ใน Uroboros; OperatorQueryTask (30 min, 1036 IDs); configids.json; DateSyncBar disabled stage 0; history endpoint wire Uroboros; SyncPendingAsync อ่านจากทั้ง 2 ตาราง | `handoff1207.md` |
| 14 Jul | RecordingTable Excel UI | TEXT listbox, column fix, type formatting, Ctrl+C/V + marching ants, TEXT paste validation, FLOAT/INT filter, focus fix (ลบ e.preventDefault), keyboard navigation | `handoff1407.md` |
| 15 Jul | Stage History Bugs | แก้ setStage side effects (React correctness); รวม history effects เป็น effect เดียว; var_data parse ด้วย `'['+var_data+']'`; เปลี่ยนเป็น fetch all patterns ไม่ filter topic | `handoff1507.md` |
| 16 Jul (1) | RecordingTable Scroll | sub-tab switch reset selCell + scroll to 0,0 + focus; arrow-key auto-scroll ด้วย manual offset (respect sticky); sticky column overlap fix | `handoff1607.md` |
| 16 Jul (2) | All Stations Scale-out | เพิ่ม params ทุก 9 station ใน operator_nodes.json (RWS2 81, CHEM1 100, CHEM2 112, TPS 76, DPS 72, CWS1 48, CWS2 58, FWS1 146, FWS2 254 params); Uroboros configids 1,036→1,166; build+publish Uroboros | `handoff1607.md` (append) |

---

## สิ่งที่ทำเสร็จแล้ว ✅

### Uroboros

- [x] **`StageManager`** static class — RAM + stage.json read/write, Init() ตอน startup
- [x] **`AquadatPingTask`** — ping Aquadat ทุก 60s, transition stage 0/1/2, POST ไป IotRoom, retry stage 2 sync
- [x] **Stage guard** ใน `AquadatQueryTask.ExecuteAsync` — skip เมื่อ stage ≠ 1
- [x] **`POST /api/operator/record`** ใน Listener_AQ — รับ records จาก LabVenture → INSERT AQ_readings_narrow_v2 (synced=0)
- [x] **`SyncPendingAsync`**  — อ่าน synced=0 → GraphQL write → UPDATE synced=1 → SetStage(1)
- [x] **`synced` column migration** — ALTER TABLE ตอน startup ถ้ายังไม่มี column
- [x] **Fix BellBeast URL** — `http://localhost:443` (ไม่ใช่ https)
- [x] **Fix GraphQL URL** — `https://aquadat.mwa.co.th/graphql` (ไม่มี port)
- [x] **Fix JSON null crash** — guard ValueKind ก่อน access `data` field
- [x] **Fix time extraction** — `r.Ts[11..16]` → `"HH:mm"` (5 chars) พอดี varchar(5)
- [x] **Fix stage 2 retry** — `else if (prevStage == 2)` re-trigger SyncPendingAsync

### BellBeast

- [x] **`GET /api/stage`** — return device state ของ `"aquadat-connector"` จาก IotRoomService
- [x] **`POST /api/operator/record`** proxy → `http://localhost:8888/api/operator/record`
- [x] **`GET /api/operator/data`** proxy → `http://localhost:8888/api/operator/data`
- [x] **502 guard** ใน `/labventure/*` proxy — ไม่ระเบิดเมื่อ LabVenture ไม่ได้รัน
- [x] **ลบ bypass panel** ออกจาก `_Layout.cshtml` (role selection ย้ายไปอยู่ที่ LabVenture login)

### LabVenture

- [x] **`server/services/stageMonitor.js`** — poll `/api/stage` ทุก 30s, export `getStage()` / `onStageChange()`
- [x] **`server/routes/operator.js`** — `POST /record` stage-aware routing (stage 1 → Aquadat, stage 0 → Uroboros, stage 2 → 503)
- [x] **`server/routes/auth.js`** — auto bypass JWT เมื่อ stage 0/2
- [x] **`server/config/operator_nodes.json`** — เพิ่ม `trans_type` และ `plant_id: 2` ทุก station
- [x] **`client/src/pages/OpRecord.jsx`** — ส่ง `trans_type` และ `plant_id` ใน records ที่ POST
- [x] **`GET /api/operator/history`** — stage-aware: stage 1 → Aquadat all patterns (configparam_id match), stage 0/2 → Uroboros UNION query *(handoff1207, handoff1507)*
- [x] **`client/src/components/DateSyncBar.jsx`** — disabled prop (stage 0: cursor-not-allowed + "Offline — Today Only" badge) *(handoff1207)*
- [x] **`/op-record` stage banner** — "Offline Mode" banner เมื่อ stage 0 *(handoff1207)*
- [x] **`/op-record` history ตาราง** — wire Uroboros `GET /api/operator/data` → render ผลลัพธ์ลง RecordingTable *(handoff1207, handoff1507)*
- [x] **`fetchOnePattern()` var_data parse** — `JSON.parse('[' + var_data + ']')` + handle nested arrays *(handoff1507)*
- [x] **topic name mismatch fix** — เปลี่ยนเป็น fetch all patterns ของ station ครั้งเดียว filter ด้วย configparam_id *(handoff1507)*
- [x] **`setStage()` React correctness** — ย้าย side effects ออกจาก updater function *(handoff1507)*
- [x] **`formatAndCommit()` NaN-check** — INT/FLOAT: ถ้า parseFloat → NaN ให้ clear cell แทน commit *(handoff1607)*
- [x] **`useEffect` activeTopic แยก 2 effects** — ป้องกัน listbox ปิดเมื่อ opNodes refetch *(handoff1607)*

### RecordingTable (client/src/pages/OpRecord.jsx)

- [x] **TEXT cell เป็น listbox** — `<select size>` เปิดทันที ไม่ขยาย column *(handoff1407)*
- [x] **Type-based formatting** — `formatDisplayVal()`: FLOAT(n)→toFixed, INT→round *(handoff1407)*
- [x] **Ctrl+C / Ctrl+V range copy/paste** — clipboard state + marching ants CSS animation + OS clipboard writeText *(handoff1407)*
- [x] **TEXT paste validation** — ตรวจ getCellOptions ก่อน paste *(handoff1407)*
- [x] **FLOAT/INT character filter** — regex filter ใน onChange *(handoff1407)*
- [x] **Focus fix** — ลบ `e.preventDefault()` ออกจาก TD onMouseDown; ใช้ CSS select-none แทน *(handoff1407)*
- [x] **Sub-tab switch reset** — useEffect fires when topic.topic changes: reset selCell/selAnchor/editCell/copiedRange + scroll to 0,0 + focus *(handoff1607)*
- [x] **Arrow-key auto-scroll** — cellRefs map + manual offset calculation (respect sticky col/header) *(handoff1607)*

### Station Config Scale-out

- [x] **operator_nodes.json** — params ครบทุก 10 stations (RWS1~2, CHEM1~2, TPS, DPS, CWS1~2, FWS1~2) — map จาก `record_opt.xlsx` *(handoff1607 append)*
- [x] **Uroboros operator_configids.json** — 1,036 → 1,166 entries (เพิ่ม 130 IDs ที่ขาดจาก 7 stations) *(handoff1607 append)*
- [x] **Uroboros rebuild + publish** — `dotnet publish` ไปที่ `publish/Uroboros/` *(handoff1607 append)*

---

## สิ่งที่ยังไม่ได้ทำ / ยังไม่แน่ใจ ⬜

### ~~LabVenture (เสร็จแล้ว — ขีดออก)~~

- [x] ~~**`/op-record` แสดง stage banner`**~~ → เสร็จ *(handoff1207)*
- [x] ~~**`/op-record` history (ตาราง)**~~ → เสร็จ *(handoff1207, handoff1507)*
- [x] ~~**`stageMonitor.start()`**~~ → wired ใน server/index.js แล้ว
- [x] ~~**LabVenture login page auto-select role**~~ → auto bypass JWT ทำงานอยู่แล้ว

### LabVenture — ยังเหลือ

- [ ] **`Tab` key wrap-around scroll** — Tab ไปแถวถัดไปแล้ว ไม่ scroll ตาม (arrow keys แก้แล้ว แต่ Tab ยังไม่ได้ตรวจ) *(พบใน handoff1607)*
- [ ] **Touch / mobile support** ใน RecordingTable — ยังไม่มี
- [ ] **CHEM1 topic `คงเหลือ/รับเข้า/ส่งคืน`** — ยังไม่มี pattern_id ใน `aquadat_patterns.json` ถ้าต้องการ fetch stage 1 ต้องเพิ่ม
- [ ] **FWS2 BACKWASHING P#3/P#4** — 84 params/topic อาจ render ช้า ตรวจ virtualization ถ้าจำเป็น

### E2E Test ที่ยังไม่ได้รัน (ต้องทำในไซต์)

- [ ] **Full stage 0 flow**: ตัด Aquadat → login bypass → เขียน record ผ่าน op-record → ตรวจ `AQ_readings_narrow_v2` / `AQ_readings_operator_v1` synced=0
- [ ] **Full stage 2 flow**: เปิด Aquadat กลับ → รอ ping → synced=0 rows ถูก push → synced=1 → stage กลับเป็น 1
- [ ] **BellBeast IotRoom page** (`http://localhost:443/IotRoom`) — ตรวจว่า device `aquadat-connector` ปรากฏและอัปเดต state ทุก 60s
- [ ] **Stage 1 history fetch** สำหรับ station ใหม่ — ตรวจ Network tab `GET /api/operator/history?station_id=RWS2` ต้องคืนข้อมูลไม่ใช่ `{}`
- [ ] **Stage 0 history fetch** สำหรับ station ใหม่ — ต้อง restart BellBeast หลัง Uroboros publish ใหม่

---

## Design Decisions เพิ่มเติม (เปลี่ยนหลังจาก plan.md เขียนครั้งแรก)

### Operator History Fetch — two-table architecture *(handoff1207)*

| เรื่อง | ตัดสินใจ | เหตุผล |
|--------|----------|--------|
| Stage 0 query param | configIDs (comma-separated) ไม่ใช่ station_id | configID globally unique, Uroboros ไม่ต้องรู้ station |
| SSD wear prevention | แยก 2 ตาราง: `AQ_readings_narrow_v2` (154 IDs, 30s) + `AQ_readings_operator_v1` (1036 IDs, 30 min) | ถ้าใช้ table เดียว 30s → ~8.4 GB/วัน |
| Stage 0 write routing | Uroboros ตัดสิน table ตาม `DashboardIds` HashSet | ไม่ต้องเปลี่ยน JSX POST format |
| synced filter ตอน history | ไม่กรอง synced — แสดงทุกแถวของวันนั้น | user ต้องเห็นข้อมูลย้อนหลังตลอดวัน |
| Stage 0 date restriction | force today เท่านั้น (date picker disabled) | ข้อมูล Uroboros มีแค่วันปัจจุบัน |

### Aquadat Pattern Fetch — no topic filter *(handoff1507)*

**Design เดิม**: fetch per topic → filter `p.topic === topic_filter`
**Design ใหม่**: fetch ทุก pattern ของ station ครั้งเดียว → client map ด้วย configparam_id

เหตุผล: ชื่อ topic ใน `operator_nodes.json` (เช่น "FLOW RPS1") ไม่ตรงกับ `aquadat_patterns.json` (เช่น "Flow") → fetch เดิมคืน `{}` เสมอ  
ผลพลอยได้: topic switching เป็น instant (ข้อมูลโหลดครั้งเดียวต่อ station+date)

### RecordingTable Type System *(handoff1407)*

```
FLOAT(n)           → <input type="text"> filter regex + toFixed(n) on commit
INT                → <input type="text"> filter regex + Math.round() on commit
TEXT{OPT1,OPT2}   → <select size=N> (listbox เปิดทันที, ไม่ขยาย column)
readonly: true     → แสดงแต่แก้ไม่ได้
formula: "..."     → computed จาก configparam_id อื่น (ไม่ editable)
```

Format ใน JSON ต้องเป็น `"TEXT{OPT1,OPT2,OPT3}"` — ไม่มี space รอบ `{}`

### operator_nodes.json — Station Topic Names *(handoff1607 append)*

Topic names ใช้ตาม Excel sheet headers โดยตรง (เช่น "FLOW, PRESSURE, POWER, %SPEED" สำหรับ TPS) **ไม่จำเป็นต้องตรงกับ** `aquadat_patterns.json` เพราะ history fetch ทำงานด้วย configparam_id ไม่ใช่ topic name

---

## Bug ที่แก้แล้วในระหว่างทาง (reference)

| Bug | สาเหตุ | วิธีแก้ |
|---|---|---|
| SSL connection error | `https://localhost:443` แต่ BellBeast เป็น HTTP | เปลี่ยนกลับเป็น `http://localhost:443` |
| Stage 2 sync ไม่ retry | trigger แค่ `prevStage==0` | เพิ่ม `else if (prevStage==2)` |
| Missing trans_type/plant_id ใน SQLite | LabVenture ไม่ส่งมา | เพิ่มใน operator_nodes.json + OpRecord.jsx |
| GraphQL 404 | URL ผิด `http://...12007/graphql` | แก้เป็น `https://aquadat.mwa.co.th/graphql` |
| JSON null crash | `data` field เป็น null แต่ code access โดยไม่ check | เพิ่ม ValueKind guard + errors array check |
| varchar(5) truncation ใน cds_time | time extract เป็น `"00:00:00"` (8 chars) | แก้เป็น `r.Ts[11..16]` → `"HH:mm"` (5 chars) |
| BellBeast ระเบิดเมื่อ LabVenture ไม่รัน | ไม่มี try/catch ใน `/labventure/*` proxy | ครอบ try/catch return 502 |

---

### Bugs เพิ่มเติม (handoff1507 และหลังจากนั้น)

| Bug | สาเหตุ | วิธีแก้ | Ref |
|-----|--------|---------|-----|
| History ตารางว่างเสมอ (stage 1) | `fetchOnePattern()` parse `var_data` ด้วย `JSON.parse()` ตรงๆ แต่ Aquadat ส่งหลาย objects ไม่มี `[]` ครอบ | `JSON.parse('[' + row.var_data + ']')` + handle nested arrays | handoff1507 |
| History ตารางว่��งเสมอ (topic mismatch) | `operator_nodes.json` ใช้ "FLOW RPS1" แต่ `aquadat_patterns.json` ใช้ "Flow" | เปลี่ยนเป็น fetch all patterns ไม่ filter topic | handoff1507 |
| setStage() side effects non-deterministic | side effects อยู่ภายใน React state updater (อาจ run หลายครั้ง Strict Mode) | ย้ายออกมา run ก่อน `setStage(s)` | handoff1507 |
| Listbox ปิดเองเมื่อ history โหลด | `opNodes` refetch → object reference ใหม่ → stationDef ใหม่ → `useEffect([stationDef])` fire → `setActiveTopic(topics[0])` → RecordingTable re-render → `setEditCell(null)` | แยก useEffect เป็น 2: reset เมื่อ station เปลี่ยน / preserve topic ถ้ายัง valid | handoff1607 |
| `formatAndCommit` commit ค่า `-` หรือ `.` | `parseFloat('-')` = NaN แต่ไม่มี check | เพิ่ม `isNaN(num)` → clear cell | handoff1607 |
| Arrow-key moved cell ออกนอกหน้าจอ | ใช้ `scrollIntoView` ไม่รู้จัก sticky elements | Manual scroll calculation อ่าน sticky offset จาก DOM | handoff1607 |
| Selected cell ซ่อนใต้ sticky column | `scrollIntoView` scroll ไป offsetLeft=0 ซึ่งอยู่หลัง sticky col | คำนวณ `stickyW` จาก DOM + manual scrollLeft | handoff1607 |

---

## Key File References

| สิ่งที่ต้องการ | File | ตำแหน่ง |
|---|---|---|
| Stage transitions + ping task | `Uroboros/Program.cs` | class `AquadatPingTask` บรรทัด ~1872 |
| StageManager | `Uroboros/Program.cs` | class `Uroboros.StageManager` |
| Sync pending → Aquadat | `Uroboros/Program.cs` | `SyncPendingAsync()` บรรทัด ~2048 |
| GraphQL write + time format | `Uroboros/AquadatFast.cs` | `WritePendingToAquadatAsync()` |
| Operator record endpoint | `Uroboros/Program.cs` (Listener) | `POST /api/operator/record` บรรทัด ~2823 |
| BellBeast stage endpoint | `BellBeast/Program.cs` | `GET /api/stage` บรรทัด ~1580 |
| BellBeast operator proxies | `BellBeast/Program.cs` | บรรทัด ~1607–1660 |
| LabVenture stage monitor | `LabVenture/server/services/stageMonitor.js` | |
| LabVenture record routing | `LabVenture/server/routes/operator.js` | `POST /record` บรรทัด ~162 |
| LabVenture auth bypass | `LabVenture/server/routes/auth.js` | `POST /login` บรรทัด ~26 |
| Station config + trans_type | `LabVenture/server/config/operator_nodes.json` | |
| Record form + submit | `LabVenture/client/src/pages/OpRecord.jsx` | `handleSubmitTopic` |
