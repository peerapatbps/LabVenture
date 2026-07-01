const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

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

// Save a scenario file
router.put('/scenarios/files/:filename', (req, res) => {
  const fp = path.join(SCENARIOS_DIR, path.basename(req.params.filename));
  if (!fp.startsWith(SCENARIOS_DIR)) return res.status(400).json({ error: 'Invalid path' });
  try {
    fs.writeFileSync(fp, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
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
