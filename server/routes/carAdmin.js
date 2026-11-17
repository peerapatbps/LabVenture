const express = require('express');
const router = express.Router();
const http = require('http');
const { getDb } = require('../services/db');
const { fetchUserProfile } = require('../services/aquadat');
const { syncWhitelist } = require('../services/ehr');

const { isSuperadminIdentity, SUPERADMIN_NAME } = require('../services/actor');

function isSuperadmin(entry) {
  return entry?.name === SUPERADMIN_NAME;
}

// ── EHR employee search proxy ──────────────────────────────────────────────
function searchEhrEmployee(empId) {
  return new Promise((resolve, reject) => {
    const body = `text_no=${encodeURIComponent(empId)}&text_name=&text_lname=`;
    const opts = {
      hostname: 'ehr.mwa.co.th',
      path: '/tel/index.php/main/search_emp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 8000,
    };
    const req = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        // Parse rows: each result row has emp_id in #ffff33 span
        const results = [];
        const rowRe = /<span style='background: #ffff33'>(\d+)<\/span><\/td>\s*<td><a href="([^"]+)"[^>]*>([^<]+)<\/a>[^<]*<\/td>\s*<td>&nbsp;?([^<]*)<\/td>\s*<td>&nbsp;?([^<]*)<\/td>/g;
        let m;
        while ((m = rowRe.exec(html)) !== null) {
          results.push({
            emp_id: m[1].trim(),
            org_url: m[2].trim(),
            name_no_prefix: m[3].trim(),
            position: m[4].replace(/&nbsp;?/g, '').trim(),
            dept: m[5].replace(/&nbsp;?/g, '').trim(),
          });
        }
        resolve(results);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('EHR search timeout')); });
    req.write(body);
    req.end();
  });
}

// ── helpers ────────────────────────────────────────────────────────────────

function decodeToken(token) {
  try {
    const parts = token.split('.');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return null;
  }
}

// Map bypass role → CAR group config
const BYPASS_ROLE_MAP = {
  scientist:    { group: '1',  groups: ['1'],           isAdmin: false, name: 'นักวิทยาศาสตร์ (Dev)', deptLabel: 'Dev' },
  operator:     { group: '2',  groups: ['2'],           isAdmin: false, name: 'Operator (Dev)',        deptLabel: 'Dev' },
  executive_3a: { group: '3a', groups: ['3a'],          isAdmin: false, name: 'ผอ.กผจ. (Dev)',         deptLabel: 'Dev' },
  executive_3b: { group: '3b', groups: ['3b'],          isAdmin: false, name: 'ผอ.ฝผม. (Dev)',         deptLabel: 'Dev' },
  observer:     { group: null, groups: [],              isAdmin: false, name: 'ผู้สังเกตการณ์ (Dev)',  deptLabel: 'Dev', isObserver: true },
  superadmin:   { group: '1',  groups: ['1','2','3a','3b'], isAdmin: true, name: 'Super Admin (Dev)', deptLabel: 'Dev' },
};

async function resolveCarUser(req) {
  const token = req.cookies?.aquadat_token;
  if (!token) return null;
  const payload = decodeToken(token);
  if (!payload || payload.exp < Date.now() / 1000) return null;

  // Bypass token: return mock role without DB/AquaDAT lookup
  if (payload.bypass) {
    const roleConfig = BYPASS_ROLE_MAP[payload.role] || BYPASS_ROLE_MAP.scientist;
    return { shift: null, position: payload.role, bypass: true, ...roleConfig };
  }

  const profile = await fetchUserProfile(token).catch(() => null);
  if (!profile?.name) return null;
  const db = getDb();
  const entries = db.all('SELECT * FROM car_whitelist WHERE name = ?', [profile.name]);
  // Admin = badge AND synced from EHR (synced_at IS NOT NULL), OR is superadmin
  const isAdmin = isSuperadminIdentity(payload, profile) || entries.some(e => e.is_admin === 1 && e.synced_at != null);
  // Collect all groups for this person
  const groups = entries.map(e => e.group_code);
  // Primary group: prefer 3a/3b over others, else first
  const primary = groups.find(g => g === '3a' || g === '3b') || groups[0] || null;
  const primaryEntry = entries.find(e => e.group_code === primary) || entries[0];
  return {
    name: profile.name,
    position: profile.position || '',
    group: primary,
    groups,
    shift: primaryEntry?.shift || null,
    deptLabel: primaryEntry?.dept_label || '',
    isAdmin,
    isObserver: false,
  };
}

async function requireAdmin(req, res, next) {
  const user = await resolveCarUser(req);
  if (!user || !user.isAdmin) return res.status(403).json({ error: 'Admin only' });
  req.carUser = user;
  next();
}

// ── GET /api/car-admin/my-role ─────────────────────────────────────────────
// Returns current user's role info (no auth required — returns null group if not found)
router.get('/my-role', async (req, res) => {
  try {
    const user = await resolveCarUser(req);
    if (!user) return res.json({ name: null, group: null, shift: null, deptLabel: '', isAdmin: false });
    res.json(user);
  } catch {
    res.json({ name: null, group: null, shift: null, deptLabel: '', isAdmin: false });
  }
});

