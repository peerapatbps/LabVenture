# Handoff 27/10/2569 (2026-10-27)

ต่อจาก `handoff/handoff2610.md` (งาน A/B/C — อ่านก่อน โดยเฉพาะ "ข้อสังเกตสำคัญ" เรื่อง deploy/restart/mock) — งานค้างในนั้นยังค้างทั้งหมด (ยังไม่ commit อะไรเลย)

## D. Chem-lab: ชื่อห้องปฏิบัติการ / ที่เก็บเอกสาร เป็น dropdown + ปุ่ม "+" (session นี้)
ผู้ใช้ขอ: popup "ส่งขวดผสมใบที่ X ไปห้องปฏิบัติการภายนอก" และฟอร์มกรอกผลในแท็บ Lab ภายนอก — ช่องห้องปฏิบัติการ + ที่เก็บเอกสาร ให้เป็น dropdown มีปุ่ม + เพิ่มชื่อ แทนการพิมพ์
- Server `server/routes/chemLab.js`: `GET /api/chem-lab/options` (ก่อน guard) · `POST /api/chem-lab/options/:kind` (`labs` | `doc_locations`, หลัง guard = SCI_WRITE, body `{name}`, ไม่ซ้ำ, ≤200 ตัว) — เก็บใน `server/config/lab_ext_options.json` (สร้างเองตอนเพิ่มครั้งแรก, ทำงานเหมือนกันทั้ง mock/จริง ไม่ผ่าน Uroboros)
- Client: `OptionPicker` ใน `client/src/pages/chemlab/shared.jsx` (queryKey `['chem-lab','options']`; ค่าเก่าที่ไม่อยู่ใน list ยังแสดง) ใช้ใน `AnalysisTab.jsx` → `SendExtModal` + `AttemptForm` (โหมด external)
- ยังไม่มี: ลบ/แก้ชื่อในรายการ (ผู้ใช้ยังไม่ได้ขอ), ไม่ได้อัปเดต `handoff/chem_lab_backend_spec.md` สำหรับ endpoint ใหม่
- ทดสอบ: browser mock (:3002/:5174) — เพิ่มชื่อ → ถูกเลือก + คงอยู่หลังเปิด popup ใหม่, บันทึกส่ง Lab ได้, ฟอร์มกรอกผล prefill ชื่อ Lab, + ที่เก็บเอกสารใช้ได้ · คืน `services.json` mock:false และลบ `lab_ext_options.json` ทดสอบแล้ว

### Deploy — ⚠ ยังไม่ครบ
- build `index-GkvQdmf0.js` → copy `client/dist` + `server/routes/chemLab.js` ไป `Fullscale_V2\DEPLOY_LabVenture` แล้ว (:8889 เสิร์ฟ bundle ใหม่แล้ว)
- **restart LabVenture ยังไม่ได้ทำ** — auto mode ปฏิเสธการรัน elevated script → server เก่ายังไม่มี route `/options` → dropdown ว่าง/ปุ่ม + ใช้ไม่ได้ = **ส่ง Lab ภายนอกบนเครื่องจริงใช้ไม่ได้จนกว่าจะ restart**
- ให้ผู้ใช้ restart เอง: ดับเบิลคลิก `DEPLOY_LabVenture\start.bat` (UAC) หรือรัน elevated `restart_labventure.ps1` (อยู่ใน scratchpad session 6c21a53d — ถ้าหายให้เขียนใหม่ตาม "ข้อสังเกตสำคัญ" ใน handoff2610)
- หลัง restart ตรวจ: `/api/chem-lab/options` ต้องตอบ `{ok,labs,doc_locations}` (ต้อง login; `POST /api/auth/bypass` บน :8889 ตอบ 403 — ทดสอบผ่าน browser :443 แทน)
- Rollback: `Fullscale_V2\_backup\LabVenture_before_ext_options_2710` (dist `rFFcYuCw` + chemLab.js เดิม)

## ⚠ Disk C: เต็ม
ตอน build เจอ ENOSPC (ว่าง 0 GB) → ล้าง npm cache (ผู้ใช้อนุญาต) เหลือว่าง ~3.6 GB เท่านั้น — เสี่ยงต่อ db ที่ระบบจริงเขียนอยู่ ก้อนใหญ่ที่เห็น: `%USERPROFILE%\.nuget\packages` 6.7 GB (ยังไม่ได้ไล่ทั้งเครื่อง) — แจ้ง/ถามผู้ใช้ก่อนลบอะไร

## งานถัดไป
1. ยืนยันว่าผู้ใช้ restart แล้ว → ตรวจ dropdown บน :443
2. เรื่องพื้นที่ดิสก์
3. งานค้างจาก handoff2610 (ทดสอบ chem-intake/Record บน :443, commit แยก Record / chem-intake (รวมงาน D) — ถามก่อน, `progress.js`, spec §7)

## Suggested skills
- `run` — เปิด preview mock ทดสอบ (`.claude/launch.json`: "LabVenture Server (temp db 3002)" + "LabVenture Client (verify 5174)"; ต้องตั้ง `services.json chem_lab.mock=true` + mock db ชั่วคราว แล้วคืนทุกครั้ง)
- `code-review` — ก่อน commit chem-intake (B+C+D)
- ตอบเป็นภาษาไทยตาม memory

---

# Session ที่ 2 ของวันที่ 27/10 — เกณฑ์สถานการณ์ → Event Class → alarm → ทุกหน้า (E–G)

แยกจากงาน D ด้านบน · **deploy ขึ้น `Fullscale_V2` ครบแล้วทั้งหมด** แต่ **ยังไม่ commit** (ทั้ง LabVenture และ BellBeast) · แผนตั้งต้น: `C:\Users\peera\.claude\plans\1-splendid-bee.md`

## หลักการที่ตกลงกับผู้ใช้
- **ต้นฉบับเกณฑ์ = `/config → สถานการณ์`** (LCL/UCL ต่อพารามิเตอร์ ต่อสถานการณ์) เก็บใน `server/scenarios/scenario_*.json` เหมือนเดิม (`min` = LCL, `max` = UCL) — ผู้ใช้เลือกเก็บ JSON ไม่ใช่ DB
- **Event Class = setpoint ของ alarm** อ้างอิงเกณฑ์ (ไม่ตั้งตัวเลขซ้ำต่อสถานการณ์) ระดับ L2/L1/H1/H2 แต่ละระดับเลือกวิธีคำนวณเองได้
- **สีแสดงผลทุกหน้าใช้ UCL/LCL เท่านั้น** (ไม่ใช้ H1/L1): เกินครั้งแรก = น้ำเงิน · เกินติดกันครั้งที่ 2+ = แดง · ตัวอย่างถัดไปเข้าเกณฑ์ = reset · รอบที่ไม่มีค่าข้าม ไม่ reset

## E. แก้เกณฑ์ใน /config + Event Class แบบอ้างอิงเกณฑ์ (LabVenture)
- `/config` แท็บสถานการณ์: ปุ่ม "ตั้งค่าเกณฑ์" ต่อสถานการณ์ → `client/src/components/ScenarioThresholdModal.jsx` (คัดลอกจากสถานการณ์อื่นได้) · บันทึกผ่าน `PUT /api/config/scenarios/files/:filename` (`server/routes/config.js` — เพิ่ม `attachActor`+`SCI_WRITE`, ตรวจด้วย `validateThresholds()`, เขียน tmp→rename, จัดรูปแบบ 1 แถว/บรรทัด)
- `GET /api/scenarios/thresholds` = เกณฑ์ทุกสถานการณ์ (`allScenarioThresholds()` ใน `server/services/scenario.js`)
- Event Class: `rule.ref = {bound:'UCL'|'LCL', mode:'eq'|'pct'|'offset'|'abs', amount}` + คอลัมน์ใหม่ `event_classes.param_key` (migration ใน `db.js`)
  - `GET /api/eventclass?enabled=true` (ที่ Uroboros ดึง) → `resolveItem()` แปลงเป็น `rule.value` ตามสถานการณ์ active (รวม epidemic) และตัด `ref` ออก · สถานการณ์ไม่มี bound นั้น → ไม่ส่งคลาสนั้น → **Uroboros ไม่ต้องแก้**
  - `GET /api/eventclass` (หน้าแก้ไข) เพิ่ม `resolved: {scenario_id: value}`
  - `POST /api/eventclass/levels` สร้าง/แก้/ลบชุด L2–H2 ของพารามิเตอร์เดียว (all-or-nothing, id `<param_slug>_l2|l1|h1|h2`) · `DELETE /api/eventclass/:id` + ปุ่ม "ลบ" ในหน้าแก้ไข
  - ลบปุ่ม/endpoint "นำเข้าจาก scenario" แบบเดิม (ที่คัดลอกตัวเลข)
  - UI: `client/src/pages/EventClass.jsx` → `LevelsModal` ("ตั้ง alarm จากเกณฑ์") พร้อมตารางพรีวิวค่าในทุกสถานการณ์
