const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { writeData } = require('../services/aquadat');
const { getDb, persist, nowTH } = require('../services/db');
const { writeToExcel, buildDailyLab } = require('../services/excelWriter');
const { rememberToken, processAquadatQueue, processExcelQueue } = require('../services/queueWorker');

const NODES_PATH = path.join(__dirname, '..', 'config', 'nodes.json');

function requireAuth(req, res, next) {
  if (!req.cookies?.aquadat_token) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// Build a flat param_key → param lookup from nodes.json
function getParamMap() {
  const data = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
  const map = {};
  for (const node of data.nodes) {
    for (const p of node.parameters) {
      map[p.param_key] = p;
    }
  }
  return map;
}

function getNodesConfig() {
  return JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
}

function normalizeParamKey(paramKey) {
  if (typeof paramKey !== 'string') return paramKey;
  const jarMatch = paramKey.match(/^JarTest\.(Alum|PACl)\.(Dose|Turb|pH|Alk)(\d)$/);
  if (jarMatch) {
    const [, chem, metric, doseNo] = jarMatch;
    const m = metric === 'Turb' ? 'turb' : metric === 'Alk' ? 'alk' : metric;
    return `JarTest.${chem}.D${doseNo}.${m}`;
  }
  return paramKey;
}

function applyJarTestLegacyReadCompat(values, legacyRows) {
  const latestByKey = new Map();
  for (const row of legacyRows) latestByKey.set(row.param_key, row.trans_value);

  // Mirror legacy JarTest keys such as JarTest.PACl.Dose1 -> JarTest.PACl.D1.Dose
  // so the daily Record screen can prefill from imported non-daily legacy rows.
  for (const [legacyKey, transValue] of latestByKey.entries()) {
    const normalizedKey = normalizeParamKey(legacyKey);
    if (normalizedKey !== legacyKey) values[normalizedKey] = transValue;
  }

  const setIfLegacyExists = (targetKey, sourceKey) => {
    if (latestByKey.has(sourceKey)) values[targetKey] = latestByKey.get(sourceKey);
  };

  setIfLegacyExists('JarTest.Alum.RW_ref_Turb', 'JarTest.Alum.RW_ref_Turb');
  setIfLegacyExists('JarTest.Alum.RW_ref_pH', 'JarTest.Alum.RW_ref_pH');
  setIfLegacyExists('JarTest.Alum.RW_ref_Alk', 'JarTest.Alum.RW_ref_Alk');
  setIfLegacyExists('JarTest.Alum.RW_ref_Temp', 'JarTest.Alum.RW_ref_Temp');
  setIfLegacyExists('JarTest.PACl.RW_ref_turb', 'JarTest.PACl.RW_ref_turb');
  setIfLegacyExists('JarTest.PACl.RW_ref_pH', 'JarTest.PACl.RW_ref_pH');
  setIfLegacyExists('JarTest.PACl.RW_ref_Alkalinity', 'JarTest.PACl.RW_ref_Alkalinity');
  setIfLegacyExists('JarTest.PACl.RW_ref_Temp', 'JarTest.PACl.RW_ref_Temp');
  setIfLegacyExists('JarTest.Alum.RecommendDose1', 'JarTest.Alum.RecommendDose1');
  setIfLegacyExists('JarTest.Alum.RecommendDose2', 'JarTest.Alum.RecommendDose2');
  setIfLegacyExists('JarTest.PACl.RecommendDose1', 'JarTest.PACl.RecommendDose1');
  setIfLegacyExists('JarTest.PACl.RecommendDose2', 'JarTest.PACl.RecommendDose2');
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildRangeText(start, step) {
  if (!Number.isFinite(start) || !Number.isFinite(step)) return '-';
  return `${start} - ${start + step}`;
}

function findMatchDescendingIndex(values, lookup) {
  let matchIndex = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) break;
    if (v >= lookup) matchIndex = i;
    else break;
  }
  return matchIndex;
}

