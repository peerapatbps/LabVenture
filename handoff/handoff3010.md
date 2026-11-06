# Handoff 30/10/2569 — DAILY page: backwash 00:00, Filtration scroll, SAVE DB popup

ทุกอย่างในเอกสารนี้ **ยังไม่ commit** (branch `master` มีไฟล์ค้าง uncommitted อื่นอยู่เยอะจาก session ก่อน — ดู `git status`)
ดู diff ได้ที่: `client/src/pages/OpRecord.jsx`, `client/src/utils/refDate.js`, `server/routes/dailyReport.js`

## สถานะ ณ ตอนจบ session

| # | งาน | โค้ด | Deploy Fullscale_V2 | ตรวจบนหน้าจริง |
|---|-----|------|---------------------|----------------|
| 1 | บ่อกรองล้างเวลา 00:00 ไม่ขึ้นแดง | ✅ | ✅ | ❌ (ต้อง login) |
| 2 | แท็บ FILTRATION มี vertical scroll | ✅ | ✅ | ❌ |
| 3 | เอาปุ่ม VALIDATE + dropdown Shift ออก | ✅ | ✅ | ✅ ผู้ใช้เห็นแล้ว |
| 4 | SAVE DB → popup ยืนยัน (ผลัด + ผู้จัดทำ) + คำเตือนไม่ใช่วันนี้ในตัว | ✅ | ✅ client / ✅ ไฟล์ server | ⏳ รอ restart |

**ค้างอยู่ข้อเดียว:** LabVenture server บน Fullscale (node, port 8889, เปิด 01:12 ผ่าน START_FULLSCALE แบบ elevated) ยังรันโค้ดเก่า → `GET /api/daily-report/preparers` ได้ 404 → popup ขึ้น "โหลดรายชื่อไม่สำเร็จ: HTTP 404"
Agent สั่ง `Stop-Process` ไม่ได้ (ถูก auto-mode block) — **ผู้ใช้ต้อง restart เอง** ด้วย `Fullscale_V2\DEPLOY_LabVenture\start.bat` (kill port 8889 แล้วเปิดใหม่) แล้ว Ctrl+F5 หน้า DAILY
Session ถัดไป: ถามผู้ใช้ว่า restart แล้วรายชื่อขึ้นหรือยัง แล้วช่วยตรวจ save จริง (ดู `summary_table.PreparedBy`)

## รายละเอียดการเปลี่ยนแปลง

### 1. Backwash START/END TIME = 0 (00:00)
- `parseBWPhase` ใน `client/src/pages/OpRecord.jsx` (~บรรทัด 1720) — เดิม `hasValue` นับ 0 = ไม่มีข้อมูล → การ์ดแดง
- กฎใหม่: START/END = 0 นับว่าเป็น 00:00 **ถ้าอีกช่องไม่ใช่ 0**; ทั้งคู่ 0 = ยังแดง (ระยะเวลา 0 นาที = ไม่ได้กรอก). ช่องอื่น (shift, filterRun, level, washQty) 0 = missing เหมือนเดิม
- ฟังก์ชันนี้ใช้ร่วม 3 ที่: การ์ด Filtration หน้า DAILY, `client/src/utils/dailyReportIssues.js`, `client/src/components/PrintReport.jsx`
- Server ไม่มี validation ของ backwash (DR_CONFIGIDS ใน `server/services/dailyReport.js` เป็นแค่ list ID)

### 2. FILTRATION scroll
- แผงขวา DAILY มี `overflow-hidden`; wrapper ของ FILTRATION เปลี่ยนเป็น `flex-1 min-h-0 overflow-y-scroll pr-1` และกล่องแต่ละเฟสใส่ `shrink-0`
- กล่องการ์ด >6 ใบยังเป็น grid 6 คอลัมน์ maxHeight 260px เลื่อนในตัว
- ผู้ใช้เคยถามว่าแสดงเฉพาะบ่อที่ล้างใช่ไหม → ใช่ การ์ด = 1 รอบล้าง (บ่อละได้ถึง 3 ใบ: 08/16/24) — เสนอทางเลือก "ตารางบ่อ 8/14 ช่อง" ไว้ ผู้ใช้เลือกแค่ scroll

