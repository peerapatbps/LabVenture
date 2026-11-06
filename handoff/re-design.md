# Re-design — `/chem-intake` → Chemical Lab QC (Design & Architecture)

วันที่: 2026-09-26 · สถานะ: frontend + LabVenture proxy + mock เสร็จ, backend Uroboros ยังไม่ทำ
เอกสารคู่กัน:
- สิ่งที่ทำ/ทดสอบ/ค้าง → [handoff2609.md](handoff2609.md)
- Contract API + DDL + กฎ lock ละเอียด → [chem_lab_backend_spec.md](chem_lab_backend_spec.md) (**ไม่ซ้ำในไฟล์นี้**)
- Plan ที่ผู้ใช้อนุมัติ (Decisions D1–D17) → `~/.claude/plans/c-users-peera-onedrive-desktop-sidecar-scalable-bear.md`
- ที่มาของ sidecar / chem.db → `C:\Users\peera\OneDrive\Desktop\Sidecar_prj\TruckSidecar\handoff\handoff2609.md`, `...\docs\architecture.md`

---

## 1. ทำไมต้อง re-design

| เดิม | ตอนนี้ |
|---|---|
| operator กรอกรับสารในหน้า `/chem-intake` (ตาราง `chem_history`, key = ทะเบียนรถ) | operator บันทึกใน **TruckSidecar** ที่เกาะโปรแกรมตาชั่ง → `sidecar.db` → merge เข้า `chem.db` |
| นักวิทย์แค่กด "รับ Sampling" ต่อสินค้า | นักวิทย์ต้องทำครบ **HACCP flow 5.3–5.11**: รับขวด → วิเคราะห์ (เอง/ภายนอก/COA) → ตรวจซ้ำ → สคบ-14 → ไม่ผ่าน = ชดเชย + สอบกลับ |

→ งานฝั่ง operator บนหน้านี้เหลือแค่ **ตัดยอดชดเชยทางบัญชี**; ที่เหลือเป็นงานนักวิทย์

แบบฟอร์มอ้างอิง:
- `F-MS-HACCP-กผจ-29 REV04` (ใบตรวจรับ, ส่วน "สำหรับห้องปฏิบัติการ": สภาพขวด ✓/✗, ลงชื่อ จนท.สคบ.) → แท็บรับขวด
- `F-MS-HACCP-สคบ-14 Rev02` (บันทึกข้อความ รายงานผลวิเคราะห์ PACl: RD@°C, pH, อะลูมินา, เบสิกซิตี้, เหล็ก, สารไม่ละลายน้ำ, สรุป) → แท็บผลวิเคราะห์ + รายงาน
- Flowchart 5.1–5.11 (รูปที่ผู้ใช้แนบ) → workflow ทั้งหมด

## 2. ภาพรวมระบบ

```
 ┌─ โรงงาน (เครื่องตาชั่ง) ────────────────────────────┐
 │ truck93a → data.mdb (WDATA)                          │
 │ TruckSidecar → sidecar.db (SIDECAR_UNLOAD/FILL)      │
 │ Uroboros_mini: mdb + sidecar.db → chem.db → Drive    │
 └──────────────────────────────┬───────────────────────┘
                                ▼ (ดาวน์โหลด, แทนที่ทั้งไฟล์เมื่อ datetime เปลี่ยน)
 ┌─ Uroboros backend (:443) ────────────────────────────┐
 │ chem.db  ← READ-ONLY (ถูกเขียนทับเสมอ)                 │
 │ data.db  ← LAB_* tables (ใหม่, ไม่ถูก swap)             │
 │ /api/chemlab/*   (ยังไม่ทำ — spec พร้อม)               │
 │ /api/chem/summary, /api/chem_report (มีอยู่แล้ว)       │
 └──────────────────────────────┬───────────────────────┘
                                ▲ HTTP (mock=false)
 ┌─ LabVenture server (:3001) ───┴──────────────────────┐
 │ /api/chem-lab/*  routes/chemLab.js                   │
 │   • auth/role (ตรรกะเดียวกับ /api/auth/me)             │
 │   • แนบ actor + ts (nowTH) ทุก request                 │
 │   • /spec, /me ตอบเองจาก config                       │
 │   • attempt: คำนวณ verdict จาก lab_chem_spec.json      │
 │   • final: แนบ task template; fail → createCar → LINE │
 │   • mock=true → services/chemLabMock.js (in-process)  │
 │ labventure.db: car_log (CAR ของเคสชดเชย)              │
 └──────────────────────────────┬───────────────────────┘
                                ▼
 ┌─ Client /chem-intake (React) ────────────────────────┐
 │ tabs: รับขวด · ผลวิเคราะห์ · รายงาน สคบ-14 · เคสชดเชย · ตัดยอดชดเชย │
 │ + TraceDrawer (สอบกลับจาก TICKET1) + MemoPrint (A4)   │
 └──────────────────────────────────────────────────────┘
```

