const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const { getDb, nowTH } = require('../services/db');
const { fetchUserProfile } = require('../services/aquadat');

const EXPORTER = path.join(__dirname, '..', 'algae_exporter.py');

function decodeToken(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  } catch { return null; }
}

async function resolveSignerInfo(req) {
  const token = req.cookies?.aquadat_token;
  if (!token) return null;
  const payload = decodeToken(token);
  if (!payload || payload.exp < Date.now() / 1000) return null;
  const profile = await fetchUserProfile(token).catch(() => null);
  if (!profile?.name) return null;
  const db = getDb();
  const entry = db.get(
    `SELECT position_label, dept_label FROM car_whitelist WHERE name = ? LIMIT 1`,
    [profile.name]
  );
  return {
    name: profile.name,
    position_label: entry?.position_label || '',
    dept_label: entry?.dept_label || '',
  };
}

// GET /api/algae/species?q=<text>
router.get('/species', (req, res) => {
  const q = (req.query.q || '').trim();
  const db = getDb();
  let rows;
  if (q) {
    rows = db.all(
      `SELECT id, division, species_name, category, is_active
       FROM algae_species WHERE species_name LIKE ? AND is_active = 1
       ORDER BY division, species_name LIMIT 50`,
      [`%${q}%`]
    );
  } else {
    rows = db.all(
      `SELECT id, division, species_name, category, is_active
       FROM algae_species WHERE is_active = 1
       ORDER BY division, species_name LIMIT 100`
    );
  }
  res.json(rows);
});

// POST /api/algae/species  — add new species
router.post('/species', (req, res) => {
  const { division, species_name, category } = req.body;
  if (!species_name) return res.status(400).json({ error: 'species_name required' });
  const db = getDb();
  try {
    db.run(
      'INSERT INTO algae_species (division, species_name, category) VALUES (?, ?, ?)',
      [division || null, species_name.trim(), category || null]
    );
    const row = db.get('SELECT * FROM algae_species WHERE species_name = ?', [species_name.trim()]);
    res.json(row);
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'species already exists' });
    throw e;
  }
});

// GET /api/algae/records?date=YYYY-MM-DD&station=RW
router.get('/records', (req, res) => {
  const { date, station } = req.query;
  if (!date || !station) return res.status(400).json({ error: 'date and station required' });
  const db = getDb();
  const rows = db.all(
    `SELECT ar.id, ar.species_id, ar.count, s.species_name, s.division, s.category
     FROM algae_records ar
     JOIN algae_species s ON s.id = ar.species_id
     WHERE ar.record_date = ? AND ar.station = ?
     ORDER BY s.division, s.species_name`,
    [date, station]
  );
  res.json(rows);
});

// POST /api/algae/records  — upsert records for a date+station
// body: { date, station, items: [{ species_id, count }] }
router.post('/records', (req, res) => {
  const { date, station, items } = req.body;
  if (!date || !station || !Array.isArray(items)) {
    return res.status(400).json({ error: 'date, station, items[] required' });
  }
  const db = getDb();
  const now = nowTH();
  for (const item of items) {
    db.run(
      `INSERT INTO algae_records (record_date, station, species_id, count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(record_date, station, species_id) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at`,
      [date, station, item.species_id, item.count ?? null, now, now]
    );
  }
  res.json({ ok: true, saved: items.length });
});

// GET /api/algae/week-status?date=YYYY-MM-DD
// Returns how many records exist per station for the week containing `date`
router.get('/week-status', (req, res) => {
  const date = req.query.date || nowTH().split('T')[0];
  const d = new Date(date + 'T00:00:00');
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d); monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const fmt = dt => new Date(dt.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
  const db = getDb();
  const rows = db.all(
    `SELECT station, COUNT(*) as cnt FROM algae_records
     WHERE record_date >= ? AND record_date <= ? GROUP BY station`,
    [fmt(monday), fmt(sunday)]
  );
  const stationMap = {};
  for (const r of rows) stationMap[r.station] = r.cnt;
  res.json({ week_start: fmt(monday), week_end: fmt(sunday), stations: stationMap });
});

// DELETE /api/algae/records/:id
router.delete('/records/:id', (req, res) => {
  const db = getDb();
  db.run('DELETE FROM algae_records WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

// POST /api/algae/export
// body: { date: "YYYY-MM-DD" }
// Reads algae records + water quality at 09:00 from DB and exports to Algae2569.xlsx
router.post('/export', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });

  const db = getDb();

  // Algae species records
  const rows = db.all(
    `SELECT ar.station, s.species_name, ar.count
     FROM algae_records ar
     JOIN algae_species s ON s.id = ar.species_id
     WHERE ar.record_date = ? AND ar.count IS NOT NULL AND ar.count > 0`,
    [date]
  );

  // Water quality: turb/pH/Cond at 09:00, OC at 'daily'
  const WQ_PARAMS_09 = [
    'RW.turb','RW.pH','RW.Conduct',
    'TW1.turb','TW1.pH','TW1.Conduct',
    'TW2.turb','TW2.pH','TW2.Conduct',
    'CW1.turb','CW2.turb','CW3.turb','CW4.turb',
  ];
  const WQ_PARAMS_DAILY = ['RW.OC','TW1.OC','TW2.OC','CW1.OC','CW2.OC','CW3.OC','CW4.OC'];

  const placeholders09 = WQ_PARAMS_09.map(() => '?').join(',');
  const placeholdersD  = WQ_PARAMS_DAILY.map(() => '?').join(',');

  const wqRows09 = db.all(
    `SELECT param_key, trans_value FROM node_records
     WHERE trans_dtm = ? AND trans_time = '09:00' AND param_key IN (${placeholders09})`,
    [date, ...WQ_PARAMS_09]
  );
  const wqRowsD = db.all(
    `SELECT param_key, trans_value FROM node_records
     WHERE trans_dtm = ? AND trans_time = 'daily' AND param_key IN (${placeholdersD})`,
    [date, ...WQ_PARAMS_DAILY]
  );

  const wq = {};
  for (const r of [...wqRows09, ...wqRowsD]) wq[r.param_key] = r.trans_value;

  const signer = await resolveSignerInfo(req).catch(() => null);

  const payload = JSON.stringify({ date, records: rows, wq, signer });
  const py = spawn('python', [EXPORTER, payload]);
  let out = '';
  let err = '';
  py.stdout.on('data', d => out += d);
  py.stderr.on('data', d => err += d);
  py.on('close', code => {
    if (err) process.stderr.write('[algae_exporter] ' + err);
    if (code !== 0) return res.status(500).json({ error: err || `python exit ${code}` });
    try {
      res.json(JSON.parse(out.trim()));
    } catch (e) {
      res.status(500).json({ error: 'bad JSON from algae_exporter: ' + out });
    }
  });
});

module.exports = router;
