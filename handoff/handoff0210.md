# Handoff 02/10/2026: Record page, Excel write, Print-out, Control Value, Algae theme

> ผู้ใช้ต้องการให้ตอบเป็น**ภาษาไทย** (มีบันทึกใน memory แล้ว)
> โค้ดทั้งหมดในเอกสารนี้**ยังไม่ commit** แต่**publish ไป `Fullscale_V2/DEPLOY_LabVenture` แล้ว** (02/10/2026, ดู §1.2)

## 0. สภาพแวดล้อมที่ต้องรู้
- `http://localhost:443/labventure/*` คือ BellBeast proxy ไปที่ node `:3001`
  - node ตัวนั้นรันจาก**โฟลเดอร์ deploy** ไม่ใช่ repo นี้ น่าจะเป็น `Desktop\Fullscale_V2\DEPLOY_LabVenture` หรือ `Desktop\DEPLOY_LabVenture`
  - การแก้ใน repo จึง**ไม่มีผล**กับ :443 จนกว่าจะ copy ไฟล์ไปแล้ว restart
  - **ผู้ใช้ยืนยัน:** โฟลเดอร์ deploy = `C:/Users/peera/OneDrive/Desktop/Fullscale_V2/DEPLOY_LabVenture`
- เครื่อง deploy (รัน LabVenture) กับเครื่อง Excel เป็นคนละเครื่อง เขียน Excel ผ่าน xlwings ไปที่ `excel_data_dir`
  - สมมติฐานว่าเป็น network share (SMB) **ยังไม่ได้ยืนยันกับผู้ใช้**
  - ถ้าเป็น OneDrive sync การเช็กว่าไฟล์ถูกเปิดค้างจะใช้ไม่ได้
- env override สำหรับทดสอบ (ไม่ตั้ง = ทำงานเหมือนเดิม): `LV_DB_PATH` (db.js), `LV_EXCEL_DIR`, `LV_LOCAL_DATA` (excel_writer.py)

## 1. สิ่งที่ทำใน session นี้ (ดูรายละเอียดจาก `git diff`)
| เรื่อง | ไฟล์หลัก |
|---|---|
| RW Turb/Alk/Temp → `2h`, cell map เพิ่มแถว 03/07/… | `server/config/nodes.json`, `params.json`, `excel_cell_map.json` |
| OC: RW/TW = `12h` (09:00 + 21:00); CW/FW = `daily` + `fixedTime: "09:00"` + **`inSlot: true`** → อยู่ในปุ่ม 09:00 อย่างเดียว | `nodes.json`, `Record.jsx` (`slotMatchesParam`), `routes/progress.js`, `routes/aquadatProcess.js` |
| Excel ไม่ตอบว่าสำเร็จเมื่อเขียนไม่ได้: เช็กไฟล์ถูกเปิด (r+b), ไม่ลบ `~$` ของเครื่องอื่น, push fail = error, ตั้งเซลล์ข้อความเป็น Text (`@`), stderr เป็น UTF-8 | `server/excel_writer.py`, `services/excelWriter.js` |
| Retry อัตโนมัติทุก 5 นาที (Excel + AquaDAT ใช้ token จริงล่าสุด) โดยส่ง**ค่าล่าสุดใน node_records** | ใหม่: `server/services/queueWorker.js`; `routes/write.js` (`/queue/retry`, `/queue/retry-excel`, `/queue` มี `excel_count`), `routes/auth.js`, `index.js`, `routes/test.js` |
| Popup "บันทึก Excel ไม่สำเร็จ" + ปุ่ม Retry/ปิด, ลิงก์ CAR ใช้ `<Link>`, `data-param` บน input | `client/src/pages/Record.jsx` |
| Print-out: แถบ "พิมพ์รายงาน" [DailyLab \| สาหร่าย], สาหร่าย 1 ชีทต่อวันที่เก็บตัวอย่าง, เอาปุ่ม Export สาหร่ายเดิมออก (template สาหร่ายเปลี่ยนใน session 2 ดู §1.1) | `Record.jsx` (`ExportBar`), `routes/algae.js` (`export-info`, `export.xlsx`), `algae_exporter.py` |
| Langelier TW1/TW2 คำนวณอัตโนมัติ (สูตรเดียวกับ master J62) และเป็นช่องอ่านอย่างเดียว | `Record.jsx` (`calcLangelier`) |
| Control Value ในฟอร์มอ่านจากสถานการณ์ที่ active (19 เซลล์, TW1-4 ใช้ค่าชุดเดียวกัน); เพิ่ม CW1-4 ResCl2 ≤ 0.3 ใน normal | ใหม่: `server/services/scenario.js`, `server/config/excel_control_cells.json`; `scenarios/scenario_normal.json`, `routes/scenarios.js` |
| E2E | ใหม่: `server/scripts/e2e_excel_test.js` (ผ่าน 20/20; รัน `E2E_PORT=3997 node scripts/e2e_excel_test.js` ใน `server/`) |
| ผล e2e แบบกรอกผ่าน UI จาก May ชีท 27 | `handoff/e2e_may27/printout_2026-05-27.xlsx`, `compare_sheet27.txt` (ทำก่อนมี Control Value/Langelier) |

