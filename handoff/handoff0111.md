# Handoff 2026-11-01 — เกณฑ์ตามช่วงเวลา (scenario_periods) + Excel เดินขนาน (2.1 / 2.2)

> สถานะ: **ทำเสร็จ, deploy แล้ว, ผ่าน E2E ผ่านหน้าเว็บ — ยังไม่ commit** (working tree มีงานอื่นของผู้ใช้ที่ยังไม่ commit ปนอยู่ด้วย ระวังตอน commit)
> ตอบผู้ใช้เป็นภาษาไทยเสมอ

---

## 1. ปัญหาตั้งต้น (ทำไมต้องเปลี่ยน)

ผู้ใช้ถามว่าเปลี่ยนสถานการณ์ใน /config แล้ว Excel ที่พิมพ์ออกมาจะแสดงเกณฑ์ถูกตามสถานการณ์ไหม และให้ตรวจ conditional formatting (CF) ใน `server/templates/DailyLab_theme.xlsx`

สิ่งที่พบ:
1. **เกณฑ์ไม่ผูกกับเวลา** — `getControlValues()` (ลบไปแล้ว) อ่านสถานการณ์ที่ active "ตอนรัน" เสมอ → พิมพ์ย้อนหลังข้ามวันที่เปลี่ยนสถานการณ์ได้เกณฑ์ผิด, retry จาก `excel_queue` ใช้เกณฑ์ตอน retry, เปลี่ยนกลางวันแสดงได้ชุดเดียว, `scenario_log` เก็บแค่ข้อความ ไม่เก็บค่าเกณฑ์ → ย้อนดูไม่ได้
2. **เซลล์ว่าง = 0** — สถานการณ์ที่ไม่มีเกณฑ์บางตัว (เช่น `CW1.ResCl2` ไม่มีในทุกสถานการณ์ยกเว้นปกติ, `scenario_flood.json` ไม่มี `CW1.turb`) → Control Value ว่าง → CF `>$K$53` ทำให้ทั้งคอลัมน์ขึ้นแดง
3. **CF ใน template ผิดหลายจุด** — Cl₂ ของ FW อ้าง `$K$53` แทน `$K$54`; X32:X37 (CW2.ResCl2) ไม่มีกฎ; ช่วงกฎความขุ่น CW ขาดแถว 36/37/49; สูตร T7 ใช้เครื่องหมายคำพูดโค้ง `”>“`; ช่วงเตือนเขียนตัวเลขตาย (80–100, 2–4, 0.9–1); ป้าย `ResCl2 = 0.7 - 1.2` เก่า; T9–T11 นับไม่ครบ TW3–4
4. **ค้นพบภายหลัง:** openpyxl `copy_worksheet` **ไม่ copy CF** → ไฟล์พิมพ์ที่ export ออกมา "ไม่เคยมีสีเลย" ตั้งแต่แรก; CF มีผลเฉพาะไฟล์รายเดือนของระบบเดิม (Excel copy ชีทเอง). และ template มี **สีแดงทาตายตัว 9 ช่อง** (V35, C36, F36, P36, P37, S37, V37, C49, F49) = ช่องที่ CF ครอบไม่ถึง (มีคนทาปิดไว้) → ไฟล์พิมพ์ของเราพิมพ์แดงทั้งที่ค่าในเกณฑ์ (แก้แล้ว)

## 2. ข้อตกลงกับผู้ใช้ (design decisions + เหตุผล)

