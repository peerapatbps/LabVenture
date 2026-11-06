# Handoff — 2026-09-26 · Chem Lab QC (re-design `/chem-intake`)

อ่านก่อน:
1. [re-design.md](re-design.md) — design & architecture (ทำไม/โครงสร้าง/state machine/role)
2. [chem_lab_backend_spec.md](chem_lab_backend_spec.md) — contract `/api/chemlab/*`, DDL, กฎ lock, สูตร (**งานถัดไปอิงไฟล์นี้**)
3. Plan ที่อนุมัติ: `~/.claude/plans/c-users-peera-onedrive-desktop-sidecar-scalable-bear.md`

ไฟล์นี้ = สิ่งที่ทำ · ผลลัพธ์ · สิ่งที่ต้องทำต่อ · สิ่งที่ทดสอบแล้ว · สิ่งที่ขาด · sequence / situation test · edge case

---

## 0. สถานะสั้นๆ
| เรื่อง | สถานะ |
|---|---|
| Grill-me 19 คำถาม → Decisions D1–D17 | ✅ ผู้ใช้ยืนยันทุกข้อ |
| Frontend 5 แท็บ + trace + print | ✅ build ผ่าน, ทดสอบในเบราว์เซอร์ (mock) |
| LabVenture proxy `/api/chem-lab/*` + mock backend | ✅ |
| Backend Uroboros `/api/chemlab/*` | ❌ ยังไม่ทำ (spec พร้อม) |
| เกณฑ์คุณภาพจริง (PACl/ALUM) | ❌ ค่าสมมติ `verified:false` |
| commit | ❌ ยังไม่ commit (ผู้ใช้ไม่ได้สั่ง) |
| Server :3001 ที่รันอยู่ (หลัง :443) | ⚠ ยังเป็นโค้ดเก่า — ต้อง restart เอง |

## 1. สิ่งที่ทำ
- อ่าน TruckSidecar handoff/docs, `chem.db` schema (WDATA 14,777 แถว; SIDECAR_* 2 เที่ยวจริง), ฟอร์ม สคบ-14 (.doc ผ่าน antiword) และ กผจ-29 (.xlsx), Uroboros `data.db`
- Grill-me → decisions (ตารางใน plan / re-design §6)
- Server: `routes/chemLab.js`, `services/chemLabMock.js`, `services/carCreate.js` (refactor ออกจาก `routes/car.js`), config `lab_chem_spec.json`, `lab_case_tasks.json`, `services.json.chem_lab`
- Client: เขียน `pages/ChemIntake.jsx` ใหม่ + `pages/chemlab/*` 8 ไฟล์ + `config/chemLab.js`; route print ใน `App.jsx`; badge ใน `Layout.jsx`
- Dev tooling: `vite.config.js` รับ `API_TARGET` env; `.claude/launch.json` เพิ่ม "Server (verify 3002)" / "Client (verify 5174)" (เพื่อไม่ชน server ที่รันอยู่ :3001); `.gitignore` += `server/chemlab_mock.db`
- `CLAUDE.md`: อัปเดตบรรทัด ChemIntake + pattern "Chem lab"
- เขียน `chem_lab_backend_spec.md`, `re-design.md`, ไฟล์นี้
- Spawn task chip: แก้ `bg-earth-DEFAULT` (no-op) ใน ~11 ไฟล์เดิม

## 2. ผลลัพธ์ / ข้อค้นพบสำคัญ
- `chem.db` เป็น **WAL mode** → `node-sqlite3-wasm` เปิดได้แต่ query ไม่ได้ ("unable to open database file") → mock ใช้ `node:sqlite` (Node 24 built-in, experimental warning → รันด้วย `--no-warnings`)
- Git Bash heredoc **กิน backslash** ใน path (ทำให้ทดสอบหลอกว่า DB เปิดไม่ได้) — ใช้ `/` ใน script ทดสอบ
- Tailwind `bg-earth-DEFAULT` **ไม่สร้าง CSS** (DEFAULT → `bg-earth`) → modal โปร่งใส; แก้เฉพาะไฟล์ใหม่
- ข้อมูลจริง: สารเดียวกันจาก >1 บริษัทในวันเดียว 120 วัน (→ composite แยกบริษัท); ALUM ~6.2 เที่ยว/วัน (max 9), PACl ~2.5 (max 6); ข้ามเที่ยงคืน 6 เที่ยว
- ⚠ **ผลข้างเคียงที่เกิดจริง:** CAR ทดสอบ `car_log.id=4` key `73aaf14d-7788` ถูกสร้างใน `server/labventure.db` จริง และ **LINE push ออกไปกลุ่มจริง** (23:44) เพราะ verify server ใช้ `.env`/DB เดียวกัน — แจ้งผู้ใช้แล้ว **รอผู้ใช้ตัดสินว่าจะลบไหม**

