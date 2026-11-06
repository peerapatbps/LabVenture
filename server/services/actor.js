// Who is calling — same role derivation as /api/auth/me. Shared by routes that guard writes.
const { getDb } = require('./db');
const { fetchUserProfile } = require('./aquadat');

const SUPERADMIN_NAME = process.env.SUPERADMIN_NAME || 'นายพีรพัฒน์ สุขขารมย์';
const SUPERADMIN_ID = process.env.SUPERADMIN_ID || '00102616';
const GROUP_ROLE_MAP = { '1': 'scientist', '2': 'operator', '3a': 'executive_3a', '3b': 'executive_3b' };
const BYPASS_ROLE_MAP = { scientist_bypass: 'scientist', operator_bypass: 'operator' };

// role null = unrestricted (same rule as ROLE_PAGES)
const SCI_WRITE = new Set([null, 'scientist']);

// Superadmin = Super Admin bypass token, or the permanent account (SUPERADMIN_NAME / SUPERADMIN_ID).
// Single source of truth — auth.js, car.js, carAdmin.js and every guard below use it.
function isSuperadminIdentity(payload, profile) {
  if (payload?.bypass) return payload.role === 'superadmin';
  return (!!profile?.name && profile.name === SUPERADMIN_NAME)
    || (!!profile?.userId && String(profile.userId) === SUPERADMIN_ID)
    || String(payload?.sub ?? '') === SUPERADMIN_ID;
}

// Role guard: superadmin always passes; everyone else needs a role in `allowed`
function can(actor, allowed) {
  if (actor?.isSuperadmin) return true;
  return allowed.has(actor?.role ?? null);
}

// admin = superadmin, or whitelist is_admin (synced)
function requireAdmin(req, res, next) {
  if (!req.actor?.isSuperadmin && !req.actor?.isAdmin) return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ (admin) เท่านั้น' });
  next();
}

async function attachActor(req, res, next) {
  const token = req.cookies?.aquadat_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (payload.exp && payload.exp < Date.now() / 1000) return res.status(401).json({ error: 'Token expired' });
    if (payload.bypass) {
      const role = BYPASS_ROLE_MAP[payload.role] || payload.role || 'scientist';
      const isSuperadmin = isSuperadminIdentity(payload, null);
      req.actor = { name: `${payload.sub}`, role, bypass: true, isAdmin: isSuperadmin, isSuperadmin };
      return next();
    }
    const profile = await fetchUserProfile(token).catch(() => null);
    let role = null, isAdmin = false;
    if (profile?.name) {
      const entries = getDb().all('SELECT group_code, is_admin, synced_at FROM car_whitelist WHERE name = ?', [profile.name]);
      isAdmin = profile.name === SUPERADMIN_NAME || entries.some(e => e.is_admin === 1 && e.synced_at != null);
      if (!isAdmin && entries.length > 0) {
        const groups = entries.map(e => e.group_code);
        role = GROUP_ROLE_MAP[groups.find(g => g === '3a' || g === '3b') || groups[0]] || null;
      }
    }
    const isSuperadmin = isSuperadminIdentity(payload, profile);
    req.actor = { name: profile?.name || payload.sub || 'unknown', role, bypass: false, isAdmin: isAdmin || isSuperadmin, isSuperadmin };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { attachActor, requireAdmin, can, isSuperadminIdentity, SCI_WRITE, SUPERADMIN_NAME, SUPERADMIN_ID };
