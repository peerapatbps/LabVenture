// Mock เที่ยวรถสารเคมี (WDATA + SIDECAR_UNLOAD/FILL) ลง chem.db ของ Uroboros เพื่อทดสอบ /chem-intake
// ใช้ node:sqlite (Node >= 22.5) เพราะ chem.db เป็น WAL mode
//
//   node server/scripts/mockChemData.js add   [YYYY-MM-DD] [--next]   เพิ่มเที่ยวของวันนั้น (--next = เพิ่มเที่ยววันถัดไปไว้ทดสอบตัดยอด)
//   node server/scripts/mockChemData.js clean                         ลบเที่ยว mock ทั้งหมดที่สคริปต์นี้สร้าง
//   node server/scripts/mockChemData.js list                          ดูเที่ยว mock ที่มีอยู่
//
// ⚠ chem.db ถูก Uroboros แทนทั้งไฟล์เมื่อมีไฟล์ใหม่มา → ข้อมูล mock จะหายเอง; ใช้บนเครื่อง dev/test เท่านั้น
// ตัวระบุ mock: WDATA.TRUCK ขึ้นต้น 'MOCK-' และ SIDECAR_UNLOAD.SOURCE = 'mock-bat'
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const UROBOROS_DIR = process.env.UROBOROS_DIR
  || 'C:\\Users\\peera\\OneDrive\\Desktop\\Fullscale_V2\\Uroboros_proj';
const MEDIA = path.join(UROBOROS_DIR, 'media');
const SOURCE = 'mock-bat';

// ชุดเที่ยวต่อวัน: product 01 = ALUM, 03 = PACL
// sidecar:false = เที่ยวที่ยังไม่มีข้อมูล sidecar (ทดสอบกรณี sidecar = null)
const TRIPS = [
  { company: '01', product: '01', tmin: '07:30', w1: 30120, w2: 11050, sidecar: true },
  { company: '01', product: '01', tmin: '09:45', w1: 29980, w2: 10980, sidecar: true },
  { company: '02', product: '01', tmin: '10:20', w1: 30250, w2: 11100, sidecar: false },
  { company: '05', product: '03', tmin: '08:10', w1: 24900, w2: 10780, sidecar: true },
  { company: '05', product: '03', tmin: '13:30', w1: 24860, w2: 10750, sidecar: true },
  { company: '04', product: '03', tmin: '14:50', w1: 24930, w2: 10800, sidecar: true },
];
const CHEM = { '01': 'ALUM', '03': 'PACL' };
const TANK = { ALUM: 'ALUM A', PACL: 'PACL A' };
const SG = { ALUM: 1.32, PACL: 1.21 };

function resolveChemDb() {
  if (process.env.CHEM_DB) return process.env.CHEM_DB;
  const ptr = path.join(MEDIA, 'chem.current.txt');
  const name = fs.existsSync(ptr) ? fs.readFileSync(ptr, 'utf8').trim() : '';
  return path.join(MEDIA, name || 'chem.db');
}

function todayTH() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}
function addDays(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function addMin(hhmm, min) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
const pad10 = n => String(n).padStart(10, '0');

function backup(db, file) {
  const stamp = new Date(Date.now() + 7 * 3600e3).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  let out = `${file}.bak-mock-${stamp}`;
  for (let i = 2; fs.existsSync(out); i++) out = `${file}.bak-mock-${stamp}-${i}`;
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); // ปลอดภัยกับ WAL กว่า copy ไฟล์
  console.log(`สำรองไฟล์ → ${out}`);
}

function addDay(db, date, state) {
  const insW = db.prepare(`INSERT INTO WDATA (STAT,TRUCK,CARTYPE,COMPANY,PRODUCT,DAYIN,TMIN,W1,DAYOUT,TMOUT,W2,TICKET1,TICKET2)
    VALUES ('2',?,'1',?,?,?,?,?,?,?,?,?,?)`);
  const insU = db.prepare(`INSERT INTO SIDECAR_UNLOAD (ID,TICKET1,TICKET2,PLATE,CHEMICAL,PRODUCT,SOURCE,WEIGH_IN_AT,W1,WEIGH_OUT_AT,W2,NET_KG,
    SG,TEMP_C,BILL_BOOK,BILL_NO,IS_COMPLETE,VERSION,CREATED_AT,CREATED_BY,UPDATED_AT,UPDATED_BY,SYNCED)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,'mock',?,'mock',0)`);
  const insF = db.prepare(`INSERT INTO SIDECAR_FILL (UNLOAD_ID,SEQ,TANK,LEVEL_BEFORE,LEVEL_AFTER,AFTER_AT) VALUES (?,1,?,?,?,?)`);

  const rows = [];
  TRIPS.forEach((t, i) => {
    const t1 = pad10(++state.t1), t2 = pad10(++state.t2);
    const plate = `MOCK-${String(i + 1).padStart(2, '0')}`;
    const tmin = `${t.tmin}:00`, tmout = `${addMin(t.tmin, 50)}:00`;
    const chem = CHEM[t.product];
    const net = Math.abs(t.w1 - t.w2);
    insW.run(plate, t.company, t.product, date, tmin, t.w1, date, tmout, t.w2, t1, t2);
    if (t.sidecar) {
      const id = `mockbat${t1}`;
      insU.run(id, t1, t2, plate, chem, t.product, SOURCE, `${date} ${tmin}`, t.w1, `${date} ${tmout}`, t.w2, net,
        SG[chem], 30, 'S9', t1.slice(-4), `${date} ${tmout}`, `${date} ${tmout}`);
      insF.run(id, TANK[chem], 4, 19, `${date} ${tmout}`);
    }
    rows.push({ TICKET1: t1, วันที่: date, เข้า: t.tmin, สาร: chem, บริษัท: t.company, ทะเบียน: plate, NET_KG: net, sidecar: t.sidecar ? '✓' : '-' });
  });
  return rows;
}