- **ข้อมูลจริงตอนนี้:** แปลง `normal_*` เก่า 26 รายการ → 52 คลาสแบบอ้างอิงเกณฑ์ (22 พารามิเตอร์; H2=UCL/L2=LCL critical, H1=90% UCL/L1=110% LCL warning; สร้างเฉพาะด้านที่มีเกณฑ์ในบางสถานการณ์) **ทั้งหมดเป็นฉบับร่าง (ปิด)** — ผู้ใช้ต้องเลือกเปิดเอง · ตรวจแล้วเปิดได้ทุกรายการ
- จุดที่ยังไม่มี alarm (ไม่อยู่ใน 26 เดิม): CW tank A/B, FW1–4 ResCl2, TW1–4 pH

## F. คลิปเสียง (BellBeast `/Admin/AudioLibrary`)
- ปุ่ม **"TTS ทั้งหมดที่ขาด"** — รวมรายการขาดจาก LabVenture (`/labventure/api/eventclass/clips-needed`, same-origin ผ่าน proxy) แล้ว TTS ทีละคลิป · แก้บั๊กปุ่มค้างหลัง TTS รายแถว + ความยาวแสดง `NaNs` (response ใช้ `durationMs`)
  - ไฟล์: `BellBeast/Pages/Admin/AudioLibrary.cshtml`, `BellBeast/wwwroot/js/audiolibrary.js` (repo `C:\Users\peera\OneDrive\Desktop\BellBeast`)
- สร้างคลิปแล้ว 24 คลิป (`s_lab_*`, `s_ntu`, `s_mgl`) → BellBeast มี 73 คลิป, missing 0 · `s_lab_tw1_turb` สร้างใหม่ครั้งหนึ่ง (รอบแรกยาว 14.4 s ผิดปกติ)
- ⚠ ก่อนผมเข้าไป มีคนกด TTS ใหม่ให้ `p_muen` (→ v2) — แจ้งผู้ใช้ให้ฟังตรวจแล้ว ยังไม่รู้ผล

## G. เกณฑ์ชุดเดียวกับ /record, Dashboard, MHxView (สีน้ำเงิน/แดง)
- LabVenture server (`services/scenario.js` + `routes/scenarios.js`): `isBreach()`, `GET /api/scenarios/limits` (เกณฑ์ active + `configparam_id`, ไม่ต้อง login), `GET /api/scenarios/streaks?date&slot` (นับเกินติดกันก่อนรอบนั้นจาก `node_records` ย้อน ≤7 วัน)
- `/record` (`client/src/pages/Record.jsx`): ช่องน้ำเงิน "เกินครั้งที่ 1" / แดง "เกินต่อเนื่อง N ครั้ง" / ป้าย "รอบก่อนเกินเกณฑ์"
- Dashboard + OpDashboard: `client/src/config/chartConfig.js` เลิกใช้ตัวเลขตายตัว → `getThreshold(filter, scenario.thresholds, cardIndex)` ต่อเฟส · `MiniChart.jsx` รองรับ `type:'min'` และข้ามค่า null ตอนนับ
- MHxView การ์ด LAB: `BellBeast/wwwroot/js/LABview.js` (ตัวที่ใช้จริง — script ที่ฝังใน `_BlockLAB.cshtml` อยู่หลัง `</section>` จึงไม่ทำงาน) ดึง `/labventure/api/scenarios/limits` ทุก tick, เกณฑ์ต่อ `configparam_id`, จุดสถานะใช้ประวัติจาก zone4 ของ 4 กลุ่ม (POST `/api/lab/summary` เพิ่ม 3 ครั้ง/tick), เส้นประ UCL/LCL, หัวการ์ด "เกณฑ์: <สถานการณ์>" · ติดต่อ LabVenture ไม่ได้ → ใช้ `getStatusRules()` เดิมเป็นสำรอง (หัวการ์ดสีเหลือง) · CSS `.status-dot.first/.none`, `.ov-status.first` ใน `_BlockLAB.cshtml`
- ตรวจบนเครื่องจริงแล้ว: หัวการ์ด "เกณฑ์: ปกติ", CW Turbid #4 แถบน้ำเงิน→แดง→น้ำเงินถูกต้อง · **จุดสถานะ 16 จุดเป็นสีดำ** เพราะ Uroboros `data.db` มีผลแล็บถึง 15 ต.ค. เท่านั้น (zone3 ดูเฉพาะรอบล่าสุด — พฤติกรรมเดิม)
- ข้อจำกัด: /record นับเฉพาะค่าที่บันทึกผ่าน LabVenture (กรอกตรงใน AquaDAT ไม่ถูกนับ) · CAR prompt หลังบันทึกยังขึ้นทุกครั้งที่เกิน (รวมน้ำเงิน) — ไม่ได้เปลี่ยน

## Deploy / rollback (Fullscale_V2)
- Backup ทั้งหมดใน `C:\Users\peera\OneDrive\Desktop\Fullscale_V2\_backup\`: `LabVenture_before_scenario_alarm_2710` (มี db ก่อน migration) · `LabVenture_before_ec_convert_2710` (db ก่อนแปลง 26→52) · `LabVenture_before_limits_2710` · `BellBeast_proj_before_ttsall_2710` · `BellBeast_proj_before_ttsfix_2710` · `BellBeast_proj_before_limits_2710`
- วิธีที่ใช้ได้ผล (auto mode อนุญาต, ผู้ใช้กด UAC):
  - LabVenture: copy ไฟล์ที่เปลี่ยน + `client/dist` → `Start-Process cmd.exe -ArgumentList "/c set LABVENTURE_HIDDEN=1&& `"<full path>\start.bat`"" -Verb RunAs -WindowStyle Hidden` (**ต้องใส่ path เต็ม** — cmd ที่ elevate เริ่มใน System32) · start.bat kill ตัวเก่าบน :8889 เอง
  - BellBeast: `dotnet publish -c Release` ลง scratch → หยุด process ด้วย `Start-Process powershell -Verb RunAs ... Stop-Process -Id <pid>` → tar copy **ยกเว้น `App_Data`, `appsettings*.json`** → `Start-Process BellBeast.exe -WorkingDirectory BellBeast_proj -Verb RunAs -WindowStyle Hidden`
  - BellBeast เสิร์ฟ static (js/cshtml) จากตอน build → แก้ JS อย่างเดียวก็ต้อง publish + restart
- ก่อน deploy ทุกครั้งเทียบ deploy กับ repo (`diff --strip-trailing-cr`) ว่าต่างแค่งานของเรา — `routes/progress.js` และ `config/{aquadat_configs,excel_cell_map,params}.json` ใน deploy ต่างจาก repo อยู่แล้ว **อย่า copy ทับ**

