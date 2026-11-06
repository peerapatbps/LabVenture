# Handoff 04-Nov-2026 — Alarm: FSNL 30 นาที, anomaly pct_floor, ทดสอบ lab alarm (ความขุ่น + CL โรคระบาด)

## Session 1 — 04-Nov-2026

### สถานะสั้น ๆ
- task เก็บข้อมูลเปลี่ยนเป็นทุก 60 วินาที → ปรับ FSNL เป็น **30 นาที** และ `interval_sec` เป็น **60**
- anomaly rule ใหม่: **k=3, for_polls=2, pct_floor=3%** และ baseline ไม่รวมค่าล่าสุด → test Uroboros ผ่าน **311/311**
- **deploy Uroboros ขึ้น `Fullscale_V2\Uroboros_proj` แล้ว** (09:02) → engine รันอยู่ ผ่าน FSNL เข้า SYNC ปกติ
- ทดสอบ lab alarm ด้วยการฉีดค่าลง db จริง → **ดังจริงครบ** (ไม่ใช่ `[TEST]`) ทั้งความขุ่น CW1 และ CL TW1–4 (โหมดโรคระบาด)
- Fullscale_V2 = เวอร์ชันล่าสุดทั้ง Uroboros / BellBeast / LabVenture (ดูหัวข้อ "ตรวจเวอร์ชัน")
- **ยังไม่ commit / ยังไม่ push ทั้ง 3 repo** (ผู้ใช้ยังไม่ได้สั่ง)
- ผู้ใช้แจ้ง: db ใน Fullscale_V2 เป็นตัวทดสอบ แก้ได้ตามใจ ตอน deploy จริงไม่ได้ยก db ไปด้วย

### Repo / path
| อะไร | path | หมายเหตุ |
|---|---|---|
| Uroboros source | `C:\Users\peera\OneDrive\Desktop\Uroboros\Uroboros` | master, working tree มีงานค้างหลายไฟล์ |
| BellBeast source | `C:\Users\peera\OneDrive\Desktop\BellBeast\BellBeast` | `feat/alarm-monitor` (session นี้ไม่ได้แก้โค้ด BellBeast) |
| LabVenture source | `C:\Users\peera\OneDrive\Desktop\LabVenture` | session นี้ไม่ได้แก้โค้ด |
| Uroboros live | `Fullscale_V2\Uroboros_proj` | `data.db`, `history.db`, `engine_admin.db`, `alarm_rules.json` |
| LabVenture live | `Fullscale_V2\DEPLOY_LabVenture\server` | `labventure.db`, `config\app_settings.json`, `scenarios\*.json` |
| หน้าที่ใช้ดู | `http://localhost:443/AlarmMonitor`, `/MHxViewer/MHxView`, `/labventure/config` | Uroboros API `http://localhost:8888/api/alarm/state` |

---

### 1. FSNL 30 นาที (ทำไมต้องเปลี่ยน 2 ค่า)
- `engine_admin.db` → `task_settings`: `metric.history.sample` = **60000**, `alarm.eval` = **60000**, `Alarm.warmup` = 50000
- anomaly ใช้ `window: 30` samples → 30 × 60s = **30 นาที** กว่า window จะเต็ม → `warmup_minutes` 15 → **30**
- `interval_sec` ต้องตรงกับ `metric.history.sample` ด้วย: `AnomalyReadiness.Check` ตัด window ถ้า span > `window × interval_sec × 1.5`
  - ค่าเดิม 30 → เพดาน 1,350s แต่ 30 samples @60s = ~1,740s → `gap inside window` ตลอด → **ค้าง FSNL ตลอดไป**
- แก้ `mode` ใน `alarm_rules.json` ทั้ง live และ source: `warmup_minutes: 30`, `interval_sec: 60`
- `alarm_rules.json` hot-reload เอง (ดู `LastWriteTime`) ไม่ต้อง restart
- default ในโค้ดก็ปรับตาม: `AlarmModeConfig.WarmupMinutes = 30`, `IntervalSec = 60`, catalog ใน `Program.cs` `metric.history.sample` / `alarm.eval` = 60000