`client/dist` build ล่าสุดแล้ว (session 2 ไม่ได้แก้ client)

## 1.1 Session 2 (02/10/2026): E2E สาหร่าย ชีท "18 มิ.ย." + เปลี่ยนไปใช้ Algae_theme.xlsx — ผู้ใช้ยืนยันว่า "นี่เลย ที่เราต้องการ"
- **E2E ผ่าน UI:** กรอกค่าจาก `Algae2569.xlsx` ชีท "18 มิ.ย." (คุณภาพน้ำ 09:00 RW/TW1/TW2 12 ค่า + สาหร่าย RW 12 ชนิด, TW1 Nitzschia 80, TW2 Navicula 80) → พิมพ์รายงาน > สาหร่าย → cross-check ด้วย `handoff/e2e_jun18/compare.py`
  - ผลล่าสุด: ตรง 147 / ต่าง 1 (แค่ช่องว่างคู่ใน F3 ของต้นฉบับ) — `handoff/e2e_jun18/compare_jun18_v2.txt`, `printout_algae_2026-06-18_v2.{xlsx,pdf}`; เทียบภาพกับ `source_18jun.pdf`
  - ไฟล์ไม่มี `_v2` = ผลรอบแรก (ยังใช้ algae_master เก่า: โลโก้หาย, µ→m, ป้าย Division หาย)
- **Template ใหม่ (ผู้ใช้ทำเอง):** `server/data/Algae_theme.xlsx` ชีทเดียว "ต้นฉบับ", layout เดียวกับชีทในไฟล์จริง: คุณภาพน้ำแถว 9-11 (RW/TW1/TW2 เท่านั้น), ตารางชนิดแถว 15-89 (D-J = RW,TW1,TW2,CW1-4), สรุปแถว 90-95, ผู้ลงนาม C103/C104 (มีชื่อ default ใน theme)
  - อยู่ใน `server/data/` ซึ่ง **gitignore** → ต้อง copy ไปเครื่อง deploy เอง
- **`server/algae_exporter.py` เขียนใหม่:** แก้ XML ใน zip โดยตรงด้วย `xml.etree` (stdlib เพราะเครื่อง deploy ไม่มี lxml) ไม่ save ผ่าน openpyxl → เก็บโลโก้ EMF, rich text (`Cond(µS/cm)` = ตัว m ฟอนต์ Symbol, ตัวหนาบางคำ), style ครบ
  - copy sheet/drawing/printerSettings ต่อวัน, ลบ calcChain + cache ของสูตร, `fullCalcOnLoad=1`, `_xlnm._FilterDatabase` ต่อชีท, อัปเดต app.xml
  - **AutoFilter `A13:K89` คอลัมน์ D (RW) ≠ blank** ตามที่ผู้ใช้สั่ง → ซ่อนแถวชนิดที่ D ว่าง (ไฟล์เก็บผลกรองเป็น hidden rows)
  - ย้ายป้าย Division (+บรรทัดรอง เช่น "(Diatoms)") ไปแถวแรกที่แสดงของกลุ่ม (ทำเพิ่มเอง ผู้ใช้รับแล้ว)
  - ซ่อนแถวคุณภาพน้ำของสถานีที่ไม่มีข้อมูลสาหร่าย + เรียงเลข "1) RW" ใหม่; signer ทับ C103/C104 เมื่อหาชื่อได้ ไม่งั้นคงค่าใน theme
  - ตรวจด้วย Excel COM แล้ว: เปิดไม่ขึ้น repair, มีโลโก้, filter On, สูตรคำนวณ (Excel รายงาน filter range เป็น A13:K95 ทั้งที่ไฟล์เขียน A13:K89 — ไม่มีผลเพราะแถวสรุปไม่ว่าง)
