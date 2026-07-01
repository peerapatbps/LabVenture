const express = require('express');
const router = express.Router();
const { readData, readRemarks } = require('../services/aquadat');

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

module.exports = router;