### 2. Anomaly rule ใหม่ (Uroboros)
**ปัญหาเดิม** (k=2, z รวมค่าล่าสุดใน window)
- k=2 → false alarm ตามทฤษฎี ~4.55% ของ sample (~65 ครั้ง/วัน/param @60s)
- z รวม latest ใน window → |z| สูงสุด = (n−1)/√n ≈ **5.29** (n=30) → ตั้ง k ≥ 5.3 จะไม่มีวันดัง
- สัญญาณนิ่ง σ เล็กมาก (rwp2_flowp3 σ≈35 = 0.2% ของ flow) → ขยับ ~0.6% ก็เกิน 3σ แล้ว

**ที่แก้** (`Uroboros/AlarmModel.cs`)
- `AnomalyMath.Evaluate(baseline, latest, sigmaFloor, pctFloor, k)` → mean/σ จาก **window ก่อนหน้า (ไม่รวม latest)**
- effective σ = `max(σ, sigma_floor, pct_floor% × |mean| / k)` → ดังเมื่อ `|x − mean| ≥ max(kσ, k·sigma_floor, pct_floor% × |mean|)`
- `AnomalyResult` เพิ่ม `EffSigma`; ใช้สูตรเดียวกัน 3 ที่: `ObserveAnomaly` (alarm.eval), `Monitor` (ตาราง AlarmMonitor), `HistorySeries.Build` (กราฟ ±band)
- `AlarmRule.PctFloor` (json `pct_floor`), `MonitorRow.PctFloor`
- `MetricsSchemaHandlers.cs` `/api/metrics/history`: ดึง `n + window` rows (เดิม `n + window - 1`) + ส่ง `pct_floor` ใน `rule`
- tests: `AlarmEngineTests.cs` (เขียนใหม่: z ไม่ติดเพดาน, ramp 1.79, pct_floor แคบ/กว้าง, step absorb ~7 samples), `AlarmMonitorTests.cs` (series baseline, ramp near 1.75–1.83) → **311/311 ผ่าน**
- shipped config test: k ต้อง > 1.8 (ramp z ตอนนี้ = 1.79), `IntervalSec == 60`

**ค่าใน `alarm_rules.json`** (anomaly 7 ตัว: rwp1_flowp1/p2, rwp2_flowp3/p4, DPS_flowA/B, TR_flow)
- `k: 3.0`, `for_polls: 2`, `pct_floor: 3` (sigma_floor เดิม 50 / TPS 100)
- `_comment` บรรทัด anomaly อัปเดตสูตรแล้ว

**จำลองบน `history.db` จริง** (193 window/param): k=2 แบบเดิม = **60 alarm** → k3 + pct3 + fp2 = **1 alarm** (rwp2_flowp4 — ยังดังแม้ pct 5% น่าจะเหตุการณ์จริง)
- script: scratchpad `zsim2.py` (ไม่ได้เก็บใน repo)

