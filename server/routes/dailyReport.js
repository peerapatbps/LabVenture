const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const { computeDailyReport, DR_CONFIGIDS } = require('../services/dailyReport');
const { getDb, nowTH } = require('../services/db');
const { fetchAquadatHistory, fetchAllStationsHistory, fetchDailyReportHistory, fetchOnePattern, DAILY_REPORT_ENTRIES, DAILY_REPORT_STATIONS } = require('../services/aquadatHistory');
const { getStage } = require('../services/stageMonitor');
const { readData } = require('../services/aquadat');
const { buildMhCells, overlayDbCells, writeMhReport, backwashByPhase } = require('../services/mhReport');
const { sendFile } = require('../services/sendFile');

const SETTINGS_PATH = path.join(__dirname, '..', 'config', 'app_settings.json');
const NODES_PATH    = path.join(__dirname, '..', 'config', 'operator_nodes.json');

const BELLBEAST_HOST = process.env.BELLBEAST_HOST || 'localhost';
const BELLBEAST_PORT = parseInt(process.env.BELLBEAST_PORT || '443', 10);

// Columns added to summary_table (not in the MH_report.db schema): PreparedBy / ReviewedBy
// (from the SAVE DB popup) and MhCells (JSON of the printed form's values, for PRINT EXCEL).
// Checked on each use because the DB file can be swapped at runtime.
function ensureExtraColumns(db) {
  const cols = db.all('PRAGMA table_info(summary_table)').map(c => c.name);
  for (const col of ['PreparedBy', 'ReviewedBy', 'MhCells', 'ReviewedShift', 'RecycleCfg'])
    if (!cols.includes(col)) db.run(`ALTER TABLE summary_table ADD COLUMN ${col} TEXT`);
}

// Reverse lookup: configID string → station ID (built once at module load)
const CFG_TO_STATION = {};
for (const [sid, ids] of Object.entries(DR_CONFIGIDS)) {
  for (const id of ids) CFG_TO_STATION[String(id)] = sid;
}

// Returns dayshift_id=3 for historical dates; time-based for today (Thai time).
function getDayshiftId(date) {
  const todayTH = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  if (date !== todayTH) return 3;
  const thHour = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
  return thHour < 8 ? 1 : thHour < 16 ? 2 : 3;
}

// ── AquaDAT REST (JSON) ─────────────────────────────────────────────────────
// aquaDATService/Data?format=json returns { configparam_id, trans_dtm,
// trans_time ('01:00'…'24:00'), trans_value }. A day has no 00:00 row: the
// start-of-day reading is the previous day's 24:00. So day X = 25 points:
// (X-1 24:00 → '00:00') + X 01:00…24:00. Missing values stay missing (no 0-fill).
const AQ_PLANT_ID = '2'; // MS
const SID_STATIONTYPE = {
  RWS1: 'RWS', RWS2: 'RWS', CHEM1: 'CDS', CHEM2: 'CDS', TPS: 'TPS', DPS: 'DPS',
  FWS1: 'FWS', FWS2: 'FWS', CWS1: 'CWS', CWS2: 'CWS',
};

// configID → [sid, …] (a configID belongs to the station(s) that list it)
const CFG_TO_SIDS = {};
for (const [sid, ids] of Object.entries(DR_CONFIGIDS)) {
  for (const id of ids) (CFG_TO_SIDS[String(id)] ||= []).push(sid);
}