## ข้อสังเกตสำคัญ
- BellBeast :443 proxy ตัด `/labventure` ออกก่อนส่งต่อ → `/labventure/api/...` บน :443 = `/api/...` บน :8889
- ทดสอบ LabVenture ด้วย DB สำเนา: เพิ่ม config ใน `.claude/launch.json` ตั้ง `PORT=3002` + `LV_DB_PATH=<scratch copy>` (ลบออกหลังใช้ — ตอนนี้ลบแล้ว) · login ทดสอบ = cookie `aquadat_token` แบบ bypass (payload `bypass:true, role:scientist`)
- ⚠ ระหว่างทดสอบเคยเรียก `PATCH /api/scenarios/epidemic {epidemic:false}` ใส่ `app_settings.json` **ตัวจริงของ repo** (ไม่ใช่ deploy) — ค่าตรงกับ HEAD แต่ยืนยันไม่ได้ว่าก่อนหน้าเป็น false; บอกผู้ใช้แล้ว
- `scenario_normal.json` ใน repo มี diff ของผู้ใช้ค้างอยู่ก่อน (4 บรรทัด) — ไม่ใช่ของเรา

## งานถัดไป (ถามผู้ใช้)
1. **commit** — LabVenture (E+G, แยกจากงาน D/Record/chem-intake ที่ค้างตาม handoff2610) และ BellBeast (F+G) — ถามก่อน
2. ผู้ใช้เปิดใช้ alarm ที่ต้องการในหน้า Event Class → ตรวจว่า Uroboros ได้รับ (`GET /api/eventclass?enabled=true`)
3. ตรวจ /record บน :443 จริง (ทดสอบแล้วเฉพาะ :5174/:3002)
4. อาจเปลี่ยน CAR prompt ใน /record ให้ขึ้นเฉพาะแดง? (ยังไม่ได้ถาม)
5. ระบบไม่มี UI ลบ/แก้ไฟล์ scenario (มีแค่ endpoint DELETE เดิมใน config.js ที่ไม่ได้ใช้)

## Suggested skills
- `code-review` — ก่อน commit (ไฟล์หลัก: `server/services/{scenario,eventClass}.js`, `server/routes/{config,scenarios,eventClass}.js`, `client/src/pages/{EventClass,Record}.jsx`, `client/src/components/ScenarioThresholdModal.jsx`, BellBeast `wwwroot/js/LABview.js`)
- `run` — ทดสอบบน :3002/:5174 ด้วย DB สำเนา
- ตอบเป็นภาษาไทยตาม memory

---

# Session ที่ 3 ของวันที่ 27/10 — Q&A: การเปลี่ยน scenario / fallback / error ใน Uroboros (ไม่ได้แก้โค้ด)

## 1. การเปลี่ยน scenario ไหลไปถึง BellBeast อย่างไร
1. LabVenture `/config` → สถานการณ์ → เปิดใช้ (`PUT /api/scenarios/:id/activate`) หรือสลับโหมดโรคระบาด (`PATCH /api/scenarios/epidemic` → `app_settings.json`) → ตาราง `scenarios.active`
2. `GET /api/scenarios/limits` (`server/routes/scenarios.js:38` → `activeLimits()` ใน `services/scenario.js`) อ่านสถานการณ์ active + `scenario_*.json` ใหม่ทุก request — ไม่มี cache, ไม่ต้อง restart
3. BellBeast :443 ตัด `/labventure` → `localhost:443/labventure/api/scenarios/limits` = `/api/scenarios/limits` บน :8889
4. `BellBeast/wwwroot/js/LABview.js` `tick()` เรียก `fetchLimits()` พร้อม `/api/lab/summary` **ทุกรอบ refresh** → เปลี่ยนสถานการณ์แล้วเห็นผลรอบถัดไป (หัวการ์ด "เกณฑ์: <ชื่อ>")
- Alarm ของ Uroboros ตามด้วย: Uroboros ดึง `GET /api/eventclass?enabled=true` ซึ่ง `resolveItem()` คำนวณ `rule.value` จากสถานการณ์ active ณ ตอนนั้น

## 2. LabVenture ล่ม (limits → 502) แต่การ์ดยังมีเกณฑ์ = fallback ตามที่ออกแบบ
- `fetchLimits()` catch → `limits = null` → `ruleForCfg()` ใช้ `getStatusRules(mode)` (ตัวเลขตายตัวใน `LABview.js`: normal CW T≤5, CW CL≤0.3, FW/TW T≤1, TW CL 1.0–1.4 · emergency CW T≤3, CW CL≤0.5) → หัวการ์ดเหลือง "เกณฑ์สำรอง (ติดต่อ LabVenture ไม่ได้)"
- ⚠ fallback มีแค่ 2 ชุดตาม Status Mode ของการ์ด และ**ไม่ sync กับ `/config`** — ถ้าแก้เกณฑ์ไปแล้ว ช่วง LabVenture ล่มสีจะอิงตัวเลขเก่า (ถ้าต้องการ: cache limits ล่าสุดไว้ใน localStorage แทน — ยังไม่ได้ทำ/ยังไม่ได้ถาม)

## 3. Error ใน Uroboros `HttpListenerException (64): The specified network name is no longer available` — ไม่เกี่ยวกับ LabVenture
- stack: `LabSummaryModule.WriteJsonAsync` (`Uroboros/LabSummaryModule.cs:525`) ← `HandlePostAsync:51` ← `Program.cs:3073`
- ความหมาย: ผู้เรียกตัดการเชื่อมต่อก่อน Uroboros เขียนคำตอบเสร็จ
- เส้นทาง: browser → BellBeast `POST /api/lab/summary` (`BellBeast/Program.cs:1427-1434`) → `SummaryProxyService.PostLabSummaryAsync` → Uroboros :8888 — **ไม่ผ่าน LabVenture**
- สาเหตุ: BellBeast ส่ง `ctx.RequestAborted` ต่อไปยัง Uroboros → browser ยกเลิก (refresh/ปิดแท็บ/เปลี่ยนหน้า) → BellBeast ตัดสาย upstream → Uroboros เขียนไม่ได้ · ตอนนี้ 1 tick ยิง lab/summary 4 ครั้งพร้อมกัน (หลัก + ประวัติจุดสถานะ 3 กลุ่ม จากงาน G) → refresh ระหว่างโหลดเจอได้หลายบรรทัด
- ผลกระทบ: ไม่มี — `WebListener.HandleAsync` จับไว้ พิมพ์ `[HTTP] handler error` แล้วทำงานต่อ
- ถ้าอยากเงียบ log: ใน `WriteJsonAsync` จับ `HttpListenerException` (client disconnect) แล้วไม่พิมพ์ stack → ต้อง build + restart Uroboros (ยังไม่ได้ทำ)
- (ข้อสังเกตข้างเคียง: `PostLabSummaryAsync` ตั้ง `_http.Timeout = 120s` บน HttpClient ที่ใช้ร่วมกันทุกครั้ง — ไม่ใช่สาเหตุ แต่แก้ Timeout หลังส่ง request แรกแล้วอาจ throw ได้; ยังไม่ได้ตรวจลึก)

## ยังไม่ได้ตรวจ
- ช่วง LabVenture ล่ม Uroboros เก็บ setpoint alarm (Event Class) ชุดล่าสุดไว้ใช้ต่อ หรือหยุด alarm — ต้องไล่โค้ด Uroboros ส่วนที่ดึง `/api/eventclass`

---

# Session ที่ 4 ของวันที่ 27/10 — Dashboard: จุดรายรอบ → แถบช่อง (slot strip) + deploy

แผนที่ผู้ใช้อนุมัติ (หลักการออกแบบ + ขั้นตอน): `C:\Users\peera\.claude\plans\http-localhost-443-labventure-dashboard-scalable-marble.md` · **ยังไม่ commit**

## สิ่งที่ทำ (`client/src/pages/Dashboard.jsx` ไฟล์เดียว, ไม่แตะ server)
- แทน `DotItem`/`TimelineDots` ด้วย `SlotCell` / `SlotStrip` (grid 12 ช่อง สูง 22px) + `DailyChip` (คอลัมน์ "วัน" แยก — เลิกใช้ `DAILY_POSITION` ที่เคยแทนช่อง 13:00)
- `buildNodeDots` → `buildNodeSlots(node, isToday, hoursNow)` คืน `{slots, daily}` · สถานะ: `done · modified · due · overdue · future · none`
  - `due` = ยังไม่บันทึก และยังไม่เลย slot+2 ชม. (วันนี้เท่านั้น; daily ที่ค้างวันนี้ = due) · `overdue` = เลย slot+2 ชม. หรือเป็นวันย้อนหลัง
  - `nextPendingSlot` เลือก overdue ก่อน แล้วค่อย due (รวม daily)
