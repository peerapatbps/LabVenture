const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const { getDb, nowTH } = require('../services/db');
const { writeData, graphqlLogin } = require('../services/aquadat');
const fetch = require('node-fetch');

const AQUADAT_PATTERNS = require('../config/aquadat_patterns.json');
const GRAPHQL_URL = process.env.AQUADAT_GRAPHQL_URL || 'https://aquadat.mwa.co.th/graphql';
const { getStage } = require('../services/stageMonitor');

const BELLBEAST_HOST = process.env.BELLBEAST_HOST || 'localhost';
const BELLBEAST_PORT = parseInt(process.env.BELLBEAST_PORT || '443', 10);

function forwardToUroboros(records, stationId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ station_id: stationId, records });
    const options = {
      hostname: BELLBEAST_HOST,
      port: BELLBEAST_PORT,
      path: '/api/operator/record',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve({ ok: false, error: 'bad response' }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function fetchUroborosHistory(configIds) {
  return new Promise((resolve) => {
    if (!configIds || configIds.length === 0) { resolve([]); return; }
    const qs = `?configIDs=${configIds.join(',')}`;
    const options = {
      hostname: BELLBEAST_HOST,
      port: BELLBEAST_PORT,
      path: `/api/operator/data${qs}`,
      method: 'GET',
      timeout: 8000,
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

const NODES_PATH = path.join(__dirname, '..', 'config', 'operator_nodes.json');
const LAYOUTS_DIR = path.join(__dirname, '..', 'config', 'user_layouts');

router.get('/nodes', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to load operator nodes config' });
  }
});

// Operator anomaly todos — stub
router.get('/todos', (req, res) => {
  res.json({ todos: [] });
});

// Fetch history from Aquadat GraphQL for stage-1 operation
// Returns { [configparam_id]: { [slot]: value_string } }
//
// Aquadat response structure (confirmed from live API):
//   get_transaction_datavalues_pattern returns 1 row per pattern where:
//   - var_data = JSON string of flat array; each element is either:
//       { bgColor: "time_series", value: "HH:mm" }  (time column — skip)
//       { _id: <configparam_id>, _time: "HH:mm", value: "<val>", ... }  (data cell)
// Fetch one pattern_id from Aquadat and merge into out map
async function fetchOnePattern(topic, pattern_id, date, dayshift_id, token, out) {
  const query = `{\n  get_transaction_datavalues_pattern(\n    pattern_id: ${pattern_id}\n    trans_dtm: "${date}"\n    dayshift_id: ${dayshift_id}\n    dtl_flag: false\n  ) {\n    var_data\n    __typename\n  }\n}\n`;
  const r = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ variables: {}, query }),
    timeout: 20000,
  });
  const data = await r.json();
  if (data.errors || !data.data) {
    console.warn(`[history/aquadat] ${topic} pattern ${pattern_id} error:`, data.errors?.[0]?.message);
    return;
  }
  const dataRows = data.data.get_transaction_datavalues_pattern ?? [];
  let count = 0;
  for (const row of dataRows) {
    let outerArr;
    // var_data from Aquadat is array elements without surrounding [] — wrap before parsing
    try { outerArr = JSON.parse('[' + row.var_data + ']'); } catch { continue; }
    if (!Array.isArray(outerArr)) continue;
    for (const slotArr of outerArr) {
      const items = Array.isArray(slotArr) ? slotArr : [slotArr];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (item.bgColor === 'time_series' || !item._id || !item._time) continue;
        const val = item.value;
        if (val == null || val === '') continue;
        if (typeof val === 'string' && val.startsWith('=')) continue;
        const cid = String(item._id);
        if (!out[cid]) out[cid] = {};
        out[cid][item._time] = String(val);
        count++;
      }
    }
  }
  console.log(`[history/aquadat] ${topic} pattern ${pattern_id}: ${count} values`);
}

async function fetchAquadatHistory(station_id, topic_filter, date, token) {
  const allPatterns = AQUADAT_PATTERNS.stations[station_id];
  if (!allPatterns || !token) return {};

  // If a specific topic is requested, fetch only that one; otherwise fetch all sequentially
  const patterns = topic_filter
    ? allPatterns.filter(p => p.topic === topic_filter)
    : allPatterns;
  if (!patterns.length) return {};

  const thHour = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
  const dayshift_id = thHour < 8 ? 1 : thHour < 16 ? 2 : 3;

  const out = {};
  // Sequential to avoid overwhelming Aquadat with concurrent requests
  for (const { topic, pattern_id } of patterns) {
    try {
      await fetchOnePattern(topic, pattern_id, date, dayshift_id, token, out);
    } catch (e) {
      console.warn(`[history/aquadat] ${station_id}/${topic} pattern ${pattern_id} failed:`, e.message);
    }
  }
  return out;
}

