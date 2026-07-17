const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../services/db');

const SERVICES_PATH = path.join(__dirname, '..', 'config', 'services.json');

function getBellbeastUrl(endpoint) {
  try {
    const cfg = JSON.parse(fs.readFileSync(SERVICES_PATH, 'utf8'));
    const base = cfg.bellbeast_lab?.base_url || 'http://localhost:443';
    const ep = cfg.bellbeast_lab?.endpoints?.[endpoint] || `/${endpoint}`;
    return base + ep;
  } catch {
    return `http://localhost:443/${endpoint}`;
  }
}

// GET /api/chem-intake?date=YYYY-MM-DD
router.get('/', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const rows = db.all(
    `SELECT * FROM chem_history WHERE record_date = ? ORDER BY created_at ASC`,
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

  const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  db.run(
    `INSERT INTO chem_history
      (truck, delivery_book, delivery_no, sg, temperature,
       tank_a_before, tank_a_after, tank_b_before, tank_b_after,
       tank_c_before, tank_c_after, tank_d_before, tank_d_after,
       operator, shift, chemical_type, record_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      truck.trim().toUpperCase(),
      delivery_book || null, delivery_no || null,
      sg || null, temperature || null,
      tank_a_before || null, tank_a_after || null,
      tank_b_before || null, tank_b_after || null,
      tank_c_before || null, tank_c_after || null,
      tank_d_before || null, tank_d_after || null,
      operator || null, shift || null, chemical_type || null,
      today,
    ]
  );
  const inserted = db.get('SELECT * FROM chem_history WHERE id = last_insert_rowid()');
  res.json({ ok: true, data: inserted });
});

// PATCH /api/chem-intake/complete-day?date=YYYY-MM-DD — mark all stage records as completed
router.patch('/complete-day', (req, res) => {
  const db = getDb();
  const date = req.query.date || new Date().toISOString().split('T')[0];
  db.run(
    `UPDATE chem_history SET is_completed = 1, completed_at = datetime('now','localtime')
     WHERE record_date = ? AND is_completed = 0`,
    [date]
  );
  const count = db.get('SELECT changes() as n').n;
  res.json({ ok: true, completed: count });
});

// GET /api/chem-intake/chem-report?date=YYYY-MM-DD — proxy POST to port 443 /api/chem_report
router.get('/chem-report', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const url = getBellbeastUrl('chem_report');
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: date,
        endDate: date,
        productCode: '',
        companyCode: '',
        productText: '(All)',
        companyText: '(All)',
      }),
    });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: `chem_report returned ${r.status}` });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: `Cannot reach chem service: ${err.message}` });
  }
});

// GET /api/chem-intake/chem-summary — proxy to Uroboros port 443 /api/chem/summary
// Returns AQ tank levels (value + status) for Alum and PACl tanks
router.get('/chem-summary', async (req, res) => {
  try {
    const r = await fetch(getBellbeastUrl('chem_summary'));
    if (!r.ok) return res.status(r.status).json({ ok: false, error: `Uroboros returned ${r.status}` });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: `Cannot reach chem service: ${err.message}` });
  }
});

// DELETE /api/chem-intake/:id — delete a record
router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'invalid id' });
  db.run('DELETE FROM chem_history WHERE id = ?', [id]);
  res.json({ ok: true });
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

// PATCH /api/chem-intake/:id — update an existing record
router.patch('/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'invalid id' });

  const {
    truck, delivery_book, delivery_no, sg, temperature,
    tank_a_before, tank_a_after,
    tank_b_before, tank_b_after,
    tank_c_before, tank_c_after,
    tank_d_before, tank_d_after,
    chemical_type,
  } = req.body;

  db.run(
    `UPDATE chem_history SET
      truck = ?, delivery_book = ?, delivery_no = ?, sg = ?, temperature = ?,
      tank_a_before = ?, tank_a_after = ?,
      tank_b_before = ?, tank_b_after = ?,
      tank_c_before = ?, tank_c_after = ?,
      tank_d_before = ?, tank_d_after = ?,
      chemical_type = ?
     WHERE id = ?`,
    [
      truck ? truck.trim().toUpperCase() : null,
      delivery_book || null, delivery_no || null,
      sg ?? null, temperature ?? null,
      tank_a_before ?? null, tank_a_after ?? null,
      tank_b_before ?? null, tank_b_after ?? null,
      tank_c_before ?? null, tank_c_after ?? null,
      tank_d_before ?? null, tank_d_after ?? null,
      chemical_type || null,
      id,
    ]
  );
  const updated = db.get('SELECT * FROM chem_history WHERE id = ?', [id]);
  res.json({ ok: true, data: updated });
});

module.exports = router;
