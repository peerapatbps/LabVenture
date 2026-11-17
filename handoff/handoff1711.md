# Handoff — 2026-11-17 · CAR workflow redesign (ส่วนที่ 1, 2, 4) + Whitelist sync

ผู้ใช้ยืนยัน "workflow นี้โอเคแล้ว" เมื่อจบ session · ตอบผู้ใช้เป็นภาษาไทยเสมอ

อ่านประกอบ (ไม่ซ้ำเนื้อหาในไฟล์นี้):
- `handoff/handoff_conclude0611.md` §F10 — ระบบ CAR ก่อน session นี้ (เลขอัตโนมัติ, พิมพ์ สบค-08/09, LINE)
- รายละเอียดโค้ด: `git log fee9999..car-workflow` — commit message อธิบายแต่ละเรื่องแล้ว
- เอกสาร workflow (ผู้ใช้ขอ): `handoff/CAR_workflow_2569-11-17_v2.docx` (diagram + ตารางสถานะ/บทบาท/ทางเลือก — ฉบับล่าสุด; ไฟล์ไม่มี `_v2` คือฉบับก่อนแก้ 3A/3B) และ **`handoff/CAR_workflow.drawio`** (source ที่แก้ได้ใน draw.io / diagrams.net)

## 1. สถานะ Git
- Branch **`car-workflow`** (แตกจาก master `fee9999`) — **push ขึ้น `origin/car-workflow` แล้ว · ยังไม่ merge เข้า master** (origin/master ยังอยู่ที่ `fbdb318`)
- Commits งาน CAR: `74fa1cd` whitelist sync · `ff814a0` ฟอร์มสร้าง CAR · `f66ffc4` ส่งต่อ/ปลดล็อก · `a3c2234` การ์ดผู้รับ · `7c5306f` แก้เลข prefix ตอน edit · `51b2c59` · `86f5ef8` ล็อกรวม admin ที่ส่งต่อ · `7320960` · `90ffe82` ส่วนที่ 4 tick · `daebd44` · `ab3d410` revert endpoint · `d889850` บั๊ก reload · `f255c06` เลิกสถานะ 45 · `56515c7` + `308d3a4` ข้อความ LINE แบบย่อ · `0f10c4d` + `37f99cf` Dashboard กล่องออก CAR · `ccd3a86` 20 = 3A เท่านั้น / 50 = 3B เท่านั้น
- ท้าย session ผู้ใช้สั่ง "commit ทุก change": งานค้างเดิมที่ไม่ใช่ของ session นี้ (test mode `TestModePanel.jsx` + `components/testmode/` + `routes/testMode.js`, `services/alarmWatcher.js`, `services/uroboros.js`, `.pyc`, `scripts/seed_cl_eventclasses.js`, handoff 0611/0711/conclude) ถูก commit แยกเป็น commit ของตัวเอง — **ยังไม่ได้ review เนื้อหา**
- `client/dist` build ล่าสุดแล้ว (ไม่ track ใน git)

## 2. สิ่งที่เปลี่ยน (สรุป — ดู commit สำหรับรายละเอียด)

### Whitelist CAR (`/config` → ⚙ Whitelist CAR)
- กลุ่ม 2 **ผู้ปฏิบัติงาน** (ลูกจ้าง ไม่มีใน EHR) ดึงจาก AquaDAT GraphQL `get_adm01_authen_user` (plant 2, `user_type_text = "ลูกจ้าง"`, ตัด Helpdesk/admin/aq/role ผู้ดูแลระบบ) → `car_whitelist` group 2 shift NULL + คอลัมน์ใหม่ `user_code` · การ์ดแสดง ชื่อ-สกุล / รหัสผู้ใช้งาน ต่อจากผลัด 4
- กลุ่ม 3 จาก EHR: 3a = ผอ.กอง org `00000136` (กผจ.ฝผม.), 3b = ผอ.ฝ่าย org `00000034` (ฝผม.)
- ⚠ endpoint AquaDAT นี้ **ตอบได้โดยไม่ต้อง token** (แจ้งผู้ใช้แล้ว) · payload ต้นฉบับขอ `user_pwd` — โค้ดเราไม่ขอ field นี้ · `getServiceToken()` (env `AQUADAT_SVC_USER/PASS`, ไม่มีใน .env) พอร์ตจาก `AquadatFast.cs` แต่ **ไม่ port loop เดารหัสผ่าน**
- `GET /api/car-admin/receivers` (login ไม่ต้อง admin): ผลัด 1–4 + `worker`, head = position "หัวหน้าส่วน"

