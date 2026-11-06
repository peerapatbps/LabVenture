// /api/eventclass — Event Class authoring (Re-plan Labventure_plan.md §3.3).
// Reads are open: Uroboros eventclass.sync pulls GET /labventure/api/eventclass?enabled=true with no cookie.
// ?enabled=true = what is in force NOW: enabled AND (no scenario OR bound to the active scenario).
//   Classes with rule.ref get rule.value from the active scenario's LCL/UCL (ref stripped) — Uroboros sees plain numbers.
// Writes: scientist / superadmin (can(actor, SCI_WRITE)). Validation: services/eventClass.js.
const express = require('express');
const router = express.Router();
const { getDb, nowTH, eventClassesRecreatedAt } = require('../services/db');
const { attachActor, can, SCI_WRITE } = require('../services/actor');
const ec = require('../services/eventClass');
const alarmWatcher = require('../services/alarmWatcher');
const { allScenarioThresholds, getActiveScenario } = require('../services/scenario');
const { kickSync } = require('../services/uroboros');

function requireWrite(req, res, next) {
  if (!can(req.actor, SCI_WRITE)) return res.status(403).json({ error: 'เฉพาะนักวิทยาศาสตร์เท่านั้นที่แก้ Event Class ได้' });
  next();
}

const findRow = (id) => getDb().get('SELECT * FROM event_classes WHERE event_class_id = ?', [id]);

// สร้าง/แก้/เปิด-ปิด/ลบ Event Class สำเร็จ → ให้ Uroboros ดึงชุดใหม่ทันที (ไม่ต้องรอ eventclass.sync รอบ 120 วิ)
// มิฉะนั้นคลาสที่เพิ่งเปิดจะยังไม่ถูกประเมิน — alarm มาช้าหรือไม่มาเลยในการทดสอบ
router.use((req, res, next) => {
  const definesClass = req.method !== 'GET' && !req.path.startsWith('/occurrences') && req.path !== '/validate';
  if (definesClass) res.on('finish', () => { if (res.statusCode < 300) kickSync().catch(() => {}); });
  next();
});

async function check(item) {
  const [{ schema }, vocab] = await Promise.all([ec.getMetricSchema(), ec.getVocabulary()]);
  return ec.validate(item, { schema: ec.schemaCtx(schema), vocabulary: ec.vocabCtx(vocab) });
}

const activeScenarioId = () => getDb().get('SELECT id FROM scenarios WHERE active = 1 LIMIT 1')?.id ?? null;
const errorText = (errors) => errors.map(e => `${e.field}: ${e.msg}`).join(' · ');