function listMock(db) {
  return db.prepare(`SELECT w.TICKET1, w.DAYIN, w.TMIN, w.PRODUCT, w.COMPANY, w.TRUCK, ABS(w.W1-w.W2) NET_KG,
      CASE WHEN u.ID IS NULL THEN '-' ELSE '✓' END sidecar
    FROM WDATA w LEFT JOIN SIDECAR_UNLOAD u ON u.TICKET1 = w.TICKET1
    WHERE w.TRUCK LIKE 'MOCK-%' ORDER BY w.DAYIN, w.TMIN`).all();
}

// เตือนถ้าเที่ยว mock ถูกใช้ใน chemlab.db แล้ว (ลบ WDATA แล้วขวด/เคสจะอ้างถึง ticket ที่ไม่มี)
function warnChemlabRefs(tickets) {
  const labPath = path.join(UROBOROS_DIR, 'chemlab.db');
  if (!tickets.length || !fs.existsSync(labPath)) return;
  try {
    const lab = new DatabaseSync(labPath, { readOnly: true });
    const q = `(${tickets.map(() => '?').join(',')})`;
    const b = lab.prepare(`SELECT COUNT(*) n FROM LAB_BOTTLE WHERE ticket1 IN ${q}`).get(...tickets).n;
    const c = lab.prepare(`SELECT COUNT(*) n FROM LAB_CASE_TICKET WHERE ticket1 IN ${q}`).get(...tickets).n;
    const o = lab.prepare(`SELECT COUNT(*) n FROM LAB_OFFSET WHERE ticket1 IN ${q}`).get(...tickets).n;
    lab.close();
    if (b + c + o) console.log(`⚠ chemlab.db ยังอ้างถึงเที่ยวเหล่านี้: ขวด ${b} · เคส ${c} · ตัดยอด ${o} (ไม่ได้ลบใน chemlab.db)`);
  } catch (e) { /* chemlab.db ยังไม่มีตาราง — ข้าม */ }
}

function main() {
  const [cmd = 'add', ...args] = process.argv.slice(2);
  const file = resolveChemDb();
  if (!fs.existsSync(file)) { console.error(`ไม่พบ chem.db: ${file}`); process.exit(1); }
  console.log(`chem.db: ${file}`);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000');

  if (cmd === 'list') {
    const rows = listMock(db);
    rows.length ? console.table(rows) : console.log('ยังไม่มีเที่ยว mock');
    return;
  }

  if (cmd === 'clean') {
    const tickets = listMock(db).map(r => r.TICKET1);
    if (!tickets.length) { console.log('ไม่มีเที่ยว mock ให้ลบ'); return; }
    backup(db, file);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`DELETE FROM SIDECAR_FILL WHERE UNLOAD_ID IN (SELECT ID FROM SIDECAR_UNLOAD WHERE SOURCE = ?)`).run(SOURCE);
      const u = db.prepare(`DELETE FROM SIDECAR_UNLOAD WHERE SOURCE = ?`).run(SOURCE).changes;
      const w = db.prepare(`DELETE FROM WDATA WHERE TRUCK LIKE 'MOCK-%'`).run().changes;
      db.exec('COMMIT');
      console.log(`ลบแล้ว: WDATA ${w} แถว · SIDECAR_UNLOAD ${u} แถว`);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    warnChemlabRefs(tickets);
    return;
  }

  if (cmd !== 'add') { console.error(`ไม่รู้จักคำสั่ง: ${cmd} (add | clean | list)`); process.exit(1); }

  const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || todayTH();
  const dates = args.includes('--next') ? [date, addDays(date, 1)] : [date];
  const exist = db.prepare(`SELECT COUNT(*) n FROM WDATA WHERE TRUCK LIKE 'MOCK-%' AND DAYIN = ?`);
  for (const d of dates) {
    if (exist.get(d).n) { console.error(`วันที่ ${d} มีเที่ยว mock อยู่แล้ว — ใช้ clean ก่อน หรือเลือกวันอื่น`); process.exit(1); }
  }

  backup(db, file);
  const max = db.prepare(`SELECT MAX(CAST(TICKET1 AS INTEGER)) t1, MAX(CAST(TICKET2 AS INTEGER)) t2 FROM WDATA`).get();
  const state = { t1: max.t1 || 0, t2: max.t2 || 0 };
  const rows = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const d of dates) rows.push(...addDay(db, d, state));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.table(rows);
  console.log(`เพิ่ม ${rows.length} เที่ยวแล้ว → เปิด http://localhost:443/labventure/chem-intake แท็บรับขวด เลือกวันที่ ${dates.join(', ')}`);
}

main();