### 3–4. DAILY toolbar + SAVE DB popup
- `DailyReportTab`: ลบ state `shift`, `validation`, `handleValidate`, ปุ่ม VALIDATE, กล่อง ERROR/WARNING, dropdown Shift. (`POST /api/daily-report/validate` ฝั่ง server ยังอยู่ ไม่ได้ลบ)
- Component ใหม่ `SaveConfirmModal` (อยู่เหนือ `DailyReportTab`): dropdown ผลัด 1–4 (แสดงจำนวนคน) → dropdown ผู้จัดทำกรองตามผลัด; แถบเหลือง ⚠ เมื่อ `selectedDate` ไม่ใช่วันนี้ (แทน `window.confirm` ของ `confirmNonToday` — ผู้ใช้บอกว่า popup browser ไม่สวย); ESC/คลิกนอกปิดได้
- `refDate.js` เพิ่ม export `isToday`, `fmtThaiDate`, `todayThai` (`confirmNonToday` ยังใช้ที่ OpRecord ส่วน operator ~บรรทัด 3200)
- Server `server/routes/dailyReport.js`:
  - `GET /preparers` → `car_whitelist` where `group_code='2' AND shift IS NOT NULL` order by shift,name (ไม่ต้อง admin; `/api/car-admin/whitelist` เป็น admin-only)
  - `POST /save` ต้องมี `shift` 1–4 และ `prepared_by` (400 ถ้าไม่มี); หลัง insert เรียก `ensurePreparedByColumn(db)` (ALTER TABLE เพิ่ม `PreparedBy TEXT` ถ้ายังไม่มี — เช็กทุกครั้งเพราะ DB ถูก swap ได้) แล้ว UPDATE PreparedBy
  - ไม่ได้แก้ `/saved` ให้คืน PreparedBy (ทำได้ถ้าต้องการ)

### 5. Bug SAVE: "fetchAllStationsHistory is not defined" (แก้แล้ว, deploy แล้ว, รอ restart)
- เดิม route import ไม่ครบ → `/save`, `GET /`, `/validate` พังเมื่อ stage=1 + มี token
- เพิ่ม import แล้ว และเปลี่ยน `/save` ให้คำนวณจาก `historyCache[date]` (ข้อมูลที่ QUERY DATA / FROM DB ดึงไว้ = ตรงกับที่เห็นบนจอ); ถ้า cache ว่าง + stage 1 → `fetchRestHistory` แบบเดียวกับ `/fetch-all`; ไม่งั้น null (SQLite)
- cache อยู่ใน memory → หลัง restart server ต้องกด QUERY DATA ใหม่ก่อน save ถึงจะได้ค่าตรงจอ (ไม่งั้น fallback ข้างบน)
- Backup: `_backup\LabVenture_before_savefix_3010\server\routes\dailyReport.js`

## Deploy convention (Fullscale_V2)
- ปลายทาง: `C:\Users\peera\OneDrive\Desktop\Fullscale_V2\DEPLOY_LabVenture\` (client\dist, server\...) — ไฟล์ server ฝั่ง deploy เป็น CRLF
- ก่อนทับ: backup ไป `Fullscale_V2\_backup\LabVenture_before_<tag>_DDMM\` (โครงสร้างเดียวกัน)
- client: `npx vite build` ใน `client/` แล้ว `robocopy client\dist <deploy>\client\dist /MIR` (exit 1–3 = สำเร็จ)
- ก่อนทับไฟล์ server: `diff --strip-trailing-cr` deployed vs local ให้แน่ใจว่าต่างแค่สิ่งที่ตั้งใจ
- เปลี่ยน client อย่างเดียวไม่ต้อง restart; เปลี่ยน server ต้อง restart LabVenture (ผู้ใช้ทำเอง)
- Backup session นี้: `LabVenture_before_bw0000_3010`, `LabVenture_before_bwscroll_3010`, `LabVenture_before_savepopup_3010` (มี server\routes\dailyReport.js)
- หน้าเว็บ: `http://localhost:443/labventure/op-record?station=DAILY` (ผ่าน BellBeast) — browser pane ของ agent ติดหน้า login, agent ใส่รหัสไม่ได้