- `server/routes/algae.js`: `MASTER` → `data/Algae_theme.xlsx`, อ่านชนิดจาก worksheets[0] แถว 15-89
- `server/scripts/e2e_excel_test.js` ข้อ 3b-3g ปรับตาม layout ใหม่ + ตรวจ filter/โลโก้/rich text → **20/20 ผ่าน** (ตอนยังใช้ lxml)
- เปลี่ยน lxml → `xml.etree` ทีหลัง: ElementTree ทิ้ง xmlns ที่อ้างแค่ใน `mc:Ignorable` จึงให้ `_xml()` คืน root tag เดิมของแต่ละ part และใช้ `register_namespace('', default)` แทน `default_namespace=` (ใช้กับ attribute ที่ไม่มี prefix ไม่ได้)
  - ตรวจด้วย Excel COM แล้ว (2 ชีท: เปิดไม่ขึ้น repair, มีโลโก้, filter D On, D95 คำนวณ, C103 signer) และรัน e2e ซ้ำแล้ว **20/20 ผ่าน**

## 1.2 Publish (02/10/2026)
- copy ไป `C:/Users/peera/OneDrive/Desktop/Fullscale_V2/DEPLOY_LabVenture`: `client/dist` ทั้งโฟลเดอร์ + server 21 ไฟล์ (ทุกไฟล์ใน §1 และ §1.1 รวม `server/data/Algae_theme.xlsx`) ตรวจด้วย `cmp` แล้วตรงกับ repo ทุกไฟล์
- ไม่ copy: `labventure.db`, `.env`, `node_modules`, `package-lock.json`, Excel ข้อมูลอื่นใน `server/data`, สคริปต์ทดสอบ, `templates/algae_master.xlsx`
- backup ไฟล์เดิมที่ถูกทับ: `C:/Users/peera/OneDrive/Desktop/Fullscale_V2_backups/DEPLOY_LabVenture_20261002/` (server + `client_dist`)
- ตอน publish LabVenture ไม่ได้รัน (ไม่มี listener :3001) จึงไม่ได้ restart; เริ่มด้วย `Fullscale_V2/START_FULLSCALE_LOCALHOST` แล้วจะใช้โค้ดใหม่
- เครื่อง deploy ติดตั้ง Python package แบบ offline จาก `DEPLOY_LabVenture/setup/py_wheels` (cp313: openpyxl, xlwings, pywin32, et_xmlfile) → **ห้ามเพิ่ม dependency Python ใหม่** ถ้าไม่เพิ่ม wheel ไปด้วย

## 2. ข้อตกลงกับผู้ใช้ (สำคัญ: ห้ามทำเกิน)
- **ห้ามเพิ่มความถี่หรือรอบเวลาใหม่** (ผู้ใช้ย้ำหลายครั้ง) ถ้าต้องการพฤติกรรมพิเศษ ให้ใช้ field ใน nodes.json แบบ opt-in เช่น `inSlot`
- Jar Test มี `fixedTime: "05:00"` แต่ต้องอยู่**แท็บรายวัน** (เคยเกิด regression ตอนใช้ `fixedTime` อย่างเดียว)
- Alum RW ref **ไม่ต้องเพิ่มช่องกรอก** (master form มีสูตร)
- เงื่อนไขออก CAR เมื่อค่าเกินเกณฑ์ และเกณฑ์ของสถานการณ์อื่น ผู้ใช้จะกำหนดภายหลัง
- ชื่อผู้วิเคราะห์ในรายงานสาหร่าย = คนที่กดพิมพ์; ชนิดสาหร่ายที่ไม่มีใน theme → แจ้งเตือน
- รายงานสาหร่ายใช้ `server/data/Algae_theme.xlsx` ที่ผู้ใช้ทำเอง — **ห้ามแก้โครงสร้าง theme**, filter `A13:K89` คอลัมน์ D ไม่ว่าง

## 3. งานค้าง / ข้อเสนอที่ยังไม่ได้ทำ
1. ~~Deploy~~ publish แล้ว (§1.2)
2. **UI 3 จุด** (รอผู้ใช้ตัดสิน):
   - ข้อความ "✅ บันทึกสำเร็จ — รอบ X" ค้างหลังสลับรอบ และใช้ชื่อรอบใหม่
   - ข้อความเตือน Excel ใต้ปุ่มบันทึกค้างหลัง Retry สำเร็จ
   - ปุ่มแสดง "รอบ daily"
