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

  // Extract name + position — name starts with Thai honorific, position is the next <td>
  const rowRe = /<td valign='top' nowrap>((?:นาย|นาง(?:สาว)?|น\.ส\.|นส\.|ดร\.)[^<]+)<\/td>\s*<td valign='top' nowrap>([^<]*)<\/td>/g;
  const members = [];
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    const position = m[2].replace(/\s+/g, ' ').trim();
    if (name) members.push({ name, position });
  }

  return { deptLabel, members };
}

async function scrapeOrg(orgCode) {
  const html = await fetchHtml(`${EHR_BASE}/${orgCode}`);
  return parseOrg(html);
}

// ── ลูกจ้างที่ไม่มีใน EHR → ดึงจาก AquaDAT (get_adm01_authen_user) เข้ากลุ่ม 2 ──
// ตำแหน่ง/บทบาทที่เป็นบัญชีระบบ ไม่ใช่ผู้ปฏิบัติงาน
const NON_OPERATOR_POSITIONS = /^(helpdesk|admin|aq|sa|sitdev|programmer|aquadat system admin)$/i;
const ADMIN_ROLE_RE = /ผู้ดู[เแ]{1,2}ลระบบ/;     // ผู้ดูเเลระบบ… (AquaDAT สะกด เ เ สองตัว)
const THAI_NAME_RE = /^[฀-๿]/;   // ขึ้นต้นด้วยอักษรไทย (AquaDAT มี title แปลก เช่น "คุณ…" จึงไม่บังคับคำนำหน้ามาตรฐาน)

// "12/31/2030 00:00:00" (M/D/YYYY) → Date | null
function parseAqDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || '').trim());
  return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null;
}

function isActiveWorker(u, today) {
  if (u.user_type_text !== 'ลูกจ้าง') return false;
  if (u.user_status !== 'A' || u.record_status !== 'N') return false;
  const exp = parseAqDate(u.user_expire_date);
  if (exp && exp < today) return false;
  if (NON_OPERATOR_POSITIONS.test((u.position_name || '').trim())) return false;
  if (ADMIN_ROLE_RE.test(u.role_name || '')) return false;
  return true;
}

// ชื่อรูปแบบเดียวกับ fetchUserProfile / EHR: คำนำหน้า+ชื่อ แล้วเว้นวรรค นามสกุล
function aqFullName(u) {
  const first = [u.title_name, u.first_name].filter(Boolean).join('').replace(/\s+/g, ' ').trim();
  return [first, (u.last_name || '').trim()].filter(Boolean).join(' ');
}

async function syncAquadatWorkers(db, now) {
  const { fetchAuthenUsers } = require('./aquadat');
  const users = await fetchAuthenUsers(null, { plant_id: 2 });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let n = 0;
  for (const u of users) {
    if (!isActiveWorker(u, today)) continue;
    const name = aqFullName(u);
    if (!THAI_NAME_RE.test(name)) continue;           // กันชื่ออังกฤษ/บัญชีระบบหลุดมา
    // shift ไม่มีใน AquaDAT → NULL (แอดมินกำหนดเองในหน้า config); ถ้ามีแถวอยู่แล้ว (เช่นจาก EHR) ไม่แตะ shift/dept
    db.run(
      `INSERT INTO car_whitelist (name, group_code, shift, dept_label, position_label, user_code, synced_at)
       VALUES (?, '2', NULL, 'ลูกจ้าง (AquaDAT)', ?, ?, ?)
       ON CONFLICT(name, group_code) DO UPDATE SET synced_at = excluded.synced_at, user_code = excluded.user_code`,
      [name, (u.position_name || '').trim() || null, (u.user_name || '').trim() || null, now]
    );
    n++;
  }
  return n;
}

// ── กลุ่ม 3 (ผู้บริหาร) จาก EHR ───────────────────────────────────────────
// 3a (Step 2)  = ผู้อำนวยการกอง กผจ.ฝผม.  → org 00000136 (ลิงก์จากหน้า ฝผม. 00000034)
// 3b (Step 5)  = ผู้อำนวยการฝ่าย ฝผม.     → org 00000034
// กรองด้วยชื่อตำแหน่ง เพื่อไม่ดึงพนักงานคนอื่นในหน่วยงานเข้ามา
const GROUP3_MAP = [
  { orgCode: '00000136', group_code: '3a', position: /^ผู้อำนวยการกอง/ },
  { orgCode: '00000034', group_code: '3b', position: /^ผู้อำนวยการฝ่าย/ },
];

async function syncGroup3(db, now, results) {
  for (const { orgCode, group_code, position } of GROUP3_MAP) {
    try {
      const { deptLabel, members } = await scrapeOrg(orgCode);
      for (const m of members.filter(x => position.test(x.position))) {
        db.run(
          `INSERT INTO car_whitelist (name, group_code, shift, dept_label, position_label, synced_at)
           VALUES (?, ?, NULL, ?, ?, ?)
           ON CONFLICT(name, group_code) DO UPDATE SET
             dept_label = excluded.dept_label, position_label = excluded.position_label, synced_at = excluded.synced_at`,
          [m.name, group_code, deptLabel, m.position, now]
        );
        results.group3++;
        results.synced++;
      }
    } catch (err) {
      results.errors.push({ orgCode, error: err.message });
    }
  }
}

async function syncWhitelist(db) {
  const now = new Date().toISOString();
  const results = { synced: 0, aquadat: 0, group3: 0, errors: [] };

  for (const { orgCode, group_code, shift } of ORG_MAP) {
    try {
      const { deptLabel, members } = await scrapeOrg(orgCode);
      for (const { name, position } of members) {
        db.run(
          `INSERT INTO car_whitelist (name, group_code, shift, dept_label, position_label, synced_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(name, group_code) DO UPDATE SET
             shift          = excluded.shift,
             dept_label     = excluded.dept_label,
             position_label = excluded.position_label,
             synced_at      = excluded.synced_at`,
          [name, group_code, shift, deptLabel, position || null, now]
        );
        results.synced++;
      }
    } catch (err) {
      results.errors.push({ orgCode, error: err.message });
    }
  }

  await syncGroup3(db, now, results);

  try {
    results.aquadat = await syncAquadatWorkers(db, now);
    results.synced += results.aquadat;
  } catch (err) {
    results.errors.push({ orgCode: 'aquadat', error: err.message });
  }

  return results;
}

module.exports = { scrapeOrg, syncWhitelist, isActiveWorker, aqFullName };
