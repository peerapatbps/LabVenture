// Project management (หน้าแผนงาน) — recurrence expansion, Gantt assembly, validation.
// Months are 'YYYY-MM' (ค.ศ.) everywhere on the server; fiscal years are พ.ศ. (FY 2570 = 2026-10..2027-09).
// A task's recurrence is a versioned rule — add new shapes as new cases in expand():
//   { v:1, every:<months, 0 = once>, unit:'month', anchor:'YYYY-MM', until:'YYYY-MM'|null, label?:'3Y' }
const { getDb, nowTH } = require('./db');

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const STATUSES = ['planned', 'in_progress', 'done', 'postponed', 'cancelled'];
const CLOSED = new Set(['done', 'cancelled']);

const ymToIdx = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const idxToYm = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const todayYM = () => nowTH().slice(0, 7);

// พ.ศ. fiscal year → first/last month. startMonth 10 → FY 2570 runs 2026-10..2027-09
function fyRange(fyBE, startMonth = 10) {
  const endYearCE = fyBE - 543;
  const startYearCE = startMonth === 1 ? endYearCE : endYearCE - 1;
  const from = startYearCE * 12 + startMonth - 1;
  return { from: idxToYm(from), to: idxToYm(from + 11) };
}

function fyOf(ym, startMonth = 10) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  const endYearCE = startMonth === 1 || m < startMonth ? y : y + 1;
  return endYearCE + 543;
}

function monthsBetween(fromYM, toYM) {
  const out = [];
  for (let i = ymToIdx(fromYM); i <= ymToIdx(toYM); i++) out.push(idxToYm(i));
  return out;
}

function recLabel(rec) {
  if (!rec) return '';
  if (rec.label) return rec.label;
  if (!rec.every) return '1x';
  return rec.every % 12 === 0 ? `${rec.every / 12}Y` : `${rec.every}M`;
}

// Due months of a rule within [fromYM, toYM]
function expand(rec, fromYM, toYM) {
  if (!rec || !rec.anchor || !YM_RE.test(rec.anchor)) return [];
  const a = ymToIdx(rec.anchor);
  let lo = ymToIdx(fromYM), hi = ymToIdx(toYM);
  if (rec.until && YM_RE.test(rec.until)) hi = Math.min(hi, ymToIdx(rec.until));
  if (!rec.every) return a >= lo && a <= hi ? [rec.anchor] : [];
  const out = [];
  for (let i = a + Math.max(0, Math.ceil((lo - a) / rec.every)) * rec.every; i <= hi; i += rec.every) out.push(idxToYm(i));
  return out;
}

