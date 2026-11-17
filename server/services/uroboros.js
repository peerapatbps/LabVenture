// คุยกับ Uroboros (:8888) — แจ้ง sync เกณฑ์ใหม่ + test mode (ค่าแล็ปปลอมในหน่วยความจำของ Uroboros)
// kickSync: ดึง Event Class ใหม่ทันที (ปกติ eventclass.sync รอบละ 120 วิ) แล้ว eval ต่อเลย
//   ใช้หลังเปลี่ยนสถานการณ์/แก้เกณฑ์ · best effort: ล้มเหลวก็ไม่ทำให้งานหลักล้ม
//   ปิดได้ที่ services.json uroboros.sync_on_scenario_change = false (dev / mock ที่ไม่มี :8888)
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'services.json');

function cfg() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).uroboros || {}; } catch { return {}; }
}
const baseUrl = () => process.env.UROBOROS_BASE_URL || cfg().base_url || 'http://localhost:8888';   // env override ใช้ตอน e2e test
const why = (e) => (e.code ? `${e.code} (${baseUrl()})` : e.message);   // ECONNREFUSED มี message ว่าง

// JSON request → { status, body } · throws on network error
async function call(method, p, body) {
  const r = await fetch(`${baseUrl()}${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    timeout: 5000,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// task ของ alarm ใน Uroboros (task_settings) → { name: enabled } · null = อ่านไม่ได้
const ALARM_TASKS = ['eventclass.sync', 'alarm.eval', 'Alarm.warmup', 'metric.history.sample'];
async function alarmTasks() {
  try {
    const r = await call('GET', '/admin/tasks/config');
    if (r.status !== 200 || !Array.isArray(r.body?.tasks)) return null;
    return Object.fromEntries(r.body.tasks.filter(t => ALARM_TASKS.includes(t.name)).map(t => [t.name, !!t.enabled]));
  } catch { return null; }
}

// ต่อคิว task ตามลำดับ → 'ok' | 'ok (engine paused …)'
// 409 = Uroboros ไม่รับเข้าคิว: task ถูกปิดใน task_settings (หรือ engine pause / กำลังรันอยู่) → throw พร้อมเหตุผล
async function enqueue(names) {
  let paused = false;
  for (const Name of names) {
    const r = await call('POST', '/tasks/enqueue', { Name });
    if (r.status === 409) {
      const tasks = await alarmTasks();
      if (tasks && tasks[Name] === false) throw new Error(`task ${Name} ปิดอยู่ใน Uroboros — เปิดที่ Uroboros Admin ก่อน`);
      if (r.body?.paused) throw new Error(`Uroboros engine pause อยู่ — ${Name} ไม่ทำงาน`);
      continue;   // กำลังรันอยู่ → รอบนั้นจะได้ข้อมูลล่าสุดเอง
    }
    if (r.status >= 300) throw new Error(`${Name}: Uroboros returned ${r.status}`);
    paused = paused || !!r.body?.paused;
  }
  return paused ? 'ok (engine paused — จะทำงานเมื่อ start)' : 'ok';
}

// eventclass.sync แล้วรอให้เสร็จจริง (last_sync เปลี่ยน, ≤ 6 วิ) ค่อย alarm.eval
// — alarm.eval มี priority สูงกว่า ถ้าต่อคิวพร้อมกันอาจรันก่อน sync แล้วไม่เห็นคลาสที่เพิ่งเปิด
async function syncThenEval() {
  const lastSync = async () => (await call('GET', '/api/alarm/state')).body?.event_classes?.last_sync ?? null;
  const before = await lastSync().catch(() => null);
  const r = await enqueue(['eventclass.sync']);
  for (let i = 0; i < 20; i++) {
    await new Promise(ok => setTimeout(ok, 300));
    if ((await lastSync().catch(() => before)) !== before) break;
  }
  await enqueue(['alarm.eval']);
  return r;
}

// คืนข้อความสั้น ๆ สำหรับเก็บใน scenario_log.sync_result
async function kickSync() {
  if (cfg().sync_on_scenario_change === false) return 'skipped (ปิดใน services.json)';
  try {
    return await syncThenEval();
  } catch (e) {
    const w = e.code ? why(e) : e.message;
    console.warn(`[uroboros] kickSync failed: ${w}`);
    return `failed: ${w}`;
  }
}

// alarm.eval อีก n รอบ — ใช้กับกฎ for_polls > 1 (ต้องเห็นค่าเกินติดกัน N รอบ eval)
// alarm.eval เป็น DropIfRunning: last_eval_at เปลี่ยนก่อน task จบ (ยังส่ง BellBeast อยู่ ≤ 6 วิ) → ต่อคิวซ้ำจนรับ (409 = ยังรันอยู่)
// since = last_eval_at ก่อนรอบที่ต่อคิวไปแล้ว (เช่นจาก syncThenEval) → รอรอบนั้นก่อน ไม่นับซ้ำ
const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));
const lastEvalAt = async () => (await call('GET', '/api/alarm/state')).body?.last_eval_at ?? null;
async function evalRounds(n, { since } = {}) {
  if (since !== undefined) {
    for (let i = 0; i < 20; i++) {
      if ((await lastEvalAt().catch(() => since)) !== since) break;
      await sleep(300);
    }
  }
  let done = 0;
  for (let k = 0; k < n; k++) {
    const before = await lastEvalAt().catch(() => null);
    let accepted = false;
    for (let i = 0; i < 24 && !accepted; i++) {
      const r = await call('POST', '/tasks/enqueue', { Name: 'alarm.eval' });
      if (r.status < 300) { accepted = true; break; }
      if (r.status !== 409) throw new Error(`alarm.eval: Uroboros returned ${r.status}`);
      if (r.body?.paused) throw new Error('Uroboros engine pause อยู่ — alarm.eval ไม่ทำงาน');
      if (i === 0 && (await alarmTasks())?.['alarm.eval'] === false) throw new Error('task alarm.eval ปิดอยู่ใน Uroboros — เปิดที่ Uroboros Admin ก่อน');
      await sleep(500);
    }
    if (!accepted) break;
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      if ((await lastEvalAt().catch(() => before)) !== before) { done++; break; }
    }
  }
  return done;
}

module.exports = { kickSync, syncThenEval, evalRounds, lastEvalAt, enqueue, call, why, alarmTasks, ALARM_TASKS };