### ส่วนที่ 1 — สร้าง/แก้ CAR
- ค่าที่พบหลายบรรทัด + หน่วย → `car_log.findings` (JSON) แถวแรก mirror ลง `recorded_value/threshold_*` · helper `server/services/carFindings.js` · หน่วยใน `client/src/config/carUnits.js`
- ผู้รับ: เลือกผลัด → หัวหน้าส่วน default (เปลี่ยนได้) + ส่วน/กอง `สคน{n}กผจ.ฝผม.` · `roleFilter` เพิ่ม match `%สคน{n}กผจ.%`
- เวลาเริ่มต้น = เวลาไทย (`nowTHLocal`)
- Admin: `PUT /api/car/:id/section1` (เลือก prefix + เลขว่าง → ออกเลขใหม่), `DELETE /api/car/:id`
- การ์ด: ปุ่ม re-send LINE (`POST /:id/resend-line`) + copy URL (`/car?key=`) + dialog ยืนยันในธีม + toast กลางจอ
- บั๊ก reload: router state prefill ถูกล้างหลังอ่าน (`d889850`)

### ส่วนที่ 2 — ตอบ + ส่งต่อ
- สถานะใหม่ **15 ส่งต่อแล้ว** · `assignee_name/assignee_dept` = ผู้ถือใบ · ประวัติ `form_data.s2_forwards[]` · `POST /:id/forward`, `POST /:id/reclaim` (15→10)
- `canHold()` ใน `routes/car.js`: ผู้ถือ / กลุ่ม 2 ผลัดเดียวกับผู้ถือ / admin — **คนที่ส่งต่อไปแล้ว (ไม้แรก + ทุกทอด) ถูกล็อกแม้เป็น admin** · ตอบ (→20) ตรวจฝั่ง server แล้ว
- ผู้รับไม้แรกเปิดใบ → popup กลางจอ "ส่งมอบให้ … เมื่อ …" + 🔓 ปลดล็อก
- ตัวเลือกบุคคล `[กลุ่ม][ชื่อ][ส่วน/กอง]` + ปุ่ม + (ผู้เข้าประชุม, ผู้รับผิดชอบ 2.2/2.3) → `s2_attendees/_correction_owners/_prevention_owners` + string เดิมสำหรับ สบค-08
- ผู้ตอบ = คนที่ login กดบันทึก (ล็อก)

### ส่วนที่ 4 — ติดตาม
- แต่ละครั้ง tick ☐ การแก้ไข / ☐ การป้องกัน (`s4_check1_items`, `s4_check2_items`) · ครั้งที่ 1 ผ่านบางส่วน → 40 · ผู้รับผิดชอบติดตาม#2 = ผู้ติดตามครั้งที่ 1 อัตโนมัติ
- ครั้งที่ 2 → **50 เสมอ**; ถ้ายังไม่ผ่านครบ → `s4_to_meeting = true` (ป้าย 🗣 เข้าที่ประชุม บนการ์ด/ส่วน 4/5/LINE) — **ไม่มีสถานะ 45 แล้ว** (ผู้ใช้ไม่ต้องการ stage เพิ่ม) · startup migrate 45→50+flag ใน `db.js`
- สบค-08 tick ตามที่เลือก
- `POST /api/car/:id/revert {to: 20|30|40|50}` (admin, ไม่ส่ง LINE) — ยังไม่มีปุ่มใน UI

