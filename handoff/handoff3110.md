# Handoff 31/10/2569 — Daily Report: บล็อก SAVE DB, Recycle → % น้ำสูญเสีย, ลายเซ็น Excel, DailyLab+Operation ตามวันที่

ทุกอย่าง **ยังไม่ commit** · **deploy ไป Fullscale_V2 แล้วทั้งหมด** · **ยังไม่ได้ทดสอบบนหน้าจริง** (agent login AD ไม่ได้)
ต่อจาก `handoff/handoff3010.md` (deploy convention อยู่ในไฟล์นั้น — ใช้เหมือนเดิม)

## สถานะ

| # | งาน | โค้ด | Deploy | ทดสอบ |
|---|-----|------|--------|-------|
| 1 | SAVE DB กดไม่ได้ถ้าหน้า DAILY มี N/A / กล่องแดง | ✅ | ✅ | ❌ หน้าจริง |
| 2 | RECYCLE WATER ถูกบันทึกตอน SAVE DB → % น้ำสูญเสียใน Excel หักน้ำล้างบ่อกรองที่นำกลับ | ✅ | ✅ | ❌ หน้าจริง |
| 3 | Excel ลายเซ็น: merge + กึ่งกลาง TH SarabunPSK 11, ตำแหน่ง + " สคน." + ผลัด | ✅ | ✅ | ✅ offline (exceljs อ่านได้ตรงกับ `templates/MH_report_example.xlsx`) |
| 4 | /record พิมพ์ "DailyLab + Operation": วันนี้/เมื่อวาน = QUERY สด, เก่ากว่า = ข้อมูล SAVE DB | ✅ | ✅ | ✅ unit (mapping + กฎวันที่) / ❌ หน้าจริง |

**ต้องทำต่อ (ผู้ใช้):** restart LabVenture (`Fullscale_V2\DEPLOY_LabVenture\start.bat`) → Ctrl+F5 · วันที่ 29/10 ต้อง QUERY DATA + ตั้ง RECYCLE + SAVE DB ใหม่ แล้ว PRINT EXCEL ถึงจะได้ % น้ำสูญเสียที่ถูก
**Session ถัดไป:** ถามผลทดสอบจริงของ 4 ข้อ · ถ้าผู้ใช้สั่งค่อย commit

## ไฟล์ที่แก้ (ดู diff ด้วย `git diff`; mhReport.js ยัง untracked)
- `client/src/pages/OpRecord.jsx` — `DailyReportTab`
- `client/src/components/PrintReport.jsx`
- `server/routes/dailyReport.js`
- `server/services/dailyReport.js`
- `server/services/mhReport.js`
- `server/routes/write.js`

## รายละเอียด / การตัดสินใจ

### 1. บล็อก SAVE DB
- `missing[]` ใน `DailyReportTab` รวมทุกช่องที่หน้าจอแสดง N/A/แดง: KPI, TOTAL COST, summaryCards, SERVICE WATER, CHEMICAL REMAINING (+Day), ตารางการใช้สารเคมี, donut (useNA/actualNA/targetNA ที่ไม่ใช่ noData), การ์ดแท็บ CHEMICAL (ย้ายเป็น const `chemCards`), WASH Water `hasRed`
- ปุ่ม disabled + tooltip รายการ + ป้าย "⚠ ไม่ครบ N" กดดูรายการ
- ผลข้างเคียง: ก่อน 24:00 (`day_complete=false`) donut เป็น N/A → save ไม่ได้ (ตั้งใจ)
- ไม่มี guard ฝั่ง server (เช็คเฉพาะ client)

### 2. Recycle → % น้ำสูญเสีย
- client ส่ง `recycle: [{on,pct}×4]` + `reviewed_shift` ใน `POST /api/daily-report/save`
- server: `recycledWater()` ใช้ `backwashByPhase(historyMap)` (export จาก mhReport.js, กฎเดียวกับ `parseBWPhase` ฝั่ง client) → `water_loss_pct -= recycled / rw_total × 100` (สูตรเดียวกับ "% Loss (adj.)" บนจอ) ก่อน insert summary_table และ build MhCells (AC21)
- `Wash_water_Total` ใน summary_table เดิม NULL → ตอนนี้ใส่ค่า wash รวม
- คอลัมน์ใหม่ (ผ่าน `ensureExtraColumns`): `ReviewedShift`, `RecycleCfg`
- `GET /saved` คืน `recycle` (ของ save ล่าสุด) → client restore ค่า RECYCLE ตอนเปลี่ยนวันที่ (default 100% ทุกเฟส)

### 3. ลายเซ็น Excel (`writeMhReport`)
- เพิ่ม font + cellXf ใหม่ใน styles.xml, merge `D64:I64, D65:I65, Q64:V64, Q65:V65` (ตามไฟล์ example)
- ตำแหน่ง = `position_label` + ` สคน.<ผลัด>` (ไม่เติมถ้ามี "สคน." อยู่แล้ว) — ผู้จัดทำใช้ `summary_table.Shift`, ผู้ทบทวนใช้ `ReviewedShift` (fallback `car_whitelist.shift`)
- **ใช้กับผู้ทบทวนด้วย** (เช่น "หัวหน้าส่วน สคน.3") — ผู้ใช้ยังไม่ได้ยืนยันว่าต้องการ

### 4. DailyLab + Operation ตามวันที่
- กฎ: `date >= วันนี้-1 (เวลาไทย)` → live (`fetch-all` + review issues เหมือนเดิม) ; เก่ากว่า → ไม่ query, เช็ค `/saved`; ไม่เคย SAVE DB → error ให้ไป SAVE DB ที่หน้า DAILY
- server `export.xlsx?dosage=1`: `isLiveReportDate` / `getSavedMhCells` (routes/dailyReport.js) + `dailyLabDosageFromMh` (services/dailyReport.js) map MhCells O/Q/S/U แถว 27 Alum·35 PACl·29 Pre·33 Post → DailyLab X–AA แถว 4/5/7/9
- **สมมติฐาน:** "ดึงจาก db" = summary_table (SAVE DB, mirror MH_report.db) ไม่ใช่ Uroboros data.db (ปุ่ม FROM DB) — ผู้ใช้ยังไม่ยืนยัน
- save เก่าที่ไม่มี MhCells → `overlayDbCells` ซึ่งไม่มีคอลัมน์ dose → Daily Dosage ว่าง

### คำถามที่ตอบไปแล้ว
- DailyLab มี SQL: `node_records` ใน `server/labventure.db` (บันทึกก่อน แล้วค่อย AquaDAT/Excel; ล้มเหลว → `aquadat_queue`/`excel_queue`)
- `node_records` ไม่ถูกลบเมื่อสำเร็จ (ไม่มี DELETE ทั้ง server); คิวถูก mark `success`/`dead` ลบเฉพาะปุ่มในหน้า Test (`routes/test.js`)

