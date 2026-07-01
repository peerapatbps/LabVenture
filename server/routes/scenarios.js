const express = require('express');
const router = express.Router();
const { getDb, persist } = require('../services/db');
const fs = require('fs');
const path = require('path');

const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.all('SELECT * FROM scenarios ORDER BY created_at DESC');
  res.json(rows);
});

router.get('/active', (req, res) => {
  const db = getDb();
  const row = db.get('SELECT * FROM scenarios WHERE active = 1 LIMIT 1');
  if (!row) return res.json(null);

  // Attach threshold data
  try {
    const fp = path.join(SCENARIOS_DIR, row.threshold_file);
    const thresholds = JSON.parse(fs.readFileSync(fp, 'utf8'));
    res.json({ ...row, thresholds: thresholds.thresholds || [] });
  } catch {
    res.json({ ...row, thresholds: [] });
  }
});

router.post('/', (req, res) => {
  const db = getDb();
  const { name, description, threshold_file, notes } = req.body;
  if (!name || !threshold_file) return res.status(400).json({ error: 'name and threshold_file required' });
  db.run(
    'INSERT INTO scenarios (name, description, threshold_file, notes) VALUES (?, ?, ?, ?)',
    [name, description || null, threshold_file, notes || null]
  );
  persist();
  res.json({ ok: true });
});

router.put('/:id/activate', (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();
  db.run('UPDATE scenarios SET active = 0, deactivated_at = ? WHERE active = 1', [now]);
  db.run('UPDATE scenarios SET active = 1, activated_at = ? WHERE id = ?', [now, req.params.id]);
  persist();
  res.json({ ok: true });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, description, threshold_file, notes } = req.body;
  db.run(
    'UPDATE scenarios SET name = ?, description = ?, threshold_file = ?, notes = ? WHERE id = ?',
    [name, description || null, threshold_file, notes || null, req.params.id]
  );
  persist();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.run('DELETE FROM scenarios WHERE id = ?', [req.params.id]);
  persist();
  res.json({ ok: true });
});

module.exports = router;
