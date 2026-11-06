# Handoff 26/10/2569 (2026-10-26)

วันนี้มี 3 งาน: (A) Record จำหลักเวลา — session เช้า · (B) Chem-intake re-design ให้ย้อนขั้นตอนได้ — session บ่าย · (C) Chem-intake re-design 2 (แยกรับ/ผสม, ผสมหลายใบ, final ต่อใบ, Lab ภายนอก) + เหตุผลไม่บังคับ — session เย็น
**ทุกงาน deploy ขึ้น Fullscale_V2 แล้ว แต่ยังไม่ commit** (LabVenture และ Uroboros) — งาน C แทนที่ UI/กฎบางส่วนของงาน B

---

## A. Record: จำหลักเวลาที่ user เลือก (session เช้า)
หน้า `/labventure/record` — เลือกหลักเวลาเองแล้วค้างค่าไว้ (รวมตอนเปลี่ยนวัน) จน F5/ออกจากหน้า
- โค้ด: `client/src/pages/Record.jsx` (`userPickedSlotRef`; timer รายนาที return ถ้า ref = true; `handleSlotChange()` ตั้ง ref) — ไฟล์มี diff อื่นค้างด้วย
- ทดสอบบน Vite :5173 ผ่าน · deploy ครั้งแรก bundle `index-D8RpSC8s.js` (เก่าสุดเก็บที่ `DEPLOY_LabVenture\client\dist.bak_20261026`)
- ระบบที่เคยดับหลัง deploy ตอนเช้า → ตอนบ่ายพบว่ารันอยู่ (:8889 เสิร์ฟ `D8RpSC8s`) — ไม่ต้องตามต่อ
- ⚠ dist ปัจจุบันบนเครื่องจริง (`C5u7lCAz`, งาน B) build จาก working copy เดียวกัน → **มีการแก้ Record รวมอยู่ด้วย**
- ค้าง: ทดสอบ Record บน :443 ยังไม่ได้ทำ · OpRecord.jsx อาจต้องการพฤติกรรมเดียวกัน (ยังไม่แตะ)

---

## B. Chem-intake re-design — ทุกขั้นย้อนกลับได้ (session บ่าย)
ปัญหาเดิม: flow รับขวด → composite → วิเคราะห์ → final → เคส → สคบ-14 ล็อกต่อกันเป็นทอดและแทบไม่มีทางย้อน
- **Plan (อนุมัติแล้ว):** `C:\Users\peera\.claude\plans\sequence-generic-marble.md`
- **กฎ/API ใหม่ทั้งหมด:** `handoff/chem_lab_backend_spec.md` §3 (ตาราง endpoint ใหม่ท้ายตาราง) และ §4.0 — อ่านก่อนแตะโค้ด
- หลัก: แก้ขั้นล่างได้จนกว่าขั้นบนจะ commit; จุดล็อก = **เลือกผล final**; การย้อนทุกครั้งต้องมี `reason` + LAB_AUDIT

การตัดสินใจของผู้ใช้:
| เรื่อง | ตัดสิน |
|---|---|
| ผลวิเคราะห์พิมพ์ผิด | แก้ตรงๆ / ลบ (soft) ได้จนกว่าจะเลือก final |
| ขวดมาช้า / กดผิด | แก้ได้จนกว่าจะเลือก final, n_bottles นับใหม่ + ปุ่ม "รวมเข้า composite" |
| CAR | **ถอด UI ที่ผูกกับ CAR ออกจาก chem-lab ไปก่อน** (endpoint `car-draft`/`cases/:id/car` ยังอยู่ ไม่ถูกเรียก; CARLog.jsx ยังมีโค้ด `chemLabCase` ที่ไม่ถูกใช้แล้ว) |
| UI | Pipeline board (6 คอลัมน์ตาม stage) + หน้ารายละเอียดแบบ stepper |
| ยกเลิกเคส | ทำผ่าน "ย้อนผล final" เท่านั้น (ปุ่มยกเลิกเคสเดี่ยวๆ ถูกเอาออก) |

ไฟล์ที่เปลี่ยน (ดู `git status` / `git diff`):
- ใหม่: `client/src/pages/chemlab/PipelineBoard.jsx`, `WorkflowDetail.jsx`
- **ลบ:** `client/src/pages/chemlab/BottlesTab.jsx`, `AnalysisTab.jsx` (เดิมเป็น untracked — ไม่มีใน git; เนื้อหาย้ายไปอยู่ใน WorkflowDetail)
- แก้: `ChemIntake.jsx`, `config/chemLab.js` (TABS/STAGES/stageOf), `chemlab/shared.jsx` (ReasonModal + consequences), `CasesTab.jsx`, `OffsetTab.jsx`, `MemoTab.jsx`, `client/src/api.js` (`del(path, body)`), `server/routes/chemLab.js` (PUT attempts ผ่าน `evaluate()`, guard void offset), `server/services/chemLabMock.js`, `CLAUDE.md`
- Uroboros (repo `C:\Users\peera\OneDrive\Desktop\Uroboros\Uroboros`, ไฟล์ **untracked**): `Uroboros/Listener_CHEMLAB.cs`, `Uroboros.Tests/ChemLabServiceTests.cs` (+3 tests)

