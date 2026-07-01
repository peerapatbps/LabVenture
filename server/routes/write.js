const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { writeData } = require('../services/aquadat');
const { getDb, persist } = require('../services/db');
const { writeToExcel } = require('../services/excelWriter');

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

// Write node-based records: save to local DB + forward to AquaDAT for params that have configparam_id
router.post('/nodes', requireAuth, async (req, res) => {
  const token = req.cookies.aquadat_token;
  const { records, plant_id } = req.body;
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
  const now = new Date().toISOString();
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
  if (aquadatRecords.length > 0) {
    try {
      aquadatResult = await writeData(token, aquadatRecords);
    } catch (err) {
      console.error('[write/nodes] AquaDAT write failed:', err.message);
    }
  }

  let excelResult = null;
  try {
    excelResult = await writeToExcel(finalRecords);
  } catch (err) {
    console.error('[write/nodes] Excel write failed:', err.message);
  }

  res.json({ ok: true, saved: finalRecords.length, derived: derivedRecords.length, aquadat: aquadatRecords.length, aquadatResult, excel: excelResult });
});

module.exports = router;
