const fetch = require('node-fetch');
require('dotenv').config();

const LINE_API = 'https://api.line.me/v2/bot/message/push';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROUP_ID = process.env.LINE_GROUP_ID;

const { getFindings, formatFinding } = require('./carFindings');

const STATUS_EMOJI = { 10:'🔵', 15:'🔷', 45:'🔺', 20:'🟡', 30:'🟠', 40:'🟣', 50:'🟢', 60:'⬜', 70:'🔴' };
const STATUS_LABEL = {
  10: 'ออกใบแล้ว → รอผู้รับตอบ',
  15: 'ส่งต่อแล้ว → รอผู้รับต่อตอบ',
  20: 'รออนุมัติ → รอ ผอ.กผจ. เห็นชอบ',
  30: 'รอติดตามผล#1',
  40: 'รอติดตามผล#2',
  45: 'ติดตาม 2 ครั้งยังปิดไม่ได้ → นำเข้าที่ประชุม',
  50: 'แก้ไขแล้ว → รอ ผอ.ฝผม. อนุมัติปิด',
  60: 'ปิดแล้ว ✅',
  70: 'ตีกลับ → ต้องออกใบใหม่ ❗',
};

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

  const emoji = STATUS_EMOJI[code] || '🔵';
  const label = STATUS_LABEL[code] || String(code);

  // criterion symbol, same as CARLog.jsx: alert 'above' ⇒ เกณฑ์ ≤ X, 'below' ⇒ เกณฑ์ ≥ X (หลายบรรทัดได้)
  const findings = getFindings(car);
  const findingLines = findings.length === 1
    ? [`ค่าที่พบ: ${formatFinding(findings[0])}`]
    : findings.length > 1
      ? ['ค่าที่พบ:', ...findings.map((f, i) => `  ${i + 1}) ${formatFinding(f)}`)]
      : [];
  const lines = [
    `${emoji} [${car.car_type || 'CAR'} #${code}] ${car.car_number || '(ยังไม่มีเลข)'}`,
    `สิ่งที่พบ: ${car.parameter_name}`,
    ...findingLines,
    `สถานะ: ${label}`,
    (code === 10 || code === 15) && (car.assignee_name || car.receiver_name)
      ? `ผู้รับ${car.assignee_name ? 'ปัจจุบัน' : ''}: ${car.assignee_name || car.receiver_name}${(car.assignee_name ? car.assignee_dept : car.receiver_dept) ? ` (${car.assignee_name ? car.assignee_dept : car.receiver_dept})` : ''}`
      : null,
    note,
    car.deadline_at ? `Deadline: ${car.deadline_at}` : null,
  ].filter(Boolean).join('\n');

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

module.exports = { pushCarMessage };
