const { getDb } = require('./db');

// Station type mapping
const STATION_TYPE = {
  RWS1: 'RWS', RWS2: 'RWS',
  CHEM1: 'CHEM', CHEM2: 'CHEM',
  TPS: 'TPS', DPS: 'DPS',
  FWS1: 'FWS', FWS2: 'FWS',
  CWS1: 'CWS', CWS2: 'CWS',
};

function getDb_() {
  return getDb();
}

// Read a text value (e.g. "REPAIR", "ON") at a specific time slot
function getTextAt(configparam_id, stationId, date, time, historyMap) {
  const raw = historyMap?.[stationId]?.[String(configparam_id)]?.[time];
  if (raw !== undefined) return String(raw);
  const db = getDb_();
  const trans_type = STATION_TYPE[stationId];
  const param_key = `${trans_type}_${configparam_id}`;
  const row = db.get(
    `SELECT trans_value FROM node_records WHERE param_key = ? AND trans_dtm = ? AND trans_time = ? LIMIT 1`,
    [param_key, date, time]
  );
  return row?.trans_value ?? null;
}

const FILTER_PHASES = [
  { phase: 1, stationId: 'FWS1', cap: 8,  cfgIds: [314,324,334,344,354,364,374,384] },
  { phase: 2, stationId: 'FWS1', cap: 8,  cfgIds: [396,406,416,426,436,446,456,466] },
  { phase: 3, stationId: 'FWS2', cap: 14, cfgIds: [476,486,496,506,516,526,536,546,556,566,576,586,596,606] },
  { phase: 4, stationId: 'FWS2', cap: 14, cfgIds: [618,628,638,648,658,668,678,688,698,708,718,728,738,748] },
];

function getFilterAvailability(date, historyMap) {
  return FILTER_PHASES.map(({ phase, stationId, cap, cfgIds }) => {
    const repair = cfgIds.filter(id => {
      const v = getTextAt(id, stationId, date, '24:00', historyMap);
      return v && v.trim().toUpperCase() === 'REPAIR';
    }).length;
    return { phase, cap, repair, available: cap - repair };
  });
}

// A slot is "future" when its time has not arrived yet (Thai time). AquaDAT can
// hold rows ahead of time (e.g. today's 24:00 filled in early) — those are not
// real readings, so the report treats them as missing.
function isFutureSlot(date, time) {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const today = now.toISOString().slice(0, 10);
  if (date < today) return false;
  if (date > today) return true;
  const slotMin = parseInt(time.slice(0, 2), 10) * 60 + parseInt(time.slice(3, 5) || '0', 10);
  return slotMin > now.getUTCHours() * 60 + now.getUTCMinutes();
}

// Copy of historyMap without the slots of `date` that are still in the future.
// Slot '00:00' is the previous day's 24:00 and is never future for a past/current day.
function dropFutureSlots(historyMap, date) {
  if (!historyMap) return historyMap;
  const out = {};
  for (const [sid, cfgs] of Object.entries(historyMap)) {
    out[sid] = {};
    for (const [cid, slots] of Object.entries(cfgs || {})) {
      const kept = {};
      for (const [slot, v] of Object.entries(slots || {})) {
        if (!isFutureSlot(date, slot)) kept[slot] = v;
      }
      out[sid][cid] = kept;
    }
  }
  return out;
}

// Sum that needs every part: any missing part → null (shown as N/A).
function sumStrict(...vals) {
  if (!vals.length || vals.some(v => v === null || v === undefined)) return null;
  return vals.reduce((a, b) => a + b, 0);
}

// Read a single value: historyMap first (AquaDAT), then node_records (SQLite)
function getValueAt(configparam_id, stationId, date, time, historyMap) {
  if (isFutureSlot(date, time)) return null;
  // Try historyMap (pre-fetched from AquaDAT)
  if (historyMap) {
    const stMap = historyMap[stationId];
    if (stMap) {
      const v = parseFloat(stMap[String(configparam_id)]?.[time]);
      if (!isNaN(v)) return v;
    }
  }
  // Fallback: SQLite node_records
  const db = getDb_();
  const trans_type = STATION_TYPE[stationId];
  const param_key = `${trans_type}_${configparam_id}`;
  const row = db.get(
    `SELECT trans_value FROM node_records
     WHERE param_key = ? AND trans_dtm = ? AND trans_time = ?
     LIMIT 1`,
    [param_key, date, time]
  );
  if (!row) return null;
  const v = parseFloat(row.trans_value);
  return isNaN(v) ? null : v;
}

// delta = value@"00:00" of (date+1) minus value@"00:00" of date
// When historyMap is present, use '24:00' of current date as end value —
// historyMap has no date dimension so asking for nextDate '00:00' returns
// the same start-of-day value, giving delta=0 incorrectly.
function getDelta(configparam_id, stationId, date, historyMap) {
  const v1 = getValueAt(configparam_id, stationId, date, '00:00', historyMap);
  let v2;
  const slot24 = historyMap?.[stationId]?.[String(configparam_id)]?.['24:00'];
  if (slot24 !== undefined) {
    v2 = parseFloat(slot24);
    if (isNaN(v2)) v2 = null;
  } else {
    const nextDate = addDays(date, 1);
    v2 = getValueAt(configparam_id, stationId, nextDate, '00:00', null);
  }
  if (v1 === null || v2 === null) return null;
  return v2 - v1;
}

// delta = value@"24:00" minus value@"00:00" of the same date (RWS 13-slot totalizers)
function getDayDelta(configparam_id, stationId, date, historyMap) {
  const v0  = getValueAt(configparam_id, stationId, date, '00:00', historyMap);
  const v24 = getValueAt(configparam_id, stationId, date, '24:00', historyMap);
  if (v0 === null || v24 === null) return null;
  return v24 - v0;
}

// sum of deltas for multiple cfgIds — every meter must have data, else null
function getDeltaSum(cfgIds, stationId, date, historyMap) {
  return sumStrict(...cfgIds.map(id => getDelta(id, stationId, date, historyMap)));
}

// sum of day-deltas (24:00 - 00:00) — every meter must have data, else null
function getDayDeltaSum(cfgIds, stationId, date, historyMap) {
  return sumStrict(...cfgIds.map(id => getDayDelta(id, stationId, date, historyMap)));
}