function prevDateStr(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// rows → { [sid]: { [cid]: { [slot]: value } } } for the given stations only
function restRowsToHistoryMap(rows, date, sids) {
  const prev = prevDateStr(date);
  const want = new Set(sids);
  const map = Object.fromEntries(sids.map(s => [s, {}]));
  for (const r of rows || []) {
    const cid = String(r.configparam_id ?? '');
    const owners = CFG_TO_SIDS[cid];
    if (!owners) continue;
    const v = r.trans_value;
    if (v === null || v === undefined || String(v).trim() === '') continue;
    const d = String(r.trans_dtm ?? '').slice(0, 10);
    const t = String(r.trans_time ?? '').slice(0, 5);
    let slot;
    if (d === prev && t === '24:00') slot = '00:00';
    else if (d === date && t !== '00:00') slot = t;
    else if (d === date && t === '00:00') slot = '00:00-own'; // only used if X-1 24:00 is absent
    else continue;
    for (const sid of owners) {
      if (!want.has(sid)) continue;
      (map[sid][cid] ||= {})[slot] = String(v);
    }
  }
  for (const st of Object.values(map)) {
    for (const slots of Object.values(st)) {
      if (slots['00:00-own'] !== undefined) {
        if (slots['00:00'] === undefined) slots['00:00'] = slots['00:00-own'];
        delete slots['00:00-own'];
      }
    }
  }
  return map;
}

// One REST call covering every station type of `sids` (All query = all sids,
// Spatial query = one station's sids).
async function fetchRestHistory(date, token, sids) {
  const types = [...new Set(sids.map(s => SID_STATIONTYPE[s]).filter(Boolean))];
  if (!types.length) return {};
  const t0 = Date.now();
  const rows = await readData({
    token, plant_id: AQ_PLANT_ID, stationtype_code: types.join(','),
    begin_dt: prevDateStr(date), end_dt: date, format: 'json',
  });
  if (!Array.isArray(rows)) throw new Error('AquaDAT REST: unexpected response');
  console.log(`[daily-report/rest] ${date} types=${types.join(',')} rows=${rows.length} ${Date.now() - t0}ms`);
  return restRowsToHistoryMap(rows, date, sids);
}

function fetchUroborosHistory(configIds, date) {
  return new Promise((resolve) => {
    if (!configIds || configIds.length === 0) { resolve([]); return; }
    let qs = `?configIDs=${configIds.join(',')}`;
    if (date) qs += `&date=${date}`;
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

function remapMidnight(rows) {
  if (!Array.isArray(rows)) return {};
  const out = {};
  const seenMidnight = {};
  const sorted = [...rows].sort((a, b) => (a.ts ?? '') < (b.ts ?? '') ? -1 : 1);
  for (const r of sorted) {
    const cid = String(r.configID ?? r.configparam_id ?? '');
    const tsTime = (r.ts ?? '').slice(11, 16);
    let slot = tsTime;
    if (tsTime === '00:00') {
      if (!seenMidnight[cid]) { seenMidnight[cid] = true; }
      else { slot = '24:00'; }
    }
    const val = r.value_text ?? (r.value != null ? String(r.value) : '');
    if (!cid || !slot) continue;
    if (!out[cid]) out[cid] = {};
    out[cid][slot] = val;
  }
  return out;
}

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); }
  catch { return {}; }
}

// In-memory cache: { [date]: { [stationId]: { [cfgId]: { [slot]: value } } } }
const historyCache = {};

function getCache(date) {
  if (!historyCache[date]) historyCache[date] = {};
  return historyCache[date];
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// GET /api/daily-report/stream?date=  — SSE: fetch all stations serially, cache, compute
router.get('/stream', async (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
  }
  sseHeaders(res);

  if (getStage() === 1) {
    const token = req.cookies?.aquadat_token;
    if (token) {
      const cache = getCache(date);
      const result = await fetchDailyReportHistory(
        date, token,
        (sid, status, count) => sseSend(res, { type: 'step', station: sid, status, count: count ?? 0 }),
        (sid, pid, status, count) => sseSend(res, { type: 'pattern', station: sid, pattern_id: pid, status, count })
      );
      Object.assign(cache, result);
    } else {
      sseSend(res, { type: 'info', msg: 'ไม่มี token — ดึงข้อมูลจาก SQLite' });
    }
  } else {
    sseSend(res, { type: 'info', msg: `Stage ${getStage()} — ดึงจาก SQLite` });
  }

  sseSend(res, { type: 'step', station: 'compute', status: 'loading' });
  try {
    const cache = historyCache[date] || null;
    const report = computeDailyReport(date, loadSettings(), Object.keys(cache || {}).length ? cache : null);
    sseSend(res, { type: 'step', station: 'compute', status: 'done' });
    sseSend(res, { type: 'done', report });
  } catch (e) {
    sseSend(res, { type: 'step', station: 'compute', status: 'error', msg: e.message });
    sseSend(res, { type: 'error', msg: e.message });
  }
  res.end();
});

// GET /api/daily-report/stream-station?date=&station=  — SSE: re-fetch one station, recompute
router.get('/stream-station', async (req, res) => {
  const { date, station } = req.query;
  if (!date || !station) return res.status(400).json({ error: 'date and station required' });
  sseHeaders(res);

  const entry = DAILY_REPORT_ENTRIES.find(e => e.sid === station);
  if (!entry) {
    sseSend(res, { type: 'step', station, status: 'error', msg: 'unknown station' });
    sseSend(res, { type: 'error', msg: 'unknown station' });
    return res.end();
  }

  if (getStage() === 1) {
    const token = req.cookies?.aquadat_token;
    if (token) {
      const dayshift_id = getDayshiftId(date);
      sseSend(res, { type: 'step', station, status: 'loading' });
      const out = {};
      let failed = false;
      for (const pattern_id of entry.patterns) {
        const before = Object.values(out).reduce((s, m) => s + Object.keys(m).length, 0);
        try {
          await fetchOnePattern(station, pattern_id, date, dayshift_id, token, out);
          const after = Object.values(out).reduce((s, m) => s + Object.keys(m).length, 0);
          sseSend(res, { type: 'pattern', station, pattern_id, status: 'done', count: after - before });
        } catch (e) {
          console.warn(`[stream-station] ${station} pattern ${pattern_id}:`, e.message);
          failed = true;
          sseSend(res, { type: 'pattern', station, pattern_id, status: 'error', count: 0 });
        }
      }
      const count = Object.values(out).reduce((s, slots) => s + Object.keys(slots).length, 0);
      sseSend(res, { type: 'step', station, status: failed && count === 0 ? 'error' : 'done', count });
      getCache(date)[station] = out;
    } else {
      sseSend(res, { type: 'info', msg: 'ไม่มี token' });
    }
  }

  sseSend(res, { type: 'step', station: 'compute', status: 'loading' });
  try {
    const cache = historyCache[date] || null;
    const report = computeDailyReport(date, loadSettings(), Object.keys(cache || {}).length ? cache : null);
    sseSend(res, { type: 'step', station: 'compute', status: 'done' });
    sseSend(res, { type: 'done', report });
  } catch (e) {
    sseSend(res, { type: 'step', station: 'compute', status: 'error', msg: e.message });
    sseSend(res, { type: 'error', msg: e.message });
  }
  res.end();
});

// GET /api/daily-report/stream-stage0?date=  — SSE: fetch all stations from Uroboros, compute (stage=0)
router.get('/stream-stage0', async (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
  }
  sseHeaders(res);

  const historyMap = {};

  for (const sid of Object.keys(DR_CONFIGIDS)) {
    const configIds = DR_CONFIGIDS[sid] ?? [];

    sseSend(res, { type: 'step', station: sid, status: 'loading', count: 0 });
    try {
      const rows = await fetchUroborosHistory(configIds, date);
      const stMap = remapMidnight(rows);
      historyMap[sid] = stMap;
      const count = Object.keys(stMap).length;
      sseSend(res, { type: 'step', station: sid, status: 'done', count });
    } catch (e) {
      console.warn(`[stream-stage0] ${sid}:`, e.message);
      sseSend(res, { type: 'step', station: sid, status: 'error', count: 0 });
    }
  }

  sseSend(res, { type: 'step', station: 'compute', status: 'loading' });
  try {
    const report = computeDailyReport(date, loadSettings(), historyMap);
    sseSend(res, { type: 'step', station: 'compute', status: 'done' });
    sseSend(res, { type: 'done', report });
  } catch (e) {
    sseSend(res, { type: 'step', station: 'compute', status: 'error', msg: e.message });
    sseSend(res, { type: 'error', msg: e.message });
  }
  res.end();
});

// GET /api/daily-report/stream-station-stage0?date=&station=  — SSE: re-fetch one station from Uroboros, recompute
router.get('/stream-station-stage0', async (req, res) => {
  const { date, station } = req.query;
  if (!date || !station) return res.status(400).json({ error: 'date and station required' });
  sseHeaders(res);

  const configIds = DR_CONFIGIDS[station] ?? [];
  if (!DR_CONFIGIDS[station]) {
    sseSend(res, { type: 'step', station, status: 'error', count: 0 });
    sseSend(res, { type: 'error', msg: 'unknown station' });
    return res.end();
  }

  sseSend(res, { type: 'step', station, status: 'loading', count: 0 });
  try {
    const rows = await fetchUroborosHistory(configIds, date);
    const stMap = remapMidnight(rows);
    const cache = getCache(date);
    cache[station] = stMap;
    sseSend(res, { type: 'step', station, status: 'done', count: Object.keys(stMap).length });
  } catch (e) {
    console.warn(`[stream-station-stage0] ${station}:`, e.message);
    sseSend(res, { type: 'step', station, status: 'error', count: 0 });
  }

  sseSend(res, { type: 'step', station: 'compute', status: 'loading' });
  try {
    const cache = historyCache[date] || null;
    const report = computeDailyReport(date, loadSettings(), Object.keys(cache || {}).length ? cache : null);
    sseSend(res, { type: 'step', station: 'compute', status: 'done' });
    sseSend(res, { type: 'done', report });
  } catch (e) {
    sseSend(res, { type: 'step', station: 'compute', status: 'error', msg: e.message });
    sseSend(res, { type: 'error', msg: e.message });
  }
  res.end();
});

