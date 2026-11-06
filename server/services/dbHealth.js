// ตรวจ + ซ่อมตาราง DB ระหว่าง server รันอยู่ (กรณีไฟล์ labventure.db ถูกวางทับด้วยไฟล์รุ่นเก่า)
// check: ตารางที่ initDb รอบล่าสุดมี ยังอยู่ในไฟล์ครบไหม → ไม่ครบ = รัน initDb ซ้ำ (IF NOT EXISTS ทั้งหมด ข้อมูลเดิมไม่หาย)
const { initDb, dbStatus, eventClassesRecreatedAt, getDb, nowTH } = require('./db');

const CHECK_MS = 60_000;
let lastRepair = null;   // { at, reason, missing }
let timer = null;

function ensureDb(reason) {
  const st = dbStatus();
  if (st.ok) return st;
  console.warn(`[DB] ${reason}: ไฟล์ ${st.path} ขาดตาราง ${st.missing.join(', ') || '-'}${st.error ? ` (${st.error})` : ''} → init ตารางใหม่`);
  initDb();
  try { require('./scenarioHistory').initScenarioHistory(); }
  catch (e) { console.warn(`[DB] initScenarioHistory หลังซ่อม: ${e.message}`); }
  lastRepair = { at: nowTH(), reason, missing: st.missing };
  return dbStatus();
}

// สำหรับ GET /api/health/db
function status() {
  const st = dbStatus();
  let ec = null;
  try {
    const r = getDb().get('SELECT COUNT(*) AS n, COALESCE(SUM(enabled), 0) AS en FROM event_classes');
    ec = { rows: r.n, enabled: r.en, recreated_at: eventClassesRecreatedAt() };
  } catch (e) { ec = { error: e.message }; }
  return { ...st, event_classes: ec, last_repair: lastRepair, checked_at: nowTH() };
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    try { ensureDb('periodic check'); } catch (e) { console.error(`[DB] periodic check failed: ${e.message}`); }
  }, CHECK_MS);
  timer.unref?.();
}

module.exports = { ensureDb, status, start };