## Suggested skills
- `run` — ถ้าต้องรัน dev server/ดูหน้า DAILY (ต้องให้ผู้ใช้ login ใน browser pane ก่อน)
- `code-review` — ตรวจ diff ของ 3 ไฟล์ข้างบนก่อน commit
- `handoff:handoff` — เมื่อจบ session ถัดไป

## หมายเหตุ
- ตอบผู้ใช้เป็นภาษาไทย
- ห้าม commit/push จนกว่าผู้ใช้สั่ง

---

# Session 2 (30/10/2569 เย็น) — PRINT EXCEL รายงานการผลิตน้ำ + ผู้ทบทวน + ย้าย templates

ทุกอย่าง **ยังไม่ commit** · deploy ไป Fullscale_V2 แล้วทั้งหมด · **ยังไม่ได้ทดสอบบนหน้าจริง** (ผู้ใช้บอก "ค่อยเทสจริง พักไว้ก่อน")

## สถานะ

| # | งาน | โค้ด | Deploy | ทดสอบ |
|---|-----|------|--------|-------|
| 1 | popup SAVE DB: `[ผลัด][ผู้จัดทำ]` / `[ผลัด][ผู้ทบทวน]` (บังคับทั้งคู่) | ✅ | ✅ | ❌ หน้าจริง |
| 2 | ปุ่ม PRINT EXCEL ข้าง SAVE DB → ไฟล์ตามฟอร์ม `MH_report_theme.xlsx` | ✅ | ✅ | ✅ offline (เปิดใน Excel COM ได้, ไม่ต้อง repair) / ❌ หน้าจริง |
| 3 | PRINT EXCEL เปิด popup ปฏิทินก่อน (default = วันที่มุมขวาของหน้า DAILY) | ✅ | ✅ | ❌ |
| 4 | export ห้ามเรียก AquaDAT (เคย timeout `ETIMEDOUT ...:12007`) | ✅ | ✅ | ❌ |
| 5 | ย้ายฟอร์มเปล่า `server/data` → `server/templates` | ✅ | ✅ | ✅ path resolve ในโฟลเดอร์ deploy |

**ต้อง restart LabVenture server บน Fullscale** (`Fullscale_V2\DEPLOY_LabVenture\start.bat`) — server ที่รันอยู่ยังเป็นโค้ดเก่า; จนกว่าจะ restart การพิมพ์สาหร่ายจะหา `data/Algae_theme.xlsx` ไม่เจอ (ย้ายไปแล้ว) ส่วนบันทึก DailyLab (python) ใช้ path ใหม่ทันที

## ⚠ ค้าง: DB ของ Fullscale ถูกวางทับ → แถววันที่ 29 หาย
- ผู้ใช้จำว่า save วันที่ 28 แต่ใน `DEPLOY_LabVenture\server\labventure.db` (17:18) มีแค่ `summary_table`/`detail_table` DateKey **2026-10-29**, Shift 4, GeneratedAt `2026-10-30T06:04`, PreparedBy มีค่า — ไม่มีวันที่ 28 เลย. สาเหตุน่าจะเป็น bug `/save` ก่อน restart (ดู Session 1 ข้อ 5) หรือหน้าเลือกวันที่ 29 ไว้
- ผู้ใช้เอา DB เวลา 30/10 01:12 (summary_table ว่าง) มาวางที่ `LabVenture\server\labventure.db` **และ** DB ฝั่ง deploy ก็ถูกแทนตอน 17:45 (ไม่ใช่ agent ทำ; start script ไม่ได้ copy DB) → แถววันที่ 29 หายจาก DB ที่ใช้งาน
- สำเนาที่ยังมีแถว 29 (copy จาก deploy เวลา 17:18): `Fullscale_V2\_backup\labventure_db_with_2910_save\labventure.db` — ใช้เป็นต้นทางตอนกู้ (insert เฉพาะแถว `summary_table`/`detail_table` DateKey 2026-10-29) **อย่าเอาไฟล์นี้ทับ DB ทั้งก้อน** เพราะจะทับข้อมูลที่ใหม่กว่า
- agent เสนอ insert เฉพาะแถว 29 กลับ (หยุด server + backup ก่อน) — **ผู้ใช้ยังไม่ตอบ / สั่งพัก** อย่าทำเองโดยไม่ถาม
- วันที่ 28 ต้องทำใหม่: เลือกวันที่ 28 → QUERY DATA → SAVE DB

