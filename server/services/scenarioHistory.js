// ประวัติเกณฑ์แบบมีโครงสร้าง: ช่วงเวลา (scenario_periods) + เกณฑ์ต่อ rev (scenario_period_thresholds)
// - หน้า /config ยังเป็นที่แก้เกณฑ์ (ไฟล์ scenario_*.json + app_settings.json) — ที่นี่แค่ "จด" สิ่งที่มีผลลง DB
// - ทุกครั้งที่เปลี่ยนสถานการณ์ / แก้เกณฑ์ / เปิด-ปิดโรคระบาด → syncNow() ปิดช่วงเดิมแล้วเปิดช่วงใหม่
// - rev ของเกณฑ์เพิ่มเมื่อค่าในไฟล์ต่างจาก rev ล่าสุด (ไม่แก้ทับ rev เดิม) → ค่าแลปย้อนหลังใช้เกณฑ์ ณ เวลานั้นได้เสมอ
const fs = require('fs');
const path = require('path');
const { getDb, persist, nowTH } = require('./db');

const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');
const EPIDEMIC_ID = 0;                                  // scenario_id ของชุดเกณฑ์โหมดโรคระบาด
const EPOCH = '2000-01-01T00:00:00.000+07:00';          // จุดเริ่มของช่วงที่ย้ายมาจาก scenario_log

// lazy require: scenario.js ก็เรียกไฟล์นี้ (streaksBefore)
const sc = () => require('./scenario');

const norm = list => (Array.isArray(list) ? list : [])
  .filter(t => t && t.param_key)
  .map(t => ({ param_key: String(t.param_key), min: t.min ?? null, max: t.max ?? null }))
  .sort((a, b) => a.param_key.localeCompare(b.param_key));
const fingerprint = list => JSON.stringify(norm(list).map(t => [t.param_key, t.min, t.max]));

function readScenarioFile(file) {
  try { return norm(JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, file), 'utf8')).thresholds); }
  catch { return []; }
}

function revRows(db, sid, rev) {
  return db.all('SELECT param_key, lcl AS min, ucl AS max FROM scenario_period_thresholds WHERE scenario_id = ? AND rev = ? ORDER BY param_key', [sid, rev]);
}

function latestRev(db, sid) {
  const a = db.get('SELECT MAX(rev) AS r FROM scenario_period_thresholds WHERE scenario_id = ?', [sid])?.r || 0;
  const b = sid === EPIDEMIC_ID
    ? db.get('SELECT MAX(epidemic_rev) AS r FROM scenario_periods', [])?.r || 0
    : db.get('SELECT MAX(rev) AS r FROM scenario_periods WHERE scenario_id = ?', [sid])?.r || 0;
  return Math.max(a, b);
}