### หลักการแบ่งหน้าที่ (สำคัญ)
| อยู่ที่ | อะไร | เหตุผล |
|---|---|---|
| **chem.db** (read-only) | ข้อเท็จจริงของเที่ยวรถ: น้ำหนัก, ทะเบียน, บริษัท, sidecar | เป็นต้นฉบับจากหน้างาน; ถูก swap ทั้งไฟล์ |
| **Uroboros data.db** | สถานะงานแล็บทั้งหมด (LAB_*) + audit | ไม่ถูก swap, อยู่ที่เดียวกับ chem.db → join ได้ |
| **LabVenture config** | เกณฑ์คุณภาพ, template งาน | hot-reload, admin แก้ได้โดยไม่ต้อง deploy Uroboros |
| **LabVenture labventure.db** | CAR (`car_log`) | ระบบ CAR + LINE อยู่ที่นี่อยู่แล้ว |
| **LabVenture proxy** | ตัวตนผู้ใช้, role, เวลา, verdict | Uroboros ไม่ต้องรู้เรื่อง auth/เกณฑ์ → backend "โง่" และทดแทนง่าย |

## 3. Domain model

```
WDATA.TICKET1 (1 เที่ยว) ──1:1── LAB_BOTTLE (ได้รับ/ไม่ได้รับ)
                                     │ n
                                     ▼ 1   key = (DAYIN, chemical, company)
                               LAB_COMPOSITE ──1:n── LAB_ATTEMPT (append-only, 1 = final)
                                     │ 0..1 active                │
                                     ▼                            ▼ (memo_id)
                                 LAB_CASE ──1:n── LAB_CASE_TASK   LAB_MEMO (สคบ-14, ช่วงวันที่)
                                   │  └─1:n── LAB_CASE_TICKET (เที่ยวที่ไม่ผ่าน, snapshot net)
                                   └─1:n── LAB_OFFSET ──n:1── WDATA.TICKET1 (เที่ยวถัดไปที่ถูกหักยอด)
                                   └─ car_key → LabVenture car_log.unique_key
ทุก write → LAB_AUDIT
```
DDL เต็ม → `chem_lab_backend_spec.md` §2

### ทำไม composite = (วัน, สาร, **บริษัท**)
ผู้ใช้บอก "ผสมขวดทั้งวันวัดทีเดียว" แต่ข้อมูล 2018–2026 มี **120 วัน** ที่สารเดียวกันมาจาก >1 บริษัท → ถ้าผสมรวม ตอนไม่ผ่านจะเรียกชดเชยผิดคน. กรณีปกติ (1 บริษัท/สาร) = 1 composite/วัน เท่าเดิม

## 4. State machines

**Bottle**: `(ไม่มีแถว) → received | not_received` ↔ แก้ได้ (ต้องมีเหตุผล) **จน** composite มี attempt → 🔒

**Composite**
```
pending ──attempt #1..n (immutable)──► mark final ──► pass
                                                  └─► fail ──► เปิด Case (+CAR)
- เปลี่ยน final: ต้องมีเหตุผล, และห้ามถ้ามี case (ต้อง cancel case ก่อน) หรือออก memo แล้ว
- memo_id != null → ล็อกทั้งหมด
```

**Case**
```
open ──(ทุก task done)──► closed
  │   task "ตัดยอดชดเชยครบ" (auto_key=offset_complete) ติ๊กเอง ⇔ remaining ≤ 0
  └──cancel (เหตุผล, ต้องยังไม่มี offset)──► cancelled  → composite เปลี่ยน final ได้อีก
remaining = target_kg − Σ offset_kg
suggested_kg = Σnet × max(0, 1 − ค่าวัด/ค่า min) ของ param หลัก (is_key) — ถ้า param หลักผ่าน = 0
target_kg ≠ suggested → ต้องมีเหตุผล (ข้อตกลงกับผู้ขาย); 0 = ตักเตือนอย่างเดียว
```

## 5. Role matrix (บังคับที่ LabVenture proxy)