| # | การตัดสินใจ | เหตุผล |
|---|---|---|
| 1 | เลิก text log → ตารางมีโครงสร้าง `scenario_periods` + `scenario_period_thresholds` มีคอลัมน์ `rev`; `epidemic` เป็น true/false | ให้ query ค่าแลป + สถานการณ์ + เกณฑ์ ณ ช่วงเวลาได้จาก source เดียว (join ตามเวลา) |
| 1b | /config ยังเป็นที่แก้เกณฑ์ที่เดียว (ไฟล์ `scenario_*.json`, `app_settings.json`) — DB แค่ "จด" | ผู้ใช้ไม่ต้องการหน้าตั้งค่าซ้ำ |
| 1c | rev เพิ่มเมื่อค่าเกณฑ์เปลี่ยน ไม่แก้ทับ rev เดิม | เกณฑ์ไม่เคยเปลี่ยนใน 10 ปี แต่ต้องรองรับ; rev ช่วยแก้ปัญหาข้อ 2 ไปในตัว |
| 2 | **ช่วงเดินขนาน**: 2.1 ไฟล์ปลายทาง (ของระบบเดิม) เขียน **เฉพาะข้อมูล lab** ไม่แตะ style/CF/Control Value; 2.2 ไฟล์พิมพ์ของเราจาก `DailyLab_theme.xlsx` ลงสี/เกณฑ์เอง | ระบบใหม่ยังไม่แทนที่ระบบเดิม ถ้าเขียนทับ style/เกณฑ์ ไฟล์ของคนที่ยังใช้ระบบเดิมพัง. อนาคตจะย้าย 2.2 ไปแทน 2.1 |
| 2b | ไฟล์ปลายทางไม่มี → **ไม่สร้างเอง**, เข้าคิวรอ (ไม่นับ attempt จน dead); ไม่มีชีทวัน → error (ไม่ copy theme) | ผู้ใช้สร้างไฟล์เดือนเองและมีครบทุกวันเสมอ |
| 3 | เลิก CF ในไฟล์พิมพ์ → สคริปต์ลงสีเอง | CF ถูกคน overwrite จนไม่เป็นมาตรฐาน; สคริปต์ใช้เกณฑ์ ณ เวลาของแต่ละรอบได้ (CF ทำไม่ได้) |
| 3b | ความหมายสี = **แบบหน้าเว็บ**: น้ำเงิน = เกินครั้งแรก, แดง = เกินต่อเนื่อง (นับข้ามวัน ย้อน 7 วัน) | ให้เหมือนกันทั้งระบบ |
| 4 | หมายเหตุ B77–B79 ขึ้นต้นด้วยการเปลี่ยนเกณฑ์ก่อนเสมอ: `*HH:MM <เหตุการณ์>: <note>` (เกิน 3 → `(+อีก N รายการ)`) | ผู้ใช้กำหนด |
| 5 | Control Value บนหัวชีท = เกณฑ์ ณ สิ้นวัน; ไม่มีเกณฑ์ → `-` | ชีทแสดงได้ชุดเดียว ส่วนที่เปลี่ยนกลางวันอธิบายในหมายเหตุ |

ความจำถาวร: `~/.claude/projects/C--Users-peera-OneDrive-Desktop-LabVenture/memory/project_parallel_run_excel.md`

## 3. Architecture (ไฟล์ที่แตะ — อ่านโค้ดจริงแทนการอธิบายซ้ำ)

**ใหม่**
- `server/services/scenarioHistory.js` — หัวใจ: `syncNow()` (ทำให้ช่วงปัจจุบันใน DB ตรงกับ config; เหตุผล `init|scenario|thresholds|epidemic|epidemic_thresholds`), `initScenarioHistory()` (ย้ายจาก `scenario_log` ครั้งแรก → `source='migrated'`, ค่าเกณฑ์เดิมไม่มีจึงใช้ไฟล์ปัจจุบัน), `thresholdsAt(date, slot)`, `makeResolver()`, `periodsOnDate()`, `listPeriods()`. `scenario_id = 0` = ชุดเกณฑ์โรคระบาด. `maybeSync()` ตรวจไฟล์ทุก ≤30 วิ (จับการแก้ JSON ตรงๆ). เวลาของรอบ: `HH:MM` = เวลานั้น, `daily/weekly` = สิ้นวัน
- `server/services/dailyLabMarkup.js` — คำนวณทุกอย่างที่ขึ้นกับเกณฑ์ของไฟล์พิมพ์ (cells: Control Value/ตัวเลขนับ/หมายเหตุ, fonts: first/repeat) — แยกจากตัวเขียนไฟล์ เพื่อย้ายไปใช้กับไฟล์ปลายทางได้ในอนาคต
- `server/config/excel_breach_counts.json` — เซลล์นับ (T3–T11, AF52–AQ55) → พารามิเตอร์ (นับครบ TW1–4)
- `server/scripts/test_scenario_history.js` — unit/integration test บน DB สำเนา (12/12)
- `server/scripts/clean_dailylab_theme.py` — ล้าง template (ยัง **ไม่ได้รัน** — ดูข้อ 6)