- `GroupSection`: เพิ่ม `TimeAxis` (01…23 + "วัน") และ `NowLine` (เส้นแนวตั้ง แสดงเฉพาะวันนี้, `useNow()` อัปเดตทุก 60 วิ) · ทุกแถวใช้ `ROW_GRID` ร่วมกันเพื่อให้คอลัมน์ตรงกัน
- `NodeRow`: % + แถบความคืบหน้า 3px ใต้ชื่อ · props `isToday/hoursNow` มีค่า default (เพราะ node ที่ไม่อยู่ในกลุ่มเรียก `NodeRow` ตรงๆ)
- เพิ่ม `SlotLegend` ข้างหัวข้อ "สถานะรายหัวข้อ" · `ProgressBar` เปลี่ยนสีเป็นชุดเดียวกัน
- สีเป็น hex โทนดินฝังใน `SLOT_STYLE` (sage `#DCE8C8/#A9C08A`, แดงอิฐ `#D9614C`, amber ลายเฉียง) — ยังไม่ได้ย้ายไปเป็น token ใน `tailwind.config.js`
- `isToday` ใช้วันที่ local ของ browser (`localDateStr`) แทน `toISOString()` (UTC) แบบเดิม

## ตรวจแล้ว (dev :5173 → API :8889 จริง, cookie login จาก :443 ใช้ร่วมได้เพราะ cookie ไม่แยก port)
- แกนเวลาตรงกับช่อง (วัดได้ 314px ทั้งคู่), เส้น now ถูกตำแหน่ง, คลิกช่อง overdue → `/record?slot=01%3A00`, daily → `/record?slot=daily`, วันย้อนหลัง = แดงทึบทั้งหมด ไม่มีเส้น now
- console: มีแค่ `POST /api/aquadat/sync` 502 (ไม่เกี่ยว)
- ⚠ จอมือถือ 375px: แถบช่องถูกบีบจนแทบไม่เห็น — สาเหตุคือ layout ทั้งหน้ายังเป็น 2 คอลัมน์ (การ์ดด้านบนก็โดนบีบ) เป็นปัญหาเดิม ยังไม่ได้แก้
- ข้อสังเกต: เรียก `POST /api/auth/bypass` จาก browser ถูก auto mode ปฏิเสธ — ให้ผู้ใช้ login เองใน browser pane

## Deploy — ⚠ ยังไม่ได้ตรวจบน :443
- เทียบแล้วว่าไฟล์ client ที่เปลี่ยนหลัง deploy ล่าสุด (11:37) มีแค่ `Dashboard.jsx`
- สำรอง dist เดิม (`index-C1j6CRcF.js`) → `Fullscale_V2\_backup\LabVenture_before_slotstrip_2710\client\dist`
- build ใหม่ (`index-D6Pkyae1.js` / `index-Cz11B5V0.css`) → แทนที่ `Fullscale_V2\DEPLOY_LabVenture\client\dist` (static, `etag:false` — ไม่ต้อง restart)
- **หลัง copy เสร็จ Fullscale ล่มทั้งชุด**: :443 / :8889 ไม่ตอบ, ไม่มี process Uroboros/BellBeast/LabVenture (เหลือ node.exe 2 ตัวใน session Services) · `START_FULLSCALE.log` ล่าสุด 13:27 ไม่มีบันทึกการหยุด · `Uroboros_proj` แก้ล่าสุด 14:13 (อาจมี session อื่นทำงานอยู่) — **ยังไม่รู้สาเหตุ, ไม่น่าเกิดจากการ copy static**
- ถามผู้ใช้แล้วว่าจะให้สั่ง `START_FULLSCALE_LOCALHOST` (ต้องกด UAC) หรือผู้ใช้ start เอง — **ยังไม่ได้คำตอบ**

## งานถัดไป
1. ยืนยันว่า Fullscale กลับมาทำงาน (ถามว่าใครหยุด / เคยมี session อื่น deploy Uroboros ไหม) → เปิด `http://localhost:443/labventure/dashboard` ตรวจว่าโหลด `index-D6Pkyae1.js` และเห็นแถบช่องใหม่
2. ถ้าหน้าใหม่มีปัญหา: copy `_backup\LabVenture_before_slotstrip_2710\client\dist` กลับไปทับ
3. commit `Dashboard.jsx` (ถามก่อน; แยกจากงาน D/E/G และงานค้างใน handoff2610)
4. (ถ้าผู้ใช้ต้องการ) responsive layout ของหน้า Dashboard สำหรับมือถือ · ย้ายสี slot ไปเป็น token ใน tailwind

## Suggested skills
- `run` — เปิด "LabVenture Client" (:5173) ใน `.claude/launch.json` ตรวจหน้า (ให้ผู้ใช้ login ที่ :443 ก่อน)
- `code-review` — ก่อน commit `Dashboard.jsx`
- ตอบเป็นภาษาไทยตาม memory

---

# Session ที่ 5 (ทำวันที่ 29/10/2569) — Daily Report: แหล่งข้อมูล AquaDAT REST, สูตรคำนวณ, กล่องต้นทุน, ค่าไฟ TOU

หน้า: `http://localhost:443/labventure/op-record?station=DAILY` · ทดสอบกับวันที่ **28/10/2569** (`2026-10-28`)
ไฟล์ที่แก้: `server/routes/dailyReport.js`, `server/services/dailyReport.js`, `server/routes/scenarios.js`, `client/src/pages/OpRecord.jsx` (client build แล้ว → `client/dist`) · **ยังไม่ได้ commit**

## 1. ปัญหาที่พบ → สาเหตุ → การแก้

| อาการ (28/10) | สาเหตุ | แก้ |
|---|---|---|
| น้ำดิบเฟส 1 = 354,360,000 (ควร 382,000) | CSV `/api/process` ของ Uroboros ไม่มีค่า 00:00 (คอมเมนต์ "fetch ย้อน 1 วัน" แต่โค้ดจริง `fetchBegin = originalBegin`) และ "Normalize missing → 0" ทำให้ 00:00 = 0 → (24:00 − 0)×100 | เลิกใช้ CSV — ดึง AquaDAT REST JSON ตรง (ข้อ 2) |
| Service Water = 6,941,203 (ควร 6,988) | เหมือนข้างบน (00:00 = 0) | เหมือนข้างบน |
| CHEM Δ Line/Tank ผิด, Wall ว่าง | CSV ใส่ 0 แทนช่องที่ไม่มีข้อมูล (ชั่วโมงคี่ และ 22:00/24:00) → สูตรที่ต้อง flow>0 และ DR>0 ได้ null, Δ = 0 − ค่าเช้า | เหมือนข้างบน |
| ลองดึง GraphQL pattern ขนานทุกสถานี → timeout เกือบหมด | `aquadat.mwa.co.th/graphql` รับ request พร้อมกันไม่ไหว | เอาออก (QUERY DATA ไม่ใช้ pattern แล้ว) |
| PACl USE = 63.525 (คิดมือ 61.226) | การ์ด CHEM PACl เขียน `ΔA + ΔB × 1.19` (ลืมวงเล็บ — ถัง A/C ไม่แปลงหน่วย) | `(ΔA + ΔB) × 1.19` |
| ค่าไฟคิดจาก 198.928 MWh แต่ ENERGY รายงาน 196.99 | ค่าไฟรวม SS3 Bldg. แต่ ENERGY ไม่รวม | เอา SS3 Bldg. ออกจากค่าไฟ ⚠ **แก้หลังรีสตาร์ทล่าสุด — ต้องรีสตาร์ท :8889 อีกรอบ** |
| Demand Charge 132.93 บวกเป็นก้อนทุกวัน, ค่าบริการ 312.24 hardcode บวกเต็มทุกวัน | สูตรเดิม | ข้อ 3 (ค่าไฟ TOU) |
| popup ตั้งค่ารายงานประจำวันพื้นหลังโปร่ง | class `bg-earth-DEFAULT` ไม่สร้าง CSS (Tailwind key `DEFAULT` → `bg-earth`) | แก้เฉพาะ popup (`bg-earth`, footer `bg-earth-card`) · ⚠ ยังมีอีก ~129 จุดใน 12 ไฟล์ — ถามผู้ใช้แล้วว่าจะแก้ทั้งแอปไหม ยังไม่ได้คำตอบ |

