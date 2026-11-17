// Seed the 12 chlorine-leak Event Classes (CHEM1/CHEM2 × S1–S4, D1–D2) through the LabVenture API.
// Same rule as the old Uroboros alarm_rules.json chem*_cl_*_high (kept disabled there — never enable both).
// Naming/zone/ui.highlight follow what the annunciator needs to find plant + point (handoff0711 §5.1).
//
//   node scripts/seed_cl_eventclasses.js [--base http://localhost:8889] [--dry-run] [--disabled] [--value 1.0]
//
// Login: POST /api/auth/bypass role=superadmin (dev bypass; allowed at every stage).
// Existing id → PUT (update), otherwise POST. Validation errors are printed and that class is skipped.
const fetch = require('node-fetch');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const BASE = opt('--base', 'http://localhost:8889').replace(/\/$/, '');
const DRY = args.includes('--dry-run');
const ENABLED = !args.includes('--disabled');
const VALUE = Number(opt('--value', '1.0'));

const POINTS = [
  { p: 's1', room: 'โรงเก็บท่อคลอรีน', n: 1 }, { p: 's2', room: 'โรงเก็บท่อคลอรีน', n: 2 },
  { p: 's3', room: 'โรงเก็บท่อคลอรีน', n: 3 }, { p: 's4', room: 'โรงเก็บท่อคลอรีน', n: 4 },
  { p: 'd1', room: 'ห้องจ่ายคลอรีน', n: 1 }, { p: 'd2', room: 'ห้องจ่ายคลอรีน', n: 2 },
];

function classes() {
  const out = [];
  for (const plant of [1, 2]) {
    for (const { p, room, n } of POINTS) {
      const id = `chem${plant}_cl_${p}_high`;
      const title = `เซนเซอร์คลอรีน ${room} ${plant} จุดที่ ${n}`;
      out.push({
        event_class_id: id,
        title,
        category: 'safety',
        severity: 'critical',
        source_metric: `CHEM${plant}.cl_${p.toUpperCase()}`,
        rule: { op: '>', value: VALUE, unit: 'ppm', hysteresis: 0, for_polls: 2, decimals: 1 },
        audio_mode: 'B',
        message_template: [`s_${id}`, 's_high', 's_latest_value', '{value}', 's_ppm'],
        fallback_text: `${title} สูงกว่าเกณฑ์ ค่าล่าสุด {value} พีพีเอ็ม`,
        ui: { type: 'map', highlight: p, limit: VALUE },
        zone: `CHEM${plant}`,
        enabled: ENABLED,
        scenario_id: null,
        car_policy: 'none',     // gas-leak safety alarm, not a lab nonconformity → no CAR
        car_prefix: 'CQ',
      });
    }
  }
  return out;
}

async function main() {
  const login = await fetch(`${BASE}/api/auth/bypass`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'superadmin' }),
  });
  if (!login.ok) throw new Error(`bypass login failed: ${login.status} ${await login.text()}`);
  const cookie = (login.headers.raw()['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  let ok = 0, bad = 0;
  for (const item of classes()) {
    const v = await (await fetch(`${BASE}/api/eventclass/validate`, { method: 'POST', headers, body: JSON.stringify(item) })).json();
    const warn = (v.warnings || []).map(w => `${w.field}: ${w.msg}`);
    if (!v.ok) {
      bad++;
      console.log(`✗ ${item.event_class_id} — ${(v.errors || []).map(e => `${e.field}: ${e.msg}`).join(' · ')}`);
      continue;
    }
    if (DRY) { ok++; console.log(`✓ ${item.event_class_id} (dry-run)${warn.length ? `  ⚠ ${warn.join(' · ')}` : ''}`); continue; }
    const exists = (await fetch(`${BASE}/api/eventclass/${item.event_class_id}`, { headers })).ok;
    const r = await fetch(`${BASE}/api/eventclass${exists ? `/${item.event_class_id}` : ''}`, {
      method: exists ? 'PUT' : 'POST', headers, body: JSON.stringify(item),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { ok++; console.log(`✓ ${item.event_class_id} ${exists ? 'updated' : 'created'}${warn.length ? `  ⚠ ${warn.join(' · ')}` : ''}`); }
    else { bad++; console.log(`✗ ${item.event_class_id} — ${r.status} ${j.error || ''}`); }
  }
  console.log(`\n${ok} ok, ${bad} failed · base ${BASE} · enabled=${ENABLED} · value>${VALUE}${DRY ? ' · DRY RUN' : ''}`);
  process.exitCode = bad ? 1 : 0;
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
