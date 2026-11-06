# Handoff 28/09/2569 — สคบ-14 memo จากแบบฟอร์มต้นฉบับ (Word + PDF)

## เป้าหมายของงานนี้
ผู้ใช้ไม่ยอมรับหน้า print แบบ HTML ที่ทำเลียนแบบเอง (`MemoPrint.jsx`) — **ต้องใช้แบบฟอร์มต้นฉบับ `F-MS-HACCP-สคบ-14 Rev02.doc` เท่านั้น** เพราะระยะ/การตั้งค่าหน้ากระดาษถูกกำหนดไว้แล้ว
ต้องการ 2 ปุ่มแทน "พิมพ์": **Word** และ **PDF**

## สถานะ: โค้ดเสร็จ, ยังไม่ได้ทดสอบผ่าน UI จริง
- ทดสอบตัว fill + แปลง PDF ตรงผ่าน node แล้ว (3 แถว และ 7 แถว) → ผลตรงกับแบบฟอร์มต้นฉบับ
- ทดสอบ route ด้วยการ load router ตรง → `GET /memos/:id/:fmt(docx|pdf)` match ถูกต้อง
- **ค้างอยู่:** ผู้ใช้กดแล้วได้ `{"error":"No chemlab route: GET /memos/3/docx"}` เพราะ server (PID 8992 บน :3001, start 13:37 ก่อนแก้โค้ด, ไม่ได้รันแบบ `--watch`) ยังเป็นโค้ดเก่า → **ต้อง restart server** (`cd server && npm run dev`) แล้วทดสอบปุ่ม Word/PDF ที่ `/chem-intake` → ตาราง "บันทึกข้อความที่ออกแล้ว" (memo id 3 มีอยู่แล้ว)
  - ยังไม่ได้ kill process เองเพราะ command line ของ 8992 ถูกซ่อน (อาจรันแบบ admin) — ให้ถามผู้ใช้ก่อน
  - เรียก API ผ่าน browser pane ได้ 401 (ยังไม่ login) — ไม่ได้ login ให้

## ไฟล์ที่เกี่ยวข้อง (ดู diff ใน git working tree)
- `server/templates/F-MS-HACCP-สคบ-14 Rev02.doc` — ต้นฉบับ (copy จาก Downloads)
- `server/templates/F-MS-HACCP-สคบ-14 Rev02.docx` — ต้นฉบับที่ Word SaveAs เป็น docx (layout ไม่เปลี่ยน) ← ตัวที่ใช้ fill จริง
- `server/services/memoDocx.js` — `buildDocx(memo, rows, spec)` + `toPdf(buf)` (คิวทีละงาน)
- `server/scripts/docx2pdf.ps1` — Word COM `ExportAsFixedFormat` (17 = PDF)
- `server/routes/chemLab.js` — route `GET /memos/:id/:fmt(docx|pdf)` วางก่อน catch-all `router.all('*')`
- `server/package.json` — เพิ่ม `jszip` (มีใน node_modules อยู่แล้วผ่าน exceljs)
- `client/src/pages/chemlab/MemoTab.jsx` — ปุ่ม Word (download) / PDF (tab ใหม่), ปุ่มบันทึก → "บันทึกและเปิด PDF"
- `client/src/App.jsx` — ลบ route `/chem-intake/memo/:id/print`; **ลบไฟล์ `MemoPrint.jsx` แล้ว**
- `handoff/chem_lab_backend_spec.md` — อัปเดตบรรทัดรายการไฟล์ + endpoint ใหม่
- client build ใหม่แล้ว (`client/dist`)

## หลักการ fill (สำคัญ — อย่าเปลี่ยนแนวทาง)
- ห้ามสร้าง layout เอง/ห้ามแก้ formatting — ใส่ text ลงใน paragraph เดิมเท่านั้น โดยอ้าง `w14:paraId` ของ template (map `P` ใน memoDocx.js)
- dotted leader runs (`....`/`…`) ถูกแทนด้วยค่าตามลำดับ (`fillDots`); ค่าว่าง = คงจุดไว้
- ตารางผล: หาจาก cell "ตัวอย่างวันที่" → แถว 0 header, 1–5 แถวว่าง, 6 "มาตรฐานที่กำหนด"; เกิน 5 แถว → clone แถวว่าง (ตัด paraId ทิ้งกันซ้ำ)
- ถ้าแก้ template (.docx) ใหม่ paraId อาจเปลี่ยน → ต้อง dump paragraph ใหม่แล้วอัปเดต map `P`