## รายละเอียด

### Server
- ใหม่ `server/services/mhReport.js`
  - `buildMhCells(report, historyMap)` → `{cellAddr: number|null}` ของฟอร์ม (mapping ทั้งหมดอยู่ในไฟล์; น้ำล้าง/ชม.กรองต่อเฟส port จาก `parseBWPhase` ฝั่ง client — ชม.กรอง = เฉลี่ย filterRun ของรอบล้าง, บ่อใช้งาน % = (cap−REPAIR)/cap, Polymer เว้นว่าง, Cl รับเข้า = `cl_income` หน่วยท่อ)
  - `overlayDbCells(cells, summaryRow, detailRow)` ใช้กับวันที่ save ก่อนมี snapshot (cost บาท/วัน ÷ DPS_TotalF → บาท/ลบ.ม., Cl_income kg ÷1000)
  - `writeMhReport()` แก้ sheet XML ด้วย jszip (ไม่ผ่าน exceljs) เก็บ style/merge/print setting; แทนสูตร #REF! ด้วยค่า, ลบ externalLink + calcChain, `fullCalcOnLoad=1`, `createFolders:false`
- `server/routes/dailyReport.js`
  - `ensurePreparedByColumn` → `ensureExtraColumns` (PreparedBy, ReviewedBy, MhCells)
  - helper `historyForDate(date, req)` (ใช้ใน `/save` เท่านั้น)
  - `/save` ต้องมี `reviewed_by`; เก็บ `MhCells` = JSON snapshot ของฟอร์ม ณ ตอน save
  - ใหม่ `GET /saved-dates?from=&to=` (วันที่ save แล้ว + ผู้จัดทำ/ทบทวน, แถวล่าสุดต่อวัน)
  - ใหม่ `GET /export-mh.xlsx?date=` — ใช้ save ล่าสุดของวัน; มี MhCells → ใช้เลย; ไม่มี → คำนวณจาก `historyCache[date]` (ถ้ามี) หรือ SQLite + overlay DB; **ไม่เรียก AquaDAT**; ตำแหน่งจาก `car_whitelist.position_label`; 404 ถ้ายังไม่ save
- path template ใหม่: `excel_writer.py`, `algae_exporter.py`, `routes/algae.js`, `services/mhReport.js`, `make_theme.py` (root) → `server/templates/`; กฎเขียนไว้ใน `CLAUDE.md` แล้ว

### Client (`client/src/pages/OpRecord.jsx`)
- `SaveConfirmModal`: helper `personRow()` สร้างแถว ผลัด+ชื่อ ×2, กว้าง 460px, `onConfirm(shift, preparer, reviewer)`
- `PrintExcelModal` (ใหม่, เหนือ `DailyReportTab`): ปฏิทินจันทร์-อาทิตย์, วันที่ save แล้วสี teal, กรอบ = วันที่ของหน้า, แถบสรุปผลัด/ผู้จัดทำ/ผู้ทบทวน, ปุ่มยืนยันกดได้เฉพาะวันที่ save แล้ว → `window.location.href = BASE + /api/daily-report/export-mh.xlsx?date=`
- ปุ่ม PRINT EXCEL (teal) อยู่ถัดจาก SAVE DB

