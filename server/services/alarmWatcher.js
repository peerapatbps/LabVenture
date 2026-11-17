// Polls Uroboros GET /api/alarm/state and records each Event Class alarm episode in event_occurrences
// (Labventure_plan.md §6 P3). LabVenture stays the authoring side: Uroboros decides "fired", this only
// keeps the record and follows up with CAR per the class's car_policy:
//   none    → just logged
//   suggest → car_status 'pending' — a scientist issues the CAR from a prefilled draft, or dismisses it
//   auto    → CAR issued right away (skipped while Uroboros runs dry_run — left 'pending' instead)
// An episode = alarm_id while Uroboros reports it active; it is closed when it drops out / turns inactive.
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { getDb, nowTH } = require('./db');
const { createCar } = require('./carCreate');
const ec = require('./eventClass');
const { getActiveScenario } = require('./scenario');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'services.json');
const AUTO_ISSUER = { name: 'ระบบแจ้งเตือนอัตโนมัติ (Event Class)', dept: null };

const status = { running: false, last_poll_at: null, last_ok_at: null, error: null, dry_run: null, active: 0 };
let timer = null;

function cfg() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).uroboros || {}; } catch { return {}; }
}

// worst value so far: the far side of the limit (min for "<" rules, max otherwise)
function worse(op, a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return String(op).startsWith('<') ? Math.min(a, b) : Math.max(a, b);
}

async function issueAutoCar(occId) {
  const db = getDb();
  const occ = db.get('SELECT * FROM event_occurrences WHERE id = ?', [occId]);
  const item = ec.rowToEc(db.get('SELECT * FROM event_classes WHERE event_class_id = ?', [occ.event_class_id]));
  try {
    const car = await createCar(ec.carDraftFromOccurrence(item, occ), AUTO_ISSUER);
    db.run("UPDATE event_occurrences SET car_status = 'issued', car_key = ?, car_by = ?, car_at = ? WHERE id = ?",
      [car.unique_key, AUTO_ISSUER.name, nowTH(), occId]);
    console.log(`[alarmWatcher] auto CAR ${car.car_number || car.unique_key} for ${occ.event_class_id} (occurrence #${occId})`);
  } catch (e) {
    db.run("UPDATE event_occurrences SET car_status = 'failed', car_note = ? WHERE id = ?", [`ออก CAR อัตโนมัติไม่สำเร็จ: ${e.message}`, occId]);
    console.warn(`[alarmWatcher] auto CAR failed for occurrence #${occId}: ${e.message}`);
  }
}

// สถานการณ์ที่ active + เกณฑ์ของ class ในสถานการณ์นั้น (null = class นี้ไม่มีผลในสถานการณ์นี้)
function classInScenario(row, scenarioId, byKey) {
  if (!row || !row.enabled) return { inForce: false, threshold: null };
  const item = ec.rowToEc(row);
  if (item.rule?.ref) {
    const resolved = ec.resolveItem(item, byKey);
    return { inForce: !!resolved, threshold: resolved ? resolved.rule.value : null };
  }
  const inForce = item.scenario_id == null || item.scenario_id === scenarioId;
  return { inForce, threshold: Number.isFinite(item.rule?.value) ? item.rule.value : null };
}

// ทำไม episode นี้หายจาก feed: ค่ากลับปกติ / เปลี่ยนสถานการณ์จนไม่มีเกณฑ์ / class ถูกปิด-ลบ / อื่น ๆ
function clearReason(o, present, scenarioId, byKey) {
  if (present.has(o.alarm_id)) return 'recovered';            // ยังอยู่ใน feed แต่ active:false
  const row = getDb().get('SELECT * FROM event_classes WHERE event_class_id = ?', [o.event_class_id]);
  if (!row || !row.enabled) return 'class_disabled';
  if (!classInScenario(row, scenarioId, byKey).inForce) return 'scenario_change';
  return 'vanished';
}