## 3. สิ่งที่ต้องทำต่อ (เรียงตามลำดับ)
1. **ผู้ใช้ตัดสิน:** ลบ CAR ทดสอบ id=4 หรือไม่ (ห้ามลบเอง)
2. **Implement Uroboros `/api/chemlab/*`** ตาม spec — แนะนำ `Listener_CHEMLAB.cs` ตาม pattern `Listener_CHEM.cs`, route ใน `Program.cs` ใกล้ `/api/chem_report`; ใช้ `chemLabMock.js` เป็น reference
   - เปิด connection ใหม่ทุก request (chem.db ถูก swap); ตรวจ remaining/available **ภายใน transaction** (ดู E-21)
3. สลับ `services.json chem_lab.mock=false` → รัน sequence test §5 ซ้ำกับ Uroboros จริง
4. **ขอค่าเกณฑ์จริง** PACl/ALUM + `spec_ref` + form_code ALUM → แก้ `lab_chem_spec.json`, ตั้ง `verified:true`
5. ปิดช่องโหว่ใน §6 (gaps) ที่ผู้ใช้เห็นว่าจำเป็น — โดยเฉพาะ G1–G5
6. Restart server :3001 (หลัง :443) ให้โหลด route ใหม่ + `npm run build` client (dist ถูก build แล้วรอบหนึ่งใน session นี้)
7. ทดสอบกับผู้ใช้จริง (bypass role ไม่ใช่ตัวจริง): ชื่อใน audit/CAR เมื่อ login ผ่าน AquaDAT
8. Commit (เมื่อผู้ใช้สั่ง) — แยก commit: refactor carCreate / server chem-lab / client chem-lab / docs

## 4. สิ่งที่ทดสอบแล้ว (mock, วันที่ 26/09/2026)
วิธี: script ตรง `chemLabMock.handle()` (temp db) + เบราว์เซอร์ผ่าน verify servers 3002/5174 (bypass role) · หลังทดสอบลบ `chemlab_mock.db` และคืน `services.json` แล้ว

| # | ทดสอบ | ผล |
|---|---|---|
| T1 | GET bottles 24/09 (ไม่มี sidecar) / 26/09 (มี sidecar: SG, ใบนำส่ง, PACL C 4→15 / 13→25) | ✅ badge "ไม่มีบันทึก sidecar" / join ครบ |
| T2 | "รับทั้งหมด" → บันทึก → ผู้บันทึก+เวลา | ✅ |
| T3 | สร้าง composite → auto ไปแท็บวิเคราะห์ | ✅ n_bottles=2 |
| T4 | แก้ขวดก่อนมี attempt (not_received→received, มี reason) → recount | ✅ (script) |
| T5 | attempt inhouse กรอกไม่ครบ | ✅ 400 "กรอกค่า เบสิกซิตี้ ให้ครบ" |
| T6 | attempt 1 Al₂O₃ 8 (UI, สีแดง, preview ไม่ผ่าน) / attempt 2 8.5 (API) | ✅ verdict + key_value/key_min ถูก |
| T7 | final #2 → เคส suggested 4,308 kg = 28,720×(1−0.85), CAR ออก, badge 1 บน nav/tab | ✅ |
| T8 | เปลี่ยน final ขณะมีเคส / แก้ขวดที่ lock / เพิ่ม attempt ขณะมีเคส | ✅ 409 ทั้งหมด |
| T9 | scientist ตัดยอด / operator ติ๊กงาน | ✅ 403 |
| T10 | operator: default แท็บตัดยอด, ไม่เห็นแท็บ สคบ-14, candidates, confirm (16,000−4,308=11,692) | ✅ (ใช้สำเนา chem.db + เที่ยวสังเคราะห์ 0000099001 วันที่ 27/09) |
| T11 | remaining 0 → auto task ติ๊ก 'system'; ติ๊ก auto task เอง 409; ติ๊กที่เหลือ → closed + audit ครบ | ✅ |
| T12 | memo preview 09/2026 PACl N=2 M=1 → save "สคบฝผม 101/2569" → print A4 | ✅ |
| T13 | doc_no ซ้ำ | ✅ 409 |
| T14 | Trace drawer 0000014808 ครบ 5 ขั้น | ✅ |
| T15 | tablet 768px ไม่มี horizontal scroll; console มีแค่ error จาก negative test; server log ไม่มี error; `vite build` ผ่าน | ✅ |
| T16 | script: case target 0/auto tick, candidates exclude own tickets, memo dup, trace keys | ✅ |