// คืน rev ที่ตรงกับ list (สร้าง rev ใหม่ถ้าค่าต่างจาก rev ล่าสุด)
function ensureRev(db, sid, list, actor, now) {
  const latest = latestRev(db, sid);
  if (latest > 0 && fingerprint(revRows(db, sid, latest)) === fingerprint(list)) return latest;
  if (latest === 0 && list.length === 0) return 0;
  const rev = latest + 1;
  for (const t of norm(list)) {
    db.run('INSERT INTO scenario_period_thresholds (scenario_id, rev, param_key, lcl, ucl, created_at, actor) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sid, rev, t.param_key, t.min, t.max, now, actor]);
  }
  return rev;
}

// สถานะเกณฑ์ปัจจุบันจากไฟล์ config (สร้าง rev ที่ขาด)
function currentState(db, actor, now) {
  const settings = sc().readAppSettings();
  const revOf = {};
  for (const s of db.all('SELECT id, threshold_file FROM scenarios', [])) {
    revOf[s.id] = ensureRev(db, s.id, readScenarioFile(s.threshold_file), actor, now);
  }
  const epiRev = ensureRev(db, EPIDEMIC_ID, norm(sc().epidemicThresholds(settings)), actor, now);
  const active = db.get('SELECT id FROM scenarios WHERE active = 1 LIMIT 1', []);
  if (!active) return null;
  const epidemic = settings.epidemic ? 1 : 0;
  return { scenario_id: active.id, rev: revOf[active.id], epidemic, epidemic_rev: epidemic ? epiRev : null };
}

const openPeriod = db => db.get('SELECT * FROM scenario_periods WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1', []);
const sameState = (p, s) => p && p.scenario_id === s.scenario_id && p.rev === s.rev
  && !!p.epidemic === !!s.epidemic && (p.epidemic_rev ?? null) === (s.epidemic_rev ?? null);

// ให้ช่วงปัจจุบันใน DB ตรงกับ config — เรียกหลังทุกการเปลี่ยน (และเป็นระยะ เผื่อมีคนแก้ไฟล์ตรง)
// คืน { period, changed }
function syncNow({ actor = 'system', note = null, isTest = false } = {}) {
  const db = getDb();
  const now = nowTH();
  const state = currentState(db, actor, now);
  if (!state) return { period: null, changed: false };
  const open = openPeriod(db);
  if (sameState(open, state)) { persist(); return { period: open, changed: false }; }
  const reason = !open ? 'init'
    : open.scenario_id !== state.scenario_id ? 'scenario'
    : open.rev !== state.rev ? 'thresholds'
    : !!open.epidemic !== !!state.epidemic ? 'epidemic'
    : 'epidemic_thresholds';
  db.run('UPDATE scenario_periods SET ended_at = ? WHERE ended_at IS NULL', [now]);
  db.run(`INSERT INTO scenario_periods (scenario_id, rev, epidemic, epidemic_rev, started_at, reason, actor, note, is_test, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live')`,
    [state.scenario_id, state.rev, state.epidemic, state.epidemic_rev, now, reason, actor, note, isTest ? 1 : 0]);
  const period = db.get('SELECT * FROM scenario_periods WHERE id = last_insert_rowid()', []);
  persist();
  console.log(`[scenario-history] period #${period.id} ${reason} scenario=${state.scenario_id} rev=${state.rev} epidemic=${state.epidemic}${state.epidemic ? ` (rev ${state.epidemic_rev})` : ''} by ${actor}`);
  return { period, changed: true };
}

function setSyncResult(periodId, result) {
  if (!periodId) return;
  getDb().run('UPDATE scenario_periods SET sync_result = ? WHERE id = ?', [result, periodId]);
  persist();
}

// ครั้งแรก: ย้ายประวัติจาก scenario_log (ไม่มีค่าเกณฑ์เดิม → ใช้ rev จากไฟล์ปัจจุบัน, source = 'migrated')
function initScenarioHistory() {
  const db = getDb();
  if (!db.get('SELECT COUNT(*) AS n FROM scenario_periods', []).n) {
    const now = nowTH();
    currentState(db, 'migration', now);   // rev 1 ของทุกสถานการณ์
    const revOf = id => latestRev(db, id);
    const logs = db.all('SELECT * FROM scenario_log ORDER BY at, id', []);
    const rows = [];
    if (logs.length) {
      if (logs[0].from_id) rows.push({ scenario_id: logs[0].from_id, started_at: EPOCH, reason: 'init' });
      for (const l of logs) rows.push({ scenario_id: l.to_id, started_at: l.at, reason: 'scenario', actor: l.actor, note: l.note, is_test: l.is_test, sync_result: l.sync_result });
    } else {
      const active = db.get('SELECT id FROM scenarios WHERE active = 1 LIMIT 1', []);
      if (active) rows.push({ scenario_id: active.id, started_at: EPOCH, reason: 'init' });
    }
    rows.forEach((r, i) => {
      db.run(`INSERT INTO scenario_periods (scenario_id, rev, epidemic, epidemic_rev, started_at, ended_at, reason, actor, note, is_test, sync_result, source)
              VALUES (?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, 'migrated')`,
        [r.scenario_id, revOf(r.scenario_id), r.started_at, rows[i + 1]?.started_at ?? null, r.reason,
          r.actor ?? 'migration', r.note ?? null, r.is_test ? 1 : 0, r.sync_result ?? null]);
    });
    persist();
    console.log(`[scenario-history] migrated ${rows.length} period(s) from scenario_log`);
  }
  syncNow({ actor: 'system' });   // จับการแก้ไฟล์เกณฑ์ตรง ๆ ระหว่าง server ปิด
}

// เผื่อมีคนแก้ไฟล์ scenario_*.json ตรง ๆ (config hot-reload) — ตรวจไม่เกินทุก 30 วิ
let _lastSync = 0;
function maybeSync() {
  if (Date.now() - _lastSync < 30000) return;
  _lastSync = Date.now();
  try { syncNow({ actor: 'system' }); } catch (e) { console.error('[scenario-history] sync', e.message); }
}

// ── อ่านเกณฑ์ ณ เวลา ─────────────────────────────────────────────────────────
// เวลาของรอบ: 'HH:MM' = เวลานั้นของวัน · daily/weekly = สิ้นวัน
function slotTs(date, slot) {
  return /^\d{2}:\d{2}$/.test(String(slot)) ? `${date}T${slot}:00.000+07:00` : `${date}T23:59:59.999+07:00`;
}

function periodAt(ts) {
  const db = getDb();
  return db.get('SELECT * FROM scenario_periods WHERE started_at <= ? ORDER BY started_at DESC, id DESC LIMIT 1', [ts])
    || db.get('SELECT * FROM scenario_periods ORDER BY started_at ASC, id ASC LIMIT 1', []);
}

const _thrCache = new Map();   // period id → thresholds (ช่วงหนึ่งอ้าง rev ที่ไม่เปลี่ยน → cache ได้ตลอด)
function periodThresholds(p) {
  if (!p) return [];
  if (_thrCache.has(p.id)) return _thrCache.get(p.id);
  const db = getDb();
  let list = revRows(db, p.scenario_id, p.rev);
  if (p.epidemic && p.epidemic_rev) list = sc().applyEpidemic(list, revRows(db, EPIDEMIC_ID, p.epidemic_rev));
  _thrCache.set(p.id, list);
  return list;
}

function scenarioName(id) {
  return id === EPIDEMIC_ID ? 'โหมดโรคระบาด' : getDb().get('SELECT name FROM scenarios WHERE id = ?', [id])?.name ?? `#${id}`;
}

// { period, scenario: { id, name }, rev, epidemic, estimated, thresholds }
function thresholdsAt(date, slot) {
  maybeSync();
  const p = periodAt(slotTs(date, slot));
  if (!p) return null;
  return {
    period_id: p.id, scenario: { id: p.scenario_id, name: scenarioName(p.scenario_id) }, rev: p.rev,
    epidemic: !!p.epidemic, estimated: p.source === 'migrated', thresholds: periodThresholds(p),
  };
}

// resolver ที่ cache ต่อรอบ: (date, slot) → { param_key: threshold }
function makeResolver() {
  const memo = new Map();
  return (date, slot) => {
    const p = periodAt(slotTs(date, slot));
    if (!p) return {};
    if (!memo.has(p.id)) memo.set(p.id, Object.fromEntries(periodThresholds(p).map(t => [t.param_key, t])));
    return memo.get(p.id);
  };
}

// ช่วงที่เริ่มในวันนั้น (เรียงตามเวลา) + ชื่อสถานการณ์ก่อนหน้า — ใช้เขียนหมายเหตุ
function periodsOnDate(date) {
  const db = getDb();
  return db.all('SELECT * FROM scenario_periods WHERE started_at >= ? AND started_at <= ? ORDER BY started_at, id',
    [`${date}T00:00:00.000+07:00`, `${date}T23:59:59.999+07:00`]).map(p => {
    const prev = db.get('SELECT * FROM scenario_periods WHERE started_at < ? OR (started_at = ? AND id < ?) ORDER BY started_at DESC, id DESC LIMIT 1',
      [p.started_at, p.started_at, p.id]);
    return { ...p, name: scenarioName(p.scenario_id), prev_name: prev ? scenarioName(prev.scenario_id) : null };
  });
}

// ประวัติ (ล่าสุดก่อน) — รูปแบบเดิมของ /api/scenarios/log + reason/rev/epidemic
function listPeriods({ limit = 20, testOnly = false } = {}) {
  const db = getDb();
  const rows = db.all(`SELECT * FROM scenario_periods ${testOnly ? 'WHERE is_test = 1' : ''} ORDER BY started_at DESC, id DESC LIMIT ?`, [limit]);
  return rows.map(p => {
    const prev = db.get('SELECT scenario_id FROM scenario_periods WHERE started_at < ? OR (started_at = ? AND id < ?) ORDER BY started_at DESC, id DESC LIMIT 1',
      [p.started_at, p.started_at, p.id]);
    return {
      ...p, at: p.started_at, to_id: p.scenario_id, to_name: scenarioName(p.scenario_id),
      from_id: prev?.scenario_id ?? null, from_name: prev ? scenarioName(prev.scenario_id) : null,
      epidemic: !!p.epidemic, is_test: !!p.is_test, estimated: p.source === 'migrated',
    };
  });
}

module.exports = {
  EPIDEMIC_ID, initScenarioHistory, syncNow, setSyncResult,
  slotTs, thresholdsAt, makeResolver, periodsOnDate, listPeriods,
};
