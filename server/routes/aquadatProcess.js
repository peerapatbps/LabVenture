const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const CONFIGS = require('../config/aquadat_configs.json');
const { getDb, persist, nowTH } = require('../services/db');

const NODES_PATH = path.join(__dirname, '..', 'config', 'nodes.json');
const SLOTS_2H = ['01:00','03:00','05:00','07:00','09:00','11:00','13:00','15:00','17:00','19:00','21:00','23:00'];

const PROCESS_URL = 'http://172.16.198.150:443/api/process';

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
  // RW reference values — same configID recorded at 05:00 (Alum) and 09:00 (PACl)
  '984':  { '05:00': 'JarTest.Alum.RW_ref_Temp' },
  '986':  { '05:00': 'JarTest.Alum.RW_ref_Turb',  '09:00': 'JarTest.PACl.RW_ref_turb' },
  '987':  { '05:00': 'JarTest.Alum.RW_ref_pH',    '09:00': 'JarTest.PACl.RW_ref_pH' },
  '988':  { '05:00': 'JarTest.Alum.RW_ref_Alk',   '09:00': 'JarTest.PACl.RW_ref_Alkalinity' },
  '8116': { '09:00': 'JarTest.PACl.RW_ref_Temp' },
  // JarTest dose series — Alum uses 05:00, PACl reuses same configIDs at 09:00
  '954': { '09:00': 'JarTest.PACl.D1.Dose' }, '955': { '09:00': 'JarTest.PACl.D1.turb' },
  '956': { '09:00': 'JarTest.PACl.D1.pH' },   '957': { '09:00': 'JarTest.PACl.D1.alk' },
  '959': { '09:00': 'JarTest.PACl.D2.Dose' }, '960': { '09:00': 'JarTest.PACl.D2.turb' },
  '961': { '09:00': 'JarTest.PACl.D2.pH' },   '962': { '09:00': 'JarTest.PACl.D2.alk' },
  '964': { '09:00': 'JarTest.PACl.D3.Dose' }, '965': { '09:00': 'JarTest.PACl.D3.turb' },
  '966': { '09:00': 'JarTest.PACl.D3.pH' },   '967': { '09:00': 'JarTest.PACl.D3.alk' },
  '969': { '09:00': 'JarTest.PACl.D4.Dose' }, '970': { '09:00': 'JarTest.PACl.D4.turb' },
  '971': { '09:00': 'JarTest.PACl.D4.pH' },   '972': { '09:00': 'JarTest.PACl.D4.alk' },
  '974': { '09:00': 'JarTest.PACl.D5.Dose' }, '975': { '09:00': 'JarTest.PACl.D5.turb' },
  '976': { '09:00': 'JarTest.PACl.D5.pH' },   '977': { '09:00': 'JarTest.PACl.D5.alk' },
  '979': { '09:00': 'JarTest.PACl.D6.Dose' }, '980': { '09:00': 'JarTest.PACl.D6.turb' },
  '981': { '09:00': 'JarTest.PACl.D6.pH' },   '982': { '09:00': 'JarTest.PACl.D6.alk' },
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

// Build all configID entries from config file (flat list)
function getAllConfigEntries() {
  const entries = [];
  for (const group of CONFIGS.groups) {
    for (const sg of group.subgroups) {
      for (const param of sg.params) {
        entries.push({ configID: param.configID, key: param.key, label: param.label, subgroup: sg.label, group: group.label });
      }
    }
  }
  return entries;
}

// Get unique configIDs for a given group key (or all if not specified)
function getConfigIDs(groupKey) {
  const seen = new Set();
  const result = [];
  const groups = groupKey
    ? CONFIGS.groups.filter(g => g.key === groupKey)
    : CONFIGS.groups;

  for (const group of groups) {
    for (const sg of group.subgroups) {
      for (const param of sg.params) {
        if (!seen.has(param.configID)) {
          seen.add(param.configID);
          result.push({ configID: param.configID, plant: CONFIGS.plant, station: CONFIGS.station });
        }
      }
    }
  }
  return result;
}