ทดสอบแล้ว:
- mock: สคริปต์ `C:\Users\peera\AppData\Local\Temp\claude\C--Users-peera-OneDrive-Desktop-LabVenture\28255379-5abe-4ff3-9e9b-5c2774b945e5\scratchpad\mock_flow_test.js` (รันกับสำเนา `Fullscale_V2\Uroboros_proj\media\chem_20261012_143147.db` เพราะ chem.db บน Desktop ไม่มีเที่ยวหลัง 26/09) — ครบทุกเส้นทางรวม offset → close → void → reopen → unset final
- browser (mock, superadmin bypass บน :3002/:5174): board, stepper, ย้อน final (ถูก block เมื่อมี memo), void memo, แก้ attempt ผ่าน proxy; tablet 768px ไม่มี horizontal scroll
- Uroboros `dotnet test --filter ChemLabServiceTests` 8/8 ผ่าน

Deploy (ผู้ใช้สั่ง):
- Uroboros: STOP_FULLSCALE → `dotnet publish ... -o Fullscale_V2\Uroboros_proj` → START; migration คอลัมน์ใหม่ใน `chemlab.db` จริงแล้ว; smoke test `/pipeline` OK
- LabVenture: copy `client/dist` (bundle `index-C5u7lCAz.js`) + `server/routes/chemLab.js` + `server/services/chemLabMock.js` → restart เฉพาะ LabVenture (start.bat hidden); :443 เสิร์ฟ bundle ใหม่แล้ว
- **ไม่ได้ deploy** `server/routes/progress.js` (repo แก้ JarTest mapping 24/10 ยังไม่เคยขึ้นเครื่องจริง — ไม่เกี่ยวงานนี้, ต้องถามผู้ใช้)
- Backup สำหรับ rollback: `Fullscale_V2\_backup\Uroboros_bin_before_chemlab_unwind_2610` (exe/dll/pdb + chemlab.db) และ `Fullscale_V2\_backup\LabVenture_before_chemlab_unwind_2610` (dist + 2 ไฟล์ server)

---

