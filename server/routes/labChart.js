const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const SERVICES_PATH = path.join(__dirname, '..', 'config', 'services.json');

function getLabUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(SERVICES_PATH, 'utf8'));
    const bb = cfg.bellbeast_lab;
    return (bb?.base_url || 'http://localhost:443') + (bb?.endpoints?.summary || '/api/lab/summary');
  } catch {
    return 'http://localhost:443/api/lab/summary';
  }
}

// Maps our filter key → BellBeast zone4 filter name
const FILTER_MAP = {
  cw_turbid: 'CW Turbid',
  fw_turbid: 'FW Turbid',
  tw_turbid: 'TW Turbid',
  cw_pre_cl: 'CW Pre CL',
  tw_pos_cl: 'TW Pos CL',
};

// "2026-06-03 13:00" → "13:00"
function extractTime(datetimeStr) {
  if (!datetimeStr) return '';
  return String(datetimeStr).split(' ').pop() || datetimeStr;
}

function transformPoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map(p => ({
      slot: extractTime(Array.isArray(p) ? p[0] : null),
      value: Array.isArray(p) ? (p[1] ?? null) : null,
    }))
    .filter(p => p.slot && p.value !== null);
}

// POST /api/lab/chart
// Body: { filter: "cw_turbid" | "rw_turbid" | "fw_turbid" | ... }
// Returns: { cards: [ [{slot, value}], [{slot, value}], [{slot, value}], [{slot, value}] ] }
//          cards[0..3] maps to the 4 chart cards; rw_turbid fills only cards[0]
router.post('/chart', async (req, res) => {
  if (!req.cookies?.aquadat_token) return res.status(401).json({ error: 'Not authenticated' });

  const filterKey = req.body?.filter || 'cw_turbid';
  const isRwTurbid = filterKey === 'rw_turbid';

  const bellbeastBody = isRwTurbid
    ? { rwZone: { option: 'TURBIDITY', fix: 'TEMPERATURE' }, zone4: { filter: 'CW Turbid' } }
    : { rwZone: { option: 'TURBIDITY', fix: 'TEMPERATURE' }, zone4: { filter: FILTER_MAP[filterKey] || 'CW Turbid' } };

  let bbData;
  try {
    const fetch = require('node-fetch');
    const labUrl = getLabUrl();
    const bbRes = await fetch(labUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bellbeastBody),
      timeout: 10000,
    });
    if (!bbRes.ok) throw new Error(`BellBeast HTTP ${bbRes.status}`);
    const json = await bbRes.json();
    bbData = json?.data || {};
  } catch (err) {
    console.error('[labChart] BellBeast fetch failed:', err.message);
    return res.status(502).json({ error: 'BellBeast unreachable: ' + err.message });
  }

  if (isRwTurbid) {
    // Single chart from zone1.TURBIDITY
    const points = transformPoints(bbData.zone1?.TURBIDITY);
    return res.json({ cards: [points, [], [], []] });
  }

  // 4 charts from zone4.series
  const series = Array.isArray(bbData.zone4?.series) ? bbData.zone4.series : [];
  const cards = [0, 1, 2, 3].map(i => transformPoints(series[i]?.points));
  return res.json({ cards });
});

module.exports = router;
