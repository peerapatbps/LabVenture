const https = require('https');
const http = require('http');

const EHR_BASE = 'http://ehr.mwa.co.th/tel/index.php/main/show_list_org';

const ORG_MAP = [
  { orgCode: '00000350', group_code: '1',  shift: null },
  { orgCode: '00000351', group_code: '2',  shift: 1 },
  { orgCode: '00000352', group_code: '2',  shift: 2 },
  { orgCode: '00000353', group_code: '2',  shift: 3 },
  { orgCode: '00000354', group_code: '2',  shift: 4 },
];

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 10000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

function parseOrg(html) {
  // Extract org title abbreviation from parentheses in the <strong> header
  const titleMatch = html.match(/<strong>([^<]*\([^)]+\))<\/strong>/);
  const fullTitle = titleMatch ? titleMatch[1].trim() : '';
  const abbrevMatch = fullTitle.match(/\(([^)]+)\)\s*$/);
  const deptLabel = abbrevMatch ? abbrevMatch[1].trim() : fullTitle.slice(0, 30);

  // Extract names — names always start with Thai honorifics
  const nameRe = /<td valign='top' nowrap>((?:นาย|นาง(?:สาว)?|น\.ส\.|นส\.|ดร\.)[^<]+)<\/td>/g;
  const names = [];
  let m;
  while ((m = nameRe.exec(html)) !== null) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    if (name) names.push(name);
  }

  return { deptLabel, names };
}

async function scrapeOrg(orgCode) {
  const html = await fetchHtml(`${EHR_BASE}/${orgCode}`);
  return parseOrg(html);
}

async function syncWhitelist(db) {
  const now = new Date().toISOString();
  const results = { synced: 0, errors: [] };

  for (const { orgCode, group_code, shift } of ORG_MAP) {
    try {
      const { deptLabel, names } = await scrapeOrg(orgCode);
      for (const name of names) {
        // Upsert: preserve is_admin flag if entry already exists
        const existing = db.get('SELECT is_admin FROM car_whitelist WHERE name = ?', [name]);
        db.run(
          `INSERT INTO car_whitelist (name, group_code, shift, dept_label, synced_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(name, group_code) DO UPDATE SET
             shift      = excluded.shift,
             dept_label = excluded.dept_label,
             synced_at  = excluded.synced_at`,
          [name, group_code, shift, deptLabel, now]
        );
        results.synced++;
      }
    } catch (err) {
      results.errors.push({ orgCode, error: err.message });
    }
  }

  return results;
}

module.exports = { scrapeOrg, syncWhitelist };