## C. Chem-intake re-design 2 + เหตุผลไม่บังคับ (session เย็น — **deploy แล้ว, ยังไม่ commit**)
ผู้ใช้ขอ: แยกรับขวด/ผสม (คนละคน), ผสมซ้ำ/ซ้อนขวดได้อิสระ, เลือกขวดผสมจาก list แล้วบันทึกผล (กล่องแดง=ไม่ผ่าน/เขียว=ผ่าน), Lab ภายนอกเป็นแท็บแยก (list กรองวันที่ส่ง default วันนี้), เอา COA ผู้ขายออก, ผลวิเคราะห์เป็นแท็บแยก, final เปลี่ยนได้ + ติดชื่อคนกด → ต่อมา "change ใดๆ กดยืนยันได้แม้ไม่ใส่หมายเหตุ"
- **กฎ/API ทั้งหมด:** `handoff/chem_lab_backend_spec.md` §4.1 (re-design 2) + §4.2 (reason optional) + ตาราง endpoint 27/10 ใน §3 — อ่านก่อนแตะโค้ด (§4.0/§4 เก่าบางข้อถูกแทนแล้ว)
- การตัดสินใจของผู้ใช้: final **ต่อใบผสม**; สคบ-14 เลือกใบผสมจาก list (default ติ๊กทั้งหมด); เคสชดเชยเลือกวิธีได้ (ตามใบผสม / ทั้งวัน / เลือกคันเอง); ผสม = เลือกขวด + หมายเหตุ (ไม่เก็บ %); Lab ภายนอก = ส่งจากแท็บผลวิเคราะห์ → รอผล
- ผมตัดสินเอง (ผู้ใช้ไม่ได้คัดค้าน): เที่ยวรถหนึ่งอยู่ในเคสที่ไม่ cancelled ได้เคสเดียว (409); การ์ดกระดานอยู่ในคอลัมน์ของใบที่ช้าที่สุด
- ไฟล์: Uroboros `Uroboros/Listener_CHEMLAB.cs` (เขียนใหม่ + migration), `Uroboros.Tests/ChemLabServiceTests.cs` (12 tests) · LabVenture `server/services/chemLabMock.js` (เขียนใหม่), `server/routes/chemLab.js` (+`POST /ext-sends/:sid/result`, ห้าม supplier_coa ใหม่), client ใหม่ `chemlab/{BottlesTab,MixTab,AnalysisTab,ExternalTab}.jsx` (BottlesTab ชื่อเดิมแต่เนื้อหาใหม่), เขียนใหม่ `ChemIntake.jsx`, `WorkflowDetail.jsx` (= ภาพรวมตัวอย่าง), แก้ `config/chemLab.js`, `shared.jsx`, `PipelineBoard.jsx`, `MemoTab.jsx`, `CasesTab.jsx`, `TraceDrawer.jsx`, `CLAUDE.md`
- ทดสอบ: mock `C:\Users\peera\AppData\Local\Temp\claude\C--Users-peera-OneDrive-Desktop-LabVenture\a09c14e0-b445-4618-ae47-e673e764696b\scratchpad\mock_flow2_test.js` (83 PASS; `node --no-warnings mock_flow2_test.js [migrate]`, ใช้ `chem_copy.db` ในโฟลเดอร์เดียวกัน) · `dotnet test --filter ChemLabServiceTests` 12/12 · browser mock ครบ flow (รับ→ผสม 2 ใบซ้อน→ผล→final fail custom 3 คัน→ส่ง Lab→กรอกผล→final pass→สคบ-14 เลือก) + tablet 768 ไม่มี h-scroll · รอบ reason-optional ไม่ได้ลอง browser
- **Deploy (2 รอบ):** 14:46 re-design 2 (migration chemlab.db จริงผ่าน: composite #1 (2 ขวด) / #2 (8 ขวด) → ใบที่ 1 ตรงกับ backup) · 14:56 reason-optional — :443 เสิร์ฟ `index-rFFcYuCw.js`
- Rollback (`Fullscale_V2\_backup\`): `Uroboros_bin_before_chemlab_mix_2710` (bin + chemlab.db **ก่อน migrate**) / `LabVenture_before_chemlab_mix_2710` (dist `C5u7lCAz`) · `Uroboros_bin_before_optreason_2610` / `LabVenture_before_optreason_2610` (dist `CsR3_nfU`) — rollback Uroboros ไปก่อน re-design 2 ต้องคืน chemlab.db ด้วย (โครงสร้างตารางเปลี่ยน) และคืน LabVenture คู่กัน
- services.json คืนเป็น `mock:false` แล้ว; ตรวจหลัง deploy แค่ GET ไม่ได้เขียนข้อมูลจริง

## ข้อสังเกตสำคัญ
- :443 = BellBeast → node :8889 จาก **`Fullscale_V2\DEPLOY_LabVenture`** (ไม่ใช่ repo) → แก้ client ต้อง build แล้ว copy dist ไปที่นั่น; server code copy เฉพาะไฟล์ที่ต้องการ (อย่าทับ `.env`, `config/`, `*.db`, `node_modules`)
- `STOP_FULLSCALE.ps1` หยุดทุกอย่าง (BellBeast, Uroboros, Wayfarer, LabVenture); restart เฉพาะ LabVenture ใช้ script elevated ที่ kill cmd `start.bat` + node :8889 แล้ว `Start-Process cmd /c start.bat` hidden (`LABVENTURE_HIDDEN=1`) — อย่าใช้ `Start-Process -Wait` (จะรอ node ไม่จบ)
- ทดสอบ chem-lab แบบ mock: ตั้ง `services.json chem_lab.mock=true` + `mock_chem_db`/`mock_lab_db` ชี้ไฟล์ใน scratchpad, ใช้ launch config "LabVenture Server (temp db 3002)" + "LabVenture Client (verify 5174)", login ผ่าน `POST /api/auth/bypass {role:'superadmin'}` — **คืน services.json ทุกครั้ง** (ตอนนี้ mock:false แล้ว)
- Login หน้า :443 มีปุ่ม bypass Scientist/Operator ใช้ทดสอบได้

## งานถัดไป
1. ให้ผู้ใช้ลองหน้าจริง `http://localhost:443/labventure/chem-intake` (Scientist + Operator) — แท็บใหม่ รับขวด/ผสม/ผลวิเคราะห์/Lab ภายนอก, เลือกวิธีชดเชย, เปลี่ยน final โดยไม่ใส่เหตุผล, เลือกใบลง สคบ-14 (กด "บันทึกและเปิด PDF" ยังไม่เคยลองหลัง re-design — memoDocx ใช้ rows เดิม + มี `seq/tickets` เพิ่ม), void offset จากแท็บ "ตัดยอดชดเชย"
2. ทดสอบ Record (งาน A) บน :443
3. **Commit** (ถามก่อน): LabVenture — แยก commit Record / chem-intake (รวม re-design 2) และเลือกไฟล์เอง (working copy มีไฟล์ค้างอื่นจำนวนมาก); Uroboros — ไฟล์ chem lab ยัง untracked ต้อง `git add` ด้วย; ควรย้าย `mock_flow2_test.js` เข้า repo (scratchpad เป็นของ session นี้)
4. ถามผู้ใช้เรื่อง `progress.js` ว่าจะ deploy หรือไม่
5. เรื่องค้างเดิมใน spec §7 (เกณฑ์ `lab_chem_spec.json` ยังเป็นค่าสมมติ, ไฟล์แนบ COA ยังไม่มี upload) และการนำ CAR กลับมาผูกกับ chem-lab ภายหลัง

## Suggested skills
- `code-review` — ตรวจ diff chem-intake (B+C) + Record + `Listener_CHEMLAB.cs` ก่อน commit
- `run` — เปิดแอปทดสอบ (`.claude/launch.json`)
- ตอบเป็นภาษาไทยตาม memory
