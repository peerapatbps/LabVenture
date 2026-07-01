const fetch = require('node-fetch');
require('dotenv').config();

const LINE_API = 'https://api.line.me/v2/bot/message/push';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROUP_ID = process.env.LINE_GROUP_ID;

const STATUS_EMOJI = { 10:'🔵', 20:'🟡', 30:'🟠', 40:'🟣', 50:'🟢', 60:'⬜', 70:'🔴' };
const STATUS_LABEL = {
  10: 'ออกใบแล้ว → รอผู้รับตอบ',
  20: 'รออนุมัติ → รอ ผอ.กผจ. เห็นชอบ',
  30: 'รอติดตามผล#1',
  40: 'รอติดตามผล#2',
  50: 'แก้ไขแล้ว → รอ ผอ.ฝผม. อนุมัติปิด',
  60: 'ปิดแล้ว ✅',
  70: 'ตีกลับ → ต้องออกใบใหม่ ❗',
};

// statusCode can be a number (new system) or legacy string
async function pushCarMessage(car, statusCode) {
  if (!TOKEN || !GROUP_ID) {
    console.warn('[LINE] TOKEN or GROUP_ID not configured — skipping push');
    return;
  }

  const code = typeof statusCode === 'number' ? statusCode : {
    issued: 10, responded: 20, approved: 30, validated: 50, closed: 60,
  }[statusCode] ?? 10;

  const emoji = STATUS_EMOJI[code] || '🔵';
  const label = STATUS_LABEL[code] || String(code);

  const direction = car.threshold_direction === 'above' ? '≥' : '≤';
  const lines = [
    `${emoji} [${car.car_type || 'CAR'} #${code}] ${car.car_number || '(ยังไม่มีเลข)'}`,
    `สิ่งที่พบ: ${car.parameter_name}`,
    car.recorded_value != null
      ? `ค่าที่พบ: ${car.recorded_value}${car.threshold_value ? ` (เกณฑ์: ${direction} ${car.threshold_value})` : ''}`
      : null,
    `สถานะ: ${label}`,
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
}

module.exports = { pushCarMessage };
