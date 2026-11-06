# Handoff — 2026-09-27 · Chem Lab QC: Uroboros จริง + E2E ครบ + CAR ออกด้วยคน + เลข CAR อัตโนมัติ

อ่านก่อน (ไม่ซ้ำเนื้อหาในไฟล์นี้):
1. [chem_lab_backend_spec.md](chem_lab_backend_spec.md) — contract `/api/chemlab/*` (อัปเดตแล้ว: chemlab.db, :8888, pointer, §5 CAR flow, §8.1 ผล E2E กับ Uroboros)
2. [handoff2609.md](handoff2609.md) — sequence tests SQ1–SQ10 (§5 มีสถานะ 🟢/🟡 แล้ว), gaps G1–G12 (§6), situation/edge cases (§7–8)
3. [re-design.md](re-design.md) — design/architecture
4. `chem_compensation_workflow.docx` (โฟลเดอร์นี้) — เอกสารไปคุยหน่วยงาน: decision tree การชดเชย + สูตร + ตัวเลือกบันทึก Aquadat
5. Plan เดิม: `~/.claude/plans/backend-silly-lighthouse.md`

---

## 0. สถานะ
| เรื่อง | สถานะ |
|---|---|
| Uroboros `/api/chemlab/*` (`Listener_CHEMLAB.cs`) + publish `Fullscale_V2\Uroboros_proj` | ✅ |
| LabVenture ใช้ Uroboros จริง (`services.json` mock:false, :8888) | ✅ |
| E2E (API + browser, superadmin bypass นอกไซต์) รอบ 1 + รอบ 2 | ✅ ผ่านทั้งหมด (spec §8.1, ด้านล่าง §2) |
| CAR ไม่ออกอัตโนมัติ → คนกด "ออก CAR" ผ่านฟอร์ม CAR ปกติ | ✅ |
| เลข CAR อัตโนมัติ `CQ 01/2569` | ✅ (ยังไม่ได้ออกใบจริงด้วยเลขอัตโนมัติ) |
| `.env` LINE token | ✅ คืนแล้ว — **ออก CAR = ส่ง LINE กลุ่มจริง** |
| spec / CLAUDE.md / handoff2609 §5 | ✅ อัปเดตแล้ว |
| คืน `chem.current.txt` + ลบข้อมูลทดสอบ | ❌ ผู้ใช้สั่ง "เก็บไว้ก่อน" |
| workflow การชดเชยทางบัญชี / Aquadat | ❓ รอผู้ใช้ไปคุยหน่วยงาน (ใช้ docx ข้อ 4) |
| commit ทั้ง 2 repo | ❌ ผู้ใช้ยังไม่สั่ง |

## 1. ระบบที่รัน (เครื่อง dev ผู้ใช้)
- :443 BellBeast (proxy `/labventure/*` → :3001) · :8888 Uroboros · :3001 LabVenture (node ลูกของ `LabVenture.exe`)
- เข้าเว็บ: `http://localhost:443/labventure/...` (ที่ :3001 ตรง `/labventure/api` ไม่ map)
- Login นอกไซต์: ปุ่ม Dev Bypass "Super Admin" ในหน้า login (`/api/auth/bypass` role superadmin → actor `dev-superadmin`) — **ห้ามกรอก AD credential แทนผู้ใช้**
- Restart LabVenture หลังแก้ server: kill node ที่ฟัง :3001 แล้ว `Start-Process LabVenture.exe` (Stop-Process ตัว LabVenture.exe เดิมขึ้น Access denied แต่ node ตายและตัวใหม่ขึ้นปกติ)
- สคริปต์ทดสอบ API (Python, ส่ง UTF-8 ถูก — **อย่าใช้ curl -d ภาษาไทยใน Git Bash, จะเพี้ยน**): session scratchpad `comp_test.py`, `e2e2_api.py` (cookie `ck.txt` จาก bypass) — scratchpad อาจหายเมื่อจบ session

