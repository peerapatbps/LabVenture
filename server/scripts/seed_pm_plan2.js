// One-off seed: "แผนตรวจสอบด้านโครงสร้างและอุปกรณ์หลัก" (ส่วนบริการโรงงาน 2) from the Excel plan, FY 2570.
// Usage: node scripts/seed_pm_plan2.js   (skips if plan code PS2-STRUCT already exists; honours LV_DB_PATH)
const { initDb, getDb, nowTH } = require('../services/db');

const CODE = 'PS2-STRUCT';
const Y = (n, anchor) => ({ v: 1, every: 12 * n, unit: 'month', anchor, until: null });

// [wbs, title, kind, recurrence, qty, children]
const TREE = [
  ['1', 'ตรวจสอบสภาพถังตกตะกอน', 'group', null, null, [
    ['1.1', 'ถังตกตะกอน เฟส 1 (A,B) 1 ปี/ครั้ง', 'task', Y(1, '2026-11'), 5, [
      [null, 'รายการตรวจ 3 ปี/ครั้ง ถังตกตะกอน 1A (ทำภายในปีงบ 2570)', 'task', Y(3, '2026-11')],
      [null, 'รายการตรวจ 3 ปี/ครั้ง ถังตกตะกอน 1B (ทำภายในปีงบ 2570)', 'task', Y(3, '2026-11')],
    ]],
    ['1.2', 'ถังตกตะกอน เฟส 2 (A,B) 1 ปี/ครั้ง', 'task', Y(1, '2027-01'), 5, [
      [null, 'รายการตรวจ 3 ปี/ครั้ง ถังตกตะกอน 2A (ทำภายในปีงบ 2572)', 'task', Y(3, '2029-01')],
      [null, 'รายการตรวจ 3 ปี/ครั้ง ถังตกตะกอน 2B (ทำภายในปีงบ 2572)', 'task', Y(3, '2029-01')],
    ]],
    ['1.3', 'ถังตกตะกอน เฟส 3 (A,B) 1 ปี/ครั้ง', 'task', Y(1, '2027-01'), 6, [
      [null, 'รายการตรวจ 3 ปี/ครั้ง ถังตกตะกอน 3A (ทำภายในปีงบ 2572)', 'task', Y(3, '2029-01')],
      [null, 'รายการตรวจ 3 ปี/ครั้ง ถังตกตะกอน 3B (ทำภายในปีงบ 2570)', 'task', Y(3, '2027-01')],
    ]],
    ['1.4', 'ถังตกตะกอน เฟส 4 (A,B) 1 ปี/ครั้ง', 'task', Y(1, '2026-12'), 6, [
      [null, 'รายการตรวจ 3 ปี/ครั้ง ถังตกตะกอน 4A (ทำภายในปีงบ 2570)', 'task', Y(3, '2026-12')],
      [null, 'รายการตรวจ 3 ปี/ครั้ง ถังตกตะกอน 4B (ทำภายในปีงบ 2570)', 'task', Y(3, '2026-12')],
    ]],
  ]],
  ['2', 'ตรวจสอบสภาพบ่อกรอง', 'group', null, null, [
    ['2.1', 'บ่อกรอง เฟส 1,2 1 ปี/ครั้ง', 'task', Y(1, '2027-02'), 6, [
      [null, 'เก็บตัวอย่างทดสอบคุณภาพวัสดุกรอง 5 ปี/ครั้ง (ทำภายในปีงบ 2570)', 'task', Y(5, '2027-02')],
    ]],
    ['2.2', 'บ่อกรอง เฟส 3 1 ปี/ครั้ง', 'task', Y(1, '2027-03'), 6, [
      [null, 'เก็บตัวอย่างทดสอบคุณภาพวัสดุกรอง 5 ปี/ครั้ง (ทำภายในปีงบ 2570)', 'task', Y(5, '2027-03')],
    ]],
    ['2.3', 'บ่อกรอง เฟส 4 1 ปี/ครั้ง', 'task', Y(1, '2027-04'), 6, [
      [null, 'เก็บตัวอย่างทดสอบคุณภาพวัสดุกรอง 5 ปี/ครั้ง (ทำภายในปีงบ 2571)', 'task', Y(5, '2028-04')],
    ]],
  ]],
  ['3', 'ตรวจสอบสภาพอาคาร', 'group', null, null, [
    ['3.1', 'โรงสูบน้ำดิบ1 โรงจ่ายสารส้ม1,2 โรงจ่ายคลอรีน1,2 โรงจ่ายคาร์บอน โรงสูบจ่าย โรงสูบส่ง', 'task', Y(1, '2027-05')],
    ['3.2', 'โรงสูบน้ำดิบ2 โรงจ่ายสารส้ม3,4 โรงจ่ายคลอรีน3,4 โรงจ่ายโพลีเมอร์ สถานีไฟฟ้าย่อย1B', 'task', Y(1, '2027-06')],
  ]],
  ['4', 'ตรวจสอบสภาพถังเก็บน้ำใส เฟส 1-4', 'task', Y(1, '2027-07')],
  ['5', 'ตรวจสอบหอเติมอากาศ 1 ปี/ครั้ง', 'task', Y(1, '2027-07'), 4],
];

initDb();
const db = getDb();
if (db.get('SELECT id FROM pm_plans WHERE code = ?', [CODE])) {
  console.log(`plan ${CODE} already exists — skipped`);
  process.exit(0);
}
const now = nowTH(), by = 'seed';
db.run(`INSERT INTO pm_plans (code, title, org_unit, fy_start_month, forecast_years, created_at, updated_at, updated_by)
        VALUES (?, ?, ?, 10, 4, ?, ?, ?)`,
  [CODE, 'แผนตรวจสอบด้านโครงสร้างและอุปกรณ์หลัก', 'ส่วนบริการโรงงาน 2 กองบริการโรงงาน ฝ่ายโรงงานผลิตน้ำมหาสวัสดิ์', now, now, by]);
const planId = db.get('SELECT id FROM pm_plans WHERE code = ?', [CODE]).id;

let n = 0;
function insert(nodes, parentId) {
  nodes.forEach(([wbs, title, kind, rec, qty, children], i) => {
    db.run(`INSERT INTO pm_tasks (plan_id, parent_id, wbs, title, kind, sort_order, recurrence, qty, unit, created_at, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [planId, parentId, wbs, title, kind, i + 1, rec ? JSON.stringify(rec) : null, qty ?? null, qty ? 'รายการ' : null, now, now, by]);
    n++;
    const id = db.get('SELECT last_insert_rowid() AS id').id;
    if (children) insert(children, id);
  });
}
insert(TREE, null);
console.log(`seeded plan ${CODE} (id ${planId}) with ${n} rows`);