## คำถามที่รอผู้ใช้ยืนยัน
1. ช่องจุดหลังชื่อสาร ในย่อหน้า "ผลการวิเคราะห์คุณภาพสารพอลิอะลูมิเนียมคลอไรด์ ......" — ตอนนี้ใส่**ชื่อบริษัท** (เดาเอา) ถูกไหม
2. **Alum** ยังไม่มีแบบฟอร์มต้นฉบับ → endpoint ตอบ 400 — ถ้าผู้ใช้ส่งไฟล์มา: SaveAs docx ด้วย Word, หา paraId, เพิ่มใน `TEMPLATES` + map แยกต่อสาร (ตอนนี้ map `P` เป็นของ PACL อย่างเดียว)
3. ช่องลายเซ็น (ผู้วิเคราะห์ / นักวิทยาศาสตร์ / หัวหน้าส่วน) ปล่อยจุดไว้เซ็นมือ
4. PDF ต้องมี MS Word บนเครื่อง server (เครื่องนี้มี Word 16) — ถ้ารันเป็น Windows Service อาจใช้ Word COM ไม่ได้

## Suggested skills
- `run` — restart/เปิด server + client แล้วทดสอบปุ่ม Word/PDF จริง
- `anthropic-skills:docx` — ถ้าต้องแก้/ตรวจ template docx หรือเพิ่มแบบฟอร์ม Alum
- `anthropic-skills:pdf` — ตรวจผล PDF ที่ export ออกมา
- `code-review` — review diff ของงานนี้ก่อน commit (ยังไม่ได้ commit)

---

# Session 2 (28/09/2569 บ่าย) — CAR print: ใบ CAR สบค-08 + ทะเบียน สบค-09 (Excel + PDF)

## เป้าหมาย
พิมพ์ข้อมูล CAR ลงแบบฟอร์มต้นฉบับ Excel (ไม่สร้าง layout เอง — หลักเดียวกับ สคบ-14 ด้านบน) มีปุ่ม Excel/PDF แบบเดียวกับ memo
- `server/templates/F-MS-QSHE-สบค-08 Rev02.xlsx` — ใบ CAR/PAR (ย้ายมาจาก root repo)
- `server/templates/F-MS-QSHE-สบค-09 Rev02.xlsx` — ทะเบียน CAR/PAR log

## สถานะ: โค้ดเสร็จ, E2E ผ่านแล้ว (ยังไม่ commit)
- E2E บน `localhost:443/labventure/car` ด้วย Dev Bypass ทีละ role: ออกใบ → Operator ตอบ → 3A อนุมัติ (ผ่าน UI) → ติดตาม#1 ไม่ผ่าน → ติดตาม#2 ผ่าน → 3B ปิด (ผ่าน PATCH payload เดียวกับ UI เพราะ permission classifier ค้างตอนพิมพ์ใน browser) — LINE ส่งจริงทุกขั้น
- CAR เก่าทั้งหมดถูกลบแล้ว (backup: `server/labventure.db.bak-20260928-precarclear`)
- CAR ทดสอบ **CQ 01/2569** (id 1, ปิดแล้ว) — ผู้ใช้สั่ง **เก็บไว้ ไม่ต้องลบ** (ใบจริงใบแรกจะได้ CQ 02/2569)
- chem-lab compensation cases เดิมที่ผูก `car_key` กับ CAR ที่ถูกลบ → ลิงก์ชี้ไป CAR ที่ไม่มีแล้ว (ผู้ใช้รับทราบ)
- **ต้อง restart server**: ผู้ใช้เปิดผ่าน `LabVenture.exe` เวลา 14:53 ก่อนแก้ `routes/car.js` รอบสุดท้าย → ทะเบียน สบค-09 แบบ wrap ยังไม่ได้ลองผ่านเว็บ (ทดสอบผ่าน node + Excel ตรงแล้ว 12/40 แถว ผ่าน). Agent ถูกปฏิเสธการ kill process ของผู้ใช้ → ให้ผู้ใช้ restart เอง
- client build ใหม่แล้ว (`client/dist`) — ปุ่มบนการ์ดตรวจบนเว็บแล้ว

## ไฟล์ (ดู diff ใน working tree)
- `server/services/carXlsx.js` — `buildCarForm(car)` (สบค-08) / `buildCarLog(cars, systems)` → `{buf, layout}` (สบค-09)
- `server/services/officePdf.js` — คิว COM ร่วม: `toPdf(buf,'docx'|'xlsx')`, `excelLog(buf, fmt, layout)`; `memoDocx.js` ใช้ `toPdf` ตัวนี้แล้ว
- `server/scripts/xlsx2pdf.ps1` (Excel ExportAsFixedFormat), `server/scripts/xlsxlog.ps1` (autofit → page break ตามความสูงจริง → เติมแถวว่างหน้าสุดท้าย → SaveAs xlsx / export pdf)
- `server/routes/car.js` — `roleFilter()` ใช้ร่วม list+log; `GET /api/car/log/:fmt(xlsx|pdf)?fy=<พ.ศ.>&system=`; `GET /api/car/:id/form/:fmt(xlsx|pdf)`
- `client/src/pages/CARLog.jsx` — `FileButtons`, แถบ `LogExport` (ปีงบ × ระบบ) เหนือรายการ, ปุ่มใน header slide panel, ปุ่มมุมขวาแถวเดียวกับ stage dots บน `CarCard` (stopPropagation)

