// /api/testmode — Test mode ของหน้า /config (Ctrl+Shift+F10) · เฉพาะ super admin
// ฉีดค่าแล็ปปลอมเข้า Uroboros (เก็บในหน่วยความจำ หมดอายุเอง ไม่เขียน data.db) → alarm วิ่งจริงทั้งสาย:
//   Event Class → Uroboros eval → BellBeast → device → LabVenture watcher (occurrence ติดป้าย TEST ไม่ออก CAR)
// Uroboros: GET/POST/DELETE /api/alarm/test/lab (AlarmTestOverlay.cs)
const express = require('express');
const router = express.Router();
const { getDb } = require('../services/db');
const { attachActor, requireAdmin } = require('../services/actor');
const uro = require('../services/uroboros');
const ec = require('../services/eventClass');
const { getActiveScenario } = require('../services/scenario');

router.use(attachActor, requireAdmin);

// ทุกอย่างที่ panel ต้องใช้ในครั้งเดียว: ค่าปลอมที่ค้างอยู่, alarm แล็ปตอนนี้, Event Class แล็ป + เกณฑ์ปัจจุบัน
router.get('/status', async (req, res) => {
  const out = { uroboros: { ok: false, error: null }, overlay: [], alarms: [], classes: [], scenario: null, recent_log: [] };
  try {
    const [ov, st] = await Promise.all([uro.call('GET', '/api/alarm/test/lab'), uro.call('GET', '/api/alarm/state')]);
    if (ov.status === 404) out.uroboros.error = 'Uroboros รุ่นนี้ยังไม่มี test mode (/api/alarm/test/lab) — ต้อง publish ใหม่';
    else out.overlay = ov.body?.items || [];
    out.alarms = (st.body?.alarms || []).filter(a => String(a.alarm_id).startsWith('lab:'));
    out.uroboros.ok = st.status === 200 && ov.status === 200;
    out.uroboros.dry_run = !!st.body?.dry_run;
    out.uroboros.last_sync = st.body?.event_classes?.last_sync ?? null;
    out.uroboros.last_eval = st.body?.last_eval_at ?? null;
    out.uroboros.lab_rules = st.body?.event_classes?.lab_rules ?? null;
    out.uroboros.tasks = await uro.alarmTasks();   // { 'alarm.eval': false, … } — ปิดอยู่ = ค่าที่ฉีดจะไม่ถูกประเมิน
  } catch (e) {
    out.uroboros.error = `ติดต่อ Uroboros ไม่ได้: ${uro.why(e)}`;
  }
  const active = getActiveScenario();
  out.scenario = active ? { id: active.row.id, name: active.row.name, epidemic: active.epidemic } : null;
  const byKey = ec.activeThresholdsByKey();
  out.classes = getDb().all('SELECT * FROM event_classes ORDER BY zone, event_class_id').map(r => {
    const it = ec.rowToEc(r);
    const sm = it.source_metric;
    if (!sm || typeof sm !== 'object' || sm.configparam_id == null) return null;
    const resolved = ec.resolveItem(it, byKey);
    return {
      event_class_id: it.event_class_id, title: it.title, param_key: it.param_key, zone: it.zone,
      enabled: it.enabled, configparam_id: sm.configparam_id, op: it.rule?.op, unit: it.rule?.unit || '',
      for_polls: it.rule?.for_polls || 1, limit: resolved ? resolved.rule.value : null,
      in_force: !!resolved && (it.scenario_id == null || it.scenario_id === active?.row?.id),
    };
  }).filter(Boolean);
  out.recent_log = require('../services/scenarioHistory').listPeriods({ limit: 5, testOnly: true });
  res.json(out);
});

// ฉีดค่าปลอม { configparam_id, value, count?, ttl_min? } แล้วสั่ง eval ทันที
router.post('/inject', async (req, res) => {
  const b = req.body || {};
  const cid = Number(b.configparam_id);
  const value = Number(b.value);
  if (!Number.isInteger(cid) || cid <= 0) return res.status(400).json({ error: 'ต้องระบุ configparam_id' });
  if (b.value === '' || b.value == null || !Number.isFinite(value)) return res.status(400).json({ error: 'ค่าต้องเป็นตัวเลข' });
  const count = Math.min(10, Math.max(1, Number(b.count) || 1));
  const ttl = Math.min(240, Math.max(1, Number(b.ttl_min) || 15));   // default short: the test hides the real value
  try {
    const r = await uro.call('POST', '/api/alarm/test/lab', { configparam_id: cid, value, count, ttl_min: ttl, note: `LabVenture test · ${req.actor.name}` });
    if (r.status !== 200) return res.status(502).json({ error: r.body?.error || `Uroboros returned ${r.status}${r.status === 404 ? ' (ยังไม่มี test mode — ต้อง publish Uroboros ใหม่)' : ''}` });
    let evalResult;
    // sync ก่อน eval: คลาสที่เพิ่งเปิดใน panel จะถูกประเมินในรอบนี้เลย
    try { evalResult = await uro.syncThenEval(); } catch (e) { evalResult = `failed: ${e.code ? uro.why(e) : e.message}`; }
    console.log(`[testmode] ${req.actor.name} inject lab:${cid} = ${value} x${count} (${ttl} min)`);
    res.json({ ok: true, item: r.body.item, eval: evalResult });
  } catch (e) {
    res.status(502).json({ error: `ติดต่อ Uroboros ไม่ได้: ${uro.why(e)}` });
  }
});

// ล้างค่าปลอม ?configparam_id= (ไม่ใส่ = ทั้งหมด) แล้วสั่ง eval → alarm ที่มาจากค่าปลอมจบ
router.delete('/inject', async (req, res) => {
  const cid = req.query.configparam_id;
  try {
    const r = await uro.call('DELETE', `/api/alarm/test/lab${cid ? `?configparam_id=${encodeURIComponent(cid)}` : ''}`);
    if (r.status !== 200) return res.status(502).json({ error: r.body?.error || `Uroboros returned ${r.status}` });
    try { await uro.enqueue(['alarm.eval']); } catch {}
    console.log(`[testmode] ${req.actor.name} clear ${cid ? `lab:${cid}` : 'all'} (${r.body?.removed})`);
    res.json({ ok: true, removed: r.body?.removed ?? 0 });
  } catch (e) {
    res.status(502).json({ error: `ติดต่อ Uroboros ไม่ได้: ${uro.why(e)}` });
  }
});

module.exports = router;
