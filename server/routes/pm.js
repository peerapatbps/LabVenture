// /api/pm — หน้าแผนงาน (Gantt ปีงบ). Reads: any logged-in user. Writes: admin only (requireAdmin).
// Expansion / validation / audit live in services/pm.js.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const { getDb, nowTH } = require('../services/db');
const { attachActor, requireAdmin } = require('../services/actor');
const pm = require('../services/pm');

router.use(attachActor);

const errorText = (errors) => errors.map(e => `${e.field}: ${e.msg}`).join(' · ');
const findPlan = (id) => getDb().get('SELECT * FROM pm_plans WHERE id = ?', [id]);
const findTask = (id) => getDb().get('SELECT * FROM pm_tasks WHERE id = ?', [id]);
const intOrNull = (v) => (v === '' || v == null ? null : Number(v));
// a due month the task's rule produces, or one that already has a stored row
const isOccurrence = (t, due) =>
  !!getDb().get('SELECT 1 FROM pm_occurrences WHERE task_id = ? AND due_month = ?', [t.id, due])
  || pm.expand(JSON.parse(t.recurrence || 'null'), due, due).length > 0;

// ── reads ──────────────────────────────────────────────────────────────────
router.get('/plans', (req, res) => {
  const all = req.query.archived === 'true';
  res.json({ items: getDb().all(`SELECT * FROM pm_plans ${all ? '' : 'WHERE archived = 0'} ORDER BY id`) });
});

router.get('/plans/:id', (req, res) => {
  const plan = findPlan(Number(req.params.id));
  if (!plan) return res.status(404).json({ error: 'ไม่พบแผน' });
  res.json({ plan, tasks: pm.taskTree(plan.id).map(({ row, depth }) => ({ ...pm.rowToTask(row), depth })) });
});

router.get('/plans/:id/gantt', (req, res) => {
  const plan = findPlan(Number(req.params.id));
  if (!plan) return res.status(404).json({ error: 'ไม่พบแผน' });
  const fy = Number(req.query.fy) || pm.fyOf(pm.todayYM(), plan.fy_start_month);
  res.json(pm.gantt(plan.id, fy));
});

router.get('/summary/pending', (req, res) => {
  const ym = pm.YM_RE.test(req.query.ym || '') ? req.query.ym : undefined;
  res.json(pm.pendingSummary(ym));
});

router.get('/audit', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ items: getDb().all('SELECT * FROM pm_audit ORDER BY id DESC LIMIT ?', [limit]) });
});

// ── plans (admin) ────────────────────────────────────────────────────────────
function planParams(b) {
  return {
    code: b.code?.trim() || null, title: String(b.title || '').trim(), org_unit: b.org_unit?.trim() || null,
    fy_start_month: Number(b.fy_start_month) || 10, forecast_years: Math.min(Math.max(Number(b.forecast_years ?? 4), 0), 10),
  };
}