## หลักการ fill (อย่าเปลี่ยน)
- แก้ sheet XML ตรง (JSZip) — ใส่ inline string ใน cell เดิม (คง `s=` style); ไม่ใช้ ExcelJS roundtrip
- dotted leader → `dots()`, space leader → `gaps()`, "label :" → `append()`, checkbox Wingdings o/q/¨ → `þ` (☑) ด้วย `tick()`
- ข้อยกเว้นเล็ก: merge E12:F12 / H12:I12 (แถวผู้เข้าประชุม, border เดียวกัน) + run font ธรรมดา; ≥/≤ แปลงเป็น "ไม่ต่ำกว่า/ไม่เกิน" (ฟอนต์ไทยไม่มี glyph)
- ส่วนที่ 3 ใบ CAR (ลงรับ/ส่ง) และคอลัมน์ "วันที่รับส่วนที่ 3" ในทะเบียน **เว้นว่าง** — ระบบกระดาษ ลงวันรับด้วยมือ (ผู้ใช้ยืนยัน)
- ทะเบียน: wrap text คอลัมน์ C/D/E/K; เลข CAR + วันที่ shrinkToFit บรรทัดเดียว. การตัดบรรทัดไทยต้องให้ Excel ทำ (ประมาณเองไม่ตรง) → xlsx และ pdf ของทะเบียนผ่าน Excel ทั้งคู่ (~3-5 วิ)
- คอลัมน์ F (วันที่เกิดข้อบกพร่อง) ถูกซ่อนในแบบฟอร์ม → ไม่ใส่
- ประเภทปัญหา → ติ๊กช่อง G6–G9 (ผู้ใช้ตรวจแล้วว่าถูก)

## ผู้ใช้ยืนยันแล้ว
- ช่อง "ผอ....." ผู้อนุมัติส่วนที่ 2 = ผอ.กผจ. (ผู้อนุมัติกลุ่ม 3A)
- "วันที่แก้ไขแล้วเสร็จ" ในทะเบียน = กำหนดเสร็จข้อ 2.2 (`correction_deadline`)
- เก็บ CAR ทดสอบ CQ 01/2569 ไว้

## ยังเปิดอยู่
- "การตรวจติดตามภายใน ครั้งที่...." / "อื่นๆ ระบุ...." ยังไม่มี field ในฟอร์มสร้าง CAR (เสนอเพิ่มได้)
- commit งาน session 1 + 2
- สภาพแวดล้อม: auto-mode classifier ค้างเป็นช่วง ๆ → ทำทีละ action ถ้า batch ล้ม; curl จาก Git Bash ส่งภาษาไทยเพี้ยน (ใช้ node fetch แทน)

## Suggested skills (session 2)
- `run` — หลังผู้ใช้ restart: ทดสอบปุ่มทะเบียน สบค-09 (Excel/PDF) ผ่านเว็บ
- `anthropic-skills:xlsx` — ถ้าต้องแก้/ตรวจแบบฟอร์ม Excel
- `anthropic-skills:pdf` — ตรวจ PDF ที่ export
- `code-review` — review diff ทั้งหมดก่อน commit

---

# Session 3 (28/09/2569 เย็น) — ดาวน์โหลด DailyLab (Excel) จากหน้า /record

## เป้าหมาย
หน้า `/record` (Scientist) บันทึกลง AquaDAT + ไฟล์เดือน OneDrive อยู่แล้ว แต่ดาวน์โหลด/พิมพ์จากเว็บไม่ได้ → เพิ่มปุ่มดาวน์โหลด **รายวัน / ทั้งเดือน / ช่วงกำหนดเอง**