## Deploy รอบนี้
- Backup: `Fullscale_V2\_backup\LabVenture_before_dailyfix_3110\` (ข้อ 1–3) และ `LabVenture_before_dailyopsrc_3110\` (ข้อ 4)
- ไฟล์ server ฝั่ง deploy ตรวจแล้วตรงกับ local (`diff --ignore-cr-at-eol`) และ `require` ได้

## Suggested skills
- `run` — เปิดหน้า DAILY / record ตรวจ (ต้องให้ผู้ใช้ login ใน browser pane ก่อน)
- `code-review` — ตรวจ diff 6 ไฟล์ข้างบนก่อน commit
- `handoff:handoff` — ตอนจบ session ถัดไป

## หมายเหตุ
- ตอบผู้ใช้เป็นภาษาไทย
- ห้าม commit/push จนกว่าผู้ใช้สั่ง
- Agent restart server เองไม่ได้ → ผู้ใช้ restart

---

# Session 2 (31/10/2569) — หน้า DailyReport ใน BellBeast (ดึง MH_report + DailyLab)

ทุกอย่าง **ยังไม่ commit** (ทั้ง repo BellBeast และ LabVenture) · **deploy ไป Fullscale_V2 แล้ว** · ทดสอบใน browser pane ด้วย fetch จำลอง + ทดสอบ endpoint กับสำเนา DB ของ Fullscale (scratchpad) · ผู้ใช้ลองหน้าจริงแล้วบางส่วน ("ทำงานโอเค")
**ต้องทำต่อ (ผู้ใช้):** restart LabVenture (`Fullscale_V2\DEPLOY_LabVenture\start.bat`) + เปิด BellBeast (`START_FULLSCALE_LOCALHOST`) → Ctrl+F5 — การปลด login ของ DailyLab (รอบสุดท้าย) ยังไม่มีผลจนกว่าจะ restart LabVenture

## สิ่งที่ทำ
หน้าใหม่ `/DailyReport` ใน BellBeast (เมนูระหว่าง WebPM กับ ChemReport — ใช้ช่องที่เคย comment `MH_report` ไว้; หน้าเก่า `Pages/MH_report.cshtml` ไม่ได้แตะ) เรียก LabVenture ผ่าน proxy `/labventure/*` เดิมของ BellBeast (`Program.cs` ~บรรทัด 427) ไม่มี proxy ใหม่

**UI (สถานะสุดท้ายหลังผู้ใช้ปรับหลายรอบ)**
- ซ้าย (330px): header ไล่สี "📊 Daily Report", ติ๊ก MH_report / DailyLab / รวม Daily Dosage, "ช่วงวันที่" + ปุ่ม **Clear select** (grid 70:30), วันที่ from/to (native date picker ซ่อน แสดง d-MMM-yyyy แบบ ChemReport), ข้อความสถานะ — **ไม่มี**ปุ่มลัด วันนี้/เมื่อวาน/เดือนนี้ (ผู้ใช้สั่งเอาออก) และ**ไม่มี**คำเตือน Daily Dosage / hint ปฏิทิน (ผู้ใช้ขอ clean)
- ขวา: ปฏิทินรายเดือน สี ครบ/ไม่ครบ/รอ SAVE DB (วันนี้-เมื่อวานที่ยังไม่ SAVE)/ไม่มีข้อมูล · คลิก = 1 วัน · **ลาก** = หลายวัน (pointer events + `elementFromPoint`, สูงสุด 62 วัน) · Shift+คลิก = ต่อช่วง · คลิกวันเดิมที่เลือกไว้วันเดียว = ยกเลิก → ทั้งเดือน · ไม่ได้เลือก (=ทั้งเดือน) จะไม่มีกรอบ และเปลี่ยนเดือนแล้วตารางตามไป · ทุกการเลือกวัน **โหลดสถานะอัตโนมัติ** (ไม่มีปุ่มโหลด/ดาวน์โหลดที่เลือกแล้ว)
- ป้ายมุมขวาบนปฏิทิน: แสดงเฉพาะตอน LabVenture ล่ม/ติดต่อไม่ได้
- ตารางผลลัพธ์: วันที่ | ผู้จัดทำ/ผู้ทบทวน | MH_report | DailyLab | **Excel Printout** (ปุ่ม MH / Lab ใหญ่) | **หมายเหตุ** ("ไม่มีข้อมูล MH_report" / "…DailyLab" / "…MH_report และ DailyLab") · MH ที่ยังไม่ SAVE (วันเก่า) แสดง "ไม่มี" · ไม่มีลิงก์ "ไปหน้า DAILY" แล้ว (ผู้ใช้ไม่ชอบ)
- มุมขวาบนกล่องผลลัพธ์: **Download table** = Excel ข้อมูลดิบทั้งช่วง (ไม่ลงฟอร์ม) ตามที่ติ๊ก MH/DailyLab

**LabVenture endpoints (ใหม่ใน `server/routes/write.js`)**
- `GET /api/write/record-dates?from&to` — นับค่า DailyLab ต่อวัน (`values_count`, `recorder_slots`) ไม่ต้อง login
- `GET /api/write/table.xlsx?from&to&lab=1&mh=1` — sheets: `DailyLab` (แถว = วันที่+Slot, คอลัมน์ = param_key; daily params ยุบเป็น slot `daily` แบบเดียวกับ export.xlsx), `Params` (param_key/กลุ่ม/ชื่อ/หน่วย/ความถี่ จาก nodes.json), `MH_summary` (SAVE ล่าสุดต่อวัน, ไม่รวม MhCells/RecycleCfg), `MH_detail` · จำกัด 62 วัน
- **ปลด `requireAuth`** ของ `GET /api/write/export.xlsx` (ฟอร์ม DailyLab) และ table.xlsx — ผู้ใช้เลือกเอง (ตัวเลือก "1") เพราะหน้า DailyReport ไม่ใช้ login; ผลคือใครเปิดหน้าได้ก็โหลด DailyLab ได้ · endpoint อื่น (`/nodes`, write) ยังต้อง login
- ที่ใช้ของเดิม: `GET /api/daily-report/saved-dates`, `GET /api/daily-report/export-mh.xlsx?date=` (404 ถ้ายังไม่ SAVE DB)

## ไฟล์
- BellBeast: `Pages/DailyReport.cshtml`, `Pages/DailyReport.cshtml.cs`, `wwwroot/js/dailyreport.js` (ใหม่) · `Pages/Shared/_Layout.cshtml` (ลิงก์เมนู) · `Program.cs` (`AllowAnonymousToPage("/DailyReport")`)
- LabVenture: `server/routes/write.js`

## Deploy convention ที่ใช้ (BellBeast — ยังไม่เคยจดไว้)
- ปลายทาง `Fullscale_V2\BellBeast_proj\` (published build, รันด้วย `START_FULLSCALE_LOCALHOST.ps1`) — เช็คก่อนว่า `BellBeast.exe` ไม่ได้รัน (DLL lock) และไฟล์ที่เปลี่ยนตั้งแต่ deploy ล่าสุดมีแค่ของเรา (`find … -newer BellBeast_proj/BellBeast.dll`) เพราะ working tree มีงานอื่นค้างไม่ commit
- `dotnet publish BellBeast/BellBeast.csproj -c Release -o <scratchpad>/bb_publish` → backup ทั้งโฟลเดอร์ไป `_backup\BellBeast_proj_before_<tag>_DDMM` → `robocopy <publish> BellBeast_proj /E /XD App_Data /XF appsettings.json appsettings.Development.json web.config` (exit 1–3 = สำเร็จ; ห้าม /MIR — ฝั่ง deploy มีไฟล์เพิ่ม เช่น chat.js)
- LabVenture: ใช้ convention เดิม (backup + CRLF + `require` check)
- Backup รอบนี้: `_backup\LabVenture_before_dailyreport_3110`, `…dailyreport2_3110`, `…noauth_3110` · `_backup\BellBeast_proj_before_dailyreport_3110` … `dailyreport7_3110`, `…noauth_3110`

## หมายเหตุ / กับดัก
- Razor `.cshtml` ไม่มี runtime compilation → แก้แล้วต้อง restart preview server (`.claude/launch.json` ชื่อ `bellbeast`, port 5077)
- ใน browser pane พิกัด `computer` click ไม่ตรงกับ CSS px (สเกล ~1.28) — ทดสอบปฏิทินด้วย `dispatchEvent(PointerEvent)` ที่ `getBoundingClientRect` แทน
- Daily Dosage ของวันนี้/เมื่อวานใน DailyLab export มาจาก cache ของ LabVenture (ต้องมีคนกด QUERY DATA ที่หน้า DAILY) — ผู้ใช้ขอเอาคำเตือนออกแล้ว แต่พฤติกรรมยังเป็นแบบนี้
- ป้าย "รอ SAVE DB" (วันนี้/เมื่อวาน) ยังอยู่ — ผู้ใช้ยังไม่ได้ขอเปลี่ยนเป็น "ไม่มี" (ถามไว้แล้ว ยังไม่ตอบ)
- งานค้างจาก Session 1 (ด้านบน) ยังไม่ได้ถามผลทดสอบ

## Suggested skills (session ถัดไป)
- `run` — เปิด BellBeast preview ตรวจหน้า `/DailyReport` กับ LabVenture จริง (port 8889 ต้องรันอยู่)
- `code-review` — ตรวจ diff ของ `dailyreport.js` / `write.js` ก่อน commit
- `handoff:handoff` — ตอนจบ session (append เท่านั้น)

---

# Session 3 (31/10/2569) — SAVE DB บันทึกครบทุกคอลัมน์ตาม MH_report.db + MH_summary แจกแจงรายเฟส

ทุกอย่าง **ยังไม่ commit** · **deploy ไป Fullscale_V2 แล้ว** (3 รอบ) · ทดสอบกับสำเนา DB ใน scratchpad เท่านั้น · **ผู้ใช้ยังไม่ได้ restart / ทดสอบหน้าจริง**
**ต้องทำต่อ (ผู้ใช้):** restart LabVenture (`Fullscale_V2\DEPLOY_LabVenture\start.bat`) → Ctrl+F5 → **SAVE DB วันที่ 29/10 ใหม่** (แถวเดิม save 08:11 ด้วยโค้ดก่อน deploy 09:06 → ขาดหลายคอลัมน์ + หน่วยค่าใช้จ่ายแบบเก่า) → Download table ที่ `/DailyReport` ตรวจ

## ต้นเรื่อง
ผู้ใช้ Download table ที่ BellBeast `/DailyReport` → DailyLab ครบ แต่ MH_summary ไม่ครบ · สั่ง "set base คือตัว db เป็นหลัก ต้องมีข้อมูลทุก column"
**Base ที่ใช้อ้างอิง:** `C:\Users\peera\OneDrive\Desktop\DDD\Sword\bin\x64\Debug\net9.0-windows\MH_report.db` (และ `bin\Debug\...`) — มีค่าครบทุกคอลัมน์ (อ่านด้วย `sqlite3` CLI; node-sqlite3-wasm เปิดไฟล์นี้ไม่ได้) · หน้าเก่า BellBeast `Pages/MH_report.cshtml` ระบุหน่วยตรงกับ base

## สิ่งที่ทำ
### 1. `/api/daily-report/save` เขียนครบทุกคอลัมน์ (`server/routes/dailyReport.js`)
- เขียน INSERT ใหม่เป็น helper `insert(table, {col: value})` (ไม่ต้องนับ `?`)
- คอลัมน์ที่เดิมไม่ถูกเขียน: summary `FRT_Avg`, `PercentageFilterUse`, `Polymer_*` · detail `ON/STANDBY/REPAIR_P*`, `WASHCOUNT_P*`, `FRT_P*`, `Wash_water_P*`, `*_P*tonuse`, `*_P*targer_dose`, `*_P*actual_dose`, `polymer_*`
- **แก้หน่วย/ความหมายให้ตรง base:** `Chem_cost/Energy_cost/Sludge_disposal_cost/Total_cost` = บาท/ลบ.ม. (เดิมบาท/วัน; `Total_cost` = `op_cost_per_m3` ไม่รวมค่าน้ำดิบ) · `alum/pacl/chlorine_baht` = บาท/ลบ.ม. ของน้ำสูบรวม · `DPS_TotalF` = DPS A+B (เดิม DPS+TPS) · `Cl_income` = ท่อ (`r.cl_income`, เดิม kg) · detail `Energy_total` = plant + SS3 Bldg. (`Plant_Energy_USEtotal` ไม่รวม SS3)
- target dose = `card14_chem_dosing.{alum,pacl,pre_cl,post_cl}_p*` (weightedAvgDR) · actual = `*_actual_p*` · Cl tonuse = kg/1000
- สารที่ไม่ได้ใช้วันนั้น (ใช้รวม = 0) → ค่ารายเฟส use/target/actual = 0 (`z0`) แบบ base
- Polymer ไม่มีแหล่งข้อมูล → 0 · `polymer_ton` = `chem_cost.polymer_ton ?? 0` (ไม่มีใน app_settings; base ใช้ 72210 — ยังไม่ได้ถามผู้ใช้)
- `recycledWater()` คืน `bw` (backwash รายเฟส) ให้ใช้ต่อ
### 2. ข้อมูลประกอบ
- `services/dailyReport.js` `getFilterAvailability` คืนเพิ่ม `standby`, `on`, `known` (known=0 → ไม่มีสถานะ → บันทึก NULL)
- `services/mhReport.js` `backwashByPhase` คืนเพิ่ม `count` (จำนวนครั้งล้าง), `runs` (ใช้คิด `FRT_Avg` = ค่าเฉลี่ยทุกครั้งล้าง แบบ base)
- `overlayDbCells` (พิมพ์ Excel จาก save ที่ไม่มี MhCells) รองรับทั้งหน่วยใหม่และเก่า: ค่าใช้จ่าย ≥1000 = บาท/วันแบบเก่า (หารด้วย `DPS_TotalF` เดิม), `Cl_income` >200 = kg
### 3. MH_summary ใน `table.xlsx` (`server/routes/write.js`) — ผู้ใช้เลือก "เฉพาะ Download table" ไม่แก้ schema
- ค่ารายเฟสดึงจาก `detail_table` วันเดียวกัน วาง **ก่อน** Total: RWS (`RWS1_P1F…RWS2_P4F`→`RWS_TotalF`), PreCl+PosCl tonuse→`Cl_Total_tonuse`, Alum, Pacl, Polymer (`Polymer_P*tonuse` สังเคราะห์ = 0 ถ้า total 0), FRT→`FRT_Avg`, Sludge_drain, Wash_water
- dose วาง **หลัง** Total ของสารนั้น: Cl → PreCl target, PreCl actual, PosCl target, PosCl actual · Alum / Pacl → target, actual · ชื่อคอลัมน์ใช้ `targer` ตาม base (เสนอเปลี่ยนเป็น `target` ใน Excel ได้ ผู้ใช้ยังไม่ตอบ)
- MH_summary ตอนนี้ 104 คอลัมน์

## ทดสอบ (scratchpad ของ session นี้ — หายได้)
- harness: mock BellBeast `/api/operator/data` จากสำเนา Uroboros `data.db` (`Fullscale_V2\Uroboros_proj\data.db`, ตาราง `AQ_readings_operator_v1` + `AQ_readings_narrow_v2`) → `GET /fetch-db` → `POST /save` ด้วย `LV_DB_PATH`=สำเนา labventure.db, `BELLBEAST_PORT`=mock
- report ทุกค่าบังคับเป็นตัวเลข → summary NULL 0/37, detail 0/111 (แมปครบ)
- ข้อมูลจริง 28/10: คอลัมน์ใหม่ได้ค่า; ที่เหลือ NULL เพราะ data.db มีถึง 20:00 (ไม่มี 24:00) — ข้อมูลขาดจริง
- table.xlsx: ลำดับคอลัมน์ตรง, แถว 28/10 ไม่มีช่องว่าง

## Deploy รอบนี้ (convention เดิม: backup + CRLF + `require` check — Bash ถูก auto-mode block ครั้งแรก ผู้ใช้สั่ง "Deploy เลย" จึงผ่าน)
- `_backup\LabVenture_before_mhcols_3110\` (routes/dailyReport.js, services/dailyReport.js, services/mhReport.js)
- `_backup\LabVenture_before_mhphases_3110\`, `_backup\LabVenture_before_mhdose_3110\` (routes/write.js)

## หมายเหตุ / ค้าง
- `DateKey` ของเรา `YYYY-MM-DD` ≠ base `YYYYMMDD` — ไม่เปลี่ยน (ทั้งระบบใช้แบบมีขีด) · base ปัดทศนิยม 2 ตำแหน่ง ของเราเก็บเต็ม
- ไม่มี service รันอยู่ตอนทดสอบ (443/8888/8889 ปิด)
- งานค้างจาก Session 1–2 ยังไม่ได้ผลทดสอบจริง (ดูด้านบน)

## Suggested skills (session ถัดไป)
- `run` — เปิด BellBeast `/DailyReport` + หน้า DAILY หลังผู้ใช้ restart, SAVE DB แล้ว Download table ตรวจคอลัมน์
- `code-review` — ตรวจ diff `server/routes/dailyReport.js`, `server/routes/write.js`, `server/services/{dailyReport,mhReport}.js` ก่อน commit
- `handoff:handoff` — ตอนจบ session (append ไฟล์นี้)

---

# Session 4 (31/10/2569) — Daily Report ตัดเองอัตโนมัติ (β) จาก Uroboros + กันปฏิทิน พ.ศ.

**ยังไม่ commit ทั้ง 2 repo** (LabVenture + `Desktop\Uroboros\Uroboros`) · **deploy ไป Fullscale_V2 แล้ว** · **ทดสอบจริงวันที่ 30/10/69 ผ่าน** (SAVE DB แล้ว)
ต่อจาก Session 3 — `saveDailyReport()` แยกมาจาก `/save` เวอร์ชันของ Session 3 (ทุกคอลัมน์ MH_report.db ยังอยู่)

## สิ่งที่ทำ
1. **Uroboros task `labventure.dailyreport`** (`Uroboros/LabVentureDailyTask.cs`, ลงทะเบียนใน `Program.cs` ทั้ง `reg.Register` + `catalog`, interval 60s)
   - รันเอง 00:05 / 00:30 / 01:00 (TH) ทำรายงานของ **เมื่อวาน**; ผ่านรอบไหนหยุด · เว้นห่างขั้นต่ำ 20 นาที · หลัง 02:00 ไม่ catch-up → บันทึก "missed" (Final) 1 ครั้ง
   - state: `Uroboros_proj\labventure_daily_state.json` (restart ไม่ซ้ำ/ไม่ข้าม)
   - login เอง `AquadatFastCli.AquadatFastQuery().LoginToAPI()` → ส่ง `Authorization: Bearer` + `X-Auto-Key`
   - stage≠1 → ERROR ไม่เรียก (data.db fallback มีแค่วันล่าสุด → ผิดวันหลังเที่ยงคืน)
   - timeout HTTP 5 นาที → อ่าน `GET /auto-run/last` เอารายการกล่องแดงของรอบล่าสุดที่จบ
   - fail ครบ 3 รอบ → log รายการ `section · item` + throw (TaskHealth fail)
   - **สั่งรันเอง (ทดสอบ):** เขียนวันที่ `YYYY-MM-DD` ลง `Uroboros_proj\labventure_daily_force.txt` → รันภายใน 1 นาที (attempt 0) แล้วลบไฟล์ทิ้ง
   - log ลงไฟล์ด้วย `Uroboros_proj\logs\dailyreport\dailyreport.log` (ConsoleLogger เขียนแค่ console ซึ่งถูกซ่อน) + `logs\dailyreport\{date}.json` / `{date}_manual.json`
2. **LabVenture endpoint** (`server/routes/dailyReport.js` ท้ายไฟล์)
   - `POST /api/daily-report/auto-run` `{date?, attempt?}` (default = เมื่อวาน) — ต้องมี header `X-Auto-Key` = `DAILY_AUTO_KEY` ใน `.env` (ไม่ตั้ง = ปิด)
   - query สด `fetchRestHistory` (ล้าง `historyCache[date]`) → `dailyReportIssues()` → ว่าง = `saveDailyReport()` **Shift 0**, PreparedBy `AUTO · Uroboros (β)`, ReviewedBy `N/A`, recycle = ของวันนั้นที่เคย save หรือ default 100%
   - มีคน SAVE DB (Shift 1–4) แล้ว → `SKIPPED` ไม่ทับ (detail_table key แค่ DateKey)
   - ตาราง `daily_auto_runs` (สร้างตอนใช้, `ensureAutoRunsTable`) · กันรันซ้อนต่อวัน (409) · `GET /auto-run/last?date=`
   - mount ซ้ำที่ `/labventure/api/daily-report` ใน `server/index.js` (Uroboros เรียก node :8889 ตรง ไม่ผ่าน BellBeast — แบบเดียวกับ eventclass)
   - Shift 0: export-mh ไม่ใส่ "สคน.0", popup PRINT EXCEL แสดง "สร้างโดยระบบ (AUTO β)"
3. **กฎกล่องแดงย้ายเป็นไฟล์กลาง** `server/shared/dailyReportRules.mjs` (`FWS_BW_PHASES`, `parseBWPhase`, `dailyReportIssues`) — client import ผ่าน `../../../server/shared/...` (`vite.config.js` เพิ่ม `server.fs.allow: ['..']`), server โหลดด้วย `import()`; `client/src/utils/dailyReportIssues.js` เหลือแค่ re-export, OpRecord.jsx re-export `FWS_BW_PHASES/parseBWPhase`
   - ⚠ `missing[]` ใน `DailyReportTab` (บล็อกปุ่ม SAVE DB) ยังเป็นโค้ดแยก — ถ้าแก้เงื่อนไขกล่องแดง ต้องแก้ทั้ง 2 ที่
4. **ปฏิทิน พ.ศ.** — เครื่อง deploy ตั้ง th-TH/Buddhist: `ToString("yyyy-MM-dd")` ไม่ใส่ culture ได้ `2569-…` (เจอตอนรันจริง task ส่ง 2569-10-30)
   - `Uroboros/CalendarGuard.cs` เรียกบรรทัดแรกของ `Main` → ถ้า culture ไม่ใช่ Gregorian สลับทั้ง process เป็น culture เดิม + GregorianCalendar (ตัวเลข/ชื่อเดือนคงเดิม; `GetCultureInfo("th-TH")` ที่ใช้ตั้งใจยังได้ พ.ศ.)
   - แก้ตรงด้วย InvariantCulture: `AquadatFast.cs:1986` (nextDay ใน SQL filter data.db), `Listener_CHEMLAB.cs:1614` (ts), ทุกวันที่ใน LabVentureDailyTask
   - test: `Uroboros.Tests/CalendarGuardTests.cs` (5) · self-test `SelfTest/ST_Calendar.cs` (ลงทะเบียนใน `SelfTestRunner`) ดูที่ `http://localhost:8888/admin/test/run`
   - LabVenture `server/index.js` log `[CALENDAR]` ตอนเปิด (Node บนเครื่องนี้ default `th-TH/buddhist`; server ใช้ `toISOString()/nowTH()` จึงไม่กระทบ, client ระบุ locale ทุกจุด)

## ทดสอบ
- endpoint บนสำเนา DB (AquaDAT stub): 403 / ERROR stage0 / 409 / INCOMPLETE 76 รายการ / SKIPPED / OK→Shift 0 / export-mh 200 / `/save` เดิมยังได้ (harness อยู่ใน scratchpad — หายได้)
- Uroboros `dotnet test` 307/307 · self-test บนเครื่อง deploy 38/38 · client `vite build` ผ่าน
- **จริงบน Fullscale_V2:** force 2026-10-30 → `OK`, summary_table แถว Shift 0 (RWS 1,521,200 · %loss 3.66 · cost 0.7917 · 194.05 MWh), detail_table 1 แถว, daily_auto_runs id=1 OK
- ยังไม่ได้: เปิดหน้า DAILY ใน browser, รอบอัตโนมัติจริง (คืนแรก 31/10 → 00:05 วันที่ 1/11)

## Deploy รอบนี้
- Uroboros: build `-c Release` ไป scratchpad แล้ว copy เฉพาะ `Uroboros.{dll,exe,pdb}` → `Uroboros_proj` (deps.json เหมือนเดิม)
- LabVenture: `server/routes/dailyReport.js`, `server/index.js`, `server/shared/dailyReportRules.mjs` (ใหม่ — ต้อง copy ทุกครั้ง), `client/dist` build ใหม่, `.env` เพิ่ม `DAILY_AUTO_KEY` (ค่าอยู่ใน `.env` เท่านั้น ไม่ได้จดไว้ที่นี่)
- `START_FULLSCALE_LOCALHOST.ps1` อ่าน `DAILY_AUTO_KEY` + `PORT` จาก `DEPLOY_LabVenture\server\.env` → ตั้ง `LABVENTURE_AUTO_KEY` / `LABVENTURE_URL` ให้ Uroboros
- restart ด้วย `STOP_FULLSCALE.ps1` → `START_FULLSCALE_LOCALHOST.ps1 -HiddenMode 1` (UAC ทุกครั้ง; ผู้ใช้กด Yes)
- backup: `_backup\before_dailyauto_3110\` (Uroboros bin, dailyReport.js, index.js, .env, client/dist, START ps1) · `_backup\before_calendarguard_3110\` (Uroboros bin, index.js)

## หมายเหตุ / กับดัก
- ผู้ใช้เลือก: ลง `summary_table` จริง · Shift = 0 "generate ผ่านระบบ" · ReviewedBy = `N/A`
- คน SAVE DB วันเดียวกันทีหลัง → ได้อีกแถว (Shift 1–4), PRINT EXCEL ใช้แถวล่าสุด, detail_table ถูกทับด้วยของคน
- วัน deploy ที่เปิดหลัง 02:00 จะมี log "missed" + TaskHealth fail 1 ครั้ง (ตั้งใจ)
- `LoginToAPI()` เดิมลองรหัสสำรองแบบวน (โค้ดเดิม ไม่ได้แตะ) · Program.cs/AlarmIo.cs ฯลฯ ใน Uroboros มีงานค้างอื่นที่ยังไม่ commit ปนอยู่
- ยังไม่มี UI แสดงผล auto-run บนหน้า DAILY / แจ้ง LINE เมื่อ fail (ออกแบบไว้เป็นส่วนเสริม)

## Suggested skills (session ถัดไป)
- `run` — เปิดหน้า DAILY / PRINT EXCEL วันที่ 30/10 ดูว่าแสดง "สร้างโดยระบบ (AUTO β)" ถูก
- `code-review` — diff `server/routes/dailyReport.js`, `server/shared/dailyReportRules.mjs`, `Uroboros/LabVentureDailyTask.cs`, `Uroboros/CalendarGuard.cs` ก่อน commit
- `handoff:handoff` — append ไฟล์นี้ตอนจบ session
- session ถัดไป: เช็ค `Uroboros_proj\logs\dailyreport\dailyreport.log` ผลรอบ 00:05 ของ 1/11 (รายงานวันที่ 31/10)

---

# Session 4 (ต่อ, 31/10/2569) — MH_report ของวัน auto-run: ลายเซ็นเป็นข้อความอังกฤษ

**ยังไม่ commit** · **deploy ไป Fullscale_V2 แล้ว** · ตรวจไฟล์จริงจาก `http://localhost:8889/api/daily-report/export-mh.xlsx?date=2026-10-30` ถูกต้อง

## สิ่งที่ทำ
- PRINT EXCEL (`GET /export-mh.xlsx`) ถ้าแถวล่าสุดเป็น Shift 0 (auto-run) → ไม่พิมพ์ `AUTO · Uroboros (β)` / `N/A` แต่ใส่ข้อความแทน (ค่าคงที่ `AUTO_FORM_PREPARER` / `AUTO_FORM_REVIEWER` ใน `server/routes/dailyReport.js` — แก้ถ้อยคำที่นี่):
  - จัดทำโดย D64/D65: `This report was generated` / `automatically by the system.`
  - ทบทวนโดย Q64/Q65: `Auto-generated report` / `(no manual review)`
- DB ไม่เปลี่ยน (PreparedBy/ReviewedBy ยังเป็น `AUTO · Uroboros (β)` / `N/A`); วันคน save ยังได้ชื่อ + ตำแหน่ง สคน. เหมือนเดิม (เช็ค 29/10)
- `person()` ใน export-mh ตัด guard `shift === 0` ออก (auto ไม่เรียก person แล้ว)
- `server/services/mhReport.js` `SIGN_XF` เพิ่ม `shrinkToFit="1"` — ช่องลายเซ็นทุกวันย่อตัวอักษรเองถ้ายาวเกิน (ช่องกว้าง ~19 หน่วย)

## ทดสอบ
- harness บนสำเนา DB deploy: 30/10 ได้ข้อความอังกฤษ, 29/10 ได้ชื่อจริง · แปลง PDF ด้วย Excel COM (ไม่มี LibreOffice ในเครื่อง) ข้อความกึ่งกลางไม่ล้น
- live หลัง restart: export 200, D64/D65/Q64/Q65 ตรง

## Deploy
- backup `Fullscale_V2\_backup\before_autoform_3110\` (routes/dailyReport.js, services/mhReport.js) → copy 2 ไฟล์ → STOP/START (UAC 2 ครั้ง)

## หมายเหตุ / ค้าง
- ⚠ MH_report พิมพ์ด้วย Excel บนเครื่องนี้ได้ **2 หน้า** (ขอบขวาล้น) — template เปล่าก็เป็น (zoom 83, PrintArea A1:AH68) ไม่ใช่จากงานนี้; เสนอผู้ใช้แก้ page setup ให้พอดี 1 หน้า ยังไม่ได้ตอบ
- ตอบคำถามผู้ใช้: task `labventure.dailyreport` interval 60s = ตื่นมาเช็ค state/เวลา แล้วเลิกทันทีเกือบทุกรอบ งานจริงเฉพาะ 00:05/00:30/01:00 (อธิบายใน Session 4 ข้อ 1)

## Suggested skills (session ถัดไป)
- `xlsx` — ถ้าผู้ใช้ให้แก้ page setup ของ `server/templates/MH_report_theme.xlsx` ให้พอดี 1 หน้า (แก้ผ่าน XML เหมือน writeMhReport เพื่อไม่ให้ style หาย)
- `code-review` — diff รวมของ Session 4 ก่อน commit
- `handoff:handoff` — append ไฟล์นี้ตอนจบ session

---

# Session 5 (31/10/2569) — ข้อความวิ่งหลายข้อความใน MHxView + MHxView ดึงเกณฑ์ใหม่เองเมื่อเปลี่ยนสถานการณ์

ทั้ง LabVenture และ BellBeast **ยังไม่ commit** · **deploy ไป Fullscale_V2 แล้วและเปิดระบบใหม่แล้ว** · ตรวจหน้าจริงแล้วว่าแถบวิ่งขึ้น แต่**ยังไม่ได้ลองเปลี่ยนสถานการณ์จริง**

## ต้นเรื่อง (ผู้ใช้ขอ)
1. ข้อความวิ่งของ LabVenture ให้ไปแสดงที่ header ของ `http://localhost:443/MHxViewer/MHxView` ตั้งได้ว่ามีกี่ข้อความ แสดงต่อกัน คั่นด้วย 📢 ทั้งหน้า กลาง หลัง
2. เปลี่ยนสถานการณ์ใน LabVenture แล้วเกณฑ์ใน MHxView ไม่เปลี่ยนจนกว่าจะกด F5 → ให้เปลี่ยนเอง

## สิ่งที่ทำ
- **LabVenture `server/routes/scenarios.js`**
  - `app_settings.json` เก็บ `marquee_items: string[]` (สูงสุด 20, ตัดข้อความว่าง) · ไฟล์เก่าที่มีแต่ `marquee_text` → นับเป็น 1 ข้อความ (PATCH ครั้งแรกจะลบ `marquee_text` ทิ้ง)
  - `GET /marquee` → `{ items, marquee_text }` (`marquee_text` = `📢 a 📢 b 📢` ให้ header ของ LabVenture `Layout.jsx` ใช้ต่อได้โดยไม่ต้องแก้)
  - `PATCH /marquee` รับ `{ items }` (หรือ `{ marquee_text }` แบบเก่า)
  - ใหม่ `GET /live` (ไม่ต้อง login, no-store) → `{ marquee, rev, scenario, epidemic }` · `rev` = md5 12 ตัวของ `activeLimits()` → เปลี่ยนเมื่อสถานการณ์/โรคระบาด/ค่าเกณฑ์เปลี่ยน
- **LabVenture `client/src/pages/ConfigEditor.jsx`** `MarqueeEditor` → รายการ [1] [2] … + เพิ่ม/ลบ/▲▼ + แถวตัวอย่าง
- **BellBeast `wwwroot/js/MHxLiveFeed.js` (ใหม่)** poll `/labventure/api/scenarios/live` ทุก 15 วิ + ตอนกลับมาที่แท็บ · วาดแถบวิ่ง (CSS animation, 2 ชุดต่อกันให้วนไม่ขาด, hover = หยุด) · `rev` เปลี่ยน → `window.LABView.tick()` + ยิง event `lv:limits-changed` (ไม่ reload ทั้งหน้า)
- **BellBeast `Pages/MHxViewer/MHxView.cshtml`** เพิ่ม `<div class="lv-marquee" id="lvMarquee">` ระหว่าง `.title` กับ `.right` ใน `.bb-topbar` + CSS (`@@keyframes`) + `<script src="~/js/MHxLiveFeed.js" asp-append-version>` ต่อจาก LABview.js

## การตัดสินใจ
- ใน MHxView มีแค่ **LAB block (`LABview.js`)** ที่ใช้เกณฑ์ของ LabVenture (`/scenarios/limits`) — เดิมดึงเกณฑ์เฉพาะตามรอบ refresh ของ block (≥5 นาที) · alarm ฝั่ง Uroboros มี `kickSync()` ตอนเปลี่ยนสถานการณ์อยู่แล้ว
- ตัวเลข [1] [2] แสดงเฉพาะในหน้าตั้งค่า แถบวิ่งมีแค่ 📢 คั่น (บอกผู้ใช้แล้วว่าถ้าอยากให้เลขขึ้นบนแถบด้วยให้บอก — ยังไม่ได้ตอบ)

## ทดสอบ
- route: express ชั่วคราวพอร์ต 8898 + stub `activeLimits` (เพราะ `getDb()` ต้อง initDb) → PATCH ได้ 3 ข้อความ, `rev` เปลี่ยนเมื่อเกณฑ์เปลี่ยน · `app_settings.json` ของ repo คืนค่าเดิมหลังทดสอบแล้ว
- หน้าจำลอง (mock fetch): 3 ข้อความ = 📢 4 ตัว, rev เปลี่ยน → `LABView.tick` ถูกเรียก 1 ครั้ง
- หน้าจริงหลัง deploy: `/live` 200, แถบไม่ hidden, ข้อความเดิม 1 ข้อความ (📢 2 ตัว), หัว LAB = "เกณฑ์: น้ำด้อยคุณภาพระดับเฝ้าระวัง"

## Deploy รอบนี้
- ตอนเริ่ม Fullscale หยุดอยู่ทั้งชุด → วางไฟล์ → เปิดด้วย `START_FULLSCALE_LOCALHOST.cmd` (UAC)
- LabVenture: backup `Fullscale_V2\_backup\LabVenture_before_marquee_3110\` → copy `server/routes/scenarios.js` + แทน `client/dist` ทั้งโฟลเดอร์ (เช็กแล้วว่าต่างจาก deploy เฉพาะงานนี้; `routes/algae.js` ใน repo ต่างจาก deploy อยู่ก่อน — ไม่ได้แตะ)
- BellBeast: `dotnet publish -c Release -o %TEMP%\claude\bb_publish_marquee` แล้ว diff กับ deploy → copy เฉพาะ `BellBeast.dll/.pdb`, `BellBeast.staticwebassets.endpoints.json`, `wwwroot/js/MHxLiveFeed.js(.br/.gz)` · backup `Fullscale_V2\_backup\BellBeast_proj_before_marquee_3110\`
- ⚠ **อย่าใช้ `FolderProfile5.pubxml` publish ตรง** — `ExcludeApp_Data=false` จะทับ `App_Data\audio\manifest.json` และ `appsettings.json` ของ deploy (ทั้งสองไฟล์ต่างจาก output publish)

## ค้าง
- ลองเปลี่ยนสถานการณ์จริงแล้วดูหัวการ์ด LAB ใน MHxView เปลี่ยนเองใน ~15 วิ (ยังไม่ได้ทำเพราะกระทบเกณฑ์/alarm ที่ใช้งานอยู่)
- commit ทั้ง 2 repo (BellBeast: `MHxView.cshtml`, `wwwroot/js/MHxLiveFeed.js` · LabVenture: `server/routes/scenarios.js`, `client/src/pages/ConfigEditor.jsx`) — ทั้งสอง repo มีงานอื่นค้าง uncommitted ปนอยู่มาก
- ถ้าภายหลังมี block อื่นใน MHxView ใช้เกณฑ์ LabVenture → ฟัง `window.addEventListener("lv:limits-changed", …)`

## Suggested skills (session ถัดไป)
- `code-review` — diff ของ 4 ไฟล์ข้างบนก่อน commit
- `run` — ถ้าต้องเปิดหน้า MHxView ตรวจหลังเปลี่ยนสถานการณ์
- `handoff:handoff` — append ไฟล์นี้ตอนจบ session

---

# Session 5 (ต่อ, 31/10/2569) — ปุ่มกลับ MHxView ใน LabVenture + แถบข่าว MHxView มีป้ายสถานะ, วิ่งขวา→ซ้าย

ยังไม่ commit ทั้ง 2 repo · deploy แล้วทั้งสองงาน · ⚠ **ตอนจบ session: LabVenture และ Uroboros ไม่ได้รัน** (ดู "สถานะระบบ")

## A. LabVenture → กลับไป MHxView (✅ deploy · ✅ ทดสอบหน้า login จริง)
- ใหม่ `client/src/utils/mhxView.js` → `mhxViewUrl()`: path ขึ้นต้น `/labventure` และพอร์ตไม่ใช่ 8889 (= ผ่าน proxy BellBeast) → `/MHxViewer/MHxView` · ไม่งั้น (เปิดตรง 8889 / vite dev) → `${protocol}//${hostname}:443/MHxViewer/MHxView`
- ปุ่ม "↩ MHxView" ใน `components/Layout.jsx` 3 ที่ (header ข้างโลโก้, ท้าย sidebar, ท้ายเมนูมือถือ) + `pages/Login.jsx` ใต้ชื่อแอป — จำเป็นเพราะลิงก์ใน drawer ของ MHxView ชี้ `/labventure/login` (หน้า login ไม่มี Layout)
- ทดสอบ: หน้า login ผ่าน :443 กดแล้วไป MHxView จริง · ปุ่มใน Layout ยังไม่ได้ทดสอบ (agent login AD ไม่ได้)
- Deploy: แทน `DEPLOY_LabVenture\client\dist` (ไม่ต้อง restart) · backup `Fullscale_V2\_backup\LabVenture_before_mhxlink_3110\`
- เจอ (ไม่ได้แก้, มีมาก่อน): `GET :443/labventure/` (มี `/` ท้าย) → 302 กลับมาที่ตัวเองวนไม่จบ — route `MapGet("/labventure")` ใน BellBeast `Program.cs` ~บรรทัด 430 จับ path ที่มี `/` ท้ายด้วย · `/labventure/login`, `/labventure/dashboard` ปกติ

## B. แถบข่าว MHxView: [ ข้อความวิ่ง ← | ป้ายสถานะ ] (✅ deploy · ✅ หน้าจำลอง · ❌ หน้าจริง)
- ผู้ใช้ขอ: มุมขวาแสดงสถานการณ์ระบบผลิต + สถานะโรคระบาด · ตัววิ่งเริ่มจากขวา (ถัดจากป้ายสถานะ) ไปซ้าย ค่อย ๆ โผล่ออกมาจากความว่างเปล่า
- `wwwroot/js/MHxLiveFeed.js` (เขียนใหม่): JS สร้าง DOM ใน `#lvMarquee` เอง = `.lv-mq-view > .lv-mq-track` + `.lv-mq-status > .lv-chip ×2` · ข้อมูลจาก `/live` เดิม (`scenario.name`, `epidemic`) · สีป้ายจากชื่อ: วิกฤต/ฉุกเฉิน = `bad`, เฝ้าระวัง = `warn`, ปกติ = `ok`, อื่น = `info` · โรคระบาด ใช่ = `bad` / ไม่ใช่ = `off`
- การวิ่ง: track 1 ชุด (ไม่ใช่ 2 ชุดต่อกันแบบเดิม) animation `lv-mq-run` จาก `--lv-from` = ความกว้างช่อง → `--lv-to` = −ความกว้างข้อความ · duration = (กว้างช่อง+กว้างข้อความ)/70px·s · คำนวณใหม่ตอน resize · ขอบซ้าย/ขวาจางด้วย mask · hover หยุด
- CSS ใน `Pages/MHxViewer/MHxView.cshtml` (บล็อก "แถบข่าวจาก LabVenture" ก่อน `.bb-topbar .right`) — แทนบล็อกเดิมทั้งหมด (`lv-mq-scroll` ถูกลบ)
- Deploy: publish ไป `%TEMP%\claude\bb_publish_status` → สคริปต์ elevated (scratchpad `deploy_bb_status.ps1`, log `%TEMP%\claude\deploy_bb_status.log`) backup + หยุดเฉพาะ BellBeast + copy 6 ไฟล์ (dll/pdb/endpoints.json/MHxLiveFeed.js(.br/.gz)) + start BellBeast · backup `Fullscale_V2\_backup\BellBeast_proj_before_mqstatus_3110\` · (ไม่แตะ `appsettings.json` / `App_Data` — เหตุผลอยู่ใน Session 5 ข้างบน)
- วิธี restart เฉพาะ BellBeast นี้ใช้ UAC ครั้งเดียว ไม่กระทบ Uroboros/LabVenture — ใช้แทน STOP/START ทั้งชุดได้

## สถานะระบบตอนจบ session
- BellBeast รัน (pid 32756, start 13:52 โดยสคริปต์ deploy) · **Uroboros และ LabVenture ไม่รัน** → `/labventure/*` = 502, ป้ายสถานะ/ตัววิ่งบนหน้าจริงจึงว่าง
- ตอนสคริปต์ deploy รัน BellBeast ก็ไม่ได้รันอยู่แล้ว (ไม่มีบรรทัด `[stop]`) ทั้งที่ ~13:45 LabVenture+BellBeast ยังรัน → น่าจะมีคนสั่ง STOP ทั้งชุดในช่วงนั้น (ไม่ได้ยืนยัน) · ถามผู้ใช้แล้วว่าจะให้เปิด LabVenture+Uroboros ไหม — **ยังไม่ได้คำตอบ**
- ถ้าจะเปิดทั้งชุดด้วย `START_FULLSCALE_LOCALHOST.cmd` ขณะ BellBeast รันอยู่ → BellBeast ตัวที่ 2 จะชนพอร์ต 443 · ทางเลือก: STOP_FULLSCALE แล้ว START ใหม่ หรือเปิดเฉพาะ `Uroboros_proj\Uroboros.exe` + `DEPLOY_LabVenture\start.bat` (ดู env ที่ต้องตั้งใน `START_FULLSCALE_LOCALHOST.ps1`: `UROBOROS_HTTP_PREFIX`, `UROBOROS_AUTOSTART_*`, `LABVENTURE_AUTO_KEY`, `LABVENTURE_URL`, `LABVENTURE_HIDDEN`)

## ค้าง
- เปิด LabVenture/Uroboros (รอผู้ใช้) → ตรวจหน้าจริง: ป้ายสถานะขึ้น + ข้อความโผล่จากข้างป้ายวิ่งไปซ้าย
- ทดสอบปุ่ม "↩ MHxView" ในหน้าหลัง login
- ลองเปลี่ยนสถานการณ์จริง → ป้ายสถานะและหัวการ์ด LAB เปลี่ยนเองใน ~15 วิ
- commit — LabVenture: `client/src/utils/mhxView.js`(ใหม่), `components/Layout.jsx`, `pages/Login.jsx`, `pages/ConfigEditor.jsx`, `server/routes/scenarios.js`, `handoff/handoff3110.md` · BellBeast: `wwwroot/js/MHxLiveFeed.js`(ใหม่), `Pages/MHxViewer/MHxView.cshtml`
- (เลือกได้) แก้ redirect วนของ `:443/labventure/` ใน BellBeast `Program.cs`

## Suggested skills (session ถัดไป)
- `run` — เปิด MHxView ตรวจแถบข่าวหลัง LabVenture กลับมา
- `code-review` — diff ของไฟล์ในรายการ commit ข้างบน
- `handoff:handoff` — append ไฟล์นี้ตอนจบ session

---

# Session 5 (ต่อ 2, 31/10/2569) — superadmin ทำได้ทุก feature (ทำใน session แยก)

ทำใน session แยก "LabVenture: superadmin ทำได้ทุก feature" · **deploy แล้ว (ผู้ใช้สั่ง "Deploy เลย")** · ยังไม่ commit · **ยังไม่ได้ลองในแอปจริง** (LabVenture ไม่ได้รันอยู่ตอน deploy)
สรุปละเอียด/ตาราง "เดิมกันอะไร → แก้อย่างไร": `C:\Users\peera\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_8ab00ebf-e609-422b-84dd-857a662ea5bf\superadmin_all_access.md`

## แนวทาง
- **server** `server/services/actor.js`: `isSuperadminIdentity()` (รู้จาก bypass, ชื่อตาม `SUPERADMIN_NAME` หรือรหัสพนักงานของ superadmin) + `can(actor, SET)` → superadmin ผ่านเสมอ · `attachActor` ใส่ `req.actor.isSuperadmin`
  - ใช้ `can()` แทนการเช็ก `SCI_WRITE`/`OFFSET_WRITE` ตรง ๆ ใน routes: config, eventClass, scenarios, chemLab · `requireAdmin` (pm, testMode) ผ่านถ้า `isSuperadmin || isAdmin` · `auth.js /me`, `car.js`, `carAdmin.js` ใช้ helper เดียวกัน (เดิมกฎชื่อ/รหัสซ้ำหลายชุด)
- **client** `client/src/config/pageAccess.js`: `isSuperadmin(me)` + `hasRole(me, roles)` · `allowedPagesFor` → superadmin เปิดได้ทุกหน้า · `'superadmin'` ถูกเอาออกจาก role list ทุกจุด ให้ helper ตัดสินแทน (Layout, ChemIntake, ConfigEditor, OpRecord, Record)
- role อื่นได้สิทธิ์เท่าเดิม
- **จงใจไม่แก้:** test mode เปลี่ยนสถานการณ์ (`PUT /api/scenarios/:id/activate` + `test: true`) ยังเช็ก `isAdmin` ตามเดิม · การล็อกไม่ให้แก้/ลบ entry ของ superadmin ใน whitelist (`carAdmin` + ConfigEditor) คงไว้ เพราะเป็นการกันบัญชีถาวร · CARLog/ProjectPlan ไม่ต้องแก้ (อ่าน `isAdmin` ที่ superadmin ได้ true อยู่แล้ว)

## ตรวจแล้ว
- `npx vite build` ผ่าน · `require` 10 ไฟล์ (actor + routes 7 + pm, testMode) ผ่านทั้งใน repo และใน `DEPLOY_LabVenture\server` · ทดสอบ `can()` หลาย role ได้ตามคาด

## Deploy
- backup `Fullscale_V2\_backup\LabVenture_before_superadmin_3110\` (`actor.js`, routes 7 ไฟล์, `client/dist`)
- copy `server/services/actor.js` + `server/routes/{auth,car,carAdmin,config,eventClass,scenarios,chemLab}.js` + แทน `client/dist` · เช็กก่อน copy แล้วว่าไฟล์ server ฝั่ง deploy ต่างจาก repo เฉพาะงานนี้ (+ `scenarios.js` ของ Session 5 ที่ deploy ไปก่อนแล้ว)
- ⚠ `client/dist` ชุดนี้ build จาก repo ปัจจุบัน → รวมปุ่ม "↩ MHxView" (Session 5 ต่อ) ไว้แล้ว ถ้าจะ rollback dist ให้ระวังว่าจะหายไปด้วย
- ไฟล์ server มีผลหลัง LabVenture start ใหม่ (ตอนนี้ไม่ได้รันอยู่)

## ค้าง (รวมทั้ง session)
- **เปิด LabVenture + Uroboros** (ผู้ใช้ยังไม่ตอบ — ดู "สถานะระบบตอนจบ session" ด้านบน) → แล้วตรวจ:
  - login เป็น superadmin (ทั้งแบบชื่อ AD และ bypass) ลองเข้าทุกหน้า + ปุ่มบันทึกที่เคย disable (Config, ChemIntake แท็บทั้งหมด, Record/OpRecord, Event Class, PM)
  - login เป็น role อื่น (scientist/operator/observer) ยืนยันว่าสิทธิ์ไม่เพิ่ม
  - แถบข่าว + ป้ายสถานะใน MHxView, ปุ่ม "↩ MHxView" หลัง login
- commit — ไฟล์ superadmin: `server/services/actor.js` (untracked), routes 7 ไฟล์ข้างบน, `client/src/config/pageAccess.js`, `components/Layout.jsx`, `pages/{ChemIntake,ConfigEditor,OpRecord,Record}.jsx` (+ pm/testMode ถ้าแก้) · ⚠ หลายไฟล์มีงานเก่าที่ยังไม่ commit ปนอยู่มาก ต้องเลือก hunk หรือคุยกับผู้ใช้ว่าจะ commit รวม

## Suggested skills (session ถัดไป)
- `run` — เปิดแอปตรวจสิทธิ์ superadmin + role อื่นหลัง LabVenture กลับมา
- `code-review` / `security-review` — งานนี้แตะการตรวจสิทธิ์ทั้งระบบ ควร review ก่อน commit
- `handoff:handoff` — append ไฟล์นี้ตอนจบ session

> **อัปเดตท้ายวัน 31/10/2569:** ผู้ใช้แจ้งว่าทดสอบบนระบบจริงแล้ว "โอเคหมด" (แถบข่าว/ป้ายสถานะ MHxView, ปุ่ม ↩ MHxView, superadmin) — งานที่เหลือของ Session 5 ทั้งหมด = **commit** เท่านั้น
