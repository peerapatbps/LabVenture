# Handoff 07 พ.ย. 2569 — จัดกลุ่ม/layout Test Mode ใหม่

> ภาพรวมระบบและวิธี deploy อยู่ใน `handoff/handoff_conclude0611.md` (หัวข้อ 4.2) และ `handoff/handoff0611.md` อ่านสองไฟล์นี้ก่อน ไฟล์นี้บันทึกเฉพาะงานของ session วันนี้

## 1. งานที่ทำเสร็จ

| งาน | สถานะ |
|---|---|
| Test Mode panel ของหน้า `/config` (กด Ctrl+Shift+F10 · ใช้ได้เฉพาะ super admin) จัดกลุ่มและ layout ใหม่ | เสร็จแล้ว · `vite build` ผ่าน · **ยังไม่ได้ commit** |
| Deploy client ไป `Fullscale_V2\DEPLOY_LabVenture\client\dist` | เสร็จแล้ว (ใช้ robocopy /MIR) · dist ตัวก่อนหน้าเก็บไว้ที่ `client\dist.bak_20261107b` |
| ทดสอบบนหน้าจริง | **ยังไม่ได้ทำ** เพราะเบราว์เซอร์ในแอปเปิด `localhost:443` ไม่ได้ (navigate ถูกปฏิเสธ) |

ฝั่ง server ไม่ได้แก้อะไร `server/routes/testMode.js` ใน repo กับใน deploy เหมือนกันทุกบรรทัด (เทียบด้วย `diff --strip-trailing-cr`)

## 2. โครงสร้างใหม่ (ดูโค้ดจริงได้ที่ path)

- `client/src/components/TestModePanel.jsx` ทำหน้าที่ประกอบหน้า และเก็บ state กลางไว้ทั้งหมด:
  - `run(where, fn, okText)` ส่งผลลัพธ์ไปแสดงใต้ปุ่มของส่วนที่กด (`where` = lab / cl / scenario / live / pending) และบันทึกประวัติไว้ 5 รายการล่าสุด
  - baseline ของสถานการณ์เก็บใน sessionStorage key `lv.testmode.baseline` (ใช้ key เดิม)
  - **ของใหม่:** sessionStorage key `lv.testmode.enabled` เก็บรายการ Event Class ที่ panel เปิดให้ตอนฉีดค่า เพื่อให้ปุ่ม "เก็บกวาดทั้งหมด" ปิดคลาสเหล่านั้นคืนได้
  - แท็บที่เลือกล่าสุดจำไว้ใน localStorage key `lv.testmode.tab`
- `client/src/components/testmode/`
  - `shared.jsx`: class ของ input/ปุ่ม, `CL_PLANTS`/`CL_POINTS`, `store()`, `Msg`/`Note`/`Info`/`TestBadge`
  - `Header.jsx`: รวมคำเตือนเรื่อง Uroboros ทั้ง 5 แบบเป็นป้ายเดียว กดที่ป้ายเพื่อดูรายละเอียด
  - `PendingBar.jsx`: แถบ "กำลังทดสอบอยู่" กับปุ่ม **เก็บกวาดทั้งหมด** ซึ่งจะ `window.confirm` ก่อน แล้วล้างค่าปลอมแล็ปและคลอรีน ปิด Event Class ที่ panel เปิดให้ และคืนสถานการณ์
  - `LabTab.jsx`, `ChlorineTab.jsx`, `ScenarioTab.jsx`: แท็บฝั่งซ้าย
  - `LivePanel.jsx`: คอลัมน์ขวา แสดงค่าปลอมของแล็ปและคลอรีนรวมกันพร้อมปุ่มล้างรายตัว ต่อด้วย alarm `lab:` และ `ec:` รวมกัน และประวัติที่ทำ
- แผงกว้าง `max-w-3xl` แบ่ง 2 คอลัมน์เมื่อจอกว้างระดับ `md` ขึ้นไป แต่ละคอลัมน์เลื่อนแยกกัน บนจอแคบเรียงเป็นคอลัมน์เดียว
- ปุ่ม "ล้างจุดนี้" และ "ล้างทั้งหมด" ในแท็บคลอรีนเอาออกแล้ว ไปใช้ปุ่มล้างรายตัวใน LivePanel แทน

## 3. ต้องทำต่อ

1. **ทดสอบบนหน้าจริง** ที่ `http://localhost:443/labventure/config` → กด Ctrl+Shift+F10 → Ctrl+Shift+R แล้วไล่เช็คตามนี้:
   - ป้ายสถานะ: กดเปิดได้ และแสดงคำเตือนถูกต้อง
   - ฉีดค่าแล็ปไปที่คลาสที่ปิดอยู่: คลาสต้องถูกเปิดให้ แล้วแถบด้านบนแสดง "Event Class ที่เปิดให้ทดสอบ 1"
   - ฉีดค่าคลอรีน: รายการต้องขึ้นในคอลัมน์ขวา
   - เปลี่ยนสถานการณ์
   - กด "เก็บกวาดทั้งหมด": ทุกอย่างต้องกลับเป็นค่าเดิม และแถบแสดง "ไม่มีอะไรค้าง ✓"
   - ลองที่จอแคบ (mobile)
2. ถ้าใช้ได้ตามที่ต้องการ ให้ **commit** เฉพาะ `client/src/components/TestModePanel.jsx` กับ `client/src/components/testmode/`
   - ไฟล์อื่นที่ค้างเป็น modified (`server/routes/testMode.js`, `alarmWatcher.js`, `uroboros.js`, `seed_cl_eventclasses.js`, `handoff/*`) เป็นงานจาก session ก่อน ให้ถามผู้ใช้ก่อนว่าจะ commit รวมด้วยหรือไม่
3. ถ้าต้อง deploy ไปเครื่องปลายทาง ให้ copy เฉพาะ `DEPLOY_LabVenture\client\dist` ไปทับ ไม่ต้องยุ่งกับ db หรือ config

## 4. ข้อควรระวัง

- client build มาจาก working tree ทั้งหมด จึงรวมงานอื่นที่ยังไม่ได้ commit ไปด้วย
- ถ้าผู้ใช้ปิดแท็บเบราว์เซอร์ก่อนกดเก็บกวาด รายการ `lv.testmode.enabled` จะหายไป Event Class ที่ panel เปิดให้จะยังเปิดค้างอยู่ ต้องไปปิดเองในหน้า Event Class
- build ต้องใช้ production mode เท่านั้น (`npx vite build`) ห้ามใช้ `--mode development` เพราะจะทำให้ BASE ว่าง

## 5. Suggested skills

- `run`: เปิดแอปเพื่อทดสอบ ถ้าเบราว์เซอร์ในแอปยังเปิด :443 ไม่ได้ ให้ลอง Claude in Chrome (ถามผู้ใช้ก่อน)
- `code-review` / `scrutinize`: รีวิว diff ของ `TestModePanel.jsx` และ `components/testmode/` ก่อน commit โดยเฉพาะ logic ใน `cleanupAll`
- `handoff:handoff`: ใช้ปิด session ถัดไป (**append** ต่อท้ายไฟล์เท่านั้น ห้ามเขียนทับ)