// min or max over trans_time "01:00"–"24:00"
function getMinMax(configparam_id, stationId, date, historyMap) {
  let vals = [];

  // Try historyMap first
  if (historyMap?.[stationId]?.[String(configparam_id)]) {
    const slotMap = historyMap[stationId][String(configparam_id)];
    vals = Object.entries(slotMap)
      .filter(([slot]) => slot >= '01:00' && slot <= '24:00')
      .map(([, v]) => parseFloat(v))
      .filter(v => !isNaN(v));
  }

  // Fallback: SQLite
  if (!vals.length) {
    const db = getDb_();
    const trans_type = STATION_TYPE[stationId];
    const param_key = `${trans_type}_${configparam_id}`;
    const rows = db.all(
      `SELECT trans_value FROM node_records
       WHERE param_key = ? AND trans_dtm = ? AND trans_time >= '01:00' AND trans_time <= '24:00'`,
      [param_key, date]
    );
    if (rows?.length) vals = rows.map(r => parseFloat(r.trans_value)).filter(v => !isNaN(v));
  }

  if (!vals.length) return { min: null, max: null };
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

// Chlorine line deltas: both lines needed. IN = rises, USE = drops (kg).
function clIn(a, b)  { return a === null || b === null ? null : Math.max(a, 0) + Math.max(b, 0); }
function clUse(a, b) { return a === null || b === null ? null : Math.max(-a, 0) + Math.max(-b, 0); }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nn(v, mult = 1) {
  return v === null ? null : v * mult;
}

function sumNullable(...vals) {
  const filtered = vals.filter(v => v !== null);
  if (!filtered.length) return null;
  return filtered.reduce((a, b) => a + b, 0);
}

// ─── Main computation ─────────────────────────────────────────────────────────

// historyMap: { [stationId]: { [configparam_id]: { [slot]: value_string } } }
// Pre-fetched from AquaDAT; falls back to SQLite node_records when null/missing.
// Flow-weighted average dosing rate over hourly slots 01:00–24:00
// flowStation: station where flowId lives (defaults to stationId if omitted)
function weightedAvgDR(flowId, drId, stationId, historyMap, flowStation) {
  const flowMap = historyMap?.[flowStation || stationId];
  const drMap   = historyMap?.[stationId];
  if (!flowMap || !drMap) return null;
  const flowSlots = flowMap[String(flowId)] || {};
  const drSlots   = drMap[String(drId)]   || {};
  let sumFD = 0, sumF = 0;
  for (let h = 1; h <= 24; h++) {
    const slot = String(h).padStart(2, '0') + ':00';
    const f  = parseFloat(flowSlots[slot]);
    const dr = parseFloat(drSlots[slot]);
    if (!isNaN(f) && !isNaN(dr) && f > 0 && dr > 0) { sumFD += f * dr; sumF += f; }
  }
  return sumF > 0 ? sumFD / sumF : null;
}

// Sum of (flow × DR) products — used as proportioning weight (no totalizer)
// flowStation: station where flowId lives (defaults to stationId if omitted)
function sumFlowDR(flowId, drId, stationId, historyMap, flowStation) {
  const flowMap = historyMap?.[flowStation || stationId];
  const drMap   = historyMap?.[stationId];
  if (!flowMap || !drMap) return null;
  const flowSlots = flowMap[String(flowId)] || {};
  const drSlots   = drMap[String(drId)]   || {};
  let sumFD = 0, hasAny = false;
  for (let h = 1; h <= 24; h++) {
    const slot = String(h).padStart(2, '0') + ':00';
    const f  = parseFloat(flowSlots[slot]);
    const dr = parseFloat(drSlots[slot]);
    if (!isNaN(f) && !isNaN(dr) && f > 0 && dr > 0) { sumFD += f * dr; hasAny = true; }
  }
  return hasAny ? sumFD : null;
}

// 2h net volume × DR — for chlorine where flow comes from totalizer delta (like formula 8384/8385/8386/8387)
// totId/totStation: the totalizer cfgId (e.g. 4 in RWS1); drId/drStation: the DR cfgId (e.g. 129 in CHEM1)
// Returns { sumFD: Σ(flow_2h × DR), sumF: Σ(flow_2h) } over slots where flow>0 and dr>0
function sumDeltaFlowDR(totId, totStation, drId, drStation, historyMap) {
  const totSlots = historyMap?.[totStation]?.[String(totId)] || {};
  const drSlots  = historyMap?.[drStation]?.[String(drId)]   || {};
  let sumFD = 0, sumF = 0;
  for (let h = 2; h <= 24; h += 2) {
    const cur  = String(h).padStart(2, '0') + ':00';
    const prev = String(h - 2).padStart(2, '0') + ':00';
    const tc = parseFloat(totSlots[cur]);
    const tp = parseFloat(totSlots[prev]);
    const dr = parseFloat(drSlots[cur]);
    if (isNaN(tc) || isNaN(tp) || isNaN(dr)) continue;
    const flow = (tc - tp) * 100;
    if (flow <= 0 || dr <= 0) continue;
    sumFD += flow * dr;
    sumF  += flow;
  }
  return { sumFD, sumF };
}

function computeDailyReport(date, settings, historyMap) {
  const h = dropFutureSlots(historyMap || null, date);

  const {
    chem_cost: { alum_ton = 0, pacl_ton = 0, chlorine_ton = 0, sludge_day = 0 } = {},
    energy_cost: { peak_price = 0, offpeak_price = 0, ft_price = 0, max_energy = 0, demand_kw = 0, service_charge = 312.24 } = {},
    rw_cost = 0,
    cwt_area_m2 = 48000,
  } = settings || {};

  const V  = (id, sid, t)    => getValueAt(id, sid, date,    t, h);
  const Vn = (id, sid, t)    => getValueAt(id, sid, addDays(date, 1), t, h);
  const MM = (id, sid)       => getMinMax(id, sid, date, h);

  // Chlorine tank consumed (kg): handles normal drain & tank-swap in same day
  const clLineUsed = (cfgId, sid) => {
    const v0  = V(cfgId, sid, '00:00');
    const v24 = V(cfgId, sid, '24:00');
    if (v0 === null || v24 === null) return null;
    const delta = v24 - v0;
    if (delta <= 0) return -delta;            // normal: tank drained
    const { min: minVal } = MM(cfgId, sid);  // swap: used = v00:00 - min(01:00..24:00)
    return minVal !== null ? v0 - minVal : null;
  };
  // Received quantity (chem/chlorine delivered) recorded at 24:00. No row on a
  // finished day = nothing was received (0); before 24:00 of today it is unknown (N/A).
  const RCV = (id, sid) => isFutureSlot(date, '24:00') ? null : (V(id, sid, '24:00') ?? 0);
  const DD  = (id, sid)      => getDayDelta(id, sid, date, h);
  const D   = (id, sid)      => getDelta(id, sid, date, h);
  const DS  = (ids, sid)     => getDeltaSum(ids, sid, date, h);
  const DDS = (ids, sid)     => getDayDeltaSum(ids, sid, date, h);

  // ── Card 1: Raw Water Intake ─────────────────────────────────────────────
  const rw_ph1 = nn(DD(4,  'RWS1'), 100); // RWS1 LINE A TOTALIZER
  const rw_ph2 = nn(DD(7,  'RWS1'), 100); // RWS1 LINE B TOTALIZER
  const rw_ph3 = nn(DD(42, 'RWS2'), 100); // RWS2 LINE C TOTALIZER
  const rw_ph4 = nn(DD(44, 'RWS2'), 100); // RWS2 LINE D TOTALIZER
  const rw_total = sumStrict(rw_ph1, rw_ph2, rw_ph3, rw_ph4);

  // ── Card 2: Water Level ──────────────────────────────────────────────────
  const cwt_at24 = nn(V(876, 'DPS', '24:00'), 0.01); // SUCTION LEVEL cfgId 876, unit cm → m
  const cwt_mm   = (() => { const m = MM(876, 'DPS'); return { min: nn(m.min, 0.01), max: nn(m.max, 0.01) }; })();
  const rw_mm    = MM(9, 'RWS1');

  // ── Card 3: TPS/DPS pumped ───────────────────────────────────────────────
  const dps_a    = nn(V(873, 'DPS', '24:00'), 100);
  const dps_b    = nn(V(875, 'DPS', '24:00'), 100);
  const tps      = nn(V(759, 'TPS', '24:00'), 100);
  const pumpTotal = sumStrict(dps_a, dps_b, tps);

  // ── Card 4: Pressure ─────────────────────────────────────────────────────
  const dps_press = MM(878, 'DPS');
  const tps_press = MM(809, 'TPS');

  // ── Card 5: CHEM1 PACl ───────────────────────────────────────────────────
  const pa1_a_delta = D(8405, 'CHEM1');
  const pa1_b_delta = D(8407, 'CHEM1');
  // m³ → TON (×1.19) applies to both tanks
  const pa1_net = nn(sumStrict(pa1_a_delta, pa1_b_delta), 1.19);
  const pa1_in  = RCV(8423, 'CHEM1');
  const pa1_out = pa1_in !== null && pa1_net !== null ? pa1_in - pa1_net : null;

  // ── Card 6: CHEM2 PACl ───────────────────────────────────────────────────
  const pa2_c_delta = D(8419, 'CHEM2');
  const pa2_d_delta = D(8421, 'CHEM2');
  const pa2_net = nn(sumStrict(pa2_c_delta, pa2_d_delta), 1.19);
  const pa2_in  = RCV(8424, 'CHEM2');
  const pa2_out = pa2_in !== null && pa2_net !== null ? pa2_in - pa2_net : null;

  // ── Card 7: CHEM1 Chlorine ───────────────────────────────────────────────
  const cl1_a = D(127, 'CHEM1');
  const cl1_b = D(128, 'CHEM1');
  const cl1_in  = clIn(cl1_a, cl1_b);
  const cl1_use = clUse(cl1_a, cl1_b);

  // ── Card 8: CHEM2 Chlorine ───────────────────────────────────────────────
  const cl2_c = D(190, 'CHEM2');
  const cl2_d = D(191, 'CHEM2');
  const cl2_in  = clIn(cl2_c, cl2_d);
  const cl2_use = clUse(cl2_c, cl2_d);

  // ── CHEM1 Alum USE by phase (totalizer-based) ────────────────────────────
  const alum1_A  = DD(88, 'CHEM1');   // totalizer P1: 24:00 - 00:00
  const alum1_B  = DD(91, 'CHEM1');   // totalizer P2: 24:00 - 00:00
  const alum1_C  = sumStrict(DD(93, 'CHEM1'), DD(96, 'CHEM1')); // tank delta
  const alum1_D  = RCV(8037, 'CHEM1'); // received (pattern 346)
  // D is tons, C is m³ → convert C to tons with ×1.33 before subtracting
  const alum1_net = alum1_D !== null && alum1_C !== null ? alum1_D - alum1_C * 1.33 : null;
  const alum1_AB  = alum1_A !== null && alum1_B !== null ? alum1_A + alum1_B : null;
  const alum_use_p1 = alum1_net !== null && alum1_AB ? (alum1_A ?? 0) / alum1_AB * alum1_net : null;
  const alum_use_p2 = alum1_net !== null && alum1_AB ? (alum1_B ?? 0) / alum1_AB * alum1_net : null;
  // actual dose (mg/L): USE_ton / 2 × 1e6 / raw_water_m3
  // CHEM1 uses RWS1 only: P1→ph1, P2→ph2
  const alum_actual_p1 = alum_use_p1 !== null && rw_ph1 ? alum_use_p1 / 2 * 1e6 / rw_ph1 : null;
  const alum_actual_p2 = alum_use_p2 !== null && rw_ph2 ? alum_use_p2 / 2 * 1e6 / rw_ph2 : null;

  // ── CHEM2 Alum USE by phase (totalizer-based) ────────────────────────────
  const alum2_A  = DD(150, 'CHEM2');  // totalizer P3: 24:00 - 00:00
  const alum2_B  = DD(153, 'CHEM2');  // totalizer P4: 24:00 - 00:00
  const alum2_C  = sumStrict(DD(155, 'CHEM2'), DD(158, 'CHEM2')); // tank delta
  const alum2_D  = RCV(8036, 'CHEM2'); // received (pattern 347)
  const alum2_net = alum2_D !== null && alum2_C !== null ? alum2_D - alum2_C * 1.33 : null;
  const alum2_AB  = alum2_A !== null && alum2_B !== null ? alum2_A + alum2_B : null;
  const alum_use_p3 = alum2_net !== null && alum2_AB ? (alum2_A ?? 0) / alum2_AB * alum2_net : null;
  const alum_use_p4 = alum2_net !== null && alum2_AB ? (alum2_B ?? 0) / alum2_AB * alum2_net : null;
  const alum_actual_p3 = alum_use_p3 !== null && rw_ph3 ? alum_use_p3 / 2 * 1e6 / rw_ph3 : null;
  const alum_actual_p4 = alum_use_p4 !== null && rw_ph4 ? alum_use_p4 / 2 * 1e6 / rw_ph4 : null;

  // ── CHEM1 PACl USE by phase (flow×DR proportion, no totalizer) ───────────
  // A/B = Σ(DR_pacl_p1/p2 × flow_p1/p2) used as split ratio
  const pacl1_A  = sumFlowDR(1, 8402, 'CHEM1', h, 'RWS1');   // P1: Σ(flow×DR_pacl)
  const pacl1_B  = sumFlowDR(2, 8404, 'CHEM1', h, 'RWS1');   // P2: Σ(flow×DR_pacl)
  const pacl1_C  = sumStrict(D(8405, 'CHEM1'), D(8407, 'CHEM1')); // tank A+B delta (m³)
  const pacl1_D  = RCV(8423, 'CHEM1');          // received (TON)
  const pacl1_net = pacl1_D !== null && pacl1_C !== null ? pacl1_D - pacl1_C * 1.19 : null;
  const pacl1_AB  = (pacl1_A ?? 0) + (pacl1_B ?? 0);
  const pacl_use_p1 = pacl1_net !== null && pacl1_AB > 0 ? (pacl1_A ?? 0) / pacl1_AB * pacl1_net : null;
  const pacl_use_p2 = pacl1_net !== null && pacl1_AB > 0 ? (pacl1_B ?? 0) / pacl1_AB * pacl1_net : null;
  const pacl_actual_p1 = pacl_use_p1 !== null && rw_ph1 ? pacl_use_p1 * 0.35 * 1e6 / rw_ph1 : null;
  const pacl_actual_p2 = pacl_use_p2 !== null && rw_ph2 ? pacl_use_p2 * 0.35 * 1e6 / rw_ph2 : null;

  // ── CHEM2 PACl USE by phase (flow×DR proportion, no totalizer) ───────────
  const pacl2_A  = sumFlowDR(39, 8416, 'CHEM2', h, 'RWS2');  // P3: Σ(flow×DR_pacl)
  const pacl2_B  = sumFlowDR(40, 8418, 'CHEM2', h, 'RWS2');  // P4: Σ(flow×DR_pacl)
  const pacl2_C  = sumStrict(D(8419, 'CHEM2'), D(8421, 'CHEM2')); // tank C+D delta (m³)
  const pacl2_D  = RCV(8424, 'CHEM2');          // received (TON)
  const pacl2_net = pacl2_D !== null && pacl2_C !== null ? pacl2_D - pacl2_C * 1.19 : null;
  const pacl2_AB  = (pacl2_A ?? 0) + (pacl2_B ?? 0);
  const pacl_use_p3 = pacl2_net !== null && pacl2_AB > 0 ? (pacl2_A ?? 0) / pacl2_AB * pacl2_net : null;
  const pacl_use_p4 = pacl2_net !== null && pacl2_AB > 0 ? (pacl2_B ?? 0) / pacl2_AB * pacl2_net : null;
  const pacl_actual_p3 = pacl_use_p3 !== null && rw_ph3 ? pacl_use_p3 * 0.35 * 1e6 / rw_ph3 : null;
  const pacl_actual_p4 = pacl_use_p4 !== null && rw_ph4 ? pacl_use_p4 * 0.35 * 1e6 / rw_ph4 : null;

  // ── CHEM1 Chlorine USE by phase ──────────────────────────────────────────
  // Weight (proportion): flow rate (m³/s, cfgId 1/2 in CHEM1) × DR  — same unit as weightedAvgDR
  // Denominator (actual): 2h totalizer delta (m³) from RWS1, only during active DR slots
  const cl1_wFD_preP1  = sumFlowDR(1, 129, 'CHEM1', h, 'RWS1') ?? 0;
  const cl1_wFD_preP2  = sumFlowDR(2, 131, 'CHEM1', h, 'RWS1') ?? 0;
  const cl1_wFD_postP1 = sumFlowDR(1, 133, 'CHEM1', h, 'RWS1') ?? 0;
  const cl1_wFD_postP2 = sumFlowDR(2, 135, 'CHEM1', h, 'RWS1') ?? 0;
  const cl1_net_kg = sumStrict(clLineUsed(127, 'CHEM1'), clLineUsed(128, 'CHEM1'));
  const cl1_wTot   = cl1_wFD_preP1 + cl1_wFD_preP2 + cl1_wFD_postP1 + cl1_wFD_postP2;
  const cl_use_pre_p1  = cl1_wTot > 0 && cl1_net_kg !== null ? cl1_wFD_preP1  / cl1_wTot * cl1_net_kg : null;
  const cl_use_pre_p2  = cl1_wTot > 0 && cl1_net_kg !== null ? cl1_wFD_preP2  / cl1_wTot * cl1_net_kg : null;
  const cl_use_post_p1 = cl1_wTot > 0 && cl1_net_kg !== null ? cl1_wFD_postP1 / cl1_wTot * cl1_net_kg : null;
  const cl_use_post_p2 = cl1_wTot > 0 && cl1_net_kg !== null ? cl1_wFD_postP2 / cl1_wTot * cl1_net_kg : null;
  // Actual denominator: 2h net volume (m³) during active DR slots only
  const cl1_rwPreP1  = sumDeltaFlowDR(4, 'RWS1', 129, 'CHEM1', h).sumF;
  const cl1_rwPreP2  = sumDeltaFlowDR(7, 'RWS1', 131, 'CHEM1', h).sumF;
  const cl1_rwPostP1 = sumDeltaFlowDR(4, 'RWS1', 133, 'CHEM1', h).sumF;
  const cl1_rwPostP2 = sumDeltaFlowDR(7, 'RWS1', 135, 'CHEM1', h).sumF;
  const cl_actual_pre_p1  = cl_use_pre_p1  != null && cl1_rwPreP1  > 0 ? cl_use_pre_p1  * 1000 / cl1_rwPreP1  : null;
  const cl_actual_pre_p2  = cl_use_pre_p2  != null && cl1_rwPreP2  > 0 ? cl_use_pre_p2  * 1000 / cl1_rwPreP2  : null;
  const cl_actual_post_p1 = cl_use_post_p1 != null && cl1_rwPostP1 > 0 ? cl_use_post_p1 * 1000 / cl1_rwPostP1 : null;
  const cl_actual_post_p2 = cl_use_post_p2 != null && cl1_rwPostP2 > 0 ? cl_use_post_p2 * 1000 / cl1_rwPostP2 : null;

  // ── CHEM2 Chlorine USE by phase ──────────────────────────────────────────
  // Weight: flow rate (cfgId 39/40 in CHEM2) × DR
  // Denominator: 2h totalizer delta from RWS2 (cfgId 42=LINE C, 44=LINE D)
  const cl2_wFD_preP3  = sumFlowDR(39, 192, 'CHEM2', h, 'RWS2') ?? 0;
  const cl2_wFD_preP4  = sumFlowDR(40, 194, 'CHEM2', h, 'RWS2') ?? 0;
  const cl2_wFD_postP3 = sumFlowDR(39, 196, 'CHEM2', h, 'RWS2') ?? 0;
  const cl2_wFD_postP4 = sumFlowDR(40, 198, 'CHEM2', h, 'RWS2') ?? 0;
  const cl2_net_kg = sumStrict(clLineUsed(190, 'CHEM2'), clLineUsed(191, 'CHEM2'));
  const cl2_wTot   = cl2_wFD_preP3 + cl2_wFD_preP4 + cl2_wFD_postP3 + cl2_wFD_postP4;
  const cl_use_pre_p3  = cl2_wTot > 0 && cl2_net_kg !== null ? cl2_wFD_preP3  / cl2_wTot * cl2_net_kg : null;
  const cl_use_pre_p4  = cl2_wTot > 0 && cl2_net_kg !== null ? cl2_wFD_preP4  / cl2_wTot * cl2_net_kg : null;
  const cl_use_post_p3 = cl2_wTot > 0 && cl2_net_kg !== null ? cl2_wFD_postP3 / cl2_wTot * cl2_net_kg : null;
  const cl_use_post_p4 = cl2_wTot > 0 && cl2_net_kg !== null ? cl2_wFD_postP4 / cl2_wTot * cl2_net_kg : null;
  const cl2_rwPreP3  = sumDeltaFlowDR(42, 'RWS2', 192, 'CHEM2', h).sumF;
  const cl2_rwPreP4  = sumDeltaFlowDR(44, 'RWS2', 194, 'CHEM2', h).sumF;
  const cl2_rwPostP3 = sumDeltaFlowDR(42, 'RWS2', 196, 'CHEM2', h).sumF;
  const cl2_rwPostP4 = sumDeltaFlowDR(44, 'RWS2', 198, 'CHEM2', h).sumF;
  const cl_actual_pre_p3  = cl_use_pre_p3  != null && cl2_rwPreP3  > 0 ? cl_use_pre_p3  * 1000 / cl2_rwPreP3  : null;
  const cl_actual_pre_p4  = cl_use_pre_p4  != null && cl2_rwPreP4  > 0 ? cl_use_pre_p4  * 1000 / cl2_rwPreP4  : null;
  const cl_actual_post_p3 = cl_use_post_p3 != null && cl2_rwPostP3 > 0 ? cl_use_post_p3 * 1000 / cl2_rwPostP3 : null;
  const cl_actual_post_p4 = cl_use_post_p4 != null && cl2_rwPostP4 > 0 ? cl_use_post_p4 * 1000 / cl2_rwPostP4 : null;

  // ── Card 9: CHEM1 ALUM ───────────────────────────────────────────────────
  const al1_a_delta = D(93, 'CHEM1');
  const al1_b_delta = D(96, 'CHEM1');
  const al1_net = nn(sumStrict(al1_a_delta, al1_b_delta), 1.33);
  const al1_in  = RCV(8037, 'CHEM1');
  const al1_out = al1_in !== null && al1_net !== null ? al1_in - al1_net : null;

  // ── Card 10: CHEM2 ALUM ──────────────────────────────────────────────────
  const al2_c_delta = D(155, 'CHEM2');
  const al2_d_delta = D(158, 'CHEM2');
  const al2_net = nn(sumStrict(al2_c_delta, al2_d_delta), 1.33);
  const al2_in  = RCV(8036, 'CHEM2');
  const al2_out = al2_in !== null && al2_net !== null ? al2_in - al2_net : null;

  // ── Card 11: Sludge ──────────────────────────────────────────────────────
  const sl_ph1 = sumStrict(V(205,  'CWS1', '24:00'), V(217,  'CWS1', '24:00')); // 1A+1B
  const sl_ph2 = sumStrict(V(229,  'CWS1', '24:00'), V(241,  'CWS1', '24:00')); // 2A+2B
  const sl_ph3 = sumStrict(V(6001, 'CWS2', '24:00'), V(6002, 'CWS2', '24:00')); // 3A+3B
  const sl_ph4 = sumStrict(V(6003, 'CWS2', '24:00'), V(6004, 'CWS2', '24:00')); // 4A+4B
  const sludge_total = sumStrict(sl_ph1, sl_ph2, sl_ph3, sl_ph4);

  // ── Card 12: Energy ──────────────────────────────────────────────────────
  const e_dps  = DDS([883, 885], 'DPS');
  const e_tps  = DDS([9278, 9277],   'TPS');   // SS1B Inc.1+Inc.2 from pattern 255
  const e_fws1 = DDS([9273, 9274],   'FWS1');
  const e_fws2 = DDS([9276, 9275],   'FWS2');
  const e_rws1 = DDS([33, 35],       'RWS1');
  const e_rws2 = DDS([75, 77],       'RWS2');
  const e_bldg = DDS([6775, 6776],   'TPS');  // SS3 Feeder from pattern 255
  const e_total = sumStrict(e_dps, e_tps, e_fws1, e_fws2, e_rws1, e_rws2);

  // TOU 4.2.2: On-Peak = Mon–Fri 09:00–22:00 (13 h, approximated as 13/24 of
  // the day's energy). Sat/Sun are Off-Peak all day. Public holidays are not
  // tracked — treated as normal weekdays (agreed simplification).
  const dow = new Date(date + 'T00:00:00Z').getUTCDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dow === 0 || dow === 6;
  const daysInMonth = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate();
  function peakOffPeak(total) {
    if (total === null) return { peak: null, offpeak: null, total: null };
    const peak = isWeekend ? 0 : total * (13 / 24);
    return { peak, offpeak: total - peak, total };
  }
  const ep_dps  = peakOffPeak(e_dps);
  const ep_tps  = peakOffPeak(e_tps);
  const ep_fws1 = peakOffPeak(e_fws1);
  const ep_fws2 = peakOffPeak(e_fws2);
  const ep_rws1 = peakOffPeak(e_rws1);
  const ep_rws2 = peakOffPeak(e_rws2);
  const ep_bldg = peakOffPeak(e_bldg);

  // Same basis as the reported ENERGY total (e_total): SS3 Bldg. is excluded.
  const totalPeak    = sumStrict(ep_dps.peak, ep_tps.peak, ep_fws1.peak, ep_fws2.peak, ep_rws1.peak, ep_rws2.peak);
  const totalOffPeak = sumStrict(ep_dps.offpeak, ep_tps.offpeak, ep_fws1.offpeak, ep_fws2.offpeak, ep_rws1.offpeak, ep_rws2.offpeak);

  let energy_cost_baht = null;
  let energyPerM3 = null;
  if (totalPeak !== null && totalOffPeak !== null) {
    const peak_kWh  = totalPeak * 1000;
    const offpk_kWh = totalOffPeak * 1000;
    // Monthly charges (demand kW × rate, service fee) are spread evenly per day.
    const demand_day  = (demand_kw * max_energy) / daysInMonth;
    const service_day = service_charge / daysInMonth;
    energy_cost_baht = peak_kWh * peak_price + offpk_kWh * offpeak_price
      + (peak_kWh + offpk_kWh) * ft_price + demand_day + service_day;
    energyPerM3 = pumpTotal ? energy_cost_baht / pumpTotal : null;
  }

  // ── Card 13: Chemical Remaining ──────────────────────────────────────────
  const rem_al1    = sumStrict(Vn(93,   'CHEM1', '00:00'), Vn(96,   'CHEM1', '00:00'));
  const rem_al2    = sumStrict(Vn(155,  'CHEM2', '00:00'), Vn(158,  'CHEM2', '00:00'));
  const rem_pa1    = sumStrict(Vn(8405, 'CHEM1', '00:00'), Vn(8407, 'CHEM1', '00:00'));
  const rem_pa2    = sumStrict(Vn(8419, 'CHEM2', '00:00'), Vn(8421, 'CHEM2', '00:00'));
  const rem_cl1_kg = sumStrict(Vn(127,  'CHEM1', '00:00'), Vn(128,  'CHEM1', '00:00'));
  const rem_cl2_kg = sumStrict(Vn(190,  'CHEM2', '00:00'), Vn(191,  'CHEM2', '00:00'));
  const drum_cl1   = Vn(6972, 'CHEM1', '00:00') ?? 0;
  const drum_cl2   = Vn(6973, 'CHEM2', '00:00') ?? 0;
  const rem_cl1_ton = rem_cl1_kg !== null ? rem_cl1_kg / 1000 + drum_cl1 : null;
  const rem_cl2_ton = rem_cl2_kg !== null ? rem_cl2_kg / 1000 + drum_cl2 : null;

  const flow1   = V(1,    'RWS1', '00:00');
  const flow2   = V(2,    'RWS1', '00:00');
  const flow3   = V(41,   'RWS2', '00:00');
  const flow4   = V(43,   'RWS2', '00:00');
  const doseAL1 = V(89,   'CHEM1', '00:00') ?? 20;
  const doseAL2 = V(92,   'CHEM1', '00:00') ?? 20;
  const doseAL3 = V(151,  'CHEM2', '00:00') ?? 20;
  const doseAL4 = V(154,  'CHEM2', '00:00') ?? 20;
  const dosePA1 = V(8402, 'CHEM1', '00:00') ?? 13;
  const dosePA2 = V(8404, 'CHEM1', '00:00') ?? 13;
  const dosePA3 = V(8416, 'CHEM2', '00:00') ?? 13;
  const dosePA4 = V(8418, 'CHEM2', '00:00') ?? 13;

  function daysRemaining(remVol, convFactor, flows, doses) {
    if (remVol === null) return null;
    const denom = flows.reduce((sum, f, i) => sum + (f ?? 0) * (doses[i] ?? 0), 0)
      * convFactor * 24 / 1000;
    return denom > 0 ? (remVol * convFactor) / denom : null;
  }

  const days_al12 = daysRemaining(rem_al1, 1.33, [flow1, flow2], [doseAL1, doseAL2]);
  const days_al34 = daysRemaining(rem_al2, 1.33, [flow3, flow4], [doseAL3, doseAL4]);
  const days_pa12 = daysRemaining(rem_pa1, 1.19, [flow1, flow2], [dosePA1, dosePA2]);
  const days_pa34 = daysRemaining(rem_pa2, 1.19, [flow3, flow4], [dosePA3, dosePA4]);

  // Chlorine: same projection as Alum/PACl — flow @00:00 × (Pre + Post) dose rate
  // per phase → ton/day (daysRemaining's unit); remaining in ton, conv 1. No dose data → 0 for that line.
  const doseCl = (id, sid) => V(id, sid, '00:00');
  const days_cl1 = daysRemaining(rem_cl1_ton, 1,
    [flow1, flow1, flow2, flow2],
    [doseCl(129, 'CHEM1'), doseCl(133, 'CHEM1'), doseCl(131, 'CHEM1'), doseCl(135, 'CHEM1')]);
  const days_cl2 = daysRemaining(rem_cl2_ton, 1,
    [flow3, flow3, flow4, flow4],
    [doseCl(192, 'CHEM2'), doseCl(196, 'CHEM2'), doseCl(194, 'CHEM2'), doseCl(198, 'CHEM2')]);

  // ── Water Loss ────────────────────────────────────────────────────────────
  const cwt_at00 = nn(V(876, 'DPS', '00:00'), 0.01);
  const deltaVol = cwt_at24 !== null && cwt_at00 !== null
    ? (cwt_at24 - cwt_at00) * cwt_area_m2 : null;
  const service_w = DD(6534, 'TPS'); // SERVICE WATER totalizer: 24:00 - 00:00
  let waterloss = null;
  if (rw_total && pumpTotal !== null && sludge_total !== null && service_w !== null && deltaVol !== null) {
    const numer = rw_total - pumpTotal - sludge_total - service_w - deltaVol;
    waterloss = (numer / rw_total) * 100;
  }

  // ── Cost per m³ ───────────────────────────────────────────────────────────
  const alum_use_ton = sumStrict(al1_out, al2_out);
  const pacl_use_ton = sumStrict(pa1_out, pa2_out);
  const cl_use_kg    = sumStrict(cl1_use, cl2_use);
  const cl_income = sumStrict(RCV(4333, 'CHEM1'), RCV(4339, 'CHEM2'));
  const cl_return = sumStrict(RCV(4334, 'CHEM1'), RCV(4340, 'CHEM2'));
  let total_cost_per_m3 = null;
  let chem_cost_per_m3  = null;
  let sludge_cost_per_m3 = null;
  let op_cost_per_m3    = null; // chem + energy + sludge, excludes raw-water cost
  // Any missing part → that cost is null (N/A), never a partial number.
  if (pumpTotal) {
    sludge_cost_per_m3 = sludge_day / pumpTotal;
    if (alum_use_ton !== null && pacl_use_ton !== null && cl_use_kg !== null) {
      chem_cost_per_m3 = (alum_use_ton * alum_ton + pacl_use_ton * pacl_ton
        + cl_use_kg * chlorine_ton / 1000) / pumpTotal;
    }
    op_cost_per_m3    = sumStrict(chem_cost_per_m3, energyPerM3, sludge_cost_per_m3);
    total_cost_per_m3 = op_cost_per_m3 !== null ? rw_cost + op_cost_per_m3 : null;
  }

  const filter_availability = getFilterAvailability(date, h);

  return {
    date,
    // false until the day's 24:00 has passed — day totals/averages are not final yet
    day_complete: !isFutureSlot(date, '24:00'),
    filter_availability,
    card1_raw_water: { phase1: rw_ph1, phase2: rw_ph2, phase3: rw_ph3, phase4: rw_ph4, total: rw_total },
    card2_water_level: {
      cwt_at24, cwt_min: cwt_mm.min, cwt_max: cwt_mm.max,
      rw_min: rw_mm.min, rw_max: rw_mm.max,
    },
    card3_pumped: { dps_lineA: dps_a, dps_lineB: dps_b, tps, total: pumpTotal },
    card4_pressure: {
      dps_min: nn(dps_press.min, 10), dps_max: nn(dps_press.max, 10),
      tps_min: nn(tps_press.min, 10), tps_max: nn(tps_press.max, 10),
    },
    card5_chem1_pacl: { tankA_delta: pa1_a_delta, tankB_delta: pa1_b_delta, net: pa1_net, in: pa1_in, out: pa1_out },
    card6_chem2_pacl: { tankC_delta: pa2_c_delta, tankD_delta: pa2_d_delta, net: pa2_net, in: pa2_in, out: pa2_out },
    card7_chem1_cl:   { lineA_delta: cl1_a, lineB_delta: cl1_b, in_kg: cl1_in, use_kg: cl1_use },
    card8_chem2_cl:   { lineC_delta: cl2_c, lineD_delta: cl2_d, in_kg: cl2_in, use_kg: cl2_use },
    cl_income,
    cl_return,
    card9_chem1_alum: { tankA_delta: al1_a_delta, tankB_delta: al1_b_delta, net: al1_net, in: al1_in, out: al1_out },
    card10_chem2_alum:{ tankC_delta: al2_c_delta, tankD_delta: al2_d_delta, net: al2_net, in: al2_in, out: al2_out },
    card11_sludge: { phase1: sl_ph1, phase2: sl_ph2, phase3: sl_ph3, phase4: sl_ph4, total: sludge_total },
    card12_energy: {
      dps: e_dps, tps: e_tps, fws1: e_fws1, fws2: e_fws2,
      rws1: e_rws1, rws2: e_rws2, bldg: e_bldg, total: e_total,
      peak_mwh: totalPeak, offpeak_mwh: totalOffPeak,
      cost_baht: energy_cost_baht,
    },
    card14_chem_dosing: {
      // CHEM#1 — P1(flow=1 in RWS1) / P2(flow=2 in RWS1)
      alum_p1:    weightedAvgDR(1, 89,   'CHEM1', h, 'RWS1'),
      alum_p2:    weightedAvgDR(2, 92,   'CHEM1', h, 'RWS1'),
      pacl_p1:    weightedAvgDR(1, 8402, 'CHEM1', h, 'RWS1'),
      pacl_p2:    weightedAvgDR(2, 8404, 'CHEM1', h, 'RWS1'),
      pre_cl_p1:  weightedAvgDR(1, 129,  'CHEM1', h, 'RWS1'),
      post_cl_p1: weightedAvgDR(1, 133,  'CHEM1', h, 'RWS1'),
      pre_cl_p2:  weightedAvgDR(2, 131,  'CHEM1', h, 'RWS1'),
      post_cl_p2: weightedAvgDR(2, 135,  'CHEM1', h, 'RWS1'),
      // CHEM#2 — P3(flow=39 in RWS2) / P4(flow=40 in RWS2)
      alum_p3:    weightedAvgDR(39, 151,  'CHEM2', h, 'RWS2'),
      alum_p4:    weightedAvgDR(40, 154,  'CHEM2', h, 'RWS2'),
      pacl_p3:    weightedAvgDR(39, 8416, 'CHEM2', h, 'RWS2'),
      pacl_p4:    weightedAvgDR(40, 8418, 'CHEM2', h, 'RWS2'),
      pre_cl_p3:  weightedAvgDR(39, 192,  'CHEM2', h, 'RWS2'),
      post_cl_p3: weightedAvgDR(39, 196,  'CHEM2', h, 'RWS2'),
      pre_cl_p4:  weightedAvgDR(40, 194,  'CHEM2', h, 'RWS2'),
      post_cl_p4: weightedAvgDR(40, 198,  'CHEM2', h, 'RWS2'),
      // CHEM1 Alum USE (TON) and actual dose (mg/L)
      alum_use_p1, alum_use_p2,
      alum_actual_p1, alum_actual_p2,
      // CHEM2 Alum USE (TON) and actual dose (mg/L)
      alum_use_p3, alum_use_p4,
      alum_actual_p3, alum_actual_p4,
      // CHEM1 PACl USE (TON) and actual dose (mg/L)
      pacl_use_p1, pacl_use_p2,
      pacl_actual_p1, pacl_actual_p2,
      // CHEM2 PACl USE (TON) and actual dose (mg/L)
      pacl_use_p3, pacl_use_p4,
      pacl_actual_p3, pacl_actual_p4,
      // CHEM1 Chlorine USE (kg) and actual dose (mg/L)
      cl_use_pre_p1, cl_use_post_p1, cl_use_pre_p2, cl_use_post_p2,
      cl_actual_pre_p1, cl_actual_post_p1, cl_actual_pre_p2, cl_actual_post_p2,
      // CHEM2 Chlorine USE (kg) and actual dose (mg/L)
      cl_use_pre_p3, cl_use_post_p3, cl_use_pre_p4, cl_use_post_p4,
      cl_actual_pre_p3, cl_actual_post_p3, cl_actual_pre_p4, cl_actual_post_p4,
    },
    card13_chem_remaining: {
      alum: { chem1_m3: rem_al1, chem2_m3: rem_al2, days_ph12: days_al12, days_ph34: days_al34 },
      pacl: { chem1_m3: rem_pa1, chem2_m3: rem_pa2, days_ph12: days_pa12, days_ph34: days_pa34 },
      chlorine: { chem1_ton: rem_cl1_ton, chem2_ton: rem_cl2_ton, days_chem1: days_cl1, days_chem2: days_cl2 },
    },
    summary: {
      water_loss_pct: waterloss,
      service_water_m3: service_w,
      delta_cwt_vol_m3: deltaVol,
      energy_per_m3: energyPerM3,
      chem_cost_per_m3,
      sludge_cost_per_m3,
      op_cost_per_m3,
      total_cost_per_m3,
      total_cost_baht: total_cost_per_m3 && pumpTotal ? total_cost_per_m3 * pumpTotal : null,
    },
  };
}

// Exact configIDs that computeDailyReport reads from historyMap, per station.
// Used to limit Uroboros/AquaDAT fetches to only what daily report needs.
const DR_CONFIGIDS = {
  RWS1:  [1, 2, 4, 7, 9, 33, 35],
  RWS2:  [39, 40, 41, 42, 43, 44, 75, 77],
  CHEM1: [88, 89, 91, 92, 93, 96, 127, 128, 129, 131, 133, 135,
          8037, 8402, 8404, 8405, 8407, 8423, 4333, 4334],
  CHEM2: [150, 151, 153, 154, 155, 158, 190, 191, 192, 194, 196, 198,
          8036, 8416, 8418, 8419, 8421, 8424, 4339, 4340],
  TPS:   [759, 809, 6534, 6775, 6776, 9277, 9278],
  DPS:   [873, 875, 876, 878, 883, 885],
  FWS1:  [
    // REPAIR status (existing)
    314, 324, 334, 344, 354, 364, 374, 384,
    396, 406, 416, 426, 436, 446, 456, 466,
    9273, 9274,
    // BACKWASHING P#12 — Phase 1 beds 1-8 (base 317, stride 10, offsets +0+1+2+3+5+6)
    317,318,319,320,322,323, 327,328,329,330,332,333,
    337,338,339,340,342,343, 347,348,349,350,352,353,
    357,358,359,360,362,363, 367,368,369,370,372,373,
    377,378,379,380,382,383, 387,388,389,390,392,393,
    // BACKWASHING P#12 — Phase 2 beds 9-16 (base 399)
    399,400,401,402,404,405, 409,410,411,412,414,415,
    419,420,421,422,424,425, 429,430,431,432,434,435,
    439,440,441,442,444,445, 449,450,451,452,454,455,
    459,460,461,462,464,465, 469,470,471,472,474,475,
  ],
  FWS2:  [
    // REPAIR status (existing)
    476, 486, 496, 506, 516, 526, 536, 546, 556, 566, 576, 586, 596, 606,
    618, 628, 638, 648, 658, 668, 678, 688, 698, 708, 718, 728, 738, 748,
    9275, 9276,
    // BACKWASHING P#3 — 14 beds (base 479, stride 10, offsets +0+1+3+5+6; level IDs separate)
    479,480,482,484,485, 489,490,492,494,495,
    499,500,502,504,505, 509,510,512,514,515,
    519,520,522,524,525, 529,530,532,534,535,
    539,540,542,544,545, 549,550,552,554,555,
    559,560,562,564,565, 569,570,572,574,575,
    579,580,582,584,585, 589,590,592,594,595,
    599,600,602,604,605, 609,610,612,614,615,
    // P#3 level IDs (non-stride)
    7944,7951,7945,7952,7946,7953,7947,7954,7948,7955,7949,7956,7950,7957,
    // BACKWASHING P#4 — 14 beds (base 621, stride 10)
    621,622,624,626,627, 631,632,634,636,637,
    641,642,644,646,647, 651,652,654,656,657,
    661,662,664,666,667, 671,672,674,676,677,
    681,682,684,686,687, 691,692,694,696,697,
    701,702,704,706,707, 711,712,714,716,717,
    721,722,724,726,727, 731,732,734,736,737,
    741,742,744,746,747, 751,752,754,756,757,
    // P#4 level IDs (non-stride)
    7958,7965,7959,7966,7960,7967,7961,7968,7962,7969,7963,7970,7964,7971,
  ],
  CWS1:  [205, 217, 229, 241],
  CWS2:  [6001, 6002, 6003, 6004],
};

// ── DailyLab form: "Daily Dosage in Plant (mg/l)" ← ACTUAL dose of card14 ──
// Rows: 4 Alum · 5 PACl · 7 Pre Cl2 · 9 Post Cl2 (8 Intermediate Cl2: not dosed → blank)
// Columns X/Y/Z/AA = Phase 1–4. Day not finished or value missing → cell left blank.
const DAILYLAB_DOSAGE = [
  { row: 4, keys: ['alum_actual_p1', 'alum_actual_p2', 'alum_actual_p3', 'alum_actual_p4'] },
  { row: 5, keys: ['pacl_actual_p1', 'pacl_actual_p2', 'pacl_actual_p3', 'pacl_actual_p4'] },
  { row: 7, keys: ['cl_actual_pre_p1', 'cl_actual_pre_p2', 'cl_actual_pre_p3', 'cl_actual_pre_p4'] },
  { row: 9, keys: ['cl_actual_post_p1', 'cl_actual_post_p2', 'cl_actual_post_p3', 'cl_actual_post_p4'] },
];
const DAILYLAB_PHASE_COLS = ['X', 'Y', 'Z', 'AA'];

function dailyLabDosageCells(report) {
  const cells = {};
  if (!report || report.day_complete === false) return cells;
  const cd = report.card14_chem_dosing || {};
  for (const { row, keys } of DAILYLAB_DOSAGE) {
    keys.forEach((k, i) => {
      const v = cd[k];
      if (typeof v === 'number' && Number.isFinite(v)) cells[`${DAILYLAB_PHASE_COLS[i]}${row}`] = Math.round(v * 100) / 100;
    });
  }
  return cells;
}

module.exports = { computeDailyReport, DR_CONFIGIDS, dailyLabDosageCells };
