const fetch = require('node-fetch');
require('dotenv').config();

const LINE_API = 'https://api.line.me/v2/bot/message/push';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROUP_ID = process.env.LINE_GROUP_ID;

const STATUS_EMOJI = { 10:'🔵', 15:'🔷', 20:'🟡', 30:'🟠', 40:'🟣', 50:'🟢', 60:'⬜', 70:'🔴' };
// ข้อความสั้น (ผู้ใช้ขอ 17 พ.ย. 2569: แจ้งเฉพาะที่จำเป็น)
const STATUS_LABEL = {
  10: 'รอตอบกลับ',
  15: 'ส่งต่อแล้ว รอตอบกลับ',
  20: 'รอ ผอ.กผจ. อนุมัติ',
  30: 'รอติดตามผล #1',
  40: 'รอติดตามผล #2',
  50: 'รอ ผอ.ฝผม. พิจารณาปิด',
  60: 'ปิดแล้ว',
  70: 'ตีกลับ ต้องออกใบใหม่',
};

// "a, b และ c"
const thaiList = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} และ ${xs[xs.length - 1]}`);

// สรุปสิ่งที่พบแบบย่อ
// บรรทัดจาก Dashboard รูปแบบ "CW Turbid #1 - 13:00–10:14 - 6 NTU (เกณฑ์: ≤ 3)" → "CW Turbid #1, #2 และ #4 เกินเกณฑ์"
// หลายประเภท → "CW Turbid #1 และ #2 และ TW Turbid #3 เกินเกณฑ์" · ไม่ตรงรูปแบบ → บรรทัดแรกของเรื่องที่พบ (ตัดยาว)
function summarizeFinding(car) {
  const text = String(car.parameter_name || '');
  const groups = new Map();   // label → [num]
  for (const line of text.split('\n')) {
    const m = /^\s*(.+?)\s*#\s*(\d+)\s*-/.exec(line);
    if (!m) continue;
    const label = m[1].trim();
    if (!groups.has(label)) groups.set(label, []);
    if (!groups.get(label).includes(m[2])) groups.get(label).push(m[2]);
  }
  if (groups.size) {
    return `${[...groups].map(([label, nums]) => `${label} ${thaiList(nums.map(n => `#${n}`))}`).join(' และ ')} เกินเกณฑ์`;
  }
  const first = text.split('\n').map(s => s.trim()).find(Boolean) || '';
  const head = first.split(' — ')[0];
  return head.length > 80 ? `${head.slice(0, 78)}…` : head;
}

// ผู้รับผิดชอบ = ผู้ถือใบปัจจุบัน (ส่งต่อแล้วใช้ assignee) → "ผลัด 4" / ส่วนกอง / ชื่อ
function responsibleText(car) {
  const dept = car.assignee_name ? car.assignee_dept : car.receiver_dept;
  const name = car.assignee_name || car.receiver_name;
  const shift = /สคน(\d)กผจ/.exec(dept || '')?.[1];
  if (shift) return `ผลัด ${shift}`;
  return dept || name || null;
}

// 🔴 [CAR #70] HA 03/2570
// CW Turbid #1, #2, #3 และ #4 เกินเกณฑ์
// ผู้รับผิดชอบ: ผลัด 4
// สถานะ: ตีกลับ ต้องออกใบใหม่
// [note — เช่น ส่งต่อ / ประเด็นเข้าที่ประชุม]
function buildCarMessage(car, code, note = null) {
  const resp = responsibleText(car);
  return [
    `${STATUS_EMOJI[code] || '🔵'} [${car.car_type || 'CAR'} #${code}] ${car.car_number || '(ยังไม่มีเลข)'}`,
    summarizeFinding(car) || null,
    resp ? `ผู้รับผิดชอบ: ${resp}` : null,
    `สถานะ: ${STATUS_LABEL[code] || code}`,
    note,
  ].filter(Boolean).join('\n');
}

// statusCode can be a number (new system) or legacy string
// Returns true when LINE accepted the push, false when skipped (not configured); throws on failure
// note: บรรทัดเสริมท้ายข้อความ (เช่น "ส่งต่อให้ … — เหตุผล …")
async function pushCarMessage(car, statusCode, note = null) {
  if (!TOKEN || !GROUP_ID) {
    console.warn('[LINE] TOKEN or GROUP_ID not configured - skipping push');
    return false;
  }

  const code = typeof statusCode === 'number' ? statusCode : {
    issued: 10, responded: 20, approved: 30, validated: 50, closed: 60,
  }[statusCode] ?? 10;


  const lines = buildCarMessage(car, code, note);

  const res = await fetch(LINE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ to: GROUP_ID, messages: [{ type: 'text', text: lines }] }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[LINE] Push failed:', err);
    throw new Error(`LINE push failed: ${res.status}`);
  }
  return true;
}

module.exports = { pushCarMessage, buildCarMessage, summarizeFinding };