function parseRec(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function derivedStatus(status, plannedMonth, today = todayYM()) {
  if (CLOSED.has(status)) return status;
  if (plannedMonth < today) return 'overdue';
  return status;
}

// Merge the rule's due months with stored exception rows. A stored row whose due month the rule no
// longer produces (frequency changed later) is kept only if it carries history (not plain 'planned').
function occurrencesFor(task, rows, fromYM, toYM, today, fileCounts = new Map()) {
  const rec = parseRec(task.recurrence);
  const label = recLabel(rec);
  const byDue = new Map(rows.map(r => [r.due_month, r]));
  // look back so an occurrence moved INTO the window from an earlier due month still shows
  const dues = new Set(expand(rec, idxToYm(ymToIdx(fromYM) - 60), toYM));
  for (const r of rows) if (!dues.has(r.due_month) && r.status !== 'planned') dues.add(r.due_month);
  const out = [];
  for (const due of dues) {
    const r = byDue.get(due);
    const planned = r?.planned_month || due;
    const status = r?.status || 'planned';
    out.push({
      due_month: due, planned_month: planned, label, status,
      derived: derivedStatus(status, planned, today),
      moved: planned !== due,
      orphan: !!r && !expand(rec, due, due).length,
      actual_start: r?.actual_start || null, actual_end: r?.actual_end || null,
      done_by: r?.done_by || null, remark: r?.remark || null,
      updated_by: r?.updated_by || null, updated_at: r?.updated_at || null,
      files: fileCounts.get(`${task.id}|${due}`) || 0,
    });
  }
  return out.sort((x, y) => x.planned_month.localeCompare(y.planned_month));
}

function rowToTask(r) {
  return { ...r, recurrence: parseRec(r.recurrence), active: !!r.active };
}

// Active tasks of a plan in display order, with depth (DFS over parent_id)
function taskTree(planId) {
  const rows = getDb().all('SELECT * FROM pm_tasks WHERE plan_id = ? AND active = 1 ORDER BY sort_order, id', [planId]);
  const kids = new Map();
  for (const r of rows) {
    const k = r.parent_id ?? 0;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(r);
  }
  const out = [];
  const seen = new Set();
  const walk = (pid, depth) => {
    for (const r of kids.get(pid) || []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ row: r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(0, 0);
  // unreachable rows (parent deleted, or a parent loop) surface at the root rather than vanish
  for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push({ row: r, depth: 0 }); walk(r.id, 1); }
  return out;
}

function gantt(planId, fyBE) {
  const db = getDb();
  const plan = db.get('SELECT * FROM pm_plans WHERE id = ?', [planId]);
  if (!plan) return null;
  const sm = plan.fy_start_month;
  const fy = fyRange(fyBE, sm);
  const forecastYears = Array.from({ length: plan.forecast_years }, (_, i) => fyBE + 1 + i);
  const end = forecastYears.length ? fyRange(forecastYears.at(-1), sm).to : fy.to;
  const months = monthsBetween(fy.from, fy.to);
  const today = todayYM();

  const tree = taskTree(planId);
  const occRows = db.all(
    `SELECT o.* FROM pm_occurrences o JOIN pm_tasks t ON t.id = o.task_id WHERE t.plan_id = ?`, [planId]);
  const occByTask = new Map();
  for (const o of occRows) {
    if (!occByTask.has(o.task_id)) occByTask.set(o.task_id, []);
    occByTask.get(o.task_id).push(o);
  }

  const fileCounts = attachmentCounts(planId);
  const kpi = { total: 0, done: 0, in_progress: 0, overdue: 0, pending: 0, cancelled: 0 };
  const rows = tree.map(({ row, depth }) => {
    const task = rowToTask(row);
    const cells = {}, forecast = {};
    if (task.recurrence) {
      for (const o of occurrencesFor(row, occByTask.get(row.id) || [], fy.from, end, today, fileCounts)) {
        if (o.planned_month >= fy.from && o.planned_month <= fy.to) {
          (cells[o.planned_month] ||= []).push(o);
          if (o.derived === 'cancelled') kpi.cancelled++;
          else {
            kpi.total++;
            if (o.derived === 'done') kpi.done++;
            else if (o.derived === 'overdue') kpi.overdue++;
            else if (o.derived === 'in_progress') kpi.in_progress++;
            else kpi.pending++;
          }
        } else if (o.planned_month > fy.to && o.planned_month <= end) {
          (forecast[fyOf(o.planned_month, sm)] ||= []).push(o);
        }
        // ghost at the original month so a move stays visible where it was planned
        if (o.moved && o.due_month >= fy.from && o.due_month <= fy.to) {
          (cells[o.due_month] ||= []).push({ ghost: true, due_month: o.due_month, planned_month: o.planned_month, label: o.label });
        }
      }
    }
    return { task, depth, cells, forecast };
  });

  return { plan, fy: fyBE, today, months, forecastYears, rows, kpi };
}

// live evidence-file count per occurrence, keyed 'task_id|due_month'
function attachmentCounts(planId) {
  const rows = getDb().all(
    `SELECT a.task_id, a.due_month, COUNT(*) AS n FROM pm_attachments a JOIN pm_tasks t ON t.id = a.task_id
     WHERE t.plan_id = ? AND a.deleted_at IS NULL AND a.due_month IS NOT NULL GROUP BY a.task_id, a.due_month`, [planId]);
  return new Map(rows.map(r => [`${r.task_id}|${r.due_month}`, r.n]));
}

const liveFileCount = (taskId, due) =>
  getDb().get('SELECT COUNT(*) AS n FROM pm_attachments WHERE task_id = ? AND due_month = ? AND deleted_at IS NULL', [taskId, due]).n;

// Open occurrences due this month or earlier (overdue) across all live plans — sidebar badge
function pendingSummary(ym = todayYM()) {
  const db = getDb();
  const plans = db.all('SELECT id, fy_start_month FROM pm_plans WHERE archived = 0');
  let pending = 0, overdue = 0;
  for (const p of plans) {
    // lookback: start of the previous fiscal year — older misses are history, not a live backlog
    const from = fyRange(fyOf(ym, p.fy_start_month) - 1, p.fy_start_month).from;
    const occRows = db.all(`SELECT o.* FROM pm_occurrences o JOIN pm_tasks t ON t.id = o.task_id WHERE t.plan_id = ?`, [p.id]);
    for (const { row } of taskTree(p.id)) {
      if (!row.recurrence) continue;
      for (const o of occurrencesFor(row, occRows.filter(r => r.task_id === row.id), from, ym, ym)) {
        if (o.planned_month < from || o.planned_month > ym || CLOSED.has(o.status)) continue;
        pending++;
        if (o.derived === 'overdue') overdue++;
      }
    }
  }
  return { ym, pending, overdue };
}

// ── validation ({errors, warnings} like services/eventClass.js) ──────────────
function validateRecurrence(rec, errors) {
  if (rec == null) return;
  if (typeof rec !== 'object') return errors.push({ field: 'recurrence', msg: 'ต้องเป็น object' });
  if ((rec.unit || 'month') !== 'month') errors.push({ field: 'recurrence.unit', msg: 'รองรับเฉพาะ month' });
  if (!Number.isInteger(rec.every) || rec.every < 0 || rec.every > 600) errors.push({ field: 'recurrence.every', msg: 'ต้องเป็นจำนวนเต็ม 0–600 เดือน (0 = ครั้งเดียว)' });
  if (!YM_RE.test(rec.anchor || '')) errors.push({ field: 'recurrence.anchor', msg: 'เดือนเริ่มต้องเป็น YYYY-MM' });
  if (rec.until != null && !YM_RE.test(rec.until)) errors.push({ field: 'recurrence.until', msg: 'เดือนสิ้นสุดต้องเป็น YYYY-MM' });
}

function validateTask(t, { planId, selfId } = {}) {
  const errors = [], warnings = [];
  if (!String(t.title || '').trim()) errors.push({ field: 'title', msg: 'ต้องระบุรายละเอียด' });
  if (!['group', 'task'].includes(t.kind || 'task')) errors.push({ field: 'kind', msg: 'ต้องเป็น group หรือ task' });
  if ((t.kind || 'task') === 'group' && t.recurrence) warnings.push({ field: 'recurrence', msg: 'หมวดไม่ใช้ความถี่ — จะถูกล้าง' });
  if ((t.kind || 'task') === 'task') validateRecurrence(t.recurrence, errors);
  if (t.qty != null && t.qty !== '' && !Number.isInteger(Number(t.qty))) errors.push({ field: 'qty', msg: 'จำนวนต้องเป็นจำนวนเต็ม' });
  if (t.parent_id != null) {
    const p = getDb().get('SELECT id, plan_id, parent_id, active FROM pm_tasks WHERE id = ?', [t.parent_id]);
    if (!p || !p.active || (planId && p.plan_id !== planId)) errors.push({ field: 'parent_id', msg: 'ไม่พบรายการแม่ในแผนนี้' });
    else if (selfId) {
      // no cycles: walk up from the new parent
      for (let cur = p; cur; cur = cur.parent_id ? getDb().get('SELECT id, parent_id FROM pm_tasks WHERE id = ?', [cur.parent_id]) : null) {
        if (cur.id === selfId) { errors.push({ field: 'parent_id', msg: 'ย้ายไปใต้ตัวเองไม่ได้' }); break; }
      }
    }
  }
  return { errors, warnings };
}

function validateOccurrence(o) {
  const errors = [];
  if (o.status != null && !STATUSES.includes(o.status)) errors.push({ field: 'status', msg: `ต้องเป็น ${STATUSES.join('/')}` });
  if (o.planned_month != null && !YM_RE.test(o.planned_month)) errors.push({ field: 'planned_month', msg: 'ต้องเป็น YYYY-MM' });
  for (const f of ['actual_start', 'actual_end']) {
    if (o[f] && !/^\d{4}-\d{2}-\d{2}$/.test(o[f])) errors.push({ field: f, msg: 'ต้องเป็น YYYY-MM-DD' });
  }
  return { errors, warnings: [] };
}

function audit(entity, entityId, action, before, after, actor) {
  getDb().run('INSERT INTO pm_audit (entity, entity_id, action, before_json, after_json, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [entity, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, actor, nowTH()]);
}

module.exports = {
  YM_RE, STATUSES, fyRange, fyOf, monthsBetween, expand, recLabel, derivedStatus, occurrencesFor,
  rowToTask, taskTree, gantt, liveFileCount, pendingSummary, validateTask, validateOccurrence, audit, todayYM,
};