| Action | scientist | superadmin / role=null | operator | executive/observer |
|---|---|---|---|---|
| อ่านทุกแท็บ (operator ไม่เห็นแท็บ สคบ-14) | ✓ | ✓ | ✓ | ✓ (exec เข้าหน้านี้ไม่ได้ตาม ROLE_PAGES) |
| รับขวด / composite / attempt / final / memo / case / task | ✓ | ✓ | ✗ 403 | ✗ 403 |
| ตัดยอดชดเชย (offset) | ✗ 403 | ✓ | ✓ | ✗ 403 |

แท็บ default: operator → "ตัดยอดชดเชย", อื่นๆ → "รับขวด"

## 6. Decisions ที่มีผลต่อ design (สรุปเหตุผล — รายการเต็มใน plan)
| # | ตัดสินใจ | เหตุผล/ผลกระทบ |
|---|---|---|
| D1 | LAB_* อยู่ data.db | chem.db ถูกเขียนทับ |
| D3 | WDATA เป็นฐาน LEFT JOIN SIDECAR | จำนวนขวดต้องตรงตาชั่ง แม้ operator ข้าม sidecar |
| D4 | ขวด 2 สถานะ | ผู้ใช้เลือกเรียบง่าย (สภาพขวดใส่ remark) |
| D5 | 3 แหล่งผลในโครงเดียว | 5.5/5.6 ใช้ flow ต่อเดียวกัน |
| D6 | เกณฑ์เป็น config | ALUM ยังไม่มีค่าจริง, แก้ได้ไม่ต้อง deploy |
| D9 | ไม่มี approval ในระบบ | หน.สคบ. เซ็นกระดาษ → ระบบต้องล็อกเองแทน (D15) |
| D13 | ชดเชย = ตัดบัญชีโดย operator | วิธีจริงที่ใช้อยู่ (25 ไม่ผ่าน 6 t → 26 ส่ง 26 t คิดเงิน 20 t) |
| D14 | เปิด CAR ด้วย | ผู้ใช้ต้องการ; ใช้ `services/carCreate.js` ร่วมกับ `/api/car` |
| D17 | prefix `/api/chemlab` | `/api/lab/*` มีใน Uroboros แล้ว |

## 7. Frontend structure
```
client/src/
  config/chemLab.js              TABS(+roles), CHEM_STYLE, TEST_SOURCE, VERDICT/CASE styles, fmt*, paramVerdict
  pages/ChemIntake.jsx           shell: tabs (?tab=&date=&composite=&case=), TraceContext, badges
  pages/chemlab/shared.jsx       useLabSpec/useLabMe, Section, badges, Modal, ReasonModal, TicketLink, btn/inputCls
  pages/chemlab/BottlesTab.jsx   draft per ticket → batch PUT; reason modal ถ้าแก้ของเดิม; ปุ่มสร้าง composite
  pages/chemlab/AnalysisTab.jsx  list + detail + AttemptForm (live สีตามเกณฑ์) + final + modal เปิดเคส
  pages/chemlab/MemoTab.jsx      preview → save → window.open print
  pages/chemlab/MemoPrint.jsx    A4 (route นอก Layout: /chem-intake/memo/:id/print)
  pages/chemlab/CasesTab.jsx     list + CaseDetail (tasks, offsets, target, cancel) + TripTable
  pages/chemlab/OffsetTab.jsx    operator: open cases → candidates → confirm
  pages/chemlab/TraceDrawer.jsx  5 ขั้น: ตาชั่ง → sidecar → ขวด → composite → เคส/offset
```
- State ทั้งหมดผ่าน TanStack Query key prefix `['chem-lab', ...]`; ทุก mutation `invalidateQueries(['chem-lab'])`
- Layout: badge จำนวนเคสเปิดบนเมนู 🧪 (poll 2 นาที)
- สไตล์ earth-tone เดิม; ใช้ `bg-earth` (**ไม่ใช่** `bg-earth-DEFAULT` ซึ่งไม่สร้าง CSS)

## 8. Server structure
```
server/routes/chemLab.js        attachActor → /spec,/me → guard → attempts(evaluate) → final(CAR hook) → pass-through
server/services/chemLabMock.js  reference impl ของ contract (node:sqlite; chem.db RO + chemlab_mock.db)
server/services/carCreate.js    createCar() ใช้ร่วม /api/car
server/config/lab_chem_spec.json, lab_case_tasks.json, services.json (chem_lab block)
```
