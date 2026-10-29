// Background retry for aquadat_queue + excel_queue.
// - Excel: retry ทุก 5 นาที (เช่น ไฟล์ถูกเปิดค้างที่เครื่องอื่น → รอจนปิด)
// - AquaDAT: ต้องมี token จริง → จำ token ล่าสุดของผู้ใช้ที่ login AquaDAT (ไม่ใช่ bypass) แล้วใช้ retry
//   เฉพาะตอน stage 1
// ทั้งสองคิวส่ง "ค่าล่าสุดใน node_records" แทน payload เดิม กันค่าเก่าในคิวเขียนทับค่าที่แก้ภายหลัง
const fs = require('fs');
const path = require('path');
const { getDb, nowTH } = require('./db');
const { writeData } = require('./aquadat');
const { writeToExcel } = require('./excelWriter');
const { getStage } = require('./stageMonitor');

const NODES_PATH = path.join(__dirname, '..', 'config', 'nodes.json');
const INTERVAL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 288;   // ~24 ชม. ที่รอบละ 5 นาที แล้วค่อยเป็น 'dead' (ยังกด retry มือได้)

// ── AquaDAT token cache ──────────────────────────────────────────────────────
let _token = null;
let _tokenExp = 0;

function rememberToken(token) {
  if (!token || token.endsWith('.bypass')) return;
  let exp = 0;
  try { exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp || 0; } catch {}
  _token = token;
  _tokenExp = exp;
}

function usableToken() {
  if (!_token) return null;
  if (_tokenExp && _tokenExp * 1000 < Date.now() + 60_000) return null;
  return _token;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function currentValue(db, param_key, trans_dtm, trans_time) {
  const row = db.get(
    'SELECT trans_value FROM node_records WHERE param_key = ? AND trans_dtm = ? AND trans_time = ?',
    [param_key, trans_dtm, trans_time]
  );
  return row ? row.trans_value : null;
}

function loadRecorders(db, dates) {
  const out = {};
  for (const d of dates) {
    out[d] = {};
    for (const row of db.all('SELECT shift_range, recorder_name, position_label FROM slot_recorders WHERE trans_dtm = ?', [d])) {
      out[d][row.shift_range] = { name: row.recorder_name, position_label: row.position_label };
    }
  }
  return out;
}

function cfgToParamKey() {
  const map = {};
  try {
    for (const node of JSON.parse(fs.readFileSync(NODES_PATH, 'utf8')).nodes) {
      for (const p of node.parameters) if (p.configparam_id) map[p.configparam_id] = p.param_key;
    }
  } catch {}
  return map;
}

function markSuccess(db, table, id) {
  db.run(`UPDATE ${table} SET status='success', last_attempt=? WHERE id=?`, [nowTH(), id]);
}

function markFailed(db, table, item, err, maxAttempts) {
  const attempts = item.attempts + 1;
  db.run(
    `UPDATE ${table}
        SET attempts=?, last_attempt=?, last_error=?,
            status=CASE WHEN ? >= ? THEN 'dead' ELSE 'pending' END
      WHERE id=?`,
    [attempts, nowTH(), err.message, attempts, maxAttempts, item.id]
  );
}

// ── Excel ────────────────────────────────────────────────────────────────────
let _excelBusy = false;

async function processExcelQueue({ statuses = ['pending'], maxAttempts = MAX_ATTEMPTS } = {}) {
  if (_excelBusy) return { skipped: true, succeeded: 0, failed: 0 };
  _excelBusy = true;
  const db = getDb();
  let succeeded = 0, failed = 0;
  try {
    const items = db.all(
      `SELECT * FROM excel_queue WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY id ASC`,
      statuses
    );
    for (const item of items) {
      try {
        const payload = JSON.parse(item.payload);
        const queued = Array.isArray(payload) ? payload : (payload.records || []);
        const records = queued.map(r => {
          const v = currentValue(db, r.param_key, r.trans_dtm, r.trans_time);
          return v === null ? r : { ...r, trans_value: v };
        });
        const recorders = loadRecorders(db, [...new Set(records.map(r => r.trans_dtm))]);
        await writeToExcel(records, recorders);
        markSuccess(db, 'excel_queue', item.id);
        succeeded++;
      } catch (err) {
        markFailed(db, 'excel_queue', item, err, maxAttempts);
        failed++;
        // ไฟล์เดียวกันยังเปิดค้าง → รายการถัดไปก็จะล้มเหมือนกัน ไม่ต้องเปิด Excel ซ้ำทุกรายการ
        if (/ถูกเปิดค้าง|read-only/.test(err.message)) break;
      }
    }
  } finally {
    _excelBusy = false;
  }
  if (succeeded || failed) console.log(`[queueWorker] excel: ${succeeded} ok, ${failed} failed`);
  return { succeeded, failed };
}

// ── AquaDAT ──────────────────────────────────────────────────────────────────
let _aquadatBusy = false;

async function processAquadatQueue(token, { statuses = ['pending'], maxAttempts = MAX_ATTEMPTS } = {}) {
  if (!token) return { skipped: true, succeeded: 0, failed: 0 };
  if (_aquadatBusy) return { skipped: true, succeeded: 0, failed: 0 };
  _aquadatBusy = true;
  const db = getDb();
  const keyOf = cfgToParamKey();
  let succeeded = 0, failed = 0;
  try {
    const items = db.all(
      `SELECT * FROM aquadat_queue WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY id ASC`,
      statuses
    );
    for (const item of items) {
      try {
        const records = JSON.parse(item.payload).map(r => {
          const key = keyOf[r.configparam_id];
          const v = key ? currentValue(db, key, r.trans_dtm, r.trans_time) : null;
          return v === null ? r : { ...r, trans_value: v };
        });
        await writeData(token, records);
        markSuccess(db, 'aquadat_queue', item.id);
        succeeded++;
      } catch (err) {
        markFailed(db, 'aquadat_queue', item, err, maxAttempts);
        failed++;
      }
    }
  } finally {
    _aquadatBusy = false;
  }
  if (succeeded || failed) console.log(`[queueWorker] aquadat: ${succeeded} ok, ${failed} failed`);
  return { succeeded, failed };
}

// ── scheduler ────────────────────────────────────────────────────────────────
async function tick() {
  try { await processExcelQueue(); } catch (e) { console.error('[queueWorker] excel tick:', e.message); }
  if (getStage() === 1) {
    try { await processAquadatQueue(usableToken()); } catch (e) { console.error('[queueWorker] aquadat tick:', e.message); }
  }
}

function start() {
  setInterval(tick, INTERVAL_MS);
}

module.exports = { start, tick, rememberToken, processExcelQueue, processAquadatQueue };
