// ทดสอบ get_adm01_authen_user (AquaDAT GraphQL) — แสดงเฉพาะ "สรุป" ไม่พิมพ์ชื่อบุคคล/รหัสผ่าน
// ใช้:  node scripts/probe_aquadat_users.js            (login ด้วย AQUADAT_SVC_USER/PASS ใน .env)
//       AQUADAT_TOKEN=<jwt> node scripts/probe_aquadat_users.js   (ใช้ token ที่มีอยู่แล้ว)
//       node scripts/probe_aquadat_users.js --dump=out.json       (เขียนรายการเต็มลงไฟล์ — มีข้อมูลบุคคล)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { getServiceToken, fetchAuthenUsers } = require('../services/aquadat');

function tally(rows, pick) {
  const m = new Map();
  for (const r of rows) for (const k of [].concat(pick(r) ?? [])) m.set(k ?? '(null)', (m.get(k ?? '(null)') || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

(async () => {
  const dump = (process.argv.find(a => a.startsWith('--dump=')) || '').slice(7);
  let token = process.env.AQUADAT_TOKEN;
  if (!token && process.env.AQUADAT_SVC_USER && process.env.AQUADAT_SVC_PASS) {
    console.log('login ผ่าน AQUADAT_SVC_USER/PASS ...');
    token = await getServiceToken();
    console.log('login OK (token ยาว', token.length, 'ตัวอักษร)');
  } else if (!token) {
    console.log('ไม่มี token / ไม่ได้ตั้ง AQUADAT_SVC_* → ยิงแบบไม่ใส่ Authorization');
  }
  const rows = await fetchAuthenUsers(token, { plant_id: 2 });
  console.log('จำนวนผู้ใช้ plant_id=2:', rows.length);
  console.log('user_status      :', JSON.stringify(tally(rows, r => r.user_status)));
  console.log('record_status    :', JSON.stringify(tally(rows, r => r.record_status)));
  console.log('user_type_text   :', JSON.stringify(tally(rows, r => r.user_type_text)));
  console.log('role_name        :', JSON.stringify(tally(rows, r => r.role_name)));
  console.log('position_name    :', JSON.stringify(tally(rows, r => r.position_name).slice(0, 25)));
  console.log('user_group_name  :', JSON.stringify(tally(rows, r => (r.usergrouplist || []).map(g => g.user_group_name))));
  console.log('station (authen) :', JSON.stringify(tally(rows, r => (r.authen_user || []).map(a => a.station_name_th))));
  if (dump) { fs.writeFileSync(dump, JSON.stringify(rows, null, 2)); console.log('เขียนไฟล์', dump); }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