## 2. API ที่เกี่ยวข้อง

### LabVenture (prefix `/labventure` ใน prod, server :8889)
| Endpoint | ทำอะไร |
|---|---|
| `GET /api/daily-report/quick?date=` | คำนวณจาก SQLite `node_records` อย่างเดียว (โหลดตอนเปิดหน้า) |
| `GET /api/daily-report/fetch-all?date=` | **All query** — stage 1: AquaDAT REST 1 request ทุก stationtype → cache → คำนวณ · stage 0: Uroboros `/api/operator/data` |
| `GET /api/daily-report/fetch-station?date=&station=` | **Spatial query** — REST เฉพาะ stationtype ของสถานีนั้น (อัปเดตสถานีพี่น้องด้วย เช่น RWS1+RWS2) |
| `GET /api/daily-report/recompute?date=` | **ใหม่** — คำนวณใหม่จาก cache ที่ query ไว้ ด้วยค่าตั้งค่าปัจจุบัน (ไม่ดึง AquaDAT) · `cached:false` ถ้ายังไม่เคย query |
| `GET /api/daily-report/debug-cache?date=&sid=&cid=` | **ใหม่** — ดู historyCache (อ่านอย่างเดียว ใช้ debug) |
| `GET/PATCH /api/scenarios/report-settings` | อ่าน/บันทึกค่าตั้งค่ารายงาน (`server/config/app_settings.json`: `chem_cost`, `energy_cost`, `rw_cost`, `cwt_area_m2`) |
| `GET /api/data/read?plant_id=&stationtype_code=&begin_dt=&end_dt=` | proxy AquaDAT REST ด้วย cookie `aquadat_token` (ใช้ทดสอบ) |
| `POST /api/daily-report/validate`, `/save` | เดิม (ไม่ได้แก้) |

### AquaDAT REST (แหล่งข้อมูลหลักตอนนี้)
`GET http://aquadat.mwa.co.th:12007/api/aquaDATService/Data?token=…&plant_id=2&stationtype_code=RWS,CDS,TPS,DPS,FWS,CWS&begin_dt=X-1&end_dt=X&format=json`
- token = cookie `aquadat_token` จากการ login LabVenture ปกติ · client: `readData()` ใน `server/services/aquadat.js`
- แถว: `{ configparam_id, trans_dtm, trans_time ('01:00'…'24:00'), trans_value, trans_type, plant_id }` · ไม่มีแถว 00:00 · ค่าว่าง = `null` (ไม่ถูกแปลงเป็น 0)
- plant MS = `2` · **สถานีเคมี = `CDS`** (ไม่ใช่ CHEM) · map sid→type: `SID_STATIONTYPE` ใน `routes/dailyReport.js`
- **25 จุดของวัน X** = (X−1 เวลา 24:00 → slot `00:00`) + X 01:00…24:00 (`restRowsToHistoryMap`)
- เวลา: RWS+CDS+TPS 2 วัน ≈ 11 วินาที (7,822 แถว) · ยังไม่ได้จับเวลาครบ 6 type (ผู้ใช้ยืนยันว่าทำงานถูกต้อง)
- Uroboros `/api/process` (CSV) = ห่อ REST นี้แล้ว pivot + เติม 0 — **ไม่ใช้แล้ว** (`Uroboros\Uroboros\Uroboros\AquadatFast.cs`)

## 3. สูตรคำนวณ (`server/services/dailyReport.js` → `computeDailyReport`)
นิยาม: **DD(id)** = ค่า 24:00 − ค่า 00:00 ของวันเดียวกัน · **pumpTotal** = ปริมาณน้ำผลิต = DPS Line A + Line B + TPS (28/10 = 1,436,200 ลบ.ม.)

**น้ำดิบ (ลบ.ม./วัน)** — เฟส 1 = DD(4, RWS1)×100 · เฟส 2 = DD(7)×100 · เฟส 3 = DD(42, RWS2)×100 · เฟส 4 = DD(44)×100
→ 28/10: 382,000 / 383,000 / 417,000 / 329,000 = **1,511,000**

**Service Water** = DD(6534, TPS) → 6,941,203 − 6,934,215 = **6,988**

**Water Loss %** = (น้ำดิบรวม − pumpTotal − ตะกอนรวม − Service Water − ΔCWT) ÷ น้ำดิบรวม × 100 โดย ΔCWT = (ระดับ CWT 24:00 − 00:00) × `cwt_area_m2` (48,000) → 28/10: **4.45%** (หน้าจอหักน้ำ recycle ออกอีกตามแท็บ RECYCLE WATER)

**PACl (ตัน)** — Net = (ΔTank A + ΔTank B) × 1.19 · OUT = IN (รับเข้า 8423/8424 @24:00) − Net
→ CHEM1: 45.988 − (12.1+0.3)×1.19 = 31.232 · CHEM2: 26.662 − (0−2.8)×1.19 = 29.994 · **รวม 61.226**

**Alum (ตัน)** — Net = (ΔA + ΔB) × 1.33 · OUT = IN (8037/8036) − Net (28/10 = 0)

**Chlorine (kg)** — USE = ผลรวม |Δ| ของไลน์ที่ลดลง (127,128 / 190,191) → 3,315 + 3,070 = **6,385 kg**

**Chemical Accuracy Wall (card14)**
- TARGET = DR เฉลี่ยถ่วงน้ำหนักด้วย flow รายชั่วโมง (`weightedAvgDR`)
- USE แต่ละเฟส = USE ของสถานี × สัดส่วน Σ(flow×DR) ของเฟส (`sumFlowDR`); Alum แบ่งตาม totalizer 88/91, 150/153
- ACTUAL: Alum = USE_ton ÷ 2 × 10⁶ ÷ น้ำดิบเฟส · PACl = USE_ton × 0.35 × 10⁶ ÷ น้ำดิบเฟส · Cl = USE_kg × 1000 ÷ Σ(น้ำดิบ 2 ชม. ช่วงที่ DR>0) (`sumDeltaFlowDR`)

**ต้นทุนสารเคมี (บาท/ลบ.ม.)** = (Alum_ton × `alum_ton` + PACl_ton × `pacl_ton` + Cl_kg/1000 × `chlorine_ton`) ÷ pumpTotal
→ 28/10 (PACl 5,980 · Cl 13,550 บาท/ตัน): (61.226×5,980 + 6.385×13,550) ÷ 1,436,200 = **0.3152** (ตารางผู้ใช้ 0.3155)

**ต้นทุนกำจัดตะกอน** = `sludge_day` (8,601.88 บาท/วัน) ÷ pumpTotal = **0.0060**