**แก้**
- `server/services/db.js` — DDL 2 ตารางใหม่ (`scenario_log` คงไว้อ่านอย่างเดียว ไม่เขียนแล้ว)
- `server/services/scenario.js` — export `applyEpidemic`, `breachMarks()` (ฟังก์ชันกลางตัดสิน first/repeat), `streaksBefore()` ใช้เกณฑ์ ณ เวลา; ลบ `getControlValues()`
- `server/routes/scenarios.js` — activate/epidemic/epidemic-thresholds/PUT → `syncNow`; `/log` อ่านจาก periods; ใหม่ `GET /api/scenarios/at?date&slot`; `PATCH /epidemic` ต้อง login แล้ว (attachActor)
- `server/routes/config.js` (PUT scenario file → syncNow), `server/routes/testMode.js` (recent_log จาก periods), `server/index.js` (เรียก `initScenarioHistory()` หลัง `initDb()`)
- `server/routes/write.js` export — ดึงค่าย้อน 7 วันเพื่อนับต่อเนื่อง, ส่ง markup ไป `buildDailyLab`
- `server/services/excelWriter.js` — `writeToExcel` ไม่ส่งเกณฑ์; `buildDailyLab(dates, records, recorders, cells, fonts)`
- `server/services/queueWorker.js` — error "ยังไม่มีไฟล์ปลายทาง" ไม่นับ attempt
- `server/excel_writer.py` — xlwings: ไม่เขียน controls/labels, ไม่สร้างชีท; ไม่มีไฟล์ปลายทาง → error; ลบ `push_to_dest`; `build_export(cells, fonts)` ลงสี, ล้างสีแดง/น้ำเงินตายตัวในช่องข้อมูล (`_DATA_CELLS`), ล้างชื่อค้าง (`_RECORDER_CELLS`), ป้าย D74/N74/W74, หมายเหตุ shrink-to-fit
- Client: `pages/Record.jsx` (เกณฑ์จาก `/api/scenarios/at`, queryKey `['active-scenario','at',date,slot]`), `pages/ConfigEditor.jsx` (แสดง reason/rev ในประวัติ), `components/ScenarioThresholdModal.jsx` (invalidate `scenario-log`)
- `server/scripts/e2e_excel_test.js` — ปรับตามกติกา 2.1 (สร้างไฟล์ปลายทางล่วงหน้า, ตรวจ Control Value ไม่ถูกทับ, ไฟล์หายเข้าคิว)

## 4. การทดสอบ

| ชุด | ผล | หมายเหตุ |
|---|---|---|
| `node server/scripts/test_scenario_history.js` | 12/12 | migrate, เกณฑ์ ณ เวลา (เปลี่ยน 11:00 กลางวัน), streak ข้ามวัน, สี/นับ/Control/หมายเหตุ, xlsx จริง, ล้างสีตายตัว |
| `node server/scripts/e2e_excel_test.js` | 19/22 (ก่อนแก้ 1b) | 1b แก้เงื่อนไขแล้วแต่ **ยังไม่ได้รันซ้ำ**. 1d (progress RW OC ไม่มี 21:00) และ 3a (`RW.TSS` เป็น daily แต่ cell map มีแค่ `05:00` → หายจากไฟล์พิมพ์) = **ปัญหาเดิม** จาก config ที่ยังไม่ commit ไม่เกี่ยวกับงานนี้ |
| E2E ผ่านหน้าเว็บ (Claude in Chrome) บน deploy | ผ่าน | ดูข้อ 5 |

## 5. Deploy + E2E ผ่านหน้าเว็บ (ทำแล้ว)

- Deploy ไป `C:\Users\peera\OneDrive\Desktop\Fullscale_V2\DEPLOY_LabVenture` โดย **copy เฉพาะไฟล์ในข้อ 3** + `client/dist` ใหม่ + template (source ต่างจาก deploy แค่ผู้ใช้ลบ `-` ที่ X32:X37). **ไม่ทับ** `algae_exporter.py`, `routes/algae.js` (ใน deploy ใหม่กว่า source — มีคนแก้ deploy ตรง), `scenarios/*.json`, `app_settings.json`, `.env`, DB. สำรองเดิมที่ `Fullscale_V2\_backup\LabVenture_20261101_135130`
- `paths.json` ของ deploy ชี้ `C:\Users\peera\OneDrive\Desktop` อยู่แล้ว; ไฟล์ `11DailyLab_Nov69.xlsx` มีชีท 1–30
- รันแบบปลอดภัย (ผู้ใช้เลือก "Offline + ค่าในเกณฑ์"): env override เฉพาะ process → AquaDAT/LINE/BellBeast ชี้ `127.0.0.1:9`; ไม่เปิด Uroboros (ไม่มี CAR/LINE); login Super Admin offline (Ctrl+Shift+F12); proxy ชั่วคราว `scratchpad/lv_proxy.js` :8890 แทน BellBeast (production client เรียก `/labventure/api/*` ซึ่งต้องผ่าน proxy)
- กรอกผ่านฟอร์มจริง (ตั้งค่าช่อง `input[data-param]` + กดปุ่ม "บันทึก") ทุกรอบ 01:00–23:00 + รายวัน ของ 2026-11-01 (ไม่รวมรายสัปดาห์) = 476 ค่า
- ผล: 468 ค่าที่มีช่องในฟอร์มตรง DB ทุกช่องในชีท "1"; excel_queue ว่าง; snapshot ก่อน/หลังบันทึกซ้ำ → CF, Control Value, ป้าย, style **ไม่เปลี่ยน** (ยืนยัน 2.1); ไฟล์พิมพ์ถูกต้อง (หลังแก้สีตายตัว) → `LabVenture/DailyLab_print_2569-11-01_e2e.xlsx`
- ลบ aquadat_queue ทดสอบ 13 รายการแล้ว (หยุด server ก่อนลบ)
- migration บน DB deploy: ย้าย 4 ช่วงจาก `scenario_log` สำเร็จ

