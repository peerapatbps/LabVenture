const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../services/db');

const SERVICES_PATH = path.join(__dirname, '..', 'config', 'services.json');

function getUroborosUrl(endpoint) {
  try {
    const cfg = JSON.parse(fs.readFileSync(SERVICES_PATH, 'utf8'));
    const base = cfg.uroboros?.base_url || 'http://localhost:5000';
    const ep = cfg.uroboros?.endpoints?.[endpoint] || `/${endpoint}`;
    return base + ep;
  } catch {
    return `http://localhost:5000/${endpoint}`;
  }
}

// GET /api/chem-intake?date=YYYY-MM-DD
router.get('/', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const rows = db.all(
    `SELECT * FROM chem_history WHERE date(created_at) = ? ORDER BY created_at ASC`,
    [date]
  );
  res.json({ ok: true, data: rows });
});

// POST /api/chem-intake — save new Top record
router.post('/', (req, res) => {
  const db = getDb();
  const {
    truck, delivery_book, delivery_no, sg, temperature,
    tank_a_before, tank_a_after,
    tank_b_before, tank_b_after,
    tank_c_before, tank_c_after,
    tank_d_before, tank_d_after,
    operator, shift, chemical_type,
  } = req.body;

  if (!truck) return res.status(400).json({ ok: false, error: 'truck is required' });

  db.run(
    `INSERT INTO chem_history
      (truck, delivery_book, delivery_no, sg, temperature,
       tank_a_before, tank_a_after, tank_b_before, tank_b_after,
       tank_c_before, tank_c_after, tank_d_before, tank_d_after,
       operator, shift, chemical_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      truck.trim().toUpperCase(),
      delivery_book || null, delivery_no || null,
      sg || null, temperature || null,
      tank_a_before || null, tank_a_after || null,
      tank_b_before || null, tank_b_after || null,
      tank_c_before || null, tank_c_after || null,
      tank_d_before || null, tank_d_after || null,
      operator || null, shift || null, chemical_type || null,
    ]
  );
  const inserted = db.get('SELECT * FROM chem_history WHERE id = last_insert_rowid()');
  res.json({ ok: true, data: inserted });
});

// GET /api/chem-intake/wdata?date=YYYY-MM-DD — proxy to Uroboros
router.get('/wdata', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const r = await fetch(`${getUroborosUrl('wdata')}?date=${date}`);
    if (!r.ok) return res.status(r.status).json({ ok: false, error: `Uroboros returned ${r.status}` });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: `Cannot reach Uroboros: ${err.message}` });
  }
});

// PATCH /api/chem-intake/claim-batch — claim multiple records at once (from popup)
// Must be before /:id/claim to avoid route conflict
router.patch('/claim-batch', (req, res) => {
  const db = getDb();
  const { claims, claimed_by } = req.body; // claims: [{ id, found }]

  if (!Array.isArray(claims)) return res.status(400).json({ ok: false, error: 'claims must be array' });

  for (const { id, found } of claims) {
    db.run(
      `UPDATE chem_history
       SET bottle_found = ?, bottle_claimed_by = ?, bottle_claimed_at = datetime('now','localtime')
       WHERE id = ?`,
      [found ? 1 : 0, claimed_by || 'unknown', id]
    );
  }
  res.json({ ok: true });
});

module.exports = router;