**ต้นทุนพลังงานไฟฟ้า — TOU กปน. 4.2.2 (สายส่ง 24 kV)** (ตกลงกับผู้ใช้: ไม่คิด kVAR, ไม่แยกวันหยุดราชการ)
```
พลังงาน  = Σ DD มิเตอร์ DPS(883,885) TPS(9278,9277) FWS1(9273,9274) FWS2(9276,9275) RWS1(33,35) RWS2(75,77)
           [ไม่รวม SS3 Bldg 6775,6776]
จ.–ศ.:   On-Peak = พลังงาน × 13/24 , Off-Peak = ที่เหลือ      ส.–อา.: Off-Peak ทั้งวัน
ค่าไฟ/วัน = kWh_on × peak_price(4.1839) + kWh_off × offpeak_price(2.6037) + kWh_รวม × ft_price(0.1972)
          + demand_kw × max_energy(132.93 บาท/kW) ÷ วันในเดือน + service_charge(312.24) ÷ วันในเดือน
บาท/ลบ.ม. = ค่าไฟ/วัน ÷ pumpTotal
```
→ 28/10 (วันพุธ, 196.992 MWh, demand_kw = 0): ≈ 720,379 บาท → **≈ 0.5016** (ค่าที่เห็นตอนนี้ 0.5065 = ยังรวม SS3 รอรีสตาร์ท)
⚠ **ยังไม่ตรงกับตารางผู้ใช้ 0.4416** — ถ้าจะได้ 0.4416 On-Peak ต้อง ≈ 24.5% ของวัน ไม่ใช่ 54% (13/24) → ถามผู้ใช้แล้วว่าตารางแบ่ง On/Off-Peak อย่างไร (ทางเลือก: คิดจากมิเตอร์จริงช่วง 09:00–22:00) **ยังไม่ได้คำตอบ** · เรื่อง VAT 7% ยังไม่ได้ข้อสรุป

**ต้นทุนรวม (ไม่รวมค่าน้ำดิบ)** `op_cost_per_m3` = สารเคมี + ไฟฟ้า + ตะกอน · `total_cost_per_m3` = `rw_cost` + op (ใช้ตอน save DB)

## 4. UI ที่เปลี่ยน (`OpRecord.jsx`)
- **A. SUMMARY KPI**: แถวบน 3 กล่อง (WATER PRODUCED / % LOSS / ENERGY) · แถวล่าง **TOTAL COST** 4 ช่อง บาท/ลบ.ม. (สารเคมี · ไฟฟ้า · ตะกอน · ต้นทุนรวม *ไม่รวมค่าน้ำดิบ*) — จอ `xl` ขึ้นไป 4 คอลัมน์, จอแคบ 2×2 (ตัวแปร `kpiCostRows` เพราะ `costRows` มีอยู่แล้วในไฟล์)
- popup **ตั้งค่ารายงานประจำวัน**: ช่องใหม่ "ค่า Demand on peak" (บาท/kW), "Demand on peak (บิล)" (kW/เดือน — **ผู้ใช้ต้องกรอกจากบิล ตอนนี้ 0**), "ค่าบริการ" (บาท/เดือน) · บันทึกแล้วถ้าค่าเปลี่ยน → เรียก `/recompute` รีเฟรชรายงานทันที

## 5. สถานะ / งานถัดไป
1. **รีสตาร์ท LabVenture :8889** (การแก้ SS3 ออกจากค่าไฟบันทึก 18:29 หลังเซิร์ฟเวอร์เริ่ม 18:26) → QUERY DATA 28/10 → คาดว่าไฟฟ้า ≈ 0.5016
2. รอคำตอบ: ตารางผู้ใช้แบ่ง On-Peak/Off-Peak อย่างไร → ถ้าใช้มิเตอร์จริง ให้คิดจาก slot ราย 2 ชม. 10:00–22:00 แทน 13/24
3. รอคำตอบ: แก้ `bg-earth-DEFAULT` → `bg-earth` ทั้งแอปไหม
4. ทดสอบ popup บันทึกแล้วรีเฟรชจริง (ยังไม่ได้กดบันทึกเอง เพราะจะเขียนทับ `app_settings.json`)
5. ทำความสะอาด (ถ้าต้องการ): endpoint SSE เก่า (`/stream*`) ยังใช้ GraphQL pattern · `config/dr_aquadat_configs.json` ไม่ถูกใช้แล้ว · `/debug-cache` เป็น debug
6. commit (ถามก่อน) — แยกจากงานค้างอื่นใน working tree (`git status` มีไฟล์ค้างจำนวนมาก)
7. เซิร์ฟเวอร์ไม่ได้รันแบบ `--watch` — ทุกครั้งที่แก้ server ต้องให้ผู้ใช้รีสตาร์ท (`start.ps1`) · ตรวจด้วยการเทียบเวลาเริ่ม process บนพอร์ต 8889 กับเวลาแก้ไฟล์

## Suggested skills
- `code-review` — ก่อน commit `routes/dailyReport.js` / `services/dailyReport.js` / `routes/scenarios.js` / `OpRecord.jsx`
- `run` — เปิดหน้าตรวจ (ผู้ใช้ต้อง login ที่ :443 เอง ห้ามใส่รหัสผ่านแทน)
- `docs` หรือ `docx` — ถ้าจะเขียนรายงานสูตรคำนวณ ใช้ข้อ 2–3 ข้างบนเป็นต้นฉบับ
- ตอบเป็นภาษาไทยตาม memory

---

# Session ที่ 6 (ทำวันที่ 29/10/2569) — Daily Report: ข้อมูลไม่ครบ → N/A สีแดง + วันคงเหลือคลอรีน + deploy

หน้า: `op-record?station=DAILY` · ไฟล์ที่แก้: `server/services/dailyReport.js`, `client/src/pages/OpRecord.jsx` (เพิ่มจากงาน Session 5 ที่ค้างอยู่ใน working tree) · **ยังไม่ commit**

## 1. ทำไมวันนี้ (ยังไม่ครบวัน) เคยขึ้น 0
- **AquaDAT มีแถวของ slot ที่ยังไม่ถึงเวลา**: ตอน 19:34 REST ตอบแถว 24:00 ของวันนี้แล้ว 88 แถว บางตัวมี 20:00/22:00 ด้วย เช่น ถัง Alum 93/96 ค่าเท่ากันทุก slot, รับเข้า 8037/4333 = `"0"`, มิเตอร์ RWS2 75 ค่า 24:00 = ค่า 00:00 · ยังไม่รู้ว่าใครหรืออะไรเขียนแถวล่วงหน้าเหล่านี้
- **โค้ดเดิมแปลงค่าว่างเป็น 0 หรือรวมแค่บางส่วน**: `?? 0` ในคลอรีน/cl_income, `getDayDeltaSum` รวมเฉพาะมิเตอร์ที่มีค่า, ใน JS `ตัวเลข × null = 0`, ต้นทุนสารเคมีนับส่วนที่ไม่มีค่าเป็น 0

## 2. สิ่งที่แก้ (`server/services/dailyReport.js`)
- `isFutureSlot(date, time)` (เวลาไทย) + `dropFutureSlots()` ตัดแถวของ slot ที่ยังไม่ถึงเวลาออกตั้งแต่ต้น `computeDailyReport` · `getValueAt` คืน null ถ้าเป็น slot อนาคต (กันกรณีอ่านจาก SQLite ด้วย)
- `sumStrict()`: ขาดตัวใดตัวหนึ่ง = null ใช้กับ DDS/DS (มิเตอร์ไฟ), ผลรวมถัง PACl/Alum, ไลน์คลอรีน, rw_total, pumpTotal, ตะกอน, e_total, peak/offpeak, คงเหลือ, ต้นทุน (`chem_cost`/`op_cost`/`total_cost` = null ถ้าส่วนใดเป็น null)
- `RCV(id, sid)` = ยอด "รับเข้า" @24:00 (8423/8424/8037/8036/4333/4339/4334/4340): วันที่ผ่านไปแล้วและไม่มีแถว = 0 (ไม่มีการรับ) · ก่อน 24:00 ของวันนี้ = null · **จำเป็น** เพราะ 28/10 ไม่มีแถวรับ Alum ถ้าไม่ใช้ RCV ต้นทุนสารเคมีจะเป็น N/A
- `clIn/clUse` (ต้องมีทั้ง 2 ไลน์), คลอรีน card14 ต้องมี `cl*_net_kg !== null`
- Water loss ต้องมี `service_w` ด้วย · `filter_availability` ใช้ `h` ที่ตัดอนาคตแล้ว
- ผลคำนวณมี `day_complete: !isFutureSlot(date,'24:00')`
- **วันคงเหลือคลอรีน** `card13_chem_remaining.chlorine.days_chem1/2` = `daysRemaining(rem_cl_ton, 1, [flow1,flow1,flow2,flow2], [Pre1,Post1,Pre2,Post2])` (CHEM1 dose 129/133/131/135, flow RWS1 1/2 · CHEM2 dose 192/196/194/198, flow RWS2 41/43; ค่า @00:00) — ผู้ใช้เลือกสูตร "แบบเดียวกับ Alum/PACl" · ตัวหารของ `daysRemaining` ได้หน่วย**ตัน**/วัน (ผมเคยส่ง kg แล้วผลสูงไป 1,000 เท่า แก้แล้ว)
  - ⚠ ถามผู้ใช้แล้ว ยังไม่ได้คำตอบ: flow 1/2/41/43 (ค่าราว 4.4) ใช้หน่วยอะไร · ถ้าเป็น ลบ.ม./วินาที สูตร `daysRemaining` เดิม (ใช้ร่วมกันทุกสาร) จะให้จำนวนวันสูงกว่าจริงราว 3.6 เท่า