function computeRecommendRange({ rwRefTurb, doses, turbs, lookup, selectedOffset }) {
  const step = doses.length >= 2 && Number.isFinite(doses[0]) && Number.isFinite(doses[1]) ? doses[1] - doses[0] : null;
  if (!Number.isFinite(step) || !Number.isFinite(doses[0])) return null;
  if (!Number.isFinite(rwRefTurb)) return buildRangeText(doses[0], step);

  const matchIndex = findMatchDescendingIndex(turbs, lookup);
  if (matchIndex === null) return buildRangeText(doses[0], step);
  const doseIndex = matchIndex + selectedOffset;
  if (!Number.isFinite(doses[doseIndex])) return '-';
  return buildRangeText(doses[doseIndex], step);
}

function buildDerivedJarTestRecords(records) {
  const groups = new Map();

  for (const record of records) {
    if (record.trans_time !== 'daily') continue;
    const key = `${record.trans_dtm}|${record.trans_time}`;
    if (!groups.has(key)) groups.set(key, { trans_dtm: record.trans_dtm, trans_time: record.trans_time, values: {} });
    groups.get(key).values[normalizeParamKey(record.param_key)] = record.trans_value;
  }

  const derived = [];
  for (const group of groups.values()) {
    const values = group.values;
    const alumDoses = [1, 2, 3, 4, 5, 6].map(i => toNumber(values[`JarTest.Alum.D${i}.Dose`]));
    const alumTurbs = [1, 2, 3, 4, 5, 6].map(i => toNumber(values[`JarTest.Alum.D${i}.Turb`]));
    const paclDoses = [1, 2, 3, 4, 5, 6].map(i => toNumber(values[`JarTest.PACl.D${i}.Dose`]));
    const paclTurbs = [1, 2, 3, 4, 5, 6].map(i => toNumber(values[`JarTest.PACl.D${i}.Turb`]));

    const alumRecommend1 = computeRecommendRange({
      rwRefTurb: toNumber(values['JarTest.Alum.RW_ref_Turb']),
      doses: alumDoses,
      turbs: alumTurbs,
      lookup: 5.1,
      selectedOffset: 2,
    });
    const alumRecommend2 = computeRecommendRange({
      rwRefTurb: toNumber(values['JarTest.Alum.RW_ref_Turb']),
      doses: alumDoses,
      turbs: alumTurbs,
      lookup: 5.1,
      selectedOffset: 1,
    });
    const paclRecommend1 = computeRecommendRange({
      rwRefTurb: toNumber(values['JarTest.PACl.RW_ref_turb']),
      doses: paclDoses,
      turbs: paclTurbs,
      lookup: 5.1,
      selectedOffset: 1,
    });
    const paclRecommend2 = computeRecommendRange({
      rwRefTurb: toNumber(values['JarTest.PACl.RW_ref_turb']),
      doses: paclDoses,
      turbs: paclTurbs,
      lookup: 5.1,
      selectedOffset: 1,
    });

    const computedEntries = [
      ['JarTest.Alum.RecommendDose1', alumRecommend1],
      ['JarTest.Alum.RecommendDose2', alumRecommend2],
      ['JarTest.PACl.RecommendDose1', paclRecommend1],
      ['JarTest.PACl.RecommendDose2', paclRecommend2],
    ];

    for (const [param_key, trans_value] of computedEntries) {
      if (!trans_value) continue;
      derived.push({
        param_key,
        trans_dtm: group.trans_dtm,
        trans_time: group.trans_time,
        trans_value: String(trans_value),
      });
    }
  }

  return derived;
}

// GET /api/write/nodes?date=&slot= — fetch existing values from node_records
// { date: { shift_range: { name, position_label } } } — ผู้บันทึกแต่ละกะ สำหรับช่องลงชื่อใน DailyLab
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