## 6. ค้าง / สิ่งที่ session ต่อไปควรรู้

1. **ยังไม่ commit** — git status มีไฟล์ของผู้ใช้ปนเยอะ; commit เฉพาะไฟล์ข้อ 3 เมื่อผู้ใช้สั่ง (แบ่ง branch ก่อนถ้าอยู่ master)
2. **process ทดสอบยังรันอยู่**: LabVenture :8889 (env ปลอดภัย) และ proxy :8890. ต้องปิด (`stop.bat` ใน DEPLOY_LabVenture ฆ่า node ทุกตัว) ก่อน START_FULLSCALE จริง
3. **ข้อมูลทดสอบ 2026-11-01** ยังอยู่ใน DB deploy และชีท 1 ของ `11DailyLab_Nov69.xlsx` (ผู้ใช้ยังไม่สั่งลบ) — ผู้บันทึกกะ 08–16 เป็น "Super / นว."
4. **`clean_dailylab_theme.py` ยังไม่ได้รัน** (ตอนนั้นผู้ใช้เปิด template ใน Excel) — ไม่จำเป็นต่อการทำงาน (export จัดการตอน runtime แล้ว) แต่ทำให้ template สะอาด; ต้องปิดไฟล์ก่อน, สคริปต์สำรองให้เอง
5. ไฟล์ของผู้ใช้เองมีความต่างระหว่างชีทอยู่แล้ว (ชีท 1 และ 15–29 H53=5/K53=0.3, อื่นๆ 3/0.5; CF ชีท 1 ไม่เหมือนชีทอื่น) — ไม่ใช่จากระบบเรา (พิสูจน์ด้วย snapshot)
6. ไม่มีช่องในฟอร์ม: `TW1/TW2.Langelier` (09:00, 21:00), `JarTest.*.RecommendDose1/2` — ถ้าต้องการต้องเพิ่ม `excel_cell_map.json`
7. ปัญหาเดิม e2e 1d/3a (ข้อ 4) — เสนอผู้ใช้ก่อนแก้
8. การเปลี่ยนจาก test mode ถูกนับเป็นช่วงจริง (note มี `[TEST]`) → โผล่ในหมายเหตุไฟล์พิมพ์ถ้าทดสอบในวันทำงาน; CAR อัตโนมัติยังใช้เกณฑ์ปัจจุบัน (real-time) — ยังไม่ได้ตัดสินใจเปลี่ยน
9. เครื่อง deploy ตั้งปฏิทิน พ.ศ. — เวลาใช้ `nowTH()`/ISO เสมอ (เก็บ `started_at` รูปแบบ `YYYY-MM-DDTHH:MM:SS.mmm+07:00`, เทียบเป็น string)
10. อนาคต: ย้าย 2.2 → 2.1 (ให้ไฟล์ปลายทางใช้ markup ของเรา) — ฟังก์ชัน `dailyLabMarkup` + `breachMarks` เตรียมไว้แล้ว ต้องเพิ่ม "คืนสีปกติ" ให้ช่องที่ไม่เกินด้วยเมื่อเขียนลงไฟล์ที่มีอยู่แล้ว

## 7. Suggested skills

- `anthropic-skills:xlsx` — ตรวจ/แก้ `DailyLab_theme.xlsx` หรือไฟล์เดือน (CF, สี, cell map)
- `code-review` — ก่อน commit ชุดนี้ (ไฟล์ในข้อ 3)
- `scrutinize` — ถ้าจะออกแบบขั้น "ย้าย 2.2 → 2.1"
- `run` — เปิดแอปตรวจหน้า /record, /config หลังแก้
- Claude in Chrome tools (`mcp__claude-in-chrome__*`) — E2E ผ่านหน้าเว็บซ้ำ (วิธีในข้อ 5)