### สิทธิ์อนุมัติ (`ccd3a86`)
- **20 → 30 อนุมัติ = กลุ่ม 3A เท่านั้น · 50 → 60/70 ปิด/ตีกลับ = กลุ่ม 3B เท่านั้น** — Admin ทำแทนไม่ได้ (ตรวจทั้ง `PATCH /api/car/:id` ฝั่ง server และ `isG3a/isG3b` ใน `CARLog.jsx`)
- bypass Super Admin (dev) ยังผ่าน เพราะ `BYPASS_ROLE_MAP.superadmin.groups` มีทุกกลุ่ม · superadmin ที่ login จริงต้องมีชื่อใน whitelist กลุ่ม 3A/3B

### ส่วนที่ 5
- label "ผู้อนุมัติ (ผอ.ฝผม.)"

### ข้อความ LINE (`server/services/line.js` → `buildCarMessage`, ผู้ใช้ OK แล้ว)
```
🔴 [CAR #70] HA 03/2570
CW Turbid #1, #2, #3 และ #4 เกินเกณฑ์
ผู้รับผิดชอบ: ผลัด 4
สถานะ: ตีกลับ ต้องออกใบใหม่
[บรรทัดเสริม: ส่งต่อ / ปลดล็อก / ประเด็นเข้าที่ประชุม]
```
- สรุปสิ่งที่พบ parse บรรทัด Dashboard `"<label> #n - time - value"` → จัดกลุ่มตาม label (หลายประเภทต่อด้วย "และ"); ไม่ตรงรูปแบบ → บรรทัดแรกของเรื่องที่พบ (ตัดก่อน " — ")
- ผู้รับผิดชอบ = ผู้ถือใบปัจจุบัน → `ผลัด n` เท่านั้น (ไม่ใช่ผลัด → ส่วน/กอง) · ตัดค่าละเอียดและ Deadline ออก · สถานะคำสั้น (10 รอตอบกลับ … 70 ตีกลับ ต้องออกใบใหม่)

### Dashboard (`client/src/pages/Dashboard.jsx` → `MiniChartsSection`)
- กล่องออก CAR: เลือก chart เก็บแยกต่อ filter (`picks`) — สลับ CW ↔ TW ไม่ล้าง; ข้อความรวมทุกกลุ่ม (template ของกลุ่ม + บรรทัด chart)
- ปุ่ม **Blank** ใต้ + CAR = ล้างข้อความ + การเลือกทุกกลุ่ม (อยู่หน้าเดิม — ผู้ใช้ไม่ต้องการให้เปิดหน้า /car)
- ยังไม่ได้ทดสอบการรวม CW+TW กับข้อมูลจริง (ตอนทดสอบมีแค่ CW เกินเกณฑ์)

## 3. สถานะข้อมูลบนเครื่องจริง (server 8889, `server/labventure.db`)
- CAR ทดสอบที่ผู้ใช้สร้างวันนี้: HA 01–03/2570, CQ ฯลฯ — ใช้ทดสอบ workflow
- **HA 02/2570**: สถานะ 20 ผู้ตอบถูกบันทึกเป็น "Super Admin (Dev)" (agent กดผ่าน bypass ตามคำสั่งผู้ใช้)
- **HA 03/2570**: ผู้ใช้ทดสอบต่อจนถึง 70 ตีกลับ (LINE 20:19) หลังจากเคยค้างที่ 45 — ใบใดที่ยังเป็น 45 จะถูกแปลงเป็น 50 + ป้ายเข้าที่ประชุมตอน server start (`f255c06`)
- ณ ท้าย session: commit ฝั่ง server ล่าสุด (`308d3a4` LINE, `ccd3a86` สิทธิ์ 3A/3B) ต้อง restart server จึงมีผล — ยังไม่ได้ยืนยันว่า restart แล้ว · ฝั่ง client (`client/dist`) build ล่าสุดแล้ว
- LINE token ใน `.env` ใช้งานจริง — การเปลี่ยนสถานะ/forward/resend ส่งเข้ากลุ่มจริง

