# Handoff 2026-11-06 — eventclass.sync 500 on deploy → DB repair + DB health self-init

Session 2026-11-05 → 06. ผู้ใช้เปิด Uroboros ไว้แค่ 2 task (`alarm.eval`, `eventclass.sync`) เพื่อให้ทำแค่ lab alarm แต่บนเครื่อง deploy `eventclass.sync` ขึ้น
`eventclass sync failed (using cache 10): Response status code does not indicate success: 500`

## 1. สาเหตุ (ยืนยันแล้ว)
- `eventclass.sync` (Uroboros `AlarmIo.cs` `EventClassSyncTask`) ดึงข้อมูลจาก `LABVENTURE_URL` (ค่า default `http://localhost:8889`) ต่อด้วย `/labventure/api/eventclass?enabled=true` **ตรงๆ ไม่ผ่าน BellBeast**
- ผล curl บนเครื่อง deploy: `SQLite3Error: no such table: event_classes` ที่ `routes/eventClass.js:71`
- `labventure.db` บนเครื่อง deploy เป็นไฟล์ schema รุ่นเก่า มี 18 ตาราง ไม่มีตาราง alarm และ PM ข้อสันนิษฐาน (ไม่ได้เห็นเอง): ไฟล์ถูกวางทับขณะที่ server รันอยู่ จึงไม่มีจังหวะให้ `initDb()` สร้างตาราง ข้อนี้ตรงกับที่ก่อนหน้านี้ Uroboros เคย sync ได้ 10 class
- Uroboros ยังใช้ cache 10 class เดิมอยู่ (`eventclass_cache.json` ในโฟลเดอร์โปรแกรม Uroboros) alarm แลปจึงยังทำงาน

## 2. ทำแล้ว
| งาน | สถานะ | ที่อยู่ |
|---|---|---|
| ซ่อม DB ของเครื่อง deploy | เสร็จ ยังไม่ได้ลงเครื่อง deploy | `C:\Users\peera\Downloads\labventure_fixed.db` (ต้นฉบับ `Downloads\labventure.db` ไม่ได้แตะ) |
| DB health / self-init | commit + copy ไปชุด deploy แล้ว | LabVenture `79bebe4` |
| Snapshot งานที่ค้างตั้งแต่ 29 ต.ค. (161 ไฟล์ ตามที่ผู้ใช้สั่ง) | commit แล้ว | LabVenture `9b9f74f` |

- `labventure_fixed.db` = ไฟล์ deploy + รัน `initDb()` ตัวจริง (ได้ 28 ตาราง) + Event Class 20 ตัว (เปิดใช้ 10) copy จาก `Fullscale_V2\DEPLOY_LabVenture\server\labventure.db` ซึ่งทุกตัวมี scenario_id เป็น NULL ทดสอบแล้วได้ HTTP 200 พร้อม 10 class (cw1/cw2 turb > 5, tw1–4 ResCl2 > 1.4 / < 1)
- รายละเอียดของ `79bebe4` อยู่ใน commit message มีจุดสำคัญดังนี้:
  - ตรวจทุก 60 วินาที และทุกครั้งที่เจอ "no such table" → รัน `initDb` ซ้ำ แล้วตอบ 503
  - ถ้า `event_classes` ถูกสร้างใหม่แบบว่าง → `?enabled=true` ตอบ 503 เพื่อให้ Uroboros ใช้ cache เดิมต่อ (flag อยู่ใน `db_meta` ปลดเองเมื่อตารางมีอย่างน้อย 1 แถว)
  - endpoint `GET/POST /labventure/api/health/db[/repair]`
- ทดสอบด้วย harness (ไม่ได้สตาร์ท index.js ตัวเต็ม) ผ่าน 4 กรณี: DB ปกติ / วางไฟล์ทับขณะรัน / ตัวกันตอนตารางว่าง / ตัวกันปลดเอง ตัว harness อยู่ใน scratchpad ของ session ซึ่งอาจถูกลบไปแล้ว

