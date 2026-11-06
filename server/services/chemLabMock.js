// Chem-lab MOCK backend — reference implementation of the Uroboros /api/chemlab/* contract.
// Dev only (services.json chem_lab.mock = true). Uses Node's built-in node:sqlite because
// chem.db is WAL-mode and node-sqlite3-wasm cannot read WAL databases.
//   chem.db  → opened READ-ONLY (source: WDATA + SIDECAR_*), never written
//   lab db   → LAB_* tables (stand-in for Uroboros chemlab.db)
// Spec: handoff/chem_lab_backend_spec.md
//
// Workflow (re-design 27/10): receiving and mixing are separate steps.
//   bottle (received) ──< LAB_COMPOSITE_BOTTLE >── composite (many per day×chemical×company, bottles may overlap)
//   composite → attempts (in-house, or external lab via LAB_EXT_SEND) → final (per composite, changeable, tagged
//   with who chose it) → fail: case over the trips the user picked → สคบ-14 (user picks the composites)
const path = require('path');

let DatabaseSync;
let chemDb = null;
let labDb = null;
let chemDbPath = null;

const PRODUCT_CHEM = { '01': 'ALUM', '03': 'PACL' };
const CHEM_PRODUCT = { ALUM: '01', PACL: '03' };

const compositeDdl = (name) => `
CREATE TABLE IF NOT EXISTS ${name} (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_date      TEXT NOT NULL,
  chemical         TEXT NOT NULL,
  company          TEXT NOT NULL,
  seq              INTEGER NOT NULL DEFAULT 1,
  n_bottles        INTEGER NOT NULL DEFAULT 0,
  note             TEXT,
  test_source      TEXT,
  final_attempt_id INTEGER,
  verdict          TEXT NOT NULL DEFAULT 'pending',
  memo_id          INTEGER,
  finalized_by TEXT, finalized_at TEXT,
  created_by TEXT, created_at TEXT,
  updated_by TEXT, updated_at TEXT,
  deleted_by TEXT, deleted_at TEXT, delete_reason TEXT
);`;
const COMPOSITE_COLS = ['id', 'sample_date', 'chemical', 'company', 'seq', 'n_bottles', 'note', 'test_source', 'final_attempt_id',
  'verdict', 'memo_id', 'finalized_by', 'finalized_at', 'created_by', 'created_at', 'updated_by', 'updated_at',
  'deleted_by', 'deleted_at', 'delete_reason'];

const LAB_DDL = `
CREATE TABLE IF NOT EXISTS LAB_BOTTLE (
  ticket1      TEXT PRIMARY KEY,
  dayin        TEXT NOT NULL,
  chemical     TEXT NOT NULL,
  company      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('received','not_received')),
  remark       TEXT,
  composite_id INTEGER,              -- legacy (before 27/10); membership now lives in LAB_COMPOSITE_BOTTLE
  received_by  TEXT, received_at TEXT,
  updated_by   TEXT, updated_at  TEXT
);
${compositeDdl('LAB_COMPOSITE')}
CREATE TABLE IF NOT EXISTS LAB_COMPOSITE_BOTTLE (
  composite_id INTEGER NOT NULL,
  ticket1      TEXT NOT NULL,
  PRIMARY KEY (composite_id, ticket1)
);
CREATE TABLE IF NOT EXISTS LAB_ATTEMPT (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  composite_id       INTEGER NOT NULL,
  attempt_no         INTEGER NOT NULL,
  test_source        TEXT NOT NULL,
  ext_lab            TEXT,
  ext_report_no      TEXT,
  attachment_ref     TEXT,
  temp_c_rd          REAL,
  values_json        TEXT NOT NULL,
  param_verdict_json TEXT NOT NULL,
  verdict            TEXT NOT NULL,
  key_param          TEXT, key_value REAL, key_min REAL,
  remark             TEXT,
  tested_by TEXT, tested_at TEXT
);
CREATE TABLE IF NOT EXISTS LAB_EXT_SEND (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  composite_id  INTEGER NOT NULL,
  lab_name      TEXT NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'sent',   -- sent | resulted | cancelled
  sent_by TEXT, sent_at TEXT,
  attempt_id    INTEGER,
  resulted_by TEXT, resulted_at TEXT,
  cancelled_by TEXT, cancelled_at TEXT, cancel_reason TEXT
);
CREATE TABLE IF NOT EXISTS LAB_MEMO (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no      TEXT NOT NULL UNIQUE,
  doc_date    TEXT,
  chemical    TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to   TEXT NOT NULL,
  n_samples   INTEGER NOT NULL,
  m_analyzed  INTEGER NOT NULL,
  addressee   TEXT,
  spec_ref    TEXT,
  conclusion  TEXT,
  created_by TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS LAB_CASE (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  composite_id    INTEGER NOT NULL,
  chemical        TEXT NOT NULL,
  company         TEXT NOT NULL,
  suggested_kg    REAL NOT NULL,
  target_kg       REAL NOT NULL,
  override_reason TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  car_key         TEXT,
  opened_by TEXT, opened_at TEXT,
  closed_at       TEXT,
  cancel_reason   TEXT
);
CREATE TABLE IF NOT EXISTS LAB_CASE_TICKET (
  case_id INTEGER NOT NULL,
  ticket1 TEXT NOT NULL,
  net_kg  REAL,
  PRIMARY KEY (case_id, ticket1)
);
CREATE TABLE IF NOT EXISTS LAB_CASE_TASK (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id  INTEGER NOT NULL,
  seq      INTEGER NOT NULL,
  title    TEXT NOT NULL,
  source   TEXT NOT NULL,
  auto_key TEXT,
  done_by TEXT, done_at TEXT,
  remark   TEXT
);
CREATE TABLE IF NOT EXISTS LAB_OFFSET (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id   INTEGER NOT NULL,
  ticket1   TEXT NOT NULL,
  offset_kg REAL NOT NULL,
  net_kg    REAL,
  remark    TEXT,
  by_user TEXT, at TEXT
);
CREATE TABLE IF NOT EXISTS LAB_AUDIT (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  user        TEXT,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  reason      TEXT
);
`;
// after migrate() (LAB_COMPOSITE may be rebuilt there)
const LAB_INDEX = `
CREATE INDEX IF NOT EXISTS IX_LAB_COMPOSITE_DAY ON LAB_COMPOSITE(sample_date, chemical, company);
CREATE INDEX IF NOT EXISTS IX_LAB_COMP_BOTTLE_TICKET ON LAB_COMPOSITE_BOTTLE(ticket1);
CREATE INDEX IF NOT EXISTS IX_LAB_EXT_SEND_COMP ON LAB_EXT_SEND(composite_id);
`;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };
const conflict = (msg) => { throw new HttpError(409, msg); };
const notFound = (msg = 'Not found') => { throw new HttpError(404, msg); };

function init(cfg, serverDir) {
  if (!DatabaseSync) ({ DatabaseSync } = require('node:sqlite'));
  if (chemDbPath !== cfg.mock_chem_db) {
    if (chemDb) chemDb.close();
    chemDb = new DatabaseSync(cfg.mock_chem_db, { readOnly: true });
    chemDbPath = cfg.mock_chem_db;
  }
  if (!labDb) {
    labDb = new DatabaseSync(path.resolve(serverDir, cfg.mock_lab_db || 'chemlab_mock.db'));
    labDb.exec(LAB_DDL);
    migrate();
    labDb.exec(LAB_INDEX);
  }
}