function insert(item, actor) {
  const p = ec.ecToParams(item);
  const now = nowTH();
  getDb().run(
    `INSERT INTO event_classes (event_class_id, title, category, severity, source_metric, rule, audio_mode,
       message_template, fallback_text, ui, zone, enabled, scenario_id, car_policy, car_prefix, param_key, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.event_class_id, p.title, p.category, p.severity, p.source_metric, p.rule, p.audio_mode,
      p.message_template, p.fallback_text, p.ui, p.zone, p.enabled, p.scenario_id, p.car_policy, p.car_prefix, p.param_key, now, now, actor]
  );
}

function update(item, actor) {
  const p = ec.ecToParams(item);
  getDb().run(
    `UPDATE event_classes SET title = ?, category = ?, severity = ?, source_metric = ?, rule = ?, audio_mode = ?,
       message_template = ?, fallback_text = ?, ui = ?, zone = ?, enabled = ?, scenario_id = ?, car_policy = ?, car_prefix = ?,
       param_key = ?, updated_at = ?, updated_by = ?
     WHERE event_class_id = ?`,
    [p.title, p.category, p.severity, p.source_metric, p.rule, p.audio_mode, p.message_template, p.fallback_text,
      p.ui, p.zone, p.enabled, p.scenario_id, p.car_policy, p.car_prefix, p.param_key, nowTH(), actor, item.event_class_id]
  );
}

// ── reads ──────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const enabledOnly = req.query.enabled === 'true' || req.query.enabled === '1';
  const scenarioId = activeScenarioId();
  if (enabledOnly) {
    // ตาราง event_classes เพิ่งถูกสร้างใหม่ (ว่าง) → ตอบ 503 ให้ Uroboros eventclass.sync ใช้ cache เดิมต่อ แทนที่จะล้างเป็น 0
    const recreatedAt = eventClassesRecreatedAt();
    if (recreatedAt) return res.status(503).json({
      ok: false,
      error: `event_classes ถูกสร้างใหม่เป็นตารางว่างเมื่อ ${recreatedAt} (ไฟล์ DB อาจถูกวางทับ) — กู้ Event Class หรือสร้าง class อย่างน้อย 1 ตัวเพื่อปลด`,
    });
    // what Uroboros evaluates: rule.ref → number from the active scenario's thresholds; no bound there → left out
    const byKey = ec.activeThresholdsByKey();
    const scenarioName = getActiveScenario()?.row?.name ?? null;
    // ui ผ่าน Uroboros ไปถึง BellBeast/device แบบไม่ถูกแตะ → แนบชื่อสถานการณ์ + เกณฑ์ที่ใช้ไว้ให้แสดงผลได้
    const items = getDb().all('SELECT * FROM event_classes WHERE enabled = 1 AND (scenario_id IS NULL OR scenario_id = ?) ORDER BY zone, event_class_id', [scenarioId])
      .map(r => {
        const raw = ec.rowToEc(r);
        const it = ec.resolveItem(raw, byKey);
        if (!it || !raw.rule?.ref) return it;
        return { ...it, ui: { ...(it.ui || {}), scenario: scenarioName, limit: it.rule.value } };
      }).filter(Boolean);
    return res.json({ ok: true, server_ts: nowTH(), active_scenario_id: scenarioId, items });
  }
  // authoring view: raw items + value per scenario for ref classes
  const scenarios = allScenarioThresholds();
  const items = getDb().all('SELECT * FROM event_classes ORDER BY zone, event_class_id').map(r => {
    const it = ec.rowToEc(r);
    return it.rule?.ref ? { ...it, resolved: ec.resolvedByScenario(it, scenarios) } : it;
  });
  res.json({ ok: true, server_ts: nowTH(), active_scenario_id: scenarioId, items });
});

router.get('/me', attachActor, (req, res) => {
  res.json({ ok: true, actor: req.actor, can_write: can(req.actor, SCI_WRITE) });
});

// metric list for the source_metric dropdown (proxy of Uroboros /api/metrics/schema)
router.get('/schema', attachActor, async (req, res) => {
  const { schema, error, stale } = await ec.getMetricSchema({ fresh: req.query.fresh === '1' });
  if (!schema) return res.status(502).json({ error });
  res.json({ ok: true, ...schema, stale: !!stale, error });
});

router.get('/vocabulary', attachActor, async (req, res) => {
  res.json({ ok: true, ...(await ec.getVocabulary({ fresh: req.query.fresh === '1' })) });
});

// clip-ids Event Classes reference but BellBeast lacks — paste `vocab` into BellBeast App_Data/audio/vocab.json
router.get('/clips-needed', async (req, res) => {
  const vocab = await ec.getVocabulary();
  const items = getDb().all('SELECT * FROM event_classes ORDER BY event_class_id').map(ec.rowToEc);
  const needed = ec.clipsNeeded(items, vocab);
  res.json({
    ok: true, vocabulary_source: vocab.source, needed,
    vocab: needed.map(n => ({ id: n.id, text: n.text || '' })),
  });
});

// ── alarm levels L2/L1/H1/H2 of one parameter, each referencing the scenario's LCL/UCL ──
// body: { param_key, enabled, car_policy?, car_prefix?, levels: { l2|l1|h1|h2: { mode, amount, severity } | null } }
// a level given → created / updated (keeps edited voice text, hysteresis, CAR settings); null → deleted
router.post('/levels', attachActor, requireWrite, async (req, res) => {
  const paramKey = String(req.body?.param_key || '').trim();
  const levels = req.body?.levels || {};
  const enabled = req.body?.enabled !== false;
  if (!paramKey) return res.status(400).json({ error: 'ต้องเลือกพารามิเตอร์' });
  const plan = [];
  const failed = [];
  for (const lvl of Object.keys(ec.LEVELS)) {
    const id = ec.levelId(paramKey, lvl);
    const row = findRow(id);
    const spec = levels[lvl];
    if (!spec) { if (row) plan.push({ lvl, id, del: true }); continue; }
    let item;
    try {
      item = ec.normalize(ec.levelItem(paramKey, lvl, { mode: spec.mode, amount: Number(spec.amount), severity: spec.severity },
        { prev: row ? ec.rowToEc(row) : null, enabled, defaults: req.body }), id);
    } catch (e) { failed.push({ event_class_id: id, error: e.message }); continue; }
    const { errors, warnings } = await check(item);
    if (errors.length) failed.push({ event_class_id: id, error: errorText(errors) });
    else plan.push({ lvl, id, item, exists: !!row, warnings });
  }
  // all-or-nothing: a bad level blocks the whole set so the levels never end up half-saved
  if (failed.length) {
    // same problem on every level (e.g. a missing voice clip) → say it once
    const byError = new Map();
    for (const f of failed) byError.set(f.error, [...(byError.get(f.error) || []), f.event_class_id]);
    const error = [...byError].map(([msg, ids]) => `${ids.join(', ')}: ${msg}`).join(' · ');
    return res.status(400).json({ error: `${error}${enabled ? ' — บันทึกเป็นฉบับร่าง (ไม่ติ๊กเปิดใช้) ได้' : ''}`, failed });
  }
  const specs = Object.fromEntries(Object.entries(levels).filter(([, v]) => v).map(([k, v]) => [k, { mode: v.mode, amount: Number(v.amount) }]));
  for (const p of plan) {
    if (p.del) getDb().run('DELETE FROM event_classes WHERE event_class_id = ?', [p.id]);
    else if (p.exists) update(p.item, req.actor.name);
    else insert(p.item, req.actor.name);
  }
  res.json({
    ok: true,
    saved: plan.filter(p => !p.del).map(p => p.id),
    deleted: plan.filter(p => p.del).map(p => p.id),
    warnings: [...ec.levelOrderWarnings(paramKey, specs), ...(() => {
      const byMsg = new Map();
      for (const p of plan) for (const w of p.warnings || []) byMsg.set(w.msg, [...(byMsg.get(w.msg) || []), p.id]);
      return [...byMsg].map(([msg, ids]) => `${ids.join(', ')}: ${msg}`);
    })()],
  });
});

// ── alarm occurrences (P3) — recorded by services/alarmWatcher.js from Uroboros /api/alarm/state ──
// car_status: none (policy none) | pending (needs a decision) | issued (car_key → car_log) | dismissed | failed (auto)
const OCC_SQL = `SELECT o.*, e.title, e.zone, e.car_policy, e.car_prefix, c.car_number, c.status_code AS car_status_code, c.id AS car_id,
    s.name AS scenario_name
  FROM event_occurrences o
  LEFT JOIN event_classes e ON e.event_class_id = o.event_class_id
  LEFT JOIN scenarios s ON s.id = o.scenario_id
  LEFT JOIN car_log c ON c.unique_key = o.car_key`;
const findOcc = (id) => getDb().get(`${OCC_SQL} WHERE o.id = ?`, [id]);

router.get('/occurrences', attachActor, (req, res) => {
  const where = [];
  const args = [];
  if (req.query.open === '1') where.push('o.cleared_at IS NULL');
  if (req.query.car_status) { where.push('o.car_status = ?'); args.push(req.query.car_status); }
  if (req.query.event_class_id) { where.push('o.event_class_id = ?'); args.push(req.query.event_class_id); }
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const rows = getDb().all(`${OCC_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.id DESC LIMIT ${limit}`, args);
  const pending = getDb().get("SELECT COUNT(*) AS n FROM event_occurrences WHERE car_status IN ('pending', 'failed')").n;
  res.json({ ok: true, items: rows, pending, watcher: alarmWatcher.getStatus() });
});

// manual poll (also what the watcher does every N s) — handy right after a change on Uroboros
router.post('/occurrences/poll', attachActor, requireWrite, async (req, res) => {
  const r = await alarmWatcher.pollOnce();
  res.json({ ok: !!r, ...(r || {}), watcher: alarmWatcher.getStatus() });
});

function occForCar(req, res) {
  const occ = findOcc(req.params.id);
  if (!occ) { res.status(404).json({ error: 'ไม่พบเหตุการณ์' }); return null; }
  if (occ.car_status === 'issued') { res.status(409).json({ error: `ออก CAR แล้ว (${occ.car_number || occ.car_key})` }); return null; }
  return occ;
}

// 1) draft → client opens the CAR form (/car) prefilled; the person adds receiver and issues it
router.get('/occurrences/:id/car-draft', attachActor, (req, res) => {
  const occ = occForCar(req, res);
  if (!occ) return;
  const row = findRow(occ.event_class_id);
  if (!row) return res.status(404).json({ error: `ไม่พบ Event Class ${occ.event_class_id}` });
  res.json({ ok: true, draft: ec.carDraftFromOccurrence(ec.rowToEc(row), occ) });
});

// 2) link → CARLog posts the new CAR's unique_key back here
router.post('/occurrences/:id/car', attachActor, requireWrite, (req, res) => {
  const carKey = req.body?.car_key;
  if (!carKey) return res.status(400).json({ error: 'ต้องระบุ car_key' });
  if (!getDb().get('SELECT id FROM car_log WHERE unique_key = ?', [carKey])) return res.status(404).json({ error: `ไม่พบ CAR ${carKey}` });
  if (!occForCar(req, res)) return;
  getDb().run("UPDATE event_occurrences SET car_status = 'issued', car_key = ?, car_by = ?, car_at = ?, car_note = NULL WHERE id = ?",
    [carKey, req.actor.name, nowTH(), req.params.id]);
  res.json({ ok: true, item: findOcc(req.params.id) });
});

// no CAR needed (e.g. sampling error, already covered by another CAR) — reason is kept for audit
router.post('/occurrences/:id/dismiss', attachActor, requireWrite, (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'ต้องระบุเหตุผล' });
  if (!occForCar(req, res)) return;
  getDb().run("UPDATE event_occurrences SET car_status = 'dismissed', car_note = ?, car_by = ?, car_at = ? WHERE id = ?",
    [reason, req.actor.name, nowTH(), req.params.id]);
  res.json({ ok: true, item: findOcc(req.params.id) });
});

// dry-run validation for the editor (no write)
router.post('/validate', attachActor, async (req, res) => {
  const item = ec.normalize(req.body, req.body?.event_class_id);
  const result = await check(item);
  res.json({ ok: result.errors.length === 0, ...result, item });
});

router.get('/:id', (req, res) => {
  const row = findRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบ Event Class' });
  res.json({ ok: true, item: ec.rowToEc(row) });
});

// ── writes ─────────────────────────────────────────────────────────────────
router.post('/', attachActor, requireWrite, async (req, res) => {
  const item = ec.normalize(req.body);
  const { errors, warnings } = await check(item);
  if (findRow(item.event_class_id)) errors.push({ field: 'event_class_id', msg: 'id นี้มีอยู่แล้ว' });
  if (errors.length) return res.status(400).json({ error: errorText(errors), errors, warnings });

  insert(item, req.actor.name);
  res.json({ ok: true, item: ec.rowToEc(findRow(item.event_class_id)), warnings });
});

router.put('/:id', attachActor, requireWrite, async (req, res) => {
  if (!findRow(req.params.id)) return res.status(404).json({ error: 'ไม่พบ Event Class' });
  const item = ec.normalize(req.body, req.params.id);   // id comes from the path — not renameable
  const { errors, warnings } = await check(item);
  if (errors.length) return res.status(400).json({ error: errorText(errors), errors, warnings });

  update(item, req.actor.name);
  res.json({ ok: true, item: ec.rowToEc(findRow(req.params.id)), warnings });
});

router.patch('/:id/enabled', attachActor, requireWrite, async (req, res) => {
  const row = findRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบ Event Class' });
  if (req.body?.enabled) {
    // a draft may have open reference warnings — enabling must pass the full check
    const { errors } = await check({ ...ec.rowToEc(row), enabled: true });
    if (errors.length) return res.status(400).json({ error: `เปิดใช้ไม่ได้ — ${errorText(errors)}`, errors });
  }
  getDb().run('UPDATE event_classes SET enabled = ?, updated_at = ?, updated_by = ? WHERE event_class_id = ?',
    [req.body?.enabled ? 1 : 0, nowTH(), req.actor.name, req.params.id]);
  res.json({ ok: true, item: ec.rowToEc(findRow(req.params.id)) });
});

// delete a class — past occurrences keep their event_class_id text (history stays readable)
router.delete('/:id', attachActor, requireWrite, (req, res) => {
  const row = findRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบ Event Class' });
  getDb().run('DELETE FROM event_classes WHERE event_class_id = ?', [req.params.id]);
  console.log(`[eventclass] ${req.actor.name} deleted ${req.params.id}`);
  res.json({ ok: true, deleted: req.params.id });
});

module.exports = router;