**ยังไม่ได้ทดสอบ:** Uroboros จริง (ยังไม่มี) · ALUM ทั้ง flow · external_lab / supplier_coa ผ่าน UI · cancel case → เปลี่ยน final → เคสใหม่ · แก้ target (override) ผ่าน UI · เพิ่ม manual task ผ่าน UI · 2 บริษัทในวันเดียว · มือถือ 375px · print จริงลงกระดาษ/PDF (ฟอนต์ TH Sarabun) · login จริงผ่าน AquaDAT · production build หลัง :443

## 5. Sequence tests (สำหรับรันซ้ำกับ Uroboros)
สัญลักษณ์: ✅ ทดสอบแล้ว (mock) · 🟢 ทดสอบกับ Uroboros จริงแล้ว (27/09, ดู `chem_lab_backend_spec.md` §8.1) · 🟡 บางส่วน · ⬜ ยังไม่ทดสอบ

**SQ1 ปกติ ผ่าน** 🟢 (PACL บ.05 27/09)
รับขวด N → composite → attempt ผ่าน → final → verdict pass, **ไม่มีเคส/CAR** → memo รวมแถวนี้ "ผ่าน"

**SQ2 ไม่ผ่าน → ชดเชย → ปิด** ✅ (T3–T11) 🟢 (ALUM 25/09)
รับ 2 → composite → #1 fail → #2 fail (ตรวจซ้ำ 5.7) → final #2 → case open (suggested, CAR, 5 tasks) → operator ตัดยอดเที่ยวถัดไป → remaining 0 → auto task → ติ๊ก 4 งาน → closed

