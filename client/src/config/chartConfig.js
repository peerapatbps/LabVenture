// Chart configuration — edit this file to change endpoints, refresh rate, or filter/threshold mappings.

export const CHART_REFRESH_MS = 15 * 60 * 1000; // 15 minutes

const BASE = import.meta.env.PROD ? '/labventure' : '';
// Proxy endpoint in LabVenture server → forwards to BellBeast /api/lab/summary
export const LAB_CHART_ENDPOINT = `${BASE}/api/lab/chart`;

// ── Threshold rules ────────────────────────────────────────────────────────
// type:'max'   → exceeded when value > max
// type:'range' → exceeded when value < min OR value > max
//
// Scenario overrides: only the keys that DIFFER from _base are listed.
// Unrecognised scenario names fall back to _base.

export const CHART_THRESHOLDS = {
  _base: {
    rw_turbid:          { type: 'max',   max: 100  },
    cw_turbid:          { type: 'max',   max: 5    },
    cw_pre_cl:          { type: 'max',   max: 0.3  },
    fw_turbid:          { type: 'max',   max: 1    },
    tw_turbid:          { type: 'max',   max: 1    },
    tw_pos_cl:          { type: 'range', min: 1.0, max: 1.4 },
    tw_pos_cl_epidemic: { type: 'range', min: 1.4, max: 1.8 },
  },
  // น้ำด้อยคุณภาพระดับเฝ้าระวัง / สาหร่ายอุดตันบ่อกรองระดับเฝ้าระวัง
  'น้ำด้อยคุณภาพระดับเฝ้าระวัง':         { cw_turbid: { type: 'max', max: 3 } },
  'สาหร่ายอุดตันบ่อกรองระดับเฝ้าระวัง': { cw_turbid: { type: 'max', max: 3 } },
  // น้ำด้อยคุณภาพระดับวิกฤติ / สาหร่ายอุดตันบ่อกรองระดับวิกฤติ
  'น้ำด้อยคุณภาพระดับวิกฤติ':         { cw_turbid: { type: 'max', max: 2 } },
  'สาหร่ายอุดตันบ่อกรองระดับวิกฤติ': { cw_turbid: { type: 'max', max: 2 } },
};

// Returns the effective threshold rule for a given filter, scenario, and epidemic state.
export function getThreshold(filterKey, scenarioName, isEpidemic) {
  const base = CHART_THRESHOLDS._base;
  const overrides = CHART_THRESHOLDS[scenarioName] || {};

  if (filterKey === 'tw_pos_cl') {
    return isEpidemic ? base.tw_pos_cl_epidemic : base.tw_pos_cl;
  }

  return overrides[filterKey] ?? base[filterKey] ?? null;
}

// yAxis config:
//   { min, max }           — fixed range
//   { min }                — fixed min, auto max
//   { normal, epidemic }   — range switches with epidemic toggle
//                            each sub-object is { min, max }
//
// All filters without a yAxis entry use recharts 'auto' domain.

export const MINI_FILTERS = [
  // ── Turbidity group ──
  {
    key: 'rw_turbid',
    label: 'RW\nTurbid',
    unit: 'NTU',
    singleChart: true,
    yAxis: { min: 0 },
    cards: [
      { title: 'RW Turbid',    paramKey: 'RW.turb' },
      { title: 'RW Turbid #2', paramKey: 'RW.turb' },
      { title: 'RW Turbid #3', paramKey: 'RW.turb' },
      { title: 'RW Turbid #4', paramKey: 'RW.turb' },
    ],
  },
  {
    key: 'cw_turbid',
    label: 'CW\nTurbid',
    unit: 'NTU',
    singleChart: false,
    yAxis: { min: 0 },
    cards: [
      { title: 'CW Turbid #1', paramKey: 'CW1.turb' },
      { title: 'CW Turbid #2', paramKey: 'CW2_A.turb' },
      { title: 'CW Turbid #3', paramKey: 'CW3.turb' },
      { title: 'CW Turbid #4', paramKey: 'CW4.turb' },
    ],
  },
  {
    key: 'fw_turbid',
    label: 'FW\nTurbid',
    unit: 'NTU',
    singleChart: false,
    yAxis: { min: 0 },
    cards: [
      { title: 'FW Turbid #1', paramKey: 'FW1.turb' },
      { title: 'FW Turbid #2', paramKey: 'FW2.turb' },
      { title: 'FW Turbid #3', paramKey: 'FW3.turb' },
      { title: 'FW Turbid #4', paramKey: 'FW4.turb' },
    ],
  },
  {
    key: 'tw_turbid',
    label: 'TW\nTurbid',
    unit: 'NTU',
    singleChart: false,
    yAxis: { min: 0 },
    cards: [
      { title: 'TW Turbid #1', paramKey: 'TW1.turb' },
      { title: 'TW Turbid #2', paramKey: 'TW2.turb' },
      { title: 'TW Turbid #3', paramKey: 'TW3.turb' },
      { title: 'TW Turbid #4', paramKey: 'TW4.turb' },
    ],
  },
  // ── Chlorine group ──
  {
    key: 'cw_pre_cl',
    label: 'CW\nPre CL',
    unit: 'mg/L',
    singleChart: false,
    yAxis: { min: 0 },
    cards: [
      { title: 'CW Pre CL #1', paramKey: 'CW1.ResCl2' },
      { title: 'CW Pre CL #2', paramKey: 'CW2.ResCl2' },
      { title: 'CW Pre CL #3', paramKey: 'CW3.ResCl2' },
      { title: 'CW Pre CL #4', paramKey: 'CW4.ResCl2' },
    ],
  },
  {
    key: 'tw_pos_cl',
    label: 'TW\nPos CL',
    unit: 'mg/L',
    singleChart: false,
    // ±0.1 จากขอบเกณฑ์ปกติ 1.0-1.4 → 0.9-1.5
    // ±0.1 จากขอบเกณฑ์โรคระบาด 1.4-1.8 → 1.3-1.9
    yAxis: {
      normal:   { min: 0.9, max: 1.5 },
      epidemic: { min: 1.3, max: 1.9 },
    },
    cards: [
      { title: 'TW Pos CL #1', paramKey: 'TW1.ResCl2' },
      { title: 'TW Pos CL #2', paramKey: 'TW2.ResCl2' },
      { title: 'TW Pos CL #3', paramKey: 'TW3.ResCl2' },
      { title: 'TW Pos CL #4', paramKey: 'TW4.ResCl2' },
    ],
  },
];
