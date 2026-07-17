const express = require('express');
const router = express.Router();
const { readData, readRemarks, writeRemark } = require('../services/aquadat');

function requireAuth(req, res, next) {
  if (!req.cookies?.aquadat_token) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// Read production data (REST, Intranet only)
router.get('/read', requireAuth, async (req, res) => {
  const token = req.cookies.aquadat_token;
  const { plant_id, stationtype_code, begin_dt, end_dt, format } = req.query;
  if (!plant_id || !stationtype_code || !begin_dt || !end_dt) {
    return res.status(400).json({ error: 'plant_id, stationtype_code, begin_dt, end_dt required' });
  }
  try {
    const data = await readData({ token, plant_id, stationtype_code, begin_dt, end_dt, format: format || 'json' });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Read remarks via GraphQL
router.get('/remarks', requireAuth, async (req, res) => {
  const token = req.cookies.aquadat_token;
  const { plant_id, station_id, begin_dt, end_dt, load_file_data } = req.query;
  try {
    const data = await readRemarks(token, {
      plant_id: parseInt(plant_id) || 2,
      station_id: parseInt(station_id) || 0,
      begin_dt,
      end_dt,
      load_file_data: load_file_data !== 'false',
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Write a remark to AquaDAT station_id 20
router.post('/remarks', requireAuth, async (req, res) => {
  const token = req.cookies.aquadat_token;
  const { description, trans_type, trans_remark_date } = req.body;
  if (!description) return res.status(400).json({ error: 'description required' });
  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0].replace(/-/g, '');
  try {
    const result = await writeRemark(token, {
      plant_id: 2,
      station_id: 20,
      trans_remark_date: trans_remark_date || today,
      trans_type: trans_type || '',
      description,
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
