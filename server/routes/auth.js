const express = require('express');
const router = express.Router();
const { restLogin, graphqlLogin, fetchUserProfile } = require('../services/aquadat');

// Login: relay to AquaDAT, set JWT in HTTP-only cookie
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

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
router.post('/bypass', (req, res) => {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 86400;
  // Fake JWT payload (header.payload.sig — not verified, just for /me to decode)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'dev-bypass', iat, exp })).toString('base64url');
  const fakeToken = `${header}.${payload}.bypass`;

  res.cookie('aquadat_token', fakeToken, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 86400 * 1000,
  });
  res.json({ ok: true, username: 'dev-bypass', exp, iat });
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

    // Try to fetch name/position/avatar from AquaDAT get_user_info (best-effort)
    const profile = await fetchUserProfile(token);

    res.json({
      ok: true,
      exp: payload.exp,
      sub,
      iat: payload.iat,
      name: profile?.name || null,
      position: profile?.position || null,
      avatarUrl: profile?.avatarUrl || null,
    });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
