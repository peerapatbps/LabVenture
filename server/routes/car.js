const express = require('express');
const router = express.Router();
const { getDb, persist, nowTH } = require('../services/db');
const { pushCarMessage } = require('../services/line');
const { fetchUserProfile } = require('../services/aquadat');
const { v4: uuidv4 } = require('uuid');

// ── attachCarUser middleware ───────────────────────────────────────────────
async function attachCarUser(req, res, next) {
  try {
    const token = req.cookies?.aquadat_token;
    if (!token) { req.carUser = null; return next(); }
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp < Date.now() / 1000) { req.carUser = null; return next(); }
    const profile = await fetchUserProfile(token).catch(() => null);
    if (!profile?.name) { req.carUser = null; return next(); }
    const db = getDb();
    const SUPERADMIN = process.env.SUPERADMIN_NAME || 'นายพีรพัฒน์ สุขขารมย์';
    const entries = db.all('SELECT * FROM car_whitelist WHERE name = ?', [profile.name]);
    // Admin = badge AND synced from EHR (synced_at IS NOT NULL), OR is superadmin
    const isAdmin = profile.name === SUPERADMIN || entries.some(e => e.is_admin === 1 && e.synced_at != null);
    const groups = entries.map(e => e.group_code);
    const primary = groups.find(g => g === '3a' || g === '3b') || groups[0] || null;
    const primaryEntry = entries.find(e => e.group_code === primary) || entries[0];
    req.carUser = {
      name: profile.name,
      position: profile.position || '',
      group: primary,
      groups,
      shift: primaryEntry?.shift || null,
      deptLabel: primaryEntry?.dept_label || '',
      isAdmin,
    };
  } catch {
    req.carUser = null;
  }
  next();
}

router.use(attachCarUser);