// ── DailyLab ดาวน์โหลด (Excel เท่านั้น — PDF ผ่าน Excel COM ช้าเกินไปเมื่อหลายวัน): ?from=YYYY-MM-DD&to=YYYY-MM-DD → 1 ชีทต่อวัน จาก theme + node_records ──
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MAX_EXPORT_DAYS = 62;
router.get('/export.xlsx', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from || '') || !re.test(to || '') || from > to) return res.status(400).json({ error: 'ช่วงวันที่ไม่ถูกต้อง' });
  const dates = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
    if (dates.length > MAX_EXPORT_DAYS) return res.status(400).json({ error: `เลือกได้ไม่เกิน ${MAX_EXPORT_DAYS} วัน` });
  }

  const db = getDb();
  // ค่าวันละครั้ง: ใช้ค่าล่าสุดของวัน ไม่ว่าจะบันทึกใน slot ไหน (เหมือน GET /nodes?slot=daily)
  const daily = new Set(getNodesConfig().nodes.flatMap(n => n.parameters || []).filter(p => p.frequency === 'daily').map(p => p.param_key));
  const records = db.all(
    'SELECT param_key, trans_dtm, trans_time, trans_value FROM node_records WHERE trans_dtm BETWEEN ? AND ? ORDER BY recorded_at ASC, id ASC',
    [from, to]
  ).map(r => {
    const param_key = normalizeParamKey(r.param_key);
    return { ...r, param_key, trans_time: daily.has(param_key) ? 'daily' : r.trans_time };
  });

  const be = d => `${+d.slice(0, 4) + 543}-${d.slice(5)}`;
  const [y, m] = from.split('-');
  const monthEnd = new Date(Date.UTC(+y, +m, 0)).toISOString().slice(0, 10);
  const name = from === to ? `DailyLab_${be(from)}`
    : from === `${y}-${m}-01` && to === monthEnd ? `${m}DailyLab_${MONTH_ABBR[+m - 1]}${String((+y + 543) % 100).padStart(2, '0')}`
    : `DailyLab_${be(from)}_${be(to)}`;

  // dosage=1 (from /record "Operation daily report generator"): Daily Dosage cells
  // from the Daily Report the user just queried (server cache) — per date
  const extraCells = {};
  if (req.query.dosage === '1') {
    const { getCachedReport } = require('./dailyReport');
    const { dailyLabDosageCells } = require('../services/dailyReport');
    for (const d of dates) {
      const cells = dailyLabDosageCells(getCachedReport(d));
      if (Object.keys(cells).length) extraCells[d] = cells;
    }
  }

  try {
    const buf = await buildDailyLab(dates, records, loadRecorders(db, dates), extraCells);
    require('../services/sendFile').sendFile(res, 'xlsx', name, buf, 'dailylab');
  } catch (e) {
    console.error('[write/export]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/nodes', requireAuth, (req, res) => {
  const { date, slot } = req.query;
  if (!date || !slot) return res.status(400).json({ error: 'date and slot required' });
  const db = getDb();
  let rows = db.all(
    'SELECT param_key, trans_value FROM node_records WHERE trans_dtm = ? AND trans_time = ?',
    [date, slot]
  );

  if (slot === 'daily') {
    const nodesConfig = getNodesConfig();
    const dailyParamKeys = (nodesConfig.nodes || [])
      .flatMap(node => node.parameters || [])
      .filter(param => param.frequency === 'daily')
      .map(param => param.param_key);

    if (dailyParamKeys.length > 0) {
      const placeholders = dailyParamKeys.map(() => '?').join(', ');
      const dailyRows = db.all(
        `SELECT nr.param_key, nr.trans_value
           FROM node_records nr
           JOIN (
             SELECT param_key, MAX(recorded_at) AS latest_recorded_at
             FROM node_records
             WHERE trans_dtm = ?
               AND param_key IN (${placeholders})
             GROUP BY param_key
           ) latest
             ON latest.param_key = nr.param_key
            AND latest.latest_recorded_at = nr.recorded_at
          WHERE nr.trans_dtm = ?`,
        [date, ...dailyParamKeys, date]
      );

      const byKey = new Map(rows.map(row => [row.param_key, row]));
      for (const row of dailyRows) byKey.set(row.param_key, row);
      rows = Array.from(byKey.values());
    }
  }

  const values = {};
  for (const r of rows) values[normalizeParamKey(r.param_key)] = r.trans_value;

  if (slot === 'daily') {
    const legacyJarRows = db.all(
      `SELECT param_key, trans_time, trans_value
         FROM node_records
        WHERE trans_dtm = ?
          AND param_key LIKE 'JarTest.%'
          AND trans_time <> 'daily'
        ORDER BY recorded_at ASC, id ASC`,
      [date]
    );
    applyJarTestLegacyReadCompat(values, legacyJarRows);
  }

  res.json({ date, slot, values });
});

// Write records to AquaDAT via GraphQL
router.post('/', requireAuth, async (req, res) => {
  const token = req.cookies.aquadat_token;
  const { records } = req.body;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array required' });
  }
  try {
    const result = await writeData(token, records);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

function serverTimeShiftRange() {
  const h = new Date().getHours();  // local server time
  if (h >= 0  && h < 8)  return '00-08';
  if (h >= 8  && h < 16) return '08-16';
  return '16-24';
}

// Write node-based records: save to local DB + forward to AquaDAT for params that have configparam_id
router.post('/nodes', requireAuth, async (req, res) => {
  const token = req.cookies.aquadat_token;
  rememberToken(token);   // ให้ queueWorker มี token จริงไว้ retry aquadat_queue
  const { records, plant_id, recorder_name } = req.body;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array required' });
  }

  const paramMap = getParamMap();
  const db = getDb();
  const derivedRecords = buildDerivedJarTestRecords(records);
  const mergedMap = new Map();
  for (const r of records) {
    mergedMap.set(`${normalizeParamKey(r.param_key)}|${r.trans_dtm}|${r.trans_time}`, { ...r, param_key: normalizeParamKey(r.param_key) });
  }
  for (const r of derivedRecords) {
    mergedMap.set(`${normalizeParamKey(r.param_key)}|${r.trans_dtm}|${r.trans_time}`, { ...r, param_key: normalizeParamKey(r.param_key) });
  }
  const finalRecords = Array.from(mergedMap.values());

  // Save all records locally
  const now = nowTH();
  for (const r of finalRecords) {
    db.run(
      `INSERT OR REPLACE INTO node_records
        (param_key, trans_dtm, trans_time, trans_value, recorded_at)
       VALUES (?, ?, ?, ?, ?)`,
      [r.param_key, r.trans_dtm, r.trans_time, r.trans_value, now]
    );
  }
  persist();

  // Forward to AquaDAT only records that have configparam_id
  const aquadatRecords = finalRecords
    .filter(r => paramMap[r.param_key]?.configparam_id)
    .map(r => ({
      trans_type: 'RWS',
      configparam_id: paramMap[r.param_key].configparam_id,
      plant_id: plant_id || 2,
      trans_dtm: r.trans_dtm,
      trans_time: r.trans_time,
      trans_value: r.trans_value,
    }));

  let aquadatResult = null;
  let aquadatError = null;
  if (aquadatRecords.length > 0) {
    try {
      aquadatResult = await writeData(token, aquadatRecords);
    } catch (err) {
      aquadatError = err.message;
      console.error('[write/nodes] AquaDAT write failed:', err.message);
      const transDtm = finalRecords[0]?.trans_dtm ?? '';
      const newTransTime = aquadatRecords[0]?.trans_time;
      const newCfgIds = new Set(aquadatRecords.map(r => r.configparam_id));
      // Remove stale queue rows for the exact same (date, slot, overlapping params)
      // Must match trans_time from payload — not just trans_dtm — to avoid cross-slot data loss
      const existingRows = db.all(
        `SELECT id, payload FROM aquadat_queue WHERE trans_dtm = ? AND status IN ('pending','dead')`,
        [transDtm]
      );
      for (const row of existingRows) {
        try {
          const p = JSON.parse(row.payload);
          const sameSlot = p[0]?.trans_time === newTransTime;
          const overlaps = p.some(r => newCfgIds.has(r.configparam_id));
          if (sameSlot && overlaps) db.run(`DELETE FROM aquadat_queue WHERE id = ?`, [row.id]);
        } catch {}
      }
      db.run(
        `INSERT INTO aquadat_queue (created_at, trans_dtm, payload, status) VALUES (?, ?, ?, 'pending')`,
        [now, transDtm, JSON.stringify(aquadatRecords)]
      );
      persist();
    }
  }

  // Save recorder per shift (shift determined by server clock at time of submission)
  if (recorder_name) {
    const shift = serverTimeShiftRange();
    const wlEntry = db.get('SELECT position_label FROM car_whitelist WHERE name = ? LIMIT 1', [recorder_name]);
    const posLabel = wlEntry?.position_label || null;
    const transDate = finalRecords[0]?.trans_dtm;
    if (transDate) {
      db.run(
        `INSERT OR REPLACE INTO slot_recorders (trans_dtm, shift_range, recorder_name, position_label, recorded_at)
         VALUES (?, ?, ?, ?, ?)`,
        [transDate, shift, recorder_name, posLabel, now]
      );
      persist();
    }
  }

  // Gather all recorder info for affected dates
  const recordersByDate = loadRecorders(db, [...new Set(finalRecords.map(r => r.trans_dtm))]);

  let excelResult = null;
  let excelError = null;
  try {
    excelResult = await writeToExcel(finalRecords, recordersByDate);
  } catch (err) {
    excelError = err.message;
    console.error('[write/nodes] Excel write failed:', err.message);
    const transDtmExcel = finalRecords[0]?.trans_dtm ?? '';
    db.run(
      `INSERT INTO excel_queue (created_at, trans_dtm, payload, status) VALUES (?, ?, ?, 'pending')`,
      [now, transDtmExcel, JSON.stringify({ records: finalRecords, recordersByDate })]
    );
    persist();
  }

  res.json({
    ok: true,
    saved: finalRecords.length,
    derived: derivedRecords.length,
    aquadat: aquadatRecords.length,
    aquadatResult,
    excelResult,
    warnings: {
      aquadat: aquadatError ?? null,
      excel: excelError ?? null,
    },
  });
});

// GET /api/write/queue — list pending/dead AquaDAT queue items
router.get('/queue', requireAuth, (req, res) => {
  const db = getDb();
  const items = db.all(
    `SELECT id, created_at, trans_dtm, attempts, last_error, status,
            'retry_' || trans_dtm || '_' || id AS script_name
       FROM aquadat_queue
      WHERE status IN ('pending', 'dead')
      ORDER BY created_at ASC`
  );
  const excelCount = db.get(`SELECT COUNT(*) AS n FROM excel_queue WHERE status IN ('pending', 'dead')`)?.n ?? 0;
  const excelLast = db.get(
    `SELECT last_error FROM excel_queue WHERE status IN ('pending', 'dead') AND last_error IS NOT NULL ORDER BY id DESC LIMIT 1`
  );
  res.json({ items, count: items.length, excel_count: excelCount, excel_last_error: excelLast?.last_error ?? null });
});

// POST /api/write/queue/retry-excel — ปุ่ม retry ใน popup: ลองเขียน excel_queue ทันที แล้วบอกว่ายังค้างอยู่ไหม
router.post('/queue/retry-excel', requireAuth, async (req, res) => {
  const result = await processExcelQueue({ statuses: ['pending', 'dead'] });
  const db = getDb();
  const remaining = db.get(`SELECT COUNT(*) AS n FROM excel_queue WHERE status IN ('pending', 'dead')`)?.n ?? 0;
  const last = db.get(
    `SELECT last_error FROM excel_queue WHERE status IN ('pending', 'dead') AND last_error IS NOT NULL ORDER BY id DESC LIMIT 1`
  );
  res.json({ ok: remaining === 0, ...result, remaining, last_error: last?.last_error ?? null });
});

// POST /api/write/queue/retry — retry all pending/dead items (AquaDAT ด้วย token ผู้ใช้ปัจจุบัน + Excel)
router.post('/queue/retry', requireAuth, async (req, res) => {
  const token = req.cookies.aquadat_token;
  rememberToken(token);
  const statuses = ['pending', 'dead'];
  const aquadat = token.endsWith('.bypass')
    ? { skipped: true, succeeded: 0, failed: 0 }
    : await processAquadatQueue(token, { statuses });
  const excel = await processExcelQueue({ statuses });
  res.json({
    ok: true,
    succeeded: aquadat.succeeded + excel.succeeded,
    failed: aquadat.failed + excel.failed,
    aquadat,
    excel,
  });
});

module.exports = router;