// Parse the tab-separated CSV returned by the process API
// Row 0: Date, Time, DateTime, [configID1], [configID2], ...
// Row 1: Plant - Station info
// Row 2: Param - Equipment
// Row 3: Unit
// Row 4+: data rows
function parseCsv(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 4) return { headers: [], rows: [] };

  // Auto-detect delimiter from header row
  const SEP = lines[0].includes('\t') ? '\t' : ',';
  const headerRow = lines[0].split(SEP);
  const paramRow  = lines[2].split(SEP);
  const unitRow   = lines[3].split(SEP);

  // Build column metadata (columns 3+)
  const columns = [];
  for (let i = 3; i < headerRow.length; i++) {
    columns.push({
      configID:  headerRow[i]?.trim() || '',
      paramLabel: paramRow[i]?.trim()  || '',
      unit:       unitRow[i]?.trim()   || '',
    });
  }

  // Data rows (line 4+)
  const rows = [];
  for (let li = 4; li < lines.length; li++) {
    const cells = lines[li].split(SEP);
    const row = {
      date:     cells[0]?.trim() || '',
      time:     cells[1]?.trim() || '',
      dateTime: cells[2]?.trim() || '',
      values:   {},
    };
    for (let i = 0; i < columns.length; i++) {
      const cid = columns[i].configID;
      const raw = cells[i + 3]?.trim();
      row.values[cid] = raw === '' || raw === undefined ? null : (isNaN(raw) ? raw : parseFloat(raw));
    }
    rows.push(row);
  }

  return { columns, rows };
}

// Middleware: require auth token
function requireToken(req, res, next) {
  const token = req.cookies?.aquadat_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  req.aquadatToken = token;

  // Extract sub from JWT for user field
  try {
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    req.userSub = String(payload.sub || '');
  } catch {
    req.userSub = '';
  }
  next();
}

