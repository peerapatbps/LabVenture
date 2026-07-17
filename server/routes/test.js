const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getDb, persist, nowTH } = require('../services/db');
const { writeData, setForceFail, getForceFail } = require('../services/aquadat');
const { writeToExcel, setExcelForceFail, getExcelForceFail } = require('../services/excelWriter');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const LOCAL_DATA_DIR = path.join(__dirname, '..', 'data');

const REQUIRED_CONFIG_FILES = [
  'nodes.json',
  'params.json',
  'aquadat_configs.json',
  'services.json',
  'app_settings.json',
  'excel_cell_map.json',
  'algae_species_seed.json',
  'paths.json',
];

function requireAuth(req, res, next) {
  if (!req.cookies?.aquadat_token) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// GET /api/test/status
router.get('/status', requireAuth, (req, res) => {
  const db = getDb();
  const queue = db.all(
    `SELECT id, created_at, trans_dtm, attempts, status, last_error,
            'retry_' || trans_dtm || '_' || id AS script_name
       FROM aquadat_queue
      ORDER BY created_at DESC
      LIMIT 20`
  );
  res.json({ forceFail: getForceFail(), excelForceFail: getExcelForceFail(), queue });
});

// POST /api/test/force-fail — { enabled: true|false }
router.post('/force-fail', requireAuth, (req, res) => {
  setForceFail(req.body.enabled);
  res.json({ forceFail: getForceFail() });
});

// POST /api/test/excel-force-fail — { enabled: true|false }
router.post('/excel-force-fail', requireAuth, (req, res) => {
  setExcelForceFail(req.body.enabled);
  res.json({ excelForceFail: getExcelForceFail() });
});

// POST /api/test/run-excel-write — submit fake records through excel write path
router.post('/run-excel-write', requireAuth, async (req, res) => {
  const { getDb, nowTH, persist } = require('../services/db');
  const db = getDb();
  const now = nowTH();
  const today = new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];
  const fakeRecords = [{ param_key: 'RW.turb', trans_dtm: today, trans_time: '09:00', trans_value: '0' }];
  let result = null, error = null;
  try {
    result = await writeToExcel(fakeRecords);
  } catch (err) {
    error = err.message;
    db.run(
      `INSERT INTO excel_queue (created_at, trans_dtm, payload, status) VALUES (?, ?, ?, 'pending')`,
      [now, today, JSON.stringify(fakeRecords)]
    );
    persist();
  }
  res.json({ ok: true, result, error });
});

// POST /api/test/seed-queue — { status: 'pending'|'dead', attempts: 0-3 }
router.post('/seed-queue', requireAuth, (req, res) => {
  const { status = 'pending', attempts = 0 } = req.body;
  const db = getDb();
  const today = new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];
  const fakePayload = JSON.stringify([{
    configparam_id: 9999, trans_dtm: today,
    trans_time: '09:00', trans_value: '0',
    trans_type: 'RWS', plant_id: 2,
  }]);
  db.run(
    `INSERT INTO aquadat_queue (created_at, trans_dtm, payload, attempts, status) VALUES (?, ?, ?, ?, ?)`,
    [nowTH(), today, fakePayload, attempts, status]
  );
  persist();
  res.json({ ok: true });
});

// POST /api/test/run-write — submit real records through the write path (to exercise fail path)
router.post('/run-write', requireAuth, async (req, res) => {
  const token = req.cookies.aquadat_token;
  const fakeRecords = [{ configparam_id: 9999, trans_dtm: req.body.date || new Date().toISOString().split('T')[0], trans_time: '09:00', trans_value: '1', trans_type: 'RWS', plant_id: 2 }];
  let result = null, error = null;
  try {
    result = await writeData(token, fakeRecords);
  } catch (err) {
    error = err.message;
    const db = getDb();
    const now = nowTH();
    db.run(
      `INSERT INTO aquadat_queue (created_at, trans_dtm, payload, status) VALUES (?, ?, ?, 'pending')`,
      [now, fakeRecords[0].trans_dtm, JSON.stringify(fakeRecords)]
    );
    persist();
  }
  res.json({ ok: true, result, error });
});

// POST /api/test/clear-queue — { all: true } clears everything, default clears success/dead only
router.post('/clear-queue', requireAuth, (req, res) => {
  const db = getDb();
  if (req.body.all) {
    db.run(`DELETE FROM aquadat_queue`);
  } else {
    db.run(`DELETE FROM aquadat_queue WHERE status IN ('success', 'dead')`);
  }
  persist();
  res.json({ ok: true });
});

// ── Excel path test (Case 1 / 4 / 5) ─────────────────────────────────────────
// GET /api/test/excel-path
// อ่าน paths.json แล้วตรวจสอบว่า excel_data_dir เข้าถึงได้จริงหรือไม่
// ถ้า paths.json อ่านไม่ได้ → รายงาน configError แต่ยังทดสอบ local fallback ต่อ
router.get('/excel-path', requireAuth, (req, res) => {
  let configOk = false, configError = null, excelDir = null, usingFallback = false;
  let dirOk = false, dirError = null;

  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'paths.json'), 'utf8'));
    configOk = true;
    const raw = (cfg.excel_data_dir || '').trim().replace(/[/\\]+$/, '');
    if (raw) {
      excelDir = raw;
    } else {
      excelDir = LOCAL_DATA_DIR;
      usingFallback = true;
    }
  } catch (err) {
    configError = err.message;
    excelDir = LOCAL_DATA_DIR;
    usingFallback = true;
  }

  try {
    fs.accessSync(excelDir, fs.constants.R_OK | fs.constants.W_OK);
    dirOk = true;
  } catch (err) {
    dirError = err.message;
  }

  res.json({ configOk, configError, excelDir, usingFallback, dirOk, dirError });
});