router.post('/plans', requireAdmin, (req, res) => {
  const p = planParams(req.body);
  if (!p.title) return res.status(400).json({ error: 'ต้องระบุชื่อแผน' });
  const now = nowTH();
  try {
    getDb().run(
      'INSERT INTO pm_plans (code, title, org_unit, fy_start_month, forecast_years, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [p.code, p.title, p.org_unit, p.fy_start_month, p.forecast_years, now, now, req.actor.name]);
  } catch (e) {
    return res.status(409).json({ error: `บันทึกไม่ได้: ${e.message}` });
  }
  const plan = getDb().get('SELECT * FROM pm_plans WHERE id = last_insert_rowid()');
  pm.audit('plan', plan.id, 'create', null, plan, req.actor.name);
  res.json({ ok: true, plan });
});

router.put('/plans/:id', requireAdmin, (req, res) => {
  const before = findPlan(Number(req.params.id));
  if (!before) return res.status(404).json({ error: 'ไม่พบแผน' });
  const p = planParams({ ...before, ...req.body });
  if (!p.title) return res.status(400).json({ error: 'ต้องระบุชื่อแผน' });
  const archived = req.body.archived != null ? (req.body.archived ? 1 : 0) : before.archived;
  getDb().run(
    'UPDATE pm_plans SET code = ?, title = ?, org_unit = ?, fy_start_month = ?, forecast_years = ?, archived = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    [p.code, p.title, p.org_unit, p.fy_start_month, p.forecast_years, archived, nowTH(), req.actor.name, before.id]);
  const plan = findPlan(before.id);
  pm.audit('plan', plan.id, 'update', before, plan, req.actor.name);
  res.json({ ok: true, plan });
});

// ── tasks (admin) ────────────────────────────────────────────────────────────
function taskParams(b) {
  const kind = b.kind === 'group' ? 'group' : 'task';
  return {
    parent_id: intOrNull(b.parent_id), wbs: b.wbs?.trim() || null, title: String(b.title || '').trim(), kind,
    recurrence: kind === 'task' && b.recurrence ? { v: 1, unit: 'month', until: null, ...b.recurrence } : null,
    qty: intOrNull(b.qty), unit: b.unit?.trim() || null, owner: b.owner?.trim() || null, note: b.note?.trim() || null,
  };
}

const nextSortOrder = (planId, parentId) =>
  (getDb().get('SELECT MAX(sort_order) AS m FROM pm_tasks WHERE plan_id = ? AND parent_id IS ?', [planId, parentId])?.m ?? 0) + 1;

router.post('/plans/:id/tasks', requireAdmin, (req, res) => {
  const plan = findPlan(Number(req.params.id));
  if (!plan) return res.status(404).json({ error: 'ไม่พบแผน' });
  const t = taskParams(req.body);
  const { errors, warnings } = pm.validateTask(t, { planId: plan.id });
  if (errors.length) return res.status(400).json({ error: errorText(errors), errors, warnings });
  const now = nowTH();
  const sort = req.body.sort_order != null ? Number(req.body.sort_order) : nextSortOrder(plan.id, t.parent_id);
  getDb().run(
    `INSERT INTO pm_tasks (plan_id, parent_id, wbs, title, kind, sort_order, recurrence, qty, unit, owner, note, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [plan.id, t.parent_id, t.wbs, t.title, t.kind, sort, t.recurrence ? JSON.stringify(t.recurrence) : null,
      t.qty, t.unit, t.owner, t.note, now, now, req.actor.name]);
  const task = getDb().get('SELECT * FROM pm_tasks WHERE id = last_insert_rowid()');
  pm.audit('task', task.id, 'create', null, task, req.actor.name);
  res.json({ ok: true, task: pm.rowToTask(task), warnings });
});

router.put('/tasks/:id', requireAdmin, (req, res) => {
  const before = findTask(Number(req.params.id));
  if (!before || !before.active) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const merged = { ...pm.rowToTask(before), ...req.body };
  const t = taskParams(merged);
  const { errors, warnings } = pm.validateTask(t, { planId: before.plan_id, selfId: before.id });
  if (errors.length) return res.status(400).json({ error: errorText(errors), errors, warnings });
  getDb().run(
    `UPDATE pm_tasks SET parent_id = ?, wbs = ?, title = ?, kind = ?, sort_order = ?, recurrence = ?, qty = ?, unit = ?, owner = ?, note = ?,
       updated_at = ?, updated_by = ? WHERE id = ?`,
    [t.parent_id, t.wbs, t.title, t.kind, Number(merged.sort_order), t.recurrence ? JSON.stringify(t.recurrence) : null,
      t.qty, t.unit, t.owner, t.note, nowTH(), req.actor.name, before.id]);
  const task = findTask(before.id);
  pm.audit('task', task.id, 'update', before, task, req.actor.name);
  res.json({ ok: true, task: pm.rowToTask(task), warnings });
});

// soft delete — the row and its children leave the plan; occurrences stay for history
router.delete('/tasks/:id', requireAdmin, (req, res) => {
  const before = findTask(Number(req.params.id));
  if (!before || !before.active) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const db = getDb();
  const ids = [before.id];
  for (let i = 0; i < ids.length; i++) {
    for (const c of db.all('SELECT id FROM pm_tasks WHERE parent_id = ? AND active = 1', [ids[i]])) ids.push(c.id);
  }
  const now = nowTH();
  for (const id of ids) db.run('UPDATE pm_tasks SET active = 0, updated_at = ?, updated_by = ? WHERE id = ?', [now, req.actor.name, id]);
  pm.audit('task', before.id, 'delete', before, { removed: ids }, req.actor.name);
  res.json({ ok: true, removed: ids });
});

// move up/down among siblings: { direction: 'up'|'down' } — swaps sort_order with the neighbour
router.post('/tasks/:id/move', requireAdmin, (req, res) => {
  const t = findTask(Number(req.params.id));
  if (!t || !t.active) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const up = req.body.direction === 'up';
  const nb = getDb().get(
    `SELECT * FROM pm_tasks WHERE plan_id = ? AND parent_id IS ? AND active = 1 AND id != ?
       AND (sort_order ${up ? '<' : '>'} ? OR (sort_order = ? AND id ${up ? '<' : '>'} ?))
     ORDER BY sort_order ${up ? 'DESC' : 'ASC'}, id ${up ? 'DESC' : 'ASC'} LIMIT 1`,
    [t.plan_id, t.parent_id, t.id, t.sort_order, t.sort_order, t.id]);
  if (!nb) return res.json({ ok: true, moved: false });
  const now = nowTH();
  // distinct values even when both rows shared a sort_order
  const [a, b] = nb.sort_order === t.sort_order ? (up ? [t.sort_order - 0.5, t.sort_order] : [t.sort_order + 0.5, t.sort_order]) : [nb.sort_order, t.sort_order];
  getDb().run('UPDATE pm_tasks SET sort_order = ?, updated_at = ?, updated_by = ? WHERE id = ?', [a, now, req.actor.name, t.id]);
  getDb().run('UPDATE pm_tasks SET sort_order = ? WHERE id = ?', [b, nb.id]);
  res.json({ ok: true, moved: true });
});

// ── occurrences (admin) ─────────────────────────────────────────────────────
// Upsert the exception row for one due month of a task. Body: status / planned_month / actual_* / done_by / remark
router.put('/tasks/:id/occurrences/:due', requireAdmin, (req, res) => {
  const t = findTask(Number(req.params.id));
  if (!t || !t.active) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const due = req.params.due;
  if (!pm.YM_RE.test(due)) return res.status(400).json({ error: 'due_month ต้องเป็น YYYY-MM' });
  const db = getDb();
  const before = db.get('SELECT * FROM pm_occurrences WHERE task_id = ? AND due_month = ?', [t.id, due]);
  if (!isOccurrence(t, due)) return res.status(400).json({ error: 'เดือนนี้ไม่อยู่ในรอบความถี่ของรายการ' });
  const b = req.body;
  const { errors } = pm.validateOccurrence(b);
  if (errors.length) return res.status(400).json({ error: errorText(errors), errors });
  const pick = (k) => (b[k] !== undefined ? (b[k] === '' ? null : b[k]) : before?.[k] ?? null);
  const row = {
    planned_month: pick('planned_month') || due,
    status: pick('status') || 'planned',
    actual_start: pick('actual_start'), actual_end: pick('actual_end'),
    done_by: pick('done_by'), remark: pick('remark'),
  };
  // moving the month without an explicit status marks it postponed (unless already closed)
  if (b.status === undefined && row.planned_month !== (before?.planned_month || due) && !['done', 'cancelled'].includes(row.status)) row.status = 'postponed';
  if (row.status === 'done' && before?.status !== 'done' && !pm.liveFileCount(t.id, due)) {
    return res.status(400).json({ error: 'ต้องแนบไฟล์หลักฐานอย่างน้อย 1 ไฟล์ก่อนบันทึกว่าเสร็จแล้ว' });
  }
  if (row.status === 'done' && !row.done_by) row.done_by = req.actor.name;
  const now = nowTH();
  if (before) {
    db.run(`UPDATE pm_occurrences SET planned_month = ?, status = ?, actual_start = ?, actual_end = ?, done_by = ?, remark = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      [row.planned_month, row.status, row.actual_start, row.actual_end, row.done_by, row.remark, now, req.actor.name, before.id]);
  } else {
    db.run(`INSERT INTO pm_occurrences (task_id, due_month, planned_month, status, actual_start, actual_end, done_by, remark, created_at, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, due, row.planned_month, row.status, row.actual_start, row.actual_end, row.done_by, row.remark, now, now, req.actor.name]);
  }
  const after = db.get('SELECT * FROM pm_occurrences WHERE task_id = ? AND due_month = ?', [t.id, due]);
  pm.audit('occurrence', after.id, before ? 'update' : 'create', before, after, req.actor.name);
  res.json({ ok: true, occurrence: after });
});

// reset an occurrence back to what the rule says (drops the exception row)
router.delete('/tasks/:id/occurrences/:due', requireAdmin, (req, res) => {
  const db = getDb();
  const before = db.get('SELECT * FROM pm_occurrences WHERE task_id = ? AND due_month = ?', [Number(req.params.id), req.params.due]);
  if (!before) return res.json({ ok: true, removed: false });
  db.run('DELETE FROM pm_occurrences WHERE id = ?', [before.id]);
  pm.audit('occurrence', before.id, 'reset', before, null, req.actor.name);
  res.json({ ok: true, removed: true });
});

// ── attachments (evidence) ─────────────────────────────────────────────────────
// Files live on disk under server/data/pm_files/<task_id>/; pm_attachments holds the metadata.
// Upload/delete: admin. View: any logged-in user. A 'done' occurrence needs >= 1 live file.
const FILE_ROOT = path.join(__dirname, '..', 'data', 'pm_files');
const MAX_FILE_MB = 25;
const FILE_TYPES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
};
const INLINE = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);
const extOf = (name) => path.extname(name).slice(1).toLowerCase();

router.get('/tasks/:id/attachments', (req, res) => {
  const due = req.query.due;
  const rows = pm.YM_RE.test(due || '')
    ? getDb().all('SELECT * FROM pm_attachments WHERE task_id = ? AND due_month = ? AND deleted_at IS NULL ORDER BY id', [Number(req.params.id), due])
    : getDb().all('SELECT * FROM pm_attachments WHERE task_id = ? AND deleted_at IS NULL ORDER BY id', [Number(req.params.id)]);
  res.json({ items: rows.map(({ stored_name, ...r }) => r) });
});

// body = raw file bytes; X-File-Name = encodeURIComponent(original name); ?due=YYYY-MM
router.post('/tasks/:id/attachments', requireAdmin,
  express.raw({ type: () => true, limit: `${MAX_FILE_MB}mb` }),
  (req, res) => {
    const t = findTask(Number(req.params.id));
    if (!t || !t.active) return res.status(404).json({ error: 'ไม่พบรายการ' });
    const due = req.query.due;
    if (!pm.YM_RE.test(due || '')) return res.status(400).json({ error: 'due ต้องเป็น YYYY-MM' });
    if (!isOccurrence(t, due)) return res.status(400).json({ error: 'เดือนนี้ไม่อยู่ในรอบความถี่ของรายการ' });
    let name;
    try { name = decodeURIComponent(req.get('X-File-Name') || ''); } catch { name = ''; }
    name = path.basename(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
    const ext = extOf(name);
    if (!name || !FILE_TYPES[ext]) return res.status(400).json({ error: `รองรับเฉพาะไฟล์ ${Object.keys(FILE_TYPES).join(', ')}` });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'ไฟล์ว่าง' });
    const stored = `${crypto.randomUUID()}.${ext}`;
    const dir = path.join(FILE_ROOT, String(t.id));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, stored), req.body);
    getDb().run(
      `INSERT INTO pm_attachments (task_id, due_month, file_name, stored_name, mime, size, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, due, name, stored, FILE_TYPES[ext], req.body.length, req.actor.name, nowTH()]);
    const row = getDb().get('SELECT * FROM pm_attachments WHERE id = last_insert_rowid()');
    pm.audit('attachment', row.id, 'upload', null, row, req.actor.name);
    const { stored_name, ...item } = row;
    res.json({ ok: true, item });
  });

router.get('/attachments/:id/file', (req, res) => {
  const a = getDb().get('SELECT * FROM pm_attachments WHERE id = ? AND deleted_at IS NULL', [Number(req.params.id)]);
  if (!a) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  const file = path.join(FILE_ROOT, String(a.task_id), a.stored_name);
  if (!fs.existsSync(file)) return res.status(410).json({ error: 'ไฟล์หายจากดิสก์' });
  const ext = extOf(a.stored_name);
  res.set('Content-Type', a.mime || 'application/octet-stream');
  res.set('Content-Disposition', `${INLINE.has(ext) ? 'inline' : 'attachment'}; filename="file.${ext}"; filename*=UTF-8''${encodeURIComponent(a.file_name)}`);
  res.sendFile(file);
});

// soft delete (file stays on disk for history); the last file of a 'done' occurrence can't go
router.delete('/attachments/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const a = db.get('SELECT * FROM pm_attachments WHERE id = ? AND deleted_at IS NULL', [Number(req.params.id)]);
  if (!a) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  const occ = db.get('SELECT status FROM pm_occurrences WHERE task_id = ? AND due_month = ?', [a.task_id, a.due_month]);
  if (occ?.status === 'done' && pm.liveFileCount(a.task_id, a.due_month) <= 1) {
    return res.status(400).json({ error: 'งานนี้บันทึกว่าเสร็จแล้ว ต้องเหลือไฟล์หลักฐานอย่างน้อย 1 ไฟล์' });
  }
  db.run('UPDATE pm_attachments SET deleted_at = ?, deleted_by = ? WHERE id = ?', [nowTH(), req.actor.name, a.id]);
  pm.audit('attachment', a.id, 'delete', a, null, req.actor.name);
  res.json({ ok: true });
});

module.exports = router;