3. RW pH ฟอร์มจดราย 4 ชั่วโมง แต่ระบบตั้งเป็น `12h` (ผู้ใช้ยังไม่ตอบ)
4. `DailyLab_theme.xlsx` ไม่มีแถว Max/Min/Avg, สูตร Langelier/วันที่ และค่าคงที่บางช่อง เสนอให้ทำ theme ใหม่จากชีทเปล่าของฟอร์มจริง (ยังไม่ตอบ)
5. Control Value ใช้สถานการณ์ปัจจุบัน ไม่ใช่สถานการณ์ของวันที่ข้อมูล (ยังไม่มีประวัติการสลับสถานการณ์)
6. ป้ายในฟอร์ม D74/N74/W74 เขียนว่า `ResCl2 = 0.7 - 1.2` ไม่ตรงกับค่า 1.00–1.40
7. CLAUDE.md บอกว่า "queues retry automatically" ตอนนี้จริงแล้ว (queueWorker) แต่ยังไม่ได้อัปเดตเนื้อหาส่วนอื่นของ CLAUDE.md
8. **(session 2) Filter คอลัมน์ D ซ่อนชนิดที่พบแค่ TW/CW** (เช่น CW2-only หรือวันที่มีแต่ TW1 → ไม่เหลือแถวชนิด) — ถามผู้ใช้แล้ว ยังไม่ตอบว่าจะเปลี่ยนเป็น "ไม่ว่างในคอลัมน์ใดก็ได้ D-J" หรือไม่
9. **(session 2)** ค่าคุณภาพน้ำ CW1-4 ไม่ถูกพิมพ์แล้ว เพราะ theme มีแค่ RW/TW1/TW2 (ตรงฟอร์มจริง)
10. **(session 2)** ไฟล์ไม่ได้ใช้แล้ว: `server/templates/algae_master.xlsx`, `server/scripts/build_algae_master.py` — รอผู้ใช้ตอบว่าลบได้ไหม (untracked, ลบแล้วกู้ไม่ได้)
11. **(session 2)** ทดสอบพิมพ์สาหร่ายบนเครื่อง deploy จริง (Python 3.13) — e2e ในเครื่อง dev ผ่าน 20/20 แล้ว

## 4. วิธีทดสอบ UI โดยไม่แตะข้อมูลจริง
1. สร้าง config ชั่วคราวใน `.claude/launch.json`:
   - server port 3999 + env `LV_*` ชี้ temp dir, ตั้ง `AQUADAT_*` เป็น `http://127.0.0.1:9`, `BELLBEAST_STAGE_URL=http://127.0.0.1:3998/api/stage`
   - vite `--port 5175` + `API_TARGET=http://localhost:3999`
2. รัน stub `{"stage":0}` ที่ port 3998 เพื่อให้ session bypass บันทึกได้
3. ตั้ง cookie `aquadat_token=<b64({alg})>.<b64({sub,role:'scientist',bypass:true,exp})>.bypass` แล้วเปิด `/labventure/record?date=…`
4. ลบ config ชั่วคราวออกเมื่อเสร็จ
5. ดาวน์โหลด print-out ด้วย `curl -b "aquadat_token=…" http://localhost:5175/api/algae/export.xlsx?from=…&to=…` (ลิงก์เดียวกับปุ่มในหน้าเว็บ) แล้วแปลง PDF ด้วย `server/scripts/xlsx2pdf.ps1` เพื่อดูภาพ
6. กรอกสาหร่ายใน UI: React render แถวใหม่ไม่ทันทันที → รอให้แถวชนิดปรากฏก่อนพิมพ์จำนวน (ไม่งั้นตัวเลขไปลงช่องค้นหา)

## 5. Suggested skills
- `handoff:handoff`: ใช้เขียน handoff ตอนจบ session ถัดไป
- `code-review` / `scrutinize`: ทบทวน diff ใหญ่ก่อน commit/deploy
- `anthropic-skills:xlsx`: เมื่อต้องแก้ theme / master form Excel (ระวัง: openpyxl save ทำโลโก้ EMF + rich text หาย — algae ใช้วิธีแก้ XML ด้วย stdlib ใน `algae_exporter.py`)
- `run`: เปิดแอปเพื่อตรวจการเปลี่ยนแปลงในเบราว์เซอร์