// Columns added after the first release (edit/delete attempt, void offset/memo, case scope)
const MIGRATIONS = {
  LAB_ATTEMPT: [['updated_by', 'TEXT'], ['updated_at', 'TEXT'], ['deleted_by', 'TEXT'], ['deleted_at', 'TEXT'], ['delete_reason', 'TEXT']],
  LAB_OFFSET:  [['voided_by', 'TEXT'], ['voided_at', 'TEXT'], ['void_reason', 'TEXT']],
  LAB_MEMO:    [['status', "TEXT NOT NULL DEFAULT 'active'"], ['voided_by', 'TEXT'], ['voided_at', 'TEXT'], ['void_reason', 'TEXT']],
  LAB_CASE:    [['scope', 'TEXT']],
};
function migrate() {
  migrateCompositeTable();
  for (const [table, cols] of Object.entries(MIGRATIONS)) {
    const have = new Set(all(labDb, `PRAGMA table_info(${table})`).map(r => r.name));
    for (const [name, def] of cols) if (!have.has(name)) labDb.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}
// One-time (27/10): LAB_COMPOSITE had UNIQUE(sample_date, chemical, company) and bottles pointed at their single
// composite (LAB_BOTTLE.composite_id). Rebuild the table without the constraint (ids kept), move membership into
// LAB_COMPOSITE_BOTTLE, and tag existing finals with who chose them (from the audit log).
function migrateCompositeTable() {
  const sql = one(labDb, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'LAB_COMPOSITE'`)?.sql || '';
  if (!/UNIQUE/i.test(sql)) return;
  const old = new Set(all(labDb, 'PRAGMA table_info(LAB_COMPOSITE)').map(r => r.name));
  const cols = COMPOSITE_COLS.filter(c => old.has(c)).join(', ');
  tx(() => {
    labDb.exec(compositeDdl('LAB_COMPOSITE_NEW'));
    labDb.exec(`INSERT INTO LAB_COMPOSITE_NEW (${cols}) SELECT ${cols} FROM LAB_COMPOSITE`);
    labDb.exec('DROP TABLE LAB_COMPOSITE');
    labDb.exec('ALTER TABLE LAB_COMPOSITE_NEW RENAME TO LAB_COMPOSITE');
    labDb.exec(`INSERT OR IGNORE INTO LAB_COMPOSITE_BOTTLE (composite_id, ticket1)
                SELECT composite_id, ticket1 FROM LAB_BOTTLE WHERE composite_id IS NOT NULL`);
    labDb.exec('UPDATE LAB_BOTTLE SET composite_id = NULL WHERE composite_id IS NOT NULL');
    labDb.exec(`UPDATE LAB_COMPOSITE SET
                  finalized_by = (SELECT user FROM LAB_AUDIT WHERE entity = 'composite' AND entity_id = CAST(LAB_COMPOSITE.id AS TEXT) AND action = 'final' ORDER BY id DESC LIMIT 1),
                  finalized_at = (SELECT ts   FROM LAB_AUDIT WHERE entity = 'composite' AND entity_id = CAST(LAB_COMPOSITE.id AS TEXT) AND action = 'final' ORDER BY id DESC LIMIT 1)
                WHERE final_attempt_id IS NOT NULL`);
  });
}

// ── small helpers ───────────────────────────────────────────────────────────
const plain = (r) => (r ? { ...r } : null);
const all = (db, sql, ...p) => db.prepare(sql).all(...p).map(plain);
const one = (db, sql, ...p) => plain(db.prepare(sql).get(...p));
const run = (db, sql, ...p) => db.prepare(sql).run(...p);
const round1 = (n) => Math.round(n * 10) / 10;
const qs = (n) => Array(n).fill('?').join(',');

function audit(ctx, entity, entityId, action, before, after, reason) {
  run(labDb,
    `INSERT INTO LAB_AUDIT (ts,user,entity,entity_id,action,before_json,after_json,reason) VALUES (?,?,?,?,?,?,?,?)`,
    ctx.ts, ctx.actor?.name || null, entity, String(entityId), action,
    before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason || null);
}

function tx(fn) {
  labDb.exec('BEGIN');
  try { const r = fn(); labDb.exec('COMMIT'); return r; }
  catch (e) { labDb.exec('ROLLBACK'); throw e; }
}

// ── chem.db readers (read-only) ────────────────────────────────────────────
let companyCache = null;
function companyName(code) {
  if (!companyCache) {
    companyCache = {};
    for (const r of all(chemDb, 'SELECT CODE, NAME FROM COMPANY')) companyCache[r.CODE] = r.NAME;
  }
  return companyCache[code] || code;
}

function wdataRow(r) {
  return {
    ticket1: r.TICKET1, ticket2: r.TICKET2, plate: r.TRUCK,
    product: r.PRODUCT, chemical: PRODUCT_CHEM[r.PRODUCT], company: r.COMPANY,
    company_name: companyName(r.COMPANY),
    dayin: r.DAYIN, tmin: r.TMIN, dayout: r.DAYOUT, tmout: r.TMOUT,
    w1: r.W1, w2: r.W2, net_kg: (r.W1 != null && r.W2 != null) ? Math.abs(r.W1 - r.W2) : null,
  };
}

const WDATA_SEL = `SELECT TICKET1, TICKET2, TRUCK, PRODUCT, COMPANY, DAYIN, TMIN, DAYOUT, TMOUT, W1, W2
                   FROM WDATA WHERE STAT = '2' AND PRODUCT IN ('01','03')`;

function wdataByDate(date) {
  return all(chemDb, `${WDATA_SEL} AND DAYIN = ? ORDER BY TICKET1`, date).map(wdataRow);
}
function wdataByTicket(ticket1) {
  const r = one(chemDb, `${WDATA_SEL} AND TICKET1 = ?`, ticket1);
  return r ? wdataRow(r) : null;
}
function wdataByTickets(tickets) {
  if (!tickets.length) return {};
  const rows = all(chemDb, `${WDATA_SEL} AND TICKET1 IN (${qs(tickets.length)})`, ...tickets);
  return Object.fromEntries(rows.map(r => [r.TICKET1, wdataRow(r)]));
}
// trips of one sample group (day × chemical × company)
function wdataOfGroup(date, chemical, company) {
  return all(chemDb, `${WDATA_SEL} AND DAYIN = ? AND PRODUCT = ? AND COMPANY = ? ORDER BY TICKET1`, date, CHEM_PRODUCT[chemical], company).map(wdataRow);
}

function sidecarByTickets(tickets) {
  if (!tickets.length) return {};
  let unloads;
  try {
    unloads = all(chemDb, `SELECT * FROM SIDECAR_UNLOAD WHERE TICKET1 IN (${qs(tickets.length)})`, ...tickets);
  } catch { return {}; } // older chem.db without SIDECAR tables
  const out = {};
  for (const u of unloads) {
    const fills = all(chemDb, 'SELECT TANK, LEVEL_BEFORE, LEVEL_AFTER, AFTER_AT FROM SIDECAR_FILL WHERE UNLOAD_ID = ? ORDER BY SEQ', u.ID)
      .map(f => ({ tank: f.TANK, before: f.LEVEL_BEFORE, after: f.LEVEL_AFTER, after_at: f.AFTER_AT }));
    out[u.TICKET1] = {
      id: u.ID, sg: u.SG, temp_c: u.TEMP_C, bill_book: u.BILL_BOOK, bill_no: u.BILL_NO,
      is_complete: !!u.IS_COMPLETE, created_by: u.CREATED_BY, updated_at: u.UPDATED_AT, fills,
    };
  }
  return out;
}

// ── lab.db helpers ─────────────────────────────────────────────────────────
const LIVE_ATTEMPT = 'deleted_at IS NULL';
const LIVE_OFFSET = 'voided_at IS NULL';
const LIVE_COMP = 'deleted_at IS NULL';
const TEST_SOURCES = ['inhouse', 'external_lab', 'supplier_coa'];   // supplier_coa: old rows only (no new ones)

function attemptCount(compositeId) {
  return one(labDb, `SELECT COUNT(*) n FROM LAB_ATTEMPT WHERE composite_id = ? AND ${LIVE_ATTEMPT}`, compositeId).n;
}
function nextAttemptNo(compositeId) {
  return one(labDb, 'SELECT COALESCE(MAX(attempt_no),0)+1 n FROM LAB_ATTEMPT WHERE composite_id = ?', compositeId).n;
}
function liveAttempts(compositeId) {
  return all(labDb, `SELECT * FROM LAB_ATTEMPT WHERE composite_id = ? AND ${LIVE_ATTEMPT} ORDER BY attempt_no`, compositeId).map(parseAttempt);
}
function compositeTickets(compositeId) {
  return all(labDb, 'SELECT ticket1 FROM LAB_COMPOSITE_BOTTLE WHERE composite_id = ? ORDER BY ticket1', compositeId).map(r => r.ticket1);
}
// live composites that contain the bottle
function compositesOfTicket(ticket1) {
  return all(labDb, `SELECT c.* FROM LAB_COMPOSITE c JOIN LAB_COMPOSITE_BOTTLE cb ON cb.composite_id = c.id
                     WHERE cb.ticket1 = ? AND c.${LIVE_COMP} ORDER BY c.seq`, ticket1);
}
function liveComposite(id) {
  const c = one(labDb, `SELECT * FROM LAB_COMPOSITE WHERE id = ? AND ${LIVE_COMP}`, id);
  if (!c) notFound('ไม่พบขวดผสม');
  return c;
}
// received bottles of a group that are in no live composite yet
function unmixedReceived(date, chemical, company) {
  return one(labDb, `SELECT COUNT(*) n FROM LAB_BOTTLE b WHERE b.dayin = ? AND b.chemical = ? AND b.company = ? AND b.status = 'received'
                     AND NOT EXISTS (SELECT 1 FROM LAB_COMPOSITE_BOTTLE cb JOIN LAB_COMPOSITE c ON c.id = cb.composite_id
                                     WHERE cb.ticket1 = b.ticket1 AND c.${LIVE_COMP})`, date, chemical, company).n;
}
const compositeLocked = (c) => !!c?.final_attempt_id;
function activeCase(compositeId) {
  return one(labDb, `SELECT * FROM LAB_CASE WHERE composite_id = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 1`, compositeId);
}
function recountComposite(compositeId) {
  const n = one(labDb, `SELECT COUNT(*) n FROM LAB_COMPOSITE_BOTTLE cb JOIN LAB_BOTTLE b ON b.ticket1 = cb.ticket1
                        WHERE cb.composite_id = ? AND b.status = 'received'`, compositeId).n;
  run(labDb, 'UPDATE LAB_COMPOSITE SET n_bottles = ? WHERE id = ?', n, compositeId);
}
function parseAttempt(a) {
  if (!a) return a;
  return { ...a, values: JSON.parse(a.values_json), param_verdicts: JSON.parse(a.param_verdict_json), values_json: undefined, param_verdict_json: undefined };
}
function offsetSum(caseId) {
  return one(labDb, `SELECT COALESCE(SUM(offset_kg),0) s FROM LAB_OFFSET WHERE case_id = ? AND ${LIVE_OFFSET}`, caseId).s;
}
function ticketOffsetSum(ticket1) {
  return one(labDb, `SELECT COALESCE(SUM(offset_kg),0) s FROM LAB_OFFSET WHERE ticket1 = ? AND ${LIVE_OFFSET}`, ticket1).s;
}
function memoDocNo(memoId) {
  return memoId ? one(labDb, 'SELECT doc_no FROM LAB_MEMO WHERE id = ?', memoId)?.doc_no ?? null : null;
}
function extPending(compositeId) {
  return one(labDb, `SELECT COUNT(*) n FROM LAB_EXT_SEND WHERE composite_id = ? AND status = 'sent'`, compositeId).n;
}

// Compact composite for lists / boards
function compositeSummary(c) {
  const ac = activeCase(c.id);
  return {
    id: c.id, sample_date: c.sample_date, chemical: c.chemical, company: c.company, company_name: companyName(c.company),
    seq: c.seq, n_bottles: c.n_bottles, note: c.note, tickets: compositeTickets(c.id),
    attempts: attemptCount(c.id), ext_pending: extPending(c.id),
    final_attempt_id: c.final_attempt_id, verdict: c.verdict, finalized_by: c.finalized_by, finalized_at: c.finalized_at,
    memo_id: c.memo_id, memo_doc_no: memoDocNo(c.memo_id),
    created_by: c.created_by, created_at: c.created_at, updated_by: c.updated_by, updated_at: c.updated_at,
    case: ac ? { id: ac.id, status: ac.status, target_kg: ac.target_kg, remaining_kg: round1(ac.target_kg - offsetSum(ac.id)) } : null,
  };
}

// Sync the auto task (offset_complete) with remaining kg, then close the case if every task is done
function syncCaseState(ctx, caseId) {
  const c = one(labDb, 'SELECT * FROM LAB_CASE WHERE id = ?', caseId);
  if (!c || c.status !== 'open') return;
  const remaining = c.target_kg - offsetSum(caseId);
  const auto = one(labDb, `SELECT * FROM LAB_CASE_TASK WHERE case_id = ? AND auto_key = 'offset_complete'`, caseId);
  if (auto) {
    if (remaining <= 0 && !auto.done_at) {
      run(labDb, 'UPDATE LAB_CASE_TASK SET done_by = ?, done_at = ? WHERE id = ?', 'system', ctx.ts, auto.id);
    } else if (remaining > 0 && auto.done_at) {
      run(labDb, 'UPDATE LAB_CASE_TASK SET done_by = NULL, done_at = NULL WHERE id = ?', auto.id);
    }
  }
  const pending = one(labDb, 'SELECT COUNT(*) n FROM LAB_CASE_TASK WHERE case_id = ? AND done_at IS NULL', caseId).n;
  if (pending === 0) {
    run(labDb, `UPDATE LAB_CASE SET status = 'closed', closed_at = ? WHERE id = ?`, ctx.ts, caseId);
    audit(ctx, 'case', caseId, 'close', null, { status: 'closed' });
  }
}

function caseSummary(c) {
  const offset = offsetSum(c.id);
  const t = one(labDb, 'SELECT COUNT(*) total, SUM(done_at IS NOT NULL) done FROM LAB_CASE_TASK WHERE case_id = ?', c.id);
  const comp = one(labDb, 'SELECT sample_date, seq FROM LAB_COMPOSITE WHERE id = ?', c.composite_id);
  const n = one(labDb, 'SELECT COUNT(*) n, COALESCE(SUM(net_kg),0) kg FROM LAB_CASE_TICKET WHERE case_id = ?', c.id);
  return {
    ...c, company_name: companyName(c.company), sample_date: comp?.sample_date, composite_seq: comp?.seq ?? null,
    offset_kg: offset, remaining_kg: round1(c.target_kg - offset),
    tasks_total: t.total, tasks_done: t.done || 0, n_tickets: n.n, tickets_net_kg: n.kg,
  };
}

// Reasons are optional (user decision 26/10): stored in LAB_AUDIT when given, never required
function optReason(ctx) {
  return String(ctx.body?.reason || '').trim() || null;
}

// ── bottles (receiving) ────────────────────────────────────────────────────
function getBottles(ctx) {
  const date = ctx.query.date;
  if (!date) bad('date is required');
  const trips = wdataByDate(date);
  const tickets = trips.map(t => t.ticket1);
  const sidecar = sidecarByTickets(tickets);
  const bottles = tickets.length
    ? Object.fromEntries(all(labDb, `SELECT * FROM LAB_BOTTLE WHERE ticket1 IN (${qs(tickets.length)})`, ...tickets).map(b => [b.ticket1, b]))
    : {};
  const comps = all(labDb, `SELECT * FROM LAB_COMPOSITE WHERE sample_date = ? AND ${LIVE_COMP} ORDER BY seq`, date).map(compositeSummary);

  const groups = {};
  for (const t of trips) {
    const key = `${t.chemical}|${t.company}`;
    if (!groups[key]) {
      groups[key] = {
        chemical: t.chemical, company: t.company, company_name: t.company_name,
        expected: 0, received: 0, not_received: 0, pending: 0, unmixed: 0,
        composites: comps.filter(c => c.chemical === t.chemical && c.company === t.company),
        rows: [],
      };
    }
    const g = groups[key];
    const b = bottles[t.ticket1] || null;
    const inComps = g.composites.filter(c => c.tickets.includes(t.ticket1));
    g.expected++;
    if (!b) g.pending++;
    else if (b.status === 'received') { g.received++; if (!inComps.length) g.unmixed++; }
    else g.not_received++;
    g.rows.push({
      ...t, sidecar: sidecar[t.ticket1] || null,
      bottle: b ? { ...b, composite_ids: inComps.map(c => c.id), composite_seqs: inComps.map(c => c.seq), locked: inComps.some(compositeLocked) } : null,
    });
  }
  return { date, groups: Object.values(groups) };
}

// Receiving only — mixing is a separate step. A bottle in a composite with a final result is locked; one that is
// mixed but not analysed yet is taken out of its composites when marked not received.
function putBottles(ctx) {
  const { items, reason } = ctx.body || {};
  if (!Array.isArray(items) || !items.length) bad('items must be a non-empty array');
  const trips = wdataByTickets(items.map(i => i.ticket1));
  return tx(() => {
    const saved = [];
    for (const it of items) {
      if (!['received', 'not_received'].includes(it.status)) bad(`status ไม่ถูกต้อง (${it.ticket1})`);
      const trip = trips[it.ticket1];
      if (!trip) bad(`ไม่พบ TICKET1 ${it.ticket1} ใน WDATA`);
      const before = one(labDb, 'SELECT * FROM LAB_BOTTLE WHERE ticket1 = ?', it.ticket1);
      const remark = it.remark || null;
      if (before && before.status === it.status && (before.remark || null) === remark) continue;
      const comps = compositesOfTicket(it.ticket1);
      const finalComp = comps.find(compositeLocked);
      if (finalComp) conflict(`ขวด ${it.ticket1} อยู่ในขวดผสมใบที่ ${finalComp.seq} ที่เลือกผล final แล้ว — ย้อนผล final ก่อนจึงแก้ได้`);
      const detach = it.status === 'not_received' ? comps : [];
      const analysed = detach.find(c => attemptCount(c.id) > 0);
      if (analysed) conflict(`ขวด ${it.ticket1} ถูกผสมในใบที่ ${analysed.seq} และมีผลวิเคราะห์แล้ว — ลบผลวิเคราะห์หรือลบใบผสมก่อน`);

      if (before) {
        run(labDb, `UPDATE LAB_BOTTLE SET status = ?, remark = ?, updated_by = ?, updated_at = ? WHERE ticket1 = ?`,
          it.status, remark, ctx.actor?.name, ctx.ts, it.ticket1);
      } else {
        run(labDb, `INSERT INTO LAB_BOTTLE (ticket1, dayin, chemical, company, status, remark, received_by, received_at, updated_by, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)`,
          it.ticket1, trip.dayin, trip.chemical, trip.company, it.status, remark,
          ctx.actor?.name, ctx.ts, ctx.actor?.name, ctx.ts);
      }
      for (const c of detach) {
        run(labDb, 'DELETE FROM LAB_COMPOSITE_BOTTLE WHERE composite_id = ? AND ticket1 = ?', c.id, it.ticket1);
        audit(ctx, 'composite', c.id, 'detach', { ticket1: it.ticket1 }, null, reason || 'ขวดไม่ได้รับ');
      }
      for (const c of comps) recountComposite(c.id);
      const after = one(labDb, 'SELECT * FROM LAB_BOTTLE WHERE ticket1 = ?', it.ticket1);
      audit(ctx, 'bottle', it.ticket1, before ? 'update' : 'create', before, after, reason);
      saved.push(after);
    }
    return { saved: saved.length };
  });
}

// ── composites (mixing) ────────────────────────────────────────────────────
function listComposites(ctx) {
  const { from, to, date, chemical, company, open } = ctx.query;
  let sql = `SELECT * FROM LAB_COMPOSITE WHERE ${LIVE_COMP}`;
  const p = [];
  if (date) { sql += ' AND sample_date = ?'; p.push(date); }
  if (from) { sql += ' AND sample_date >= ?'; p.push(from); }
  if (to) { sql += ' AND sample_date <= ?'; p.push(to); }
  if (chemical) { sql += ' AND chemical = ?'; p.push(chemical); }
  if (company) { sql += ' AND company = ?'; p.push(company); }
  if (open === '1') sql += ' AND final_attempt_id IS NULL';
  sql += ' ORDER BY sample_date DESC, chemical, company, seq';
  return { composites: all(labDb, sql, ...p).map(compositeSummary) };
}

function getComposite(ctx, id) {
  const c = one(labDb, 'SELECT * FROM LAB_COMPOSITE WHERE id = ?', id);
  if (!c) notFound('ไม่พบขวดผสม');
  const tickets = compositeTickets(id);
  const bottleRows = tickets.length
    ? Object.fromEntries(all(labDb, `SELECT * FROM LAB_BOTTLE WHERE ticket1 IN (${qs(tickets.length)})`, ...tickets).map(b => [b.ticket1, b]))
    : {};
  const trips = wdataByTickets(tickets);
  const ac = activeCase(id);
  return {
    composite: { ...compositeSummary(c), ...c, company_name: companyName(c.company), tickets, locked: compositeLocked(c),
      memo_doc_no: memoDocNo(c.memo_id), deleted: !!c.deleted_at },
    bottles: tickets.map(t => ({ ...(bottleRows[t] || { ticket1: t }), trip: trips[t] || null })),
    attempts: liveAttempts(id),
    ext_sends: all(labDb, 'SELECT * FROM LAB_EXT_SEND WHERE composite_id = ? ORDER BY id', id),
    case: ac ? caseSummary(ac) : null,
  };
}

// tickets must be received bottles of the composite's own group
function checkMixTickets(tickets, date, chemical, company) {
  if (!Array.isArray(tickets) || !tickets.length) bad('เลือกขวดอย่างน้อย 1 ขวด');
  const uniq = [...new Set(tickets.map(String))];
  const rows = all(labDb, `SELECT * FROM LAB_BOTTLE WHERE ticket1 IN (${qs(uniq.length)})`, ...uniq);
  const byT = Object.fromEntries(rows.map(r => [r.ticket1, r]));
  for (const t of uniq) {
    const b = byT[t];
    if (!b || b.status !== 'received') bad(`ขวด ${t} ยังไม่ได้บันทึกรับ`);
    if (b.dayin !== date || b.chemical !== chemical || b.company !== company) bad(`ขวด ${t} ไม่ได้อยู่ในตัวอย่างวัน/สาร/บริษัทเดียวกัน`);
  }
  return uniq.sort();
}

function createComposite(ctx) {
  const { date, chemical, company, tickets, note } = ctx.body || {};
  if (!date || !chemical || !company) bad('date, chemical, company are required');
  const list = checkMixTickets(tickets, date, chemical, company);
  return tx(() => {
    const seq = one(labDb, 'SELECT COALESCE(MAX(seq),0)+1 n FROM LAB_COMPOSITE WHERE sample_date = ? AND chemical = ? AND company = ?', date, chemical, company).n;
    const r = run(labDb, `INSERT INTO LAB_COMPOSITE (sample_date, chemical, company, seq, n_bottles, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      date, chemical, company, seq, list.length, note || null, ctx.actor?.name, ctx.ts);
    const id = Number(r.lastInsertRowid);
    for (const t of list) run(labDb, 'INSERT INTO LAB_COMPOSITE_BOTTLE (composite_id, ticket1) VALUES (?,?)', id, t);
    audit(ctx, 'composite', id, 'create', null, { date, chemical, company, seq, tickets: list, note: note || null });
    return getComposite(ctx, id);
  });
}