**SQ3 ตรวจซ้ำแล้วผ่าน** 🟡 (COA pass → inhouse pass → final #2; ยังไม่ได้ทดสอบ #1 fail → #2 pass ตรงๆ)
#1 fail → #2 pass → final #2 → pass ไม่มีเคส; memo แสดงค่า #2; trace เห็นทั้ง 2 ครั้ง

**SQ4 ผลจาก COA/lab ภายนอก** 🟢 (API; ยังไม่ได้ดู memo print ช่อง "-")
test_source supplier_coa, กรอกบาง param → param ที่ไม่กรอก `n/a`; verdict จาก param ที่มี; memo แสดง "-" ช่องที่ไม่มี

**SQ5 ยกเลิกเคสแล้วเปลี่ยนผล** 🟢 (PACL 24/09 — CAR#A ค้างจริง, เลือก final fail อีก → เคส #4 + CAR ใหม่)
final fail → case (+CAR#A) → cancel (reason) → final เปลี่ยนเป็น attempt ที่ผ่าน (reason) → verdict pass · CAR#A ค้างใน car_log (ต้องปิดเองที่หน้า CAR) · ถ้าเลือก final fail อีก → case ใหม่ + CAR#B

**SQ6 ไม่ผ่านที่ param รอง (Fe เกิน, Al₂O₃ ผ่าน)** 🟡 (suggested 0 + auto task ✓; override/un-tick ทดสอบในเคส ALUM 26/09 แทน)
suggested 0 → auto task ติ๊กทันที → scientist แก้ target (ต้องมีเหตุผล) → auto task un-tick → operator ตัด → ครบ → tick

**SQ7 ตัดยอดหลายเที่ยว / ข้ามเคส** 🟢 (เที่ยว 14813 ใช้ร่วมเคส #1/#2, available ลดถูก)
target 20,000 → ตัด 14,000 จากเที่ยว A (available A = 0 ถ้าตัดเต็ม) → ตัด 6,000 จากเที่ยว B · อีกเคสหนึ่งของบริษัทเดียวกันต้องเห็น A ด้วย available ที่ลดแล้ว

**SQ8 ขวดมาช้า** ⬜
composite มี attempt แล้ว → บันทึกขวดใหม่ของวันเดียวกัน received → ไม่ผูก composite, UI เตือน "ไม่ถูกรวม"

**SQ9 memo ช่วงซ้อน** ⬜
memo ก.ย. ออกแล้ว → memo 15/09–15/10 → preview ไม่มี composite ที่ออกไปแล้ว; N ยังนับขวดทั้งช่วง (ดู E-17)

**SQ10 Uroboros ล่ม (mock=false)** ⬜
ทุกแท็บแสดง error 502 "Cannot reach Uroboros chemlab" ไม่ crash; final fail ตอน Uroboros ล่ม → ไม่ออก CAR (เพราะ final ไม่สำเร็จ)

## 6. สิ่งที่ขาด (gaps) — ยังไม่ได้ทำ/ออกแบบ
| # | Gap | ผลกระทบ | ข้อเสนอ |
|---|---|---|---|
| G1 | ไม่มีการกลับรายการ offset | ตัดผิดแก้ไม่ได้, cancel case ไม่ได้เมื่อมี offset | endpoint void offset (reason) + audit |
| G2 | memo ยกเลิก/แก้เลขที่ไม่ได้ | พิมพ์ doc_no ผิด = ล็อก composites ถาวร | void memo (reason) → ปลด memo_id |
| G3 | สร้าง CAR ล้ม/PATCH car_key ล้ม ไม่มีปุ่ม retry | เคสไม่มี CAR หรือ CAR กำพร้า | ปุ่ม "ออก CAR" ในเคสเมื่อ car_key ว่าง |
| G4 | attempt ได้แม้ composite n_bottles=0 (ปลดขวดหมดก่อนวิเคราะห์) | ผลไม่มีขวดอ้างอิง | block attempt/final เมื่อ n_bottles=0 |
| G5 | เกณฑ์ใน memo ใช้ spec ปัจจุบัน ไม่ใช่ snapshot | แก้ spec ภายหลัง → เอกสารเก่าพิมพ์เกณฑ์ใหม่ | เก็บ spec snapshot ใน attempt/memo |
| G6 | ไม่มี upload ไฟล์ COA/รายงานภายนอก | เก็บแค่ข้อความอ้างอิง | ใช้ upload ของ Uroboros/Drive |
| G7 | ปิดเคสแล้วเปิดใหม่ไม่ได้ | ผู้ขายโต้แย้งภายหลัง | re-open (reason) |
| G8 | ชื่อผู้ใช้โหมด offline/bypass = `sub` (เช่น `bypass-operator_bypass`) | audit ระบุตัวคนไม่ได้เมื่อ AquaDAT ล่ม | ให้กรอกชื่อเมื่อ bypass |
| G9 | ไม่มี LINE/แจ้งเตือน operator ว่ามีเคสรอตัดยอด | พึ่ง badge อย่างเดียว | LINE เมื่อเปิดเคส/มีเที่ยว candidate ใหม่ |
| G10 | param หลักแบบ "max" (ยิ่งต่ำยิ่งดี) สูตรใช้ key_min เท่านั้น | suggested = 0 | ขยายสูตรถ้ามีกรณีจริง |
| G11 | ไม่มีรายงานสรุปชดเชยรายเดือน/ต่อบริษัท | ฝ่ายบัญชีต้องไล่เอง | export CSV จาก LAB_OFFSET |
| G12 | ไม่มี unit test อัตโนมัติ | regress ง่าย | ย้าย script ทดสอบ mock เป็น test |

## 7. Situation tests (สถานการณ์หน้างาน)
| # | สถานการณ์ | ระบบควรทำ | สถานะ |
|---|---|---|---|
| ST1 | นักวิทย์ไปเก็บขวดวันจันทร์สำหรับ ส–อา | เลือกทีละวัน (DAYIN) บันทึก; composite แยกวัน | ✅ ด้วย design (ยังไม่ทดสอบหลายวัน) |
| ST2 | operator ไม่ได้บันทึก sidecar | ขวดยังขึ้น (WDATA เป็นฐาน) + badge ส้ม; trace ขั้น 2 "ไม่มีบันทึก sidecar" | ✅ T1 |
| ST3 | รถคันเดิมส่ง 2 รอบในวันเดียว | TICKET1 ต่างกัน = 2 ขวด | ✅ ด้วย design |
| ST4 | ขวดแตก/หาย | "ไม่ได้รับ" + remark; ไม่รวม composite | ✅ |
| ST5 | ส่งตัวอย่างไป lab ภายนอก ผลมา 2 สัปดาห์ | composite ค้าง pending; memo ข้าม (pending_final) | ⬜ |
| ST6 | ผู้ขายโต้แย้งปริมาณชดเชย | แก้ target + เหตุผล (audit) | ⬜ UI |
| ST7 | ผู้ขายไม่ส่งของอีกเลย | เคส open ค้าง, remaining > 0 ไม่มี candidates | ⬜ (ไม่มีทางปิดอื่น → G) |
| ST8 | มี 2 บริษัทส่ง PACl วันเดียว | 2 กลุ่ม/2 composite; memo แสดงชื่อบริษัทใต้วันที่ | ⬜ ไม่มีข้อมูลทดสอบ |
| ST9 | AquaDAT ล่ม (stage 0/2) → bypass login | ใช้งานได้ แต่ชื่อใน audit ไม่ใช่คน (G8) | ⬜ |
| ST10 | chem.db ยังไม่ sync (รถชั่งออกแล้ว แต่ Uroboros_mini ยังไม่ upload) | เที่ยวยังไม่ขึ้นในรายการขวด จนกว่า sync (≤ 5 นาที + รอบดาวน์โหลด) | ⬜ |
| ST11 | ยกเลิกตั๋วในโปรแกรมตาชั่งหลังรับขวดแล้ว | ขวดกำพร้า (E-12) | ⬜ |
| ST12 | LINE token หมดอายุ | CAR ยังสร้าง, line_sent_at ว่าง, log warn | ⬜ |

## 8. Edge cases
| # | กรณี | พฤติกรรมปัจจุบัน | สถานะ |
|---|---|---|---|
| E-1 | ชั่งเข้าก่อนเที่ยงคืน ออกหลัง | นับวัน DAYIN; UI แสดง "(+1)" | ✅ handled |
| E-2 | WDATA มีเฉพาะ STAT='2' | รถที่ยังไม่ชั่งออกไม่ขึ้น | by design |
| E-3 | PRODUCT '00'/'02' | ไม่แสดง | by design |
| E-4 | แก้ขวดที่บันทึกแล้วโดยไม่ใส่เหตุผล | UI เปิด ReasonModal; API 400 | ✅ |
| E-5 | กด save โดยไม่มีการเปลี่ยนแปลง | ข้าม, ไม่ audit | ✅ |
| E-6 | ปลดขวดทั้งหมดออกจาก composite ก่อนวิเคราะห์ | composite n=0 ยังอยู่ → วิเคราะห์ได้ | ⚠ G4 |
| E-7 | สร้าง composite ซ้ำ (2 แท็บ) | UNIQUE → 409 | ✅ |
| E-8 | inhouse ไม่กรอก °C ของ RD | 400 | ✅ (logic) |
| E-9 | ค่าที่กรอกไม่ใช่ตัวเลข | 400 | ✅ (logic) |
| E-10 | final ซ้ำ attempt เดิม | ไม่ต้อง reason; ถ้ามีเคส 409 | ✅ |
| E-11 | final ครั้งที่ 2 ส่งซ้ำ (network retry) | 409 เพราะมีเคสแล้ว → ไม่ออก CAR ซ้ำ | ✅ |
| E-12 | TICKET1 หายจาก WDATA หลัง chem.db swap (ตั๋วถูกยกเลิก) | LAB_BOTTLE กำพร้า, trip = null, net 0 ในสูตรชดเชย | ⚠ ยังไม่จัดการ |
| E-13 | TICKET1 counter reset ในอนาคต | ชน PK LAB_BOTTLE | ⚠ ความเสี่ยงต่ำ |
| E-14 | suggested ติดทศนิยม | ปัด kg เต็ม | ✅ |
| E-15 | target < ยอดที่ตัดแล้ว | 400 | ✅ (logic) |
| E-16 | target เปลี่ยนแล้ว remaining > 0 อีก | auto task un-tick | ✅ (logic) |
| E-17 | N ใน memo | = ขวด received ทั้งช่วง (รวมที่ออก memo ก่อนหน้า/ไม่ได้อยู่ใน composite) | ❓ ยืนยันความหมายกับผู้ใช้ |
| E-18 | RD วัดคนละอุณหภูมิในงวดเดียว | หัวตาราง "ที่ ..... °C" + "@x°C" รายแถว | ✅ |
| E-19 | offset เที่ยวที่เป็นของเคสตัวเอง | ถูกกรองออก | ✅ |
| E-20 | offset เที่ยววันเดียวกับตัวอย่าง (เที่ยวที่ขวดไม่ได้รับ) | ไม่ขึ้น (ต้อง DAYIN > sample_date) | ❓ ยืนยันกับผู้ใช้ |
| E-21 | operator 2 เครื่องตัดยอดพร้อมกัน | mock ตรวจ remaining นอก tx → อาจเกิน | ⚠ Uroboros ต้องตรวจใน tx |
| E-22 | role = null (login จริง ไม่อยู่ whitelist) | เขียนได้ทุกอย่างรวม offset | by design (เหมือน ROLE_PAGES) |
| E-23 | spec ไม่มี chemical ของ composite | 400 ที่ attempt; UI แสดง error | ✅ |
| E-24 | mock ถือ handle chem.db ค้าง | บน Windows อาจกันการ swap ไฟล์ถ้าชี้ path ที่ Uroboros ใช้ | ⚠ mock ใช้ dev เท่านั้น |
| E-25 | cases/composites list ยาวมาก | ไม่มี paging (composite กรองช่วงวันที่ default 30 วัน) | ⚠ ภายหลัง |
| E-26 | window.open print ถูก popup blocker | Memo list มีลิงก์ "พิมพ์" สำรอง | ✅ |

## 9. คำสั่ง/เครื่องมือที่ใช้
- Verify ไม่ชน server เดิม: `.claude/launch.json` → "LabVenture Server (verify 3002)" + "LabVenture Client (verify 5174)" แล้ว POST `/api/auth/bypass {role}` (dev) → `/labventure/chem-intake`
- ทดสอบ mock ตรง: `node --no-warnings <script>` เรียก `require('server/services/chemLabMock').handle(cfg, dir, ctx)` (ใช้ `/` ใน path)
- ทดสอบตัดยอดโดยไม่แตะ chem.db จริง: `sqlite3 -readonly chem.db ".backup <scratch>"` → เพิ่มแถว WDATA สังเคราะห์ → ชี้ `mock_chem_db` ชั่วคราว → **คืนค่า** `services.json`
- ⚠ อย่าทดสอบ final fail บน DB/.env จริงโดยไม่ปิด LINE (`LINE_CHANNEL_ACCESS_TOKEN` / `LINE_GROUP_ID`) — จะส่งเข้ากลุ่มจริง

## 10. Suggested skills (session ถัดไป)
- **grill-me** — ถ้าต้องตัดสิน gaps G1–G7 / E-17 / E-20 กับผู้ใช้ก่อนลงมือ
- **scrutinize** — รีวิว `chemLabMock.js` (กฎ lock/สูตร) ก่อนพอร์ตเป็น C# และรีวิว C# ที่เขียนเสร็จเทียบ spec
- **code-review** — diff ของ session นี้ (ยังไม่ commit) โดยเฉพาะ `routes/chemLab.js` (auth/role) และ refactor `car.js`
- **run** — ยืนยัน flow กับ Uroboros จริงหลังสลับ `mock:false`
- **security-review** — proxy ส่ง actor ผ่าน header/body ไป Uroboros (:443 plain HTTP); ตรวจว่า Uroboros ไม่รับ request ตรงที่ปลอม actor ได้