// ── Excel queue (Case 2) ──────────────────────────────────────────────────────
// GET /api/test/excel-queue
router.get('/excel-queue', requireAuth, (req, res) => {
  const db = getDb();
  const items = db.all(
    `SELECT id, created_at, trans_dtm, attempts, last_error, status
       FROM excel_queue
      WHERE status IN ('pending', 'dead')
      ORDER BY created_at ASC`
  );
  res.json({ items, count: items.length });
});

// POST /api/test/excel-retry — retry all pending/dead excel queue items
router.post('/excel-retry', requireAuth, async (req, res) => {
  const db = getDb();
  const items = db.all(`SELECT * FROM excel_queue WHERE status IN ('pending', 'dead')`);

  // Resolve excel_data_dir the same way excel_writer.py does
  function getExcelDataDir() {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'paths.json'), 'utf8'));
      const d = (cfg.excel_data_dir || '').trim().replace(/[/\\]+$/, '');
      return d || path.join(__dirname, '..', 'data');
    } catch {
      return path.join(__dirname, '..', 'data');
    }
  }

  function monthlyFilePath(transDtm) {
    const [y, m] = transDtm.split('-');
    return path.join(getExcelDataDir(), `DailyLab_${y}_${m}.xlsx`);
  }

  let succeeded = 0, failed = 0;
  const fileChecks = [];

  for (const item of items) {
    const records = JSON.parse(item.payload);
    const filePath = monthlyFilePath(item.trans_dtm);
    try {
      await writeToExcel(records);
      db.run(
        `UPDATE excel_queue SET status='success', last_attempt=? WHERE id=?`,
        [nowTH(), item.id]
      );
      succeeded++;
      const fileExists = fs.existsSync(filePath);
      fileChecks.push({ trans_dtm: item.trans_dtm, filePath, fileExists });
    } catch (err) {
      const attempts = item.attempts + 1;
      db.run(
        `UPDATE excel_queue
            SET attempts=?, last_attempt=?, last_error=?,
                status=CASE WHEN ? >= 3 THEN 'dead' ELSE 'pending' END
          WHERE id=?`,
        [attempts, nowTH(), err.message, attempts, item.id]
      );
      failed++;
    }
    persist();
  }

  res.json({ ok: true, succeeded, failed, fileChecks });
});

// POST /api/test/clear-excel-queue — { all: true } clears everything, default clears success/dead
router.post('/clear-excel-queue', requireAuth, (req, res) => {
  const db = getDb();
  if (req.body.all) {
    db.run(`DELETE FROM excel_queue`);
  } else {
    db.run(`DELETE FROM excel_queue WHERE status IN ('success', 'dead')`);
  }
  persist();
  res.json({ ok: true });
});

// ── Config file integrity check (Case 6) ─────────────────────────────────────
// GET /api/test/config-files
// ตรวจว่า config files ทุกไฟล์ใน REQUIRED_CONFIG_FILES มีอยู่และ parse ได้
router.get('/config-files', requireAuth, (req, res) => {
  const results = REQUIRED_CONFIG_FILES.map(filename => {
    const filepath = path.join(CONFIG_DIR, filename);
    let exists = false, parseable = false, error = null;
    try {
      const raw = fs.readFileSync(filepath, 'utf8');
      exists = true;
      JSON.parse(raw);
      parseable = true;
    } catch (err) {
      error = err.message;
      if (!exists) error = `ไม่พบไฟล์: ${err.message}`;
      else error = `JSON parse error: ${err.message}`;
    }
    return { filename, exists, parseable, error };
  });

  const allOk = results.every(r => r.parseable);
  res.json({ allOk, results });
});

// ── Ping file ────────────────────────────────────────────────────────────────
// GET /api/test/ping-file?path=<absolute_path>  (default: algae_excel_path from paths.json)
router.get('/ping-file', requireAuth, (req, res) => {
  let targetPath = (req.query.path || '').trim();

  // Default: algae_excel_path from paths.json
  if (!targetPath) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'paths.json'), 'utf8'));
      targetPath = cfg.algae_excel_path || cfg.excel_data_dir || '';
    } catch { targetPath = ''; }
  }

  if (!targetPath) return res.json({ ok: false, path: '', error: 'ไม่ได้ระบุ path และ paths.json ไม่มี algae_excel_path' });

  let exists = false, readable = false, writable = false, stat = null, error = null;
  try {
    exists = fs.existsSync(targetPath);
    if (exists) {
      try { fs.accessSync(targetPath, fs.constants.R_OK); readable = true; } catch {}
      try { fs.accessSync(targetPath, fs.constants.W_OK); writable = true; } catch {}
      const s = fs.statSync(targetPath);
      stat = { sizeBytes: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), mtime: s.mtime };
    }
  } catch (err) {
    error = err.message;
  }

  res.json({ ok: exists && readable, path: targetPath, exists, readable, writable, stat, error });
});

module.exports = router;