function addWorkingDays(dateStr, days) {
  const d = new Date(dateStr);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

function mergeFormData(existing, incoming) {
  try {
    const base = JSON.parse(existing || '{}');
    return JSON.stringify({ ...base, ...incoming });
  } catch {
    return JSON.stringify(incoming || {});
  }
}

// List all (role-filtered)
router.get('/', (req, res) => {
  const db = getDb();
  const { status_code, from, to } = req.query;
  const cu = req.carUser;
  let sql = 'SELECT * FROM car_log WHERE 1=1';
  const params = [];

  // Role-based filter (admins and Group 1 see everything)
  const groups = cu?.groups || (cu?.group ? [cu.group] : []);
  if (cu && !cu.isAdmin && !groups.includes('1')) {
    const conditions = [];
    if (groups.includes('2')) {
      conditions.push(`(receiver_name = ? OR (receiver_dept LIKE ? AND receiver_dept LIKE ?))`);
      params.push(cu.name, '%สคน.%', `%ผลัด ${cu.shift}%`);
    }
    if (groups.includes('3a')) {
      conditions.push(`(status_code = 20 OR form_data LIKE ?)`);
      params.push(`%"s2_approver":"${cu.name}%`);
    }
    if (groups.includes('3b')) {
      conditions.push(`(status_code = 50 OR form_data LIKE ?)`);
      params.push(`%"s5_approver":"${cu.name}%`);
    }
    if (conditions.length === 0) {
      // Not in whitelist: see only own CARs
      conditions.push(`(issuer_name = ? OR receiver_name = ?)`);
      params.push(cu.name, cu.name);
    }
    sql += ` AND (${conditions.join(' OR ')})`;
  }

  if (status_code) { sql += ' AND status_code = ?'; params.push(parseInt(status_code)); }
  if (from) { sql += ' AND issued_at >= ?'; params.push(from); }
  if (to) { sql += ' AND issued_at <= ?'; params.push(to + 'T23:59:59'); }
  sql += ' ORDER BY issued_at DESC';
  res.json(db.all(sql, params));
});

// Analytics (overdue)
router.get('/analytics', (req, res) => {
  const db = getDb();
  const overdue = db.all(`
    SELECT * FROM car_log
    WHERE status_code NOT IN (60, 70)
    AND deadline_at < date('now')
    ORDER BY deadline_at ASC
  `);
  res.json({ overdue });
});

// Steps history for a car
router.get('/steps/:id', (req, res) => {
  const db = getDb();
  const steps = db.all('SELECT * FROM car_steps WHERE car_id = ? ORDER BY updated_at ASC', [req.params.id]);
  res.json(steps);
});

// Find by unique_key
router.get('/by-key/:key', (req, res) => {
  const db = getDb();
  const car = db.get('SELECT * FROM car_log WHERE unique_key = ?', [req.params.key]);
  if (!car) return res.status(404).json({ error: 'Not found' });
  res.json(car);
});

// Create (Section 1)
router.post('/', async (req, res) => {
  const db = getDb();
  const {
    car_number, car_type, system_type, issue_type,
    parameter_name, issuer_name, issuer_dept, receiver_name, receiver_dept,
    configparam_id, plant_id, station_code,
    recorded_value, threshold_value, threshold_direction, scenario_id,
    record_datetime, notes,
  } = req.body;

  if (!parameter_name || !record_datetime) {
    return res.status(400).json({ error: 'parameter_name and record_datetime required' });
  }

  // Lock issuer identity to logged-in user
  const cu = req.carUser;
  const lockedIssuerName = cu?.name || issuer_name;
  const lockedIssuerDept = cu?.deptLabel || issuer_dept;

  const unique_key = uuidv4().split('-')[0] + '-' + uuidv4().split('-')[1];
  const deadline_at = addWorkingDays(nowTH(), 10);

  db.run(
    `INSERT INTO car_log
      (unique_key, car_number, car_type, system_type, issue_type,
       parameter_name, issuer_name, issuer_dept, receiver_name, receiver_dept,
       configparam_id, plant_id, station_code,
       recorded_value, threshold_value, threshold_direction, scenario_id,
       record_datetime, deadline_at, notes, status_code)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,10)`,
    [
      unique_key, car_number || null, car_type || 'CAR', system_type || null, issue_type || null,
      parameter_name, lockedIssuerName || null, lockedIssuerDept || null, receiver_name || null, receiver_dept || null,
      configparam_id || null, plant_id || null, station_code || null,
      recorded_value || null, threshold_value || null, threshold_direction || null, scenario_id || null,
      record_datetime, deadline_at, notes || null,
    ]
  );

  const car = db.get('SELECT * FROM car_log WHERE unique_key = ?', [unique_key]);

  let line_sent_at = null;
  try {
    await pushCarMessage(car, 10);
    line_sent_at = nowTH();
    db.run('UPDATE car_log SET line_sent_at = ? WHERE id = ?', [line_sent_at, car.id]);
  } catch (e) {
    console.warn('[CAR] LINE push failed:', e.message);
  }

  persist();
  res.json({ ok: true, car_id: car.id, unique_key, deadline_at, line_sent_at });
});

// Update status and/or form section data
router.patch('/:id', async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

  const car = db.get('SELECT * FROM car_log WHERE id = ?', [id]);
  if (!car) return res.status(404).json({ error: 'Not found' });

  const { status_code, form_data, followup2_deadline, ...rest } = req.body;

  const sets = [], params = [];

  if (status_code != null) {
    sets.push('status_code = ?');
    params.push(status_code);
    // Also update legacy current_step for compat
    const legacyStep = { 10:'issued', 20:'responded', 30:'approved', 50:'validated', 60:'closed' }[status_code];
    if (legacyStep) { sets.push('current_step = ?'); params.push(legacyStep); }
  }

  if (followup2_deadline != null) {
    sets.push('followup2_deadline = ?');
    params.push(followup2_deadline);
  }

  if (form_data && typeof form_data === 'object') {
    // Lock identity fields to logged-in user
    const cu = req.carUser;
    if (cu?.name) {
      if ('s2_respondent' in form_data) { form_data.s2_respondent = cu.name; form_data.s2_respondent_pos = cu.deptLabel || cu.position; }
      if ('s2_approver' in form_data)   { form_data.s2_approver = cu.name; }
      if ('s5_approver' in form_data)   { form_data.s5_approver = cu.name; }
    }
    sets.push('form_data = ?');
    params.push(mergeFormData(car.form_data, form_data));
    const fd = { ...((() => { try { return JSON.parse(car.form_data || '{}'); } catch { return {}; } })()), ...form_data };
    if (fd.s2_correction_deadline) { sets.push('correction_deadline = ?'); params.push(fd.s2_correction_deadline); }
    if (fd.s2_prevention_deadline) { sets.push('prevention_deadline = ?'); params.push(fd.s2_prevention_deadline); }
    if (fd.s4_check2_deadline) { sets.push('followup2_deadline = ?'); params.push(fd.s4_check2_deadline); }
  }

  const allowedFields = ['car_number','car_type','system_type','issue_type','issuer_name','issuer_dept','receiver_name','receiver_dept'];
  for (const f of allowedFields) {
    if (rest[f] != null) { sets.push(`${f} = ?`); params.push(rest[f]); }
  }

  if (sets.length > 0) {
    params.push(id);
    db.run(`UPDATE car_log SET ${sets.join(', ')} WHERE id = ?`, params);

    // Record step history
    if (status_code != null && status_code !== car.status_code) {
      db.run("INSERT INTO car_steps (car_id, step, updated_at) VALUES (?,?,datetime('now'))",
        [id, String(status_code)]);
    }
  }

  const updated = db.get('SELECT * FROM car_log WHERE id = ?', [id]);

  if (status_code != null && status_code !== car.status_code) {
    try { await pushCarMessage(updated, status_code); }
    catch (e) { console.warn('[CAR] LINE push failed:', e.message); }
  }

  persist();
  res.json({ ok: true, car: updated });
});

// Get single by numeric ID
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  const db = getDb();
  const car = db.get('SELECT * FROM car_log WHERE id = ?', [id]);
  if (!car) return res.status(404).json({ error: 'Not found' });
  res.json(car);
});

module.exports = router;
