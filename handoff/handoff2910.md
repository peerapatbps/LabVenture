# Handoff 2026-10-29 — แผนฉุกเฉิน → เกณฑ์ scenario, alarm, test mode, TTS

> รายละเอียดเชิงเทคนิคทั้งหมด (ไฟล์ที่แก้, endpoint, ผลทดสอบ, path backup) อยู่ใน
> **`C:\Users\peera\OneDrive\Desktop\iot\Re-plan\Labventure_progress2910.md`** — อ่านไฟล์นั้นก่อน เอกสารนี้สรุปบริบท + สิ่งที่ค้าง
> แผนที่อนุมัติ (ข้อ 1–5): `C:\Users\peera\.claude\plans\2-whimsical-flute.md`

## บริบท
ผู้ใช้เอาแผนปฏิบัติการฉุกเฉิน `SD-MS-HACCP-สกล-09 Rev082.pdf` (root repo) มาตั้งค่าในหน้า `/labventure/config`
- แผนมี 5 กรณี: น้ำดิบขุ่นสูง, น้ำดิบด้อยคุณภาพ (เฝ้าระวัง/วิกฤติ), สาหร่ายอุดตันบ่อกรอง (เฝ้าระวัง/วิกฤติ), น้ำท่วม (ระดับ 1–3), แผ่นดินไหว — สองกรณีหลังไม่มีเกณฑ์คุณภาพน้ำ (ยังไม่ได้ทำอะไร)
- alarm มี 2 แบบ (ผู้ใช้กำหนด): **anomaly true/false** ใน `alarm_rules.json` ของ Uroboros — **ห้ามยุ่ง** · **เกณฑ์ควบคุมจาก scenario** → Event Class `rule.ref` (UCL/LCL) — งานของ session นี้
- แนวทางเกณฑ์ RW: ค่าของแต่ละ scenario = **จุดยกระดับไปขั้นถัดไป** (ปกติ Cond 300 → เฝ้าระวัง/วิกฤติ 400 ฯลฯ)

## ทำเสร็จแล้ว (ลำดับเวลา)
1. ปรับ `server/scenarios/*.json` ตามแผน + rename "น้ำขุ่น"→"น้ำดิบความขุ่นสูง", ลบ "สาหร่ายสูง" ที่ซ้ำ (migration ใน `initDb`)
2. สลับ scenario: ต้องสิทธิ์เขียน + `scenario_log` + แจ้ง Uroboros sync ทันที (`server/services/uroboros.js`)
3. occurrence เก็บ scenario/เกณฑ์ ณ ตอนเกิด, `clear_reason`, `scenario_changed`, `is_test`
4. เกณฑ์โหมดโรคระบาดปรับได้ (`app_settings.json epidemic_thresholds`, ปุ่มตั้งค่าเกณฑ์ข้าง toggle)
5. **Test mode** หน้า config: Ctrl+Shift+F10 (super admin) — panel ขวา ฉีดค่าแล็ปปลอมเข้า Uroboros (in-memory, `AlarmTestOverlay.cs`), สลับ scenario แบบ [TEST], "เปิดใช้ แล้วฉีดค่า"
6. Event Class ทุกครั้งที่สร้าง/แก้/เปิด-ปิด → kick `eventclass.sync` แล้วรอเสร็จค่อย `alarm.eval` (`syncThenEval`) · 409 จาก Uroboros = task ปิด → แจ้งชัด
7. **BellBeast**: `/api/audio/tts` ตรวจ transcript + ความยาวก่อนบันทึก (retry 3, `force:true` บันทึกทับได้) — ต้นเหตุเสียง "เข้าใจแล้วนะ ฉันจะพูดชัดเจน" ใน `s_mgl` (ผู้ใช้สร้างคลิปใหม่แล้ว)
8. **BellBeast MHxView popup** (`wwwroot/js/MHxIotAlarm.js`): ไม่เก็บไฟล์เสียง — โหลด `no-store` ทุกครั้ง เล่นจบทิ้ง, เก็บแค่ข้อความ alarm ที่ยัง active ใน feed (ตามที่ผู้ใช้สั่งชัดเจน — อย่ากลับไปใช้ cache/ETag)

## สถานะ deploy (Fullscale_V2) — ทุกอย่าง deploy แล้ว แต่ **ไม่มีอะไร commit**
| โปรเจกต์ | live | backup |
|---|---|---|
| LabVenture | `Fullscale_V2\DEPLOY_LabVenture` (ผู้ใช้เลือกใช้ตัวนี้เป็นตัวจริง) | `_backup\LabVenture_before_testmode_2910` |
| Uroboros | `Fullscale_V2\Uroboros_proj` | `_backup\Uroboros_proj_before_testmode_2910` |
| BellBeast | `Fullscale_V2\BellBeast_proj` | `_backup\BellBeast_proj_before_ttsverify_2910` |