// GET /api/daily-report/quick?date=  — instant SQLite-only compute (no AquaDAT/Uroboros fetch)
router.get('/quick', (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
  }
  try {
    const report = computeDailyReport(date, loadSettings(), null);
    res.json({ report, source: 'sqlite' });
  } catch (e) {
    console.error('[daily-report/quick]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/daily-report/fetch-db?date=
// Off-site mode: always read Uroboros data.db (via BellBeast) regardless of stage.
// Uroboros ignores the date param and serves only its latest day, so rows are
// filtered by ts: <date> HH:MM → slot, <date+1> 00:00 → '24:00', others dropped.
router.get('/fetch-db', async (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });

  const allConfigIds = [...new Set(Object.values(DR_CONFIGIDS).flat())];
  const rows = await fetchUroborosHistory(allConfigIds, date);
  if (!Array.isArray(rows)) {
    return res.status(502).json({ error: 'อ่าน Uroboros (data.db) ไม่ได้ — BellBeast ไม่ตอบ' });
  }

  const nextDate = new Date(date + 'T00:00:00Z');
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const next = nextDate.toISOString().slice(0, 10);

  const map = {};
  const datesInDb = new Set();
  let lastTs = null;
  let used = 0;
  for (const r of rows) {
    const ts = String(r.ts ?? '');
    const d = ts.slice(0, 10);
    if (d) datesInDb.add(d);
    const cid = String(r.configID ?? r.configparam_id ?? '');
    const sid = CFG_TO_STATION[cid];
    if (!sid) continue;
    let slot = null;
    if (d === date) slot = ts.slice(11, 16);
    else if (d === next && ts.slice(11, 16) === '00:00') slot = '24:00';
    if (!slot) continue;
    const val = r.value_text ?? (r.value != null ? String(r.value) : '');
    if (val === '') continue;
    if (!map[sid]) map[sid] = {};
    if (!map[sid][cid]) map[sid][cid] = {};
    map[sid][cid][slot] = val;
    used++;
    if (!lastTs || ts > lastTs) lastTs = ts;
  }

  // Replace this date's cache so stale AquaDAT/Uroboros data does not mix in
  historyCache[date] = map;

  try {
    const report = computeDailyReport(date, loadSettings(), used ? map : null);
    res.json({
      report,
      fwsMap: { FWS1: map.FWS1 || null, FWS2: map.FWS2 || null },
      source: 'uroboros-db',
      coverage: {
        rows: used,
        lastTs,
        datesInDb: [...datesInDb].sort(),
        stations: Object.fromEntries(Object.entries(map).map(([s, m]) => [s, Object.keys(m).length])),
      },
    });
  } catch (e) {
    console.error('[fetch-db] compute error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/daily-report/fetch-all?date=
// Stage=0: single Uroboros call with ALL configIDs from all stations combined.
// Stage=1: one AquaDAT REST (JSON) call for every station type, X-1..X.
router.get('/fetch-all', async (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });

  const cache = getCache(date);

  if (getStage() === 1) {
    const token = req.cookies?.aquadat_token;
    if (!token) return res.status(401).json({ error: 'ยังไม่ได้ login AquaDAT' });
    try {
      Object.assign(cache, await fetchRestHistory(date, token, Object.keys(DR_CONFIGIDS)));
    } catch (e) {
      console.warn('[fetch-all] AquaDAT REST error:', e.message);
      return res.status(502).json({ error: 'AquaDAT REST: ' + e.message });
    }
  } else {
    const allConfigIds = [...new Set(Object.values(DR_CONFIGIDS).flat())];
    try {
      const rows = await fetchUroborosHistory(allConfigIds, date);
      if (Array.isArray(rows)) {
        const byStation = {};
        for (const r of rows) {
          const cid = String(r.configID ?? r.configparam_id ?? '');
          const sid = CFG_TO_STATION[cid];
          if (!sid) continue;
          if (!byStation[sid]) byStation[sid] = [];
          byStation[sid].push(r);
        }
        for (const [sid, srows] of Object.entries(byStation)) {
          cache[sid] = remapMidnight(srows);
        }
      }
    } catch (e) {
      console.warn('[fetch-all] uroboros error:', e.message);
    }
  }

  try {
    const historyMap = Object.keys(cache).length ? cache : null;
    const report = computeDailyReport(date, loadSettings(), historyMap);
    const fwsMap = { FWS1: cache['FWS1'] || null, FWS2: cache['FWS2'] || null };
    res.json({ report, fwsMap, source: getStage() === 1 ? 'aquadat' : 'uroboros' });
  } catch (e) {
    console.error('[fetch-all] compute error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/daily-report/fetch-station?date=&station=
// Fetches one station using DR_CONFIGIDS, updates historyCache, recomputes full report.
router.get('/fetch-station', async (req, res) => {
  const { date, station } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
  }
  if (!station || !DR_CONFIGIDS[station]) {
    return res.status(400).json({ error: `unknown station: ${station}` });
  }

  const configIds = DR_CONFIGIDS[station] ?? [];
  const cache = getCache(date);

  if (getStage() === 1) {
    // Spatial query: one REST call for this station's type. The same call
    // returns sibling stations of that type (RWS1+RWS2, …), so refresh them too.
    const token = req.cookies?.aquadat_token;
    if (!token) return res.status(401).json({ error: 'ยังไม่ได้ login AquaDAT' });
    const type = SID_STATIONTYPE[station];
    const sids = Object.keys(SID_STATIONTYPE).filter(s => SID_STATIONTYPE[s] === type);
    try {
      Object.assign(cache, await fetchRestHistory(date, token, sids));
    } catch (e) {
      console.warn(`[fetch-station] AquaDAT REST ${station}:`, e.message);
      return res.status(502).json({ error: `AquaDAT REST ${station}: ` + e.message });
    }
  } else {
    // stage=0: Uroboros
    try {
      const rows = await fetchUroborosHistory(configIds, date);
      cache[station] = remapMidnight(rows ?? []);
    } catch (e) {
      console.warn(`[fetch-station] uroboros ${station}:`, e.message);
      cache[station] = {};
    }
  }

  try {
    const historyMap = Object.keys(cache).length ? cache : null;
    const report = computeDailyReport(date, loadSettings(), historyMap);
    const source = getStage() === 1 ? 'aquadat' : 'uroboros';
    res.json({ report, station, source });
  } catch (e) {
    console.error('[fetch-station] compute error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/daily-report/recompute?date=  — recompute from the already-queried
// cache with the current app_settings.json (used after report settings change).
// No AquaDAT/Uroboros fetch. cached=false → nothing queried yet for this date.
router.get('/recompute', (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
  const cache = historyCache[date];
  if (!cache || !Object.keys(cache).length) return res.json({ cached: false });
  try {
    const report = computeDailyReport(date, loadSettings(), cache);
    const fwsMap = { FWS1: cache['FWS1'] || null, FWS2: cache['FWS2'] || null };
    res.json({ cached: true, report, fwsMap });
  } catch (e) {
    console.error('[recompute] compute error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/daily-report/debug-cache?date=&sid=&cid=  — read-only view of historyCache
router.get('/debug-cache', (req, res) => {
  const { date, sid, cid } = req.query;
  const c = historyCache[date] || {};
  if (sid && cid) return res.json(c[sid]?.[cid] ?? null);
  if (sid) return res.json(c[sid] ?? null);
  res.json(Object.fromEntries(Object.entries(c).map(([s, m]) => [s, Object.keys(m || {}).length])));
});

// GET /api/daily-report/debug?date=YYYY-MM-DD  — returns cfgIds per station (temp)
router.get('/debug', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  if (getStage() !== 1) return res.json({ stage: getStage(), msg: 'not stage 1' });
  const token = req.cookies?.aquadat_token;
  if (!token) return res.json({ error: 'no token' });
  const historyMap = {};
  for (const sid of DAILY_REPORT_STATIONS) {
    historyMap[sid] = await fetchAquadatHistory(sid, null, date, token);
  }
  const summary = {};
  for (const [sid, cfgMap] of Object.entries(historyMap)) {
    summary[sid] = Object.keys(cfgMap).map(id => ({
      id,
      slots: Object.keys(cfgMap[id]),
      sample_00: cfgMap[id]['00:00'],
      sample_24: cfgMap[id]['24:00'],
    }));
  }
  res.json(summary);
});

// GET /api/daily-report?date=YYYY-MM-DD
router.get('/', async (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });
  }
  try {
    let historyMap = null;
    if (getStage() === 1) {
      const token = req.cookies?.aquadat_token;
      if (token) {
        historyMap = await fetchAllStationsHistory(date, token);
        console.log('[daily-report] fetched AquaDAT history for', date);
      }
    }
    const report = computeDailyReport(date, loadSettings(), historyMap);
    res.json(report);
  } catch (err) {
    console.error('[daily-report]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/daily-report/validate  { date }
router.post('/validate', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    let historyMap = null;
    if (getStage() === 1) {
      const token = req.cookies?.aquadat_token;
      if (token) historyMap = await fetchAllStationsHistory(date, token);
    }
    const r = computeDailyReport(date, loadSettings(), historyMap);

    const errors = [];
    const warnings = [];

    function chk(label, val, isError = false) {
      if (val === null || val === undefined) {
        (isError ? errors : warnings).push(label);
      }
    }

    // Critical (ERROR) — water balance can't be done without these
    chk('ปริมาณน้ำดิบรวม',            r.card1_raw_water.total,           true);
    chk('ปริมาณน้ำสูบส่ง+สูบจ่ายรวม', r.card3_pumped.total,              true);
    chk('ระดับน้ำ CWT @24:00',         r.card2_water_level.cwt_at24,      true);
    chk('พลังงานรวม',                  r.card12_energy.total,             true);

    // Phase breakdown (ERROR)
    chk('น้ำดิบ เฟส 1', r.card1_raw_water.phase1, true);
    chk('น้ำดิบ เฟส 2', r.card1_raw_water.phase2, true);
    chk('น้ำดิบ เฟส 3', r.card1_raw_water.phase3, true);
    chk('น้ำดิบ เฟส 4', r.card1_raw_water.phase4, true);

    // Secondary (WARNING)
    chk('ระดับน้ำ CWT ต่ำสุด',   r.card2_water_level.cwt_min);
    chk('ระดับน้ำ CWT สูงสุด',   r.card2_water_level.cwt_max);
    chk('ระดับน้ำ RW ต่ำสุด',    r.card2_water_level.rw_min);
    chk('ระดับน้ำ RW สูงสุด',    r.card2_water_level.rw_max);
    chk('แรงดัน DPS ต่ำสุด',     r.card4_pressure.dps_min);
    chk('แรงดัน DPS สูงสุด',     r.card4_pressure.dps_max);
    chk('แรงดัน TPS ต่ำสุด',     r.card4_pressure.tps_min);
    chk('แรงดัน TPS สูงสุด',     r.card4_pressure.tps_max);
    chk('PACl CHEM1 OUT',        r.card5_chem1_pacl.out);
    chk('PACl CHEM2 OUT',        r.card6_chem2_pacl.out);
    chk('Chlorine CHEM1 USE',    r.card7_chem1_cl.use_kg);
    chk('Chlorine CHEM2 USE',    r.card8_chem2_cl.use_kg);
    chk('ALUM CHEM1 OUT',        r.card9_chem1_alum.out);
    chk('ALUM CHEM2 OUT',        r.card10_chem2_alum.out);
    chk('ตะกอน เฟส 1',          r.card11_sludge.phase1);
    chk('ตะกอน เฟส 2',          r.card11_sludge.phase2);
    chk('ตะกอน เฟส 3',          r.card11_sludge.phase3);
    chk('ตะกอน เฟส 4',          r.card11_sludge.phase4);
    chk('Service Water',         r.summary.service_water_m3);
    chk('Water Loss',            r.summary.water_loss_pct);

    res.json({ errors, warnings, errorCount: errors.length, warningCount: warnings.length });
  } catch (err) {
    console.error('[daily-report/validate]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/daily-report/preparers — CAR whitelist group 2 (operators by shift) for the SAVE DB popup.
// Read-only list of names; /api/car-admin/whitelist is admin-only.
router.get('/preparers', (req, res) => {
  try {
    const rows = getDb().all(
      `SELECT name, shift, position_label FROM car_whitelist
        WHERE group_code = '2' AND shift IS NOT NULL ORDER BY shift, name`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// History for `date` as the page shows it: the data already fetched by QUERY DATA / FROM DB.
// Nothing queried yet → fetch the same way QUERY DATA does (stage 1 = AquaDAT REST). null = none.
async function historyForDate(date, req) {
  const cache = getCache(date);
  if (!Object.keys(cache).length && getStage() === 1) {
    const token = req.cookies?.aquadat_token;
    if (token) Object.assign(cache, await fetchRestHistory(date, token, Object.keys(DR_CONFIGIDS)));
  }
  return Object.keys(cache).length ? cache : null;
}

// RECYCLE WATER tab → [{ on, pct }] × 4 phases (pct 0-100). Anything else → null.
function cleanRecycle(cfg) {
  if (!Array.isArray(cfg) || cfg.length !== 4) return null;
  return cfg.map(x => ({ on: !!x?.on, pct: Math.min(100, Math.max(0, Number(x?.pct) || 0)) }));
}

// Backwash water returned to the plant (m³) — same as the RECYCLE WATER tab: Σ wash × pct (phases switched on)
function recycledWater(historyMap, recycle) {
  const bw = backwashByPhase(historyMap);
  const wash = bw.map(b => b.wash);
  const washTotal = wash.every(v => v == null) ? null : wash.reduce((a, v) => a + (v ?? 0), 0);
  const recycled = recycle
    ? recycle.reduce((a, x, i) => a + (x.on ? (wash[i] ?? 0) * x.pct / 100 : 0), 0)
    : 0;
  return { washTotal, recycled, bw };
}

// Writes summary_table + detail_table for `date` (one row per DateKey+Shift; detail_table per DateKey).
// Used by SAVE DB (shift 1-4) and by the Uroboros auto-run (shift ${AUTO_SHIFT}).
function saveDailyReport({ date, shift, prepared_by, reviewed_by, reviewed_shift, recycle, historyMap }) {
  const settings = loadSettings();
  const r = computeDailyReport(date, settings, historyMap);
  // % น้ำสูญเสีย after the backwash water returned to the plant (RECYCLE WATER tab)
  const { washTotal, recycled, bw } = recycledWater(historyMap, recycle);
  const rwTotal = r.card1_raw_water.total;
  if (r.summary.water_loss_pct != null && rwTotal)
    r.summary.water_loss_pct -= recycled / rwTotal * 100;
  const db = getDb();
  const now = nowTH();
  const s = settings.chem_cost || {};

  // Column values follow MH_report.db (DDD/Sword MH_report.db): ton, mg/L, m³, ชม., baht/m³ of pumped water.
  // ── summary_table ──────────────────────────────────────────────────────
  const cd = r.card14_chem_dosing || {};
  const en = r.card12_energy || {};
  const sm = r.summary || {};
  const pumpTotal = r.card3_pumped.total;
  const sumN = (...vs) => (vs.every(v => v == null) ? null : vs.reduce((a, v) => a + (v ?? 0), 0));
  const clUseKg = sumN(r.card7_chem1_cl.use_kg, r.card8_chem2_cl.use_kg);
  const clUseTon = clUseKg != null ? clUseKg / 1000 : null;
  const alumUse = sumN(r.card9_chem1_alum.out, r.card10_chem2_alum.out);
  const paclUse = sumN(r.card5_chem1_pacl.out, r.card6_chem2_pacl.out);
  const perPump = (ton, price) => (ton != null && price != null && pumpTotal ? ton * price / pumpTotal : null);

  const alum12 = r.card13_chem_remaining.alum.chem1_m3;
  const alum34 = r.card13_chem_remaining.alum.chem2_m3;
  const pacl12 = r.card13_chem_remaining.pacl.chem1_m3;
  const pacl34 = r.card13_chem_remaining.pacl.chem2_m3;
  const cl12 = r.card13_chem_remaining.chlorine.chem1_ton;
  const cl34 = r.card13_chem_remaining.chlorine.chem2_ton;

  // Filters: status counts per phase (no status recorded → null) and backwash per phase
  const fa = (r.filter_availability || []).map(f => (f.known ? f : null));
  const faOk = fa.filter(Boolean);
  const allRuns = bw.flatMap(b => b.runs || []);

  const insert = (table, row) => {
    const cols = Object.keys(row);
    db.run(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map(c => (row[c] === undefined || (typeof row[c] === 'number' && !Number.isFinite(row[c])) ? null : row[c])));
  };

  insert('summary_table', {
    DateKey: date, Shift: Number(shift), DataDateTime: date + ' 00:00:00',
    RWS_TotalF: r.card1_raw_water.total,
    DPS_TotalF: sumN(r.card3_pumped.dps_lineA, r.card3_pumped.dps_lineB),
    TPS: r.card3_pumped.tps,
    CWT_Lvl24: r.card2_water_level.cwt_at24,
    CWT_minLvl: r.card2_water_level.cwt_min,
    CWT_maxLvl: r.card2_water_level.cwt_max,
    Cl_Total_tonuse: clUseTon,
    Alum_Total_tonuse: alumUse,
    Pacl_Total_tonuse: paclUse,
    Polymer_Total_tonuse: 0,                 // no polymer dosing data → 0 (as in MH_report.db)
    Cl_stock: cl12 != null && cl34 != null ? cl12 + cl34 : null,
    Alum_stock: alum12 != null && alum34 != null ? (alum12 + alum34) * 1.33 : null,
    Pacl_stock: pacl12 != null && pacl34 != null ? (pacl12 + pacl34) * 1.19 : null,
    Polymer_stock: 0,
    Cl_income: r.cl_income,                  // ท่อ (1 ท่อ = 1 ตัน)
    Alum_income: sumN(r.card9_chem1_alum.in, r.card10_chem2_alum.in),
    Pacl_income: sumN(r.card5_chem1_pacl.in, r.card6_chem2_pacl.in),
    Polymer_income: 0,
    FRT_Avg: allRuns.length ? allRuns.reduce((a, v) => a + v, 0) / allRuns.length : null,
    PercentageFilterUse: faOk.length ? faOk.reduce((a, f) => a + f.available / f.cap, 0) / faOk.length * 100 : null,
    Chem_cost: sm.chem_cost_per_m3,
    Energy_cost: sm.energy_per_m3,
    Sludge_disposal_cost: sm.sludge_cost_per_m3,
    Total_cost: sm.op_cost_per_m3,           // chem + energy + sludge (raw-water cost not included)
    Sludge_drain_Total: r.card11_sludge.total,
    Wash_water_Total: washTotal,
    Service_water_F: sm.service_water_m3,
    Water_loss: sm.water_loss_pct,
    Plant_Energy_USEtotal: en.total,         // excludes SS3 Bldg.
    GeneratedAt: now,
  });

  // ── detail_table ───────────────────────────────────────────────────────
  const detail = { DateKey: date };
  // Chemical not dosed that day (total use = 0) → per-phase use/dose are 0, as in MH_report.db
  const z0 = (v, unused) => v ?? (unused ? 0 : null);
  const noAlum = alumUse === 0, noPacl = paclUse === 0, noCl = clUseKg === 0;
  [1, 2, 3, 4].forEach((p, i) => {
    const f = fa[i], b = bw[i] || {};
    Object.assign(detail, {
      [`ON_P${p}`]: f ? f.on : null,
      [`STANDBY_P${p}`]: f ? f.standby : null,
      [`REPAIR_P${p}`]: f ? f.repair : null,
      [`WASHCOUNT_P${p}`]: b.count,
      [`FRT_P${p}`]: b.run,
      [`Wash_water_P${p}`]: b.wash,
      [`Sludge_drain_P${p}`]: r.card11_sludge[`phase${p}`],
      [`PreCl_P${p}tonuse`]: z0(cd[`cl_use_pre_p${p}`] != null ? cd[`cl_use_pre_p${p}`] / 1000 : null, noCl),
      [`PosCl_P${p}tonuse`]: z0(cd[`cl_use_post_p${p}`] != null ? cd[`cl_use_post_p${p}`] / 1000 : null, noCl),
      [`Alum_P${p}tonuse`]: z0(cd[`alum_use_p${p}`], noAlum),
      [`Pacl_P${p}tonuse`]: z0(cd[`pacl_use_p${p}`], noPacl),
      [`PreCl_P${p}targer_dose`]: z0(cd[`pre_cl_p${p}`], noCl),
      [`PosCl_P${p}targer_dose`]: z0(cd[`post_cl_p${p}`], noCl),
      [`Pacl_P${p}targer_dose`]: z0(cd[`pacl_p${p}`], noPacl),
      [`Alum_P${p}targer_dose`]: z0(cd[`alum_p${p}`], noAlum),
      [`PreCl_P${p}actual_dose`]: z0(cd[`cl_actual_pre_p${p}`], noCl),
      [`PosCl_P${p}actual_dose`]: z0(cd[`cl_actual_post_p${p}`], noCl),
      [`Pacl_P${p}actual_dose`]: z0(cd[`pacl_actual_p${p}`], noPacl),
      [`Alum_P${p}actual_dose`]: z0(cd[`alum_actual_p${p}`], noAlum),
    });
  });
  Object.assign(detail, {
    RWS1_P1F: r.card1_raw_water.phase1, RWS1_P2F: r.card1_raw_water.phase2,
    RWS2_P3F: r.card1_raw_water.phase3, RWS2_P4F: r.card1_raw_water.phase4,
    RWS_maxLvl: r.card2_water_level.rw_max, RWS_minLvl: r.card2_water_level.rw_min,
    DPS_AF: r.card3_pumped.dps_lineA, DPS_BF: r.card3_pumped.dps_lineB,
    DPS_maxPresure: r.card4_pressure.dps_max, DPS_minPresure: r.card4_pressure.dps_min,
    TPS_maxPressure: r.card4_pressure.tps_max, TPS_minPressure: r.card4_pressure.tps_min,
    Energy_SS1A: en.dps, Energy_SS1B: en.tps, Energy_SS2A: en.rws1, Energy_SS2B: en.rws2,
    Energy_SS3A: en.fws1, Energy_SS3B: en.fws2, Energy_SS3: en.bldg,
    Energy_total: en.total != null && en.bldg != null ? en.total + en.bldg : en.total,  // plant + SS3 Bldg.
    alum_baht: perPump(alumUse, s.alum_ton),
    pacl_baht: perPump(paclUse, s.pacl_ton),
    chlorine_baht: perPump(clUseTon, s.chlorine_ton),
    polymer_baht: 0,
    alum_ton: s.alum_ton ?? null, pacl_ton: s.pacl_ton ?? null, chlorine_ton: s.chlorine_ton ?? null,
    polymer_ton: s.polymer_ton ?? 0,
    Cl_P12_stock: cl12, Cl_P34_stock: cl34,
    Alum_P12_stock: alum12 != null ? alum12 * 1.33 : null,
    Alum_P34_stock: alum34 != null ? alum34 * 1.33 : null,
    PACl_P12_stock: pacl12 != null ? pacl12 * 1.19 : null,
    PACl_P34_stock: pacl34 != null ? pacl34 * 1.19 : null,
  });
  insert('detail_table', detail);

  // Extra columns are not in the MH_report.db schema — set them separately so the main insert stays as-is
  ensureExtraColumns(db);
  const revShift = [1, 2, 3, 4].includes(Number(reviewed_shift)) ? Number(reviewed_shift) : null;
  db.run('UPDATE summary_table SET PreparedBy = ?, ReviewedBy = ?, ReviewedShift = ?, RecycleCfg = ?, MhCells = ? WHERE DateKey = ? AND Shift = ?',
    [String(prepared_by).trim(), String(reviewed_by).trim(), revShift, recycle ? JSON.stringify(recycle) : null,
     JSON.stringify(buildMhCells(r, historyMap)), date, Number(shift)]);

  return now;
}

// POST /api/daily-report/save  { date, shift, prepared_by, reviewed_by, reviewed_shift, recycle }
router.post('/save', async (req, res) => {
  const { date, shift, prepared_by, reviewed_by, reviewed_shift } = req.body;
  const recycle = cleanRecycle(req.body.recycle);
  if (!date) return res.status(400).json({ error: 'date required' });
  if (![1, 2, 3, 4].includes(Number(shift))) return res.status(400).json({ error: 'shift (1-4) required' });
  if (!prepared_by || !String(prepared_by).trim()) return res.status(400).json({ error: 'prepared_by required' });
  if (!reviewed_by || !String(reviewed_by).trim()) return res.status(400).json({ error: 'reviewed_by required' });
  try {
    const historyMap = await historyForDate(date, req);
    const now = saveDailyReport({ date, shift, prepared_by, reviewed_by, reviewed_shift, recycle, historyMap });
    res.json({ ok: true, date, shift: Number(shift), prepared_by, reviewed_by, savedAt: now });
  } catch (err) {
    console.error('[daily-report/save]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/daily-report/saved?date=YYYY-MM-DD  — check if already saved
router.get('/saved', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const db = getDb();
    ensureExtraColumns(db);
    const rows = db.all('SELECT Shift, GeneratedAt, RecycleCfg FROM summary_table WHERE DateKey = ? ORDER BY GeneratedAt', [date]);
    let recycle = null;
    try { recycle = rows.length && rows[rows.length - 1].RecycleCfg ? JSON.parse(rows[rows.length - 1].RecycleCfg) : null; } catch { recycle = null; }
    res.json({ saved: rows.length > 0, rows: rows.map(({ Shift, GeneratedAt }) => ({ Shift, GeneratedAt })), recycle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/daily-report/saved-dates?from=&to=  — days with a SAVE DB (last save per day), for the PRINT EXCEL calendar
router.get('/saved-dates', (req, res) => {
  const { from, to } = req.query;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from || '') || !re.test(to || '')) return res.status(400).json({ error: 'from/to required (YYYY-MM-DD)' });
  try {
    const db = getDb();
    ensureExtraColumns(db);
    const rows = db.all(
      `SELECT DateKey AS date, Shift AS shift, PreparedBy AS prepared_by, ReviewedBy AS reviewed_by, GeneratedAt AS saved_at
         FROM summary_table WHERE DateKey BETWEEN ? AND ? ORDER BY DateKey, GeneratedAt`, [from, to]);
    const byDate = {};
    for (const r of rows) byDate[r.date] = r; // later save wins (same as the export)
    res.json(Object.values(byDate));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/daily-report/export-mh.xlsx?date=YYYY-MM-DD
// รายงานการผลิตน้ำประจำวัน (templates/MH_report_theme.xlsx) from the last SAVE DB of that day.
// Saves made before the MhCells snapshot existed: values stored in summary_table / detail_table,
// with the rest computed from data already loaded (no AquaDAT call).
router.get('/export-mh.xlsx', async (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
  try {
    const db = getDb();
    ensureExtraColumns(db);
    const saved = db.get('SELECT * FROM summary_table WHERE DateKey = ? ORDER BY GeneratedAt DESC LIMIT 1', [date]);
    if (!saved) return res.status(404).json({ error: `ยังไม่ได้ SAVE DB วันที่ ${date}` });

    let cells = null;
    try { cells = saved.MhCells ? JSON.parse(saved.MhCells) : null; } catch { cells = null; }
    if (!cells) {
      // Never call AquaDAT here: use only data already in memory (QUERY DATA / FROM DB) or the local DB.
      const cache = historyCache[date];
      const historyMap = cache && Object.keys(cache).length ? cache : null;
      cells = buildMhCells(computeDailyReport(date, loadSettings(), historyMap), historyMap);
      const detail = db.get('SELECT * FROM detail_table WHERE DateKey = ?', [date]);
      overlayDbCells(cells, saved, detail);
    }

    // ตำแหน่ง + " สคน." + ผลัด (e.g. "วิศวกร 5 สคน.3"). ผลัด = the one picked at SAVE DB, else the whitelist's.
    const person = (name, shift) => {
      if (!name) return null;
      const w = db.get(`SELECT position_label, shift FROM car_whitelist WHERE name = ? ORDER BY (position_label IS NULL), (group_code = '2') DESC LIMIT 1`, [name]);
      const sh = shift ?? w?.shift ?? null;
      const pos = (w?.position_label || '').trim();
      const unit = sh != null && !pos.includes('สคน.') ? `สคน.${sh}` : '';
      const position = [pos, unit].filter(Boolean).join(' ') || null;
      return { name, position };
    };
    // Saved by the Uroboros auto-run (Shift 0): no person signs — the form says so in English instead
    const auto = Number(saved.Shift) === AUTO_SHIFT;
    const buf = await writeMhReport({
      date, cells,
      preparer: auto ? AUTO_FORM_PREPARER : person(saved.PreparedBy, saved.Shift),
      reviewer: auto ? AUTO_FORM_REVIEWER : person(saved.ReviewedBy, saved.ReviewedShift),
    });
    const be = `${+date.slice(0, 4) + 543}-${date.slice(5)}`;
    sendFile(res, 'xlsx', `รายงานการผลิตน้ำประจำวัน_${be}`, buf, `MH_report_${be}`);
  } catch (err) {
    console.error('[daily-report/export-mh]', err);
    res.status(500).json({ error: err.message });
  }
});

// Report computed from the data last queried for `date` (fetch-all / fetch-station),
// with current settings. null → nothing queried yet. Used by the DailyLab export.
function getCachedReport(date) {
  const cache = historyCache[date];
  if (!cache || !Object.keys(cache).length) return null;
  return computeDailyReport(date, loadSettings(), cache);
}

// Thai date (YYYY-MM-DD) `days` days before today
function thaiDateMinus(days) {
  return new Date(Date.now() + 7 * 3600 * 1000 - days * 86400000).toISOString().slice(0, 10);
}

// DailyLab + Operation: today and yesterday are queried live (QUERY DATA);
// older days use what SAVE DB stored (summary_table.MhCells).
function isLiveReportDate(date) {
  return date >= thaiDateMinus(1);
}

// Printed-form cells of the last SAVE DB of `date`, or null when the day was never saved.
function getSavedMhCells(date) {
  const db = getDb();
  ensureExtraColumns(db);
  const saved = db.get('SELECT * FROM summary_table WHERE DateKey = ? ORDER BY GeneratedAt DESC LIMIT 1', [date]);
  if (!saved) return null;
  try { if (saved.MhCells) return JSON.parse(saved.MhCells); } catch { /* fall through */ }
  // Saved before the MhCells snapshot existed: only what summary_table / detail_table hold
  const detail = db.get('SELECT * FROM detail_table WHERE DateKey = ?', [date]);
  return overlayDbCells({}, saved, detail);
}

// ── Auto-run (beta) ──────────────────────────────────────────────────────────
// Uroboros task "labventure.dailyreport" calls POST /auto-run at 00:05 / 00:30 / 01:00 for yesterday.
// It does what a person does on /op-record?station=DAILY: QUERY DATA → no red box → SAVE DB.
// The red-box rules come from shared/dailyReportRules.mjs (same file the page uses).
// Saved as Shift 0 = "generated by the system"; a person's SAVE DB (Shift 1-4) is never overwritten.

const AUTO_SHIFT = 0;
const AUTO_PREPARER = 'AUTO · Uroboros (β)';
const AUTO_REVIEWER = 'N/A';
// Printed MH_report (PRINT EXCEL) for an auto-run day: replaces the names in the signature blocks
const AUTO_FORM_PREPARER = { name: 'This report was generated', position: 'automatically by the system.' };
const AUTO_FORM_REVIEWER = { name: 'Auto-generated report', position: '(no manual review)' };
const DEFAULT_RECYCLE = [0, 1, 2, 3].map(() => ({ on: true, pct: 100 }));  // same as the page
const autoInFlight = {};  // date → Promise (one run per date at a time)

let rulesModule = null;
async function loadRules() {
  if (!rulesModule) {
    const { pathToFileURL } = require('url');
    rulesModule = await import(pathToFileURL(path.join(__dirname, '..', 'shared', 'dailyReportRules.mjs')).href);
  }
  return rulesModule;
}

function ensureAutoRunsTable(db) {
  db.run(`CREATE TABLE IF NOT EXISTS daily_auto_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    attempt INTEGER,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    result TEXT NOT NULL,          -- RUNNING | OK | INCOMPLETE | SKIPPED | ERROR
    missing_count INTEGER,
    missing_json TEXT,             -- [{ section, items: [label] }]
    message TEXT,
    stage INTEGER
  )`);
}

function autoKeyOk(req) {
  const want = process.env.DAILY_AUTO_KEY;
  return !!want && req.get('X-Auto-Key') === want;
}

function rowOut(r) {
  if (!r) return null;
  let missing = null;
  try { missing = r.missing_json ? JSON.parse(r.missing_json) : null; } catch { missing = null; }
  const { missing_json, ...rest } = r;
  return { ...rest, missing };
}

async function runAuto(date, attempt, token) {
  const db = getDb();
  ensureAutoRunsTable(db);
  ensureExtraColumns(db);
  const stage = getStage();
  db.run('INSERT INTO daily_auto_runs (date, attempt, started_at, result, stage) VALUES (?, ?, ?, ?, ?)',
    [date, attempt, nowTH(), 'RUNNING', stage]);
  const id = db.get('SELECT last_insert_rowid() AS id').id;
  const finish = (result, { missing = null, message = null } = {}) => {
    const count = missing ? missing.reduce((n, s) => n + s.items.length, 0) : null;
    db.run('UPDATE daily_auto_runs SET finished_at = ?, result = ?, missing_count = ?, missing_json = ?, message = ? WHERE id = ?',
      [nowTH(), result, count, missing ? JSON.stringify(missing) : null, message, id]);
    console.log(`[daily-report/auto] ${date} #${attempt} ${result}${count ? ` missing=${count}` : ''}${message ? ` · ${message}` : ''}`);
    return rowOut(db.get('SELECT * FROM daily_auto_runs WHERE id = ?', [id]));
  };

  try {
    const human = db.get('SELECT Shift, PreparedBy, GeneratedAt FROM summary_table WHERE DateKey = ? AND Shift != ? ORDER BY GeneratedAt DESC LIMIT 1', [date, AUTO_SHIFT]);
    if (human) return finish('SKIPPED', { message: `คน SAVE DB แล้ว (ผลัด ${human.Shift} · ${human.PreparedBy ?? '—'} · ${human.GeneratedAt})` });
    // Stage≠1: the Uroboros data.db fallback holds only its latest day — wrong day after midnight
    if (stage !== 1) return finish('ERROR', { message: `AquaDAT ไม่พร้อม (stage=${stage})` });
    if (!token) return finish('ERROR', { message: 'ไม่มี AquaDAT token' });

    // Fresh query (same call as QUERY DATA → ALL) so data from an earlier attempt does not mix in
    const fresh = await fetchRestHistory(date, token, Object.keys(DR_CONFIGIDS));
    historyCache[date] = fresh;
    const historyMap = Object.keys(fresh).length ? fresh : null;
    const report = computeDailyReport(date, loadSettings(), historyMap);
    const fwsMap = { FWS1: fresh.FWS1 || null, FWS2: fresh.FWS2 || null };
    const { dailyReportIssues } = await loadRules();
    const missing = dailyReportIssues(report, fwsMap);
    if (missing.length) return finish('INCOMPLETE', { missing });

    // RECYCLE WATER: what was saved for this day, else the page default
    let recycle = DEFAULT_RECYCLE;
    try {
      const prev = db.get('SELECT RecycleCfg FROM summary_table WHERE DateKey = ? AND RecycleCfg IS NOT NULL ORDER BY GeneratedAt DESC LIMIT 1', [date]);
      recycle = cleanRecycle(prev ? JSON.parse(prev.RecycleCfg) : null) || DEFAULT_RECYCLE;
    } catch { /* default */ }

    const savedAt = saveDailyReport({
      date, shift: AUTO_SHIFT, prepared_by: AUTO_PREPARER, reviewed_by: AUTO_REVIEWER,
      reviewed_shift: null, recycle, historyMap,
    });
    return finish('OK', { message: `SAVE DB ${savedAt}` });
  } catch (e) {
    console.error('[daily-report/auto]', e);
    return finish('ERROR', { message: e.message });
  }
}

// POST /api/daily-report/auto-run  { date?, attempt? }
// Headers: X-Auto-Key (= DAILY_AUTO_KEY in .env), Authorization: Bearer <AquaDAT token>
// date defaults to yesterday (Thai time). → the daily_auto_runs row: { result, missing, message, … }
router.post('/auto-run', async (req, res) => {
  if (!autoKeyOk(req)) return res.status(403).json({ error: 'X-Auto-Key ไม่ถูกต้อง (หรือยังไม่ได้ตั้ง DAILY_AUTO_KEY)' });
  const date = req.body?.date || thaiDateMinus(1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const attempt = req.body?.attempt != null && Number.isFinite(Number(req.body.attempt)) ? Number(req.body.attempt) : null;  // 0 = manual (force file)
  const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim() || null;

  if (autoInFlight[date]) return res.status(409).json({ error: `กำลังรันวันที่ ${date} อยู่แล้ว`, result: 'RUNNING' });
  autoInFlight[date] = runAuto(date, attempt, token);
  try { res.json(await autoInFlight[date]); }
  finally { delete autoInFlight[date]; }
});

// GET /api/daily-report/auto-run/last?date=  — latest attempt + latest finished one (for a timed-out caller)
router.get('/auto-run/last', (req, res) => {
  if (!autoKeyOk(req)) return res.status(403).json({ error: 'X-Auto-Key ไม่ถูกต้อง' });
  const date = req.query.date || thaiDateMinus(1);
  const db = getDb();
  ensureAutoRunsTable(db);
  const last = db.get('SELECT * FROM daily_auto_runs WHERE date = ? ORDER BY id DESC LIMIT 1', [date]);
  const lastFinished = db.get("SELECT * FROM daily_auto_runs WHERE date = ? AND result != 'RUNNING' ORDER BY id DESC LIMIT 1", [date]);
  res.json({ date, running: !!autoInFlight[date], last: rowOut(last), lastFinished: rowOut(lastFinished) });
});

module.exports = router;
module.exports.getCachedReport = getCachedReport;
module.exports.isLiveReportDate = isLiveReportDate;
module.exports.getSavedMhCells = getSavedMhCells;
