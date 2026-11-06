# Chem Lab QC backend spec (Uroboros `/api/chemlab/*`) — 2026-09-26 · อัปเดต 2026-09-27

**อัปเดต 27/10 (re-design 2):** แยกรับขวด/ผสม, ผสมได้หลายใบ (ซ้อนขวดได้), final ต่อใบผสม (เปลี่ยนได้ + ติดชื่อผู้เลือก), Lab ภายนอกเป็นแท็บแยก, เลือกคันที่ชดเชยได้, เลือกใบลง สคบ-14 → **อ่าน §4.1 ก่อน** (แทนกฎที่ขัดกันใน §4.0/§4) · **deploy แล้ว 26/10 14:46** (Uroboros publish + LabVenture bundle `index-CsR3_nfU.js` + routes/chemLab.js + services/chemLabMock.js; migration chemlab.db จริงผ่าน — composite #1/#2 → ใบที่ 1 ขวดครบ) · rollback: `Fullscale_V2\_backup\Uroboros_bin_before_chemlab_mix_2710` (bin + chemlab.db) และ `LabVenture_before_chemlab_mix_2710`

**สถานะ (27/09):** Uroboros implement แล้ว (`Uroboros/Listener_CHEMLAB.cs`, test `Uroboros.Tests/ChemLabServiceTests.cs`), LabVenture ใช้ของจริงแล้ว (`services.json` `chem_lab.mock:false`) — verify ผ่าน API + browser ดู §8.1
เดิมเป็น task handoff ให้ implement ฝั่ง Uroboros; §0/§1/§2/§6 แก้ตามการเปลี่ยนที่ผู้ใช้อนุมัติแล้ว

Plan ที่ตกลงกับผู้ใช้: `~/.claude/plans/c-users-peera-onedrive-desktop-sidecar-scalable-bear.md` (ตาราง Decisions D1–D17)
อ่านประกอบ: `Sidecar_prj/TruckSidecar/handoff/handoff2609.md` (ที่มาของ chem.db / SIDECAR_*)

---

## 0. กติกาที่ห้ามพลาด
1. **ห้ามเขียนลง `chem.db`** — Uroboros แทนที่ไฟล์ทั้งไฟล์เมื่อไฟล์ใหม่มา (ตรวจ diff datetime) → อะไรที่เขียนลงไปจะหาย
2. ตาราง `LAB_*` ทั้งหมดอยู่ใน **`chemlab.db` ข้าง `Uroboros.exe`** (prod: `Fullscale_V2\Uroboros_proj\chemlab.db`) — **ไม่ใช่ `data.db`** เพราะ `DbDownloadTask` (`Uroboros/Program.cs` ~1624-1759) `File.Replace` data.db จาก Drive ทั้งไฟล์
3. `chem.db` = read-only source: `WDATA` (ตาชั่ง, มีแค่ STAT='2') + `SIDECAR_UNLOAD` / `SIDECAR_FILL` + `COMPANY`
   - path จริงอ่านผ่าน `MdbReaderSafe.ResolveActiveChemDbPath` (pointer `media\chem.current.txt` → ชื่อไฟล์ snapshot ใน `media\`) เหมือน handler อื่น
   - chem.db เป็น **WAL mode** — เปิด `Mode=ReadOnly`, `Pooling=False`
   - ระวังช่วงที่ไฟล์ถูก swap: เปิด connection ใหม่ทุก request (อย่าถือ handle ค้าง)
4. Key เชื่อมข้าม DB = **`TICKET1`** (soft FK) — ขวด 1 ใบ = รถ 1 เที่ยว
5. Product → chemical: `'01'` = `ALUM`, `'03'` = `PACL` (code อื่นไม่เกี่ยว)
6. NET_KG = `ABS(W1 − W2)` จาก WDATA
7. **Spec/เกณฑ์ และ template งาน อยู่ที่ LabVenture** (`server/config/lab_chem_spec.json`, `lab_case_tasks.json`) — proxy คำนวณ verdict แล้วส่งมาให้; Uroboros ไม่ต้องรู้เกณฑ์
8. **CAR ออกที่ LabVenture** (`car_log`) — Uroboros แค่เก็บ `car_key` ที่ proxy PATCH มา

## 1. สถาปัตยกรรม
```
Client (/chem-intake tabs)
  → LabVenture /api/chem-lab/*   [server/routes/chemLab.js]
       - auth + role (เหมือน /api/auth/me)       - GET /spec, /me ตอบเองจาก config
       - attempt: คำนวณ param_verdicts/verdict/key_*   - final: แนบ task_template, fail → createCar → PATCH car_key
       - ที่เหลือ pass-through
  → services.json chem_lab.mock
       true  → server/services/chemLabMock.js  (reference implementation — อ่านโค้ดนี้คู่กับ spec)
       false → HTTP {base_url}{prefix}  = http://localhost:8888/api/chemlab/*   (Uroboros Listener_CHEMLAB.cs)
```
⚠ `/api/lab/*` ถูกใช้แล้วใน Uroboros (`/api/lab/summary`) จึงใช้ prefix **`/api/chemlab`**
⚠ Port: **:443 = BellBeast** (reverse proxy `/labventure/*` → LabVenture :3001, `BellBeast/Program.cs` 649-664); **Uroboros ฟัง :8888** (`UROBOROS_HTTP_PREFIX`) → LabVenture เรียก :8888 ตรง. Uroboros ไม่มี auth ที่ :8888 (ใครเข้าถึง port ปลอม actor ได้)

### Request จาก proxy
- Header ทุก request: `X-LabVenture-Actor` (encodeURIComponent ชื่อไทย), `X-LabVenture-Role`, `X-LabVenture-Ts` (ISO +07:00)
- Body ของ write: body เดิม + `actor: {name, role, bypass}` + `ts` → **ใช้ `ts` / `actor.name` เป็น created_at / *_by** (อย่าใช้เวลาเครื่อง Uroboros); fallback = header `X-LabVenture-Actor` (decode) / `X-LabVenture-Ts`; write ที่ไม่มี actor → 400
- Uroboros ครอบทั้ง handler ของ write (รวม validation) ด้วย `BEGIN IMMEDIATE` (กัน race E-21); `SQLITE_CONSTRAINT` → 409
- Response: JSON; สำเร็จ = `200` + `{ ok: true, ... }`; ผิด = `400/404/409` + `{ error: "ข้อความไทย" }` (client แสดง `error` ตรงๆ)
- 400 = input ผิด, 404 = ไม่พบ, 409 = ขัดกฎ lock/สถานะ

## 2. DDL (`chemlab.db`) — คัดจาก `chemLabMock.js` (`LAB_DDL`), Uroboros สร้างเองตอนเปิด (`Listener_CHEMLAB.cs` + index)
```sql
CREATE TABLE IF NOT EXISTS LAB_BOTTLE (
  ticket1 TEXT PRIMARY KEY, dayin TEXT NOT NULL, chemical TEXT NOT NULL, company TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received','not_received')), remark TEXT,
  composite_id INTEGER, received_by TEXT, received_at TEXT, updated_by TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS LAB_COMPOSITE (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sample_date TEXT NOT NULL, chemical TEXT NOT NULL, company TEXT NOT NULL,
  n_bottles INTEGER NOT NULL DEFAULT 0, test_source TEXT, final_attempt_id INTEGER,
  verdict TEXT NOT NULL DEFAULT 'pending', memo_id INTEGER, created_by TEXT, created_at TEXT,
  UNIQUE (sample_date, chemical, company));
CREATE TABLE IF NOT EXISTS LAB_ATTEMPT (   -- append-only
  id INTEGER PRIMARY KEY AUTOINCREMENT, composite_id INTEGER NOT NULL, attempt_no INTEGER NOT NULL,
  test_source TEXT NOT NULL, ext_lab TEXT, ext_report_no TEXT, attachment_ref TEXT, temp_c_rd REAL,
  values_json TEXT NOT NULL, param_verdict_json TEXT NOT NULL, verdict TEXT NOT NULL,
  key_param TEXT, key_value REAL, key_min REAL, remark TEXT, tested_by TEXT, tested_at TEXT);
CREATE TABLE IF NOT EXISTS LAB_MEMO (
  id INTEGER PRIMARY KEY AUTOINCREMENT, doc_no TEXT NOT NULL UNIQUE, doc_date TEXT, chemical TEXT NOT NULL,
  period_from TEXT NOT NULL, period_to TEXT NOT NULL, n_samples INTEGER NOT NULL, m_analyzed INTEGER NOT NULL,
  addressee TEXT, spec_ref TEXT, conclusion TEXT, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS LAB_CASE (      -- ≤ 1 non-cancelled case per composite (enforce in code)
  id INTEGER PRIMARY KEY AUTOINCREMENT, composite_id INTEGER NOT NULL, chemical TEXT NOT NULL, company TEXT NOT NULL,
  suggested_kg REAL NOT NULL, target_kg REAL NOT NULL, override_reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',     -- open | closed | cancelled
  car_key TEXT, opened_by TEXT, opened_at TEXT, closed_at TEXT, cancel_reason TEXT);
CREATE TABLE IF NOT EXISTS LAB_CASE_TICKET (case_id INTEGER NOT NULL, ticket1 TEXT NOT NULL, net_kg REAL, PRIMARY KEY (case_id, ticket1));
CREATE TABLE IF NOT EXISTS LAB_CASE_TASK (
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, seq INTEGER NOT NULL, title TEXT NOT NULL,
  source TEXT NOT NULL,                    -- template | manual
  auto_key TEXT,                           -- 'offset_complete' = ระบบติ๊กเอง
  done_by TEXT, done_at TEXT, remark TEXT);
CREATE TABLE IF NOT EXISTS LAB_OFFSET (
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, ticket1 TEXT NOT NULL,
  offset_kg REAL NOT NULL, net_kg REAL, remark TEXT, by_user TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS LAB_AUDIT (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user TEXT, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  action TEXT NOT NULL, before_json TEXT, after_json TEXT, reason TEXT);
```
ทุก write ต้องอยู่ใน transaction เดียวพร้อม `LAB_AUDIT`

## 3. Endpoints (path หลัง prefix)
รูปแบบ object ที่ใช้ซ้ำ:
- **trip** (จาก WDATA): `{ticket1, ticket2, plate, product, chemical, company, company_name, dayin, tmin, dayout, tmout, w1, w2, net_kg}`
- **sidecar** (จาก SIDECAR_UNLOAD/FILL) หรือ `null`: `{id, sg, temp_c, bill_book, bill_no, is_complete, created_by, updated_at, fills:[{tank, before, after, after_at}]}`
- **attempt**: แถว LAB_ATTEMPT แต่ `values` / `param_verdicts` เป็น object (parse จาก *_json แล้ว**ไม่ต้องส่ง** *_json)
- **caseSummary**: แถว LAB_CASE + `company_name, sample_date, offset_kg, remaining_kg (round 1), tasks_total, tasks_done`

| Method | Path | Body / Query | Response (นอกจาก `ok`) |
|---|---|---|---|
| GET | `/bottles` | `?date=YYYY-MM-DD` | `{date, groups:[{chemical, company, company_name, expected, received, not_received, pending, composite:{id,verdict,attempts,locked,n_bottles}\|null, rows:[trip + {sidecar, bottle: LAB_BOTTLE+{locked}\|null}]}]}` — trips = WDATA STAT='2', PRODUCT 01/03, DAYIN=date, group by (chemical, company) |
| PUT | `/bottles` | `{items:[{ticket1,status,remark}], reason?}` | `{saved}` |
| GET | `/composites` | `?from&to&chemical` | `{composites:[LAB_COMPOSITE + company_name, attempts, case:{id,status}\|null]}` |
| POST | `/composites` | `{date, chemical, company}` | = GET `/composites/:id` |
| GET | `/composites/:id` | | `{composite(+company_name), bottles:[LAB_BOTTLE+{trip}], attempts:[attempt], case: caseSummary\|null}` (case = non-cancelled ล่าสุด) |
| POST | `/composites/:id/attempts` | `{test_source, ext_lab, ext_report_no, attachment_ref, temp_c_rd, remark, values, param_verdicts, verdict, key_param, key_value, key_min}` ← proxy คำนวณให้แล้ว | = GET `/composites/:id` |
| PUT | `/composites/:id/final` | `{attempt_id, reason?, task_template:[{title, auto_key?}]}` | = GET `/composites/:id` + `opened_case: caseSummary\|null` |
| GET | `/memos` | | `{memos:[LAB_MEMO]}` |
| GET | `/memos/preview` | `?chemical&from&to` | `{chemical, from, to, n_samples, m_analyzed, pending_final, rows:[{composite_id, sample_date, company, company_name, n_bottles, verdict, final_attempt: attempt}]}` |
| POST | `/memos` | `{doc_no, doc_date, chemical, from, to, addressee, spec_ref, conclusion}` | = GET `/memos/:id` |
| GET | `/memos/:id` | | `{memo, rows}` (rows = composites ที่ memo_id = id) |
| GET | `/cases` | `?status&chemical&company` | `{cases:[caseSummary]}` (order id desc) |
| GET | `/cases/:id` | | `{case: caseSummary, composite, final_attempt, tickets:[LAB_CASE_TICKET+{trip, sidecar}], tasks, offsets:[LAB_OFFSET+{trip}], audit:[LAB_AUDIT where entity='case']}` |
| PATCH | `/cases/:id` | `{car_key}` \| `{action:'cancel', reason}` \| `{target_kg, override_reason}` | = GET `/cases/:id` |
| POST | `/cases/:id/tasks` | `{title}` | = GET `/cases/:id` |
| PATCH | `/cases/:id/tasks/:taskId` | `{remark?}` (= ติ๊กเสร็จ) | = GET `/cases/:id` |
| GET | `/offset-candidates` | `?case_id` | `{case: caseSummary, candidates:[trip + {offset_used_kg, available_kg}]}` |
| POST | `/cases/:id/offsets` | `{ticket1, offset_kg, remark?}` | = GET `/cases/:id` |
| GET | `/trace/:ticket1` | | `{ticket1, trip, sidecar, bottle, composite, attempts, cases:[caseSummary], offsets_applied:[LAB_OFFSET], audit:[entity='bottle']}` |
| GET | `/pipeline` | `?from&to` | `{from, to, groups:[{date, chemical, company, company_name, expected, received, not_received, pending, net_kg, unattached_received, composite:{id, n_bottles, attempts, final_attempt_id, verdict, memo_id, memo_doc_no, case:{id,status,target_kg,remaining_kg}\|null}\|null}]}` (DAYIN desc) — ข้อมูลกระดาน (26/10) |
| PUT | `/composites/:id/attempts/:aid` | body เดียวกับ POST attempts + `reason` | = GET `/composites/:id` (26/10) |
| DELETE | `/composites/:id/attempts/:aid` | `{reason}` | = GET `/composites/:id` (soft delete) |
| DELETE | `/composites/:id/final` | `{reason}` | = GET `/composites/:id` + `cancelled_case_id` |
| POST | `/composites/:id/bottles/sync` | | = GET `/composites/:id` — ผูกขวด received ที่ยังไม่อยู่ใน composite (ขวดมาช้า) |
| POST | `/cases/:id/offsets/:oid/void` | `{reason}` | = GET `/cases/:id` (role operator/superadmin) |
| POST | `/memos/:id/void` | `{reason}` | `{memo, rows:[], released:[composite_id]}` |
| PUT | `/composites/:id` | `{tickets?, note?, reason}` | = GET `/composites/:id` (27/10 — แก้ขวด/หมายเหตุใบผสม) |
| DELETE | `/composites/:id` | `{reason}` | `{deleted}` (27/10 — soft delete, ยกเลิก ext send ที่รอผล) |
| POST | `/composites/:id/ext-sends` | `{lab_name, note?}` | = GET `/composites/:id` (27/10) |
| GET | `/ext-sends` | `?status&from&to` (วันที่ส่ง) | `{sends:[LAB_EXT_SEND + composite: compositeSummary]}` (27/10) |
| GET | `/ext-sends/:sid` | | `{send}` (27/10) |
| POST | `/ext-sends/:sid/result` | body เดียวกับ attempt (proxy คำนวณ verdict) | `{send}` — สร้าง attempt `external_lab` (27/10) |
| POST | `/ext-sends/:sid/cancel` | `{reason}` | `{send}` (27/10) |

**⚠ 27/10 เปลี่ยนรูปแบบ (ดู §4.1):** `POST /composites` body = `{date, chemical, company, tickets:[ticket1], note?}` · `PUT /composites/:id/final` เพิ่ม `case_scope` (`composite`|`day`|`custom`) + `case_tickets` (custom) · `POST /memos` เพิ่ม `composite_ids?` · GET `/bottles` → group มี `composites:[compositeSummary]`, `unmixed` แทน `composite`; `row.bottle` มี `composite_ids, composite_seqs, locked` · GET `/pipeline` → group มี `composites:[compositeSummary]`, `unmixed` แทน `composite`/`unattached_received` · GET `/trace` → `composites:[compositeSummary + attempts_list]` แทน `composite`/`attempts` · **ลบ** `POST /composites/:id/bottles/sync` · GET `/composites` รับ `?date&company&open=1` เพิ่ม
- **compositeSummary** = `{id, sample_date, chemical, company, company_name, seq, n_bottles, note, tickets, attempts, ext_pending, final_attempt_id, verdict, finalized_by, finalized_at, memo_id, memo_doc_no, created_by/at, updated_by/at, case:{id,status,target_kg,remaining_kg}|null}`
- caseSummary เพิ่ม `composite_seq, n_tickets, tickets_net_kg` (+ คอลัมน์ `scope`)

GET `/composites/:id` → `composite` = compositeSummary + แถว LAB_COMPOSITE + `locked` (= มี final), `deleted`; มี `ext_sends` · attempts/trace ไม่ส่งแถวที่ลบแล้ว

Role guard อยู่ที่ LabVenture แล้ว (scientist/superadmin/null = เขียนทุกอย่างยกเว้น offset; operator = offset เท่านั้น) — Uroboros ไม่ต้องตรวจซ้ำ แต่**ควร**ปฏิเสธ request ที่ไม่มี `actor`

## 4.0 ย้อนขั้นตอนได้ (re-design 26/10 — แทนกฎ lock เดิมใน §4 ที่ขัดกัน)
หลักการ: **แก้ขั้นล่างได้ตราบใดที่ขั้นบนยังไม่ commit; จะแก้ต้องย้อนขั้นบนก่อน** — การย้อนทุกครั้งต้องมี `reason` (400 ถ้าไม่มี) + LAB_AUDIT. จุด commit = **final** (เดิม = attempt แรก)
- Migration (ALTER ADD COLUMN ตอนเปิด): `LAB_ATTEMPT` + `updated_by/at, deleted_by/at, delete_reason` · `LAB_OFFSET` + `voided_by/at, void_reason` · `LAB_MEMO` + `status ('active'|'void'), voided_by/at, void_reason`
- ขวด: lock (409) เมื่อขวดอยู่ใน composite ที่มี `final_attempt_id`; ก่อนหน้านั้น received → ผูก composite, not_received → ปลด แล้ว recount
- attempt: แก้ (PUT) / ลบ (soft) ได้ถ้ายังไม่มี final และไม่มี memo (409); `attempt_no = MAX+1` (รวมแถวที่ลบ); count/list/trace ไม่นับแถวที่ลบ
- ย้อน final: 409 ถ้ามี memo หรือเคสมี offset ที่ยังไม่ void; เคส non-cancelled ถูกยกเลิกใน tx เดียวกัน (`cancel_reason` = reason); composite → `final_attempt_id NULL, verdict 'pending'`
- void offset: เคส cancelled → 409; เคส closed → เปิดใหม่ (audit `reopen`) แล้ว `syncCaseState`; offset sums / available_kg ไม่นับรายการ void
- void memo: `status='void'`, ปลด `memo_id` ของทุก composite; doc_no เดิมยัง unique (ฉบับใหม่ใช้เลขใหม่)
- CAR: **ถอด UI ที่ผูกกับ CAR ออกจาก flow chem-lab ชั่วคราว** (ผู้ใช้ตัดสิน 26/10) — endpoint `car-draft` / `cases/:id/car` และคอลัมน์ `car_key` ยังอยู่แต่ client ไม่เรียก
- Client (`/chem-intake`): แท็บ `ภาพรวมตัวอย่าง` (PipelineBoard — 6 คอลัมน์ตาม stage) → WorkflowDetail (stepper รับขวด → ผสม → วิเคราะห์ → final → เคส → สคบ-14) แทนแท็บ รับขวด/ผลวิเคราะห์ เดิม; ยกเลิกเคสทำผ่าน "ย้อนผล final"
- ทดสอบ: mock (`scratchpad mock_flow_test.js` + browser) · Uroboros `ChemLabServiceTests` 8/8 ผ่าน — **ยังไม่ publish Uroboros ไป Fullscale_V2**

## 4.2 เหตุผลไม่บังคับ (26/10 บ่าย — แทนทุกจุดใน §4/§4.0/§4.1 ที่บอกว่า "ต้องมี reason / 400")
ผู้ใช้ตัดสิน: การเปลี่ยนแปลงใดๆ กดยืนยันได้แม้ไม่ใส่หมายเหตุ → `reason` / `override_reason` เป็น optional ทุก endpoint (บันทึกลง LAB_AUDIT ถ้ามี) — mock `optReason()`, Uroboros `OptReason()`; UI ยังเปิดหน้าต่างยืนยันเหมือนเดิมแต่ช่องเหตุผลไม่บังคับ. กฎล็อกอื่น (409) ไม่เปลี่ยน · **deploy แล้ว 26/10 14:56** (bundle `index-rFFcYuCw.js`; rollback: `_backup\Uroboros_bin_before_optreason_2610`, `_backup\LabVenture_before_optreason_2610`)

## 4.1 แยกรับขวด / ผสม · ผสมได้หลายใบ · final ต่อใบผสม · Lab ภายนอก (re-design 27/10 — แทนส่วนที่ขัดกันใน §4.0/§4)
ที่มา: ผู้ใช้ — คนรับขวดกับคนผสมอาจเป็นคนละคน; คนผสมอาจผสมแบบพิเศษ (เช่น 50% ขวด 1–2 + อีกใบ 50% ขวด 1–3 เพื่อ cross-check) → ผสมซ้ำได้อิสระ
- **DDL:** `LAB_COMPOSITE` ไม่มี UNIQUE แล้ว + `seq` (ใบที่ n ของวัน×สาร×บริษัท, นับต่อแม้ใบถูกลบ), `note`, `finalized_by/at`, `updated_by/at`, `deleted_by/at`, `delete_reason` · ตารางใหม่ `LAB_COMPOSITE_BOTTLE(composite_id, ticket1)` (ขวดอยู่ได้หลายใบ) · `LAB_EXT_SEND(id, composite_id, lab_name, note, status sent|resulted|cancelled, sent_by/at, attempt_id, resulted_by/at, cancelled_by/at, cancel_reason)` · `LAB_CASE.scope`
- **Migration ครั้งเดียว** (ตรวจ `UNIQUE` ใน `sqlite_master.sql` ของ LAB_COMPOSITE): rebuild ตาราง (id เดิม), ย้าย `LAB_BOTTLE.composite_id` → `LAB_COMPOSITE_BOTTLE` แล้วตั้งเป็น NULL (คอลัมน์เดิมเลิกใช้), `seq=1`, `finalized_by/at` จาก LAB_AUDIT action `final` ล่าสุด
- **รับขวด** ไม่ผูก composite อัตโนมัติแล้ว · ขวดอยู่ในใบที่มี final → 409 · เปลี่ยนเป็น not_received: ใบที่มีผลวิเคราะห์ → 409, ใบที่ยังไม่มีผล → นำขวดออก (audit `detach`) + recount
- **ผสม** ขวดต้องรับแล้ว (received) และวัน/สาร/บริษัทเดียวกัน · แก้ขวดในใบได้เฉพาะยังไม่มีผล (แก้หมายเหตุได้จนมี final) ต้องมี reason · ลบใบได้ถ้ายังไม่มี final/memo (reason)
- **attempt:** `supplier_coa` ไม่รับสำหรับ POST ใหม่ (COA เป็นเอกสาร hard copy ตรวจตอนรับสาร — callback ด้วยคนจากเลข track); แก้/ลบได้จนกว่าจะออก สคบ-14 **ยกเว้นครั้งที่เป็น final** (409) · เพิ่มผลหลังมี final ได้
- **final ต่อใบผสม และเปลี่ยนได้ตรงๆ** (ต้องมี reason ถ้ามี final อยู่แล้ว; ติด `finalized_by/at`) · เคสเดิมถูกยกเลิกใน tx เดียวกัน · 409 ถ้ามี memo หรือเคสมี offset ที่ยังไม่ void · ผลเดิมซ้ำ → 409
- **เคส:** `case_scope` = `composite` (คันในใบ — default) / `day` (ทุกคันของวัน×บริษัท) / `custom` (`case_tickets` ต้องเป็นเที่ยวของวัน×บริษัทนั้น) · suggested = ΣNET ของคันที่เลือก × (1 − key/min) · **เที่ยวหนึ่งอยู่ได้ในเคสที่ไม่ cancelled ได้เคสเดียว** (409 — กันชดเชยซ้ำจากใบที่ซ้อนกัน)
- **Lab ภายนอก:** ส่งจากแท็บผลวิเคราะห์ → `LAB_EXT_SEND` sent → แท็บ Lab ภายนอก (กรองวันที่ส่ง, default วันนี้) กรอกผล → attempt `external_lab` (`ext_lab` = ชื่อ lab ถ้าไม่ระบุ) + `resulted`; กรอกได้ครั้งเดียว (แก้ต่อที่ attempt) · ลบใบผสม → ส่งที่รอผลถูกยกเลิก
- **สคบ-14:** preview = ใบผสมที่มี final ในช่วง (ไม่รวมที่ลบ); `composite_ids` = ใบที่ผู้ใช้ติ๊ก (UI ติ๊กทั้งหมดเป็นค่าเริ่มต้น) ต้องเป็น subset ของ preview (400); `m_analyzed` = จำนวนที่เลือก
- **Client:** แท็บ ภาพรวม · รับขวด · ผสมตัวอย่าง · ผลวิเคราะห์ · Lab ภายนอก · สคบ-14 · เคสชดเชย · ตัดยอด — ไฟล์ `chemlab/{BottlesTab,MixTab,AnalysisTab,ExternalTab}.jsx`; `WorkflowDetail.jsx` = ภาพรวมของตัวอย่าง (การ์ดบนกระดาน); กล่องกรอกผล แดง = ไม่ผ่าน / เขียว = ผ่าน (`verdictInputCls`)
- ทดสอบ: mock `scratchpad/mock_flow2_test.js` (86 checks + migrate) · Uroboros `ChemLabServiceTests` 12/12 · browser (mock) ครบ flow + tablet 768px

## 4. กฎธุรกิจ / lock (D15)
**Bottle (`PUT /bottles`)**
- ticket1 ต้องมีใน WDATA (STAT 2, PRODUCT 01/03) ไม่งั้น 400
- ถ้าค่าเดิมเท่ากัน (status+remark) → ข้าม (ไม่ audit)
- ถ้าขวดอยู่ใน composite ที่มี attempt แล้ว → **409**
- แก้ขวดที่เคยบันทึกแล้ว → ต้องมี `reason` ไม่งั้น 400
- attach: ถ้ามี composite ของ (dayin, chemical, company) ที่ยังไม่มี attempt → received = ผูก composite_id, not_received = ปลด; แล้ว recount `n_bottles`
- ขวดที่รับหลัง composite มี attempt แล้ว → ไม่ผูก (composite_id NULL) — UI แจ้งเตือน

**Composite**: create ได้ครั้งเดียวต่อ (date, chemical, company) (409); ต้องมีขวด received ที่ยังไม่ผูก ≥ 1 (400)

**Attempt**: 409 ถ้ามี case non-cancelled หรือ memo_id แล้ว; attempt_no = count+1; set `LAB_COMPOSITE.test_source` = ของ attempt ล่าสุด

**Final**
- 409 ถ้า memo_id แล้ว หรือมี case non-cancelled
- เปลี่ยนจาก final เดิมเป็นอันอื่น → ต้องมี `reason`
- set `final_attempt_id`, `verdict` = attempt.verdict
- verdict = fail → สร้าง LAB_CASE:
  - `LAB_CASE_TICKET` = ขวด received ใน composite (snapshot net_kg จาก WDATA)
  - **suggested_kg** = `ROUND( Σnet_kg × MAX(0, 1 − key_value / key_min) )` **เฉพาะเมื่อ** `param_verdicts[key_param] == 'fail'` และ key_value/key_min ไม่ null; ไม่งั้น 0 (พารามิเตอร์อื่นไม่ผ่าน → ผู้ใช้กำหนดเองตามข้อตกลง)
  - `target_kg = suggested_kg`, tasks จาก `task_template` (seq 1..n, source='template')
  - แล้ว `syncCaseState` (ถ้า target=0 → auto task ติ๊กทันที)

**Case**
- `remaining_kg = target_kg − Σ LAB_OFFSET.offset_kg`
- `syncCaseState(case)` (เรียกหลัง final/target/offset/task): ถ้า open → auto task `offset_complete` done ⇔ remaining ≤ 0 (ติ๊ก by 'system' / ถ้า remaining กลับ > 0 ให้ un-tick); ถ้าทุก task done → `status='closed'`, `closed_at=ts`, audit 'close'
- cancel: เฉพาะ open, ต้องไม่มี offset (409), ต้องมี reason
- target_kg: เฉพาะ open, ≥ 0, ≥ ยอดที่ตัดแล้ว, ≠ suggested ต้องมี override_reason
- task ติ๊กเสร็จ: เฉพาะ open; auto task ติ๊กเองไม่ได้ (409); ติ๊กซ้ำ 409; ไม่มี un-tick
- `car_key`: set ได้ทุกสถานะ (audit 'car_link')

**Offset (D13 — ตัดบัญชี)**
- candidates = WDATA ของ PRODUCT/COMPANY เดียวกับเคส, `DAYIN > composite.sample_date`, ไม่อยู่ใน LAB_CASE_TICKET ของเคสนี้, `available_kg = net_kg − Σoffset ของ ticket นั้น (ทุกเคส)` > 0 (limit 200, order DAYIN,TMIN)
- POST: case open; ticket ต้องอยู่ใน candidates; `0 < offset_kg ≤ remaining` และ `≤ available_kg`
- ยอดคิดเงิน = net_kg − offset (UI คำนวณ; ไม่กระทบ sidecar / Aquadat income)
  - ⚠ 27/09 ผู้ใช้ต้องการให้ยอดในแท็บ "ส่งยอดสารเคมี" ของ Sidecar (Aquadat chemical income) = net − offset และตรวจย้อนกลับได้ทั้งสองทาง — อยู่ระหว่างออกแบบ (ดู handoff ล่าสุด)

**Memo**
- preview rows = composites ของ chemical ในช่วง `sample_date BETWEEN from AND to` ที่มี final และ `memo_id IS NULL`
- `n_samples` = จำนวน LAB_BOTTLE received ของ chemical ที่ dayin อยู่ในช่วง; `m_analyzed` = rows.length; `pending_final` = composite ในช่วงที่ยังไม่มี final
- POST: doc_no ซ้ำ → 409; ไม่มี rows → 400; set `memo_id` ให้ทุก row (หลังจากนี้ composite ถูก lock)

**Audit**: entity ∈ `bottle` (entity_id = ticket1) · `composite` · `attempt` · `case` · `memo`; action เช่น create/update/final/open/cancel/target/task_add/task_done/offset/close/car_link

## 5. สิ่งที่ LabVenture ทำเพิ่ม (มีอยู่แล้ว ไม่ต้องทำใน Uroboros)
- `evaluate()` ใน `routes/chemLab.js`: inhouse ต้องกรอกครบทุก param + temp_c_rd (ถ้ามี param `with_temp`); external/COA กรอกบางส่วนได้ (param ที่ไม่กรอก = `'n/a'`)
- **CAR ออกด้วยคนผ่านแบบฟอร์ม CAR ปกติ (27/09):** final fail → Uroboros เปิดเคสอย่างเดียว (ไม่ออก CAR) → หน้าเคสกด "ออก CAR" → `GET /api/chem-lab/cases/:id/car-draft` (proxy สร้างจาก final attempt + spec: HACCP, ผลิตภัณฑ์ NC, เรื่องที่พบ, ค่าที่พบ/เกณฑ์ = param หลักถ้าตก ไม่งั้น param แรกที่ตก, notes) → `navigate('/car', {state:{prefill, chemLabCase:{id}}})` → ผู้ใช้กรอกผู้รับ/ส่วน (เลข CAR: draft มี `car_prefix:'CQ'` → server ออก `CQ NN/<ปีงบ>` อัตโนมัติถ้าเว้นว่าง) กด "ออกใบ CAR และส่ง LINE" (`POST /api/car` เดิม) → CARLog `POST /api/chem-lab/cases/:id/car {car_key}` (ตรวจว่ามี CAR จริง, เคสยังไม่มี car_key, ไม่ถูกยกเลิก) → PATCH car_key → กลับหน้าเคส
  - `recorded_value` / `threshold_value` / `threshold_direction` = พารามิเตอร์หลักถ้าตกเกณฑ์ ไม่งั้นพารามิเตอร์แรกที่ตก; ตกเพราะเกิน max → `above` + max, ต่ำกว่า min → `below` + min (แก้ 27/09 — เดิมใช้ key_value/key_min เสมอ)
  - `line_sent_at` ตั้งเฉพาะเมื่อ LINE รับจริง (`pushCarMessage` คืน true); token ว่าง → null (แก้ 27/09)
- `/spec` → `lab_chem_spec.json` (+ `case_tasks`, `mock`)
- Client: หน้าเคสมีแถบเตือน "ยังไม่ได้ออก CAR" + ปุ่ม "ออก CAR" (เปิดฟอร์ม CAR ที่กรอกให้แล้ว); มี car_key แล้ว → ปุ่ม "ดู CAR" (หน้าเคส, แถบเคสใน composite) → `/car?key=<car_key>` เปิด CAR ใบนั้นใน CARLog

## 6. การสลับไปใช้ Uroboros (✅ ทำแล้ว 27/09)
1. ✅ `Uroboros/Listener_CHEMLAB.cs` — `ChemLabService(labPath, chemPath).Handle(ChemLabRequest)` (logic, test ได้) + `ChemLabHandlers.HandleAsync` (HttpListener glue); `Program.cs` เช็ก `ChemLabHandlers.Matches(path)` ก่อน `/api/lab/summary`
2. ✅ `services.json` → `chem_lab: { mock: false, base_url: "http://localhost:8888", prefix: "/api/chemlab" }` — hot-reload ไม่ต้อง restart
3. ย้ายข้อมูลจาก mock (ถ้ามี): `server/chemlab_mock.db` DDL เดียวกัน → copy ตาราง LAB_* ไป **`chemlab.db`**
4. Publish: หยุด `Fullscale_V2\STOP_FULLSCALE.ps1` → `dotnet publish Uroboros/Uroboros.csproj -c Release -r win-x64 --no-self-contained -o <Fullscale_V2\Uroboros_proj>`

## 7. ค้าง / ต้องถามผู้ใช้
- **เกณฑ์ใน `lab_chem_spec.json` เป็นค่าสมมติ (`verified:false`)** — PACl/ALUM ต้องได้ค่าจริงจากสัญญา/มอก. + `spec_ref`; ALUM params ต้องยืนยัน (UI แสดงแถบเตือนจนกว่าจะ verified=true)
- ไฟล์แนบผล external/COA ตอนนี้เป็นแค่ข้อความอ้างอิง (`attachment_ref`) — ยังไม่มี upload
- `chem_history` (ตารางเก่าใน labventure.db) ถูกซ่อน ไม่ได้ลบ; route `/api/chem-intake` CRUD ยังอยู่ (`/chem-summary`, `/chem-report` ยังใช้)
- `dayin` ที่ข้ามเที่ยงคืน (6 เที่ยวในประวัติ) — ใช้ DAYIN เป็นวันตัวอย่างตามที่ตกลง

## 8. Verification ที่ทำแล้ว (mock, 2026-09-26)
- Scientist: 26/09 PACl บริษัท 05 → 2 ขวด (0000014808/09, มี sidecar) รับครบ → composite #1 → attempt 1 (Al₂O₃ 8) fail → attempt 2 (8.5) fail → final #2 → เคส #1 suggested **4,308 kg** (= 28,720 × (1 − 8.5/10)) + CAR ออก
- Lock: เปลี่ยน final ขณะมีเคส 409 · แก้ขวดที่ถูกใช้ 409 · เพิ่ม attempt ขณะมีเคส 409 · scientist ตัดยอด 403 · operator ติ๊กงาน 403 · inhouse กรอกไม่ครบ 400 · auto task ติ๊กเอง 409
- Operator: ตัดยอด 4,308 จากเที่ยวถัดไป (ใช้ **สำเนา chem.db + เที่ยวสังเคราะห์ 27/09** ใน scratchpad เพราะ chem.db จริงไม่มีเที่ยวหลัง 26/09) → remaining 0 → auto task ✓ → ติ๊กงานที่เหลือ → เคส **closed** อัตโนมัติ
- Memo: 09/2026 PACl N=2 M=1 → บันทึก "สคบฝผม 101/2569" → print A4 ถูกรูปแบบ · doc_no ซ้ำ 409
- Trace drawer: ตาชั่ง → sidecar → ขวด → composite/attempts → เคส ครบ; tablet 768px ไม่มี horizontal scroll; `vite build` ผ่าน
- ⚠ ผลข้างเคียงระหว่างทดสอบ: CAR ทดสอบ `car_log.id=4` (key `73aaf14d-7788`) ถูกสร้างใน `server/labventure.db` จริง และ **LINE push ออกไปที่กลุ่มจริง** (line_sent_at 23:44) — ผู้ใช้ตัดสินใจเรื่องลบ

## 8.1 Verification กับ Uroboros จริง (2026-09-27, superadmin bypass)
Mock trips เพิ่มใน `chem.db` (dev เท่านั้น, backup `media\chem.db.bak-mocktest`): ALUM บ.01 25/09 ×2, 26/09 ×1, 27/09 ×2 · PACL บ.05 27/09 ×2 · PACL บ.02 27/09 ×1 (TICKET1 14810–14817 + SIDECAR). สคริปต์: session scratchpad `comp_test.py`
- รับขวด / composite / attempt / final / lock / memo / trace — ผลตรง §4 ทุกข้อ (400/409 ตามกฎ)
- เคสชดเชย ALUM 25/09 (al2o3 7.2) suggested 3,813 → ตัด 2,000+1,813 → auto task → ปิดเคส
- เคส ALUM 26/09 (7.6) suggested 957 → override target 1,500 (ต้องมีเหตุผล) → ตัดข้าม 2 เที่ยว (available หักยอดเคสอื่นถูก) → เพิ่มเป้า 1,800 → auto task un-tick → ตัดครบ
- เคส PACL 24/09 เหล็กไม่ผ่าน (non-key) → suggested 0 + auto task ติ๊กทันที → ยกเลิกเคส → attempt ใหม่ + เปลี่ยน final (ต้องมีเหตุผล)
- ⚠ ยังเปิดอยู่: ยกเลิกเคสแล้ว CAR ที่ผูกไว้ไม่ถูกปิด/แจ้ง (รอผู้ใช้ตัดสิน)

## 9. ไฟล์ที่เปลี่ยนใน LabVenture (session 26/09)
- ใหม่: `server/routes/chemLab.js`, `server/services/chemLabMock.js`, `server/services/carCreate.js`, `server/config/lab_chem_spec.json`, `server/config/lab_case_tasks.json`
- ใหม่: `client/src/config/chemLab.js`, `client/src/pages/chemlab/{shared,BottlesTab,AnalysisTab,MemoTab,CasesTab,OffsetTab,TraceDrawer}.jsx`
- สคบ-14: `GET /api/chem-lab/memos/:id/docx|pdf` — กรอกลงแบบฟอร์มต้นฉบับ `server/templates/F-MS-HACCP-สคบ-14 Rev02.doc(x)` (`services/memoDocx.js`); PDF แปลงด้วย Word COM (`server/scripts/docx2pdf.ps1`) → เครื่อง server ต้องมี MS Word
- เขียนใหม่: `client/src/pages/ChemIntake.jsx` (tab shell)
- แก้: `server/index.js` (mount `/api/chem-lab`), `server/routes/car.js` (ใช้ `createCar`), `server/config/services.json` (`chem_lab`), `client/src/App.jsx` (route print นอก Layout), `client/src/components/Layout.jsx` (badge เคสเปิด), `client/vite.config.js` (`API_TARGET` env), `.claude/launch.json` (verify configs 3002/5174), `.gitignore` (`server/chemlab_mock.db`)
- Mock ใช้ `node:sqlite` (built-in Node ≥ 22.5) เพราะ `node-sqlite3-wasm` อ่าน WAL ไม่ได้ — เฉพาะ dev/mock
