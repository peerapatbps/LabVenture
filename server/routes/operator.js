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

function fetchUroborosHistory(configIds, date) {
  return new Promise((resolve) => {
    if (!configIds || configIds.length === 0) { resolve([]); return; }
    let qs = `?configIDs=${configIds.join(',')}`;
    if (date) qs += `&date=${encodeURIComponent(date)}`;
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

// ── Schedule overrides (per-configID real recording schedules) ─────────────
const _overrides = require('../config/schedule_overrides.json');
const _cidSlots      = _overrides.configid_slots ?? {};
const _excludedSet   = new Set((_overrides.excluded_configids ?? []).map(String));
const _optionalSet   = new Set(_overrides.optional_stations ?? []);
const _customDoneMap = _overrides.custom_slot_done ?? {};
const _topicRules    = Object.fromEntries(Object.entries(_overrides.topic_rules ?? {}).filter(([k]) => !k.startsWith('_')));

// ── Progress helpers ──────────────────────────────────────────────────────

// FWS custom done: base params must be complete; any backwashing must be in whole sets of 6
const _fwsBase = {
  FWS1: { full: 34, shift: 16, only: 16 },
  FWS2: { full: 58, shift: 28, only: 28 },
};

function fwsSlotDone(stationId, slot, rec) {
  const b = _fwsBase[stationId];
  if (slot === '00:00' || slot === '24:00') return rec >= b.full  && (rec - b.full)  % 6 === 0;
  if (slot === '08:00' || slot === '16:00') return rec >= b.shift && (rec - b.shift) % 6 === 0;
  return rec === b.only; // 04:00, 12:00, 20:00
}

function isSlotDone(stationId, slot, rec, exp) {
  const mode = _customDoneMap[stationId];
  if (mode === 'fws') return fwsSlotDone(stationId, slot, rec);
  return exp > 0 && rec / exp > 0.5;
}

function thaiDateStr() {
  return new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];
}

function slotsForTopic(topic) {
  if (Array.isArray(topic.time_slots) && topic.time_slots.length > 0) return topic.time_slots;
  const count = topic.time_slot ?? 0;
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const h = Math.round((i * 24) / Math.max(count - 1, 1));
    return `${String(h).padStart(2, '0')}:00`;
  });
}

function slotsForParam(configID, topic) {
  const cid = String(configID);
  if (_excludedSet.has(cid)) return [];
  if (_cidSlots[cid]) return _cidSlots[cid];
  return slotsForTopic(topic);
}

