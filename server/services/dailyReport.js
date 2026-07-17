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

// Read a single value from node_records (local first, no AquaDAT fallback for now)
function getValueAt(configparam_id, stationId, date, time) {
  const db = getDb_();
  const trans_type = STATION_TYPE[stationId];
  // param_key = "<trans_type>_<configparam_id>" matching write.js convention
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
function getDelta(configparam_id, stationId, date) {
  const nextDate = addDays(date, 1);
  const v1 = getValueAt(configparam_id, stationId, date, '00:00');
  const v2 = getValueAt(configparam_id, stationId, nextDate, '00:00');
  if (v1 === null || v2 === null) return null;
  return v2 - v1;
}

// sum of deltas for multiple cfgIds
function getDeltaSum(cfgIds, stationId, date) {
  let total = 0;
  let hasAny = false;
  for (const id of cfgIds) {
    const d = getDelta(id, stationId, date);
    if (d !== null) { total += d; hasAny = true; }
  }
  return hasAny ? total : null;
}

// min or max over trans_time "01:00"–"24:00"
function getMinMax(configparam_id, stationId, date) {
  const db = getDb_();
  const trans_type = STATION_TYPE[stationId];
  const param_key = `${trans_type}_${configparam_id}`;
  const rows = db.all(
    `SELECT trans_value FROM node_records
     WHERE param_key = ? AND trans_dtm = ? AND trans_time >= '01:00' AND trans_time <= '24:00'`,
    [param_key, date]
  );
  if (!rows || rows.length === 0) return { min: null, max: null };
  const vals = rows.map(r => parseFloat(r.trans_value)).filter(v => !isNaN(v));
  if (!vals.length) return { min: null, max: null };
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

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

function computeDailyReport(date, settings) {
  const {
    chem_cost: { alum_ton = 0, pacl_ton = 0, chlorine_ton = 0, sludge_day = 0 } = {},
    energy_cost: { peak_price = 0, offpeak_price = 0, ft_price = 0, max_energy = 0 } = {},
    rw_cost = 0,
    // cross-section area of CWT tank (m²) — used to convert Δlevel (m) → Δvolume (m³)
    cwt_area_m2 = 48000,
  } = settings || {};

  // ── Card 1: Raw Water Intake ─────────────────────────────────────────────
  const rw_ph1 = nn(getDelta(4, 'RWS1', date), 100);
  const rw_ph2 = nn(getDelta(7, 'RWS1', date), 100);
  const rw_ph3 = nn(getDelta(42, 'RWS2', date), 100);
  const rw_ph4 = nn(getDelta(44, 'RWS2', date), 100);
  const rw_total = sumNullable(rw_ph1, rw_ph2, rw_ph3, rw_ph4);

  // ── Card 2: Water Level ──────────────────────────────────────────────────
  const cwt_at24 = getValueAt(8469, 'DPS', date, '24:00');
  const cwt_mm = getMinMax(8469, 'DPS', date);
  const rw_mm = getMinMax(9, 'RWS1', date);

  // ── Card 3: TPS/DPS pumped ───────────────────────────────────────────────
  const dps_a = nn(getValueAt(873, 'DPS', date, '24:00'), 100);
  const dps_b = nn(getValueAt(875, 'DPS', date, '24:00'), 100);
  const tps   = nn(getValueAt(759, 'TPS', date, '24:00'), 100);
  const pumpTotal = sumNullable(dps_a, dps_b, tps);

  // ── Card 4: Pressure ─────────────────────────────────────────────────────
  const dps_press = getMinMax(878, 'DPS', date);
  const tps_press = getMinMax(809, 'TPS', date);

  // ── Card 5: CHEM1 PACl ───────────────────────────────────────────────────
  const pa1_a_delta = getDelta(8405, 'CHEM1', date);
  const pa1_b_delta = getDelta(8407, 'CHEM1', date);
  const pa1_net = sumNullable(pa1_a_delta, pa1_b_delta) !== null
    ? (pa1_a_delta ?? 0) + (pa1_b_delta ?? 0) * 1.19 : null;
  const pa1_in  = getValueAt(8423, 'CHEM1', date, '24:00');
  const pa1_out = pa1_in !== null && pa1_net !== null ? pa1_in - pa1_net : null;

  // ── Card 6: CHEM2 PACl ───────────────────────────────────────────────────
  const pa2_c_delta = getDelta(8419, 'CHEM2', date);
  const pa2_d_delta = getDelta(8421, 'CHEM2', date);
  const pa2_net = sumNullable(pa2_c_delta, pa2_d_delta) !== null
    ? (pa2_c_delta ?? 0) + (pa2_d_delta ?? 0) * 1.19 : null;
  const pa2_in  = getValueAt(8424, 'CHEM2', date, '24:00');
  const pa2_out = pa2_in !== null && pa2_net !== null ? pa2_in - pa2_net : null;

  // ── Card 7: CHEM1 Chlorine ───────────────────────────────────────────────
  const cl1_a = getDelta(127, 'CHEM1', date);
  const cl1_b = getDelta(128, 'CHEM1', date);
  const cl1_in  = [cl1_a, cl1_b].filter(v => v !== null && v > 0).reduce((a, b) => a + b, 0) || null;
  const cl1_use = [cl1_a, cl1_b].filter(v => v !== null && v < 0).reduce((a, b) => a + Math.abs(b), 0) || null;

  // ── Card 8: CHEM2 Chlorine ───────────────────────────────────────────────
  const cl2_c = getDelta(190, 'CHEM2', date);
  const cl2_d = getDelta(191, 'CHEM2', date);
  const cl2_in  = [cl2_c, cl2_d].filter(v => v !== null && v > 0).reduce((a, b) => a + b, 0) || null;
  const cl2_use = [cl2_c, cl2_d].filter(v => v !== null && v < 0).reduce((a, b) => a + Math.abs(b), 0) || null;

  // ── Card 9: CHEM1 ALUM ───────────────────────────────────────────────────
  const al1_a_delta = getDelta(93, 'CHEM1', date);
  const al1_b_delta = getDelta(96, 'CHEM1', date);
  const al1_net = sumNullable(al1_a_delta, al1_b_delta) !== null
    ? ((al1_a_delta ?? 0) + (al1_b_delta ?? 0)) * 1.33 : null;
  const al1_in  = getValueAt(8037, 'CHEM1', date, '24:00');
  const al1_out = al1_in !== null && al1_net !== null ? al1_in - al1_net : null;

  // ── Card 10: CHEM2 ALUM ──────────────────────────────────────────────────
  const al2_c_delta = getDelta(155, 'CHEM2', date);
  const al2_d_delta = getDelta(158, 'CHEM2', date);
  const al2_net = sumNullable(al2_c_delta, al2_d_delta) !== null
    ? ((al2_c_delta ?? 0) + (al2_d_delta ?? 0)) * 1.33 : null;
  const al2_in  = getValueAt(8036, 'CHEM2', date, '24:00');
  const al2_out = al2_in !== null && al2_net !== null ? al2_in - al2_net : null;

  // ── Card 11: Sludge ──────────────────────────────────────────────────────
  const sl_ph1 = sumNullable(
    getValueAt(205, 'CWS1', date, '24:00'),
    getValueAt(217, 'CWS1', date, '24:00')
  );
  const sl_ph2 = sumNullable(
    getValueAt(229, 'CWS1', date, '24:00'),
    getValueAt(241, 'CWS1', date, '24:00')
  );
  const sl_ph3 = sumNullable(
    getValueAt(6001, 'CWS2', date, '24:00'),
    getValueAt(6002, 'CWS2', date, '24:00')
  );
  const sl_ph4 = sumNullable(
    getValueAt(6003, 'CWS2', date, '24:00'),
    getValueAt(6004, 'CWS2', date, '24:00')
  );
  const sludge_total = sumNullable(sl_ph1, sl_ph2, sl_ph3, sl_ph4);

  // ── Card 12: Energy ──────────────────────────────────────────────────────
  const e_dps  = getDeltaSum([883, 885], 'DPS', date);
  const e_tps  = getDeltaSum([9277, 9278], 'TPS', date);
  const e_fws1 = getDeltaSum([9273, 9274], 'FWS1', date);
  const e_fws2 = getDeltaSum([9276, 9275], 'FWS2', date);
  const e_rws1 = getDeltaSum([33, 35], 'RWS1', date);
  const e_rws2 = getDeltaSum([75, 77], 'RWS2', date);
  const e_bldg = getDeltaSum([6775, 6776], 'TPS', date);
  const e_total = sumNullable(e_dps, e_tps, e_fws1, e_fws2, e_rws1, e_rws2, e_bldg);

  // Peak/OffPeak
  function peakOffPeak(stationId, cfgIds) {
    const total = getDeltaSum(cfgIds, stationId, date);
    if (total === null) return { peak: null, offpeak: null, total: null };
    // Approximate 13/24 peak ratio for all stations (full peak calculation needs per-meter readings)
    const peak = total * (13 / 24);
    return { peak, offpeak: total - peak, total };
  }
  const ep_dps  = peakOffPeak('DPS',  [883, 885]);
  const ep_tps  = peakOffPeak('TPS',  [9277, 9278]);
  const ep_fws1 = peakOffPeak('FWS1', [9273, 9274]);
  const ep_fws2 = peakOffPeak('FWS2', [9276, 9275]);
  const ep_rws1 = peakOffPeak('RWS1', [33, 35]);
  const ep_rws2 = peakOffPeak('RWS2', [75, 77]);
  const ep_bldg = peakOffPeak('TPS',  [6775, 6776]);

  const totalPeak    = sumNullable(ep_dps.peak, ep_tps.peak, ep_fws1.peak, ep_fws2.peak, ep_rws1.peak, ep_rws2.peak, ep_bldg.peak);
  const totalOffPeak = sumNullable(ep_dps.offpeak, ep_tps.offpeak, ep_fws1.offpeak, ep_fws2.offpeak, ep_rws1.offpeak, ep_rws2.offpeak, ep_bldg.offpeak);

  let energy_cost_baht = null;
  let energyPerM3 = null;
  if (totalPeak !== null && totalOffPeak !== null) {
    const peak_kWh   = totalPeak * 1000;
    const offpk_kWh  = totalOffPeak * 1000;
    energy_cost_baht = peak_kWh * peak_price + offpk_kWh * offpeak_price
      + (peak_kWh + offpk_kWh) * ft_price + max_energy + 312.24;
    energyPerM3 = pumpTotal ? energy_cost_baht / pumpTotal : null;
  }

  // ── Card 13: Chemical Remaining ──────────────────────────────────────────
  const nextDate = addDays(date, 1);
  const rem_al1 = sumNullable(
    getValueAt(93, 'CHEM1', nextDate, '00:00'),
    getValueAt(96, 'CHEM1', nextDate, '00:00')
  );
  const rem_al2 = sumNullable(
    getValueAt(155, 'CHEM2', nextDate, '00:00'),
    getValueAt(158, 'CHEM2', nextDate, '00:00')
  );
  const rem_pa1 = sumNullable(
    getValueAt(8405, 'CHEM1', nextDate, '00:00'),
    getValueAt(8407, 'CHEM1', nextDate, '00:00')
  );
  const rem_pa2 = sumNullable(
    getValueAt(8419, 'CHEM2', nextDate, '00:00'),
    getValueAt(8421, 'CHEM2', nextDate, '00:00')
  );
  const rem_cl1_kg = sumNullable(
    getValueAt(127, 'CHEM1', nextDate, '00:00'),
    getValueAt(128, 'CHEM1', nextDate, '00:00')
  );
  const rem_cl2_kg = sumNullable(
    getValueAt(190, 'CHEM2', nextDate, '00:00'),
    getValueAt(191, 'CHEM2', nextDate, '00:00')
  );
  const drum_cl1 = getValueAt(6972, 'CHEM1', nextDate, '00:00') ?? 0;
  const drum_cl2 = getValueAt(6973, 'CHEM2', nextDate, '00:00') ?? 0;
  const rem_cl1_ton = rem_cl1_kg !== null ? rem_cl1_kg / 1000 + drum_cl1 : null;
  const rem_cl2_ton = rem_cl2_kg !== null ? rem_cl2_kg / 1000 + drum_cl2 : null;

  // Days remaining calculation
  const flow1 = getValueAt(1, 'RWS1', date, '00:00');
  const flow2 = getValueAt(2, 'RWS1', date, '00:00');
  const flow3 = getValueAt(41, 'RWS2', date, '00:00');
  const flow4 = getValueAt(43, 'RWS2', date, '00:00');
  const doseAL1 = getValueAt(89,  'CHEM1', date, '00:00') ?? 20;
  const doseAL2 = getValueAt(92,  'CHEM1', date, '00:00') ?? 20;
  const doseAL3 = getValueAt(151, 'CHEM2', date, '00:00') ?? 20;
  const doseAL4 = getValueAt(154, 'CHEM2', date, '00:00') ?? 20;
  const dosePA1 = getValueAt(8402, 'CHEM1', date, '00:00') ?? 13;
  const dosePA2 = getValueAt(8404, 'CHEM1', date, '00:00') ?? 13;
  const dosePA3 = getValueAt(8416, 'CHEM2', date, '00:00') ?? 13;
  const dosePA4 = getValueAt(8418, 'CHEM2', date, '00:00') ?? 13;

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

  // ── Water Loss ────────────────────────────────────────────────────────────
  const cwt_at00 = getValueAt(8469, 'DPS', date, '00:00');
  const deltaVol = cwt_at24 !== null && cwt_at00 !== null
    ? (cwt_at24 - cwt_at00) * cwt_area_m2 : null;
  const service_w = getDelta(6534, 'TPS', date);
  let waterloss = null;
  if (rw_total && pumpTotal !== null && sludge_total !== null && deltaVol !== null) {
    const numer = rw_total - pumpTotal - (sludge_total ?? 0) - (service_w ?? 0) - deltaVol;
    waterloss = (numer / rw_total) * 100;
  }

  // ── Cost per m³ ───────────────────────────────────────────────────────────
  const alum_use_ton = sumNullable(al1_out, al2_out);
  const pacl_use_ton = sumNullable(pa1_out, pa2_out);
  const cl_use_kg    = sumNullable(cl1_use, cl2_use);
  let total_cost_per_m3 = null;
  let chem_cost_per_m3  = null;
  if (pumpTotal) {
    const alum_c = alum_use_ton !== null ? alum_use_ton * alum_ton / pumpTotal : 0;
    const pacl_c = pacl_use_ton !== null ? pacl_use_ton * pacl_ton / pumpTotal : 0;
    const cl_c   = cl_use_kg   !== null ? cl_use_kg * chlorine_ton / 1000 / pumpTotal : 0;
    const sl_c   = pumpTotal   !== null ? sludge_day / pumpTotal : 0;
    chem_cost_per_m3  = alum_c + pacl_c + cl_c;
    total_cost_per_m3 = rw_cost + (energyPerM3 ?? 0) + sl_c + chem_cost_per_m3;
  }

  return {
    date,
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
    card9_chem1_alum: { tankA_delta: al1_a_delta, tankB_delta: al1_b_delta, net: al1_net, in: al1_in, out: al1_out },
    card10_chem2_alum:{ tankC_delta: al2_c_delta, tankD_delta: al2_d_delta, net: al2_net, in: al2_in, out: al2_out },
    card11_sludge: { phase1: sl_ph1, phase2: sl_ph2, phase3: sl_ph3, phase4: sl_ph4, total: sludge_total },
    card12_energy: {
      dps: e_dps, tps: e_tps, fws1: e_fws1, fws2: e_fws2,
      rws1: e_rws1, rws2: e_rws2, bldg: e_bldg, total: e_total,
      peak_mwh: totalPeak, offpeak_mwh: totalOffPeak,
      cost_baht: energy_cost_baht,
    },
    card13_chem_remaining: {
      alum: { chem1_m3: rem_al1, chem2_m3: rem_al2, days_ph12: days_al12, days_ph34: days_al34 },
      pacl: { chem1_m3: rem_pa1, chem2_m3: rem_pa2, days_ph12: days_pa12, days_ph34: days_pa34 },
      chlorine: { chem1_ton: rem_cl1_ton, chem2_ton: rem_cl2_ton },
    },
    summary: {
      water_loss_pct: waterloss,
      service_water_m3: service_w,
      delta_cwt_vol_m3: deltaVol,
      energy_per_m3: energyPerM3,
      chem_cost_per_m3,
      total_cost_per_m3,
      total_cost_baht: total_cost_per_m3 && pumpTotal ? total_cost_per_m3 * pumpTotal : null,
    },
  };
}

module.exports = { computeDailyReport };