// Edit the bottle list / note. Bottles can change only while the composite has no analysis result.
function updateComposite(ctx, id) {
  const c = liveComposite(id);
  if (c.memo_id) conflict('ขวดผสมนี้ออก สคบ-14 แล้ว — ยกเลิก สคบ-14 ก่อน');
  if (compositeLocked(c)) conflict('เลือกผล final แล้ว — ย้อนผล final ก่อนจึงแก้ใบผสมได้');
  const reason = optReason(ctx);
  const b = ctx.body || {};
  const before = { tickets: compositeTickets(id), note: c.note };
  let tickets = before.tickets;
  if (b.tickets !== undefined) {
    tickets = checkMixTickets(b.tickets, c.sample_date, c.chemical, c.company);
    if (tickets.join() !== before.tickets.join() && attemptCount(id) > 0) {
      conflict('ใบผสมนี้มีผลวิเคราะห์แล้ว — เปลี่ยนขวดไม่ได้ (สร้างใบผสมใหม่ หรือลบผลวิเคราะห์ก่อน)');
    }
  }
  const note = b.note !== undefined ? (b.note || null) : c.note;
  return tx(() => {
    run(labDb, 'DELETE FROM LAB_COMPOSITE_BOTTLE WHERE composite_id = ?', id);
    for (const t of tickets) run(labDb, 'INSERT INTO LAB_COMPOSITE_BOTTLE (composite_id, ticket1) VALUES (?,?)', id, t);
    run(labDb, 'UPDATE LAB_COMPOSITE SET note = ?, updated_by = ?, updated_at = ? WHERE id = ?', note, ctx.actor?.name, ctx.ts, id);
    recountComposite(id);
    audit(ctx, 'composite', id, 'update', before, { tickets, note }, reason);
    return getComposite(ctx, id);
  });
}