// items: Uroboros AlarmItem[] (alarm_id "lab:<event_class_id>" แล็ป · "ec:<event_class_id>" realtime เช่นคลอรีน). Exported for tests.
async function ingest(items, { dryRun = false } = {}) {
  const db = getDb();
  const now = nowTH();
  const active = new Map();
  const present = new Set();
  for (const it of items || []) {
    if (typeof it.alarm_id !== 'string' || !/^(lab|ec):/.test(it.alarm_id)) continue;
    present.add(it.alarm_id);
    if (it.active) active.set(it.alarm_id, it);
  }
  const scenarioId = getActiveScenario()?.row?.id ?? null;
  const byKey = ec.activeThresholdsByKey();

  const open = db.all('SELECT * FROM event_occurrences WHERE cleared_at IS NULL');
  for (const o of open) {
    if (!active.has(o.alarm_id)) {
      db.run('UPDATE event_occurrences SET cleared_at = ?, clear_reason = ? WHERE id = ?',
        [now, clearReason(o, present, scenarioId, byKey), o.id]);
    } else if (o.scenario_id != null && scenarioId !== o.scenario_id && !o.scenario_changed) {
      // ดังข้ามการเปลี่ยนสถานการณ์ → ต่อ episode เดิม (ไม่เปิดใหม่ ไม่ออก CAR ซ้ำ) แค่ทำเครื่องหมายไว้
      db.run('UPDATE event_occurrences SET scenario_changed = 1 WHERE id = ?', [o.id]);
    }
  }

  const created = [];
  for (const [alarmId, it] of active) {
    const ecId = alarmId.slice(alarmId.indexOf(':') + 1);
    const row = db.get('SELECT * FROM event_classes WHERE event_class_id = ?', [ecId]);
    const op = row ? (JSON.parse(row.rule || '{}').op || '>') : '>';
    const value = Number.isFinite(it.value) ? it.value : null;
    const o = open.find(x => x.alarm_id === alarmId);
    if (o) {
      db.run('UPDATE event_occurrences SET last_seen_at = ?, value_last = ?, value_worst = ? WHERE id = ?',
        [now, value, worse(op, o.value_worst, value), o.id]);
      continue;
    }
    // test mode (ค่าปลอมใน Uroboros) → บันทึกไว้ดูได้ แต่ไม่ต้องตัดสินใจ CAR และห้ามออก CAR อัตโนมัติ
    const isTest = it.test === true;
    const policy = isTest ? 'none' : (row?.car_policy || 'none');   // unknown class (deleted here) → log only
    const { threshold } = classInScenario(row, scenarioId, byKey);
    db.run(
      `INSERT INTO event_occurrences (event_class_id, alarm_id, since, first_seen_at, last_seen_at, severity,
         value_first, value_last, value_worst, unit, car_status, car_note, scenario_id, threshold_value, is_test)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ecId, alarmId, it.since || now, now, now, it.severity || null, value, value, value, it.unit || null,
        policy === 'none' ? 'none' : 'pending',
        isTest ? '[TEST] ข้อมูลทดสอบจาก test mode — ไม่ออก CAR'
          : policy === 'auto' && dryRun ? 'Uroboros อยู่ในโหมด dry_run — ไม่ออก CAR อัตโนมัติ' : null,
        scenarioId, threshold, isTest ? 1 : 0]
    );
    const id = db.get('SELECT last_insert_rowid() AS id').id;
    created.push(id);
    if (policy === 'auto' && !dryRun) await issueAutoCar(id);
  }
  status.active = active.size;
  return { created, active: active.size };
}

async function pollOnce() {
  const c = cfg();
  const url = `${process.env.UROBOROS_BASE_URL || c.base_url || 'http://localhost:8888'}${c.alarm_state_path || '/api/alarm/state'}`;
  status.last_poll_at = nowTH();
  let data;
  try {
    const r = await fetch(url, { timeout: 8000 });
    if (!r.ok) throw new Error(`Uroboros returned ${r.status}`);
    data = await r.json();
  } catch (e) {
    // unreachable → leave open episodes as they are (no false "cleared")
    status.error = e.message;
    return null;
  }
  status.error = null;
  status.last_ok_at = status.last_poll_at;
  status.dry_run = !!data.dry_run;
  return ingest(data.alarms, { dryRun: !!data.dry_run });
}

function start() {
  const c = cfg();
  if (c.alarm_watch === false) { console.log('[alarmWatcher] disabled (services.json uroboros.alarm_watch = false)'); return; }
  const sec = Math.max(15, Number(c.alarm_poll_sec) || 60);
  status.running = true;
  let busy = false;   // a slow tick (CAR + LINE push) must not overlap the next — it would open the episode twice
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await pollOnce(); } catch (e) { status.error = e.message; } finally { busy = false; }
  };
  tick();
  timer = setInterval(tick, sec * 1000);
  console.log(`[alarmWatcher] polling Uroboros alarm state every ${sec}s`);
}

function stop() { if (timer) clearInterval(timer); timer = null; status.running = false; }

module.exports = { start, stop, pollOnce, ingest, getStatus: () => ({ ...status }) };
