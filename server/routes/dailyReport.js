const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const { computeDailyReport } = require('../services/dailyReport');
const { getDb, nowTH } = require('../services/db');
const { fetchAquadatHistory, fetchDailyReportHistory, DAILY_REPORT_ENTRIES, DAILY_REPORT_STATIONS } = require('../services/aquadatHistory');
const { getStage } = require('../services/stageMonitor');

const SETTINGS_PATH = path.join(__dirname, '..', 'config', 'app_settings.json');
const NODES_PATH    = path.join(__dirname, '..', 'config', 'operator_nodes.json');

const BELLBEAST_HOST = process.env.BELLBEAST_HOST || 'localhost';
const BELLBEAST_PORT = parseInt(process.env.BELLBEAST_PORT || '443', 10);

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
      const result = await fetchDailyReportHistory(date, token, (sid, status, count) => {
        sseSend(res, { type: 'step', station: sid, status, count: count ?? 0 });
      });
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
      const thHour = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
      const dayshift_id = thHour < 8 ? 1 : thHour < 16 ? 2 : 3;
      const { fetchOnePattern } = require('../services/aquadatHistory');
      sseSend(res, { type: 'step', station, status: 'loading' });
      const out = {};
      let failed = false;
      for (const pattern_id of entry.patterns) {
        try {
          await fetchOnePattern(station, pattern_id, date, dayshift_id, token, out);
        } catch (e) {
          console.warn(`[stream-station] ${station} pattern ${pattern_id}:`, e.message);
          failed = true;
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

  let nodes;
  try { nodes = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8')); }
  catch { sseSend(res, { type: 'error', msg: 'โหลด operator_nodes ไม่ได้' }); return res.end(); }

  const historyMap = {};

  for (const station of nodes.stations || []) {
    const sid = station.station_id ?? station.id;
    const allParams = (station.topics || []).flatMap(t => t.params || []);
    const configIds = [...new Set(allParams.map(p => p.configparam_id).filter(Boolean))];

    sseSend(res, { type: 'step', station: sid, status: 'loading', count: 0 });
    try {
      const rows = await fetchUroborosHistory(configIds);
      const stMap = {};
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const cid = String(r.configID ?? r.configparam_id ?? '');
          const slot = (r.ts ?? '').slice(11, 16);
          const val  = r.value_text ?? (r.value != null ? String(r.value) : '');
          if (!cid || !slot) continue;
          if (!stMap[cid]) stMap[cid] = {};
          stMap[cid][slot] = val;
        }
      }
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

  let nodes;
  try { nodes = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8')); }
  catch { sseSend(res, { type: 'error', msg: 'โหลด operator_nodes ไม่ได้' }); return res.end(); }

  const stationDef = nodes.stations?.find(s => (s.station_id ?? s.id) === station);
  if (!stationDef) {
    sseSend(res, { type: 'step', station, status: 'error', count: 0 });
    sseSend(res, { type: 'error', msg: 'unknown station' });
    return res.end();
  }

  const allParams = (stationDef.topics || []).flatMap(t => t.params || []);
  const configIds = [...new Set(allParams.map(p => p.configparam_id).filter(Boolean))];

  sseSend(res, { type: 'step', station, status: 'loading', count: 0 });
  try {
    const rows = await fetchUroborosHistory(configIds);
    const stMap = {};
    if (Array.isArray(rows)) {
      for (const r of rows) {
        const cid = String(r.configID ?? r.configparam_id ?? '');
        const slot = (r.ts ?? '').slice(11, 16);
        const val  = r.value_text ?? (r.value != null ? String(r.value) : '');
        if (!cid || !slot) continue;
        if (!stMap[cid]) stMap[cid] = {};
        stMap[cid][slot] = val;
      }
    }
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

module.exports = router;