## 2. สิ่งที่ทำ session นี้ (หลัง handoff เช้า)
**บั๊ก/พฤติกรรมที่แก้ (LabVenture)**
- `server/services/line.js` — `pushCarMessage` คืน `true/false` (token ว่าง = false); สัญลักษณ์เกณฑ์เคยกลับด้าน → ตอนนี้ตรง CARLog (`above` ⇒ `≤`, `below` ⇒ `≥`) — กระทบ LINE ของ CAR ทุกใบ
- `server/services/carCreate.js` (ไฟล์ใหม่ untracked) — `line_sent_at` ตั้งเฉพาะส่งจริง; `nextCarNumber` / `fiscalYearBE` / `CAR_PREFIXES`; `car_prefix` + `car_number` ว่าง → ออกเลขตอน insert; เลขซ้ำ (car_number+car_type) → throw 409
- `server/routes/car.js` — POST `/` จับ error `{status}`; ใหม่ `GET /api/car/next-number?prefix&car_type`
- `server/routes/chemLab.js` — PUT final ไม่ออก CAR แล้ว; `carFromCase()` (ค่าที่พบ/เกณฑ์ = param หลักถ้าตก ไม่งั้น param แรกที่ตก; เกิน max → above); ใหม่ `GET /cases/:id/car-draft` (prefill + `car_prefix:'CQ'`) และ `POST /cases/:id/car {car_key}` (ตรวจ CAR มีจริง / เคสยังไม่มี car_key / ไม่ถูกยกเลิก)
- `client/src/pages/CARLog.jsx` — deep link `/car?key=<unique_key>`; รับ `location.state.chemLabCase` → แถบเตือน + หลังออกใบ POST link แล้ว navigate กลับเคส; dropdown รหัส HA/EA/OA/CC/CQ/LC + placeholder "อัตโนมัติ: CQ NN/ปีงบ"
- `client/src/pages/chemlab/CasesTab.jsx` — แถบ "ยังไม่ได้ออก CAR" + ปุ่ม "ออก CAR" (เปิดฟอร์ม prefill) / "ดู CAR"; ปุ่ม "ผลวิเคราะห์ (Composite #N)"
- `client/src/pages/chemlab/AnalysisTab.jsx` — modal ผลไม่ผ่านบอก "ยังไม่ได้ออก CAR"; แถบเคสมี "ดู CAR"
- `client/dist` build ใหม่; `CLAUDE.md` บรรทัด Chem lab; spec §0/1/2/4/5/6/8.1; handoff2609 §5

**กติกาเลข CAR (ผู้ใช้กำหนด)**: `CQ 01/2569` · รีเซ็ตทุกปีงบประมาณ (1 ต.ค. → ปี พ.ศ.+1) · นับแยก CAR/PAR · เว้นว่าง = auto, พิมพ์เอง = override (ไม่ตรวจรูปแบบ; ถ้าพิมพ์ตรงรูปแบบ auto จะนับต่อจากเลขนั้น) · chem-lab ใช้ CQ

**ข้อมูลทดสอบ (เก็บไว้ตามผู้ใช้สั่ง)**
| ที่ | อะไร | backup |
|---|---|---|
| `Fullscale_V2\Uroboros_proj\media\chem.db` | mock trips TICKET1 14810–14825 (+SIDECAR) บ.01/02/04/05 วันที่ 25–27/09 | `chem.db.bak-mocktest` (ก่อน mock ชุดแรก), `chem.db.bak-e2e2` (ก่อนชุด บ.04) |
| `media\chem.current.txt` | ชี้ `chem.db` | `chem.current.txt.bak-chemlabtest` (เดิม `chem_20260710_175647.db`) |
| `Uroboros_proj\chemlab.db` | composite #1–12, case #1–8 (#7 ยังไม่ออก CAR — ไว้ให้ผู้ใช้ทดสอบเลขอัตโนมัติ), memo #1–3 | — |
| `LabVenture\server\labventure.db` `car_log` | ทดสอบ id 5–11 (id 10 = `697c67e8-00a2` flow เก่าไม่มีเลข; id 11 = `CAR-TEST-E2E2-01` ส่ง LINE จริงแล้ว) | `labventure.db.bak-20260927` (ก่อนลบ CAR id 4) |
| `LabVenture\server\.env` | คืนแล้ว | `.env.bak-chemlabtest` (ลบได้) |