## 3. UI (`client/src/pages/OpRecord.jsx`)
- `NA()` = ข้อความ "N/A" สีแดง · `addStrict()` · หลังมี `d` (ผลคำนวณ) แล้ว ค่า null = กรอบ `border-red-400 bg-red-50` แบบการ์ด WASH Water ใช้กับ: KPI 3 กล่อง, TOTAL COST 4 ช่อง, `DailyTableCardUI` (prop `na`), SERVICE WATER (เดิมขึ้น "null m³"), CHEMICAL REMAINING ทั้ง 2 แถว, ตาราง USE/INCOME/RETURN (`usageCell`), donut card14
- Donut: `noData` = TARGET เป็น null → สีเทา "—" (ไม่ได้เติมสาร) · `dayOpen` (`day_complete === false`) → การ์ดเติมสารเป็นแดง N/A ทั้ง USE/TARGET/ACTUAL/% · `useNA/actualNA` สำหรับวันที่ครบแต่ข้อมูลขาด
- ก่อนยังไม่ได้ query ช่องเป็น "—" (เดิมบางช่องเป็น "0") · ⚠ ตอนเปิดหน้าครั้งแรก ผลจาก `/quick` (SQLite) ถือเป็น `d` หน้าจึงแดง N/A เกือบทั้งหน้าจนกว่าจะกด QUERY DATA
- ยังไม่ได้แก้ (ผู้ใช้ยังไม่ได้ขอ): Sankey ยังใช้ `?? 0` · ระดับน้ำ/แรงดันต่ำสุด–สูงสุดของวันที่ยังไม่จบยังแสดงค่าจากชั่วโมงที่ผ่านมา (เสนอให้เป็น N/A แล้ว ยังไม่ได้คำตอบ)

## 4. ทดสอบ
- ชุดทดสอบ: server :3002 ใช้ DB สำเนาของ deploy (ล้าง `aquadat_queue`/`excel_queue`) + env `UROBOROS_BASE_URL=http://localhost:1` (กัน alarmWatcher สร้าง CAR) + `LINE_CHANNEL_ACCESS_TOKEN=""` · client "LabVenture Client (verify 5174)" — config นี้ลบออกจาก `.claude/launch.json` แล้ว และลบ DB สำเนาแล้ว
- 29/10: ไม่มีช่องไหนเป็น 0 ปลอมแล้ว (เหลือแค่ `filter_availability.repair` = 0 ซึ่งถูกต้อง) · 28/10 ตรงกับค่าเดิม: น้ำดิบ 1,511,000, Loss 4.45%, PACl 61.226, ต้นทุนสารเคมี 0.3152, PACl ACTUAL P1 14.31, Pre-Cl P1 2.22
- ค่าไฟ 28/10 บนชุดทดสอบ = 0.4745 (ไม่ใช่ 0.5016) เพราะ `app_settings.json` ใน repo ตั้ง `ft_price` และ `service_charge` = 0 ไม่เกี่ยวกับงานนี้
- วันคงเหลือคลอรีนทดสอบด้วย DB จำลอง (stub `getDb`) เท่านั้น: คงเหลือ 10 ตัน, flow 4.4, dose 2+1 → 15.8 วัน ตรงกับที่คิดมือ · **ยังไม่ได้ทดสอบกับข้อมูลจริง**

## 5. Deploy (ทำแล้ว)
- พบว่า deploy ยังไม่มีงาน Session 5 เลย (`services/dailyReport.js` ใน deploy เป็นไฟล์ 11 ส.ค.) · ไฟล์ server ที่ต่างจาก repo มีแค่ 3 ไฟล์ คือ `routes/dailyReport.js`, `routes/scenarios.js`, `services/dailyReport.js` (Session 5 + 6) → copy ทั้ง 3 ไฟล์ + `client/dist` (`index-Bo_A2Qlw.js` / `index-JfkVN_eR.css`) · **ไม่ได้ copy `config/app_settings.json`** (deploy มี `energy_cost` แค่ 4 ช่อง; route `report-settings` เติม `demand_kw: 0`, `service_charge: 312.24` ให้เป็นค่าเริ่มต้น)
- Backup: `Fullscale_V2\_backup\LabVenture_before_dr_na_2910` (3 ไฟล์เดิม + dist `index-BXsVxSSX.js`)
- Start ด้วย `Start-Process cmd.exe ... start.bat -Verb RunAs` (วิธีเดียวกับ Session 2) → :8889 ขึ้นภายใน 4 วิ เสิร์ฟ `index-Bo_A2Qlw.js`, `/api/scenarios/limits` 200, `/api/daily-report/recompute` 200 (route ใหม่มีแล้ว)
- ⚠ **ก่อน deploy Fullscale ล่มทั้งชุด**: :443 (BellBeast), :8889 และ Uroboros ไม่มี process เลย ผมไม่ได้หยุดอะไร (`START_FULLSCALE.log` ล่าสุด 13:49) · start แค่ LabVenture · **BellBeast/Uroboros ยังไม่ได้ start** → :443 ยังใช้ไม่ได้
- ⚠ ก่อนล่ม :443 เสิร์ฟ `index-Dq7l9LxV.js` ซึ่งเป็น build แรกของ session นี้จาก **repo** `client/dist` แปลว่า :8889 ตัวก่อนหน้า (เริ่ม 19:31) รันจาก repo (`start.ps1`) ไม่ใช่ `DEPLOY_LabVenture` · ตอนนี้รันจาก `DEPLOY_LabVenture` ตามที่ `START_FULLSCALE_LOCALHOST.ps1` ใช้ (บรรทัด 48)
- ⚠ **ตรวจด้วยข้อมูลจริงไม่ได้**: `fetch-all` → 502 `connect ETIMEDOUT 103.146.160.236:12007` (`Test-NetConnection`: พอร์ต 12007 ต่อไม่ได้ ส่วนพอร์ต 80 ต่อได้) — ปัญหาเครือข่าย/AquaDAT
- ⚠ ช่องโหว่ที่เจอ: ข้อความ error 502 ของ `fetch-all` มี URL ที่มี `token=` (AquaDAT JWT ของผู้ใช้) ส่งกลับไปให้ browser — ควรตัด token ออกจากข้อความ error ใน `routes/dailyReport.js` (ยังไม่ได้แก้)
- บน :8889 โดยตรง API ไม่มี prefix (`/api/...`) — `/labventure/api/...` ใช้ได้เฉพาะผ่าน :443

## 6. งานถัดไป
1. ให้ผู้ใช้ start Fullscale (`START_FULLSCALE_LOCALHOST`, ต้องกด UAC) หรือถามก่อนแล้วสั่งให้ · ถามว่าใครหยุด Fullscale
2. เมื่อ AquaDAT :12007 ต่อได้ → ตรวจบน :443: วันนี้แดง N/A ครบ, 28/10 ตัวเลขเดิม, CL1/CL2 Day มีค่า
3. รอคำตอบ: หน่วยของ flow 1/2/41/43 (สูตร `daysRemaining`) · ระดับน้ำ/แรงดันของวันที่ยังไม่จบให้เป็น N/A ไหม · คำถามค้างจาก Session 5 (On/Off-Peak, VAT, `bg-earth-DEFAULT`)
4. ตัด token ออกจากข้อความ error ของ AquaDAT REST (ถามก่อน)
5. commit `services/dailyReport.js` + `routes/dailyReport.js` + `routes/scenarios.js` + `OpRecord.jsx` (Session 5 + 6) แยกจากงานอื่น — ถามก่อน
6. ถ้าหน้าใหม่มีปัญหา: copy `_backup\LabVenture_before_dr_na_2910` กลับไปทับ แล้วรัน start.bat

