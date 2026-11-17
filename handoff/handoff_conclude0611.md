# สรุปรวม Handoff LabVenture (11 ก.ค. – 6 พ.ย. 2569)

> เอกสารนี้รวบรวมเนื้อหาจาก handoff ทุกไฟล์ในโฟลเดอร์ `handoff/` แล้วจัดใหม่ตาม feature เพื่อใช้อ้างอิงตอนเขียนรายงาน และใช้แทน handoff เดิมทั้งหมดได้
> แต่ละ feature มีหัวข้อ: **ความเป็นมา · วัตถุประสงค์ · Workflow ก่อน/หลัง · ปัญหาที่แก้ (อาการ → สาเหตุ → วิธีแก้)** และหัวข้ออื่นที่เกี่ยวข้อง (สูตร, config, API, การตัดสินใจ, งานค้าง)
> ปีในเอกสาร: ใช้ ค.ศ. ในวันที่ทางเทคนิค (2026-xx-xx) และ พ.ศ. ในหัวข้อ (2569 = 2026)

## สารบัญ
- [0. ไฟล์ต้นทางที่สรุปไว้](#0-ไฟล์ต้นทางที่สรุปไว้)
- [1. ภาพรวมระบบ](#1-ภาพรวมระบบ)
- [2. เส้นเวลาการพัฒนา](#2-เส้นเวลาการพัฒนา)
- [F1. Scientist Recorder — บันทึกผลแล็บ → AquaDAT + Excel DailyLab](#f1-scientist-recorder--บันทึกผลแล็บ--aquadat--excel-dailylab)
- [F2. Aquadat Offline Resilience — Stage 0/1/2](#f2-aquadat-offline-resilience--stage-012)
- [F3. Operator Record (OpRecord) — ตารางบันทึกแบบ Excel](#f3-operator-record-oprecord--ตารางบันทึกแบบ-excel)
- [F4. Operator Validation — ตรวจข้อมูลรายสถานี](#f4-operator-validation--ตรวจข้อมูลรายสถานี)
- [F5. OpDashboard — ติดตามความคืบหน้าการบันทึก](#f5-opdashboard--ติดตามความคืบหน้าการบันทึก)
- [F6. Operator Daily Report (หน้า DAILY)](#f6-operator-daily-report-หน้า-daily)
- [F7. สิทธิ์ผู้ใช้ / Bypass / การเข้าถึงหน้า](#f7-สิทธิ์ผู้ใช้--bypass--การเข้าถึงหน้า)
- [F8. Dashboard (Scientist) + ธีมสี Earth-tone](#f8-dashboard-scientist--ธีมสี-earth-tone)
- [F9. Chem Lab QC — re-design หน้า /chem-intake](#f9-chem-lab-qc--re-design-หน้า-chem-intake)
- [F10. ระบบ CAR — เลขอัตโนมัติ + พิมพ์ตามแบบฟอร์ม](#f10-ระบบ-car--เลขอัตโนมัติ--พิมพ์ตามแบบฟอร์ม)
- [F11. เกณฑ์สถานการณ์ → Event Class → Alarm → สีทุกหน้า](#f11-เกณฑ์สถานการณ์--event-class--alarm--สีทุกหน้า)
- [F12. งานฝั่ง BellBeast / MHxView / อุปกรณ์](#f12-งานฝั่ง-bellbeast--mhxview--อุปกรณ์)
- [F13. รายงานสาหร่าย (Algae print-out)](#f13-รายงานสาหร่าย-algae-print-out)
- [F14. DB health / self-init](#f14-db-health--self-init)
- [3. กฎ/ข้อตกลงถาวรกับผู้ใช้](#3-กฎข้อตกลงถาวรกับผู้ใช้)
- [4. การ Deploy และการดูแลระบบ](#4-การ-deploy-และการดูแลระบบ)
- [5. Gotchas ทางเทคนิค (สะสม)](#5-gotchas-ทางเทคนิค-สะสม)
- [6. งานค้าง / คำถามที่ยังไม่ได้คำตอบ (ณ 6 พ.ย. 2569)](#6-งานค้าง--คำถามที่ยังไม่ได้คำตอบ-ณ-6-พย-2569)
- [ภาคผนวก A — configID ที่ใช้บ่อย](#ภาคผนวก-a--configid-ที่ใช้บ่อย)
- [ภาคผนวก B — ไฟล์/เอกสารอ้างอิงนอกโฟลเดอร์นี้](#ภาคผนวก-b--ไฟล์เอกสารอ้างอิงนอกโฟลเดอร์นี้)

---

## 0. ไฟล์ต้นทางที่สรุปไว้

| ไฟล์ | วันที่ | เรื่องหลัก | อยู่ใน feature |
|---|---|---|---|
| handoff1107.md | 11 ก.ค. | Excel writer: RW_ref สลับเซลล์, TW Temp, compare_sheets | F1 |
| handoff1207.md | 12 ก.ค. | Stage 0 ดึง history จาก Uroboros, ตาราง operator_v1 | F2 |
| handoff1407.md | 14 ก.ค. | RecordingTable แบบ Excel (copy/paste, keyboard) | F3 |
| handoff1507.md | 15 ก.ค. | บั๊ก history ว่าง (var_data, topic mismatch) | F2, F3 |
| plan.md | 16 ก.ค. | แผนแม่บท Stage machine + IotRoom | F2 |
| handoff1607.md | 16 ก.ค. | Bypass/role, NaN check, listbox ปิดเอง | F7, F3 |
| handoff1707.md | 17 ก.ค. | time_slots, cell UX 6 จุด | F3 |
| validation_plan.md | 17 ก.ค. | Port validator จาก VB.NET | F4 |
| handoff1807.md | 18 ก.ค. | Formula column 20 สูตร | F3 |
| handoff1907.md | 19–20 ก.ค. | Lazy load, FILTRATION, Daily Report + AquaDAT SSE | F3, F6 |
| handoff2007.md | 20 ก.ค. | สูตร donut สารเคมี (ALUM/PACl/Cl) | F6 |
| handoff2207.md | 22 ก.ค. | sessionStorage, popup สลับสถานี, superadmin บันทึก, SCI stage-aware | F6, F3, F7, F2 |
| handoff2307.md | 23 ก.ค. | แก้บั๊กรายงาน, Recycle, Sankey, Filter availability | F6 |
| sci_webdesign.md | 24 ก.ค. | ธีม Earth-tone | F8 |
| op-progress-track_plan.md | 24 ก.ค. | แผน progress OpDashboard | F5 |
| handoff2407.md | 24 ก.ค. | Progress dots, schedule_overrides, ghost records, remarks | F5, F8 |
| handoff2507.md | 25 ก.ค. | remarks ไม่ refresh / RWS1+2 ปนกัน | F8 |
| handoff1108.md | 11 ส.ค. | Daily Report เปลี่ยน SSE → REST batch | F6 |
| re-design.md | 26 ก.ย. | ออกแบบ Chem Lab QC | F9 |
| handoff2609.md | 26 ก.ย. | Chem Lab v1 (mock), test/gap/edge cases | F9 |
| chem_lab_backend_spec.md | 26 ก.ย.–27 ต.ค. | Contract API/DDL/กฎ lock ของ Chem Lab | F9 |
| handoff2709.md | 27 ก.ย. | Chem Lab บน Uroboros จริง, CAR ออกด้วยคน, เลข CAR | F9, F10 |
| chem_compensation_workflow.docx | 27 ก.ย. | เอกสารหารือการชดเชยสารเคมี | F9 |
| handoff2809.md | 28 ก.ย. | สคบ-14 Word/PDF, CAR สบค-08/09, DailyLab export | F9, F10, F1 |
| handoff2909.md | 29 ก.ย. | Login ตาม stage, ซ่อนหน้า OP | F7 |
| handoff0210.md | 2 ต.ค. | Record/Excel/Queue retry/Control Value/Algae theme | F1, F13 |
| handoff2610.md | 26 ต.ค. | Record จำหลักเวลา, Chem Lab ย้อนขั้นได้ + re-design 2 | F1, F9 |
| handoff2710.md | 27–29 ต.ค. | Lab dropdown, Event Class/alarm/สี, slot strip, Daily Report REST + ต้นทุน, N/A, พิมพ์รายงาน | F9, F11, F8, F6, F1 |
| handoff2910.md | 29 ต.ค. | แผนฉุกเฉิน → scenario, test mode, TTS | F11, F12 |
| handoff3010.md | 30 ต.ค. | DAILY: backwash 00:00, SAVE DB popup, PRINT EXCEL MH_report | F6 |
| handoff3110.md | 31 ต.ค. | บล็อก SAVE, Recycle → %loss, BellBeast DailyReport, Auto-run, marquee, superadmin | F6, F12, F11, F7 |
| handoff0111.md | 1 พ.ย. | scenario_periods + Excel เดินขนาน 2.1/2.2 | F1, F11 |
| handoff0411.md | 4 พ.ย. | Alarm FSNL 30 นาที, anomaly pct_floor, ทดสอบ lab alarm | F11 |
| handoff0511.md | 5 พ.ย. | Annunciator ESP32 | F12 |
| handoff0611.md | 6 พ.ย. | eventclass.sync 500 → ซ่อม DB + self-init | F14 |
| e2e_may27/, e2e_jun18/ | 2 ต.ค. | ผลทดสอบ print-out เทียบต้นฉบับ (artifact) | F1, F13 |

---

## 1. ภาพรวมระบบ

### 1.1 ส่วนประกอบ

| ระบบ | Stack | Port | หน้าที่ |
|---|---|---|---|
| **LabVenture** | Node.js/Express + React/Vite + SQLite (`node-sqlite3-wasm`) + Python (openpyxl/xlwings) | dev 3001 / deploy **8889** | เว็บบันทึกผลแล็บ (Scientist), บันทึก operator, รายงานประจำวัน, CAR, Chem Lab, เกณฑ์สถานการณ์ |
| **BellBeast** | ASP.NET Core 9 Razor Pages | **443 (HTTP ไม่ใช่ HTTPS)** | shell หลัก, reverse proxy `/labventure/*` → LabVenture (ตัด `/labventure` ออก), IotRoom, MHxView, AlarmMonitor, Audio/TTS, DailyReport page |
| **Uroboros** | C# .NET 10 + SQLite | **8888** (ไม่มี auth) | engine เก็บข้อมูล AquaDAT, stage machine, alarm engine, Chem Lab backend (`/api/chemlab/*`), auto daily report |
| **AquaDAT** | ระบบภายนอกของ กปน. | REST `aquadat.mwa.co.th:12007`, GraphQL `https://aquadat.mwa.co.th/graphql` | แหล่งข้อมูล/ปลายทางบันทึก |
| TruckSidecar / Uroboros_mini | โปรแกรมข้างตาชั่ง | — | บันทึกรับสาร → `sidecar.db` → `chem.db` → Drive |
| Annunciator (ESP32) | firmware xiaozhi-esp32 | — | อุปกรณ์แสดง alarm/lab (งาน iot) |

- Production อยู่ที่ `C:\Users\peera\OneDrive\Desktop\Fullscale_V2\` — `DEPLOY_LabVenture` (ไม่ใช่ git), `Uroboros_proj`, `BellBeast_proj`, backup ใน `_backup\`
- โรงงาน: มหาสวัสดิ์ (MS) `plant_id = 2`
- สถานี operator: RWS1, RWS2 (น้ำดิบ), CHEM1, CHEM2 (เคมี), TPS (สูบส่ง), DPS (สูบจ่าย), CWS1, CWS2 (ตกตะกอน), FWS1, FWS2 (กรอง) + หน้ารวม DAILY
- ชื่อ station ใน AquaDAT ไม่มีตัวเลข: RWS, CHEM (REST ใช้ `CDS`), FWS, CWS, TPS, DPS

### 1.2 เส้นทางข้อมูลหลัก
1. **Scientist** `/record` → `node_records` (SQLite) → AquaDAT GraphQL + ไฟล์ Excel DailyLab รายเดือน → ล้มเหลวเข้าคิว `aquadat_queue` / `excel_queue` แล้ว retry อัตโนมัติทุก 5 นาที
2. **Operator** `/op-record` → stage 1 เขียน AquaDAT ตรง / stage 0 เขียน Uroboros (synced=0) / stage 2 ปฏิเสธ
3. **Daily Report** ดึง AquaDAT REST (stage 1) หรือ Uroboros (stage 0) → คำนวณใน server → SAVE DB (`summary_table`/`detail_table`) → พิมพ์ MH_report
4. **Alarm** LabVenture `event_classes` (อ้างอิงเกณฑ์สถานการณ์) → Uroboros `eventclass.sync` → `alarm.eval` → BellBeast popup/เสียง/Annunciator

### 1.3 Role
`scientist`, `operator`, `executive_3a`, `executive_3b`, `observer`, `superadmin` — รายละเอียดใน F7

---

## 2. เส้นเวลาการพัฒนา

| ช่วง | งานหลัก |
|---|---|
| 11 ก.ค. | ตรวจ Excel writer ของ Scientist (RW_ref, TW Temp) |
| 12–16 ก.ค. | Stage 0/1/2 offline resilience, ตาราง Uroboros แยก 2 ตาราง, RecordingTable แบบ Excel, ขยายครบ 10 สถานี |
| 16–18 ก.ค. | Bypass/role, time_slots, cell UX, Validation (port VB), Formula column |
| 19–25 ก.ค. | Lazy load, FILTRATION, Daily Report + สูตรสารเคมี, Sankey, Recycle, OpDashboard progress, ธีม Earth-tone, remarks |
| 11 ส.ค. | Daily Report เปลี่ยนเป็น REST batch |
| 26–29 ก.ย. | Chem Lab QC (re-design /chem-intake) + Uroboros backend, CAR เลขอัตโนมัติ + พิมพ์ฟอร์ม, สคบ-14 Word/PDF, DailyLab export, login ตาม stage |
| 2 ต.ค. | Record: ความถี่, queue retry, Control Value, Langelier, Algae theme |
| 26–31 ต.ค. | Chem Lab re-design 2, Event Class อ้างอิงเกณฑ์ + alarm + สี, slot strip, Daily Report ต้นทุน/N/A/SAVE DB/MH_report/Auto-run, แผนฉุกเฉิน, marquee, superadmin ทุก feature |
| 1–6 พ.ย. | scenario_periods + Excel เดินขนาน, anomaly pct_floor, Annunciator, DB self-init |

สถานะ commit: งานส่วนใหญ่ถูกรวมใน commit `9b9f74f` (snapshot 161 ไฟล์ตั้งแต่ 29 ต.ค.) และ `79bebe4` (DB health) เมื่อ 6 พ.ย. ก่อนหน้านั้นมี `38ea318` (print popup), `f19f196`, `fbdb318` (ธีม) — **ยังไม่ push** · repo Uroboros/BellBeast/iot ยังไม่ commit งานส่วนใหญ่

---

## F1. Scientist Recorder — บันทึกผลแล็บ → AquaDAT + Excel DailyLab

### F1.1 ความเป็นมา
- นักวิทยาศาสตร์บันทึกผลแล็บรายรอบ (2 ชม./12 ชม./รายวัน) ในหน้า `/record` ระบบต้องส่งค่าไป AquaDAT และเขียนลงไฟล์ Excel รายเดือน `MMDailyLab_MmmYY.xlsx` (ปี พ.ศ. 2 หลัก เช่น `07DailyLab_Jul69.xlsx`) ที่ระบบเดิมยังใช้อยู่
- ตรวจพบว่าค่า Jar Test (RW_ref) ลงผิดเซลล์ ค่าอุณหภูมิสำหรับ Langelier ไม่ถูกบันทึก การเขียน Excel ล้มเหลวเงียบๆ (ตอบว่าสำเร็จ) ไม่มี retry อัตโนมัติ และดาวน์โหลด/พิมพ์จากเว็บไม่ได้
- ภายหลังพบว่าเกณฑ์ (Control Value) และสีในไฟล์พิมพ์ไม่ผูกกับช่วงเวลาที่สถานการณ์เปลี่ยน

### F1.2 วัตถุประสงค์
1. ค่าในไฟล์ Excel ตรงกับชีทอ้างอิงทุกเซลล์ (ตรวจด้วย `compare_sheets.py` เทียบชีท "1" กับ "1_F")
2. การเขียนที่ล้มเหลวต้องแจ้งผู้ใช้และ retry ได้เอง
3. ดาวน์โหลด/พิมพ์รายงาน DailyLab (+ Operation daily report + สาหร่าย) จากเว็บได้
4. ช่วงเดินขนานกับระบบเดิม: ไม่ทำลายไฟล์ของระบบเดิม แต่ไฟล์พิมพ์ของเราลงสี/เกณฑ์ถูกต้องตามเวลา

### F1.3 Workflow ก่อน/หลัง

**ก่อน**
```
/record → POST /api/write/nodes → node_records → AquaDAT GraphQL
                                              → excel_writer.py เขียนไฟล์เดือน (xlwings)
  - เขียนไม่ได้ (ไฟล์ถูกเปิด/ไม่มีไฟล์) → บางกรณีตอบสำเร็จ
  - คิวค้าง ต้องกดส่งใหม่เอง · ไม่มีปุ่มดาวน์โหลด
  - Control Value ในไฟล์ = เกณฑ์ของสถานการณ์ที่ active "ตอนเขียน"
```
**หลัง**
```
/record → node_records → AquaDAT (ล้ม → aquadat_queue, dedup ต่อ slot)
                       → Excel ไฟล์ปลายทาง (2.1: เขียนเฉพาะค่าแล็บ ไม่แตะ style/CF/Control Value)
                          ล้ม → excel_queue + popup "บันทึก Excel ไม่สำเร็จ" [Retry]
  queueWorker ทุก 5 นาที → ส่ง "ค่าล่าสุดใน node_records" ใหม่ (Excel + AquaDAT ด้วย token ล่าสุด)
🖨 พิมพ์รายงาน → (2.2) สร้างไฟล์พิมพ์จาก DailyLab_theme.xlsx + ลงสีด้วยสคริปต์ตามเกณฑ์ ณ เวลาของแต่ละรอบ
```

### F1.4 ปัญหาที่แก้ (เรียงตามเวลา)

| วันที่ | อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|---|
| 11 ก.ค. | C26/C27/E24 (Alum RW_ref pH/Alk/Temp) ค่าสลับกัน | แก้ `LEGACY_CONFIG_TIME_OVERRIDES` ใน `routes/aquadatProcess.js` แล้วแต่ไม่ได้ restart server | restart server; mapping ที่ถูก: 984=Temp, 986=Turb, 987=pH, 988=Alk (05:00 = Alum, 09:00 = PACl), 8116=PACl Temp |
| 11 ก.ค. | J63/J69/S63/S69 (อุณหภูมิ TW1/TW2 สำหรับ Langelier) ว่าง | configID 4345/4346 มีใน `aquadat_configs.json` แต่ไม่อยู่ใน `nodes.json`/cell map | เพิ่ม `TW1.Temp`/`TW2.Temp` (12h) + cell map 09:00/21:00 |
| 11 ก.ค. | compare ข้ามแถว 63/69 | noise filter กว้างเกิน | ตัด 63/69 ออกจาก filter |
| 22 ก.ค. | คิว "AquaDAT ค้าง 3 รายการ" ทั้งที่แก้ค่าเดิม 3 ครั้ง | INSERT ทุกครั้งที่ล้ม | dedup ใน `routes/write.js`: ลบแถว pending/dead ที่ `trans_dtm` + `trans_time` เดียวกันและ configparam ซ้อนกันก่อน insert (ต้องเทียบ trans_time ด้วย ไม่งั้นลบคิวของรอบอื่น) |
| 2 ต.ค. | Excel ไม่ได้เขียนแต่ตอบสำเร็จ | ไม่ตรวจไฟล์ถูกเปิด, ลบ `~$` ของเครื่องอื่น, push fail ไม่เป็น error | ตรวจ r+b, ไม่ลบ lock ของเครื่องอื่น, push fail = error, ตั้งเซลล์ข้อความเป็น Text (`@`), stderr UTF-8 |
| 2 ต.ค. | คิวค้างไม่มีใคร retry | ไม่มี worker | `services/queueWorker.js` ทุก 5 นาที + endpoint `/queue/retry`, `/queue/retry-excel` |
| 1 พ.ย. | พิมพ์ย้อนหลัง/retry ได้เกณฑ์ผิด; เปลี่ยนสถานการณ์กลางวันแสดงได้ชุดเดียว | `getControlValues()` อ่านสถานการณ์ active ตอนรัน; `scenario_log` เก็บแค่ข้อความ | ตาราง `scenario_periods` + `scenario_period_thresholds` (ดู F11.6) |
| 1 พ.ย. | ทั้งคอลัมน์ขึ้นแดง | สถานการณ์ที่ไม่มีเกณฑ์บางตัว → Control Value ว่าง = 0 → CF `>$K$53` | Control Value ไม่มีเกณฑ์ = `-`, เลิกใช้ CF |
| 1 พ.ย. | ไฟล์พิมพ์ไม่มีสีเลย | openpyxl `copy_worksheet` ไม่ copy conditional formatting; template มีสีแดงทาตายตัว 9 ช่อง (V35, C36, F36, P36, P37, S37, V37, C49, F49) | สคริปต์ลงสีเอง + ล้างสีแดง/น้ำเงินตายตัวในช่องข้อมูล |
| 1 พ.ย. | CF ใน template ผิด | FW Cl₂ อ้าง `$K$53` แทน `$K$54`, X32:X37 ไม่มีกฎ, ช่วงความขุ่น CW ขาดแถว 36/37/49, สูตร T7 ใช้อัญประกาศโค้ง, ช่วงเตือนเป็นตัวเลขตาย, ป้าย `ResCl2 = 0.7 - 1.2` เก่า, T9–T11 นับไม่ครบ TW3–4 | ไม่ใช้ CF ในไฟล์พิมพ์; ป้าย D74/N74/W74 เขียนใหม่; ตัวนับย้ายไป `excel_breach_counts.json` |

### F1.5 การปรับความถี่/การแสดงผลในฟอร์ม
- (2 ต.ค.) RW Turb/Alk/Temp → `2h` (cell map เพิ่มแถว 03/07/…)
- (2 ต.ค.) OC: RW/TW = `12h` (09:00 + 21:00); CW/FW = `daily` + `fixedTime: "09:00"` + **`inSlot: true`** (อยู่ในปุ่ม 09:00 อย่างเดียว) — field opt-in ใหม่ แทนการเพิ่มความถี่
- Jar Test `fixedTime: "05:00"` แต่ต้องอยู่แท็บรายวัน (เคย regress เมื่อใช้ fixedTime อย่างเดียว)
- Langelier TW1/TW2 คำนวณอัตโนมัติ (`calcLangelier` สูตรเดียวกับ master J62) เป็นช่องอ่านอย่างเดียว
- Control Value ในฟอร์มอ่านจากสถานการณ์ (19 เซลล์ใน `excel_control_cells.json`, TW1–4 ใช้ชุดเดียวกัน) + เพิ่ม CW1–4 ResCl2 ≤ 0.3 ในสถานการณ์ปกติ
- (26 ต.ค.) `/record` จำหลักเวลาที่ผู้ใช้เลือกเองไว้ (รวมตอนเปลี่ยนวัน) จนกด F5 (`userPickedSlotRef`)
- (27 ต.ค.) ช่องค่าเกินเกณฑ์แสดง **น้ำเงิน** "เกินครั้งที่ 1" / **แดง** "เกินต่อเนื่อง N ครั้ง" / ป้าย "รอบก่อนเกินเกณฑ์" (F11)
- (1 พ.ย.) เกณฑ์ใน `/record` อ่านจาก `GET /api/scenarios/at?date&slot` (เกณฑ์ ณ เวลาของรอบนั้น)
- ข้อตกลง: Alum RW ref **ไม่ต้องเพิ่มช่องกรอก** (master form มีสูตร), ห้ามเพิ่มความถี่ใหม่

### F1.6 ดาวน์โหลดและพิมพ์รายงาน
| วันที่ | สิ่งที่ทำ |
|---|---|
| 28 ก.ย. | `GET /api/write/export.xlsx?from&to` (≤ 62 วัน) โหมด วันที่เลือก/ทั้งเดือน/กำหนดเอง — สร้างจาก DB (`node_records` + `slot_recorders`) บน `DailyLab_theme.xlsx` ด้วย `_write_day` ตัวเดียวกับไฟล์เดือน, 1 ชีท/วัน (วันไม่มีข้อมูล = ชีทว่างมีหัววันที่), ชื่อไฟล์ `DailyLab_2569-09-28` / `09DailyLab_Sep69` / `DailyLab_<from>_<to>` · print area `A1:AA79` fit 1×1 · ค่า daily ใช้ค่าล่าสุดของวัน · **ตัด PDF ทิ้ง** (Excel COM ช้า: 1 วัน ~15 วิ, ทั้งเดือน > 5 นาที) |
| 2 ต.ค. | แถบ "พิมพ์รายงาน" [DailyLab \| สาหร่าย] |
| 29 ต.ค. | ปุ่ม **🖨 พิมพ์รายงาน** → popup `PrintReport.jsx` 3 แบบ (ไม่มีช่วงวันที่ตามที่ผู้ใช้ขอ): **DailyLab** (วันที่ของหน้า) · **DailyLab + Operation daily report** (เรียก `/api/daily-report/fetch-all` ~20 วิ → ครบ = ดาวน์โหลด `export.xlsx?dosage=1`; ไม่ครบ = หน้าตรวจข้อมูล ปริมาณน้ำ/สารเคมี IN-OUT/Dosage แล้วถามว่าจะ export ไหม) · **สาหร่าย** (ปฏิทินเลือกเฉพาะวันที่มีข้อมูล) — commit `38ea318` |
| 31 ต.ค. | "DailyLab + Operation": วันนี้/เมื่อวาน = query สด, เก่ากว่า = ค่าจาก SAVE DB (`MhCells`); ไม่เคย SAVE → แจ้งให้ไป SAVE ที่หน้า DAILY |
| 31 ต.ค. | ปลด `requireAuth` ของ `export.xlsx` (ผู้ใช้เลือก) เพื่อให้หน้า BellBeast `/DailyReport` ดาวน์โหลดได้ (F12) |

**Daily Dosage ในฟอร์ม** = ค่า ACTUAL ของ donut หน้า DAILY: คอลัมน์ X/Y/Z/AA = Phase 1–4 · แถว 4 Alum, 5 PACl, 7 Pre Cl₂, 9 Post Cl₂ · แถว 8 Intermediate Cl₂ ว่าง (โรงงานไม่จ่าย) · วันยังไม่ครบ/ค่า null = ว่าง (`dailyLabDosageCells`; กรณีดึงจาก SAVE DB ใช้ `dailyLabDosageFromMh` map MhCells O/Q/S/U แถว 27 Alum · 35 PACl · 29 Pre · 33 Post) · ค่าสด มาจาก `historyCache` ในหน่วยความจำ server (restart แล้วหาย)

### F1.7 ช่วงเดินขนาน (Parallel run) — 1 พ.ย.
| # | การตัดสินใจ | เหตุผล |
|---|---|---|
| 2.1 | **ไฟล์ปลายทาง** (ของระบบเดิม) เขียนเฉพาะค่าแล็บ ไม่แตะ style/CF/Control Value · ไม่มีไฟล์ → ไม่สร้างเอง เข้าคิวรอ (ไม่นับ attempt จน dead) · ไม่มีชีทวัน → error | ระบบใหม่ยังไม่แทนระบบเดิม ผู้ใช้สร้างไฟล์เดือนเองครบทุกวัน |
| 2.2 | **ไฟล์พิมพ์ของเรา** จาก `DailyLab_theme.xlsx` ลงสี/เกณฑ์เอง (`services/dailyLabMarkup.js`) | CF ถูกคนแก้จนไม่เป็นมาตรฐาน และ CF ใช้เกณฑ์ตามเวลาไม่ได้ |
| สี | น้ำเงิน = เกินครั้งแรก, แดง = เกินต่อเนื่อง (นับข้ามวัน ย้อน 7 วัน) | เหมือนหน้าเว็บ |
| หมายเหตุ | B77–B79 ขึ้นต้นด้วยการเปลี่ยนเกณฑ์ `*HH:MM <เหตุการณ์>: <note>` (เกิน 3 → `(+อีก N รายการ)`) | ผู้ใช้กำหนด |
| Control Value | = เกณฑ์ ณ สิ้นวัน; ไม่มีเกณฑ์ → `-` | ชีทแสดงได้ชุดเดียว ส่วนที่เปลี่ยนกลางวันอธิบายในหมายเหตุ |
| อนาคต | ย้าย 2.2 ไปแทน 2.1 (ต้องเพิ่ม "คืนสีปกติ" ให้ช่องที่ไม่เกิน) | ฟังก์ชัน `dailyLabMarkup` + `breachMarks` เตรียมไว้แล้ว |

ทดสอบ E2E ผ่านหน้าเว็บบน deploy แบบ offline (AquaDAT/LINE/BellBeast ชี้ `127.0.0.1:9`): กรอก 476 ค่าของ 2026-11-01 ทุกรอบ → 468 ค่าที่มีช่องตรง DB ทุกช่อง, style/CF ของไฟล์ปลายทางไม่เปลี่ยน · `test_scenario_history.js` 12/12

### F1.8 ไฟล์หลัก
`server/routes/write.js`, `services/excelWriter.js`, `excel_writer.py` (`_write_day`, `build_export`, entry `--build <json> <out>`), `services/queueWorker.js`, `services/dailyLabMarkup.js`, `services/scenario.js`, `services/sendFile.js`, `config/{nodes,params,excel_cell_map,excel_control_cells,excel_breach_counts,paths}.json`, `templates/DailyLab_theme.xlsx`, `client/src/pages/Record.jsx`, `components/PrintReport.jsx`, `utils/dailyReportIssues.js`, `scripts/e2e_excel_test.js` (20/20 ใน ต.ค.; 19/22 หลังกติกา 2.1 — 1d/3a เป็นปัญหา config เดิม) · env ทดสอบ: `LV_DB_PATH`, `LV_EXCEL_DIR`, `LV_LOCAL_DATA`

### F1.9 ผลทดสอบเทียบต้นฉบับ (โฟลเดอร์ `e2e_may27/`)
กรอกผ่าน UI จากชีท 27 พ.ค. → print-out ตรง 540 ช่อง ต่าง 28 ช่อง (RW pH ชั่วโมงคี่, Algae Total/ClogFilter, JarTest RW_ref, Chem.*.Al/Fe/Mn/Cl ที่ต้นฉบับมีแต่ไม่ได้กรอกหรือไม่มีช่อง) — ทำก่อนมี Control Value/Langelier · ไฟล์ `printout_2026-05-27.xlsx`, `compare_sheet27.txt`
ข้อสังเกต: ไฟล์เดือนจริงบน OneDrive มีสูตรที่ผู้ใช้เพิ่มเอง (D1/E1/V1/X1) และบางเซลล์ไม่ตรง DB → export ยึด DB + theme เป็นหลัก

### F1.10 งานค้างของ F1
- RW pH ฟอร์มจดราย 4 ชม. แต่ระบบตั้ง `12h` (ยังไม่ได้คำตอบ)
- `DailyLab_theme.xlsx` ไม่มีแถว Max/Min/Avg และสูตรบางช่อง; `clean_dailylab_theme.py` ยังไม่ได้รัน
- ไม่มีช่องในฟอร์ม: `TW1/TW2.Langelier`, `JarTest.*.RecommendDose1/2` · `RW.TSS` เป็น daily แต่ cell map มีแค่ 05:00
- UI: ข้อความ "บันทึกสำเร็จ — รอบ X" ค้างหลังสลับรอบ, คำเตือน Excel ค้างหลัง retry, ปุ่มแสดง "รอบ daily"
- การเปลี่ยนสถานการณ์จาก test mode ถูกนับเป็นช่วงจริง (มี `[TEST]` ในหมายเหตุ) · CAR อัตโนมัติยังใช้เกณฑ์ปัจจุบัน (ยังไม่ตัดสินใจเปลี่ยน)
- ข้อมูลทดสอบ 2026-11-01 ยังอยู่ใน DB deploy และชีท 1 ของ `11DailyLab_Nov69.xlsx`
- ไฟล์ไม่ใช้แล้ว: `templates/algae_master.xlsx`, `scripts/build_algae_master.py`

---

## F2. Aquadat Offline Resilience — Stage 0/1/2

### F2.1 ความเป็นมา
- เมื่อ AquaDAT ล่ม ผู้ใช้ login ไม่ได้ (login ผ่าน AquaDAT) และบันทึกไม่ได้ แต่ **รายงานประจำวันต้องทำได้ทุกเงื่อนไข**
- ตาราง history ในหน้า `/op-record` ว่างเปล่าทุก stage เพราะ: client ดึง history จาก GraphQL เฉพาะ stage 1, Uroboros ยังไม่มี `GET /api/operator/data`, server ส่ง `station_id+date` แทน configIDs, และตาราง Uroboros `AQ_readings_narrow_v2` มีแค่ 154/1,163 configIDs (เฉพาะ dashboard)

### F2.2 วัตถุประสงค์
ทำระบบ 3 stage ให้บันทึก/อ่านข้อมูลได้ต่อเนื่อง และ sync กลับ AquaDAT อัตโนมัติเมื่อกลับมาออนไลน์

### F2.3 Stage state machine
```
ping OK & stage was 0  → Stage 2 (syncing)
ping OK & stage was 2  → retry sync
ping OK & stage was 1  → คง Stage 1
ping FAIL & stage was 1 → Stage 0 (offline)
sync เสร็จ (pending = 0) → Stage 1
```

| Stage | ความหมาย | Aquadat.refresh | LabVenture เขียนที่ | Login |
|---|---|---|---|---|
| 1 | ปกติ | รัน → AQ_readings_narrow_v2 (synced=1) | AquaDAT ตรง | token AquaDAT จริง |
| 0 | AquaDAT ล่ม | หยุด | Uroboros ผ่าน BellBeast (synced=0) | bypass JWT |
| 2 | กำลัง sync | หยุด | ปฏิเสธ 503 "กำลัง sync ข้อมูล" | bypass JWT |

- แหล่งความจริงของ stage = RAM ของ Uroboros + `stage.json` (คงข้าม restart) · `AquadatPingTask` ping ทุก 60 วิ
- ตัวกระจาย stage = BellBeast IotRoom device `"aquadat-connector"` (`/api/iot/room/join|data|poll`, heartbeat 60 วิ กันหมดอายุ 5 นาที) → LabVenture `services/stageMonitor.js` poll `/api/stage` ทุก 30 วิ (poll ล้มเหลว = คงค่าเดิม)
- `SyncPendingAsync`: SELECT synced=0 LIMIT 100 → GraphQL → UPDATE synced=1; เวลาใน mutation ต้องเป็น `"HH:mm"` (varchar(5))

### F2.4 Workflow ก่อน/หลัง
**ก่อน:** stage 1 เท่านั้นที่ใช้งานได้; ตาราง history ว่าง; client ตัดสินใจ endpoint เอง (เริ่มที่ stage=1 เสมอ → race)
**หลัง:**
```
Stage 1: GET /api/operator/history → server getStage()=1 → GraphQL AquaDAT (pattern) → {cfg:{HH:mm:value}}
         POST /record → writeData() → AquaDAT
Stage 0: GET /history → fetchUroborosHistory(configIds) → BellBeast:443/api/operator/data → Uroboros:8888
         UNION AQ_readings_narrow_v2 + AQ_readings_operator_v1 (ไม่กรอง synced)
         POST /record → forwardToUroboros → Uroboros INSERT synced=0 (เลือกตารางตาม DashboardIds)
         date picker ล็อกวันนี้ + badge "Offline — Today Only"
Stage 2: อ่านเหมือน Stage 0, เขียน → 503; Uroboros push synced=0 ของทั้ง 2 ตาราง → AquaDAT
```

### F2.5 การตัดสินใจออกแบบ (12 ก.ค.)
| เรื่อง | ตัดสินใจ | เหตุผล |
|---|---|---|
| ดึงทีละ topic หรือทั้งหมด | ทีละ topic | re-fetch ตอนแก้ค่า, ไม่โหลดหนัก, stage 0 จำกัดวันปัจจุบัน |
| พารามิเตอร์ถึง Uroboros | `configIDs` (comma) | configID unique ทั้งระบบ, ฟิลด์ station ใน Uroboros ว่าง |
| SSD wear | แยก 2 ตาราง: `AQ_readings_narrow_v2` (154 IDs, ~15 นาที) + `AQ_readings_operator_v1` (1,036 → 1,166 IDs, 30 นาที, task `Operator.refresh`) | ~120 MB/วัน เทียบ ~8.4 GB/วันถ้าตารางเดียว 30 วิ |
| schema ตารางใหม่ | เหมือน narrow_v2 100% | SyncPending อ่าน synced=0 ทั้ง 2 ตารางได้โดยไม่ refactor |
| กรอง synced ตอนอ่าน | ไม่กรอง | ผู้ใช้ต้องเห็นข้อมูลทั้งวัน |
| ใครแยกตารางตอนเขียน | Uroboros (`OperatorRouting.DashboardIds` HashSet) | client POST เหมือนเดิม |
| ClearAll | ลบเฉพาะ synced=1 | กันข้อมูล offline ที่ยังไม่ sync หาย |

### F2.6 ปัญหาที่แก้
| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| SSL connection error | ใช้ `https://localhost:443` แต่ BellBeast เป็น HTTP | `http://localhost:443` |
| Stage 2 ไม่ retry | trigger เฉพาะ prevStage==0 | เพิ่ม `else if (prevStage==2)` |
| SQLite ไม่มี trans_type/plant_id | LabVenture ไม่ส่ง | เพิ่มใน `operator_nodes.json` + OpRecord |
| GraphQL 404 | URL ผิด `http://...:12007/graphql` | `https://aquadat.mwa.co.th/graphql` |
| Crash JSON null | ไม่ตรวจ `data` | ValueKind guard + ตรวจ errors |
| varchar(5) truncation | เวลา `"00:00:00"` | `r.Ts[11..16]` → `"HH:mm"` |
| BellBeast ล่มเมื่อ LabVenture ไม่รัน | proxy ไม่มี try/catch | คืน 502 |
| history ว่าง (stage 1) | `var_data` เป็น object หลายตัวไม่มี `[]` ครอบ → `JSON.parse` ล้ม → ข้ามทุกแถว | `JSON.parse('[' + var_data + ']')` + รองรับ nested array, ข้ามค่าที่เป็นสูตร (`=`) |
| history ว่าง (topic) | ชื่อ topic ใน `operator_nodes.json` ("FLOW RPS1") ≠ `aquadat_patterns.json` ("Flow") | ระยะแรก: ดึงทุก pattern ของสถานี map ด้วย configparam_id · ต่อมา (19 ก.ค.) เพิ่ม `node_topics` ใน pattern เพื่อ lazy load ทีละ topic |
| side effect ใน `setStage()` updater | React อาจเรียก updater ซ้ำ (Strict Mode) | ย้าย side effect ออกมาก่อน `setStage(s)` ใช้ `prevStageRef` |
| client เลือก endpoint ตาม stage เอง | ค่าเริ่มต้น stage=1 ก่อน poll กลับมา | เรียก `/api/operator/history` อย่างเดียว ให้ server ตัดสิน |

### F2.7 Scientist (`/record`) รับรู้ stage (22 ก.ค.) และ Login ตาม stage (29 ก.ย.)
- `Login.jsx`: stage `null` = "กำลังตรวจสอบการเชื่อมต่อ..." (กัน flash) · stage 1 = ฟอร์ม AD อย่างเดียว · stage 0/2 = แบนเนอร์ "⚠️ ระบบออฟไลน์" + ปุ่ม bypass **Scientist / Operator เท่านั้น** · **Ctrl+Shift+F12** = แสดงปุ่ม Super Admin bypass
- server `POST /api/auth/bypass`: stage 1 รับเฉพาะ `superadmin`; stage อื่นรับ scientist/operator/superadmin; อื่นๆ 403
- `/record`: poll stage ทุก 30 วิ; จุดสถานะ 🟢 AquaDAT / 🔴 ออฟไลน์ / 🟡 ซิงค์; stage 0 → bypass บันทึกได้ (`canRecord = !bypassRole || stage === 0`); เมื่อ stage ตก 1→0 ขณะ login เป็น scientist → auto-switch เป็น scientist bypass (`autoSwitchFiredRef` กันยิงซ้ำ) · สำหรับ SCI stage 1 = stage 2 (ไม่มี auto-retry, ปุ่มคิวกดเอง)
- `GET /api/operator/stage` ไม่ต้อง login

### F2.8 Scenario ที่ออกแบบรองรับ
A ปกติ · B AquaDAT ล่ม (force วันนี้) · C sync หลังกลับมา · D Uroboros restart ระหว่าง stage 0 (ข้อมูล synced=0 อยู่ใน SQLite ปลอดภัย, ตารางสร้างใหม่ IF NOT EXISTS) · E stage ตก 1→0 ขณะดูวันย้อนหลัง (บังคับกลับวันนี้)

### F2.9 งานค้างของ F2
- E2E เต็มของ stage 0 → 2 → 1 ยังไม่ได้ทดสอบหน้างานจริง (ตัด AquaDAT จริง)
- `OperatorRouting.DashboardIds` hardcode ใน Program.cs — ถ้า bypassList ของ AquadatQueryTask เปลี่ยนต้องแก้ด้วย
- `writeData` ใน `aquadat.js` ไม่มี AbortSignal → รอ TCP timeout (~60 วิ+) เมื่อ AquaDAT ไม่ตอบ
- `/api/operator/*` ไม่ได้ block ฝั่ง server สำหรับ role ที่ซ่อนหน้า OP (ซ่อนแค่ UI)

---

## F3. Operator Record (OpRecord) — ตารางบันทึกแบบ Excel

### F3.1 ความเป็นมา
Operator ต้องบันทึกค่าพารามิเตอร์หลายร้อยตัวต่อสถานี ทีละ topic ทุก 1–4 ชม. เดิมเป็นตารางพื้นฐานที่ UX ไม่ดี (spinner, dropdown ต้องคลิกลูกศร, copy/paste ไม่ได้, keyboard ไม่ทำงานจริง) และมีเฉพาะ RWS1

### F3.2 วัตถุประสงค์
ตารางที่ทำงานเหมือน Excel จริง ขับเคลื่อนด้วย config 100% (`server/config/operator_nodes.json`) และขยายครบทุกสถานี

### F3.3 Workflow
```
operator_nodes.json → stations[].topics[] (topic, time_slot | time_slots[], params[])
  params: configparam_id, equipment_name, param_name, unit, type, readonly?, formula?
→ GET /api/operator/nodes?station_id=X (lazy ต่อสถานี)
→ RecordingTable (1 instance/topic) → dirtyValues → POST /api/operator/record (stage-aware)
→ GET /api/operator/history?station_id&date&topic (lazy ต่อ topic, AbortController)
```
**ระบบชนิดข้อมูล:** `FLOAT(n)` (filter ตัวเลข + toFixed(n)) · `INT` (Math.round) · `TEXT{A,B,C}` (listbox, ไม่มีช่องว่างรอบ `{}`) · `readonly: true` · `formula: "..."` (คำนวณ ไม่ให้แก้)
**ช่วงเวลา:** `time_slot` 13 (ทุก 2 ชม. 00–24), 25 (ทุก 1 ชม.), 9 (ทุก 3 ชม.) หรือ `time_slots: [...]` กำหนดเอง เช่น COMPENSATE `["00:00","24:00"]`, %SLUDGE `["00:00","02:00","06:00",…]`, STATUS/LEVEL FWS ทุก 4 ชม., BACKWASHING ทุก 8 ชม. (15 topic) · TPS/DPS FLOW/IHM = 25, SUCTION/TEMP = 9, RWS = 13 — **ห้ามแก้ time_slot โดยไม่ได้รับคำสั่ง**

### F3.4 ฟีเจอร์ของ RecordingTable
| ฟีเจอร์ | รายละเอียด |
|---|---|
| TEXT เป็น listbox | `<select size={opts.length+1}>` เปิดทันที, ไม่ขยายคอลัมน์ (`minWidth 90px` + absolute) |
| แสดงผลตามชนิด | `formatDisplayVal()` INT/FLOAT(n) + comma คั่นหลักพัน (19 ก.ค.) |
| Copy/Paste ช่วง | Ctrl+C/V ภายใน (tile ถ้าปลายทางใหญ่กว่า) + marching ants + เขียน OS clipboard แบบ tab-separated |
| Paste TEXT | ข้ามค่าที่ไม่อยู่ใน options ของช่องปลายทาง |
| กรองตัวอักษร | regex: ตัวเลข, ลบเฉพาะหน้า, จุดทศนิยมเดียว |
| Keyboard | ลูกศร/Tab/Enter/F2/Delete/Backspace, Shift ขยายช่วง, auto-scroll คำนวณเองโดยเคารพ sticky header/column |
| Escape | `cancelEdit()` คืนค่าก่อนแก้ (`preEditValueRef`; ไม่เคย dirty → ลบ dirty ด้วย `value=undefined`) |
| Formula column | ช่องคำนวณพื้นสีฟ้า + ƒ; per-slot (`isFormulaSlot`) |
| Focus จาก URL | `?station&date&topic&focus=<cfg>` (ใช้จากการ์ด Filtration) |
| ยืนยันก่อนสลับสถานี | มีค่าที่ยังไม่ส่ง → popup (22 ก.ค.); DAILY → สถานีอื่นไม่ถาม |

### F3.5 ปัญหาที่แก้
| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| Ctrl+C/V จาก keyboard จริงไม่ทำงาน (แต่ test ผ่าน) | `e.preventDefault()` ใน TD `onMouseDown` ทำให้ Chrome block `.focus()` | ลบ preventDefault ใช้ CSS `select-none` แทน |
| Ctrl+C/V ไม่ทำงานบนแป้นไทย | `e.key` = "แ" | ตรวจ `e.code === 'KeyC'/'KeyV'` ด้วย |
| คลิก tab topic แล้ว Ctrl+C ไม่ทำงาน | ปุ่ม tab แย่ง focus | `onMouseDown={e => e.preventDefault()}` บนปุ่ม tab |
| พิมพ์ทับเห็นค่าเก่าแวบ | set dirty ใน useEffect หลัง paint | เรียก `onCellChange(initChar)` ใน `startEdit()` (React batch) |
| พิมพ์ "1" ได้ "11" | keypress ไปลง input ที่ mount ใหม่ | flag `skipNextChangeRef` |
| พิมพ์ตัวอักษรบนช่องตัวเลข → ได้ "—" | initChar ไม่ถูกกรอง | กรอง initChar ก่อน startEdit |
| commit "-" หรือ "." | `parseFloat` = NaN ไม่ได้ตรวจ | NaN → ล้างช่อง |
| listbox ปิดเองตอน history โหลด | `opNodes` refetch → object ใหม่ → effect reset topic → `setEditCell(null)` | แยก effect: reset เมื่อเปลี่ยนสถานี / คง topic ถ้ายังมีอยู่ |
| overlay loading หายกลางคัน | fetch เก่าจบแล้วสั่ง `setHistoryLoading(false)` | AbortController + ตรวจ `signal.aborted` |
| CHEM2 CHLORINE P#34 ขาด 6 configID | pattern 352 ส่งไม่ครบ | เพิ่ม pattern 9 เป็น entry ที่ 2 ของ topic เดียวกัน |
| Formula ข้าม topic เห็น 0 | topic อื่นยังไม่โหลด (lazy) | ยอมรับเป็น trade-off |

### F3.6 Formula column (18 ก.ค.) — อ้างอิงเต็มใน `js_refer/col_formula.md`
ไวยากรณ์: `{cfgId}` = ค่ารอบนี้, `{cfgId,-1}` = รอบก่อน, `[slot]` = เวลา · ผลเป็น `undefined` → ช่องนั้นกรอกเองได้ (ยอดยกมา)

| สถานี | cfgId | สูตร |
|---|---|---|
| RWS1 | 8384, 8385 | `[slot]==="00:00" ? 0 : ({4}-{4,-1})*100` / `{7}` |
| RWS2 | 8386, 8387 | เหมือนกันด้วย `{42}`, `{44}` |
| TPS | 8388 | `00:00 ? undefined : 01:00 ? {759}*100 : ({759}-{759,-1})*100` |
| DPS | 8389, 8390 | แบบ TPS ด้วย `{873}`, `{875}` |
| CHEM1 ALUM | 87, 90 | `{1}*{89}*5.4135`, `{2}*{92}*5.4135` |
| CHEM1 Cl | 130/132/134/136 | `{129}*{1}*3.6`, `{131}*{2}*3.6`, `{133}*{1}*3.6`, `{135}*{2}*3.6` |
| CHEM1 PACl | 8401, 8403 | `{1}*{8402}*8.6434`, `{2}*{8404}*8.6434` |
| CHEM2 ALUM (L/min) | 149, 152 | `({151}*{39}*5.4135)/3600/60`, `{154}*{40}` |
| CHEM2 Cl | 8391–8394 | `{192}*{39}*3.6/3600` … |
| CHEM2 PACl (L/h) | 8415, 8417 | `{39}*{8416}*0.0024` (0.0024 = 8.6434/3600) |

CHEM1 SET POINT หน่วย m³/s (cfg 1, 2); CHEM2 หน่วย m³/h (cfg 39, 40) · CWS/FWS ไม่มี formula

### F3.7 ขยายครบทุกสถานี (16 ก.ค.)
params จาก `record_opt.xlsx`: RWS2 81, CHEM1 100, CHEM2 112, TPS 76, DPS 72, CWS1 48, CWS2 58, FWS1 146, FWS2 254 · Uroboros `operator_configids.json` 1,036 → 1,166 IDs · ชื่อ topic ตามหัวชีท Excel (ไม่ต้องตรงกับ `aquadat_patterns.json`)

### F3.8 งานค้างของ F3
- Tab ข้ามแถวยังไม่ scroll ตาม · ยังไม่รองรับ touch/mobile · FWS2 BACKWASHING 84 params/topic อาจต้อง virtualization
- CHEM1 topic คงเหลือ/รับเข้า/ส่งคืน ยังไม่มี pattern_id
- หน้า OP ทั้งสอง (`op-dashboard`, `op-record`) **ถูกซ่อนจากทุกคนยกเว้น superadmin bypass** ตั้งแต่ 29 ก.ย. (`HIDDEN_PAGES` ใน `pageAccess.js`; ตั้ง `HIDDEN_PAGES = []` เพื่อเปิดกลับ) — หน้า DAILY (`op-record?station=DAILY`) อยู่ใต้ route เดียวกัน · ตั้งแต่ 31 ต.ค. superadmin (ทั้งชื่อ AD และ bypass) เปิดได้ทุกหน้า

---

## F4. Operator Validation — ตรวจข้อมูลรายสถานี

### F4.1 ความเป็นมา
ข้อมูลที่ operator บันทึกต้องตรวจความถูกต้องก่อนสรุปรายงานประจำวัน กฎตรวจมีอยู่แล้วในโปรแกรมเดิม `DailyReportValidator.vb` (Sword, VB.NET) จึง port มาเป็น JavaScript

### F4.2 วัตถุประสงค์
ตรวจรายสถานีจากข้อมูลบนจอ (รวมค่าที่ยังไม่ส่ง) แสดงผลรายขั้นตอน และทำสีที่เซลล์ที่ผิด

### F4.3 Workflow
```
หน้าย่อยสถานี: liveHistory = merge(history, dirtyValues) → [▶ Run]
→ POST /api/operator/validate {station_id, date, data:{cfg:{slot:value}}}
→ validator (pure function, ไม่ query DB) → {steps[{index,label,status,messages,cellMarks}], cellMarks, summary}
→ ValidationPanel (แผงขวา 30%, toggle Dashboard/Validate) + เซลล์ bg-red-100 / bg-orange-100
```
สัญลักษณ์: ✓ ผ่าน · ✗ FAILED (block รายงาน) · ⚠ WARNING · แดง = ขาด/ผิดตำแหน่ง/totalizer ไม่ตรง · ส้ม = ค่าผิดปกติ · แดงชนะส้มเมื่อซ้อน

### F4.4 ขั้นตอนตรวจ (สรุป)
- **RWS1 (9 ขั้น):** ค่าว่าง (รายชั่วโมง/2 ชม./รายวันที่ 00:00), ค่าติดลบ, Totalizer vs Net `(tot−totPrev)×100 ≈ net` (tol 1.0) → FAILED, ยอดรายวันที่เที่ยงคืน, Setpoint vs Actual 15%, Energy feeder, กลุ่มปั๊ม (กำลัง/ความเร็ว/อุณหภูมิ, อุณหภูมิกระโดด > 20°C), พลังงานรายวัน vs ΣkW (10%), ชั่วโมงเดิน IHM (±4 ชม. warning, ±8 ชม. failed)
- **RWS2:** ตรรกะเดียวกัน SP หน่วย m³/hr เทียบ actual×3600
- **TPS (11 ขั้น), DPS (7 ขั้น):** flow, totalizer/net, ระดับ (cm vs m), กลุ่มปั๊ม 1 ชม./3 ชม., พลังงาน, IHM, feeder monotonic, service water, building totalizer
- **FWS1 (16 บ่อ), FWS2 (28 บ่อ):** total flow vs สถานะ, flow ต่อบ่อ, ความขุ่น > 1 NTU, totalizer รายวัน
- **CWS1 (Pulsator 5 ขั้น), CWS2 (Solid Contact 6 ขั้น + stirrer)**
- **CHEM1/CHEM2 (5 ขั้น):** dosing vs สถานะปั๊ม, ระดับถัง < 10%/5%, totalizer รายวัน, monotonic, Cl ≤ 15 mg/L

ไฟล์: `server/services/dailyValidator_{RWS,TPS,FWS,CWS,CHEM}.js`, `routes/operator.js` (dispatch 10 สถานี), `OpRecord.jsx`

### F4.5 สถานะ / งานค้าง
- RWS1 ทดสอบกับข้อมูลจริงแล้ว (เจอ NetA ติดลบจริง) · สถานีอื่น **configID หลายตัวยังเดาจาก pattern** (FWS offset +16/บ่อ, CHEM tank/status/rate) ต้องเทียบ VB จริง — VB จริงของ CHEM1 ALUM = 89/92/93/96/8037, PACl = 8402+, Cl = 127/128/6972
- หน้า DAILY: QUERY + VALIDATE ALL + `StationValidationCard` ยังไม่ทำ · 30 ต.ค. **ปุ่ม VALIDATE ถูกเอาออกจากหน้า DAILY** (endpoint `/api/daily-report/validate` ยังอยู่) — กฎกล่องแดงของหน้า DAILY ใช้ `dailyReportIssues` แทน (F6)

---

## F5. OpDashboard — ติดตามความคืบหน้าการบันทึก

### F5.1 ความเป็นมา
`/op-dashboard` แสดงจุดสีตามเวลานาฬิกาเท่านั้น ไม่ได้ตรวจข้อมูลจริง, ไม่มี progress bar, `OpTodoPanel` เป็น stub คืน `[]`, ใช้ grid 12 จุดตายตัว (ชั่วโมงคี่) ยืมจาก Dashboard ของ Scientist ทั้งที่แต่ละสถานีบันทึกต่างความถี่

### F5.2 วัตถุประสงค์
ให้ op-dashboard ตรวจข้อมูลที่บันทึกจริงใน Uroboros เทียบกับ config แล้วแสดงจุด/แถบความคืบหน้า/รายการค้างเหมือนคู่ Dashboard↔Record ของ Scientist

### F5.3 Workflow หลังแก้
```
LabVenture server (operator.js) refreshProgressCache() ตอนโหลด + ทุก 5 นาที
  → อ่าน operator_nodes.json + schedule_overrides.json → รวม configparam_id ที่ไม่ใช่ formula
  → fetchUroborosHistory(allIds, today) → buildProgressData() → _progressCache
GET /api/operator/progress?date  (วันนี้ = cache, ย้อนหลัง = คำนวณทันที)
GET /api/operator/todos          (สถานีที่ recorded < expected)
Client poll 5 นาที → จุดต่อสถานีจาก slotSummary keys → done(เขียว)/partial(เหลือง)/missed(แดง)/future(เทา)/empty
```

### F5.4 กฎการนับ (สถานะสุดท้าย 24 ก.ค.)
- นับระดับ (configID, slot) ด้วย `slotsForParam()` = override ต่อ configID ก่อน fallback เป็น slot ของ topic
- slot "ครบ" เมื่อ rec/exp **> 60%**; partial = มีบางส่วน
- สถานีเสริม (`optional_stations`: CHEM1, CHEM2, FWS1, FWS2) ไม่นับในยอดรวม, ไม่แสดง missed, แสดง badge `slotDone/slotTotal`
- `server/config/schedule_overrides.json` (แก้ schedule ที่นี่ ไม่แตะ `operator_nodes.json`): FEEDER `["00:00","09:00","22:00","24:00"]`, PUMP TOTALIZER/COMPENSATE/IHM `["00:00","24:00"]`, %SLUDGE `["02:00",…,"22:00"]`, CWS2 DRAIN `["08:00","16:00","24:00"]` · `excluded_configids`: CWS1 OVERVIEW 206/218/230/242, FWS1 LEVEL P#12 16 ตัว, FWS2 LEVEL P#34 6692–6719

### F5.5 ปัญหาที่แก้
| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| จุดไม่ตรงความถี่จริง | ใช้ 12 จุดตายตัว ±1 ชม. | จุดจาก `slotSummary` ของ server (RWS 25, CHEM 13, CWS1 10, FWS 7) |
| นับ "ครบ" ยากเกินจริง | ต้องครบทุก configID ทุก slot | นับ partial + threshold 60% + override ต่อ configID |
| FWS2 slot 00:00/08:00 ไม่ครบทั้งที่บันทึกครบ | Uroboros สร้าง **ghost record** (value null, value_text "") ที่ขอบกะ → ไปจุด `seenMidnight` ก่อน ทำให้ค่าจริงถูกดันไป 24:00 และนับเกิน | ข้ามแถว `value == null && !value_text` (STATUS มี value null แต่ value_text "ON" = ข้อมูลจริง) |
| ทุกสถานีขึ้น "เร็วๆ นี้" | `ACTIVE_STATIONS` มีแค่ RWS1/2 | ใส่ครบ 10 สถานี |

### F5.6 งานค้างของ F5
- ตรวจ slot `24:00` (isPast ใช้ `parseInt('24:00')=24`)
- คำถามค้าง: CWS1 OVERVIEW อื่นๆ, TPS IHM 6775/6776/6534/9278/9277 ใช้ 25 slot ถูกไหม, RWS CURRENT TEMP 39 IDs ทำไม partial ทุก slot
- `SLOTS_2H` ยังประกาศไว้แต่ไม่ใช้

---

## F6. Operator Daily Report (หน้า DAILY)

หน้า `http://localhost:443/labventure/op-record?station=DAILY` (component `DailyReportTab` ใน `OpRecord.jsx`) — สรุปการผลิตน้ำประจำวัน แทนโปรแกรมเดิม (Sword / `MH_report.db`)

### F6.1 ความเป็นมา
- เดิมรายงานการผลิตน้ำประจำวันทำในโปรแกรม VB.NET (Sword) ผลเก็บใน `MH_report.db` และพิมพ์ด้วยฟอร์ม Excel
- ต้องการให้ทำบนเว็บ ดึงข้อมูลจาก AquaDAT/Uroboros คำนวณปริมาณน้ำ สารเคมี พลังงาน ต้นทุน บันทึกลง DB ตาม schema เดิม และพิมพ์ฟอร์มเดิมได้ รวมถึงทำได้แม้ AquaDAT ล่ม

### F6.2 วัตถุประสงค์
1. ดึงข้อมูลครบ เร็ว ไม่ timeout
2. สูตรคำนวณตรงกับที่ผู้ใช้คิดมือ/ตารางเดิม
3. ข้อมูลไม่ครบต้องเห็นชัด (N/A แดง) ไม่ใช่ 0 ปลอม และบล็อกการบันทึก
4. SAVE DB ครบทุกคอลัมน์ตาม `MH_report.db` และพิมพ์ฟอร์ม `MH_report_theme.xlsx`
5. ทำรายงานอัตโนมัติหลังเที่ยงคืนได้

### F6.3 วิวัฒนาการของการดึงข้อมูล (Workflow)
| ช่วง | วิธี | ปัญหาที่ทำให้เปลี่ยน |
|---|---|---|
| 20 ก.ค. | ปุ่ม QUERY DATA → modal → ▶ All Query ดึง **ทีละ pattern แบบ serial ผ่าน SSE** (`/stream`, `/stream-station`) เก็บใน `historyCache[date]` (RAM) → `computeDailyReport` · client ใช้ fetch + ReadableStream (EventSource ไม่ผ่าน Vite proxy) | ยิงขนาน 40+ request แล้ว AquaDAT timeout เกือบหมด; pattern 114 timeout บ่อย (ตั้ง timeout 20 วิ + retry 1 ครั้ง) |
| 22 ก.ค. | cache ผลใน sessionStorage (`dr_report_<date>`, `dr_fwsbw_<date>`) เพราะ tab ถูก unmount เมื่อสลับสถานี (เทียบ 3 วิธี: sessionStorage / lift state / CSS hidden → เลือก sessionStorage) · ESC ปิด modal | — |
| 11 ส.ค. | REST batch: `/quick` (SQLite อย่างเดียว ทันที) · `/fetch-all` (stage 0: Uroboros call เดียว split ด้วย `CFG_TO_STATION`; stage 1: BellBeast `/api/process` CSV → `parseCsvToHistoryMap`) · `/fetch-station` · config `dr_aquadat_configs.json` | ชื่อ station ใน AquaDAT ไม่มีเลข (FWS ไม่ใช่ FWS1) ทำให้ได้ค่าว่าง |
| 29 ต.ค. | **AquaDAT REST JSON ตรง** `GET :12007/api/aquaDATService/Data?token&plant_id=2&stationtype_code=RWS,CDS,TPS,DPS,FWS,CWS&begin_dt=X-1&end_dt=X&format=json` (1 request, ~11 วิ สำหรับ RWS+CDS+TPS 2 วัน) · 25 จุดของวัน X = (X−1 24:00 → slot 00:00) + X 01:00…24:00 (`restRowsToHistoryMap`) · ค่าว่าง = null · ใหม่ `/recompute`, `/debug-cache`, `/api/data/read` | CSV ของ Uroboros ไม่มีค่า 00:00 และเติม 0 ให้ช่องว่าง → น้ำดิบเฟส 1 = 354,360,000 (ควร 382,000), Service water = 6,941,203 (ควร 6,988) |

stage 0 ยังใช้ Uroboros `/api/operator/data` · ปุ่ม FROM DB ใช้ Uroboros data.db

### F6.4 แท็บในหน้า
- **SUMMARY:** KPI 3 กล่อง (WATER PRODUCED / % LOSS / ENERGY) + TOTAL COST 4 ช่อง (สารเคมี · ไฟฟ้า · ตะกอน · ต้นทุนรวมไม่รวมค่าน้ำดิบ บาท/ลบ.ม.) · Sankey · SERVICE WATER · Filter Availability · CHEMICAL REMAINING (+ จำนวนวันคงเหลือ)
- **CHEMICAL:** donut Chemical Accuracy Wall (TARGET/USE/ACTUAL/%) ต่อเฟส ต่อสาร
- **FILTRATION:** การ์ดล้างบ่อกรอง 4 เฟส
- **RECYCLE WATER:** toggle + ตั้ง % (ทีละ 10%) น้ำล้างที่นำกลับต่อเฟส → หักจาก % น้ำสูญเสีย

### F6.5 สูตรคำนวณ (สถานะสุดท้าย — `server/services/dailyReport.js` → `computeDailyReport`)
นิยาม: **DD(id)** = ค่า 24:00 − ค่า 00:00 ของวันเดียวกัน · **pumpTotal** = DPS Line A + Line B + TPS

| รายการ | สูตร | ตัวอย่าง 28/10/69 |
|---|---|---|
| น้ำดิบ (ลบ.ม.) | เฟส 1 = DD(4)×100, เฟส 2 = DD(7)×100, เฟส 3 = DD(42)×100, เฟส 4 = DD(44)×100 | 382,000 / 383,000 / 417,000 / 329,000 = **1,511,000** |
| Service Water | DD(6534, TPS) | **6,988** |
| น้ำสูบ | DPS A = V(873,24:00)×100, B = V(875)×100, TPS = V(759)×100 | pumpTotal 1,436,200 |
| ตะกอน | ผลรวม V(24:00) CWS1 205/217 (P1), 229/**241** (P2), CWS2 6001/6002, 6003/6004 | — |
| % น้ำสูญเสีย | (น้ำดิบ − pumpTotal − ตะกอน − Service − ΔCWT) ÷ น้ำดิบ × 100; ΔCWT = (ระดับ CWT 24:00 − 00:00) × `cwt_area_m2` (48,000) · ระดับ CWT = cfg 876 (cm) ×0.01 | **4.45%** |
| % Loss (adj.) | − (น้ำล้างที่ recycle ÷ น้ำดิบ × 100) | — |
| PACl ใช้ (ตัน) | Net = (ΔTank A + ΔTank B) × 1.19 · OUT = รับเข้า(8423/8424 @24:00) − Net | CHEM1 31.232 + CHEM2 29.994 = **61.226** |
| Alum ใช้ (ตัน) | Net = (ΔA + ΔB) × 1.33 · OUT = รับเข้า(8037/8036) − Net | 0 |
| Chlorine ใช้ (kg) | ผลรวม abs(Δ) ของไลน์ที่ลดลง (127,128 / 190,191); สลับถังในวัน (Δ>0) → v00 − min(01:00…24:00) (`clLineUsed`) | 3,315 + 3,070 = **6,385** |
| Chlorine รับ/คืน | 4333/4339 รับ, 4334/4340 คืน (หน่วย **ท่อ**) | — |
| TARGET dose | `weightedAvgDR` = Σ(Flow×DR)/ΣFlow เฉพาะ slot ที่ flow>0 **และ DR>0** (flow จาก RWS1 cfg 1/2, RWS2 cfg 39/40 — ย้ายจาก CHEM มา RWS เมื่อ 11 ส.ค.) | — |
| USE ต่อเฟส | Alum แบ่งตาม totalizer 88/91, 150/153 · PACl/Cl แบ่งตาม Σ(flow×DR) (`sumFlowDR`); Cl แบ่ง 4 ส่วน pre/post × 2 เฟส | — |
| ACTUAL dose | Alum = ton ÷ 2 × 10⁶ ÷ น้ำดิบเฟส · PACl = ton × **0.35** × 10⁶ ÷ น้ำดิบเฟส · Cl = kg × 1000 ÷ Σ(น้ำดิบ 2 ชม. ช่วงที่ DR>0) (`sumDeltaFlowDR.sumF`) | PACl P1 14.31, Pre-Cl P1 2.22 |
| %PCT donut | max(0, (target − abs(actual − target)) / target × 100) · ≥80 เขียว, ≥70 ส้ม, อื่นแดง | — |
| ต้นทุนสารเคมี (บาท/ลบ.ม.) | (Alum_ton×`alum_ton` + PACl_ton×`pacl_ton` + Cl_kg/1000×`chlorine_ton`) ÷ pumpTotal | **0.3152** (ตารางผู้ใช้ 0.3155) |
| ต้นทุนตะกอน | `sludge_day` (8,601.88 บาท/วัน) ÷ pumpTotal | **0.0060** |
| ค่าไฟ (TOU กปน. 4.2.2 สายส่ง 24 kV) | พลังงาน = Σ DD มิเตอร์ DPS(883,885) TPS(9278,9277) FWS1(9273,9274) FWS2(9276,9275) RWS1(33,35) RWS2(75,77) **ไม่รวม SS3 Bldg (6775,6776)** · จ.–ศ. On-Peak = 13/24, ส.–อา. Off-Peak ทั้งวัน · ค่าไฟ/วัน = kWh_on×4.1839 + kWh_off×2.6037 + kWh×Ft 0.1972 + demand_kw×132.93÷วันในเดือน + 312.24÷วันในเดือน · ÷ pumpTotal | ≈ **0.5016** (ผู้ใช้ 0.4416 — ยังไม่ตรง) |
| ต้นทุนรวม | `op_cost_per_m3` = สารเคมี + ไฟ + ตะกอน (ไม่รวมค่าน้ำดิบ); `total_cost_per_m3` = `rw_cost` + op | — |
| Filter availability | นับ REPAIR ที่ 24:00 ต่อเฟส (FILTER_PHASES: FWS1 cap 8+8, FWS2 cap 14+14) → available = cap − repair (เพิ่ม pattern 10/11) · แสดงเป็นตัวเลข 4 เฟสคั่นด้วยขีดตั้ง เช่น 7 / 8 / 14 / 13 — เขียวถ้าเต็ม ส้มถ้าขาด | — |
| วันคงเหลือ Cl | `daysRemaining(rem_cl_ton, 1, flows, doses)` (CHEM1 dose 129/133/131/135 flow 1/2; CHEM2 192/196/194/198 flow 41/43) หน่วยตัน/วัน | ยังไม่ทดสอบข้อมูลจริง |

ค่าตั้งค่าอยู่ใน `server/config/app_settings.json` (`chem_cost`, `energy_cost` รวม `demand_kw`, `service_charge`, `ft_price`; `rw_cost`, `cwt_area_m2`) แก้ผ่าน popup "ตั้งค่ารายงานประจำวัน" (`GET/PATCH /api/scenarios/report-settings`) แล้ว `/recompute` ทันที

### F6.6 ปัญหาที่แก้ (นอกจากเรื่องแหล่งข้อมูล)
| วันที่ | อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|---|
| 20 ก.ค. | delta = 0 เสมอ | `getDelta` เรียกค่า 00:00 ของวันถัดไป แต่ historyMap ไม่มีมิติวันที่ | ใช้ `getDayDelta`/`getDayDeltaSum` กับ historyMap; ต่อมา (23 ก.ค.) `getDelta` ใช้ slot 24:00 ของวันเดียวกัน + SQLite fallback |
| 20 ก.ค. | slot 24:00 หาย | เทียบ nextDate เปราะ | `seenMidnight`: 00:00 แรก = 00:00, 00:00 ที่สอง = 24:00 |
| 20 ก.ค. | CHEM2 TARGET pre-Cl 0.61 (ควร 1.50) | ไม่กรอง DR=0 | กรอง `dr > 0` |
| 20 ก.ค. | donut แดง 0% ทั้งที่ไม่มีข้อมูล | ใช้ `target===0 && actual===0` หลัง toFixed | flag `noData` จาก raw value |
| 23 ก.ค. | PACl เฟส 2 14.275 (ควร ~11.657) | getDelta ข้างบน | — |
| 23 ก.ค. | PACl actual dose ผิด | ใช้ /2 เหมือน Alum | PACl ใช้ ×0.35 |
| 23 ก.ค. | ตะกอนเฟส 2 ผิด | cfg 242 | cfg **241** |
| 23 ก.ค. | พลังงาน DPS/อาคาร | หาร 1000 ผิด / cfg 9775-9776 | DPS ไม่หาร, อาคาร = 6775/6776 |
| 11 ส.ค. | หน้าขาวทั้งหน้า | `const rw = effectiveRw` shadow prop ใน useMemo → TDZ ("Cannot access 'k' before initialization" ใน bundle) | ใช้ `effectiveRw` ทุกจุด |
| 11 ส.ค. | Sankey ว่างเมื่อ rw=0 | — | fallback = TPS + DPS |
| 11 ส.ค. | browser ใช้ index.html เก่า | cache | `Cache-Control: no-store` + `etag:false` |
| 29 ต.ค. | PACl USE 63.525 (คิดมือ 61.226) | เขียน `ΔA + ΔB × 1.19` ลืมวงเล็บ | `(ΔA + ΔB) × 1.19` |
| 29 ต.ค. | ค่าไฟคิดจาก 198.928 MWh แต่ ENERGY = 196.99 | ค่าไฟรวม SS3 Bldg | เอาออกจากค่าไฟ |
| 29 ต.ค. | popup ตั้งค่าพื้นโปร่ง | `bg-earth-DEFAULT` ไม่สร้าง CSS | `bg-earth` (เหลือ ~129 จุดใน 12 ไฟล์ ยังไม่แก้) |
| 29 ต.ค. | วันที่ยังไม่จบแสดง 0 | AquaDAT มีแถวของ slot อนาคต (เช่น 24:00 ตอน 19:34) + โค้ดใช้ `?? 0` | `dropFutureSlots()`, `sumStrict()` (ขาดตัวใด = null), `RCV()` (วันที่ผ่านไปไม่มีแถวรับ = 0, ก่อน 24:00 ของวันนี้ = null), flag `day_complete` |
| 30 ต.ค. | บ่อล้างเวลา 00:00 ขึ้นแดง | START/END = 0 ถือเป็นว่าง | 0 = 00:00 ถ้าอีกช่องไม่ใช่ 0 (ทั้งคู่ 0 = แดง) |
| 30 ต.ค. | SAVE ล้ม "fetchAllStationsHistory is not defined" | import ไม่ครบ | แก้ import; `/save` คำนวณจาก `historyCache[date]` (ตรงกับจอ) → ไม่มีให้ดึง REST → ไม่งั้น SQLite |

### F6.7 การแสดงข้อมูลไม่ครบ (29–31 ต.ค.)
- ค่า null = "N/A" สีแดง กรอบแดง (`border-red-400 bg-red-50`) ทั้ง KPI, TOTAL COST, ตาราง, SERVICE WATER, CHEMICAL REMAINING, donut
- donut: TARGET null = เทา "—" (ไม่ได้เติมสาร) · วันยังไม่จบ = แดง N/A
- **ปุ่ม SAVE DB กดไม่ได้** ถ้ามี N/A/กล่องแดง — `missing[]` รวมทุกช่อง + tooltip + ป้าย "⚠ ไม่ครบ N" (เช็คฝั่ง client อย่างเดียว)
- กฎกล่องแดงรวมไว้ที่ `server/shared/dailyReportRules.mjs` (`FWS_BW_PHASES`, `parseBWPhase`, `dailyReportIssues`) ใช้ทั้ง client (import ข้ามโฟลเดอร์, `vite.config.js` `server.fs.allow: ['..']`) และ server — ⚠ `missing[]` ใน `DailyReportTab` ยังเป็นโค้ดแยก ต้องแก้ 2 ที่

### F6.8 FILTRATION (ล้างบ่อกรอง)
- 4 เฟส: P1 FWS1 base 317, P2 FWS1 base **399** (เว้น 6 IDs หลัง P1), P3 FWS2 base 479, P4 FWS2 base 621 · stride 10 ต่อบ่อ: +0 กะ, +1 ชั่วโมงกรอง, +2 ระดับ, +3 เวลาเริ่ม, +5 เวลาจบ, +6 ปริมาณน้ำล้าง · FWS2 ระดับอยู่คนละช่วง (7944–7957, 7958–7971 แบบสลับ) ต้อง hardcode
- slot นับ 08:00/16:00/24:00 (00:00 = ของวันก่อน)
- `parseBWPhase` (11 ส.ค.) คืน event แบบ flat: 1 การ์ด = 1 รอบล้าง (บ่อละสูงสุด 3 ใบ) · มีค่าไม่ใช่ 0 อย่างน้อย 1 ช่องจึงแสดง · ครบทุกช่อง = เขียว / ไม่ครบ = แดง · คลิกการ์ด → ไปหน้าสถานีพร้อม focus เซลล์
- > 6 การ์ด → grid 6 คอลัมน์ maxHeight 260px · 30 ต.ค. เพิ่ม vertical scroll ทั้งแท็บ
- ข้อมูล backwash มาจาก `fwsMap` ใน response ของ `/fetch-all`

### F6.9 RECYCLE WATER + Sankey
- toggle + pin 0–100% ต่อเฟส, ปริมาณจาก `washSummary[i].totalVol` → `totalRecycled` → `adjWaterLoss`
- `WaterSankeyChart` เป็น SVG เขียนเอง (แทน `@nivo/sankey` ที่ layout ผิด): น้ำดิบ → TPS / DPS (→ Line A, B) และโค้งลง Loss / Wash / Service / Sludge; อัปเดตตาม recycle real-time
- 31 ต.ค.: ค่า recycle ถูกส่งตอน SAVE DB (`recycle: [{on,pct}×4]`) → server `recycledWater()` หัก % น้ำสูญเสียก่อนบันทึก + `Wash_water_Total`; `/saved` คืน recycle ให้ restore

### F6.10 SAVE DB และพิมพ์ MH_report
- **popup ยืนยัน** (`SaveConfirmModal`): [ผลัด 1–4][ผู้จัดทำ] + [ผลัด][ผู้ทบทวน] บังคับทั้งคู่ (รายชื่อจาก `GET /preparers` = `car_whitelist` group 2 ที่มี shift) + แถบเตือนในตัวเมื่อไม่ใช่วันนี้ (แทน `window.confirm`)
- เอาปุ่ม VALIDATE และ dropdown Shift ออกจาก toolbar
- `POST /save` ต้องมี shift, prepared_by, reviewed_by · คอลัมน์เพิ่ม (`ensureExtraColumns` ตรวจทุกครั้งเพราะ DB ถูก swap ได้): `PreparedBy`, `ReviewedBy`, `ReviewedShift`, `RecycleCfg`, `MhCells` (JSON snapshot ของฟอร์ม ณ ตอน save)
- **31 ต.ค. บันทึกครบทุกคอลัมน์ตาม base `MH_report.db`** (Sword): FRT_Avg, PercentageFilterUse, ON/STANDBY/REPAIR ต่อเฟส, WASHCOUNT, Wash_water ต่อเฟส, tonuse/target/actual dose ต่อเฟส · หน่วยแก้ให้ตรง base: ต้นทุน = บาท/ลบ.ม. (เดิมบาท/วัน), `DPS_TotalF` = DPS A+B (เดิมรวม TPS), `Cl_income` = ท่อ, `Energy_total` = plant + SS3 · สารที่ไม่ใช้วันนั้น = 0 · Polymer ไม่มีแหล่งข้อมูล = 0 · DateKey ยังเป็น `YYYY-MM-DD` (base `YYYYMMDD`)
- **PRINT EXCEL** (ปุ่ม teal ข้าง SAVE DB) → `PrintExcelModal` ปฏิทิน (วันที่ save แล้วสี teal) → `GET /export-mh.xlsx?date` ใช้ save ล่าสุดของวัน (มี MhCells ใช้เลย ไม่มี → คำนวณจาก cache/SQLite + `overlayDbCells`) **ไม่เรียก AquaDAT** · 404 ถ้ายังไม่ save
- `services/mhReport.js`: `buildMhCells` (mapping ทั้งฟอร์ม), `writeMhReport` แก้ sheet XML ด้วย jszip (คง style/merge/print setting, แทน #REF! ด้วยค่า, ลบ externalLink/calcChain, `fullCalcOnLoad=1`), ลายเซ็น merge D64:I64 ฯลฯ ฟอนต์ TH SarabunPSK 11 + `shrinkToFit`, ตำแหน่ง = `position_label` + " สคน." + ผลัด
- template อยู่ `server/templates/MH_report_theme.xlsx` (+ `MH_report_example.xlsx`) — 30 ต.ค. ย้าย template ทั้งหมดจาก `server/data` → `server/templates` (กฎใน CLAUDE.md)

### F6.11 Auto-run รายงานอัตโนมัติ (β) — 31 ต.ค.
- Uroboros task `labventure.dailyreport` (`LabVentureDailyTask.cs`, ตื่นทุก 60 วิ) ทำรายงานของ **เมื่อวาน** รอบ 00:05 / 00:30 / 01:00 (ผ่านรอบไหนหยุด, ห่าง ≥ 20 นาที, หลัง 02:00 ไม่ไล่ตาม → "missed") · state `labventure_daily_state.json` · login AquaDAT เอง · stage ≠ 1 = ERROR · บังคับรัน: เขียนวันที่ลง `labventure_daily_force.txt` · log `logs\dailyreport\`
- LabVenture `POST /api/daily-report/auto-run` ต้องมี header `X-Auto-Key` = `DAILY_AUTO_KEY` (.env) → query สด → `dailyReportIssues()` ว่าง → `saveDailyReport()` **Shift 0**, PreparedBy `AUTO · Uroboros (β)`, ReviewedBy `N/A` · มีคน SAVE แล้ว → SKIPPED (ไม่ทับ) · ตาราง `daily_auto_runs`, `GET /auto-run/last`
- MH_report ของวัน auto พิมพ์ข้อความแทนชื่อ: "This report was generated / automatically by the system." และ "Auto-generated report / (no manual review)"
- ทดสอบจริงวันที่ 30/10: OK (RWS 1,521,200 · %loss 3.66 · ต้นทุน 0.7917 · 194.05 MWh)

### F6.12 งานค้างของ F6
- ค่าไฟไม่ตรงตารางผู้ใช้ (0.5016 vs 0.4416) — ถ้าจะตรง On-Peak ≈ 24.5% ไม่ใช่ 13/24 → ต้องรู้ว่าตารางผู้ใช้แบ่งอย่างไร (ทางเลือก: คิดจากมิเตอร์จริง 09:00–22:00) · VAT 7%?
- หน่วย flow cfg 1/2/41/43 (ถ้าเป็น m³/s สูตร `daysRemaining` สูงเกินจริง ~3.6 เท่า)
- ระดับน้ำ/แรงดันของวันที่ยังไม่จบควรเป็น N/A ไหม · Sankey ยังใช้ `?? 0`
- ข้อความ error 502 ของ `fetch-all` มี URL ที่มี `token=` (JWT ผู้ใช้) ส่งกลับ browser — ควรตัด
- `/fetch-station` เคยยังเป็น pattern-based · endpoint SSE เก่า `/stream*` และ `dr_aquadat_configs.json` ไม่ใช้แล้ว
- MH_report พิมพ์ 2 หน้า (template zoom 83 ขอบขวาล้น) · Polymer ราคา (base 72,210) ยังไม่ถาม
- ไม่มี UI แสดงผล auto-run / แจ้ง LINE เมื่อ fail
- แถววันที่ 29/10 ที่หายจาก DB (DB ถูกวางทับ) — สำเนาที่มีแถวนั้น: `_backup\labventure_db_with_2910_save` (ใช้ insert เฉพาะแถว อย่าทับทั้งไฟล์) · 30 ต.ค. 17:59 ผู้ใช้สั่ง **ล้างข้อมูลบันทึกใน labventure.db ทั้ง dev และ deploy** (เก็บ config tables) มี backup `_backup\labventure_db_before_clear_3010`

---

## F7. สิทธิ์ผู้ใช้ / Bypass / การเข้าถึงหน้า

### F7.1 ความเป็นมา
- มี bypass 2 ระบบที่สับสนกัน: BellBeast (`bb_bypass_role` cookie, role ใช้ขีด `executive-3a`) และ LabVenture (`aquadat_token` JWT httpOnly, role ใช้ขีดล่าง `executive_3a`)
- ต้องการจำกัดหน้าตามกลุ่มใน whitelist แม้ login ปกติ และให้โหมด bypass ใช้ดูได้อย่างเดียวในบางหน้า
- ภายหลัง superadmin ต้องทำได้ทุกอย่าง แต่กฎชื่อ/รหัสของ superadmin กระจายหลายที่

### F7.2 กฎปัจจุบัน
- Component ของ LabVenture ต้องอ่าน bypass จาก `useQuery(['me'])` → `me.bypass && me.role` **ไม่ใช่** cookie ของ BellBeast
- Login ปกติ: `GET /api/auth/me` หา role จาก `car_whitelist.group_code` (`1` scientist, `2` operator, `3a` executive_3a, `3b` executive_3b; มีหลายกลุ่มเลือก 3a/3b ก่อน) · isAdmin / superadmin (`SUPERADMIN_NAME`) / ไม่อยู่ใน whitelist → `role = null` = ไม่จำกัดหน้า
- จำกัด **หน้า** ใช้ `me.role` (ทั้ง bypass และ login ปกติ) · จำกัด **ปุ่ม** ใช้ `me.bypass` เท่านั้น (login ปกติไม่ถูกจำกัดปุ่ม)
- แหล่งเดียวของสิทธิ์หน้า: `client/src/config/pageAccess.js` (`ROLE_PAGES`, `PAGE_ROUTES`, `HIDDEN_PAGES`, `isSuperBypass`, `isSuperadmin`, `hasRole`, `allowedPagesFor`)

| หน้า | scientist | operator | exec 3a/3b | observer | superadmin |
|---|:---:|:---:|:---:|:---:|:---:|
| /dashboard, /record, /config | ✓ | ✗ | ✗ | ✓ | ✓ |
| /chem-intake | ✓ | ✓ | ✗ | ✓ | ✓ |
| /car, /report | ✓ | ✓ | ✓ | ✓ | ✓ |
| /op-dashboard, /op-record | ซ่อน | ซ่อน | ซ่อน | ซ่อน | ✓ |

operator redirect → `/chem-intake`, executive → `/car`

**ปุ่มในโหมด bypass**
- `/record`: bypass บันทึกไม่ได้ ยกเว้น superadmin (22 ก.ค.) และทุก bypass บันทึกได้เมื่อ stage 0 · server `operator.js` ตรวจ token bypass ที่ stage 1 → ส่งไป Uroboros
- `/config`: bypass = อ่านอย่างเดียว (`BypassCtx`, แบนเนอร์ "🔒 Bypass Mode — ดูได้อย่างเดียว") ปิดปุ่มทุกตัว (toggle โรคระบาด, marquee, scenario, CAR setting, whitelist, admin, kick, init, test)
- `/chem-intake` (เดิม): บันทึกบน = operator/superadmin, รับ Sampling = scientist/superadmin — ต่อมาแทนด้วย role matrix ของ Chem Lab (F9)
- `/car`, `/report`, `/dashboard`: ไม่มี guard

### F7.3 superadmin ทำได้ทุก feature (31 ต.ค.)
- server `services/actor.js`: `isSuperadminIdentity()` (bypass, ชื่อ `SUPERADMIN_NAME` หรือรหัสพนักงาน) + `can(actor, SET)` → superadmin ผ่านเสมอ; ใช้แทนการเช็ก `SCI_WRITE`/`OFFSET_WRITE` ตรงๆ ใน routes config, eventClass, scenarios, chemLab, auth, car, carAdmin · `requireAdmin` (pm, testMode) ผ่านถ้า `isSuperadmin || isAdmin`
- client: เอา `'superadmin'` ออกจาก role list ทุกจุด ให้ helper ตัดสิน
- จงใจไม่แก้: การเปลี่ยนสถานการณ์ใน test mode ยังเช็ก `isAdmin`; การล็อกไม่ให้แก้ entry ของ superadmin ใน whitelist
- ผู้ใช้ทดสอบระบบจริงแล้ว "โอเคหมด"

### F7.4 ข้อควรระวังด้านความปลอดภัย (ยังไม่แก้)
- `/api/auth/bypass` เปิดตลอด (จำกัดตาม stage) และ token ไม่ verify signature
- Uroboros :8888 ไม่มี auth → ปลอม actor ได้ถ้าเข้าถึง port
- 31 ต.ค. ปลด login ของ `export.xlsx` และ `table.xlsx` (ผู้ใช้เลือก)

---

## F8. Dashboard (Scientist) + ธีมสี Earth-tone

### F8.1 ธีม Earth-tone (24 ก.ค., commit `fbdb318`)
หลัก "Light leads, focal punctuates" — พื้นสีดินอ่อน ใช้สีเข้มเฉพาะจุดที่ต้องการให้มอง · zero logic change

| ระดับ | Token | Hex | ใช้กับ |
|---|---|---|---|
| L1 | `earth` (DEFAULT) | `#FFF9D2` | พื้นหน้า, stat card, input, แถวคู่ |
| L2 | `earth.card` | `#FFEBCC` | topbar, sidebar, การ์ด, ปฏิทิน, modal |
| L3 | `brand.light` | `#BFDDF0` | พื้น MiniChart เท่านั้น (ตัวอักษร `#1A3A5C`) |
| Focal | `brand` | `#8CC0EB` | โลโก้, ปุ่ม Sync, เมนู active, วันที่เลือก |
| Focal dark | `brand.dark` | `#4A8CC8` | วันนี้ในปฏิทิน, ลิงก์ |
| ตัวอักษร | `earth.ink/ink2/ink3` | `#3A2410` / `#7A5830` / `#B89060` | — |

- หัวกลุ่ม/สถานีใช้ **เส้นซ้ายสี accent** แทนแถบสีทึบ (`NODE_GROUPS`, `STATION_ACCENTS`)
- คงสีขาว: ปุ่ม toggle, จุดบนพื้นสี; คงสีสถานะ OK/WARN/BAD
- ⚠ `bg-earth-DEFAULT` **ไม่สร้าง CSS** (ต้องใช้ `bg-earth`) → modal โปร่งใส; แก้เฉพาะไฟล์ใหม่/บางจุด เหลือ ~129 จุด
- 24 ก.ค. Login พื้นขาว, โลโก้ `icon.png` ใน header

### F8.2 หมายเหตุจาก AquaDAT (remarks)
| วันที่ | อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|---|
| 24 ก.ค. | OpDashboard มีแค่ 4 สถานี | — | ครบ 11 สถานี, query ครั้งเดียว `station_id=0` แล้วกรองฝั่ง client (เพิ่ม `trans_type`, `station_id` ใน GraphQL `readRemarks`) |
| 25 ก.ค. | กด Sync แล้ว remarks ไม่ refresh | ไม่ invalidate `['aquadat-remarks', dt]` | เพิ่ม invalidate |
| 25 ก.ค. | RWS1/RWS2 (และคู่อื่น) remarks ปนกัน | กรองด้วย `trans_type` ซึ่งใช้ร่วมกัน | กรองด้วย `station_id` |

### F8.3 Slot strip (27 ต.ค.)
- แทนจุดรายรอบ (`DotItem/TimelineDots`) ด้วยแถบช่อง `SlotStrip` 12 ช่อง + `DailyChip` คอลัมน์ "วัน" แยก
- สถานะ: done · modified · due (ยังไม่บันทึกและยังไม่เลย slot+2 ชม.) · overdue · future · none · `nextPendingSlot` เลือก overdue ก่อน due
- `TimeAxis` + `NowLine` (เฉพาะวันนี้, อัปเดตทุก 60 วิ), % + แถบความคืบหน้าใต้ชื่อ, `SlotLegend`
- คลิกช่อง → `/record?slot=HH:MM` หรือ `slot=daily`
- `isToday` ใช้วันที่ local ของ browser แทน `toISOString()` (UTC)
- ค้าง: มือถือ 375 px แถบถูกบีบ (layout 2 คอลัมน์เดิม), สียังเป็น hex ไม่ใช่ token

### F8.4 กราฟเกณฑ์
Dashboard/OpDashboard `chartConfig.js` เลิกใช้ตัวเลขตายตัว → `getThreshold(filter, scenario.thresholds, cardIndex)` ต่อเฟส; MiniChart รองรับ `type:'min'` (F11)

---

## F9. Chem Lab QC — re-design หน้า /chem-intake

### F9.1 ความเป็นมา
| เดิม | ปัจจุบัน |
|---|---|
| operator กรอกรับสารในหน้า `/chem-intake` (ตาราง `chem_history` key = ทะเบียนรถ) | operator บันทึกใน **TruckSidecar** ข้างโปรแกรมตาชั่ง → `sidecar.db` → Uroboros_mini รวมกับ `data.mdb` เป็น `chem.db` → Drive → Uroboros ดาวน์โหลด (แทนทั้งไฟล์) |
| นักวิทย์แค่กด "รับ Sampling" | นักวิทย์ต้องทำตาม **HACCP 5.3–5.11**: รับขวด → วิเคราะห์ (เอง/ภายนอก) → ตรวจซ้ำ → รายงาน สคบ-14 → ไม่ผ่าน = ชดเชย + สอบกลับ |

แบบฟอร์มอ้างอิง: `F-MS-HACCP-กผจ-29 REV04` (ใบตรวจรับ ส่วนห้องปฏิบัติการ) และ `F-MS-HACCP-สคบ-14 Rev02` (บันทึกข้อความรายงานผลวิเคราะห์ PACl: RD@°C, pH, อะลูมินา, เบสิกซิตี้, เหล็ก, สารไม่ละลายน้ำ) · ตาราง `chem_history` เดิมถูกซ่อน (ไม่ลบ)

### F9.2 วัตถุประสงค์
ระบบตรวจรับคุณภาพสารเคมี (ALUM, PACl) ครบวงจร: ทวนจำนวนขวดกับเที่ยวรถ, บันทึกผล, ตัดสินผ่าน/ไม่ผ่านตามเกณฑ์, เปิดเคสชดเชยและตัดยอด, ออกรายงาน สคบ-14 ตามแบบฟอร์มจริง, สอบกลับได้ทุกขั้น และมี audit ทุกการเปลี่ยนแปลง

### F9.3 สถาปัตยกรรม
```
โรงงาน: truck93a → data.mdb (WDATA) · TruckSidecar → sidecar.db · Uroboros_mini → chem.db → Drive
Uroboros (:8888): chem.db (อ่านอย่างเดียว, ไฟล์ active ตาม media\chem.current.txt, WAL, เปิด connection ใหม่ทุก request)
                  chemlab.db ข้าง Uroboros.exe → ตาราง LAB_* (ไม่ใช่ data.db เพราะ DbDownloadTask File.Replace data.db จาก Drive)
                  /api/chemlab/* (Listener_CHEMLAB.cs — ChemLabService + tests)
LabVenture (/api/chem-lab/*, routes/chemLab.js): auth/role, แนบ actor + ts (nowTH), /spec /me /options จาก config,
                  คำนวณ verdict จาก lab_chem_spec.json, pass-through ที่เหลือ · services.json chem_lab.mock=true → chemLabMock.js
Client: tabs ภาพรวม · รับขวด · ผสมตัวอย่าง · ผลวิเคราะห์ · Lab ภายนอก · สคบ-14 · เคสชดเชย · ตัดยอดชดเชย + TraceDrawer
```
หลักแบ่งหน้าที่: ข้อเท็จจริงของเที่ยวรถอยู่ chem.db · สถานะงานแล็บ + audit อยู่ chemlab.db · เกณฑ์/template งานอยู่ LabVenture config (hot-reload) · CAR อยู่ LabVenture `car_log` · proxy ถือ identity/role/เวลา → Uroboros เป็น backend "โง่" ทดแทนง่าย
Key ข้าม DB = `TICKET1` (1 ขวด = 1 เที่ยว) · PRODUCT `01` = ALUM, `03` = PACL · NET_KG = |W1 − W2|

### F9.4 Domain model และ state (สถานะสุดท้ายหลัง re-design 2)
```
WDATA.TICKET1 ─1:1─ LAB_BOTTLE (received / not_received)
LAB_COMPOSITE (ใบผสม; วัน×สาร×บริษัท, มี seq ใบที่ n, note) ─n:n─ LAB_COMPOSITE_BOTTLE (ขวดอยู่ได้หลายใบ)
LAB_COMPOSITE ─1:n─ LAB_ATTEMPT (ผลวิเคราะห์; final 1 ครั้งต่อใบ) · LAB_EXT_SEND (ส่ง Lab ภายนอก)
LAB_CASE (scope composite/day/custom) ─ LAB_CASE_TICKET · LAB_CASE_TASK · LAB_OFFSET (ตัดยอดเที่ยวถัดไป)
LAB_MEMO (สคบ-14, ช่วงวันที่, เลือกใบผสม) · ทุก write → LAB_AUDIT (ใน transaction เดียว, BEGIN IMMEDIATE)
```
- composite แยกบริษัท เพราะข้อมูล 2018–2026 มี 120 วันที่สารเดียวกันมาจาก > 1 บริษัท
- **จุด commit = เลือกผล final**: ก่อน final แก้ขั้นล่างได้ทั้งหมด; จะแก้ต้องย้อนขั้นบนก่อน
- เคส: `remaining = target − Σoffset` · auto task "ตัดยอดชดเชยครบ" ติ๊กเองเมื่อ remaining ≤ 0 · ทุก task เสร็จ → closed · void offset ของเคส closed → เปิดใหม่
- `suggested_kg = ROUND(ΣNET × max(0, 1 − key_value / key_min))` เฉพาะเมื่อพารามิเตอร์หลัก (อะลูมินา) ไม่ผ่าน; param รองไม่ผ่าน → 0 (ผู้ใช้กำหนดเอง)
- offset candidates = เที่ยวของบริษัท/สารเดียวกันที่ DAYIN > วันตัวอย่าง, ไม่อยู่ในเคสนี้, available = NET − Σoffset ของเที่ยวนั้น (ทุกเคส) > 0 · ยอดคิดเงิน = NET − offset
- เที่ยวหนึ่งอยู่ในเคสที่ไม่ถูกยกเลิกได้เคสเดียว (กันชดเชยซ้ำจากใบผสมที่ซ้อนกัน)

**Role (บังคับที่ proxy):** scientist/superadmin/role=null เขียนได้ทุกอย่างยกเว้น offset · operator = offset เท่านั้น (ไม่เห็นแท็บ สคบ-14, แท็บ default = ตัดยอด) · executive/observer อ่านอย่างเดียว

### F9.5 Workflow ก่อน/หลัง
**ก่อน:** operator กรอกรับสาร → นักวิทย์กด "รับ Sampling" → จบ (ไม่มีผลวิเคราะห์ ไม่มีชดเชย ไม่มีรายงาน)

**หลัง (re-design 2):**
```
1 รับขวด     : รายการเที่ยวจาก WDATA (LEFT JOIN sidecar; ไม่มี sidecar = badge ส้ม) → ได้รับ/ไม่ได้รับ (+ หมายเหตุ)
2 ผสมตัวอย่าง : เลือกขวดที่รับแล้ว (วัน/สาร/บริษัทเดียวกัน) → ใบผสม (ทำหลายใบซ้อนขวดได้ เช่น cross-check)
3 ผลวิเคราะห์ : ทดสอบเอง (กรอกครบทุก param + °C ของ RD) → กล่องแดง=ไม่ผ่าน/เขียว=ผ่าน · หรือ "ส่ง Lab ภายนอก"
4 Lab ภายนอก : รายการส่ง (กรองวันที่ส่ง) → กรอกผลครั้งเดียว → เป็น attempt external_lab
5 เลือก final ต่อใบผสม (เปลี่ยนได้ ติดชื่อผู้เลือก) → ผ่าน = รอเข้า สคบ-14 · ไม่ผ่าน = เปิดเคส (เลือกขอบเขต: คันในใบ / ทั้งวัน / เลือกคันเอง)
6 เคสชดเชย   : suggested/target (แก้ได้), งานตาม template (lab_case_tasks.json), ออก CAR (ปิด UI ไว้ชั่วคราว)
7 ตัดยอด     : operator เลือกเที่ยวถัดไปของบริษัทเดียวกัน ตัดจน remaining = 0 → เคสปิดเมื่องานครบ
8 สคบ-14     : preview ใบผสมที่มี final ในช่วงวันที่ → ติ๊กเลือก (default ทั้งหมด) → บันทึกเลขที่ → Word / PDF จากแบบฟอร์มต้นฉบับ
ทุกขั้นย้อนได้ (ใส่เหตุผลหรือไม่ก็ได้) · TraceDrawer สอบกลับจาก TICKET1: ตาชั่ง → sidecar → ขวด → ใบผสม/ผล → เคส/offset
```

### F9.6 ลำดับการพัฒนาและการตัดสินใจ
| วันที่ | งาน | การตัดสินใจสำคัญ |
|---|---|---|
| 26 ก.ย. | Grill-me 19 คำถาม → D1–D17; frontend 5 แท็บ + proxy + mock | D1 LAB_* ไม่อยู่ chem.db · D3 WDATA เป็นฐาน · D4 ขวด 2 สถานะ · D5 3 แหล่งผลในโครงเดียว · D6 เกณฑ์เป็น config · D9 ไม่มี approval ในระบบ (เซ็นกระดาษ) → ระบบล็อกเอง · D13 ชดเชย = ตัดบัญชีโดย operator (เช่น ไม่ผ่าน 6 t → เที่ยวถัดไปส่ง 26 t คิดเงิน 20 t) · D14 เปิด CAR · D17 prefix `/api/chemlab` |
| 27 ก.ย. | Uroboros backend จริง (`Listener_CHEMLAB.cs`) + publish; mock:false; E2E | CAR **ไม่ออกอัตโนมัติ** → นักวิทย์กด "ออก CAR" จากหน้าเคส (prefill ฟอร์ม CAR ปกติ, รหัส CQ) · ย้าย LAB_* ไป `chemlab.db` |
| 28 ก.ย. | สคบ-14 จากแบบฟอร์มต้นฉบับ Word/PDF | ผู้ใช้ไม่รับหน้า print HTML เลียนแบบ → ใส่ข้อความลง paragraph เดิมของ `F-MS-HACCP-สคบ-14 Rev02.docx` (อ้าง `w14:paraId`, แทนจุด `....` ตามลำดับ, เกิน 5 แถว clone แถว) · PDF ด้วย Word COM (`docx2pdf.ps1`) → เครื่อง server ต้องมี MS Word · ลบ `MemoPrint.jsx` |
| 26 ต.ค. (บ่าย) | ย้อนขั้นตอนได้ (spec §4.0) | แก้/ลบ (soft) ผลได้จนกว่าจะ final · ขวดมาช้าแก้ได้จน final · **ถอด UI ที่ผูก CAR ออกชั่วคราว** · ยกเลิกเคสผ่าน "ย้อนผล final" เท่านั้น · UI Pipeline board 6 คอลัมน์ + stepper |
| 26 ต.ค. (เย็น) | re-design 2 (spec §4.1) + เหตุผลไม่บังคับ (§4.2) | คนรับขวดกับคนผสมอาจคนละคน → แยกขั้น · ผสมได้หลายใบซ้อนขวด · final ต่อใบผสม · Lab ภายนอกเป็นแท็บแยก · **เลิกรับ COA ผู้ขาย** (COA เป็นเอกสาร hard copy ตรวจตอนรับสาร) · เคสเลือกขอบเขตได้ · สคบ-14 เลือกใบผสม · "change ใดๆ กดยืนยันได้แม้ไม่ใส่หมายเหตุ" |
| 27 ต.ค. | ชื่อห้องปฏิบัติการ/ที่เก็บเอกสารเป็น dropdown + ปุ่ม "+" | `GET/POST /api/chem-lab/options/:kind` เก็บใน `lab_ext_options.json` (ไม่ผ่าน Uroboros) |

### F9.7 Endpoint หลัก (`/api/chemlab/*` ที่ Uroboros; LabVenture `/api/chem-lab/*`)
bottles (GET/PUT) · composites (GET/POST/PUT/DELETE) · composites/:id/attempts (POST/PUT/DELETE) · composites/:id/final (PUT/DELETE) · composites/:id/ext-sends · ext-sends (GET, /:sid/result, /:sid/cancel) · memos (GET/POST, /preview, /:id, /:id/void, /:id/docx|pdf) · cases (GET/PATCH, /tasks, /offsets, /offsets/:oid/void, car-draft, /car) · offset-candidates · trace/:ticket1 · pipeline
- header จาก proxy: `X-LabVenture-Actor` (encodeURIComponent ชื่อไทย), `X-LabVenture-Role`, `X-LabVenture-Ts` (ISO +07:00); write ที่ไม่มี actor → 400 · ตอบ 400 = input ผิด, 404 = ไม่พบ, 409 = ขัดกฎ lock

### F9.8 การทดสอบ
- mock 26 ก.ย. T1–T16 ผ่าน (เช่น composite 2 ขวด → attempt Al₂O₃ 8 / 8.5 ไม่ผ่าน → suggested **4,308 kg** = 28,720 × (1 − 8.5/10) → operator ตัดยอด → ปิดเคส; memo "สคบฝผม 101/2569")
- Uroboros จริง 27 ก.ย.: ALUM 25/09 (7.2) suggested 3,813 → ตัด 2,000 + 1,813 → ปิด · ALUM 26/09 (7.6) suggested 957 → override 1,500 → 1,800 → auto task un-tick → ตัดครบ · PACL 24/09 เหล็กไม่ผ่าน (param รอง) → suggested 0
- Sequence test SQ1–SQ10 (ปกติ, ไม่ผ่าน→ชดเชย, ตรวจซ้ำผ่าน, ผลภายนอก, ยกเลิกเคส, param รอง, ตัดหลายเที่ยว/ข้ามเคส, ขวดมาช้า, memo ช่วงซ้อน, Uroboros ล่ม) — SQ8–SQ10 ยังไม่ได้ทดสอบ
- re-design 2: mock 83–86 checks + migrate, Uroboros `ChemLabServiceTests` 12/12, browser ครบ flow + tablet 768 px · deploy 26 ต.ค. 14:46/14:56 migration chemlab.db จริงผ่าน
- ⚠ เหตุการณ์ระหว่างทดสอบ 26 ก.ย.: CAR ทดสอบถูกสร้างใน DB จริงและ **LINE ส่งเข้ากลุ่มจริง** เพราะ verify server ใช้ `.env`/DB เดียวกัน — บทเรียน: ปิด LINE token ก่อนทดสอบ final fail และบอกผู้ใช้

### F9.9 เอกสารหารือการชดเชย (`chem_compensation_workflow.docx`, 27 ก.ย.)
- **Decision tree:** D1 ผ่านทุก param? → D2 ต้องตรวจซ้ำ/ส่งภายนอกก่อนไหม [ต้องตัดสิน] → A1 ออก CAR (CQ) → D3 param หลักไม่ผ่าน? (ใช่ = สูตร / ไม่ = D4 param รองต้องชดเชยไหม [ต้องตัดสิน]) → D5 ปริมาณตกลง = ค่าแนะนำ? → D6 รูปแบบชดเชย [ต้องตัดสิน]: ก. หักจากเที่ยวถัดไป (ระบบรองรับ) · ข. ส่งเพิ่มไม่คิดเงิน · ค. หักเงิน/ค่าปรับ · ง. คืนสาร/ปฏิเสธ → D7 มีเที่ยวถัดไปไหม → A2 บันทึกใน AquaDAT [ต้องตัดสิน] → A3 ปิดเคส
- **ตัวอย่างสูตร:** PACl 14,125 kg ค่า 9.2 (≥10) → 1,130 kg · ALUM 38,130 kg ค่า 7.2 (≥8) → 3,813 · ALUM 38,030 ค่า 7.8 → 951 · PACl เหล็ก 260 (≤200) อะลูมินาผ่าน → 0
- **ตัวอย่างตัดยอด:** เป้า 2,872 kg → เที่ยว 14821 NET 19,100 ตัด 2,000 · เที่ยว 14822 NET 19,080 ตัด 872 → คิดเงินรวม 35,308
- **configID Chemical income ใน AquaDAT:** Alum A+B 8037, C+D 8036, PACl A+B 8423, C+D 8424 (Sidecar ส่งเป็นตัน ต่อวัน แบ่งตามปริมาตรเติมถัง)
- **ตัวเลือกบันทึกการชดเชย:** A บันทึกตามจริง + ออกหนังสือ (สมดุลถังตรง, งานน้อย) · B หักในวันของเที่ยวที่ถูกตัด (ต้องส่งย้อนหลัง, สมดุลถังคลาด) · C หักในวันที่บันทึกตัดยอด · D configID แยก "ชดเชยสารเคมี" (สมดุลถังตรง, งานปานกลาง, ต้องขอผู้ดูแล AquaDAT) → ข้อเสนอเบื้องต้น A หรือ D
- 13 คำถามถึงหน่วยงาน (สัญญา, เกณฑ์จริง, สูตร/ปัดเศษ, param รอง, ตรวจซ้ำ, รูปแบบชดเชย, หลักฐาน, ผู้อนุมัติ, ผู้ใช้ Chemical income, ตัวเลือก A–D, configID, กำหนดเวลา, CAR ของเคสที่ยกเลิก)
- **เกณฑ์ในระบบ (ค่าสมมติ `verified:false`):** PACl — RD ≥ 1.19, pH 3.5–5.0, อะลูมินา ≥ 10.0, เบสิกซิตี้ 40–90, เหล็ก ≤ 200 mg/kg, สารไม่ละลาย ≤ 0.1 · ALUM — RD ≥ 1.30, อะลูมินา ≥ 8.0, เหล็ก ≤ 100, สารไม่ละลาย ≤ 0.2

### F9.10 ช่องว่าง/edge case ที่บันทึกไว้
- ปิดแล้ว: G1 void offset, G2 void memo (ทำใน §4.0)
- ยังเปิด: G3 CAR ล้ม/retry (CAR UI ถูกถอด), G5 เกณฑ์ใน memo ใช้ spec ปัจจุบัน ไม่ใช่ snapshot, G6 ไม่มี upload ไฟล์ผลภายนอก (มีแค่ `attachment_ref`), G7 reopen เคสที่ปิด, G8 ชื่อใน audit โหมด bypass = `sub`, G9 ไม่มี LINE แจ้ง operator, G10 param หลักแบบ max, G11 ไม่มีรายงานสรุปชดเชยรายเดือน, G12 ไม่มี unit test ใน repo LabVenture
- edge: E-12 ตั๋วถูกยกเลิกหลัง swap → ขวดกำพร้า · E-17 ความหมาย N ใน memo · E-20 offset เที่ยววันเดียวกับตัวอย่าง (ต้อง DAYIN > sample_date) · E-25 ไม่มี paging
- ST: ผลภายนอก 2 สัปดาห์, ผู้ขายโต้แย้ง, ผู้ขายไม่ส่งอีก (เคสค้าง), 2 บริษัทวันเดียว, chem.db ยังไม่ sync (≤ 5 นาที + รอบดาวน์โหลด), LINE token หมดอายุ

### F9.11 งานค้างของ F9
- **เกณฑ์จริง PACl/ALUM** + `spec_ref` + แบบฟอร์ม สคบ-14 ของ Alum (ตอนนี้ endpoint ตอบ 400 สำหรับ Alum)
- รอผลหารือหน่วยงาน (docx) เรื่องรูปแบบชดเชย/การบันทึก AquaDAT — 27 ก.ย. ผู้ใช้ต้องการให้ยอด "ส่งยอดสารเคมี" ใน Sidecar = NET − offset และตรวจย้อนได้ทั้งสองทาง (กลไก `aq_outbox` แถวติดลบ `OFFSET#id` ใช้ได้)
- การนำ CAR กลับมาผูกกับเคส · ยกเลิกเคสแล้ว CAR ที่ผูกไว้ทำอย่างไร
- ช่องจุดหลังชื่อสารใน สคบ-14 ใส่ชื่อบริษัท (เดา) — รอยืนยัน · ช่องลายเซ็นเว้นไว้เซ็นมือ
- ข้อมูลทดสอบใน `chem.db` (mock trips TICKET1 14810–14825), `chem.current.txt`, `chemlab.db` — ผู้ใช้สั่ง "เก็บไว้ก่อน"
- ลบ/แก้ชื่อในรายการ options ยังไม่มี

---

## F10. ระบบ CAR — เลขอัตโนมัติ + พิมพ์ตามแบบฟอร์ม

### F10.1 ความเป็นมา
CAR (Corrective Action Report) มี workflow `status_code` 10 ออก → 20 ตอบ → 30 อนุมัติ → 50 ตรวจติดตาม → 60 ปิด และแจ้ง LINE ทุกขั้น เดิมเลข CAR กรอกเอง พิมพ์ตามแบบฟอร์มกระดาษไม่ได้ และ LINE แสดงเครื่องหมายเกณฑ์กลับด้าน

### F10.2 สิ่งที่ทำ
| วันที่ | งาน | รายละเอียด |
|---|---|---|
| 27 ก.ย. | เลข CAR อัตโนมัติ | รูปแบบ `CQ 01/2569` · รีเซ็ตทุกปีงบประมาณ (1 ต.ค. → พ.ศ.+1) · นับแยก CAR/PAR · เว้นว่าง = auto, พิมพ์เอง = override (ถ้าตรงรูปแบบ จะนับต่อจากเลขนั้น) · prefix HA/EA/OA/CC/CQ/LC · `GET /api/car/next-number` · เลขซ้ำ → 409 · Chem Lab ใช้ CQ |
| 27 ก.ย. | LINE | `pushCarMessage` คืน true/false; `line_sent_at` ตั้งเฉพาะเมื่อส่งสำเร็จ · เครื่องหมายเกณฑ์เคยกลับด้าน → `above ⇒ ≤`, `below ⇒ ≥` (กระทบ CAR ทุกใบ) |
| 27 ก.ย. | Deep link | `/car?key=<unique_key>` เปิด CAR ใบนั้น; รับ prefill จาก Chem Lab |
| 28 ก.ย. | พิมพ์ใบ CAR **สบค-08** และทะเบียน **สบค-09** (Excel + PDF) | `services/carXlsx.js` แก้ sheet XML ตรงด้วย JSZip (คง style), จุด → `dots()`, ช่องว่าง → `gaps()`, checkbox Wingdings → ☑ · ≥/≤ เขียนเป็น "ไม่ต่ำกว่า/ไม่เกิน" (ฟอนต์ไทยไม่มี glyph) · ส่วนที่ 3 (ลงรับ/ส่ง) เว้นว่าง (กรอกมือ) · ทะเบียน wrap text + ให้ Excel ตัดบรรทัดไทย (`xlsxlog.ps1`: autofit → page break → เติมแถวว่าง) · `GET /api/car/log/:fmt?fy&system`, `GET /api/car/:id/form/:fmt` · `services/officePdf.js` คิว COM ร่วม |
| 28 ก.ย. | E2E ทุก role | ออก → operator ตอบ → 3A อนุมัติ → ติดตาม#1 ไม่ผ่าน → #2 ผ่าน → 3B ปิด (LINE จริงทุกขั้น) · ลบ CAR เก่าทั้งหมด (มี backup) · เก็บ CAR ทดสอบ **CQ 01/2569** ไว้ (ใบจริงใบแรกจะเป็น CQ 02/2569) |

ผู้ใช้ยืนยัน: "ผอ....." ส่วนที่ 2 = ผอ.กผจ. (ผู้อนุมัติกลุ่ม 3A) · "วันที่แก้ไขแล้วเสร็จ" ในทะเบียน = `correction_deadline`

### F10.3 งานค้าง
- ไม่มี field "การตรวจติดตามภายใน ครั้งที่..." / "อื่นๆ ระบุ..." ในฟอร์มสร้าง CAR
- ตัวเลือกที่เสนอไว้: บังคับรูปแบบเลขเมื่อพิมพ์เอง, บังคับกรอกผู้รับ, Dashboard CAR prefill CQ
- ลิงก์ `car_key` ของเคส Chem Lab เดิมชี้ CAR ที่ถูกลบ (ผู้ใช้รับทราบ)
- `/record` ยังขึ้น CAR prompt ทุกครั้งที่เกินเกณฑ์ (รวมสีน้ำเงิน) — อาจเปลี่ยนให้ขึ้นเฉพาะแดง (ยังไม่ได้ถาม)

---

## F11. เกณฑ์สถานการณ์ → Event Class → Alarm → สีทุกหน้า

### F11.1 ความเป็นมา
- เกณฑ์คุณภาพน้ำ (LCL/UCL) ต่อ "สถานการณ์" (ปกติ, น้ำดิบขุ่นสูง, น้ำดิบด้อยคุณภาพ, สาหร่าย, น้ำท่วม ฯลฯ) อยู่ใน `server/scenarios/scenario_*.json` แต่แต่ละหน้า/ระบบใช้ตัวเลขของตัวเอง (กราฟ Dashboard ตัวเลขตาย, BellBeast LAB card ตัวเลขตาย, Event Class ของ alarm ตั้งตัวเลขซ้ำต่อสถานการณ์)
- ผู้ใช้นำแผนปฏิบัติการฉุกเฉิน `SD-MS-HACCP-สกล-09 Rev082.pdf` มาตั้งค่า (5 กรณี: น้ำดิบขุ่นสูง, น้ำดิบด้อยคุณภาพ เฝ้าระวัง/วิกฤติ, สาหร่ายอุดตันบ่อกรอง เฝ้าระวัง/วิกฤติ, น้ำท่วม 1–3, แผ่นดินไหว — 2 กรณีหลังไม่มีเกณฑ์คุณภาพน้ำ)
- เกณฑ์เปลี่ยนแล้วไม่มีประวัติ จึงย้อนดูไม่ได้ว่าค่า ณ เวลานั้นใช้เกณฑ์อะไร

### F11.2 วัตถุประสงค์
- ต้นฉบับเกณฑ์ที่เดียว = `/config → สถานการณ์` (JSON, `min` = LCL, `max` = UCL)
- Event Class (setpoint ของ alarm) **อ้างอิงเกณฑ์** ไม่ตั้งตัวเลขซ้ำ
- สีแสดงผลทุกหน้าใช้ UCL/LCL ชุดเดียว: เกินครั้งแรก = **น้ำเงิน**, เกินติดกันครั้งที่ 2+ = **แดง**, ตัวอย่างถัดไปเข้าเกณฑ์ = reset, รอบที่ไม่มีค่าข้ามไป (ไม่ reset)
- เก็บประวัติเกณฑ์ตามช่วงเวลา

### F11.3 Workflow หลังแก้
```
/config สถานการณ์ → ปุ่ม "ตั้งค่าเกณฑ์" (ScenarioThresholdModal) → PUT /api/config/scenarios/files/:filename (validate, เขียน tmp→rename)
           → เปิดใช้สถานการณ์ PUT /api/scenarios/:id/activate / สลับโรคระบาด PATCH /api/scenarios/epidemic
           → scenarioHistory.syncNow() → scenario_periods (+ thresholds, rev) → kick Uroboros eventclass.sync
อ่านเกณฑ์: GET /api/scenarios/limits (active + configparam_id, ไม่ต้อง login) · /streaks?date&slot · /at?date&slot · /thresholds · /live
Event Class: rule.ref = {bound: UCL|LCL, mode: eq|pct|offset|abs, amount}
  GET /api/eventclass?enabled=true → resolveItem() คำนวณ rule.value ตามสถานการณ์ active (รวม epidemic) → Uroboros (ไม่ต้องแก้ Uroboros)
  สถานการณ์ไม่มี bound นั้น → class ถูกตัดทิ้งเงียบๆ
Uroboros: eventclass.sync (30 วิ) → eventclass_cache.json · alarm.eval (60 วิ) อ่าน data.db lab_import_daily (ค่าต้องใหม่กว่า 480 นาที)
  → BellBeast /api/alarm/active → popup/เสียง MHxView + Annunciator · เปลี่ยนสถานการณ์มีผลใน ~1.5 นาที
```

### F11.4 งานที่ทำ (เรียงตามเวลา)
| วันที่ | งาน |
|---|---|
| 27 ต.ค. | ScenarioThresholdModal (คัดลอกจากสถานการณ์อื่นได้) · Event Class แบบอ้างอิง (`POST /api/eventclass/levels` สร้างชุด L2/L1/H1/H2, `DELETE /api/eventclass/:id`, `LevelsModal` พรีวิวค่าทุกสถานการณ์) · แปลง `normal_*` เดิม 26 รายการ → 52 คลาสอ้างอิง (H2 = UCL / L2 = LCL critical, H1 = 90% UCL / L1 = 110% LCL warning) ทั้งหมดเป็นร่าง (ปิด) |
| 27 ต.ค. | สีน้ำเงิน/แดงใน `/record`, Dashboard/OpDashboard (`getThreshold`), BellBeast MHxView LAB card (`LABview.js` ดึง limits ทุก tick, เส้นประ UCL/LCL, หัวการ์ด "เกณฑ์: <สถานการณ์>", ติดต่อ LabVenture ไม่ได้ → `getStatusRules()` ตัวเลขสำรอง หัวการ์ดเหลือง) |
| 29 ต.ค. | ปรับ scenario ตามแผนฉุกเฉิน (rename "น้ำขุ่น" → "น้ำดิบความขุ่นสูง", ลบ "สาหร่ายสูง" ที่ซ้ำ) · แนวทาง RW: ค่าของแต่ละสถานการณ์ = จุดยกระดับไปขั้นถัดไป (เช่น Cond ปกติ 300 → เฝ้าระวัง/วิกฤติ 400) · สลับ scenario ต้องมีสิทธิ์เขียน + แจ้ง Uroboros ทันที · occurrence เก็บ scenario/เกณฑ์ ณ ตอนเกิด, `clear_reason`, `scenario_changed`, `is_test` · เกณฑ์โรคระบาดปรับได้ (`epidemic_thresholds`) · Event Class เปลี่ยน → `syncThenEval` |
| 29 ต.ค. | **Test mode** หน้า config (Ctrl+Shift+F10, super admin): ฉีดค่าแล็บปลอมเข้า Uroboros (in-memory `AlarmTestOverlay.cs`, `/api/alarm/test/lab`) → alarm มี `test:true` / `[TEST]` · สลับ scenario แบบ [TEST] · TTL ค่าเริ่มต้น 15 นาที |
| 31 ต.ค. | `GET /api/scenarios/live` → `{marquee, rev, scenario, epidemic}` (`rev` = md5 ของ activeLimits) ให้ MHxView รู้ว่าเกณฑ์เปลี่ยนเองโดยไม่ต้อง F5 (F12) |
| 1 พ.ย. | **scenario_periods** (F11.6) |
| 4 พ.ย. | ปรับ anomaly + ทดสอบ lab alarm กับ DB จริง (F11.7) |

### F11.5 สองประเภทของ alarm (ผู้ใช้กำหนด)
1. **anomaly true/false** ใน `alarm_rules.json` ของ Uroboros (ค่า sensor ผิดปกติทางสถิติ) — **ห้ามยุ่งจากฝั่ง LabVenture**
2. **เกณฑ์ควบคุมจาก scenario** → Event Class `rule.ref` (งานของ LabVenture)

### F11.6 scenario_periods (1 พ.ย.)
- ตาราง `scenario_periods` + `scenario_period_thresholds` (มี `rev`, `epidemic` true/false, `scenario_id = 0` = ชุดเกณฑ์โรคระบาด) · `scenario_log` เดิมคงไว้อ่านอย่างเดียว (migrate ครั้งแรก `source='migrated'`)
- `services/scenarioHistory.js`: `syncNow(reason)` (init | scenario | thresholds | epidemic | epidemic_thresholds), `thresholdsAt(date, slot)`, `makeResolver()`, `periodsOnDate()`, `maybeSync()` ตรวจไฟล์ทุก ≤ 30 วิ (จับการแก้ JSON ตรง)
- `/config` ยังเป็นที่แก้เกณฑ์ที่เดียว — DB แค่ "จด" · rev เพิ่มเมื่อค่าเปลี่ยน ไม่ทับ rev เดิม
- เวลาของรอบ: `HH:MM` = เวลานั้น, `daily/weekly` = สิ้นวัน · `scenario.js` `breachMarks()` ตัดสิน first/repeat, `streaksBefore()` ใช้เกณฑ์ ณ เวลา
- ใช้กับไฟล์พิมพ์ DailyLab (F1.7) และ `/record`

### F11.7 Alarm engine ฝั่ง Uroboros (4 พ.ย.)
- task เก็บข้อมูลเปลี่ยนเป็นทุก 60 วิ → FSNL (warm-up) **30 นาที** และ `interval_sec` = 60 (ถ้าไม่ตรง `AnomalyReadiness.Check` เห็น "gap inside window" → ค้าง FSNL ตลอด) · `alarm_rules.json` hot-reload
- **anomaly ใหม่:** baseline = window ก่อนหน้า (ไม่รวมค่าล่าสุด) · σ_eff = max(σ, sigma_floor, pct_floor% × |mean| / k) · ดังเมื่อ |x − mean| ≥ max(kσ, k·sigma_floor, pct_floor% × |mean|) · ค่า k = 3, for_polls = 2, pct_floor = 3% (7 ตัว: rwp1_flowp1/p2, rwp2_flowp3/p4, DPS_flowA/B, TR_flow)
  - เหตุผล: k=2 เตือนผิด ~4.55% ของ sample (~65 ครั้ง/วัน/param); z ที่รวมค่าล่าสุดมีเพดาน (n−1)/√n ≈ 5.29; สัญญาณนิ่ง σ เล็กมาก (0.2% ของ flow)
  - จำลองบน history.db จริง: แบบเดิม 60 alarm → แบบใหม่ 1 alarm · tests 311/311
- **lab alarm:** ค่าแล็บจาก `data.db` `lab_import_daily` (task `LAB.import.daily` **ถูกปิดอยู่** → ค่าจริงล่าสุด 15 ต.ค.) · ทดสอบฉีดค่าจริง: CW1 ความขุ่น 6.0 → `lab:cw1_turb_h2` + popup "IoT ALARM · วิกฤต · แล็บ · CWS" · TW1–4 Cl 1.2 ขณะโหมดโรคระบาด → `_l2` ดังครบ 4 ตัว

| param | เกณฑ์ |
|---|---|
| CW1.turb UCL | ปกติ 5 · น้ำดิบขุ่นสูง 3 · ด้อยคุณภาพเฝ้าระวัง 3 · วิกฤติ 2 · สาหร่ายเฝ้าระวัง 3 · สาหร่ายวิกฤติ 2 |
| TW1–4.ResCl2 | 1.0–1.4 ทุกสถานการณ์ · โรคระบาด 1.4–1.8 (`DEFAULT_EPIDEMIC`) |
| MHxView fallback | ปกติ CW T ≤ 5, CW CL ≤ 0.3, FW/TW T ≤ 1, TW CL 1.0–1.4 · ฉุกเฉิน CW T ≤ 3, CW CL ≤ 0.5 (ไม่ sync กับ /config) |

### F11.8 งานค้างของ F11
- ตัดสินใจเปิด `LAB.import.daily` (ถ้าเปิด importer จะ DELETE+insert ตามช่วงวัน แถวที่ฉีดทดสอบอาจหาย)
- ข้อมูลทดสอบค้าง: `lab_import_daily` id 40465–40469, Event Class CL 8 ตัวเปิดอยู่, `epidemic = true` (ผู้ใช้เปิดเอง) — มี backup
- Event Class 52 ตัวเป็นร่าง ผู้ใช้ต้องเลือกเปิดเอง · จุดที่ยังไม่มี alarm: CW tank A/B, FW1–4 ResCl2, TW1–4 pH
- คลิปเสียงที่ยังไม่มี: `s_lab_rw_conduct`, `s_lab_rw_oc`, `s_lab_algae_rw_total`; `algae_rw_total_h2` → `lab:932` ไม่มีใน schema
- พารามิเตอร์ตามแผนที่ระบบยังไม่มี: แอมโมเนีย, TOC, SUVA, THMs, Chlorophyll, ชนิดสาหร่ายแยก · หน่วย `Algae.*` เขียน cell/mL แต่ค่าจริงเป็นหน่วย/100 มล. · `Incoming.*` (ท่าม่วง/บางเลน) ไม่มี configparam_id (พักไว้)
- น้ำท่วม/แผ่นดินไหว: เสนอเป็นสวิตช์เสริมแบบโรคระบาด (ยังไม่ตัดสินใจ)
- ความไม่สอดคล้องในแผน PDF: ความถี่ตรวจสาหร่าย CW (หน้า 9 vs 11), Residual Cl "5.0" (หน้า 6) ควรเป็น 0.5
- ไม่มี UI ลบ/แก้ไฟล์ scenario · ควรเตือนเมื่อ Event Class ถูกตัดเพราะสถานการณ์ไม่มี bound · ช่วง LabVenture ล่ม Uroboros ใช้ cache ชุดล่าสุด (ตรวจแล้วใน F14)
- จูน `pct_floor` ต่อ param เมื่อมีข้อมูลจริงหลายวัน · BellBeast `alarmmonitor.js` ยังไม่แสดง pct_floor

---

## F12. งานฝั่ง BellBeast / MHxView / อุปกรณ์

| งาน | วันที่ | รายละเอียด |
|---|---|---|
| Audio Library "TTS ทั้งหมดที่ขาด" | 27 ต.ค. | รวมรายการขาดจาก `/labventure/api/eventclass/clips-needed` แล้ว TTS ทีละคลิป · แก้ปุ่มค้าง/ความยาว `NaNs` · สร้าง 24 คลิป (`s_lab_*`, `s_ntu`, `s_mgl`) รวม 73 คลิป |
| TTS ตรวจผล | 29 ต.ค. | `/api/audio/tts` ตรวจ transcript + ความยาวก่อนบันทึก (retry 3, `force:true`) — ต้นเหตุเสียงหลุด "เข้าใจแล้วนะ ฉันจะพูดชัดเจน" ใน `s_mgl` |
| MHxView popup alarm | 29 ต.ค. | `MHxIotAlarm.js` ไม่เก็บไฟล์เสียง (no-store ทุกครั้ง เล่นจบทิ้ง) เก็บแค่ข้อความ alarm ที่ active — **อย่ากลับไปใช้ cache/ETag** |
| หน้า `/DailyReport` ใน BellBeast (ไม่ต้อง login) | 31 ต.ค. | เลือก MH_report / DailyLab / รวม Daily Dosage · ปฏิทินสีสถานะ (ครบ/ไม่ครบ/รอ SAVE DB/ไม่มีข้อมูล) คลิก/ลาก/Shift+คลิก ≤ 62 วัน · ตาราง วันที่ / ผู้จัดทำ-ผู้ทบทวน / MH / DailyLab / ปุ่ม Excel / หมายเหตุ · "Download table" = Excel ข้อมูลดิบ · LabVenture ใหม่ `GET /api/write/record-dates`, `GET /api/write/table.xlsx` (ชีท DailyLab, Params, MH_summary 104 คอลัมน์แจกแจงรายเฟส, MH_detail) |
| แถบข่าว MHxView | 31 ต.ค. | `marquee_items` หลายข้อความ (≤ 20, คั่น 📢) แก้ใน `/config` (MarqueeEditor) · `MHxLiveFeed.js` poll `/scenarios/live` ทุก 15 วิ, วิ่งขวา→ซ้ายออกจากข้างป้ายสถานะ, hover หยุด · ป้ายมุมขวา = สถานการณ์ (วิกฤต/ฉุกเฉิน แดง, เฝ้าระวัง เหลือง, ปกติ เขียว) + สถานะโรคระบาด · `rev` เปลี่ยน → `LABView.tick()` + event `lv:limits-changed` |
| ปุ่ม "↩ MHxView" ใน LabVenture | 31 ต.ค. | `utils/mhxView.js` (ผ่าน proxy → `/MHxViewer/MHxView`; เปิดตรง 8889 → `:443/...`) ใน header, sidebar, เมนูมือถือ, หน้า login |
| Annunciator ESP32 | 4–5 พ.ย. | หน้า HOME = แถบสถานการณ์/โรคระบาด + ค่าแล็บ 4×4 (fw ann-1.2.0), หน้า LAB แบบสัมผัส, test signal · BellBeast `/Admin/Annunciator` (จำลองจอเครื่อง) + `/api/device/lab/scenario` · ไม่มีผลแล็บในช่วง = แสดง `--` (ไม่แสดงค่าเก่า) · LVGL ตัด "ศ" ท้ายคำ (เลี่ยงด้วยถ้อยคำ) · รายละเอียดอยู่ใน `iot\Re-plan\iot-device_*.md` |

ข้อสังเกต BellBeast: proxy `/labventure/*` อยู่ `Program.cs` ~บรรทัด 427 · `GET :443/labventure/` (มี `/` ท้าย) redirect วนไม่จบ (ยังไม่แก้) · Razor ไม่มี runtime compilation · BellBeast serve static จากตอน build → แก้ JS ต้อง publish + restart · Uroboros `HttpListenerException (64)` ใน `LabSummaryModule` = ผู้เรียกตัดการเชื่อมต่อ (browser refresh) ไม่มีผลกระทบ

---

## F13. รายงานสาหร่าย (Algae print-out)

### F13.1 ความเป็นมา
รายงานสาหร่ายรายวันพิมพ์ตามฟอร์มของไฟล์ `Algae2569.xlsx` · template เก่า (`algae_master`) ทำโลโก้หาย, µ กลายเป็น m, ป้าย Division หาย

### F13.2 สิ่งที่ทำ (2 ต.ค.)
- template ใหม่ที่ผู้ใช้ทำเอง `Algae_theme.xlsx` (ชีท "ต้นฉบับ"): คุณภาพน้ำแถว 9–11 (RW/TW1/TW2), ตารางชนิดแถว 15–89 (D–J = RW, TW1, TW2, CW1–4), สรุป 90–95, ผู้ลงนาม C103/C104 — **ห้ามแก้โครงสร้าง theme** · ย้ายไป `server/templates/` เมื่อ 30 ต.ค.
- `algae_exporter.py` เขียนใหม่: แก้ XML ใน zip ด้วย stdlib (`xml.etree` เพราะเครื่อง deploy ไม่มี lxml) ไม่ save ผ่าน openpyxl → คงโลโก้ EMF, rich text (`Cond(µS/cm)` ฟอนต์ Symbol), style · copy sheet/drawing ต่อวัน, ลบ calcChain, `fullCalcOnLoad=1`
- AutoFilter `A13:K89` คอลัมน์ D (RW) ≠ ว่าง (ผู้ใช้สั่ง) → ซ่อนชนิดที่ RW ว่าง · ย้ายป้าย Division ไปแถวแรกที่แสดงของกลุ่ม · ซ่อนแถวคุณภาพน้ำของสถานีที่ไม่มีข้อมูลสาหร่าย · ชื่อผู้วิเคราะห์ = คนที่กดพิมพ์ · ชนิดที่ไม่มีใน theme → แจ้งเตือน
- 1 ชีทต่อวันที่เก็บตัวอย่าง; 29 ต.ค. popup พิมพ์ใช้ปฏิทินเลือกเฉพาะวันที่มีข้อมูล (`/api/algae/export-info`)

### F13.3 ผลทดสอบ (`e2e_jun18/`)
กรอกผ่าน UI จากชีท "18 มิ.ย." → ตรง **147 / ต่าง 1** (แค่ช่องว่างคู่ใน F3 ของต้นฉบับ) · ชนิด 75/75, แถวว่างถูกซ่อน 63/63, filter ถูก · ไฟล์ `printout_algae_2026-06-18_v2.{xlsx,pdf}`, `compare_jun18_v2.txt`, `source_18jun.pdf`, สคริปต์ `compare.py` (ไฟล์ไม่มี `_v2` = รอบแรกที่ยังใช้ template เก่า)

### F13.4 งานค้าง
- filter คอลัมน์ D ทำให้ชนิดที่พบแค่ TW/CW ถูกซ่อน (เสนอเปลี่ยนเป็น "ไม่ว่างในคอลัมน์ใดก็ได้ D–J" ยังไม่ได้คำตอบ)
- ค่าคุณภาพน้ำ CW1–4 ไม่ถูกพิมพ์ (theme มีแค่ RW/TW1/TW2 ตรงฟอร์มจริง)
- `routes/algae.js`, `algae_exporter.py` ใน deploy ใหม่กว่า repo (มีคนแก้ deploy ตรง) — อย่า copy ทับ

---

## F14. DB health / self-init

### F14.1 ความเป็นมา (6 พ.ย.)
บนเครื่อง deploy task `eventclass.sync` ของ Uroboros ขึ้น `eventclass sync failed (using cache 10): ... 500` เพราะ `labventure.db` บนเครื่อง deploy เป็น schema รุ่นเก่า (18 ตาราง ไม่มี `event_classes` และตาราง PM) → `SQLite3Error: no such table: event_classes` · สันนิษฐานว่าไฟล์ถูกวางทับขณะ server รันอยู่ `initDb()` จึงไม่ได้สร้างตาราง · Uroboros เรียก `LABVENTURE_URL` (`http://localhost:8889`) + `/labventure/api/eventclass?enabled=true` ตรงๆ ไม่ผ่าน BellBeast · alarm ยังทำงานเพราะใช้ `eventclass_cache.json`

### F14.2 สิ่งที่ทำ
- ซ่อม DB: `Downloads\labventure_fixed.db` = ไฟล์ deploy + รัน `initDb()` (28 ตาราง) + Event Class 20 ตัว (เปิด 10: cw1/cw2 turb > 5, tw1–4 ResCl2 > 1.4 / < 1) — ทดสอบได้ HTTP 200
- commit `79bebe4`: ตรวจทุก 60 วิ และทุกครั้งที่เจอ "no such table" → รัน `initDb` ซ้ำแล้วตอบ 503 · ถ้า `event_classes` ถูกสร้างใหม่แบบว่าง → `?enabled=true` ตอบ 503 ให้ Uroboros ใช้ cache ต่อ (flag ใน `db_meta` ปลดเมื่อมี ≥ 1 แถว) · endpoint `GET/POST /labventure/api/health/db[/repair]`
- commit `9b9f74f`: snapshot งานค้างตั้งแต่ 29 ต.ค. (161 ไฟล์ ตามที่ผู้ใช้สั่ง)

### F14.3 วิธีนำไปใช้บนเครื่อง deploy
1. copy 5 ไฟล์ server (`index.js`, `services/db.js`, `services/dbHealth.js`, `routes/health.js`, `routes/eventClass.js`)
2. **ปิด LabVenture ก่อน** → backup → วาง `labventure_fixed.db` เป็น `server\labventure.db` → เปิด
3. ตรวจ `curl http://localhost:8889/labventure/api/health/db` (ok, 28 ตาราง, event_classes 20/enabled 10) และ log Uroboros `[EVENTCLASS] synced 10 classes` ภายใน 2 นาที · ถ้าเห็น `created`/`recreated_at` = วาง DB ผิดตัว
- fresh install ที่ event_classes ว่างจริงจะได้ 503 จนกว่าจะสร้าง class แรก (ตั้งใจ)

---

## 3. กฎ/ข้อตกลงถาวรกับผู้ใช้

| กฎ | ที่มา |
|---|---|
| ตอบเป็นภาษาไทยเสมอ | memory |
| ห้าม commit/push จนกว่าผู้ใช้สั่ง · working tree มีงานปนเยอะ ห้าม `git add -A` ให้เลือกไฟล์/hunk | ทุก handoff |
| ห้ามแก้ `time_slot` ใน `operator_nodes.json` โดยไม่ได้รับคำสั่ง (แก้ schedule ที่ `schedule_overrides.json`) | 20 ก.ค., 24 ก.ค. |
| ห้ามเพิ่มความถี่/รอบเวลาใหม่ใน Scientist ใช้ field opt-in แบบ `inSlot` | 2 ต.ค. |
| ฟอร์มพิมพ์ต้องใช้แบบฟอร์มต้นฉบับ ห้ามสร้าง layout เอง (สคบ-14, สบค-08/09, MH_report, Algae, DailyLab) — แก้ด้วยการใส่ค่าลง XML เดิม | 28 ก.ย. เป็นต้นไป |
| template เปล่าอยู่ `server/templates/` · `server/data/` เก็บข้อมูลทำงานเท่านั้น | 30 ต.ค. (CLAUDE.md) |
| ห้ามแก้โครงสร้าง `Algae_theme.xlsx` | 2 ต.ค. |
| ห้ามเขียนลง `chem.db` · LAB_* อยู่ `chemlab.db` ข้าง Uroboros.exe (ไม่ใช่ data.db) | spec Chem Lab |
| ไฟล์ปลายทาง Excel (ระบบเดิม) เขียนเฉพาะข้อมูลแล็บ; ไฟล์พิมพ์ลงสีตามเกณฑ์ ณ เวลา | 1 พ.ย. (memory) |
| Daily Report auto-run: Shift 0 = ระบบ save; ไม่ทับที่คน save | 31 ต.ค. (memory) |
| เครื่อง deploy ตั้งปฏิทิน พ.ศ. → ใช้ InvariantCulture / `toISOString()` / `nowTH()` เสมอ; Uroboros มี `CalendarGuard` | 31 ต.ค. (memory) |
| สั่งลบข้อมูลใน .db ลบได้เลยไม่ต้องสร้าง .bak (แต่ deploy ต้อง backup ก่อนทับไฟล์) | memory |
| Admin/AD login เป็นของผู้ใช้ ห้ามกรอกรหัสแทน — ให้ผู้ใช้ login ใน browser pane เอง | หลาย session |
| LINE ใช้งานจริง — ทดสอบที่จะออก CAR ต้องถามก่อน ถ้าปิด token ชั่วคราวต้องบอกและคืนทันที | 27 ก.ย. |
| alarm anomaly ใน `alarm_rules.json` ห้ามยุ่งจากงาน LabVenture | 29 ต.ค. |
| MHxView popup ห้าม cache ไฟล์เสียง | 29 ต.ค. |
| HOME ของ Annunciator ไม่มีผลแล็บในช่วง = `--` ไม่แสดงค่าเก่า | 5 พ.ย. |
| handoff ใช้ไฟล์ในโปรเจกต์ (append เท่านั้น) ไม่ใช้ temp | memory |

---

## 4. การ Deploy และการดูแลระบบ

### 4.1 โครงสร้าง production (`Fullscale_V2`)
| ระบบ | ที่อยู่ | หมายเหตุ |
|---|---|---|
| LabVenture | `DEPLOY_LabVenture\` (ไม่ใช่ git) | node :8889 · ใช้ DB ของตัวเอง (ต่างจาก dev) · ไฟล์ server เป็น CRLF |
| Uroboros | `Uroboros_proj\` | `data.db`, `history.db`, `engine_admin.db`, `chemlab.db`, `alarm_rules.json`, `media\chem.current.txt` |
| BellBeast | `BellBeast_proj\` | `App_Data\`, `appsettings*.json` ห้ามทับ |
| สคริปต์ | `START_FULLSCALE_LOCALHOST.ps1/.cmd`, `STOP_FULLSCALE.ps1` | self-elevate (UAC ทุกครั้ง) · START อ่าน `DAILY_AUTO_KEY` + `PORT` จาก `.env` ส่งให้ Uroboros |
| Backup | `_backup\<ระบบ>_before_<tag>_DDMM\` | ทำก่อนทับทุกครั้ง |

### 4.2 ขั้นตอน
- **LabVenture client:** `cd client && npx vite build` (production เท่านั้น — `--mode development` ทำให้ BASE ว่าง) → `robocopy client\dist <deploy>\client\dist /MIR` (exit 1–3 = สำเร็จ) · เปลี่ยน client อย่างเดียวไม่ต้อง restart · ผู้ใช้กด Ctrl+Shift+R
- **LabVenture server:** `diff --strip-trailing-cr` ตัว deploy กับ repo ให้ต่างแค่งานที่ตั้งใจ → copy เฉพาะไฟล์ (ห้ามทับ `.env`, `config/`, `scenarios/`, `*.db`, `node_modules`) → `require` check → restart ด้วย `DEPLOY_LabVenture\start.bat` แบบ elevated (`Start-Process cmd.exe -ArgumentList "/c set LABVENTURE_HIDDEN=1&& "<full path>\start.bat"" -Verb RunAs -WindowStyle Hidden` — ต้องใส่ path เต็ม) · ไม่มี `--watch` → แก้ server ทุกครั้งต้อง restart
- **ไฟล์ใน deploy ที่ต่างจาก repo อยู่ก่อน (อย่าทับ):** `routes/progress.js`, `routes/algae.js`, `algae_exporter.py`, `config/{aquadat_configs,excel_cell_map,params}.json`, `scenarios/*.json`, `app_settings.json`
- **Uroboros:** STOP → `dotnet publish Uroboros/Uroboros.csproj -c Release -r win-x64 --no-self-contained -o <scratch>` → `cmp` กับ live → copy เฉพาะที่เปลี่ยน (ไม่ทับ `appsettings.json`) → START · DLL build จาก working tree ทั้งหมด (รวมงานอื่นที่ยังไม่ commit)
- **BellBeast:** `dotnet publish -c Release -o <scratch>` → backup → `robocopy <publish> BellBeast_proj /E /XD App_Data /XF appsettings.json appsettings.Development.json web.config` (ห้าม /MIR) · **ห้ามใช้ `FolderProfile5.pubxml` ตรง** (ทับ `App_Data\audio\manifest.json`, appsettings) · restart เฉพาะ BellBeast ได้ด้วยสคริปต์ elevated ครั้งเดียว
- **วิธี deploy จริงที่ผู้ใช้ใช้ (6 พ.ย.):** copy `DEPLOY_LabVenture` ทั้งโฟลเดอร์ไปเครื่องปลายทาง แล้ววาง **config + db ล่าสุดของเครื่องนั้นทับ** — ต้องปิด LabVenture ก่อนวาง db ทุกครั้ง และ db ต้องเป็นไฟล์ล่าสุดที่เพิ่งเอาออกหลังปิด server (ห้ามใช้ backup เก่า) → ตรวจ `/labventure/api/health/db`
- เครื่อง deploy ติดตั้ง Python แบบ offline จาก `DEPLOY_LabVenture/setup/py_wheels` (cp313: openpyxl, xlwings, pywin32, et_xmlfile) → **ห้ามเพิ่ม dependency Python ใหม่** ถ้าไม่เพิ่ม wheel
- PDF ทุกชนิดใช้ MS Office COM (Word/Excel) บนเครื่อง server — ถ้ารันเป็น Windows Service อาจใช้ COM ไม่ได้

### 4.3 การทดสอบโดยไม่แตะข้อมูลจริง
- เพิ่ม config ชั่วคราวใน `.claude/launch.json`: server `PORT=3002`/`3999`/`8899` + `LV_DB_PATH=<สำเนา>` + `UROBOROS_BASE_URL=http://localhost:1` (กัน alarmWatcher/kick) + `LINE_CHANNEL_ACCESS_TOKEN=""` + AquaDAT ชี้ `127.0.0.1:9`; client vite `API_TARGET=http://localhost:<port>` (5174/5175) — ลบออกหลังใช้
- ล้าง `aquadat_queue`/`excel_queue` ในสำเนาก่อนรัน (queueWorker ยิงของจริง)
- ⚠ test server ใช้ `server/config/*.json` และ `scenarios/*.json` ร่วมกับตัวจริง — อย่าบันทึก config/เกณฑ์จาก test server (เคยเผลอเปิดโหมดโรคระบาดจริง ~1 วิ)
- Chem Lab mock: `services.json chem_lab.mock=true` + `mock_chem_db`/`mock_lab_db` ชี้ไฟล์ใน scratchpad — คืนค่าทุกครั้ง
- login ทดสอบ: cookie `aquadat_token` แบบ bypass (payload `bypass:true, role:...`) หรือ `POST /api/auth/bypass`
- stub stage: server เล็กตอบ `{"stage":0}` แล้วตั้ง `BELLBEAST_STAGE_URL`

### 4.4 เหตุการณ์ระบบที่เคยเกิด
- Fullscale ล่มทั้งชุดหลาย session (27 ต.ค., 29 ต.ค. ×2, 31 ต.ค.) โดยไม่ทราบสาเหตุ (ไม่ได้เกิดจากการ copy static)
- LabVenture เคยถูกรันจาก repo แทน DEPLOY (คนละ DB) → ข้อมูลที่บันทึกช่วงนั้นไปอยู่ DB ของ repo
- DB ของ deploy ถูกวางทับ → แถว SAVE วันที่ 29/10 หาย (30 ต.ค.) และ DB schema เก่าไม่มีตาราง alarm (6 พ.ย. → F14)
- Disk C เต็ม (ENOSPC) ตอน build 27 ต.ค. — ล้าง npm cache เหลือ ~3.6 GB; `.nuget\packages` 6.7 GB
- หลัง START ครั้งหนึ่งได้ Uroboros/BellBeast 3 ตัวที่ตายไป → STOP/START ใหม่แก้ได้ · นอกไซต์ Uroboros บูตแบบ paused และ start task timeout หลายนาที (`engine_online:false` เป็นเรื่องปกติ)

---

## 5. Gotchas ทางเทคนิค (สะสม)

| หมวด | เรื่อง |
|---|---|
| ข้อมูล AquaDAT | `var_data` ต้องครอบ `[` `]` ก่อน parse · REST ไม่มีแถว 00:00 (ใช้ 24:00 ของวันก่อน) · มีแถวของ slot อนาคต · สถานีเคมีใน REST = `CDS` · ชื่อ station ไม่มีเลข · ยิงขนานมากแล้ว timeout · พอร์ต 12007 อาจต่อไม่ได้จากบางเครือข่าย |
| ข้อมูล Uroboros | วันหนึ่งมี 25 แถว (D+1 00:00 = slot 24:00) → ใช้ `seenMidnight` · ghost record (null + value_text ว่าง) ที่ขอบกะ · CSV `/api/process` เติม 0 ให้ช่องว่าง (เลิกใช้) · data.db fallback มีแค่วันล่าสุด |
| SQLite | `chem.db` เป็น WAL → `node-sqlite3-wasm` query ไม่ได้ (mock ใช้ `node:sqlite` + `--no-warnings`) · `MH_report.db` ของ Sword ก็เปิดด้วย wasm ไม่ได้ (ใช้ sqlite3 CLI) · อ่าน live db ด้วย `sqlite3 -readonly` · DB ถูก swap ได้ → ตรวจคอลัมน์/ตารางทุกครั้ง |
| React | side effect ห้ามอยู่ใน state updater · TDZ: ประกาศ `const me` ก่อนใช้ derive · shadow ตัวแปรใน useMemo ทำหน้าขาว (minified "Cannot access 'k'") · `refetchOnWindowFocus` เปลี่ยน object reference → effect ยิงซ้ำ · `e.preventDefault()` บน mousedown block focus · แป้นไทยใช้ `e.code` · `parseFloat('-')` = NaN |
| Tailwind | `bg-earth-DEFAULT` ไม่สร้าง CSS ใช้ `bg-earth` |
| Vite/Build | ต้อง build production · EventSource ไม่ผ่าน Vite proxy (ใช้ fetch + ReadableStream) · bundle hash เปลี่ยนทุก build → hard refresh · `server.fs.allow: ['..']` สำหรับ import จาก `server/shared` |
| Windows/เครื่องมือ | PowerShell เขียน JSON ใส่ BOM → HTTP 500 (ใช้ Node `fs.writeFileSync`) · Git Bash heredoc กิน backslash ใน path (ใช้ `/`) · curl จาก Git Bash ส่งภาษาไทยเพี้ยน (ใช้ Python/Node) · Python print ไทยใน git-bash พัง (cp874) · `dotnet` ใน bash เป็น x86 · เครื่อง deploy ปฏิทิน พ.ศ. (`ToString("yyyy")` ได้ 2569) · auto-mode classifier ปฏิเสธ Stop-Process/elevated script บางครั้ง → ให้ผู้ใช้ทำเอง |
| Excel | openpyxl save ทำโลโก้ EMF + rich text หาย และ `copy_worksheet` ไม่ copy CF → แก้ XML ตรง · การตัดบรรทัดภาษาไทยต้องให้ Excel ทำ · PDF ด้วย COM ช้า |
| Proxy/URL | BellBeast :443 เป็น HTTP · ตัด `/labventure` ก่อนส่งต่อ → บน :8889 ตรงใช้ `/api/...` · navigate ใน React Router ห้ามใส่ `/labventure` ซ้ำ · Uroboros เรียก LabVenture :8889 ตรง (mount ซ้ำที่ `/labventure/api/...`) |
| ความปลอดภัย | bypass JWT ไม่ verify signature · :8888 ไม่มี auth · error 502 ของ daily-report มี token AquaDAT |

---

## 6. งานค้าง / คำถามที่ยังไม่ได้คำตอบ (ณ 6 พ.ย. 2569)

### 6.1 ต้องทำ
1. **Push** LabVenture (`9b9f74f`, `79bebe4`) และ commit repo Uroboros / BellBeast / iot (ทุก repo มีงานอื่นค้างปน — เลือกไฟล์)
2. นำ DB health + `labventure_fixed.db` ไปลงเครื่อง deploy จริง (F14.3)
3. เกณฑ์คุณภาพจริง PACl/ALUM (`lab_chem_spec.json` `verified:false`) + แบบฟอร์ม สคบ-14 ของ Alum
4. ตัดสินใจเปิด task `LAB.import.daily` เพื่อให้ lab alarm ใช้ค่าจริง + ล้างข้อมูลทดสอบ alarm
5. ล้าง/ตัดสินใจข้อมูลทดสอบ: Chem Lab (chem.db mock trips, chemlab.db), DailyLab 2026-11-01, CAR CQ 01/2569 (ผู้ใช้สั่งเก็บ)
6. ตัด token ออกจากข้อความ error 502 ของ `routes/dailyReport.js`
7. `server/__pycache__/*.pyc` ยัง track อยู่ใน git → `git rm --cached`
8. ตรวจที่ไซต์: Annunciator checklist (`iot\deploy_0411\DEPLOY.md`, `iot\deploy_0511\DEPLOY.md`), approve `ann-ac1808` ใน `/Admin/Fleet`, E2E stage 0 → 2 → 1 จริง

### 6.2 รอคำตอบจากผู้ใช้/หน่วยงาน
- ค่าไฟ: วิธีแบ่ง On/Off-Peak ของตารางผู้ใช้ (0.4416) และ VAT 7%
- หน่วย flow cfg 1/2/41/43 สำหรับวันคงเหลือคลอรีน · ราคา Polymer
- ระดับน้ำ/แรงดันของวันที่ยังไม่จบเป็น N/A ไหม · แก้ `bg-earth-DEFAULT` ทั้งแอปไหม
- รูปแบบชดเชยสารเคมีและการบันทึกใน AquaDAT (A–D) · CAR ของเคสที่ถูกยกเลิก · นำ CAR กลับมาผูกกับ Chem Lab
- RW pH 4 ชม. vs 12h · filter สาหร่ายคอลัมน์ D · ผู้ทบทวนใน MH_report เติม "สคน.<ผลัด>" ด้วยหรือไม่ · ป้าย "รอ SAVE DB" ในหน้า BellBeast DailyReport · MH_report ให้พอดี 1 หน้า
- CAR prompt ใน `/record` ขึ้นเฉพาะแดง? · น้ำท่วม/แผ่นดินไหวเป็นสวิตช์เสริม?
- ความหมาย "ดึงจาก db" ใน DailyLab + Operation (สมมติว่า = summary_table ของ SAVE DB)

### 6.3 ข้อเสนอที่ยังไม่ได้ทำ
- DAILY page QUERY + VALIDATE ALL + StationValidationCard (F4) · verify configID validator กับ VB
- responsive Dashboard มือถือ · ย้ายสี slot เป็น token
- แจ้ง LINE เมื่อ auto-run fail / UI แสดงผล auto-run
- แก้ redirect วนของ `:443/labventure/` · guard ฝั่ง server สำหรับ `/api/operator/*`
- cache limits ล่าสุดใน localStorage ของ MHxView แทน fallback ตัวเลขตาย
- ย้ายไฟล์พิมพ์ 2.2 ไปแทนไฟล์ปลายทาง 2.1 เมื่อเลิกระบบเดิม

---

## ภาคผนวก A — configID ที่ใช้บ่อย

### น้ำดิบ / ผลิต
| ตัวแปร | cfgId | สถานี | หมายเหตุ |
|---|---|---|---|
| Totalizer LINE A/B | 4 / 7 | RWS1 | DD×100 = ลบ.ม. (เฟส 1/2) |
| Totalizer LINE C/D | 42 / 44 | RWS2 | เฟส 3/4 |
| Flow rate เฟส 1/2 | 1 / 2 | RWS1 | m³/s (CHEM1 set point) |
| Flow rate เฟส 3/4 | 39 / 40 (และ 41/43) | RWS2 | m³/hr |
| Net flow (formula) | 8384/8385, 8386/8387 | RWS1/RWS2 | |
| ระดับบ่อน้ำดิบ | 9 | RWS1 | |
| TPS totalizer / net | 759 / 8388 | TPS | |
| DPS totalizer A/B / net | 873, 875 / 8389, 8390 | DPS | |
| ระดับ CWT | 876 (cm ×0.01) | DPS | ไม่ใช้ 8469 (ไม่อยู่ใน pattern) |
| แรงดัน DPS / TPS | 878 / 809 | | |
| Service water | 6534 | TPS | |
| ตะกอน | 205, 217 / 229, 241 / 6001, 6002 / 6003, 6004 | CWS1/CWS2 | |
| สถานะบ่อกรอง (REPAIR) | 314… (stride 10), 396…, 476…, 618… | FWS1/FWS2 | pattern 10/11 |
| Backwash base | 317 (P1), 399 (P2), 479 (P3), 621 (P4) | FWS | ระดับ FWS2 7944–7971 |

### พลังงาน
DPS 883, 885 · TPS 9278, 9277 · FWS1 9273, 9274 · FWS2 9276, 9275 · RWS1 33, 35 · RWS2 75, 77 · SS3 อาคาร 6775, 6776 (ไม่รวมในค่าไฟ)

### สารเคมี
| รายการ | CHEM1 | CHEM2 |
|---|---|---|
| ALUM DR | 89, 92 | 151, 154 |
| ALUM totalizer | 88, 91 | 150, 153 |
| ALUM tank | 93, 96 | 155, 158 |
| ALUM รับเข้า (ตัน) | 8037 (pattern 346) | 8036 (pattern 347) |
| PACl DR | 8402, 8404 | 8416, 8418 |
| PACl tank | 8405, 8407 | 8419, 8421 |
| PACl รับเข้า | 8423 | 8424 |
| PRE-Cl DR | 129, 131 | 192, 194 |
| POST-Cl DR | 133, 135 | 196, 198 |
| Cl line (kg) | 127, 128 | 190, 191 |
| Cl รับ / คืน (ท่อ) | 4333 / 4334 | 4339 / 4340 |

### Scientist (DailyLab)
Jar Test RW_ref: 984 Temp, 986 Turb, 987 pH, 988 Alk (05:00 Alum / 09:00 PACl), 8116 PACl Temp · TW1/TW2 Temp 4345/4346 (J63/J69, S63/S69) · lab CW1 ความขุ่น 1002 · TW1/2/3/4 Cl 1046/1055/1064/1067

### AquaDAT pattern (ยุค GraphQL)
Daily report: RWS1 111, RWS2 112, CHEM1 113 (+346, 350, 351, 367), CHEM2 114 (+347, 323, 366, 352), FWS1 109 + 1 (+10), FWS2 110 + 28 (+11), TPS 116 + 255, DPS 115, CWS1 3, CWS2 14 · CHEM2 Chlorine 352 + 9

---

## ภาคผนวก B — ไฟล์/เอกสารอ้างอิงนอกโฟลเดอร์นี้

| ไฟล์ | เนื้อหา |
|---|---|
| `js_refer/col_formula.md` | ไวยากรณ์และรายการ formula column ทั้งหมด |
| `server/config/operator_nodes.json` | นิยามสถานี/topic/param ของ operator |
| `server/config/schedule_overrides.json` | slot ต่อ configID สำหรับ progress |
| `server/config/lab_chem_spec.json`, `lab_case_tasks.json`, `services.json` | เกณฑ์/งานเคส/การเชื่อม Chem Lab |
| `record_opt.xlsx` (root repo) | ต้นทาง params ของทุกสถานี |
| `SD-MS-HACCP-สกล-09 Rev082.pdf` (root repo) | แผนปฏิบัติการฉุกเฉิน |
| `C:\Users\peera\OneDrive\Desktop\DDD\Sword\DailyReportValidator.vb`, `base.vb` | กฎ validator เดิม |
| `C:\Users\peera\OneDrive\Desktop\DDD\Sword\bin\...\MH_report.db` | schema/ค่าอ้างอิงของ SAVE DB |
| `C:\Users\peera\OneDrive\Desktop\iot\Re-plan\Labventure_progress2910.md` | รายละเอียดงานแผนฉุกเฉิน/test mode |
| `C:\Users\peera\OneDrive\Desktop\iot\Re-plan\iot-device_redesign0411.md`, `iot-device_scenario_home0511.md`, `iot\deploy_0411\`, `iot\deploy_0511\` | Annunciator |
| `Sidecar_prj/TruckSidecar/handoff/handoff2609.md`, `docs/architecture.md` | ที่มาของ chem.db / Sidecar |
| `Uroboros/handoff/handoff0411.md` | ขั้นตอน deploy Uroboros |
| `~/.claude/plans/*.md` | แผนที่ผู้ใช้อนุมัติแต่ละงาน (เช่น `c-users-peera-onedrive-desktop-sidecar-scalable-bear.md` Chem Lab D1–D17) |

> ไฟล์ทดสอบใน scratchpad ของ session ต่างๆ (harness, mock_flow_test.js, zsim2.py ฯลฯ) อาจหายไปแล้ว — ถ้าต้องการให้เขียนใหม่ตามคำอธิบายในเอกสารนี้
