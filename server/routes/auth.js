const express = require('express');
const router = express.Router();
const { restLogin, graphqlLogin, fetchUserProfile } = require('../services/aquadat');
const { getDb } = require('../services/db');
const { getStage } = require('../services/stageMonitor');

const SUPERADMIN_NAME = process.env.SUPERADMIN_NAME || 'นายพีรพัฒน์ สุขขารมย์';
const GROUP_ROLE_MAP = { '1': 'scientist', '2': 'operator', '3a': 'executive_3a', '3b': 'executive_3b' };

// Shared helper: issue a bypass JWT and set cookie
function issueBypass(res, role) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 86400;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: `bypass-${role}`, role, bypass: true, iat, exp })).toString('base64url');
  const fakeToken = `${header}.${payload}.bypass`;
  res.cookie('aquadat_token', fakeToken, { httpOnly: true, sameSite: 'lax', maxAge: 86400 * 1000 });
  return { ok: true, username: `bypass-${role}`, role, exp, iat, bypass: true };
}

// Login: relay to AquaDAT, set JWT in HTTP-only cookie
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  // Auto-bypass when Aquadat is unreachable (stage 0 or 2)
  const stage = getStage();
  if (stage === 0 || stage === 2) {
    // Determine role from query param or default; operator_bypass for multi-user station
    const role = req.body.role === 'scientist' ? 'scientist_bypass' : 'operator_bypass';
    console.log(`[login] stage=${stage} → auto bypass (${role})`);
    const data = issueBypass(res, role);
    return res.json(data);
  }

  try {
    // Try REST login first (for data reading token)
    let token, exp;
    try {
      token = await restLogin(username, password);
    } catch {
      // Fallback to GraphQL login
      token = await graphqlLogin(username, password);
    }

    // Decode JWT exp without a library
    const parts = token.split('.');
    let expTime = Date.now() / 1000 + 86400; // default 24h
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        if (payload.exp) expTime = payload.exp;
      } catch {}
    }

    res.cookie('aquadat_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: (expTime - Date.now() / 1000) * 1000,
    });

    res.json({
      ok: true,
      username,
      exp: expTime,
      iat: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    console.error('[login] failed:', err.message);
    res.status(401).json({ error: err.message || 'Login failed' });
  }
});

// DEV ONLY: bypass login without AquaDAT (for testing outside Intranet)
// role: scientist | operator | executive_3a | executive_3b | observer | superadmin
router.post('/bypass', (req, res) => {
  const { role = 'scientist' } = req.body;
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 86400;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: `dev-${role}`, role, bypass: true, iat, exp })).toString('base64url');
  const fakeToken = `${header}.${payload}.bypass`;

  res.cookie('aquadat_token', fakeToken, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 86400 * 1000,
  });
  res.json({ ok: true, username: `dev-${role}`, role, exp, iat });
});

router.post('/logout', (req, res) => {
  res.clearCookie('aquadat_token');
  res.json({ ok: true });
});

// Return token expiry info + user profile for header display
router.get('/me', async (req, res) => {
  const token = req.cookies?.aquadat_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const sub = payload.sub;

    // Bypass tokens: return role directly without AquaDAT lookup
    if (payload.bypass) {
      const ROLE_LABELS = {
        scientist:         'นักวิทยาศาสตร์ (Dev)',
        operator:          'Operator (Dev)',
        executive_3a:      'ผอ.กผจ. (Dev)',
        executive_3b:      'ผอ.ฝผม. (Dev)',
        observer:          'ผู้สังเกตการณ์ (Dev)',
        superadmin:        'Super Admin (Dev)',
        operator_bypass:   'Operator (Offline)',
        scientist_bypass:  'นักวิทยาศาสตร์ (Offline)',
      };
      const role = payload.role || 'scientist';
      return res.json({
        ok: true,
        exp: payload.exp,
        sub,
        iat: payload.iat,
        role,
        bypass: true,
        name: ROLE_LABELS[role] || `Dev [${role}]`,
        position: role,
        avatarUrl: null,
      });
    }

    // Try to fetch name/position/avatar from AquaDAT get_user_info (best-effort)
    const profile = await fetchUserProfile(token);

    // Derive page-access role from whitelist group
    let role = null;
    if (profile?.name) {
      try {
        const db = getDb();
        const entries = db.all('SELECT group_code, is_admin, synced_at FROM car_whitelist WHERE name = ?', [profile.name]);
        const isAdmin = profile.name === SUPERADMIN_NAME || entries.some(e => e.is_admin === 1 && e.synced_at != null);
        if (!isAdmin && entries.length > 0) {
          const groups = entries.map(e => e.group_code);
          const primary = groups.find(g => g === '3a' || g === '3b') || groups[0] || null;
          role = GROUP_ROLE_MAP[primary] || null;
        }
      } catch { /* DB not ready or whitelist empty — no restriction */ }
    }

    res.json({
      ok: true,
      exp: payload.exp,
      sub,
      iat: payload.iat,
      role,
      bypass: false,
      name: profile?.name || null,
      position: profile?.position || null,
      avatarUrl: profile?.avatarUrl || null,
    });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