// ── GET /api/car-admin/receivers ───────────────────────────────────────────
// ตัวเลือก "ผู้รับ" ของฟอร์มออก CAR: ผลัด 1-4 → หน่วยงาน (dept_label ใน whitelist เช่น สคน1กผจ.ฝผม.)
// + รายชื่อผู้ปฏิบัติงานของผลัด + หัวหน้าส่วน (default). ไม่ต้องเป็น admin แต่ต้อง login
router.get('/receivers', async (req, res) => {
  try {
    const user = await resolveCarUser(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    const db = getDb();
    const out = [1, 2, 3, 4].map(shift => {
      const rows = db.all(
        "SELECT name, position_label, dept_label FROM car_whitelist WHERE group_code = '2' AND shift = ? ORDER BY name", [shift]);
      const isHead = r => /หัวหน้าส่วน/.test(r.position_label || '');
      const members = [...rows.filter(isHead), ...rows.filter(r => !isHead(r))]
        .map(r => ({ name: r.name, position: r.position_label || '', isHead: isHead(r) }));
      return {
        shift,
        dept_label: rows.find(r => r.dept_label)?.dept_label || `สคน${shift}กผจ.ฝผม.`,
        head: members.find(m => m.isHead)?.name || null,
        members,
      };
    });
    // ผู้ปฏิบัติงาน (ลูกจ้างจาก AquaDAT, ไม่มีผลัด) — ส่วน/กองกลาง กผจ.ฝผม. (แก้ได้ที่ฟอร์ม)
    const workers = db.all(
      "SELECT name, position_label FROM car_whitelist WHERE group_code = '2' AND (shift IS NULL OR shift NOT BETWEEN 1 AND 4) ORDER BY name");
    out.push({
      shift: 'worker',
      dept_label: 'กผจ.ฝผม.',
      head: null,
      members: workers.map(r => ({ name: r.name, position: r.position_label || '', isHead: false })),
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/car-admin/whitelist ───────────────────────────────────────────
router.get('/whitelist', requireAdmin, (req, res) => {
  const db = getDb();
  res.json(db.all('SELECT * FROM car_whitelist ORDER BY group_code, shift, name'));
});

// ── POST /api/car-admin/sync ───────────────────────────────────────────────
router.post('/sync', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const result = await syncWhitelist(db);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/car-admin/manual ─────────────────────────────────────────────
// Add Group 3 managers or set admin flag
router.post('/manual', requireAdmin, (req, res) => {
  const { name, group_code, shift, dept_label, position_label, is_admin } = req.body;
  if (!name || !group_code) return res.status(400).json({ error: 'name and group_code required' });
  const db = getDb();
  db.run(
    `INSERT INTO car_whitelist (name, group_code, shift, dept_label, position_label, is_admin)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name, group_code) DO UPDATE SET
       shift          = excluded.shift,
       dept_label     = excluded.dept_label,
       position_label = excluded.position_label,
       is_admin       = excluded.is_admin`,
    [name, group_code, shift || null, dept_label || null, position_label || null, is_admin ? 1 : 0]
  );
  const entry = db.get('SELECT * FROM car_whitelist WHERE name = ?', [name]);
  res.json({ ok: true, entry });
});

// ── PATCH /api/car-admin/:id ───────────────────────────────────────────────
router.patch('/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  const db = getDb();
  const entry = db.get('SELECT * FROM car_whitelist WHERE id = ?', [id]);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (isSuperadmin(entry)) return res.status(403).json({ error: 'Superadmin ไม่สามารถแก้ไขได้' });

  const { name, group_code, shift, dept_label, position_label, is_admin } = req.body;
  const sets = [], params = [];
  if (name != null)           { sets.push('name = ?');           params.push(name); }
  if (group_code != null)     { sets.push('group_code = ?');     params.push(group_code); }
  if (shift !== undefined)    { sets.push('shift = ?');          params.push(shift); }
  if (dept_label != null)     { sets.push('dept_label = ?');     params.push(dept_label); }
  if (position_label !== undefined) { sets.push('position_label = ?'); params.push(position_label || null); }
  if (is_admin != null)       { sets.push('is_admin = ?');       params.push(is_admin ? 1 : 0); }
  if (sets.length === 0)  return res.status(400).json({ error: 'Nothing to update' });

  params.push(id);
  db.run(`UPDATE car_whitelist SET ${sets.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true, entry: db.get('SELECT * FROM car_whitelist WHERE id = ?', [id]) });
});

// ── DELETE /api/car-admin/:id ──────────────────────────────────────────────
router.delete('/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  const db = getDb();
  const entry = db.get('SELECT * FROM car_whitelist WHERE id = ?', [id]);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (isSuperadmin(entry)) return res.status(403).json({ error: 'Superadmin ไม่สามารถลบได้' });
  db.run('DELETE FROM car_whitelist WHERE id = ?', [id]);
  res.json({ ok: true });
});

// ── POST /api/car-admin/search-emp ────────────────────────────────────────
router.post('/search-emp', requireAdmin, async (req, res) => {
  const { emp_id } = req.body;
  if (!emp_id) return res.status(400).json({ error: 'emp_id required' });
  try {
    const results = await searchEhrEmployee(emp_id.trim());
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.resolveCarUser = resolveCarUser;   // ใช้ตรวจสิทธิ์ admin ใน routes/car.js (รองรับ bypass token)