## สถานะ: โค้ดเสร็จ, ทดสอบ route ผ่านแล้ว — **ต้อง restart server** (ยังไม่ commit)
- ทดสอบ route ด้วย express + สำเนา DB (stub `services/db.js`): 1 วัน (~0.8 วิ), ทั้งเดือน ก.ย. (~2.3 วิ, ชื่อ `09DailyLab_Sep69.xlsx`), ข้ามเดือน 30 ส.ค.–2 ก.ย. (ชีท `30 ส.ค.` …), >62 วัน → 400, from>to → 400
- UI ขึ้นบน `localhost:443/labventure/record` แล้ว (client build ใหม่) แต่ server ที่รันอยู่เป็นโค้ดเก่า → `GET /api/write/export.xlsx` ได้ 404 จนกว่าจะ restart
- **PDF ตัดทิ้ง (ผู้ใช้ตัดสินใจ)**: Excel COM ช้าเกิน — 1 วัน ~15 วิ, 7 วัน ~60 วิ, ทั้งเดือน >5 นาที (timeout). อย่าเพิ่มกลับโดยไม่ถามผู้ใช้
- มี `EXCEL.EXE` headless ค้างจากการทดสอบ PDF (PID 14860, 18880) — ถามผู้ใช้แล้วว่าจะปิดไหม ยังไม่ได้คำตอบ

## ไฟล์ (ดู diff ใน working tree)
- `server/excel_writer.py` — `_write_day(..., sheet_name=None)`; `build_export(dates, records, recorders, out_path)`; entry `--build <json> <out>` (JSON ผ่านไฟล์ temp — ทั้งเดือนเกิน argv limit Windows). flow เขียนไฟล์เดือนเดิมไม่เปลี่ยน
- `server/services/excelWriter.js` — `buildDailyLab(dates, records, recordersByDate) → Buffer`
- `server/routes/write.js` — `loadRecorders(db, dates)` (ใช้ร่วมกับ POST /nodes แทน loop เดิม); `GET /export.xlsx?from=&to=` (requireAuth, ≤62 วัน)
- `server/services/sendFile.js` (ใหม่) — `sendFile(res, fmt, name, body, ascii)`; `routes/car.js` ใช้ตัวนี้แทน sendFile/XLSX_TYPE เดิม
- `client/src/pages/Record.jsx` — `ExportBar` ใต้ header (โหมด วันที่เลือก/ทั้งเดือน/กำหนดเอง + ปุ่ม Excel, `key={selectedDate}` reset เมื่อเปลี่ยนวัน)
- `server/services/officePdf.js` — แก้แล้ว revert กลับเหมือนเดิม (ไม่มีการเปลี่ยนแปลงสุทธิ)

## หลักการ (อย่าเปลี่ยน)
- สร้างจาก DB ทุกครั้ง (`node_records` + `slot_recorders`) บน `server/data/DailyLab_theme.xlsx` ผ่าน `_write_day` ตัวเดียวกับไฟล์เดือน — ไม่อ่าน/แตะไฟล์เดือนบน OneDrive
- 1 ชีท/วัน, วันไม่มีข้อมูล = ชีทว่างมีหัววันที่; ลบชีท `theme`; `tabSelected` เฉพาะชีทแรก (กัน group)
- ค่า frequency `daily` → ใช้ค่าล่าสุดของวัน (ORDER BY recorded_at) แล้วบังคับ `trans_time='daily'` (เหมือน GET /nodes?slot=daily); param_key ผ่าน `normalizeParamKey`
- print area `A1:AA79` + fit 1×1 ตามฟอร์มต้นฉบับ `05DailyLab_May69.xlsx` (theme ไม่มีเพราะ `strip_defined_names`) → export **ไม่** เรียก `strip_defined_names`
- ชื่อไฟล์: วันเดียว `DailyLab_2569-09-28`, เดือนเต็ม `MMDailyLab_MmmYY`, ช่วง `DailyLab_<from>_<to>` (พ.ศ.)

## ข้อสังเกต
- ไฟล์เดือนจริงบน OneDrive (`07DailyLab_Jul69.xlsx` ชีท 24) ต่างจาก export: มีสูตรที่ผู้ใช้เพิ่มเอง (D1/E1/V1/X1) และบาง cell ไม่ตรง DB → export ยึด DB + theme เป็นหลัก
- PDF หน้าเดียวที่ทดสอบได้ขนาด 680×880pt (ไม่ใช่ A4) — ไม่เกี่ยวแล้วเพราะตัด PDF

## ยังเปิดอยู่
- restart server → กด Excel ทั้ง 3 โหมดบน `/record` จริง
- ตรวจ CARLog ปุ่ม Excel/PDF ยังทำงานหลังย้าย `sendFile`
- commit งาน session 1 + 2 + 3

## Suggested skills (session 3)
- `run` — หลัง restart ทดสอบปุ่มดาวน์โหลดบน /record และ CARLog
- `anthropic-skills:xlsx` — ถ้าต้องตรวจ/แก้ไฟล์ DailyLab ที่ export
- `code-review` — review diff ทั้งหมดก่อน commit