### 3. Deploy Uroboros → Fullscale_V2 (09:02)
ทำตาม `Uroboros/handoff/handoff0411.md`:
1. `dotnet publish Uroboros/Uroboros.csproj -c Release -o <scratchpad>\stage\uro`
2. engine ไม่รันอยู่ (ไม่มี process, port 8888 ไม่ฟัง)
3. `cmp` stage กับ live → ต่างแค่ `Uroboros.dll`, `Uroboros.pdb`, `appsettings.json` (**ไม่ทับ** appsettings)
4. backup → `Fullscale_V2\_backup\Uroboros_bin_before_pctfloor_0411\` (dll, pdb, `alarm_rules_before_fsnl.json`)
5. copy + `cmp` ยืนยัน
- backup `alarm_rules.json.bak_20261104_fsnl` อยู่ข้างไฟล์ทั้ง live และ source
- ⚠️ DLL build จาก working tree ทั้งหมด → รวมงาน Uroboros อื่นที่ยังไม่ commit ด้วย (เหมือนรอบ PTC)
- ผู้ใช้เปิด Fullscale ทีหลัง → `started_at` 09:02:38, `warmup_minutes 30` → SYNC ปกติ

### 4. Lab alarm ทำงานยังไง (สรุปที่ตรวจ)
**สายทางจริง**
1. Rule: LabVenture `event_classes` → `GET /api/eventclass?enabled=true` → Uroboros `eventclass.sync` (ทุก 30s) → `eventclass_cache.json`
2. ค่า: Uroboros อ่าน `data.db` → `lab_import_daily` (`value_real` เท่านั้น, `MAX` ต่อ sample_date+time) — เติมโดย task `LAB.import.daily`
3. `ObserveLab`: ค่าล่าสุดต้องไม่เก่ากว่า `MaxAgeMin` = **480 นาที** ไม่งั้น `latest sample too old`; lab rule ไม่ต้องรอ FSNL/SYNC
4. Test mode (`/labventure/config` Ctrl+Shift+F10, super admin) = ฉีดค่าใน memory (`AlarmTestOverlay.cs`, `/api/alarm/test/lab`) → alarm มี `test: true` / reason `[TEST]`; overlay ชนะค่า db ถ้ามี

**เกณฑ์ตามสถานการณ์** (`server/routes/eventClass.js`, `services/eventClass.js`)
- rule มี `ref: { bound: UCL|LCL, mode: eq|pct|offset|abs, amount }` → `resolveItem` คิดค่าจาก threshold ของสถานการณ์ที่ active ตอน Uroboros มาดึง
- สถานการณ์ไม่มี bound ของ param นั้น → class ถูก**ตัดทิ้งเงียบ ๆ** (ไม่ส่งไป Uroboros)
- `ui.scenario` / `ui.limit` แนบไปให้ BellBeast/device แสดง
- เปลี่ยนสถานการณ์/โหมด → มีผลใน ~1.5 นาที (sync 30s + eval 60s)
- โหมดโรคระบาด: `app_settings.json` `epidemic: true` → `applyEpidemic` ทับ threshold ของสถานการณ์ active; ไม่มี `epidemic_thresholds` → ใช้ `DEFAULT_EPIDEMIC` = TW1–4.ResCl2 **1.4–1.8**

| param | ปกติ / ทุกสถานการณ์ | โรคระบาด |
|---|---|---|
| CW1.turb UCL | ปกติ 5 · น้ำดิบขุ่นสูง 3 · เฝ้าระวัง 3 · วิกฤติ 2 · สาหร่ายเฝ้าระวัง 3 · สาหร่ายวิกฤติ 2 | (ไม่ทับ) |
| TW1–4.ResCl2 | 1.0–1.4 ทุกสถานการณ์ | **1.4–1.8** |

**การ์ด LAB บน MHxView** (`wwwroot/js/LABview.js`): สีคิดฝั่ง client จาก `/labventure/api/scenarios/limits` → เปลี่ยนทันทีที่เปลี่ยนเกณฑ์ แม้ค่าเก่า; ส่วน alarm/popup มาจาก `MHxIotAlarm.js` → `/api/alarm/active` (engine) → ต้องมี rule + ค่าใหม่

### 5. ทดสอบฉีด db จริง (ผลยืนยันแล้ว)
**ก่อนหน้า**: ค่าแล็ปจริงล่าสุด **2026-10-15** เพราะ `LAB.import.daily` **enabled = 0** → lab alarm จริงขึ้นไม่ได้

| เวลา | ทำอะไร | ผล |
|---|---|---|
| 10:14 | `data.db` `lab_import_daily` id **40465**: cfg 1002 (CW1 ความขุ่น) = **6.0** | `lab:cw1_turb_h2` active 10:14:52, popup "IoT ALARM · วิกฤต · แล็บ · CWS" บน MHxView |
| 10:21 | `labventure.db` เปิด event class CL 8 ตัว (`tw1..tw4_rescl2_l2/_h2`, `updated_by='Claude (CL alarm test)'`) | Uroboros `lab_rules: 9` |
| 10:22 | `lab_import_daily` id **40466–40469**: TW1 1046 / TW2 1055 / TW3 1064 / TW4 1067 = **1.2** | `_l2` ทั้ง 4 active 10:22:52 (1.2 < LCL โรคระบาด 1.4), `_h2` ไม่ดัง (ถูก), BellBeast `active_count: 5` |

- 1.2 อยู่ในเกณฑ์ปกติ (1.0–1.4) → ดังเพราะเปิดโหมดโรคระบาดเท่านั้น
- ฉีดผ่าน sqlite3 ใน git-bash แล้วภาษาไทยเพี้ยน → **ใช้ python (UTF-8)** และ copy `equipment_name/param_name/measure_th` จากแถวเดิมของ configparam เดียวกัน
- backup ก่อนแก้ (`Fullscale_V2\_backup\`): `data_db_before_labinject_0411.db`, `data_db_before_clinject_0411.db`, `labventure_db_before_clinject_0411.db`

### 6. ตรวจเวอร์ชัน Fullscale_V2 (ล่าสุดหมด)
| ระบบ | deploy | source แก้ล่าสุด | เนื้อหา |
|---|---|---|---|
| Uroboros | 04-Nov 09:02 | 04-Nov 09:01 | cmp ตอน deploy |
| BellBeast | 31-Oct 13:51 | 31-Oct 13:50 | `wwwroot` js/css 37 ไฟล์ตรง |
| LabVenture | 03-Nov 12:22 | 03-Nov 12:21 | server js 54 ไฟล์ + `client/dist` ตรง (`routes/algae.js` ต่างแค่ CRLF/LF) |
- Wayfarer ไม่ได้ตรวจ

### ของค้างใน db ทดสอบ (ยังไม่ได้ล้าง)
- `data.db` `lab_import_daily` id **40465–40469** → alarm ค้างจนค่าเก่าเกิน 480 นาที (~18:14 ความขุ่น, ~18:22 CL) หรือลบแถว / ฉีดค่าในเกณฑ์ที่เวลาใหม่กว่า
- `labventure.db` event class CL 8 ตัว **ยังเปิดอยู่** (เดิม enabled = 0)
- `app_settings.json` `epidemic = true` (ผู้ใช้เปิดเอง)
- กู้คืนได้จาก backup ข้างบน

### งานถัดไป
1. ตัดสินใจเรื่อง `LAB.import.daily` (ปิดอยู่ — ไม่รู้เหตุผล) → ต้องเปิดถ้าจะให้ lab alarm ใช้ค่าจริง; ถ้าเปิด importer จะ `DELETE` + insert ตามช่วงวัน → แถวที่ฉีดอาจหาย
2. ล้างข้อมูลทดสอบ (หรือปล่อยหมดอายุ) และตัดสินใจว่าจะเปิด CL event class ต่อไหม
3. commit (ถามผู้ใช้ก่อน, อย่า `git add -A` เพราะ working tree มีงานอื่นค้าง):
   - Uroboros: `Uroboros/AlarmModel.cs`, `Uroboros/MetricsSchemaHandlers.cs`, `Uroboros/Program.cs` (2 บรรทัด catalog), `Uroboros/alarm_rules.json`, `Uroboros.Tests/AlarmEngineTests.cs`, `Uroboros.Tests/AlarmMonitorTests.cs`
   - ⚠️ `Program.cs` มีงานอื่นค้างอยู่ด้วย → ใช้ `git add -p`
4. (เลือก) BellBeast `alarmmonitor.js` แสดง `pct_floor` ในตาราง/tooltip (ตอนนี้ band บนกราฟรับค่าใหม่จาก API แล้ว แต่ไม่ได้บอกว่ามาจาก pct_floor)
5. (เลือก) LabVenture: เตือนเมื่อ event class ถูกตัดเพราะสถานการณ์ไม่มี bound ของ param นั้น
6. หลังมีข้อมูลจริงหลายวัน: รัน `zsim2.py` ซ้ำเพื่อจูน `pct_floor` ต่อ param (DPS/TPS ดูข้อมูลเพิ่ม)

### ระวัง
- อ่าน live db ด้วย `sqlite3 -readonly` ถ้าไม่ได้ตั้งใจแก้; แก้ต้อง backup ก่อน (`.backup`)
- เครื่อง th-TH: python print ภาษาไทย/σ ใน git-bash พัง (cp874) → เขียนลงไฟล์ หรือเลี่ยงอักขระพิเศษ
- อย่าทับ `appsettings.json` ของ Uroboros ตอน deploy
- Uroboros ต้องหยุดก่อน copy dll (`STOP_FULLSCALE.cmd`)