// Recorded history for a station+topic
// Stage 1: Query: ?station_id=RWS1&date=2026-07-06[&topic=Flow]  (date required for Aquadat)
// Stage 0/2: Query: ?station_id=RWS1&topic=Flow  (no date — Uroboros only has today)
// Returns: { [configparam_id]: { [slot]: value_string } }
router.get('/history', async (req, res) => {
  const { station_id, date, topic } = req.query;
  if (!station_id) return res.json({});

  const stage = getStage();

  if (stage === 1) {
    if (!date) return res.json({});
    const token = req.cookies?.aquadat_token;
    if (!token) return res.json({});
    try {
      const out = await fetchAquadatHistory(station_id, topic || null, date, token);
      return res.json(out);
    } catch (e) {
      console.error('[history] aquadat fetch error:', e.message);
      return res.json({});
    }
  }

  // Stage 0/2: resolve configIDs from operator_nodes.json for this station+topic
  let nodes;
  try { nodes = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8')); } catch { return res.json({}); }
  const stationDef = nodes.stations?.find(s => (s.station_id ?? s.id) === station_id);
  if (!stationDef) return res.json({});

  const topicDef = topic ? stationDef.topics?.find(t => t.topic === topic) : null;
  const params = topicDef ? topicDef.params : stationDef.topics?.flatMap(t => t.params ?? []) ?? [];
  const configIds = params.map(p => p.configparam_id).filter(Boolean);
  if (configIds.length === 0) return res.json({});

  const rows = await fetchUroborosHistory(configIds);
  if (!Array.isArray(rows)) return res.json({});
  const out = {};
  for (const r of rows) {
    const cid = String(r.configID ?? r.configparam_id ?? '');
    const slot = (r.ts ?? '').slice(11, 16); // "HH:mm"
    const val  = r.value_text ?? (r.value != null ? String(r.value) : '');
    if (!cid || !slot) continue;
    if (!out[cid]) out[cid] = {};
    out[cid][slot] = val;
  }
  res.json(out);
});

router.get('/stage', (req, res) => {
  res.json({ stage: getStage() });
});

// Layout persistence per user+station
// GET /layout?user_id=<id>&station_id=<id>
router.get('/layout', (req, res) => {
  const { user_id, station_id } = req.query;
  if (!user_id || !station_id) return res.json({ layout: null });
  const safe = String(user_id).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const file = path.join(LAYOUTS_DIR, `${safe}.json`);
  try {
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({ layout: all[station_id] ?? null });
  } catch {
    res.json({ layout: null });
  }
});

// POST /layout  body: { user_id, station_id, layout }
router.post('/layout', (req, res) => {
  const { user_id, station_id, layout } = req.body;
  if (!user_id || !station_id || !layout) return res.status(400).json({ error: 'user_id, station_id, layout required' });
  const safe = String(user_id).replace(/[^a-zA-Z0-9_.-]/g, '_');
  fs.mkdirSync(LAYOUTS_DIR, { recursive: true });
  const file = path.join(LAYOUTS_DIR, `${safe}.json`);
  let all = {};
  try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  all[station_id] = layout;
  fs.writeFileSync(file, JSON.stringify(all), 'utf8');
  res.json({ ok: true });
});

// Widget placements — GET all for user+station
router.get('/widgets', (req, res) => {
  const { login_id, station_id } = req.query;
  if (!login_id || !station_id) return res.json({ widgets: [] });
  try {
    const db = getDb();
    const rows = db.all(
      'SELECT * FROM op_widget_placements WHERE login_id = ? AND station_id = ? ORDER BY id',
      [login_id, station_id]
    );
    res.json({ widgets: rows.map(r => ({ ...r, config: JSON.parse(r.config || '{}') })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Widget placements — POST create
router.post('/widgets', (req, res) => {
  const { login_id, station_id, widget_type, x = 0, y = 0, w = 2, h = 2, config = {} } = req.body;
  if (!login_id || !station_id || !widget_type) return res.status(400).json({ error: 'login_id, station_id, widget_type required' });
  try {
    const db = getDb();
    const stmt = db.run(
      'INSERT INTO op_widget_placements (login_id, station_id, widget_type, x, y, w, h, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [login_id, station_id, widget_type, x, y, w, h, JSON.stringify(config)]
    );
    const row = db.get('SELECT * FROM op_widget_placements WHERE id = ?', [stmt.lastInsertRowid]);
    res.json({ ok: true, widget: { ...row, config } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Widget placements — PUT update position/size/config
router.put('/widgets/:id', (req, res) => {
  const { id } = req.params;
  const { x, y, w, h, config } = req.body;
  try {
    const db = getDb();
    const fields = [];
    const vals = [];
    if (x !== undefined) { fields.push('x = ?'); vals.push(x); }
    if (y !== undefined) { fields.push('y = ?'); vals.push(y); }
    if (w !== undefined) { fields.push('w = ?'); vals.push(w); }
    if (h !== undefined) { fields.push('h = ?'); vals.push(h); }
    if (config !== undefined) { fields.push('config = ?'); vals.push(JSON.stringify(config)); }
    if (fields.length === 0) return res.json({ ok: true });
    fields.push('updated_at = ?'); vals.push(nowTH());
    vals.push(id);
    db.run(`UPDATE op_widget_placements SET ${fields.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Widget placements — DELETE
router.delete('/widgets/:id', (req, res) => {
  try {
    const db = getDb();
    db.run('DELETE FROM op_widget_placements WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Record operator data — stage-aware routing
// Stage 1: write to Aquadat directly
// Stage 0: forward to Uroboros via BellBeast proxy
// Stage 2: reject with 503
router.post('/record', async (req, res) => {
  const { records, station_id } = req.body;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array required' });
  }

  const stage = getStage();

  if (stage === 2) {
    return res.status(503).json({
      error: 'ระบบกำลัง sync ข้อมูลกับ Aquadat กรุณารอสักครู่',
      stage,
    });
  }

  if (stage === 0) {
    try {
      const result = await forwardToUroboros(records, station_id);
      return res.json({ ...result, stage, routed_to: 'uroboros' });
    } catch (err) {
      console.error('[operator/record] forward to uroboros failed:', err.message);
      return res.status(502).json({ error: 'ไม่สามารถบันทึกข้อมูล offline ได้', detail: err.message });
    }
  }

  // Stage 1: write to Aquadat
  try {
    const token = req.cookies?.aquadat_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    await writeData(token, records);
    return res.json({ ok: true, saved: records.length, station_id, stage, routed_to: 'aquadat' });
  } catch (err) {
    console.error('[operator/record] aquadat write failed:', err.message);
    return res.status(502).json({ error: err.message });
  }
});

// GET /api/operator/aquadat-read?station=RWS1&trans_date=2026-07-11&dayshift_id=2
// Fetches data from Aquadat GraphQL for all topics of a station (stage 1 only)
router.get('/aquadat-read', async (req, res) => {
  const { station, trans_date, dayshift_id } = req.query;
  if (!station || !trans_date || !dayshift_id)
    return res.status(400).json({ error: 'station, trans_date, dayshift_id required' });

  const token = req.cookies?.aquadat_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const topicPatterns = AQUADAT_PATTERNS.stations[station];
  if (!topicPatterns) return res.json({ topics: {} });

  const results = {};
  await Promise.all(topicPatterns.map(async ({ topic, pattern_id }) => {
    const query = `{\n  get_transaction_header_pattern(\n    pattern_id: ${pattern_id}\n    trans_date: "${trans_date}"\n    dayshift_id: ${dayshift_id}\n  ) {\n    nestedheaders\n    columns\n    __typename\n  }\n  get_transaction_datavalues_pattern(\n    pattern_id: ${pattern_id}\n    trans_dtm: "${trans_date}"\n    dayshift_id: ${dayshift_id}\n    dtl_flag: false\n  ) {\n    cell\n    var_data\n    __typename\n  }\n}\n`;
    try {
      const r = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ variables: {}, query }),
        timeout: 10000,
      });
      const data = await r.json();
      if (data.errors) {
        results[topic] = { error: data.errors[0]?.message, pattern_id };
      } else {
        results[topic] = {
          pattern_id,
          headers: data.data?.get_transaction_header_pattern ?? [],
          values: data.data?.get_transaction_datavalues_pattern ?? [],
        };
      }
    } catch (e) {
      results[topic] = { error: e.message, pattern_id };
    }
  }));

  res.json({ topics: results });
});

// GET /api/operator/patterns — expose aquadat pattern config to client
router.get('/patterns', (req, res) => {
  res.json(AQUADAT_PATTERNS);
});

// POST /api/operator/graphql-proxy — forward GraphQL query to Aquadat with auth token from cookie
// Body: standard GraphQL payload { variables, query }
router.post('/graphql-proxy', async (req, res) => {
  const token = req.cookies?.aquadat_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const r = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(req.body),
      timeout: 20000,
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('[graphql-proxy] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