function deleteComposite(ctx, id) {
  const c = liveComposite(id);
  if (c.memo_id) conflict('ขวดผสมนี้ออก สคบ-14 แล้ว — ยกเลิก สคบ-14 ก่อน');
  if (compositeLocked(c)) conflict('เลือกผล final แล้ว — ย้อนผล final ก่อนจึงลบใบผสมได้');
  const reason = optReason(ctx);
  return tx(() => {
    run(labDb, 'UPDATE LAB_COMPOSITE SET deleted_by = ?, deleted_at = ?, delete_reason = ? WHERE id = ?', ctx.actor?.name, ctx.ts, reason, id);
    run(labDb, `UPDATE LAB_EXT_SEND SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancel_reason = ? WHERE composite_id = ? AND status = 'sent'`,
      ctx.actor?.name, ctx.ts, reason, id);
    audit(ctx, 'composite', id, 'delete', { seq: c.seq, tickets: compositeTickets(id), attempts: attemptCount(id) }, null, reason);
    return { deleted: id };
  });
}

// ── attempts ───────────────────────────────────────────────────────────────
function insertAttempt(ctx, id, b) {
  const no = nextAttemptNo(id);
  const r = run(labDb, `INSERT INTO LAB_ATTEMPT (composite_id, attempt_no, test_source, ext_lab, ext_report_no, attachment_ref, temp_c_rd,
                         values_json, param_verdict_json, verdict, key_param, key_value, key_min, remark, tested_by, tested_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, no, b.test_source, b.ext_lab || null, b.ext_report_no || null, b.attachment_ref || null, b.temp_c_rd ?? null,
    JSON.stringify(b.values || {}), JSON.stringify(b.param_verdicts || {}), b.verdict,
    b.key_param || null, b.key_value ?? null, b.key_min ?? null, b.remark || null, ctx.actor?.name, ctx.ts);
  const aid = Number(r.lastInsertRowid);
  run(labDb, 'UPDATE LAB_COMPOSITE SET test_source = ? WHERE id = ?', b.test_source, id);
  audit(ctx, 'attempt', aid, 'create', null, { composite_id: id, attempt_no: no, test_source: b.test_source, verdict: b.verdict, values: b.values });
  return aid;
}

function addAttempt(ctx, id) {
  const c = liveComposite(id);
  if (c.memo_id) conflict('ขวดผสมนี้ออกบันทึกข้อความ สคบ-14 แล้ว');
  const b = ctx.body || {};
  if (!['inhouse', 'external_lab'].includes(b.test_source)) bad('test_source ไม่ถูกต้อง');
  if (!['pass', 'fail'].includes(b.verdict)) bad('verdict ต้องเป็น pass หรือ fail');
  return tx(() => { insertAttempt(ctx, id, b); return getComposite(ctx, id); });
}

// attempts can be corrected / deleted until a สคบ-14 is issued — except the one chosen as final
function editableAttempt(id, aid) {
  const c = liveComposite(id);
  if (c.memo_id) conflict('ขวดผสมนี้ออกบันทึกข้อความ สคบ-14 แล้ว — ยกเลิก สคบ-14 ก่อน');
  const a = one(labDb, `SELECT * FROM LAB_ATTEMPT WHERE id = ? AND composite_id = ? AND ${LIVE_ATTEMPT}`, aid, id);
  if (!a) notFound('ไม่พบผลวิเคราะห์ครั้งนี้');
  if (c.final_attempt_id === a.id) conflict('ผลครั้งนี้ถูกใช้เป็นผล final — เปลี่ยนผล final หรือย้อนผล final ก่อน');
  return a;
}
function syncTestSource(id) {
  const latest = one(labDb, `SELECT test_source FROM LAB_ATTEMPT WHERE composite_id = ? AND ${LIVE_ATTEMPT} ORDER BY attempt_no DESC LIMIT 1`, id);
  run(labDb, 'UPDATE LAB_COMPOSITE SET test_source = ? WHERE id = ?', latest?.test_source ?? null, id);
}

function editAttempt(ctx, id, aid) {
  const before = editableAttempt(id, aid);
  const reason = optReason(ctx);
  const b = ctx.body || {};
  if (!TEST_SOURCES.includes(b.test_source)) bad('test_source ไม่ถูกต้อง');
  if (!['pass', 'fail'].includes(b.verdict)) bad('verdict ต้องเป็น pass หรือ fail');
  return tx(() => {
    run(labDb, `UPDATE LAB_ATTEMPT SET test_source = ?, ext_lab = ?, ext_report_no = ?, attachment_ref = ?, temp_c_rd = ?,
                  values_json = ?, param_verdict_json = ?, verdict = ?, key_param = ?, key_value = ?, key_min = ?, remark = ?,
                  updated_by = ?, updated_at = ? WHERE id = ?`,
      b.test_source, b.ext_lab || null, b.ext_report_no || null, b.attachment_ref || null, b.temp_c_rd ?? null,
      JSON.stringify(b.values || {}), JSON.stringify(b.param_verdicts || {}), b.verdict,
      b.key_param || null, b.key_value ?? null, b.key_min ?? null, b.remark || null, ctx.actor?.name, ctx.ts, aid);
    syncTestSource(id);
    audit(ctx, 'attempt', aid, 'update',
      { test_source: before.test_source, values: JSON.parse(before.values_json), verdict: before.verdict, remark: before.remark },
      { test_source: b.test_source, values: b.values, verdict: b.verdict, remark: b.remark || null }, reason);
    return getComposite(ctx, id);
  });
}

function deleteAttempt(ctx, id, aid) {
  const a = editableAttempt(id, aid);
  const reason = optReason(ctx);
  return tx(() => {
    run(labDb, 'UPDATE LAB_ATTEMPT SET deleted_by = ?, deleted_at = ?, delete_reason = ? WHERE id = ?', ctx.actor?.name, ctx.ts, reason, aid);
    syncTestSource(id);
    audit(ctx, 'attempt', aid, 'delete', { attempt_no: a.attempt_no, values: JSON.parse(a.values_json), verdict: a.verdict }, null, reason);
    return getComposite(ctx, id);
  });
}

// ── final (per composite) + case ───────────────────────────────────────────
// case_scope: composite = trips mixed into this composite (default) · day = every trip of the day/company ·
// custom = case_tickets (any trips of that day/company)
function caseTrips(c, scope, picked) {
  const day = wdataOfGroup(c.sample_date, c.chemical, c.company);
  if (scope === 'day') return day;
  if (scope === 'composite') {
    const mine = new Set(compositeTickets(c.id));
    return day.filter(t => mine.has(t.ticket1));
  }
  if (scope === 'custom') {
    if (!Array.isArray(picked) || !picked.length) bad('เลือกเที่ยวรถที่จะชดเชยอย่างน้อย 1 เที่ยว');
    const set = new Set(picked.map(String));
    const out = day.filter(t => set.has(t.ticket1));
    if (out.length !== set.size) bad('มีเที่ยวรถที่ไม่ได้อยู่ในวัน/บริษัทของตัวอย่างนี้');
    return out;
  }
  bad('case_scope ต้องเป็น composite, day หรือ custom');
}

function setFinal(ctx, id) {
  const c = liveComposite(id);
  if (c.memo_id) conflict('ขวดผสมนี้ออกบันทึกข้อความ สคบ-14 แล้ว — เปลี่ยนผลไม่ได้');
  const { attempt_id, task_template = [], case_scope = 'composite', case_tickets } = ctx.body || {};
  const a = one(labDb, `SELECT * FROM LAB_ATTEMPT WHERE id = ? AND composite_id = ? AND ${LIVE_ATTEMPT}`, attempt_id, id);
  if (!a) bad('attempt_id ไม่ถูกต้อง');
  if (c.final_attempt_id === a.id) conflict('ผลครั้งนี้เป็นผล final อยู่แล้ว');
  const reason = optReason(ctx);
  const prevCase = activeCase(id);
  if (prevCase && offsetSum(prevCase.id) > 0) conflict(`เคส #${prevCase.id} มีการตัดยอดชดเชยอยู่ — ให้ Operator ยกเลิกการตัดยอดก่อนจึงเปลี่ยนผล final ได้`);
  const trips = a.verdict === 'fail' ? caseTrips(c, case_scope, case_tickets) : [];
  if (a.verdict === 'fail' && !trips.length) bad('ไม่มีเที่ยวรถให้ชดเชย');

  return tx(() => {
    if (prevCase) {
      run(labDb, `UPDATE LAB_CASE SET status = 'cancelled', cancel_reason = ?, closed_at = ? WHERE id = ?`, reason, ctx.ts, prevCase.id);
      audit(ctx, 'case', prevCase.id, 'cancel', { status: prevCase.status }, { status: 'cancelled', by: 'change_final' }, reason);
    }
    run(labDb, 'UPDATE LAB_COMPOSITE SET final_attempt_id = ?, verdict = ?, finalized_by = ?, finalized_at = ? WHERE id = ?',
      a.id, a.verdict, ctx.actor?.name, ctx.ts, id);
    audit(ctx, 'composite', id, 'final',
      { final_attempt_id: c.final_attempt_id, verdict: c.verdict, finalized_by: c.finalized_by },
      { final_attempt_id: a.id, verdict: a.verdict, finalized_by: ctx.actor?.name }, reason);

    let newCase = null;
    if (a.verdict === 'fail') {
      // a trip is compensated by at most one live case (overlapping composites must not double-count)
      const taken = all(labDb, `SELECT ct.ticket1, ct.case_id FROM LAB_CASE_TICKET ct JOIN LAB_CASE k ON k.id = ct.case_id
                                WHERE k.status != 'cancelled' AND ct.ticket1 IN (${qs(trips.length)})`, ...trips.map(t => t.ticket1));
      if (taken.length) conflict(`เที่ยวรถ ${taken.map(x => `${x.ticket1} (เคส #${x.case_id})`).join(', ')} อยู่ในเคสชดเชยอื่นแล้ว — เลือกเที่ยวอื่น`);
      const totalNet = trips.reduce((s, t) => s + (t.net_kg || 0), 0);
      const pv = JSON.parse(a.param_verdict_json);
      let suggested = 0;
      if (a.key_param && pv[a.key_param] === 'fail' && a.key_value != null && a.key_min) {
        suggested = Math.round(totalNet * Math.max(0, 1 - a.key_value / a.key_min));
      }
      const r = run(labDb, `INSERT INTO LAB_CASE (composite_id, chemical, company, suggested_kg, target_kg, status, scope, opened_by, opened_at)
                            VALUES (?,?,?,?,?, 'open', ?, ?, ?)`,
        id, c.chemical, c.company, suggested, suggested, case_scope, ctx.actor?.name, ctx.ts);
      const caseId = Number(r.lastInsertRowid);
      for (const t of trips) run(labDb, 'INSERT INTO LAB_CASE_TICKET (case_id, ticket1, net_kg) VALUES (?,?,?)', caseId, t.ticket1, t.net_kg ?? null);
      task_template.forEach((t, i) => {
        run(labDb, `INSERT INTO LAB_CASE_TASK (case_id, seq, title, source, auto_key) VALUES (?,?,?, 'template', ?)`,
          caseId, i + 1, t.title, t.auto_key || null);
      });
      audit(ctx, 'case', caseId, 'open', null, { composite_id: id, scope: case_scope, tickets: trips.map(t => t.ticket1), suggested_kg: suggested, total_net_kg: totalNet });
      syncCaseState(ctx, caseId);
      newCase = caseSummary(one(labDb, 'SELECT * FROM LAB_CASE WHERE id = ?', caseId));
    }
    return { ...getComposite(ctx, id), opened_case: newCase, cancelled_case_id: prevCase?.id ?? null };
  });
}

// Undo the final result → back to "analysing". The open/closed case goes with it (cancelled),
// unless offsets are still applied — the operator must void them first.
function unsetFinal(ctx, id) {
  const c = liveComposite(id);
  if (c.memo_id) conflict('ขวดผสมนี้ออกบันทึกข้อความ สคบ-14 แล้ว — ยกเลิก สคบ-14 ก่อน');
  if (!c.final_attempt_id) conflict('ยังไม่ได้เลือกผล final');
  const ac = activeCase(id);
  if (ac && offsetSum(ac.id) > 0) conflict(`เคส #${ac.id} มีการตัดยอดชดเชยอยู่ — ให้ Operator ยกเลิกการตัดยอดก่อน`);
  const reason = optReason(ctx);
  return tx(() => {
    if (ac) {
      run(labDb, `UPDATE LAB_CASE SET status = 'cancelled', cancel_reason = ?, closed_at = ? WHERE id = ?`, reason, ctx.ts, ac.id);
      audit(ctx, 'case', ac.id, 'cancel', { status: ac.status }, { status: 'cancelled', by: 'unset_final' }, reason);
    }
    run(labDb, `UPDATE LAB_COMPOSITE SET final_attempt_id = NULL, verdict = 'pending', finalized_by = NULL, finalized_at = NULL WHERE id = ?`, id);
    audit(ctx, 'composite', id, 'unfinal', { final_attempt_id: c.final_attempt_id, verdict: c.verdict, finalized_by: c.finalized_by, case_id: ac?.id ?? null },
      { final_attempt_id: null, verdict: 'pending' }, reason);
    return { ...getComposite(ctx, id), cancelled_case_id: ac?.id ?? null };
  });
}

// ── external lab ───────────────────────────────────────────────────────────
function extSendRow(s) {
  const c = one(labDb, 'SELECT * FROM LAB_COMPOSITE WHERE id = ?', s.composite_id);
  return { ...s, composite: c ? { ...compositeSummary(c), deleted: !!c.deleted_at } : null };
}

function createExtSend(ctx, id) {
  const c = liveComposite(id);
  if (c.memo_id) conflict('ขวดผสมนี้ออก สคบ-14 แล้ว');
  const lab = String(ctx.body?.lab_name || '').trim();
  if (!lab) bad('ระบุชื่อห้องปฏิบัติการ');
  return tx(() => {
    const r = run(labDb, `INSERT INTO LAB_EXT_SEND (composite_id, lab_name, note, status, sent_by, sent_at) VALUES (?,?,?, 'sent', ?, ?)`,
      id, lab, ctx.body?.note || null, ctx.actor?.name, ctx.ts);
    audit(ctx, 'composite', id, 'ext_send', null, { ext_send_id: Number(r.lastInsertRowid), lab_name: lab });
    return getComposite(ctx, id);
  });
}

function listExtSends(ctx) {
  const { status, from, to } = ctx.query;
  let sql = 'SELECT * FROM LAB_EXT_SEND WHERE 1=1';
  const p = [];
  if (status) { sql += ' AND status = ?'; p.push(status); }
  if (from) { sql += ' AND substr(sent_at,1,10) >= ?'; p.push(from); }
  if (to) { sql += ' AND substr(sent_at,1,10) <= ?'; p.push(to); }
  sql += ' ORDER BY sent_at DESC, id DESC';
  return { sends: all(labDb, sql, ...p).map(extSendRow) };
}

function getExtSendRow(sid) {
  const s = one(labDb, 'SELECT * FROM LAB_EXT_SEND WHERE id = ?', sid);
  if (!s) notFound('ไม่พบรายการส่ง Lab ภายนอก');
  return s;
}
function getExtSend(ctx, sid) {
  return { send: extSendRow(getExtSendRow(sid)) };
}

// result of an external lab → a new attempt (test_source external_lab) on the composite; proxy computed verdicts
function extResult(ctx, sid) {
  const s = getExtSendRow(sid);
  if (s.status !== 'sent') conflict(s.status === 'resulted' ? 'บันทึกผลของรายการนี้แล้ว — แก้ไขได้ในแท็บผลวิเคราะห์' : 'รายการนี้ถูกยกเลิกแล้ว');
  const c = liveComposite(s.composite_id);
  if (c.memo_id) conflict('ขวดผสมนี้ออก สคบ-14 แล้ว');
  const b = ctx.body || {};
  if (!['pass', 'fail'].includes(b.verdict)) bad('verdict ต้องเป็น pass หรือ fail');
  return tx(() => {
    const aid = insertAttempt(ctx, c.id, { ...b, test_source: 'external_lab', ext_lab: b.ext_lab || s.lab_name });
    run(labDb, `UPDATE LAB_EXT_SEND SET status = 'resulted', attempt_id = ?, resulted_by = ?, resulted_at = ? WHERE id = ?`, aid, ctx.actor?.name, ctx.ts, sid);
    audit(ctx, 'composite', c.id, 'ext_result', null, { ext_send_id: sid, attempt_id: aid });
    return getExtSend(ctx, sid);
  });
}

function cancelExtSend(ctx, sid) {
  const s = getExtSendRow(sid);
  if (s.status !== 'sent') conflict('ยกเลิกได้เฉพาะรายการที่รอผล');
  const reason = optReason(ctx);
  return tx(() => {
    run(labDb, `UPDATE LAB_EXT_SEND SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?`, ctx.actor?.name, ctx.ts, reason, sid);
    audit(ctx, 'composite', s.composite_id, 'ext_cancel', { ext_send_id: sid, lab_name: s.lab_name }, null, reason);
    return getExtSend(ctx, sid);
  });
}

// ── offsets / memo voids ───────────────────────────────────────────────────
function voidOffset(ctx, id, oid) {
  const c = one(labDb, 'SELECT * FROM LAB_CASE WHERE id = ?', id);
  if (!c) notFound('ไม่พบเคส');
  if (c.status === 'cancelled') conflict('เคสถูกยกเลิกแล้ว');
  const o = one(labDb, 'SELECT * FROM LAB_OFFSET WHERE id = ? AND case_id = ?', oid, id);
  if (!o) notFound('ไม่พบรายการตัดยอด');
  if (o.voided_at) conflict('รายการนี้ถูกยกเลิกแล้ว');
  const reason = optReason(ctx);
  return tx(() => {
    run(labDb, 'UPDATE LAB_OFFSET SET voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?', ctx.actor?.name, ctx.ts, reason, oid);
    audit(ctx, 'case', id, 'offset_void', { offset_id: oid, ticket1: o.ticket1, offset_kg: o.offset_kg }, null, reason);
    if (c.status === 'closed') {
      run(labDb, `UPDATE LAB_CASE SET status = 'open', closed_at = NULL WHERE id = ?`, id);
      audit(ctx, 'case', id, 'reopen', { status: 'closed' }, { status: 'open' }, reason);
    }
    syncCaseState(ctx, id);
    return getCase(ctx, id);
  });
}

function voidMemo(ctx, id) {
  const m = one(labDb, 'SELECT * FROM LAB_MEMO WHERE id = ?', id);
  if (!m) notFound('ไม่พบบันทึกข้อความ');
  if (m.status === 'void') conflict('บันทึกข้อความนี้ถูกยกเลิกแล้ว');
  const reason = optReason(ctx);
  return tx(() => {
    const comps = all(labDb, 'SELECT id FROM LAB_COMPOSITE WHERE memo_id = ?', id).map(r => r.id);
    run(labDb, `UPDATE LAB_MEMO SET status = 'void', voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?`, ctx.actor?.name, ctx.ts, reason, id);
    run(labDb, 'UPDATE LAB_COMPOSITE SET memo_id = NULL WHERE memo_id = ?', id);
    audit(ctx, 'memo', id, 'void', { status: m.status, composites: comps }, { status: 'void' }, reason);
    return { memo: one(labDb, 'SELECT * FROM LAB_MEMO WHERE id = ?', id), rows: [], released: comps };
  });
}

// Board: every (DAYIN, chemical, company) group of weighed trips in [from, to] + its composites
function pipeline(ctx) {
  const { from, to } = ctx.query;
  if (!from || !to) bad('from, to are required');
  const trips = all(chemDb, `${WDATA_SEL} AND DAYIN BETWEEN ? AND ? ORDER BY DAYIN DESC, TICKET1`, from, to).map(wdataRow);
  const tickets = trips.map(t => t.ticket1);
  const bottles = {};
  for (let i = 0; i < tickets.length; i += 500) {
    const part = tickets.slice(i, i + 500);
    for (const b of all(labDb, `SELECT * FROM LAB_BOTTLE WHERE ticket1 IN (${qs(part.length)})`, ...part)) bottles[b.ticket1] = b;
  }
  const comps = all(labDb, `SELECT * FROM LAB_COMPOSITE WHERE sample_date BETWEEN ? AND ? AND ${LIVE_COMP} ORDER BY seq`, from, to).map(compositeSummary);
  const groups = {};
  for (const t of trips) {
    const key = `${t.dayin}|${t.chemical}|${t.company}`;
    if (!groups[key]) {
      groups[key] = {
        date: t.dayin, chemical: t.chemical, company: t.company, company_name: t.company_name,
        expected: 0, received: 0, not_received: 0, pending: 0, net_kg: 0, unmixed: 0,
        composites: comps.filter(c => c.sample_date === t.dayin && c.chemical === t.chemical && c.company === t.company),
      };
    }
    const g = groups[key];
    const b = bottles[t.ticket1];
    g.expected++;
    g.net_kg += t.net_kg || 0;
    if (!b) g.pending++;
    else if (b.status === 'received') { g.received++; if (!g.composites.some(c => c.tickets.includes(t.ticket1))) g.unmixed++; }
    else g.not_received++;
  }
  return { from, to, groups: Object.values(groups) };
}

// ── cases ──────────────────────────────────────────────────────────────────
function listCases(ctx) {
  const { status, chemical, company } = ctx.query;
  let sql = 'SELECT * FROM LAB_CASE WHERE 1=1';
  const p = [];
  if (status) { sql += ' AND status = ?'; p.push(status); }
  if (chemical) { sql += ' AND chemical = ?'; p.push(chemical); }
  if (company) { sql += ' AND company = ?'; p.push(company); }
  sql += ' ORDER BY id DESC';
  return { cases: all(labDb, sql, ...p).map(caseSummary) };
}

function getCase(ctx, id) {
  const c = one(labDb, 'SELECT * FROM LAB_CASE WHERE id = ?', id);
  if (!c) notFound('ไม่พบเคส');
  const tickets = all(labDb, 'SELECT * FROM LAB_CASE_TICKET WHERE case_id = ?', id);
  const trips = wdataByTickets(tickets.map(t => t.ticket1));
  const sidecar = sidecarByTickets(tickets.map(t => t.ticket1));
  const offsets = all(labDb, 'SELECT * FROM LAB_OFFSET WHERE case_id = ? ORDER BY id', id);
  const offTrips = wdataByTickets(offsets.map(o => o.ticket1));
  const comp = one(labDb, 'SELECT * FROM LAB_COMPOSITE WHERE id = ?', c.composite_id);
  const finalAttempt = comp?.final_attempt_id ? parseAttempt(one(labDb, 'SELECT * FROM LAB_ATTEMPT WHERE id = ?', comp.final_attempt_id)) : null;
  return {
    case: caseSummary(c),
    composite: comp ? { ...comp, company_name: companyName(comp.company), tickets: compositeTickets(comp.id) } : null,
    final_attempt: finalAttempt,
    tickets: tickets.map(t => ({ ...t, trip: trips[t.ticket1] || null, sidecar: sidecar[t.ticket1] || null })),
    tasks: all(labDb, 'SELECT * FROM LAB_CASE_TASK WHERE case_id = ? ORDER BY seq', id),
    offsets: offsets.map(o => ({ ...o, trip: offTrips[o.ticket1] || null })),
    audit: all(labDb, `SELECT * FROM LAB_AUDIT WHERE entity = 'case' AND entity_id = ? ORDER BY id`, String(id)),
  };
}

function patchCase(ctx, id) {
  const c = one(labDb, 'SELECT * FROM LAB_CASE WHERE id = ?', id);
  if (!c) notFound('ไม่พบเคส');
  const b = ctx.body || {};
  return tx(() => {
    if (b.car_key !== undefined) {
      run(labDb, 'UPDATE LAB_CASE SET car_key = ? WHERE id = ?', b.car_key, id);
      audit(ctx, 'case', id, 'car_link', { car_key: c.car_key }, { car_key: b.car_key });
    }
    if (b.action === 'cancel') {
      if (c.status !== 'open') conflict('ยกเลิกได้เฉพาะเคสที่เปิดอยู่');
      if (offsetSum(id) > 0) conflict('เคสนี้มีการตัดยอดชดเชยแล้ว — ยกเลิกไม่ได้');
      run(labDb, `UPDATE LAB_CASE SET status = 'cancelled', cancel_reason = ?, closed_at = ? WHERE id = ?`, b.reason || null, ctx.ts, id);
      audit(ctx, 'case', id, 'cancel', { status: c.status }, { status: 'cancelled' }, b.reason);
    }
    if (b.target_kg !== undefined) {
      if (c.status !== 'open') conflict('แก้ปริมาณได้เฉพาะเคสที่เปิดอยู่');
      const t = Number(b.target_kg);
      if (!(t >= 0)) bad('target_kg ต้อง ≥ 0');
      if (t < offsetSum(id)) bad('target_kg ต่ำกว่ายอดที่ตัดชดเชยไปแล้ว');
      run(labDb, 'UPDATE LAB_CASE SET target_kg = ?, override_reason = ? WHERE id = ?', t, b.override_reason || null, id);
      audit(ctx, 'case', id, 'target', { target_kg: c.target_kg }, { target_kg: t }, b.override_reason);
      syncCaseState(ctx, id);
    }
    return getCase(ctx, id);
  });
}

function addTask(ctx, id) {
  const c = one(labDb, 'SELECT * FROM LAB_CASE WHERE id = ?', id);
  if (!c) notFound('ไม่พบเคส');
  if (c.status !== 'open') conflict('เพิ่มงานได้เฉพาะเคสที่เปิดอยู่');
  const title = (ctx.body?.title || '').trim();
  if (!title) bad('title is required');
  return tx(() => {
    const seq = one(labDb, 'SELECT COALESCE(MAX(seq),0)+1 n FROM LAB_CASE_TASK WHERE case_id = ?', id).n;
    const r = run(labDb, `INSERT INTO LAB_CASE_TASK (case_id, seq, title, source) VALUES (?,?,?, 'manual')`, id, seq, title);
    audit(ctx, 'case', id, 'task_add', null, { task_id: Number(r.lastInsertRowid), title });
    return getCase(ctx, id);
  });
}

function doneTask(ctx, id, taskId) {
  const c = one(labDb, 'SELECT * FROM LAB_CASE WHERE id = ?', id);
  if (!c) notFound('ไม่พบเคส');
  if (c.status !== 'open') conflict('เคสนี้ไม่ได้เปิดอยู่');
  const t = one(labDb, 'SELECT * FROM LAB_CASE_TASK WHERE id = ? AND case_id = ?', taskId, id);
  if (!t) notFound('ไม่พบงาน');
  if (t.auto_key) conflict('งานนี้ระบบติ๊กเองเมื่อตัดยอดชดเชยครบ');
  if (t.done_at) conflict('งานนี้เสร็จแล้ว');
  return tx(() => {
    run(labDb, 'UPDATE LAB_CASE_TASK SET done_by = ?, done_at = ?, remark = ? WHERE id = ?', ctx.actor?.name, ctx.ts, ctx.body?.remark || null, taskId);
    audit(ctx, 'case', id, 'task_done', null, { task_id: taskId, title: t.title, remark: ctx.body?.remark || null });
    syncCaseState(ctx, id);
    return getCase(ctx, id);
  });
}

// Candidates: same product + company, delivered after the failing sample date, not part of the case,
// with un-offset net weight left. The operator settles the offset on the billing of these trips.
function offsetCandidates(ctx) {
  const id = Number(ctx.query.case_id);
  const c = one(labDb, 'SELECT * FROM LAB_CASE WHERE id = ?', id);
  if (!c) notFound('ไม่พบเคส');
  const comp = one(labDb, 'SELECT sample_date FROM LAB_COMPOSITE WHERE id = ?', c.composite_id);
  const own = new Set(all(labDb, 'SELECT ticket1 FROM LAB_CASE_TICKET WHERE case_id = ?', id).map(t => t.ticket1));
  const rows = all(chemDb, `${WDATA_SEL} AND PRODUCT = ? AND COMPANY = ? AND DAYIN > ? ORDER BY DAYIN, TMIN LIMIT 200`,
    CHEM_PRODUCT[c.chemical], c.company, comp.sample_date).map(wdataRow);
  const candidates = rows
    .filter(r => !own.has(r.ticket1))
    .map(r => ({ ...r, offset_used_kg: ticketOffsetSum(r.ticket1) }))
    .map(r => ({ ...r, available_kg: round1((r.net_kg || 0) - r.offset_used_kg) }))
    .filter(r => r.available_kg > 0);
  return { case: caseSummary(c), candidates };
}

function addOffset(ctx, id) {
  const c = one(labDb, 'SELECT * FROM LAB_CASE WHERE id = ?', id);
  if (!c) notFound('ไม่พบเคส');
  if (c.status !== 'open') conflict('ตัดยอดได้เฉพาะเคสที่เปิดอยู่');
  const { ticket1, offset_kg, remark } = ctx.body || {};
  const kg = Number(offset_kg);
  if (!(kg > 0)) bad('offset_kg ต้องมากกว่า 0');
  const { candidates } = offsetCandidates({ ...ctx, query: { case_id: id } });
  const cand = candidates.find(x => x.ticket1 === ticket1);
  if (!cand) bad('TICKET1 นี้ไม่อยู่ในรายการที่ตัดยอดได้ (บริษัท/สาร/วันที่ ไม่ตรง หรือถูกตัดครบแล้ว)');
  const remaining = c.target_kg - offsetSum(id);
  if (kg > remaining + 1e-9) bad(`เกินยอดคงเหลือ (${round1(remaining)} kg)`);
  if (kg > cand.available_kg + 1e-9) bad(`เกินน้ำหนักสุทธิคงเหลือของเที่ยวนี้ (${cand.available_kg} kg)`);
  return tx(() => {
    const r = run(labDb, `INSERT INTO LAB_OFFSET (case_id, ticket1, offset_kg, net_kg, remark, by_user, at) VALUES (?,?,?,?,?,?,?)`,
      id, ticket1, kg, cand.net_kg, remark || null, ctx.actor?.name, ctx.ts);
    audit(ctx, 'case', id, 'offset', null, { offset_id: Number(r.lastInsertRowid), ticket1, offset_kg: kg, billable_kg: round1(cand.net_kg - cand.offset_used_kg - kg) });
    syncCaseState(ctx, id);
    return getCase(ctx, id);
  });
}

// ── สคบ-14 ─────────────────────────────────────────────────────────────────
function memoRows(chemical, from, to, memoId) {
  const comps = memoId
    ? all(labDb, 'SELECT * FROM LAB_COMPOSITE WHERE memo_id = ? ORDER BY sample_date, company, seq', memoId)
    : all(labDb, `SELECT * FROM LAB_COMPOSITE WHERE chemical = ? AND sample_date BETWEEN ? AND ? AND final_attempt_id IS NOT NULL
                  AND memo_id IS NULL AND ${LIVE_COMP} ORDER BY sample_date, company, seq`, chemical, from, to);
  return comps.map(c => ({
    composite_id: c.id, sample_date: c.sample_date, company: c.company, company_name: companyName(c.company),
    seq: c.seq, n_bottles: c.n_bottles, tickets: compositeTickets(c.id), note: c.note, verdict: c.verdict,
    finalized_by: c.finalized_by, finalized_at: c.finalized_at,
    final_attempt: parseAttempt(one(labDb, 'SELECT * FROM LAB_ATTEMPT WHERE id = ?', c.final_attempt_id)),
  }));
}

function memoPreview(ctx) {
  const { chemical, from, to } = ctx.query;
  if (!chemical || !from || !to) bad('chemical, from, to are required');
  const rows = memoRows(chemical, from, to);
  const n = one(labDb, `SELECT COUNT(*) n FROM LAB_BOTTLE WHERE chemical = ? AND dayin BETWEEN ? AND ? AND status = 'received'`, chemical, from, to).n;
  const pendingFinal = one(labDb, `SELECT COUNT(*) n FROM LAB_COMPOSITE WHERE chemical = ? AND sample_date BETWEEN ? AND ? AND final_attempt_id IS NULL AND ${LIVE_COMP}`,
    chemical, from, to).n;
  return { chemical, from, to, n_samples: n, m_analyzed: rows.length, pending_final: pendingFinal, rows };
}

// composite_ids (optional) = the composites the user ticked; default = every row of the preview
function createMemo(ctx) {
  const b = ctx.body || {};
  const docNo = (b.doc_no || '').trim();
  if (!docNo) bad('doc_no is required');
  if (one(labDb, 'SELECT id FROM LAB_MEMO WHERE doc_no = ?', docNo)) conflict(`เลขที่เอกสาร ${docNo} ถูกใช้แล้ว`);
  const p = memoPreview({ ...ctx, query: { chemical: b.chemical, from: b.from, to: b.to } });
  let rows = p.rows;
  if (Array.isArray(b.composite_ids)) {
    const want = new Set(b.composite_ids.map(Number));
    rows = p.rows.filter(r => want.has(r.composite_id));
    if (rows.length !== want.size) bad('มีขวดผสมที่เลือกซึ่งไม่อยู่ในรายการ (ยังไม่มีผล final หรือออก สคบ-14 แล้ว)');
  }
  if (!rows.length) bad('ไม่มีผลวิเคราะห์ (final) ที่เลือก');
  return tx(() => {
    const r = run(labDb, `INSERT INTO LAB_MEMO (doc_no, doc_date, chemical, period_from, period_to, n_samples, m_analyzed, addressee, spec_ref, conclusion, created_by, created_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      docNo, b.doc_date || ctx.ts.slice(0, 10), b.chemical, b.from, b.to, p.n_samples, rows.length,
      b.addressee || null, b.spec_ref || null, b.conclusion || null, ctx.actor?.name, ctx.ts);
    const id = Number(r.lastInsertRowid);
    for (const row of rows) run(labDb, 'UPDATE LAB_COMPOSITE SET memo_id = ? WHERE id = ?', id, row.composite_id);
    audit(ctx, 'memo', id, 'create', null, { doc_no: docNo, composites: rows.map(x => x.composite_id) });
    return getMemo(ctx, id);
  });
}

function listMemos() {
  return { memos: all(labDb, 'SELECT * FROM LAB_MEMO ORDER BY id DESC') };
}

function getMemo(ctx, id) {
  const m = one(labDb, 'SELECT * FROM LAB_MEMO WHERE id = ?', id);
  if (!m) notFound('ไม่พบบันทึกข้อความ');
  return { memo: m, rows: memoRows(null, null, null, id) };
}

function trace(ctx, ticket1) {
  const trip = wdataByTicket(ticket1);
  const bottle = one(labDb, 'SELECT * FROM LAB_BOTTLE WHERE ticket1 = ?', ticket1);
  const comps = compositesOfTicket(ticket1).map(c => ({ ...compositeSummary(c), attempts_list: liveAttempts(c.id) }));
  const caseIds = all(labDb, 'SELECT case_id FROM LAB_CASE_TICKET WHERE ticket1 = ?', ticket1).map(r => r.case_id);
  return {
    ticket1,
    trip,
    sidecar: sidecarByTickets([ticket1])[ticket1] || null,
    bottle,
    composites: comps,
    cases: caseIds.map(id => caseSummary(one(labDb, 'SELECT * FROM LAB_CASE WHERE id = ?', id))),
    offsets_applied: all(labDb, 'SELECT * FROM LAB_OFFSET WHERE ticket1 = ? ORDER BY id', ticket1),
    audit: all(labDb, `SELECT * FROM LAB_AUDIT WHERE entity = 'bottle' AND entity_id = ? ORDER BY id`, ticket1),
  };
}

// ── router ─────────────────────────────────────────────────────────────────
const ROUTES = [
  ['GET',   /^\/bottles$/,                       (c) => getBottles(c)],
  ['PUT',   /^\/bottles$/,                       (c) => putBottles(c)],
  ['GET',   /^\/composites$/,                    (c) => listComposites(c)],
  ['POST',  /^\/composites$/,                    (c) => createComposite(c)],
  ['GET',   /^\/composites\/(\d+)$/,             (c, m) => getComposite(c, Number(m[1]))],
  ['PUT',   /^\/composites\/(\d+)$/,             (c, m) => updateComposite(c, Number(m[1]))],
  ['DELETE',/^\/composites\/(\d+)$/,             (c, m) => deleteComposite(c, Number(m[1]))],
  ['POST',  /^\/composites\/(\d+)\/attempts$/,   (c, m) => addAttempt(c, Number(m[1]))],
  ['PUT',   /^\/composites\/(\d+)\/final$/,      (c, m) => setFinal(c, Number(m[1]))],
  ['DELETE',/^\/composites\/(\d+)\/final$/,      (c, m) => unsetFinal(c, Number(m[1]))],
  ['PUT',   /^\/composites\/(\d+)\/attempts\/(\d+)$/, (c, m) => editAttempt(c, Number(m[1]), Number(m[2]))],
  ['DELETE',/^\/composites\/(\d+)\/attempts\/(\d+)$/, (c, m) => deleteAttempt(c, Number(m[1]), Number(m[2]))],
  ['POST',  /^\/composites\/(\d+)\/ext-sends$/,  (c, m) => createExtSend(c, Number(m[1]))],
  ['GET',   /^\/ext-sends$/,                     (c) => listExtSends(c)],
  ['GET',   /^\/ext-sends\/(\d+)$/,              (c, m) => getExtSend(c, Number(m[1]))],
  ['POST',  /^\/ext-sends\/(\d+)\/result$/,      (c, m) => extResult(c, Number(m[1]))],
  ['POST',  /^\/ext-sends\/(\d+)\/cancel$/,      (c, m) => cancelExtSend(c, Number(m[1]))],
  ['GET',   /^\/pipeline$/,                      (c) => pipeline(c)],
  ['POST',  /^\/memos\/(\d+)\/void$/,            (c, m) => voidMemo(c, Number(m[1]))],
  ['POST',  /^\/cases\/(\d+)\/offsets\/(\d+)\/void$/, (c, m) => voidOffset(c, Number(m[1]), Number(m[2]))],
  ['GET',   /^\/memos$/,                         (c) => listMemos(c)],
  ['GET',   /^\/memos\/preview$/,                (c) => memoPreview(c)],
  ['POST',  /^\/memos$/,                         (c) => createMemo(c)],
  ['GET',   /^\/memos\/(\d+)$/,                  (c, m) => getMemo(c, Number(m[1]))],
  ['GET',   /^\/cases$/,                         (c) => listCases(c)],
  ['GET',   /^\/cases\/(\d+)$/,                  (c, m) => getCase(c, Number(m[1]))],
  ['PATCH', /^\/cases\/(\d+)$/,                  (c, m) => patchCase(c, Number(m[1]))],
  ['POST',  /^\/cases\/(\d+)\/tasks$/,           (c, m) => addTask(c, Number(m[1]))],
  ['PATCH', /^\/cases\/(\d+)\/tasks\/(\d+)$/,    (c, m) => doneTask(c, Number(m[1]), Number(m[2]))],
  ['GET',   /^\/offset-candidates$/,             (c) => offsetCandidates(c)],
  ['POST',  /^\/cases\/(\d+)\/offsets$/,         (c, m) => addOffset(c, Number(m[1]))],
  ['GET',   /^\/trace\/([^/]+)$/,                (c, m) => trace(c, decodeURIComponent(m[1]))],
];

// ctx: { method, path, query, body, actor: {name, role}, ts }
function handle(cfg, serverDir, ctx) {
  try {
    init(cfg, serverDir);
    for (const [method, re, fn] of ROUTES) {
      if (method !== ctx.method) continue;
      const m = ctx.path.match(re);
      if (m) return { status: 200, body: { ok: true, ...fn(ctx, m) } };
    }
    return { status: 404, body: { error: `No mock route: ${ctx.method} ${ctx.path}` } };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    console.error('[chem-lab mock]', e);
    return { status: 500, body: { error: e.message } };
  }
}

module.exports = { handle };