## 3. ต้องทำต่อ (ที่เครื่อง deploy `C:\Fullscale_V2\DEPLOY_LabVenture`)
1. Copy 5 ไฟล์ใน `server\` (`index.js`, `services\db.js`, `services\dbHealth.js`, `routes\health.js`, `routes\eventClass.js`) จากชุดในเครื่องนี้ `OneDrive\Desktop\Fullscale_V2\DEPLOY_LabVenture\server\` ไม่ต้อง build client ใหม่
2. **ปิด LabVenture ก่อน** แล้ว backup `server\labventure.db` → วาง `labventure_fixed.db` แทน (เปลี่ยนชื่อเป็น `labventure.db`) → เปิด server
3. ตรวจผล:
   - `curl http://localhost:8889/labventure/api/health/db` ต้องได้ ok, 28 ตาราง, event_classes rows 20 / enabled 10
   - ภายใน 2 นาที log ของ Uroboros ต้องขึ้น `[EVENTCLASS] synced 10 classes`
4. ถ้าบนเครื่อง deploy เคยแก้ Event Class หลังจากที่ copy DB ตัว dev มา ส่วนนั้นจะไม่อยู่ใน `labventure_fixed.db` ให้เทียบกับ `eventclass_cache.json` ของ Uroboros

## 4. ข้อควรระวัง
- โค้ด LabVenture มีสองชุด: `Desktop\LabVenture` (git, origin `peerapatbps/LabVenture`, **ยังไม่ได้ push**) และ `Desktop\Fullscale_V2\DEPLOY_LabVenture` (ชุด deploy, ไม่ใช่ git) ทั้งสองชุดยังต่างกันในบางไฟล์ เช่น `routes/algae.js`, `.env`, config/scenario JSON ให้เช็คด้วย `diff -rq` ก่อน sync ทั้งชุด
- ยังเหลือ `server/__pycache__/*.pyc` ที่ถูก track อยู่และค้างเป็น modified ตอนนี้ `.gitignore` ข้าม `__pycache__/` แล้ว ถ้าจะเอาออกจาก git ให้ใช้ `git rm --cached`
- เมื่อ `event_classes` ว่างเพราะเป็นการติดตั้งใหม่จริงๆ (fresh install) endpoint ก็จะตอบ 503 ด้วย จนกว่าจะสร้าง class ตัวแรก ซึ่งเป็นพฤติกรรมที่ตั้งใจไว้

## 5. Suggested skills
- `scrutinize` / `code-review`: ใช้รีวิว `79bebe4` ก่อน push
- `handoff:handoff`: ใช้ปิด session ถัดไป (**append** ต่อท้ายไฟล์เท่านั้น ห้ามเขียนทับ)

## 6. เพิ่มเติม: วิธี deploy ที่ใช้จริง (ผู้ใช้แจ้ง 2026-11-06)
ขั้นตอนจริงคือ copy `DEPLOY_LabVenture` ไปวางทั้งโฟลเดอร์ แล้วเอา **config + db เดิมของเครื่อง deploy มาวางทับ** ดังนั้นข้อ 3 ด้านบนให้ทำตามนี้แทน:
- ไฟล์ที่ถือเป็น "db เดิมของเครื่อง deploy" รอบนี้คือ `labventure_fixed.db` (เปลี่ยนชื่อเป็น `server\labventure.db`) ไม่ใช่ไฟล์เดิมที่ไม่มีตาราง alarm
- ต้องปิด LabVenture ก่อนวาง db ทับทุกครั้ง และ db ที่นำมาวางต้องเป็นไฟล์ล่าสุดที่เพิ่งเอาออกจากเครื่องหลังปิด server ห้ามใช้ backup เก่า เพราะเหตุการณ์ครั้งนี้น่าจะเกิดจากการวาง db เก่าหรือ db ผิดตัว
- หลังเปิด server ให้เช็ค `/labventure/api/health/db` ถ้าเห็น `created` หรือ `recreated_at` แปลว่าวาง db ผิดตัว
