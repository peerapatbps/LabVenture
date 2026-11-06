const express = require('express');
const router = express.Router();
const { readData } = require('../services/aquadat');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../services/db');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'params.json');
const NODES_PATH  = path.join(__dirname, '..', 'config', 'nodes.json');
const AQUADAT_CONFIGS_PATH = path.join(__dirname, '..', 'config', 'aquadat_configs.json');

function requireAuth(req, res, next) {
  if (!req.cookies?.aquadat_token) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// Thai time (UTC+7) date string: YYYY-MM-DD
function thaiDateStr(date = new Date()) {
  const thai = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().split('T')[0];
}

// Thai time ISO string for storing timestamps
function thaiNow() {
  const now = new Date();
  const thai = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().replace('Z', '+07:00');
}

// Convert AquaDAT even-hour time → app odd-hour slot
// AquaDAT records at end of interval: "02:00" = end of 00:00-02:00 → app slot "01:00"
// Formula: HH (even) → (HH-1):00 | "24:00" → "23:00" | non-HH:00 → pass through
function normalizeAquadatTime(t) {
  if (!t || t === 'daily') return t || 'daily';
  const m = t.match(/^(\d{2}):00$/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  if (h % 2 !== 0) return t; // already odd, leave as-is
  const odd = h === 0 ? 23 : h - 1;
  return `${String(odd).padStart(2, '0')}:00`;
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

const LEGACY_CONFIG_TIME_OVERRIDES = {
  '984': { '05:00': 'JarTest.Alum.RW_ref_Temp' },
  '986': { '05:00': 'JarTest.Alum.RW_ref_Turb', '09:00': 'JarTest.PACl.RW_ref_turb' },
  '987': { '05:00': 'JarTest.Alum.RW_ref_pH', '09:00': 'JarTest.PACl.RW_ref_pH' },
  '988': { '05:00': 'JarTest.Alum.RW_ref_Alk', '09:00': 'JarTest.PACl.RW_ref_Alkalinity' },
  '8116': { '09:00': 'JarTest.PACl.RW_ref_Temp' },
};

function getLegacyOverrideParamKey(configId, transTime) {
  return LEGACY_CONFIG_TIME_OVERRIDES[String(configId)]?.[transTime] || null;
}

function isAcceptedDailyTime(paramKey, rowTime, fixedTime) {
  if (!rowTime) return false;
  if (fixedTime && rowTime === fixedTime) return true;
  if (paramKey?.startsWith('JarTest.Alum.')) return rowTime === '05:00';
  if (paramKey?.startsWith('JarTest.PACl.')) return rowTime === '09:00';
  return !fixedTime;
}

// Build configparam_id → param_key lookup from nodes.json
function loadNodesConfig() {
  try {
    return JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
  } catch {
    return { nodes: [] };
  }
}

function loadAquadatConfigs() {
  try {
    return JSON.parse(fs.readFileSync(AQUADAT_CONFIGS_PATH, 'utf8'));
  } catch {
    return { station: 'QWS', groups: [] };
  }
}

function buildConfigMetaMap() {
  const nodesConfig = loadNodesConfig();
  const aquadatConfigs = loadAquadatConfigs();

  const nodeMetaByParamKey = {};
  const fallbackMap = {};
  for (const node of nodesConfig.nodes) {
    for (const p of node.parameters) {
      const meta = {
        param_key: normalizeParamKey(p.param_key),
        frequency: p.frequency || null,
        fixedTime: p.fixedTime || null,
      };
      nodeMetaByParamKey[p.param_key] = meta;
      if (p.configparam_id) fallbackMap[Number(p.configparam_id)] = meta;
    }
  }

  const map = {};
  for (const group of aquadatConfigs.groups || []) {
    for (const sg of group.subgroups || []) {
      for (const param of sg.params || []) {
        const id = Number(param.configID);
        const normalizedKey = normalizeParamKey(param.key);
        map[id] = nodeMetaByParamKey[normalizedKey] || {
          param_key: normalizedKey,
          frequency: null,
          fixedTime: null,
        };
      }
    }
  }

  return { ...fallbackMap, ...map };
}

// Fetch AquaDAT data for a date → upsert into aquadat_snapshots
// For today: also fill gaps in node_records (case 3.3)
router.get('/init', requireAuth, async (req, res) => {
  const token = req.cookies.aquadat_token;
  const date = req.query.date || thaiDateStr();
  const config = getConfig();

  console.log('[init] date:', date, '| plant_id:', config.plant_id, '| station:', config.station);
  console.log('[init] token (first 20 chars):', token?.slice(0, 20));

  let aquadatData = [];
  try {
    aquadatData = await readData({
      token,
      plant_id: config.plant_id,
      stationtype_code: config.station,
      begin_dt: date,
      end_dt: date,
      format: 'json',
    });
  } catch (e) {
    console.error('[init] readData error:', e.message);
    return res.status(502).json({ error: 'AquaDAT fetch failed: ' + e.message });
  }

  console.log('[init] aquadatData type:', typeof aquadatData, '| isArray:', Array.isArray(aquadatData));
  if (Array.isArray(aquadatData)) {
    console.log('[init] raw row count:', aquadatData.length);
    if (aquadatData.length > 0) console.log('[init] first row sample:', JSON.stringify(aquadatData[0]));
  } else {
    console.log('[init] raw response (non-array):', JSON.stringify(aquadatData)?.slice(0, 300));
  }

  if (!Array.isArray(aquadatData)) return res.json({ date, count: 0, debug: { type: typeof aquadatData, value: aquadatData } });

  const configMetaMap = buildConfigMetaMap();
  console.log('[init] configMetaMap entries:', Object.keys(configMetaMap).length);

  const db = getDb();
  const now = thaiNow();
  let count = 0;
  const unmappedIds = new Set();

  for (const row of aquadatData) {
    const legacyParamKey = getLegacyOverrideParamKey(row.configparam_id, row.trans_time);
    const meta = legacyParamKey
      ? (configMetaMap[Number(row.configparam_id)] ? { ...configMetaMap[Number(row.configparam_id)], param_key: normalizeParamKey(legacyParamKey) } : { param_key: normalizeParamKey(legacyParamKey), frequency: 'daily', fixedTime: row.trans_time })
      : configMetaMap[Number(row.configparam_id)];
    if (!meta?.param_key) { unmappedIds.add(row.configparam_id); continue; }
    let time = normalizeAquadatTime(row.trans_time);
    if (meta.frequency === 'daily') {
      if (!isAcceptedDailyTime(meta.param_key, row.trans_time, meta.fixedTime)) continue;
      time = 'daily';
    }
    db.run(
      `INSERT OR REPLACE INTO aquadat_snapshots (param_key, trans_dtm, trans_time, trans_value, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
      [meta.param_key, date, time, String(row.trans_value ?? ''), now]
    );
    count++;
  }

  // Fill gaps in node_records from snapshots for any date (INSERT OR IGNORE = don't overwrite user entries)
  const snapshots = db.all(
    `SELECT param_key, trans_time, trans_value FROM aquadat_snapshots WHERE trans_dtm = ?`,
    [date]
  );
  for (const snap of snapshots) {
    db.run(
      `INSERT OR IGNORE INTO node_records (param_key, trans_dtm, trans_time, trans_value, recorded_at)
       VALUES (?, ?, ?, ?, ?)`,
      [snap.param_key, date, snap.trans_time, snap.trans_value, now]
    );
  }

  const unmappedSample = [...unmappedIds].slice(0, 20);
  console.log('[init] mapped:', count, '| unmapped IDs (sample):', unmappedSample);
  res.json({
    date, count,
    debug: {
      rawRows: aquadatData.length,
      mapped: count,
      unmapped: unmappedIds.size,
      unmappedIdsSample: unmappedSample,
      sampleRow: aquadatData[0] ?? null,
    }
  });
});

// Return snapshot map for a given date: { "param_key|time": value }
router.get('/snapshots', requireAuth, (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date required' });
  const db = getDb();
  const rows = db.all(
    `SELECT param_key, trans_time, trans_value FROM aquadat_snapshots WHERE trans_dtm = ?`,
    [date]
  );
  const map = {};
  for (const r of rows) map[`${r.param_key}|${r.trans_time}`] = r.trans_value;
  res.json(map);
});

function getConfig() {
  try {
    const paramsCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const aquadatCfg = loadAquadatConfigs();
    return {
      ...paramsCfg,
      station: aquadatCfg.station || paramsCfg.station || 'QWS',
    };
  } catch {
    const aquadatCfg = loadAquadatConfigs();
    return { plant_id: 2, station: aquadatCfg.station || 'QWS', parameters: [] };
  }
}

// Expected time slots for a given frequency (app odd-hour convention)
function getExpectedSlots(frequency) {
  if (frequency === '2h')   return ['01:00','03:00','05:00','07:00','09:00','11:00','13:00','15:00','17:00','19:00','21:00','23:00'];
  if (frequency === '4h')   return ['01:00','05:00','09:00','13:00','17:00','21:00'];
  if (frequency === '12h')  return ['09:00','21:00'];
  if (frequency === 'daily') return ['daily'];
  if (frequency === 'weekly') return ['weekly'];
  return [];
}

// Compute completion for today
router.get('/today', async (req, res) => {
  const token = req.cookies?.aquadat_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const config = getConfig();
  const today = thaiDateStr();

  let onlineData = [];
  try {
    onlineData = await readData({
      token,
      plant_id: config.plant_id,
      stationtype_code: config.station,
      begin_dt: today,
      end_dt: today,
      format: 'json',
    });
  } catch (e) {
    // Don't fail — return partial result
    console.warn('[progress] AquaDAT fetch failed:', e.message);
  }

  const recordedSet = new Set(
    (Array.isArray(onlineData) ? onlineData : []).map(r => `${r.configparam_id}|${normalizeAquadatTime(r.trans_time)}`)
  );

  const summary = config.parameters.map(p => {
    const slots = getExpectedSlots(p.frequency, today);
    const upToNow = slots.filter(slot => {
      if (slot === 'daily') return true;
      const [h, m] = slot.split(':').map(Number);
      const slotMinutes = h * 60 + m;
      const _thaiNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const nowMinutes = _thaiNow.getUTCHours() * 60 + _thaiNow.getUTCMinutes();
      return slotMinutes <= nowMinutes;
    });

    const recorded = upToNow.filter(slot =>
      slot === 'daily'
        ? recordedSet.has(`${p.online_configparam_id ?? p.configparam_id}|daily`)
        : recordedSet.has(`${p.online_configparam_id ?? p.configparam_id}|${slot}`)
    );

    return {
      configparam_id: p.configparam_id,
      label: p.label,
      unit: p.unit,
      frequency: p.frequency,
      expected: upToNow.length,
      recorded: recorded.length,
      slots: upToNow.map(slot => ({
        slot,
        done: slot === 'daily'
          ? recordedSet.has(`${p.online_configparam_id ?? p.configparam_id}|daily`)
          : recordedSet.has(`${p.online_configparam_id ?? p.configparam_id}|${slot}`),
      })),
    };
  });

  const totalExpected = summary.reduce((s, p) => s + p.expected, 0);
  const totalRecorded = summary.reduce((s, p) => s + p.recorded, 0);

  res.json({
    date: today,
    totalExpected,
    totalRecorded,
    pct: totalExpected ? Math.round((totalRecorded / totalExpected) * 100) : 0,
    parameters: summary,
  });
});

// Node-based progress: reads node_records (local SQLite) + nodes.json
router.get('/nodes-today', (req, res) => {
  if (!req.cookies?.aquadat_token) return res.status(401).json({ error: 'Not authenticated' });

  const today = req.query.date || thaiDateStr();
  const thaiNowDate = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const nowMinutes = today === thaiDateStr()
    ? thaiNowDate.getUTCHours() * 60 + thaiNowDate.getUTCMinutes()
    : 24 * 60; // past date → all slots are due

  // Load snapshot map for this date
  const db0 = getDb();
  const snapRows = db0.all(
    `SELECT param_key, trans_time, trans_value FROM aquadat_snapshots WHERE trans_dtm = ?`,
    [today]
  );
  const snapshotMap = {};
  for (const r of snapRows) snapshotMap[`${r.param_key}|${r.trans_time}`] = r.trans_value;

  // Load node record values for this date
  const nodeValueRows = db0.all(
    `SELECT param_key, trans_time, trans_value FROM node_records WHERE trans_dtm = ?`,
    [today]
  );
  const nodeValueMap = {};
  for (const r of nodeValueRows) nodeValueMap[`${r.param_key}|${r.trans_time}`] = r.trans_value;

  const SLOTS_2H  = ['01:00','03:00','05:00','07:00','09:00','11:00','13:00','15:00','17:00','19:00','21:00','23:00'];
  const SLOTS_4H  = ['01:00','05:00','09:00','13:00','17:00','21:00'];
  const SLOTS_12H = ['09:00','21:00'];

  function slotMinutes(s) { const [h] = s.split(':').map(Number); return h * 60; }

  // Return ALL slots for the full day, each with a `due` flag
  // param รายวันที่ตั้ง inSlot (OC ของ CW/FW) นับเป็นรอบ fixedTime — ส่ง fixedTime มาเฉพาะตัวที่มี inSlot
  function getAllSlots(frequency, fixedTime) {
    if (frequency === 'daily' && SLOTS_2H.includes(fixedTime)) return [{ slot: fixedTime, due: slotMinutes(fixedTime) <= nowMinutes }];
    if (frequency === 'daily') return [{ slot: 'daily', due: true }];
    if (frequency === 'weekly') return [{ slot: 'weekly', due: true }];
    let all;
    if (frequency === '2h')  all = SLOTS_2H;
    else if (frequency === '4h')  all = SLOTS_4H;
    else if (frequency === '12h') all = SLOTS_12H;
    else return [];
    return all.map(s => ({ slot: s, due: slotMinutes(s) <= nowMinutes }));
  }

  let nodesConfig;
  try { nodesConfig = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8')); }
  catch { return res.status(500).json({ error: 'nodes.json not found' }); }

  const db = getDb();
  const rows = db.all(`SELECT param_key, trans_time FROM node_records WHERE trans_dtm = ?`, [today]);
  const recordedSet = new Set(rows.map(r => `${r.param_key}|${r.trans_time}`));
  // For daily params: any trans_time on this date counts as recorded
  const anyTimeRecordedKeys = new Set(rows.map(r => r.param_key));

  const nodes = nodesConfig.nodes
    .slice().sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(node => {
      const params = node.parameters.map(p => {
        const allSlots = getAllSlots(p.frequency, p.inSlot ? p.fixedTime : null);
        const dueSlots = allSlots.filter(s => s.due);
        const recordedCount = dueSlots.filter(s => {
          if (s.slot === 'daily') return recordedSet.has(`${p.param_key}|daily`) || anyTimeRecordedKeys.has(p.param_key);
          return recordedSet.has(`${p.param_key}|${s.slot}`);
        }).length;
        const skipProgress = !!p.skip_progress;
        return {
          param_key: p.param_key,
          label: p.label,
          unit: p.unit || '',
          frequency: p.frequency,
          subgroup: p.subgroup || null,
          skip_progress: skipProgress,
          expected: skipProgress ? 0 : dueSlots.length,
          recorded: skipProgress ? 0 : recordedCount,
          slots: allSlots.map(s => {
            const key = `${p.param_key}|${s.slot}`;
            const done = s.slot === 'daily'
              ? (recordedSet.has(key) || anyTimeRecordedKeys.has(p.param_key))
              : recordedSet.has(key);
            const snapshot = snapshotMap[key] ?? null;
            const nodeValue = nodeValueMap[key] ?? null;
            const modified = done && snapshot !== null && nodeValue !== null && nodeValue !== snapshot;
            return { slot: s.slot, due: s.due, done, snapshot, nodeValue, modified };
          }),
        };
      });
      const totalExpected = params.reduce((s, p) => s + p.expected, 0);
      const totalRecorded = params.reduce((s, p) => s + p.recorded, 0);
      return { id: node.id, label: node.label, sort: node.sort, params, totalExpected, totalRecorded };
    });

  const totalExpected = nodes.reduce((s, n) => s + n.totalExpected, 0);
  const totalRecorded = nodes.reduce((s, n) => s + n.totalRecorded, 0);

  res.json({ date: today, totalExpected, totalRecorded, nodes });
});

// GET /api/progress/trend?date=YYYY-MM-DD&param_keys=A,B,C,D
// Returns last 6 values per param_key up to current Thai time.
// Source priority: node_records overrides aquadat_snapshots (user edits win).
router.get('/trend', (req, res) => {
  if (!req.cookies?.aquadat_token) return res.status(401).json({ error: 'Not authenticated' });
  const date = req.query.date || thaiDateStr();
  const paramKeys = (req.query.param_keys || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!paramKeys.length) return res.status(400).json({ error: 'param_keys required' });

  const SLOTS = ['01:00','03:00','05:00','07:00','09:00','11:00','13:00','15:00','17:00','19:00','21:00','23:00'];

  // For today: only include slots up to current Thai time.
  // For past dates: all slots are eligible.
  const todayStr = thaiDateStr();
  const thaiNowDate = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const nowMinutes = thaiNowDate.getUTCHours() * 60 + thaiNowDate.getUTCMinutes();

  function slotMinutes(s) {
    const [h] = s.split(':').map(Number);
    return h * 60;
  }

  function eligibleSlots(d) {
    if (d !== todayStr) return SLOTS; // past date — all slots
    return SLOTS.filter(s => slotMinutes(s) <= nowMinutes);
  }

  // Look back up to 3 days to ensure we always find 6 values
  const dates = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(new Date(date + 'T00:00:00').getTime() - i * 86400000);
    dates.push(d.toISOString().split('T')[0]);
  }

  const db = getDb();

  const result = {};
  for (const pk of paramKeys) {
    // Load aquadat_snapshots (base layer)
    const snapRows = db.all(
      `SELECT trans_dtm, trans_time, trans_value FROM aquadat_snapshots
       WHERE param_key = ? AND trans_dtm IN (${dates.map(() => '?').join(',')})
         AND trans_time != 'daily' AND trans_time != 'weekly'`,
      [pk, ...dates]
    );

    // Load node_records (override layer — user edits win)
    const recRows = db.all(
      `SELECT trans_dtm, trans_time, trans_value FROM node_records
       WHERE param_key = ? AND trans_dtm IN (${dates.map(() => '?').join(',')})
         AND trans_time != 'daily' AND trans_time != 'weekly'`,
      [pk, ...dates]
    );

    // Merge: start with snapshots, then let node_records override
    const byKey = {};
    for (const r of snapRows) {
      const v = parseFloat(r.trans_value);
      if (!isNaN(v)) byKey[`${r.trans_dtm}|${r.trans_time}`] = v;
    }
    for (const r of recRows) {
      const v = parseFloat(r.trans_value);
      if (!isNaN(v)) byKey[`${r.trans_dtm}|${r.trans_time}`] = v;
    }

    // Build chronological series over eligible slots only
    const series = [];
    for (const d of dates) {
      for (const s of eligibleSlots(d)) {
        const v = byKey[`${d}|${s}`];
        if (v !== undefined) {
          const isToday = d === date;
          series.push({ slot: isToday ? s : `${d.slice(5)} ${s}`, value: v });
        }
      }
    }

    // Return last 6 values
    result[pk] = series.slice(-6);
  }
  res.json(result);
});

module.exports = router;