## 3. งานถัดไป
1. ผู้ใช้ทดสอบออก CAR จากเคส #7 ด้วยเลขอัตโนมัติ (ควรได้ `CQ 01/2569`; ส่ง LINE จริง) — ตรวจ `car_log.car_number` + `LAB_CASE.car_key`
2. รอผลคุยหน่วยงาน (docx) → ตัดสิน: บันทึกชดเชยใน Aquadat แบบไหน (ตัวเลือก A–D ใน docx) → ถ้ากระทบ Sidecar ค่อยออกแบบ (`Sidecar_prj/TruckSidecar/Aquadat.cs` `aq_outbox` upsert ต่อ source_track + PendingDaily รวมรายวัน — แถวติดลบ `OFFSET#id` ใช้กลไกเดิมได้)
3. รอตัดสิน: ยกเลิกเคสแล้ว CAR ที่ผูกอยู่ทำอย่างไร (ปิดอัตโนมัติ / เตือน)
4. ถามผู้ใช้ก่อนเริ่มใช้จริง: ลบ CAR ทดสอบ 5–11, ข้อมูลใน chemlab.db, mock trips ใน chem.db, คืน `chem.current.txt`
5. ตัวเลือกเสริมที่เสนอไว้ (ยังไม่สั่ง): บังคับรูปแบบเลข CAR ตอนพิมพ์เอง; บังคับกรอก "ผู้รับ" ในฟอร์ม CAR (มี * แต่ไม่บังคับ); Dashboard CAR prefill CQ; prefix "สคบฝผม " ในช่องเลขที่ สคบ-14 (ตอนนี้เป็น placeholder); ตารางผลวิเคราะห์แคบ
6. Commit เมื่อผู้ใช้สั่ง — Uroboros: เฉพาะ `Listener_CHEMLAB.cs`, `Program.cs` (block chemlab), `Uroboros.Tests/ChemLabServiceTests.cs` (repo มีงาน uncommitted อื่นของผู้ใช้ — อย่าปน); LabVenture: แยก commit ตาม handoff2609 §3.8 + รวม `server/services/carCreate.js` (untracked)
7. ค้างเดิม: เกณฑ์จริง PACl/ALUM (`lab_chem_spec.json` `verified:false`), gaps G1–G5, E-17/E-20

## 4. ข้อควรระวัง
- **LINE ใช้งานจริง** — ทดสอบออก CAR ต้องถามผู้ใช้ก่อน (ครั้งก่อนล้าง token เงียบๆ แล้วผู้ใช้ต้องถาม — ถ้าจะปิดชั่วคราวให้บอกและคืนทันที)
- `/api/auth/bypass` เปิดตลอด + token ไม่ verify signature; Uroboros :8888 ไม่มี auth (ปลอม actor ได้) — ยังไม่แก้
- เคสที่ไม่มีเที่ยวหลังวันตัวอย่าง (เช่น #5 ALUM บ.01 27/09) ตัดยอดไม่ได้จนมีเที่ยวใหม่ — ตามออกแบบ
- Git Bash heredoc กิน backslash ใน path — ใช้ `/`; chem.db เป็น WAL → `sqlite3 -readonly`

## 5. Suggested skills
- **run** — เปิดแอปยืนยัน flow หลังแก้ (ใช้ bypass Super Admin)
- **anthropic-skills:docx** — ถ้าต้องแก้เอกสาร `chem_compensation_workflow.docx` หลังได้ข้อมูลจากหน่วยงาน
- **grill-me** — ไล่ตัดสิน workflow ชดเชย/Aquadat และเรื่องยกเลิกเคส→CAR กับผู้ใช้
- **code-review** / **scrutinize** — ก่อน commit (CAR numbering race, CARLog state flow, `Listener_CHEMLAB.cs` เทียบ mock)
- **security-review** — bypass endpoint, :8888 ไม่มี auth