### ฟอร์ม Excel
- `server/templates/MH_report_theme.xlsx` (ฟอร์ม) / `MH_report_example.xlsx` (ตัวอย่างกรอกวันที่ 27/10)
- ฟอร์มพิมพ์ออกมา 2 หน้า (zoom 83, ขอบขวาล้น) และชื่อผู้ลงนามแถว 64-65 สูง 12pt ดูโดนตัด — **ไฟล์ตัวอย่างของผู้ใช้ก็เป็นแบบนี้** (มาจาก page setup ของฟอร์ม) ยังไม่ได้แก้

## Backup (Fullscale_V2\_backup\)
- `LabVenture_before_mhprint_3010` — dailyReport.js + client/dist ก่อน PRINT EXCEL
- `LabVenture_before_mhcal_3010` — ก่อน popup ปฏิทิน (+ `dailyReport.after_cal.js` ก่อนแก้ no-AquaDAT)
- `LabVenture_before_templates_3010` — โค้ด 5 ไฟล์ + `data/*_theme.xlsx` ก่อนย้าย templates

## ขั้นต่อไปที่แนะนำ
1. ถามผู้ใช้ว่า restart server แล้วหรือยัง → ทดสอบ: popup SAVE DB (ผู้ทบทวน), PRINT EXCEL + ปฏิทิน, พิมพ์สาหร่าย, บันทึก DailyLab
2. ถามเรื่องกู้แถววันที่ 29 (ดูหัวข้อ ⚠ ข้างบน)
3. ถ้าผู้ใช้ต้องการ: ผู้ทบทวนไม่บังคับ / ปรับ page setup ฟอร์มให้พอดี 1 หน้า
4. commit เมื่อผู้ใช้สั่งเท่านั้น (diff ของ session นี้: ไฟล์ข้างบน + `CLAUDE.md` + handoff)

## Suggested skills (session ถัดไป)
- `run` — เปิดหน้า DAILY ทดสอบ (browser pane ติด login ต้องให้ผู้ใช้ login เอง)
- `anthropic-skills:xlsx` — ถ้าต้องแก้/ตรวจฟอร์ม Excel (page setup, cell mapping)
- `code-review` — ตรวจ diff `OpRecord.jsx`, `dailyReport.js`, `mhReport.js` ก่อน commit
- `handoff:handoff` — ปิด session (เขียนต่อในไฟล์ handoff ของโปรเจกต์ ไม่ใช่ temp)

## Clear labventure.db (30/10 17:59, ผู้ใช้สั่ง)
- ล้างข้อมูลที่บันทึกใน **ทั้งสองไฟล์** (`LabVenture\server\labventure.db` และ `Fullscale_V2\DEPLOY_LabVenture\server\labventure.db`), เก็บ config ไว้
  - ล้าง: node_records, car_log, car_steps, algae_records, chem_history, slot_recorders, aquadat_queue, excel_queue, aquadat_snapshots, summary_table, detail_table, event_occurrences, scenario_log, pm_occurrences, pm_audit, pm_attachments (+ reset sqlite_sequence, VACUUM)
  - เก็บ: scenarios (active = น้ำด้อยคุณภาพระดับเฝ้าระวัง), car_whitelist(+_old), algae_species, event_classes, pm_plans, pm_tasks, op_widget_placements, param_meta
- Backup ก่อนล้าง: `Fullscale_V2\_backup\labventure_db_before_clear_3010\{dev,fullscale}\labventure.db`
- ไฟล์ Excel ใน `server\data` และ `data\pm_files` ไม่ได้แตะ
- เรื่องกู้แถววันที่ 29 ข้างบน: DB ตอนนี้ว่างแล้ว ถ้ายังต้องการ ใช้ `labventure_db_with_2910_save` เป็นต้นทาง insert แถวเดียว