// POST /api/aquadat/fetch
// Body (all optional): { begin, end, group, configIDs }
router.post('/fetch', requireToken, async (req, res) => {
  const today = new Date(Date.now() + 7*60*60*1000).toISOString().split('T')[0];
  const begin = req.body.begin || today;
  const end   = req.body.end   || today;
  const groupKey = req.body.group || null;

  // Build configs array
  let configs;
  if (Array.isArray(req.body.configIDs) && req.body.configIDs.length > 0) {
    configs = req.body.configIDs.map(id => ({ configID: String(id), plant: CONFIGS.plant, station: CONFIGS.station }));
  } else {
    configs = getConfigIDs(groupKey);
  }

  if (configs.length === 0) return res.status(400).json({ error: 'No configIDs found' });

  // Build csvFilename: data_ddmmyyhhmm.csv
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const csvFilename = `data_${pad(now.getDate())}${pad(now.getMonth()+1)}${String(now.getFullYear()).slice(2)}${pad(now.getHours())}${pad(now.getMinutes())}.csv`;

  const payload = {
    begin,
    end,
    token: req.aquadatToken,
    removeOddHour: false,
    opt: '',
    csvFilename,
    configs,
    user: req.userSub,
  };

  console.log(`[aquadatProcess] POST ${PROCESS_URL} | begin=${begin} end=${end} configs=${configs.length} user=${req.userSub}`);

  try {
    const upstream = await fetch(PROCESS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 60000,
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      console.error(`[aquadatProcess] upstream error ${upstream.status}: ${errText.slice(0, 200)}`);
      return res.status(502).json({ error: `Upstream error ${upstream.status}`, detail: errText.slice(0, 200) });
    }

    const csvText = await upstream.text();
    console.log(`[aquadatProcess] received ${csvText.length} bytes`);
    console.log('--- RAW CSV (first 500 chars) ---');
    console.log(csvText.slice(0, 500));
    console.log('---------------------------------');

    const parsed = parseCsv(csvText);
    console.log(`[aquadatProcess] parsed: ${parsed.columns?.length} columns, ${parsed.rows?.length} data rows`);
    console.log('Columns:', JSON.stringify(parsed.columns, null, 2));
    if (parsed.rows?.length > 0) {
      console.log('First data row:', JSON.stringify(parsed.rows[0]));
      console.log('Last  data row:', JSON.stringify(parsed.rows[parsed.rows.length - 1]));
    }

    res.json({ ok: true, csvFilename, columns: parsed.columns, rows: parsed.rows });
  } catch (err) {
    console.error('[aquadatProcess] fetch error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Build configID → { paramKey, frequency, fixedTime } map by joining aquadat_configs + nodes.json
function buildConfigMap() {
  let nodesData = { nodes: [] };
  try { nodesData = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8')); } catch {}

  // param_key → { frequency, fixedTime } from nodes.json
  const nodeParamMeta = {};
  for (const node of nodesData.nodes) {
    for (const p of node.parameters) {
      nodeParamMeta[normalizeParamKey(p.param_key)] = { frequency: p.frequency, fixedTime: p.fixedTime || null, inSlot: !!p.inSlot };
    }
  }

  // configID → { paramKey, frequency, fixedTime } from aquadat_configs.json
  const map = {};
  for (const group of CONFIGS.groups) {
    for (const sg of group.subgroups) {
      for (const param of sg.params) {
        const normalizedKey = normalizeParamKey(param.key);
        const meta = nodeParamMeta[normalizedKey] || {};
        map[param.configID] = {
          paramKey: normalizedKey,
          frequency: meta.frequency || null,
          fixedTime: meta.fixedTime || null,
          inSlot: !!meta.inSlot,
        };
      }
    }
  }
  return map;
}

// POST /api/aquadat/sync
// Fetches data from process API and writes non-zero values to node_records
// Body (all optional): { date, group, configIDs }
router.post('/sync', requireToken, async (req, res) => {
  const date = req.body.date || new Date(Date.now() + 7*60*60*1000).toISOString().split('T')[0];
  const groupKey = req.body.group || null;

  let configs;
  if (Array.isArray(req.body.configIDs) && req.body.configIDs.length > 0) {
    configs = req.body.configIDs.map(id => ({ configID: String(id), plant: CONFIGS.plant, station: CONFIGS.station }));
  } else {
    configs = getConfigIDs(groupKey);
  }

  if (configs.length === 0) return res.status(400).json({ error: 'No configIDs found' });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const csvFilename = `data_${pad(now.getDate())}${pad(now.getMonth()+1)}${String(now.getFullYear()).slice(2)}${pad(now.getHours())}${pad(now.getMinutes())}.csv`;

  const payload = {
    begin: date,
    end: date,
    token: req.aquadatToken,
    removeOddHour: false,
    opt: '',
    csvFilename,
    configs,
    user: req.userSub,
  };

  console.log(`[aquadat/sync] date=${date} configs=${configs.length}`);

  let csvText;
  try {
    const upstream = await fetch(PROCESS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 60000,
    });
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      return res.status(502).json({ error: `Upstream ${upstream.status}`, detail: errText.slice(0, 200) });
    }
    csvText = await upstream.text();
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  const { columns, rows } = parseCsv(csvText);
  const configMap = buildConfigMap();
  const db = getDb();
  const recordedAt = nowTH();

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    // Only process rows for the target date (skip next-day 00:00 carry-over row)
    if (!row.date.startsWith(date)) continue;

    for (const col of columns) {
      const val = row.values[col.configID];
      if (val === null || val === 0) { skipped++; continue; }

      const legacyParamKey = getLegacyOverrideParamKey(col.configID, row.time);
      const meta = legacyParamKey
        ? (configMap[col.configID] ? { ...configMap[col.configID], paramKey: normalizeParamKey(legacyParamKey) } : { paramKey: normalizeParamKey(legacyParamKey), frequency: 'daily', fixedTime: row.time })
        : configMap[col.configID];
      if (!meta?.paramKey) { skipped++; continue; }

      // Determine trans_time: daily params stored as 'daily', others use the row time
      let transTime;
      if (meta.frequency === 'daily') {
        // Only mark done if value appears at or near the fixedTime
        if (!isAcceptedDailyTime(meta.paramKey, row.time, meta.fixedTime)) { skipped++; continue; }
        // inSlot (OC ของ CW/FW) → เก็บเป็นรอบ fixedTime ให้ตรงกับหน้า Record
        transTime = meta.inSlot && SLOTS_2H.includes(meta.fixedTime) ? meta.fixedTime : 'daily';
      } else {
        transTime = row.time;
      }

      db.run(
        `INSERT OR REPLACE INTO node_records (param_key, trans_dtm, trans_time, trans_value, recorded_at)
         VALUES (?, ?, ?, ?, ?)`,
        [meta.paramKey, date, transTime, String(val), recordedAt]
      );
      inserted++;
    }
  }

  persist();
  console.log(`[aquadat/sync] inserted=${inserted} skipped=${skipped}`);
  res.json({ ok: true, date, configsFetched: configs.length, inserted, skipped });
});

// GET /api/aquadat/configs — return config file for client use
router.get('/configs', (req, res) => {
  res.json(CONFIGS);
});

module.exports = router;