- **DB ของ DEPLOY แยกจาก dev**: dev `server\labventure.db` มี Event Class 20 ตัวที่ผมสร้าง; DEPLOY มี 52 ตัวของเดิม — ตัวจริงคือ DEPLOY
- Uroboros: ผู้ใช้เปิด task `eventclass.sync` + `alarm.eval` แล้ว (`Alarm.warmup`, `metric.history.sample` ยังปิด)
- ระหว่างทดสอบผู้ใช้เปิด Event Class หลายตัวใน DEPLOY (เช่น `cw1_rescl2_h1/h2`, `fw1_turb_h1`, `tw3_rescl2_h1`) — **จะเตือนจากผลแล็ปจริงด้วย** ถ้ายังไม่ตั้งใจ ให้ปิด
- ตอนเขียน handoff: feed BellBeast มี `lab:tw3_rescl2_h1` active (TW3 Cl 1.51)

## ข้อควรระวัง (เรียนรู้จาก session นี้)
- **test server ที่ใช้ `LV_DB_PATH` สำเนา ยังใช้ `server/config/*.json` และ `scenarios/*.json` ร่วมกับตัวจริง** — เคยเผลอเปิดโหมดโรคระบาดตัวจริง ~1 วิ (คืนค่าแล้ว) อย่าบันทึก config/เกณฑ์จาก test server
- ใช้ `UROBOROS_BASE_URL` (env) ชี้ fake Uroboros ตอนทดสอบ — ทั้ง kick และ alarmWatcher เคารพตัวแปรนี้
- อย่ารัน full server ทดสอบโดยไม่ล้าง `excel_queue`/`aquadat_queue` ในสำเนา (queueWorker ยิงของจริง)
- auto-mode classifier เคยห้าม Stop-Process ตัว LabVenture ที่ผู้ใช้รัน — ให้ผู้ใช้ STOP/START_FULLSCALE เอง
- repo dev ของ LabVenture และ BellBeast มีงานค้างจาก session อื่นปนเยอะ (~90 ไฟล์) — **ห้าม commit รวมโดยไม่ถาม**

## งานค้าง / ถัดไป
1. **commit** (ถามผู้ใช้ก่อน — แยก commit เฉพาะไฟล์ของงานนี้): LabVenture, Uroboros (`AlarmTestOverlay.cs`, `AlarmTestOverlayTests.cs` + 4 ไฟล์), BellBeast (`TtsService.cs`, `Program.cs` tts endpoint, `TtsVerifyTests.cs`, `AudioLibraryTests.cs`, `MHxIotAlarm.js`)
2. ยังไม่ได้ฟังเสียงที่เล่นจริงจาก popup ใหม่ — ให้ผู้ใช้ทดสอบด้วย test mode ขณะเปิด MHxView
3. คลิปที่ยังไม่มีใน BellBeast: `s_lab_rw_conduct`, `s_lab_rw_oc`, `s_lab_algae_rw_total` · `algae_rw_total_h2` → `lab:932` ไม่มีใน schema Uroboros
4. `Incoming.*` (ท่าม่วง/บางเลน) ไม่มี configparam_id — ผู้ใช้สั่งพักไว้
5. พารามิเตอร์ตามแผนที่ระบบยังไม่มี: แอมโมเนีย, TOC, SUVA, THMs, Chlorophyll, ชนิดสาหร่ายแยก · หน่วย `Algae.*` ใน nodes.json เขียน cell/mL แต่ค่าจริงเป็นหน่วย/100 มล.
6. น้ำท่วม/แผ่นดินไหว: เสนอเป็นสวิตช์เสริมแบบโรคระบาด (marquee + เตือนรายงาน 4–6 ชม.) — ยังไม่ได้ตัดสินใจ
7. ความไม่สอดคล้องในตัวแผน PDF: ความถี่ตรวจสาหร่าย CW (หน้า 9 vs 11), Residual Cl "5.0" (หน้า 6) ควรเป็น 0.5

## ไฟล์ทดสอบใน scratchpad (ชั่วคราว)
`C:\Users\peera\AppData\Local\Temp\claude\C--Users-peera-OneDrive-Desktop-LabVenture\1d1ce346-5220-4d08-a508-925eb2a01a0d\scratchpad\` — `harness.js` (18 checks, `LV_DB_PATH=<สำเนา> node harness.js`), `fake_uroboros.js` (:8898) · launch configs `.claude/launch.json`: "LabVenture Server (scenario test 8899)", "LabVenture Client (scenario test 5175)", "Fake Uroboros (test 8898)"

## Suggested skills
- `code-review` — review diff ของงานนี้ (แยกจากงานค้างอื่น) ก่อน commit
- `run` — เปิด test stack (8899/5175/8898) ยืนยัน test mode / panel
- `scrutinize` — ถ้าจะต่อยอดน้ำท่วม/แผ่นดินไหว หรือ scenario ซ้อนกัน
- `handoff:handoff` — ปิด session ถัดไป (เขียนลง `handoff\` และ `iot\Re-plan\Labventure_progressDDMM.md` ตามธรรมเนียม)