## Suggested skills
- `code-review` — ก่อน commit (`services/dailyReport.js` เปลี่ยนเยอะ: strict sums, RCV, future-slot)
- `run` — ตรวจหน้าจริง (ผู้ใช้ login เอง ห้ามใส่รหัสผ่านแทน)
- ตอบเป็นภาษาไทยตาม memory

---

# Session ที่ 7 (29/10/2569) — พิมพ์รายงาน /record: DailyLab + Operation daily report + ปฏิทินสาหร่าย

**commit `38ea318`** (ดู `git show 38ea318` สำหรับ diff/รายการไฟล์) · deploy `client/dist` (`index-wdKl0vMN.js`) ไป `Fullscale_V2\DEPLOY_LabVenture` แล้ว · ไฟล์ server deploy + รีสตาร์ทไปแล้วตั้งแต่ 22:02 (ตรงกับ repo)

## สิ่งที่ทำ (ข้อตกลงกับผู้ใช้)
- หน้า `/record`: ปุ่ม **🖨 พิมพ์รายงาน** อยู่แถวปุ่มหลักเวลา ชิดขวา (`ml-auto`) → popup `client/src/components/PrintReport.jsx` เลือกเอกสาร 3 แบบ **ไม่มีช่วงวันที่** (ผู้ใช้ขอ — พิมพ์ทั้งเดือน/หลายวันจากหน้านี้ไม่ได้แล้ว)
  - **DailyLab** = วันที่มุมขวาบนของหน้า
  - **DailyLab + Operation daily report** = เรียก `/api/daily-report/fetch-all` (เหมือน QUERY DATA หน้า DAILY, ไม่ redirect, ~20 วิ) → ครบ = ดาวน์โหลด `export.xlsx?dosage=1` ทันที · ไม่ครบ (N/A/แดงเงื่อนไขเดียวกับหน้า DAILY, `client/src/utils/dailyReportIssues.js`) = หน้าตรวจข้อมูล: ปริมาณน้ำ (น้ำดิบ/สูบส่ง-สูบจ่าย/ตะกอน/Service/WASH 1–4) · สารเคมี IN/OUT แยก CHEM1/2 · สรุปรายสาร + Dosage → ถาม "จะ export Excel DailyLab หรือไม่?"
  - **สาหร่าย** = ปฏิทินรายเดือน (`AlgaeCalendar`) ไฮไลต์วันที่มีข้อมูล (`/api/algae/export-info` ทั้งเดือน; count>0 เท่านั้น) เลือกได้เฉพาะวันนั้น · เปิดมาเลือกวันล่าสุด ≤ วันที่ของหน้า
- Daily Dosage ในฟอร์ม (`DailyLab_theme.xlsx`): **ค่า ACTUAL** ของ card14 → X/Y/Z/AA = Phase 1–4 · แถว 4 Alum, 5 PACl, 7 Pre Cl2, 9 Post Cl2 · **แถว 8 Intermediate Cl2 เว้นว่าง** (ระบบผลิตไม่จ่าย) · วันยังไม่ครบ/ค่า null = ว่าง (`dailyLabDosageCells` ใน `services/dailyReport.js`)
- ค่ามาจาก `historyCache` ในหน่วยความจำ server (`getCachedReport` ใน `routes/dailyReport.js`) — server รีสตาร์ทระหว่าง popup เปิด → ไฟล์ออกมาช่อง dosage ว่าง · ลงเฉพาะไฟล์ดาวน์โหลด ไม่เขียนไฟล์เดือนบน OneDrive
- `OpRecord.jsx` export `FWS_BW_PHASES`, `parseBWPhase` (ใช้ตรวจ WASH Water)

## ทดสอบแล้ว
- 28/10 (ข้อมูลครบ): ไฟล์ X5..AA5 = 14.31/14.27/14.50/13.53, X7 = 2.22, AA9 = 2.39, Alum ว่าง — ตรงทั้งบน :3002 (DB สำเนา) และ :443 จริง · 20/10 ครบเช่นกัน · 29/10 (ยังไม่ครบวัน) ขึ้นหน้าตรวจข้อมูล
- ปฏิทินสาหร่าย: DB สำเนา + ข้อมูลจำลอง (24 ก.ย., 1/6/15/20/27 ต.ค., 8 ต.ค. count=0) → วันตรง API, 8 ต.ค. กดไม่ได้, เลื่อนเดือนได้, ดาวน์โหลด 6 ต.ค. ได้ 1 ชีท · **DB จริงมีสาหร่ายแค่ 28 มิ.ย. (repo) / 1 ต.ค. (deploy)**
- **ยังไม่เจอวันจริงที่ครบวันแต่ข้อมูลขาด** (หน้าตรวจข้อมูลทดสอบด้วยการลบค่าในผล 28/10 เท่านั้น)

## ⚠ สถานะระบบตอนจบ session
- 22:21 มีคน/อะไรรีสตาร์ท LabVenture **จาก repo** (ไม่ใช่ `DEPLOY_LabVenture`) → ใช้ DB `LabVenture\server\labventure.db` + `client/dist` ของ repo (ข้อมูลที่บันทึกช่วงนั้นอยู่ใน DB ของ repo)
- หลัง copy dist (~22:40) **Fullscale ล่มทั้งชุด**: :443/:8889/:8888 ไม่ฟัง, ไม่มี BellBeast/Uroboros (เหลือ node.exe 1 ตัว เริ่ม 22:18 session 6) — ไม่ได้หยุดเอง, ยังไม่ได้ start, **ยังไม่ได้ถามผู้ใช้**
- Backup: `Fullscale_V2\_backup\LabVenture_before_dailygen_2910` (server 5 ไฟล์ + dist ก่อนงานนี้) · `..._before_printpopup_2910` (dist `index-DQAx1JqA.js`)

## งานถัดไป
1. ถามผู้ใช้เรื่อง Fullscale ล่ม + จะรัน LabVenture จาก repo หรือ `DEPLOY_LabVenture` (DB ต่างกัน — ระวังข้อมูลที่บันทึกลง DB repo ช่วง 22:21 เป็นต้นไป) แล้วค่อย start (`START_FULLSCALE_LOCALHOST`, UAC)
2. ตรวจปุ่มพิมพ์รายงานบน :443 จริงหลังระบบกลับมา
3. working tree ยังมีไฟล์ค้างอีก ~105 รายการ (งาน D/E/G, chem-lab, ฯลฯ ใน handoff ก่อนหน้า) — commit แยกต้องถามก่อน · commit `38ea318` รวมงานเก่าที่อยู่ในไฟล์เดียวกันไว้ด้วย (ผู้ใช้เลือกแบบทั้งไฟล์)
4. คำถามค้างเดิมจาก Session 5–6 ยังไม่ได้คำตอบ (On/Off-Peak, VAT, หน่วย flow คลอรีน, `bg-earth-DEFAULT`, token ใน error 502)

## Suggested skills
- `run` — ตรวจหน้า /record (ผู้ใช้ login ที่ :443 เอง; dev :5173 → :8889) · ทดสอบด้วย DB สำเนา: เพิ่ม config ชั่วคราวใน `.claude/launch.json` (`PORT=3002`, `LV_DB_PATH`, `UROBOROS_BASE_URL=http://localhost:1`, LINE token ว่าง) + "LabVenture Client (verify 5174)" แล้วลบออก
- `code-review` — ก่อน commit งานค้างชุดถัดไป
- `anthropic-skills:xlsx` — ถ้าต้องตรวจไฟล์ DailyLab ที่ export
- ตอบเป็นภาษาไทยตาม memory
