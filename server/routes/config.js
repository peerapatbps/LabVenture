const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { attachActor, can, SCI_WRITE } = require('../services/actor');
const { validateThresholds } = require('../services/scenario');
const { getDb } = require('../services/db');
const { kickSync } = require('../services/uroboros');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'params.json');
const NODES_PATH = path.join(__dirname, '..', 'config', 'nodes.json');
const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');

// Get params config
router.get('/params', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    res.json(data);
  } catch {
    res.json({ plant_id: 2, station: 'RWS', parameters: [] });
  }
});

// Update params config
router.put('/params', (req, res) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get nodes config
router.get('/nodes', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(NODES_PATH, 'utf8'));
    res.json(data);
  } catch {
    res.json({ plant_id: 2, nodes: [] });
  }
});

// List scenario files
router.get('/scenarios/files', (req, res) => {
  try {
    const files = fs.readdirSync(SCENARIOS_DIR).filter(f => f.endsWith('.json'));
    const scenarios = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, f), 'utf8'));
      return { filename: f, name: data.name, thresholdCount: (data.thresholds || []).length };
    });
    res.json(scenarios);
  } catch {
    res.json([]);
  }
});

// Get a scenario file
router.get('/scenarios/files/:filename', (req, res) => {
  const fp = path.join(SCENARIOS_DIR, path.basename(req.params.filename));
  if (!fp.startsWith(SCENARIOS_DIR)) return res.status(400).json({ error: 'Invalid path' });
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// one threshold per line, aligned — same layout as the hand-written files so git diffs stay readable
function formatScenario({ name, description, thresholds }) {
  const w = Math.max(0, ...thresholds.map(t => JSON.stringify(t.param_key).length)) + 1;
  const rows = thresholds.map(t => {
    const key = `${JSON.stringify(t.param_key)},`.padEnd(w + 1);
    const min = `${JSON.stringify(t.min)},`.padEnd(6);
    return `    { "param_key": ${key} "min": ${min} "max": ${JSON.stringify(t.max)} }`;
  });
  return `{\n  "name": ${JSON.stringify(name)},\n  "description": ${JSON.stringify(description)},\n  "thresholds": [\n${rows.join(',\n')}\n  ]\n}\n`;
}

// Save a scenario file's thresholds (min = LCL, max = UCL). Keeps name/description of the existing file.
router.put('/scenarios/files/:filename', attachActor, (req, res) => {
  if (!can(req.actor, SCI_WRITE)) return res.status(403).json({ error: 'เฉพาะนักวิทยาศาสตร์เท่านั้นที่แก้เกณฑ์ได้' });
  const name = path.basename(req.params.filename);
  if (!/^scenario_[a-z0-9_]+\.json$/.test(name)) return res.status(400).json({ error: 'ชื่อไฟล์ไม่ถูกต้อง' });
  const fp = path.join(SCENARIOS_DIR, name);
  const { thresholds, errors } = validateThresholds(req.body?.thresholds);
  if (errors.length) return res.status(400).json({ error: errors.join(' · '), errors });
  try {
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {}
    const data = {
      name: req.body?.name ?? prev.name ?? name,
      description: req.body?.description ?? prev.description ?? '',
      thresholds,
    };
    const tmp = `${fp}.tmp`;
    fs.writeFileSync(tmp, formatScenario(data), 'utf8');
    fs.renameSync(tmp, fp);
    console.log(`[config] ${req.actor.name} saved ${name} (${thresholds.length} thresholds)`);
    require('../services/scenarioHistory').syncNow({ actor: req.actor.name, note: req.body?.note ? String(req.body.note).trim() || null : null });   // rev ใหม่ (+ ช่วงใหม่ถ้าเป็นสถานการณ์ที่ active)
    // แก้เกณฑ์ของสถานการณ์ที่ active → alarm แบบอ้างเกณฑ์ต้องได้ค่าใหม่ทันที
    const isActive = !!getDb().get('SELECT 1 FROM scenarios WHERE active = 1 AND threshold_file = ?', [name]);
    if (isActive) kickSync().catch(() => {});
    res.json({ ok: true, count: thresholds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a scenario file
router.delete('/scenarios/files/:filename', (req, res) => {
  const fp = path.join(SCENARIOS_DIR, path.basename(req.params.filename));
  if (!fp.startsWith(SCENARIOS_DIR)) return res.status(400).json({ error: 'Invalid path' });
  try {
    fs.unlinkSync(fp);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
