const express = require('express');
const router = express.Router();
const { getDb, persist, nowTH } = require('../services/db');
const { pushCarMessage } = require('../services/line');
const { fetchUserProfile } = require('../services/aquadat');
const { createCar, nextCarNumber } = require('../services/carCreate');
const { isSuperadminIdentity } = require('../services/actor');

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
    const entries = db.all('SELECT * FROM car_whitelist WHERE name = ?', [profile.name]);
    // Admin = badge AND synced from EHR (synced_at IS NOT NULL), OR is superadmin
    const isAdmin = isSuperadminIdentity(payload, profile) || entries.some(e => e.is_admin === 1 && e.synced_at != null);
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

function mergeFormData(existing, incoming) {
  try {
    const base = JSON.parse(existing || '{}');
    return JSON.stringify({ ...base, ...incoming });
  } catch {
    return JSON.stringify(incoming || {});
  }
}

// role filter shared by the list and the printed log
function roleFilter(cu) {
  const params = [];
  // Role-based filter (admins and Group 1 see everything)
  const groups = cu?.groups || (cu?.group ? [cu.group] : []);
  if (!cu || cu.isAdmin || groups.includes('1')) return { where: '', params };
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
  return { where: ` AND (${conditions.join(' OR ')})`, params };
}

// List all (role-filtered)
router.get('/', (req, res) => {
  const db = getDb();
  const { status_code, from, to } = req.query;
  const rf = roleFilter(req.carUser);
  let sql = 'SELECT * FROM car_log WHERE 1=1' + rf.where;
  const params = rf.params;

  if (status_code) { sql += ' AND status_code = ?'; params.push(parseInt(status_code)); }
  if (from) { sql += ' AND issued_at >= ?'; params.push(from); }
  if (to) { sql += ' AND issued_at <= ?'; params.push(to + 'T23:59:59'); }
  sql += ' ORDER BY issued_at DESC';
  res.json(db.all(sql, params));
});

// ── printed forms (original Excel templates, services/carXlsx.js) ─────────
const sendFile = (res, fmt, name, body) => require('../services/sendFile').sendFile(res, fmt, name, body, 'car');
// xlsx as filled; pdf exported by Excel
async function sendXlsx(res, fmt, name, buf) {
  sendFile(res, fmt, name, fmt === 'pdf' ? await require('../services/officePdf').toPdf(buf, 'xlsx') : buf);
}

// ทะเบียน CAR/PAR (สบค-09) — ?fy=<ปีงบ พ.ศ.>&system=<HACCP|ISO14001:2015|ISO45001:2018> (blank = all systems)
router.get('/log/:fmt(xlsx|pdf)', async (req, res) => {
  const { buildCarLog, fiscalYearBE, ymdTH, SYSTEMS } = require('../services/carXlsx');
  const fy = Number(req.query.fy) || fiscalYearBE(nowTH());
  const system = req.query.system || '';
  if (system && !SYSTEMS.includes(system)) return res.status(400).json({ error: `ระบบไม่ถูกต้อง (${system})` });
  const rf = roleFilter(req.carUser);
  const cars = getDb().all(`SELECT * FROM car_log WHERE 1=1${rf.where} ORDER BY issued_at ASC, id ASC`, rf.params)
    .filter(c => fiscalYearBE(ymdTH(c.issued_at, true)) === fy && (!system || c.system_type === system));
  const systems = system ? [system] : SYSTEMS.filter(x => cars.some(c => c.system_type === x));
  try {
    // both formats are finished by Excel (row heights / page breaks for wrapped text)
    const { buf, layout } = await buildCarLog(cars, systems);
    const fmt = req.params.fmt;
    const out = await require('../services/officePdf').excelLog(buf, fmt, layout);
    sendFile(res, fmt, `ทะเบียน CAR สบค-09 ปีงบ ${fy}${system ? ` ${system}` : ''}`, out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ใบ CAR/PAR (สบค-08)
router.get('/:id/form/:fmt(xlsx|pdf)', async (req, res) => {
  const car = getDb().get('SELECT * FROM car_log WHERE id = ?', [parseInt(req.params.id)]);
  if (!car) return res.status(404).json({ error: 'Not found' });
  try {
    const { buildCarForm } = require('../services/carXlsx');
    await sendXlsx(res, req.params.fmt, `${car.car_type || 'CAR'} ${car.car_number || car.unique_key} สบค-08`, await buildCarForm(car));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
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
  const { parameter_name, record_datetime } = req.body;

  if (!parameter_name || !record_datetime) {
    return res.status(400).json({ error: 'parameter_name and record_datetime required' });
  }

  // Lock issuer identity to logged-in user
  const cu = req.carUser;
  try {
    const result = await createCar(req.body, { name: cu?.name, dept: cu?.deptLabel });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (!e.status) throw e;
    res.status(e.status).json({ error: e.message });
  }
});

// Preview of the next auto number (actual number is assigned at create time)
router.get('/next-number', (req, res) => {
  const { prefix, car_type = 'CAR' } = req.query;
  try { res.json({ car_number: nextCarNumber(getDb(), prefix, car_type) }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
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