function nextDateStr(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Per-topic (sheet) rules: a "row" is one topic at one time slot.
// A row is complete when the share of its params that have a value is > row_threshold.
// A slot is done when every required row at that slot is complete.
function topicRuleSlots(rule) {
  if (Array.isArray(rule.slots)) return rule.slots;
  const step = rule.every_hours;
  if (!step) return [];
  const out = [];
  for (let h = 0; h <= 24; h += step) out.push(`${String(h).padStart(2, '0')}:00`);
  return out;
}

function buildRuleSlotSummary(station, stationRules, recorded) {
  const defThreshold = stationRules.default_row_threshold ?? 0.5;
  const rowsBySlot = {};
  for (const topic of (station.topics ?? [])) {
    const rule = stationRules.topics?.[topic.topic];
    if (!rule || rule.required === false) continue;
    const threshold = rule.row_threshold ?? defThreshold;
    // row_op ">=" counts a row as complete at exactly the threshold; default is strictly ">"
    const inclusive = (rule.row_op ?? stationRules.default_row_op) === '>=';
    const cids = (topic.params ?? [])
      .filter(p => p.configparam_id && !p.formula && !_excludedSet.has(String(p.configparam_id)))
      .map(p => String(p.configparam_id));
    if (cids.length === 0) continue;
    for (const slot of topicRuleSlots(rule)) {
      // A param with its own schedule (configid_slots) only counts in the slots it is scheduled for
      const slotCids = cids.filter(cid => !_cidSlots[cid] || _cidSlots[cid].includes(slot));
      if (slotCids.length === 0) continue;
      const rec = slotCids.filter(cid => recorded[cid]?.has(slot)).length;
      const ratio = rec / slotCids.length;
      // slot_thresholds: { "00:00": 0.75, ... } overrides row_threshold for specific rounds
      const th = rule.slot_thresholds?.[slot] ?? threshold;
      (rowsBySlot[slot] ??= []).push({ topic: topic.topic, rec, exp: slotCids.length, done: inclusive ? ratio >= th : ratio > th });
    }
  }
  const slotSummary = {};
  for (const [slot, rows] of Object.entries(rowsBySlot)) {
    const rowsDone = rows.filter(r => r.done).length;
    const done = rowsDone === rows.length;
    slotSummary[slot] = { done, partial: !done && rows.some(r => r.rec > 0), count: rows.length, rec: rowsDone, unit: 'row', rows };
  }
  return slotSummary;
}

function buildProgressData(nodes, rows, date) {
  // Index recorded rows: { configID_str → Set<slot_str> }
  // Next-day 00:00 is the day's '24:00' round; rows from other dates are ignored.
  // Without a usable date, a second '00:00' entry per configID is promoted to '24:00' (seenMidnight logic)
  const recorded = {};
  const seenMid = {};
  const nextDate = date ? nextDateStr(date) : null;
  const sorted = [...(rows || [])].sort((a, b) => (a.ts ?? '') < (b.ts ?? '') ? -1 : 1);
  for (const r of sorted) {
    const cid = String(r.configID ?? r.configparam_id ?? '');
    const tsDate = (r.ts ?? '').slice(0, 10);
    const tsTime = (r.ts ?? '').slice(11, 16);
    if (!cid || !tsTime) continue;
    if (r.value == null && !r.value_text) continue;
    let slot = tsTime;
    if (date && tsDate === nextDate && tsTime === '00:00') slot = '24:00';
    else if (date && tsDate !== date) continue;
    else if (tsTime === '00:00') {
      if (seenMid[cid]) slot = '24:00';
      else seenMid[cid] = true;
    }
    if (!recorded[cid]) recorded[cid] = new Set();
    recorded[cid].add(slot);
  }

  let totalExpected = 0, totalRecorded = 0;
  const stations = [];
  for (const station of (nodes.stations ?? [])) {
    const isOptional = _optionalSet.has(station.id);
    const stationRules = _topicRules[station.id];
    if (stationRules) {
      const slotSummary = buildRuleSlotSummary(station, stationRules, recorded);
      const slotList = Object.values(slotSummary);
      const stExp = isOptional ? 0 : slotList.length;
      const stRec = isOptional ? 0 : slotList.filter(s => s.done).length;
      totalExpected += stExp;
      totalRecorded += stRec;
      stations.push({ station_id: station.id, label: station.label,
        totalExpected: stExp, totalRecorded: stRec, slotSummary, isOptional });
      continue;
    }
    // slotTrack: slot → { exp: count of configIDs expected, rec: count that recorded }
    const slotTrack = {};
    for (const topic of (station.topics ?? [])) {
      const inputParams = (topic.params ?? []).filter(p => p.configparam_id && !p.formula);
      for (const p of inputParams) {
        const cid = String(p.configparam_id);
        const slots = slotsForParam(cid, topic);
        for (const slot of slots) {
          const hasRec = recorded[cid]?.has(slot) ?? false;
          if (!slotTrack[slot]) slotTrack[slot] = { exp: 0, rec: 0 };
          slotTrack[slot].exp++;
          if (hasRec) slotTrack[slot].rec++;
        }
      }
    }
    // Count at slot level: a slot is "done" if > 60% of expected configIDs recorded
    let stExp = 0, stRec = 0;
    const slotSummary = {};
    for (const [slot, { exp, rec }] of Object.entries(slotTrack)) {
      const done    = isSlotDone(station.id, slot, rec, exp);
      const partial = !done && rec > 0;
      slotSummary[slot] = { done, partial, count: exp, rec };
      if (!isOptional) {
        stExp++;
        if (done) stRec++;
      }
    }
    totalExpected += stExp;
    totalRecorded += stRec;
    stations.push({ station_id: station.id, label: station.label,
      totalExpected: stExp, totalRecorded: stRec, slotSummary, isOptional });
  }
  return { date, totalExpected, totalRecorded, stations };
}

// ── Progress cache (server polls Uroboros every 5 min) ────────────────────

let _progressCache = null;
let _progressDate = null;

async function computeProgress(date) {
  const nodes = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
  const allIds = [];
  for (const st of (nodes.stations ?? []))
    for (const t of (st.topics ?? []))
      for (const p of (t.params ?? []))
        if (p.configparam_id && !p.formula) allIds.push(p.configparam_id);
  const rows = await fetchUroborosHistory([...new Set(allIds)], date);
  return buildProgressData(nodes, Array.isArray(rows) ? rows : [], date);
}

async function refreshProgressCache() {
  try {
    const today = thaiDateStr();
    _progressCache = await computeProgress(today);
    _progressDate = today;
    console.log(`[op-progress] refreshed — ${_progressCache.totalRecorded}/${_progressCache.totalExpected}`);
  } catch (e) {
    console.warn('[op-progress] refresh failed:', e.message);
  }
}

refreshProgressCache();
setInterval(refreshProgressCache, 5 * 60 * 1000);

// ── Routes ────────────────────────────────────────────────────────────────

// Debug: per-configID recording status for a station
// GET /api/operator/debug/station/:id?date=YYYY-MM-DD
router.get('/debug/station/:id', async (req, res) => {
  try {
    const stationId = req.params.id;
    const date = req.query.date || thaiDateStr();
    const nodes = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
    const station = (nodes.stations ?? []).find(s => s.id === stationId);
    if (!station) return res.status(404).json({ error: 'station not found' });

    // Collect all non-formula configIDs for this station
    const paramMeta = {}; // cid → { param_name, equipment_name, topic, slots }
    for (const topic of (station.topics ?? [])) {
      for (const p of (topic.params ?? [])) {
        if (!p.configparam_id || p.formula) continue;
        const cid = String(p.configparam_id);
        if (!paramMeta[cid]) {
          const slots = slotsForParam(cid, topic);
          paramMeta[cid] = { param_name: p.param_name, equipment_name: p.equipment_name,
            topic: topic.topic, slots, excluded: _excludedSet.has(cid) };
        }
      }
    }

    const allIds = Object.keys(paramMeta).map(Number);
    const rows = await fetchUroborosHistory(allIds, date);

    // Build recorded map
    const recorded = {};
    const seenMid = {};
    const sorted = [...(rows || [])].sort((a, b) => (a.ts ?? '') < (b.ts ?? '') ? -1 : 1);
    for (const r of sorted) {
      const cid = String(r.configID ?? r.configparam_id ?? '');
      const tsTime = (r.ts ?? '').slice(11, 16);
      if (!cid || !tsTime) continue;
      let slot = tsTime;
      if (tsTime === '00:00') { if (seenMid[cid]) slot = '24:00'; else seenMid[cid] = true; }
      if (!recorded[cid]) recorded[cid] = [];
      recorded[cid].push(slot);
    }

    const params = Object.entries(paramMeta).map(([cid, meta]) => {
      const recSlots = recorded[cid] ?? [];
      const missing = meta.slots.filter(s => !recSlots.includes(s));
      return { configparam_id: Number(cid), ...meta,
        recorded_slots: recSlots, missing_slots: missing,
        status: meta.excluded ? 'excluded' : missing.length === 0 ? 'complete' : recSlots.length === 0 ? 'none' : 'partial' };
    });

    const thaiNow = new Date(Date.now() + 7 * 3600000).toISOString().slice(11, 16);
    res.json({ station_id: stationId, date, now: thaiNow, params });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/nodes', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
    const { station_id } = req.query;
    if (station_id) {
      const station = (data.stations || []).find(s => s.id === station_id) ?? null;
      return res.json({ station });
    }
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to load operator nodes config' });
  }
});

router.get('/progress', (req, res) => {
  const date = req.query.date || thaiDateStr();
  if (date === _progressDate && _progressCache) return res.json(_progressCache);
  computeProgress(date).then(r => res.json(r)).catch(e => res.status(500).json({ error: e.message }));
});

router.get('/todos', (req, res) => {
  const progress = _progressCache;
  if (!progress) return res.json({ todos: [] });

  // Thai time HH:mm — only count slots that have already passed (00:00–now)
  const thaiNow = new Date(Date.now() + 7 * 3600000);
  const nowHHMM = thaiNow.toISOString().slice(11, 16); // "HH:MM"

  const todos = [];
  for (const s of (progress.stations ?? [])) {
    if (s.isOptional) continue;
    const summary = s.slotSummary ?? {};
    let exp = 0, rec = 0;
    for (const [slot, info] of Object.entries(summary)) {
      // "24:00" = next-day midnight — never overdue within the same day
      if (slot === '24:00') continue;
      if (slot > nowHHMM) continue; // slot hasn't arrived yet
      exp++;
      if (info.done) rec++;
    }
    const pending = exp - rec;
    if (exp > 0 && pending > 0) {
      todos.push({ station_id: s.station_id, label: s.label,
        message: `ยังไม่ได้บันทึก ${pending} ช่วงเวลา`, pending });
    }
  }
  res.json({ todos });
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
  const body = JSON.stringify({ variables: {}, query });
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${token}` };
  let r;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      r = await fetch(GRAPHQL_URL, { method: 'POST', headers, body, timeout: 20000 });
      break;
    } catch (e) {
      if (attempt === 2) throw new Error(`network timeout at: ${GRAPHQL_URL}`);
      console.warn(`[history/aquadat] ${topic} pattern ${pattern_id} retry (attempt ${attempt})...`);
      await new Promise(res => setTimeout(res, 3000));
    }
  }
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
  // Match by node_topics array (operator_nodes name) or legacy topic field (pattern name)
  const patterns = topic_filter
    ? allPatterns.filter(p =>
        (Array.isArray(p.node_topics) && p.node_topics.includes(topic_filter)) ||
        p.topic === topic_filter
      )
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

  const rows = await fetchUroborosHistory(configIds, date);
  if (!Array.isArray(rows)) return res.json({});

  const out = {};
  const seenMidnight = {};
  const sorted = [...rows].sort((a, b) => (a.ts ?? '') < (b.ts ?? '') ? -1 : 1);
  for (const r of sorted) {
    const cid    = String(r.configID ?? r.configparam_id ?? '');
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

  // Stage 1: write to Aquadat (bypass tokens route to Uroboros instead)
  try {
    const token = req.cookies?.aquadat_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    let isBypassToken = false;
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        isBypassToken = !!p.bypass;
      }
    } catch {}

    if (isBypassToken) {
      const result = await forwardToUroboros(records, station_id);
      return res.json({ ...result, stage, routed_to: 'uroboros' });
    }

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

// POST /api/operator/validate  { station_id, date, data }
// data = { [configparam_id]: { [slot]: value_string } }
router.post('/validate', (req, res) => {
  const { station_id, date, data } = req.body;
  if (!station_id || !data) return res.status(400).json({ error: 'station_id and data required' });

  try {
    let result;
    switch (station_id) {
      case 'RWS1': { const { validateRWS1 } = require('../services/dailyValidator_RWS'); result = validateRWS1(data); break; }
      case 'RWS2': { const { validateRWS2 } = require('../services/dailyValidator_RWS'); result = validateRWS2(data); break; }
      case 'TPS':  { const { validateTPS }  = require('../services/dailyValidator_TPS'); result = validateTPS(data); break; }
      case 'DPS':  { const { validateDPS }  = require('../services/dailyValidator_TPS'); result = validateDPS(data); break; }
      case 'FWS1': { const { validateFWS1 } = require('../services/dailyValidator_FWS'); result = validateFWS1(data); break; }
      case 'FWS2': { const { validateFWS2 } = require('../services/dailyValidator_FWS'); result = validateFWS2(data); break; }
      case 'CWS1': { const { validateCWS1 } = require('../services/dailyValidator_CWS'); result = validateCWS1(data); break; }
      case 'CWS2': { const { validateCWS2 } = require('../services/dailyValidator_CWS'); result = validateCWS2(data); break; }
      case 'CHEM1':{ const { validateCHEM1 }= require('../services/dailyValidator_CHEM'); result = validateCHEM1(data); break; }
      case 'CHEM2':{ const { validateCHEM2 }= require('../services/dailyValidator_CHEM'); result = validateCHEM2(data); break; }
      default: return res.status(400).json({ error: `Validator for station "${station_id}" not implemented` });
    }
    res.json(result);
  } catch (err) {
    console.error('[operator/validate]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
