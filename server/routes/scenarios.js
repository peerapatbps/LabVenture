const express = require('express');
const router = express.Router();
const { getDb, persist, nowTH } = require('../services/db');
const fs = require('fs');
const path = require('path');

const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');
const APP_SETTINGS_PATH = path.join(__dirname, '..', 'config', 'app_settings.json');

function readAppSettings() {
  try { return JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, 'utf8')); }
  catch { return { epidemic: false }; }
}
function writeAppSettings(data) {
  fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(data, null, 2));
}

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
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    let thresholds = data.thresholds || [];

    // Epidemic mode: override TW Pos.Cl to 1.4–1.8 mg/L
    const { epidemic } = readAppSettings();
    if (epidemic) {
      thresholds = thresholds.map(t =>
        /^TW\d+\.ResCl2$/.test(t.param_key)
          ? { ...t, min: 1.4, max: 1.8 }
          : t
      );
    }

    res.json({ ...row, thresholds, epidemic: !!epidemic });
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
  const now = nowTH();
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

// Epidemic toggle — GET /api/scenarios/epidemic  PATCH /api/scenarios/epidemic
router.get('/epidemic', (req, res) => {
  const s = readAppSettings();
  res.json({ epidemic: !!s.epidemic });
});

router.patch('/epidemic', (req, res) => {
  const s = readAppSettings();
  s.epidemic = !!req.body.epidemic;
  writeAppSettings(s);
  res.json({ epidemic: s.epidemic });
});

// CAR templates — GET /api/scenarios/car-templates  PATCH /api/scenarios/car-templates
router.get('/car-templates', (req, res) => {
  const s = readAppSettings();
  res.json({ car_templates: s.car_templates ?? {} });
});

router.patch('/car-templates', (req, res) => {
  const s = readAppSettings();
  s.car_templates = { ...(s.car_templates ?? {}), ...req.body };
  writeAppSettings(s);
  res.json({ car_templates: s.car_templates });
});

router.get('/marquee', (req, res) => {
  const s = readAppSettings();
  res.json({ marquee_text: s.marquee_text ?? '' });
});

// Daily report cost / tank settings
router.get('/report-settings', (req, res) => {
  const s = readAppSettings();
  res.json({
    chem_cost:   s.chem_cost   ?? { alum_ton: 0, pacl_ton: 0, chlorine_ton: 0, sludge_day: 0 },
    energy_cost: s.energy_cost ?? { peak_price: 0, offpeak_price: 0, ft_price: 0, max_energy: 0 },
    rw_cost:     s.rw_cost     ?? 0,
    cwt_area_m2: s.cwt_area_m2 ?? 48000,
  });
});

router.patch('/report-settings', (req, res) => {
  const s = readAppSettings();
  if (req.body.chem_cost)   s.chem_cost   = { ...(s.chem_cost ?? {}),   ...req.body.chem_cost };
  if (req.body.energy_cost) s.energy_cost = { ...(s.energy_cost ?? {}), ...req.body.energy_cost };
  if (req.body.rw_cost     !== undefined) s.rw_cost     = Number(req.body.rw_cost);
  if (req.body.cwt_area_m2 !== undefined) s.cwt_area_m2 = Number(req.body.cwt_area_m2);
  writeAppSettings(s);
  res.json({ ok: true });
});

router.patch('/marquee', (req, res) => {
  const s = readAppSettings();
  s.marquee_text = String(req.body.marquee_text ?? '');
  writeAppSettings(s);
  res.json({ marquee_text: s.marquee_text });
});

module.exports = router;
