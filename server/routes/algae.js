const express = require('express');
const router = express.Router();
const { getDb } = require('../services/db');

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
  const now = new Date().toISOString();
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

// DELETE /api/algae/records/:id
router.delete('/records/:id', (req, res) => {
  const db = getDb();
  db.run('DELETE FROM algae_records WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

module.exports = router;
