# Handoff — 12 July 2026

## Project
**LabVenture AquaDAT Scientist Recorder — Stage 0 Offline History Fetch**
Stack: React frontend · Node.js/Express backend (port 3001) · C# Uroboros (port 8888) · ASP.NET BellBeast (port 443 HTTP)

Working directories:
- LabVenture: `C:\Users\peera\OneDrive\Desktop\LabVenture`
- Uroboros: `C:\Users\peera\OneDrive\Desktop\Uroboros\Uroboros`
- BellBeast: `C:\Users\peera\OneDrive\Desktop\BellBeast\BellBeast`
- Production: `C:\Users\peera\OneDrive\Desktop\Fullscale_V2\`

---

## Pain Point ที่แก้ใน Session นี้

ระบบมี 3 stages: Stage 1 (online, Aquadat ปกติ), Stage 0 (offline, Aquadat ล่ม), Stage 2 (กำลัง sync)

**Pain point หลัก**: daily report ต้องทำได้ทุกเงื่อนไข — ไม่ว่า Aquadat จะ online หรือ offline ก็ตาม

**ปัญหาก่อนหน้า**: ตาราง history ใน `/op-record` (OpRecord.jsx) ว่างเปล่าทุก stage เนื่องจาก:
1. Client ดึง history จาก Aquadat GraphQL เฉพาะ stage 1 เท่านั้น
2. Uroboros ยังไม่มี `GET /api/operator/data` endpoint
3. LabVenture server ส่ง `station_id+date` ให้ Uroboros แทนที่จะเป็น `configIDs`
4. Uroboros `AQ_readings_narrow_v2` มีแค่ 154/1163 configIDs (เฉพาะ dashboard)

---

## Design Decisions (Q&A สำคัญ)

### 1. Fetch frequency: ทีละ topic หรือทั้งหมดพร้อมกัน?
**ตัดสินใจ: ทีละ topic (เหมือน Aquadat UX)**
- รองรับ re-fetch เมื่อกลับมาแก้ค่า
- ไม่โหลด server มากเกินไปในครั้งเดียว
- Stage 0 จำกัดเฉพาะวันปัจจุบัน ไม่สามารถแก้ไขข้อมูลย้อนหลัง

### 2. Query parameter ที่ส่งไป Uroboros: station_id หรือ configIDs?
**ตัดสินใจ: configIDs (comma-separated)**
- configID เป็น globally unique — ไม่ต้องการ station เพิ่มเติม
- Uroboros `AQ_readings_narrow_v2` มี `station` field เป็นค่าว่าง (จาก aquadat.refresh)
- URL สั้นกว่า: `GET /api/operator/data?configIDs=1,2,3,4,5`
- ข้อมูล Uroboros มีแค่วันปัจจุบัน → ไม่ต้องส่ง date

### 3. SSD wear: 1009 configIDs เพิ่มลงใน aquadat.refresh 30s?
**ตัดสินใจ: แยก 2 ตาราง ด้วย task ใหม่ (30 นาที)**
- `AQ_readings_narrow_v2` (154 IDs, dashboard) — refresh ปรับได้ผ่าน enginedb (~15 min default)
- `AQ_readings_operator_v1` (1036 IDs, operator/report) — refresh 30 min default
- ~120 MB/วัน vs ~8.4 GB/วัน ถ้าใช้ table เดียว 30s

### 4. Schema ของตารางใหม่?
**ตัดสินใจ: เหมือนกัน 100% กับ AQ_readings_narrow_v2**
- `SyncPendingAsync` (stage 2) อ่าน synced=0 จากทั้ง 2 ตารางโดยไม่ต้อง refactor
- Upsert ปกติ (synced=1) ไม่ overwrite synced=0 entries ของ operator

### 5. Filter synced เมื่อดึง history ใน stage 0?
**ตัดสินใจ: ไม่กรอง synced** — แสดงทั้งหมดของวันนั้น (synced=0 และ synced=1)
- User ต้องการเห็นข้อมูลย้อนหลังตลอดวัน ไม่ใช่แค่ที่ตัวเองบันทึก

### 6. Stage 0 write routing ใครเป็นคนแยก table?
**ตัดสินใจ: Uroboros** (ไม่ใช่ JSX)
- JSX ส่ง records ทั้งหมดใน POST เดียวเหมือนเดิม
- Uroboros loop records → ดู configID → INSERT ลง table ที่ถูกต้อง
- `OperatorRouting.DashboardIds` (HashSet<int>) เป็น static set ใน Program.cs

### 7. ClearAllOperatorV1 ลบ synced=1 เท่านั้น
- `DELETE FROM AQ_readings_operator_v1 WHERE synced = 1` — ป้องกัน pending offline records ถูกลบก่อน sync

---

## Scenarios และ Design รองรับ

### Scenario A: Stage 1 (ปกติ)
- Operator เปิด tab RWS1/Flow → client fetch Aquadat GraphQL ผ่าน `/api/operator/graphql-proxy`
- `OperatorQueryTask` refresh 1036 IDs ทุก 30 นาที → `AQ_readings_operator_v1`
- `AquadatQueryTask` refresh 154 IDs ทุก ~15 นาที → `AQ_readings_narrow_v2`
- Date picker: เลือกวันย้อนหลังได้

### Scenario B: Stage 0 (Aquadat ล่ม)
- `stageMonitor.js` poll `/api/stage` จาก BellBeast → รับ stage=0
- Client: force selectedDate = today (ถ้าอยู่วันอื่น)
- Date picker: disabled + แสดง badge "Offline — Today Only"
- Operator เปลี่ยน tab → client fetch `GET /api/operator/history?station_id=RWS1&topic=Flow`
- Server resolve configIDs จาก `operator_nodes.json` → `fetchUroborosHistory(configIds)`
- BellBeast proxy → Uroboros `GET /api/operator/data?configIDs=...`
- Uroboros UNION `AQ_readings_narrow_v2` + `AQ_readings_operator_v1` → return rows
- Operator บันทึกค่า → POST `/api/operator/record` → Uroboros INSERT ลง table ที่ถูกต้อง (synced=0)

### Scenario C: Stage 2 (กำลัง sync หลัง Aquadat กลับมา)
- `SyncPendingAsync` อ่าน synced=0 จาก **ทั้ง 2 ตาราง** ผ่าน `ReadPendingBatchAllTablesAsync`
- Push ไป Aquadat GraphQL → `MarkSyncedAllTablesAsync` (แยก rowId ตาม TableSource)
- เมื่อ pending=0 → stage กลับเป็น 1
- `CountPendingAsync` นับจากทั้ง 2 ตาราง (รายงาน IotRoom)

### Scenario D: Uroboros restart ระหว่าง Stage 0
- ข้อมูล synced=0 อยู่ใน SQLite → ปลอดภัย ไม่หาย
- `AQ_readings_operator_v1` table recreate โดย `AQtable.Initialize()` ตอน startup (IF NOT EXISTS)
- `OperatorQueryTask` ไม่ run เมื่อ stage≠1 → ไม่ลบ pending entries (ClearAll ลบแค่ synced=1)

### Scenario E: transition Stage 1 → 0 ขณะ user อยู่วันย้อนหลัง
- Stage poll รับ 0 → `handleDateChange(today)` → history reset → stage 0 useEffect fire → fetch Uroboros
- Date picker disabled → user ไม่สามารถเปลี่ยนวันได้

---

## รายการแก้ไขทั้งหมด

### AquadatFast.cs
| ส่วนที่เพิ่ม | รายละเอียด |
|---|---|
| `AQ_readings_operator_v1` table | ใน `Initialize()` — schema เหมือน narrow_v2 |
| `ClearAllOperatorV1Async()` | DELETE synced=1 only |
| `UpsertAquaDatAsync_Operator()` | เหมือน FWS pattern แต่ upsert เฉพาะ synced=1 rows |
| `ReadPendingBatchAllTablesAsync()` | UNION narrow+operator WHERE synced=0, return `TableSource` field |
| `MarkSyncedAllTablesAsync()` | UPDATE แยก table ตาม TableSource |
| `ReadOperatorDataAsync(configIds)` | UNION query ทั้ง 2 ตาราง ไม่กรอง synced |
| `UpsertOperatorRecordRoutedAsync()` | route INSERT ตาม DashboardIds |
| `PendingRow.TableSource` property | "narrow" / "operator" |
| prefix `"OPERATOR"` ใน ProcessMultiAsync | ClearAllOperatorV1 + UpsertAquaDatAsync_Operator |
| `CountPendingAsync` | นับจากทั้ง 2 ตาราง |

### Program.cs
| ส่วนที่เพิ่ม | รายละเอียด |
|---|---|
| `OperatorRouting.DashboardIds` | static HashSet<int> 155 IDs |
| `OperatorQueryTask` | โหลด `operator_configids.json`, 30 min, DbPrefixByKey="OPERATOR" |
| Register `"Operator.refresh"` | ใน registry + catalog (1_800_000 ms) |
| `GET /api/operator/data` endpoint | UNION query, return `[{configID, ts, value, value_text}]` |
| `POST /api/operator/record` | เปลี่ยนเป็น `UpsertOperatorRecordRoutedAsync` |
| `SyncPendingAsync` | เปลี่ยนเป็น `ReadPendingBatchAllTablesAsync` + `MarkSyncedAllTablesAsync` |

### operator_configids.json (ใหม่)
- Path: `Uroboros/Uroboros/Uroboros/operator_configids.json` + copy ไป production
- 1036 configIDs (จาก record_opt.xlsx ลบ 155 dashboard IDs)
- Format: `[{configID, plant, station}]`

### server/routes/operator.js
| ส่วนที่แก้ | รายละเอียด |
|---|---|
| `fetchUroborosHistory(configIds)` | เปลี่ยน param จาก `(station_id, date)` → `(configIds[])` |
| `GET /history` stage 0/2 branch | resolve configIDs จาก `operator_nodes.json` แล้ว call fetchUroborosHistory |

### client/src/pages/OpRecord.jsx
| ส่วนที่แก้ | รายละเอียด |
|---|---|
| stage poll useEffect | force today เมื่อ stage=0 และ selectedDate≠today |
| stage 0 history useEffect | `[stage, activeTopic, activeStation]` → GET `/api/operator/history` |
| DateSyncBar wrapper | disabled={stage===0} + "Offline — Today Only" badge |

### client/src/components/DateSyncBar.jsx
- รองรับ `disabled` prop — cursor-not-allowed + opacity-60 + ปิด onChange + ปิด showPicker

---

## Files Changed (summary)
| File | Type |
|---|---|
| `Uroboros/Uroboros/Uroboros/AquadatFast.cs` | Modified |
| `Uroboros/Uroboros/Uroboros/Program.cs` | Modified |
| `Uroboros/Uroboros/Uroboros/operator_configids.json` | New |
| `Fullscale_V2/Uroboros_proj/operator_configids.json` | New (copy) |
| `Fullscale_V2/Uroboros_proj/*.dll` | Updated (publish) |
| `server/routes/operator.js` | Modified |
| `client/src/pages/OpRecord.jsx` | Modified |
| `client/src/components/DateSyncBar.jsx` | Modified |

---

## สิ่งที่ยังไม่ได้ทำ / ต้อง Verify

### Verify ที่ต้องทำก่อน

1. **รัน Uroboros ใหม่** → ตรวจว่า `AQ_readings_operator_v1` ถูกสร้างใน `data.db`
   ```sql
   SELECT name FROM sqlite_master WHERE type='table' AND name='AQ_readings_operator_v1';
   ```

2. **ตรวจ `Operator.refresh` ใน enginedb** — ต้องปรากฏใน task list และ enabled
   - URL: `http://localhost:8888/api/tasks` หรือ Uroboros dashboard

3. **Mock stage=0** แล้วเปิด `/op-record`:
   - date picker ต้อง disabled + badge ปรากฏ
   - เปลี่ยน topic tab → ตรวจ Network request `GET /api/operator/history?station_id=...&topic=...`
   - ตรวจว่า BellBeast forward → Uroboros → return data

4. **บันทึกค่าใน stage 0** → ตรวจ `AQ_readings_operator_v1` หรือ `AQ_readings_narrow_v2` ตาม configID

5. **Simulate stage 2** → ตรวจว่า SyncPendingAsync อ่านจากทั้ง 2 ตาราง

### Known gotchas
- `CountPendingAsync` ใช้ UNION subquery — ถ้า `AQ_readings_operator_v1` ยังไม่มีตอน init จะ error → แก้โดย Uroboros ต้อง restart ก่อนเพื่อให้ `Initialize()` สร้างตาราง
- stage poll useEffect มี dependency `[selectedDate, today]` — อาจเกิด re-subscribe บ่อยกว่าที่ควร ถ้าพบปัญหาให้ refactor ใช้ `useRef` เก็บ selectedDate แทน
- `OperatorRouting.DashboardIds` hardcode อยู่ใน Program.cs — ถ้า AquadatQueryTask bypassList เปลี่ยน ต้องอัปเดต HashSet นี้ด้วย

---

## Key Architecture Reference
อ้างอิง plan ฉบับเต็ม: `C:\Users\peera\.claude\plans\c-users-peera-onedrive-desktop-labventur-fluttering-flask.md`
อ้างอิง stage machine: `C:\Users\peera\OneDrive\Desktop\LabVenture\handoff\plan.md`

---

## Suggested Skills
- `/handoff` — เมื่อ session ถัดไปเสร็จ
- `/verify` — ทดสอบ end-to-end หลัง Uroboros restart
- `/code-review` — ตรวจ AquadatFast.cs + operator.js หลัง verify ผ่าน
