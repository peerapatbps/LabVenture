const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const { computeDailyReport, DR_CONFIGIDS } = require('../services/dailyReport');
const { getDb, nowTH } = require('../services/db');
const { fetchAquadatHistory, fetchDailyReportHistory, fetchOnePattern, DAILY_REPORT_ENTRIES, DAILY_REPORT_STATIONS } = require('../services/aquadatHistory');
const { getStage } = require('../services/stageMonitor');
const { readData } = require('../services/aquadat');

const SETTINGS_PATH = path.join(__dirname, '..', 'config', 'app_settings.json');
const NODES_PATH    = path.join(__dirname, '..', 'config', 'operator_nodes.json');

const BELLBEAST_HOST = process.env.BELLBEAST_HOST || 'localhost';
const BELLBEAST_PORT = parseInt(process.env.BELLBEAST_PORT || '443', 10);

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

// POST /api/daily-report/save  { date, shift }
router.post('/save', async (req, res) => {
  const { date, shift = 1 } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    let historyMap = null;
    if (getStage() === 1) {
      const token = req.cookies?.aquadat_token;
      if (token) historyMap = await fetchAllStationsHistory(date, token);
    }
    const settings = loadSettings();
    const r = computeDailyReport(date, settings, historyMap);
    const db = getDb();
    const now = nowTH();
    const s = settings.chem_cost || {};

    // ── summary_table ──────────────────────────────────────────────────────
    const clUseKg = (r.card7_chem1_cl.use_kg ?? 0) + (r.card8_chem2_cl.use_kg ?? 0);
    const alumUse = (r.card9_chem1_alum.out ?? 0) + (r.card10_chem2_alum.out ?? 0);
    const paclUse = (r.card5_chem1_pacl.out ?? 0) + (r.card6_chem2_pacl.out ?? 0);

    const alum12 = r.card13_chem_remaining.alum.chem1_m3;
    const alum34 = r.card13_chem_remaining.alum.chem2_m3;
    const pacl12 = r.card13_chem_remaining.pacl.chem1_m3;
    const pacl34 = r.card13_chem_remaining.pacl.chem2_m3;

    db.run(`
      INSERT OR REPLACE INTO summary_table (
        DateKey, Shift, DataDateTime,
        RWS_TotalF, DPS_TotalF, TPS,
        CWT_Lvl24, CWT_minLvl, CWT_maxLvl,
        Cl_Total_tonuse, Alum_Total_tonuse, Pacl_Total_tonuse, Polymer_Total_tonuse,
        Cl_stock, Alum_stock, Pacl_stock, Polymer_stock,
        Cl_income, Alum_income, Pacl_income, Polymer_income,
        FRT_Avg, PercentageFilterUse,
        Chem_cost, Energy_cost, Sludge_disposal_cost, Total_cost,
        Sludge_drain_Total, Wash_water_Total, Service_water_F, Water_loss,
        Plant_Energy_USEtotal, GeneratedAt
      ) VALUES (
        ?,?,?,  ?,?,?,  ?,?,?,
        ?,?,?,NULL,
        ?,?,?,NULL,
        ?,?,?,NULL,
        NULL,NULL,
        ?,?,?,?,
        ?,NULL,?,?,
        ?,?
      )`,
      [
        date, shift, date + ' 00:00:00',
        r.card1_raw_water.total ?? null,
        r.card3_pumped.total ?? null,
        r.card3_pumped.tps ?? null,
        r.card2_water_level.cwt_at24 ?? null,
        r.card2_water_level.cwt_min ?? null,
        r.card2_water_level.cwt_max ?? null,
        clUseKg / 1000,
        alumUse,
        paclUse,
        r.card13_chem_remaining.chlorine.chem1_ton !== null && r.card13_chem_remaining.chlorine.chem2_ton !== null
          ? (r.card13_chem_remaining.chlorine.chem1_ton ?? 0) + (r.card13_chem_remaining.chlorine.chem2_ton ?? 0) : null,
        alum12 !== null && alum34 !== null ? (alum12 + alum34) * 1.33 : null,
        pacl12 !== null && pacl34 !== null ? (pacl12 + pacl34) * 1.19 : null,
        (r.card7_chem1_cl.in_kg ?? 0) + (r.card8_chem2_cl.in_kg ?? 0),
        (r.card9_chem1_alum.in ?? 0) + (r.card10_chem2_alum.in ?? 0),
        (r.card5_chem1_pacl.in ?? 0) + (r.card6_chem2_pacl.in ?? 0),
        r.summary.chem_cost_per_m3 !== null && r.card3_pumped.total
          ? r.summary.chem_cost_per_m3 * r.card3_pumped.total : null,
        r.card12_energy.cost_baht ?? null,
        (s.sludge_day ?? 0) || null,
        r.summary.total_cost_baht ?? null,
        r.card11_sludge.total ?? null,
        r.summary.service_water_m3 ?? null,
        r.summary.water_loss_pct ?? null,
        r.card12_energy.total ?? null,
        now,
      ]
    );

    // ── detail_table ───────────────────────────────────────────────────────
    db.run(`
      INSERT OR REPLACE INTO detail_table (
        DateKey,
        RWS1_P1F, RWS1_P2F, RWS2_P3F, RWS2_P4F,
        RWS_maxLvl, RWS_minLvl,
        DPS_AF, DPS_BF,
        DPS_maxPresure, DPS_minPresure,
        TPS_maxPressure, TPS_minPressure,
        Sludge_drain_P1, Sludge_drain_P2, Sludge_drain_P3, Sludge_drain_P4,
        Energy_SS1A, Energy_SS1B, Energy_SS2A, Energy_SS2B,
        Energy_SS3A, Energy_SS3B, Energy_SS3, Energy_total,
        alum_baht, pacl_baht, chlorine_baht,
        alum_ton, pacl_ton, chlorine_ton,
        Cl_P12_stock, Cl_P34_stock,
        Alum_P12_stock, Alum_P34_stock,
        PACl_P12_stock, PACl_P34_stock
      ) VALUES (
        ?,
        ?,?,?,?,
        ?,?,
        ?,?,
        ?,?,
        ?,?,
        ?,?,?,?,
        ?,?,?,?,
        ?,?,?,?,
        ?,?,?,
        ?,?,?,
        ?,?,
        ?,?,
        ?,?
      )`,
      [
        date,
        r.card1_raw_water.phase1 ?? null,
        r.card1_raw_water.phase2 ?? null,
        r.card1_raw_water.phase3 ?? null,
        r.card1_raw_water.phase4 ?? null,
        r.card2_water_level.rw_max ?? null,
        r.card2_water_level.rw_min ?? null,
        r.card3_pumped.dps_lineA ?? null,
        r.card3_pumped.dps_lineB ?? null,
        r.card4_pressure.dps_max ?? null,
        r.card4_pressure.dps_min ?? null,
        r.card4_pressure.tps_max ?? null,
        r.card4_pressure.tps_min ?? null,
        r.card11_sludge.phase1 ?? null,
        r.card11_sludge.phase2 ?? null,
        r.card11_sludge.phase3 ?? null,
        r.card11_sludge.phase4 ?? null,
        r.card12_energy.dps ?? null,
        r.card12_energy.tps ?? null,
        r.card12_energy.rws1 ?? null,
        r.card12_energy.rws2 ?? null,
        r.card12_energy.fws1 ?? null,
        r.card12_energy.fws2 ?? null,
        r.card12_energy.bldg ?? null,
        r.card12_energy.total ?? null,
        alumUse !== null ? alumUse * (s.alum_ton ?? 0) : null,
        paclUse !== null ? paclUse * (s.pacl_ton ?? 0) : null,
        clUseKg !== null ? (clUseKg / 1000) * (s.chlorine_ton ?? 0) : null,
        s.alum_ton ?? null,
        s.pacl_ton ?? null,
        s.chlorine_ton ?? null,
        r.card13_chem_remaining.chlorine.chem1_ton ?? null,
        r.card13_chem_remaining.chlorine.chem2_ton ?? null,
        alum12 !== null ? alum12 * 1.33 : null,
        alum34 !== null ? alum34 * 1.33 : null,
        pacl12 !== null ? pacl12 * 1.19 : null,
        pacl34 !== null ? pacl34 * 1.19 : null,
      ]
    );

    res.json({ ok: true, date, shift, savedAt: now });
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
    const rows = db.all('SELECT Shift, GeneratedAt FROM summary_table WHERE DateKey = ? ORDER BY Shift', [date]);
    res.json({ saved: rows.length > 0, rows });
  } catch (err) {
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

module.exports = router;
module.exports.getCachedReport = getCachedReport;