## 4. งานค้าง / ต้องตัดสินใจ
1. **หน้า CAR Log ยังซ่อนจาก Operator/ผู้บริหาร** — `client/src/config/pageAccess.js` `HIDDEN_PAGES` มี `'car'` (commit `e6d0d1c`) → workflow ส่งต่อใช้จริงไม่ได้จนกว่าจะเปิด (ถามผู้ใช้แล้ว ยังไม่ตอบ)
2. Merge `car-workflow` → master เมื่อผู้ใช้สั่ง
3. ปุ่ม "ย้อนขั้นตอน" ใน panel (มี endpoint แล้ว)
4. สบค-08 ไม่มีช่องสำหรับประวัติการส่งต่อ / ป้ายเข้าที่ประชุม (ไม่ได้พิมพ์)
5. `PATCH /api/car/:id` ช่วงติดตามผล (30→40/50, 40→50) ยังตรวจสิทธิ์แค่ใน UI (20→30 และ 50→60/70 ตรวจแล้ว) · `attachCarUser` ไม่รู้จัก bypass (ใช้ `resolveCarUser` จาก `carAdmin.js` แทนใน endpoint ใหม่)
8. ถ้าแก้ workflow อีก ให้แก้ `handoff/CAR_workflow.drawio` + เอกสาร Word ให้ตรง (สคริปต์ที่สร้าง PNG/docx อยู่ใน scratchpad ชั่วคราว — ไม่ได้เก็บใน repo)
6. ผู้ปฏิบัติงาน (ลูกจ้าง) ส่วน/กองตั้ง `กผจ.ฝผม.` เป็นค่าเริ่ม (ผู้ใช้ยังไม่ยืนยัน)
7. CLAUDE.md ระบุ status code เก่า (30=approved, 50=validated) — ควรอัปเดตเป็น 10/15/20/30/40/50/60/70

## 5. ข้อควรระวัง / วิธีทำงาน
- Agent **kill/restart server จริงไม่ได้** (process รันสิทธิ์สูงกว่า → Access denied) → ให้ผู้ใช้ restart เอง (`start.bat` / `LabVenture.exe`; อย่าใช้ `stop.bat` เพราะ kill node ทั้งเครื่อง)
- ทดสอบแบบแยก: copy `server/labventure.db` → scratchpad แล้วรัน `PORT=3099 LV_DB_PATH=<copy> LINE_CHANNEL_ACCESS_TOKEN="" LINE_GROUP_ID="" UROBOROS_BASE_URL=http://localhost:1 node index.js` + proxy เล็ก ๆ ที่ strip `/labventure` เฉพาะ `/labventure/api/*` (แทน BellBeast) → เปิด `http://localhost:<proxy>/labventure/...` แล้ว `POST /labventure/api/auth/bypass {role:'superadmin'}` (stage 1 ให้แค่ superadmin)
- ทดสอบมุมมอง role อื่นใน UI: patch `window.fetch` ให้ `/car-admin/my-role` คืนตัวตนที่ต้องการก่อน mount CARLog (โหลดหน้าอื่นก่อน แล้ว pushState ไป `/labventure/car`)
- ข้อมูลบุคคล (ชื่อพนักงาน, รหัสผู้ใช้งาน 13 หลัก) — อย่าคัดลอกลงไฟล์/commit

## 6. Suggested skills
- **run** — ยืนยันการทำงานบนหน้าจริงหลังผู้ใช้ restart (CAR Log ส่วน 1/2/4)
- **code-review** — ก่อน merge `car-workflow` (โดยเฉพาะ `routes/car.js` canHold/roleFilter/revert, `CARLog.jsx`)
- **security-review** — bypass token ไม่ verify signature, PATCH ไม่ตรวจสิทธิ์, AquaDAT endpoint ไม่ต้อง auth
- **grill-me** — ถ้าจะเปิดหน้า CAR ให้ operator หรือออกแบบขั้นหลัง "เข้าที่ประชุม"
