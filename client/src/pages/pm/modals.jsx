import React, { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, del, upload, BASE } from '../../api.js';
import { Modal, ErrorLine, btn, inputCls } from '../chemlab/shared.jsx';
import { STATUS, EDITABLE_STATUSES, FREQ_PRESETS, expand, addMonths, thMonthYear, fyOf, recText } from './util.js';

const label = 'block text-xs font-semibold text-earth-ink2 mb-1';

// ── Task (หมวด / รายการ / รายการย่อย) ─────────────────────────────────────────
export function TaskModal({ task, parent, tasks, today, onSave, onClose, pending, error }) {
  const isNew = !task?.id;
  const [f, setF] = useState(() => ({
    kind: task?.kind || (parent ? 'task' : 'group'),
    wbs: task?.wbs || '', title: task?.title || '',
    parent_id: task?.parent_id ?? parent?.id ?? '',
    qty: task?.qty ?? '', unit: task?.unit || '', owner: task?.owner || '', note: task?.note || '',
    every: task?.recurrence?.every ?? parent?.recurrence?.every ?? 12,
    anchor: task?.recurrence?.anchor || parent?.recurrence?.anchor || today,
    until: task?.recurrence?.until || '',
  }));
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const custom = !FREQ_PRESETS.some(p => p.every === Number(f.every));

  // parent choices: everything except this row and its descendants
  const parentOptions = useMemo(() => {
    if (!task?.id) return tasks;
    const out = [];
    let skipBelow = null;
    for (const t of tasks) {
      if (skipBelow != null && t.depth > skipBelow) continue;
      skipBelow = null;
      if (t.id === task.id) { skipBelow = t.depth; continue; }
      out.push(t);
    }
    return out;
  }, [tasks, task]);

  const rec = f.kind === 'task' ? { every: Number(f.every) || 0, anchor: f.anchor, until: f.until || null } : null;
  const preview = rec ? expand(rec, rec.anchor, addMonths(rec.anchor, 12 * 10)).slice(0, 8) : [];

  const submit = (e) => {
    e.preventDefault();
    onSave({
      kind: f.kind, wbs: f.wbs, title: f.title, parent_id: f.parent_id === '' ? null : Number(f.parent_id),
      qty: f.qty, unit: f.unit, owner: f.owner, note: f.note,
      recurrence: rec && { v: 1, unit: 'month', every: rec.every, anchor: rec.anchor, until: rec.until },
    });
  };

  return (
    <Modal title={isNew ? (parent ? `เพิ่มรายการใต้ "${parent.wbs || parent.title.slice(0, 20)}"` : 'เพิ่มหมวด/รายการ') : 'แก้ไขรายการ'} onClose={onClose} wide>
      <form onSubmit={submit} className="p-5 space-y-4">
        <div className="flex gap-2">
          {[['group', 'หมวด (ไม่มีความถี่)'], ['task', 'รายการ (มีความถี่)']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => set('kind')(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${f.kind === k ? 'bg-teal-700 text-white' : 'bg-earth-card text-earth-ink2'}`}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] gap-3">
          <div><label className={label}>ลำดับ (WBS)</label><input className={inputCls} value={f.wbs} onChange={set('wbs')} placeholder="1.1" /></div>
          <div><label className={label}>รายละเอียด *</label><input className={inputCls} value={f.title} onChange={set('title')} required /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3">
            <label className={label}>อยู่ใต้</label>
            <select className={inputCls} value={f.parent_id} onChange={set('parent_id')}>
              <option value="">— ระดับบนสุด —</option>
              {parentOptions.map(t => (
                <option key={t.id} value={t.id}>{'  '.repeat(t.depth)}{t.wbs ? `${t.wbs} ` : '- '}{t.title.slice(0, 70)}</option>
              ))}
            </select>
          </div>
          <div><label className={label}>จำนวน</label><input className={inputCls} type="number" min="0" value={f.qty} onChange={set('qty')} /></div>
          <div><label className={label}>หน่วย</label><input className={inputCls} value={f.unit} onChange={set('unit')} placeholder="รายการ" /></div>
          <div><label className={label}>ผู้รับผิดชอบ</label><input className={inputCls} value={f.owner} onChange={set('owner')} /></div>
        </div>

        {f.kind === 'task' && (
          <fieldset className="rounded-xl border border-earth-border p-4 space-y-3 bg-white/40">
            <legend className="px-1 text-sm font-bold text-earth-ink">ความถี่</legend>
            <div className="flex flex-wrap gap-2">
              {FREQ_PRESETS.map(p => (
                <button key={p.every} type="button" onClick={() => set('every')(p.every)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${Number(f.every) === p.every ? 'bg-sky-600 text-white' : 'bg-earth-card text-earth-ink2'}`}>{p.label}</button>
              ))}
              <label className={`flex items-center gap-1 px-2 rounded-lg text-sm ${custom ? 'bg-sky-100' : ''}`}>
                ทุก <input type="number" min="1" max="600" className="w-16 border border-earth-border rounded px-1 py-1 bg-white/70"
                  value={custom ? f.every : ''} placeholder="N" onChange={e => set('every')(Number(e.target.value) || 1)} /> เดือน
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={label}>{Number(f.every) ? 'เดือนที่ทำครั้งแรก (anchor)' : 'เดือนที่ทำ'}</label>
                <input type="month" className={inputCls} value={f.anchor} onChange={set('anchor')} required /></div>
              {Number(f.every) > 0 && (
                <div><label className={label}>สิ้นสุด (ไม่บังคับ)</label>
                  <input type="month" className={inputCls} value={f.until} onChange={set('until')} /></div>
              )}
            </div>
            <div className="text-xs text-earth-ink2">
              <span className="font-semibold">{recText(rec)}</span> → {preview.map(ym => (
                <span key={ym} className="inline-block mr-1 mb-1 px-1.5 rounded bg-sky-100 text-sky-900">{thMonthYear(ym)} <span className="text-sky-600">(ปีงบ {String(fyOf(ym)).slice(2)})</span></span>
              ))}
            </div>
            {!isNew && <p className="text-xs text-earth-ink3">เปลี่ยนความถี่แล้ว ช่องในแผนทุกปีคำนวณใหม่อัตโนมัติ — ผลการทำงานที่บันทึกไว้แล้วยังคงอยู่</p>}
          </fieldset>
        )}

        <div><label className={label}>หมายเหตุ</label><textarea className={inputCls} rows={2} value={f.note} onChange={set('note')} /></div>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>ยกเลิก</button>
          <button type="submit" className={btn.primary} disabled={pending}>{pending ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Occurrence (หนึ่งช่องในแผน) ───────────────────────────────────────────────
export function OccurrenceModal({ task, occ, canEdit, onSave, onReset, onClose, pending, error }) {
  const [f, setF] = useState({
    status: occ.status || 'planned', planned_month: occ.planned_month || occ.due_month,
    actual_start: occ.actual_start || '', actual_end: occ.actual_end || '', done_by: occ.done_by || '', remark: occ.remark || '',
  });
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const moved = f.planned_month !== occ.due_month;
  const derived = STATUS[occ.derived] || STATUS.planned;
  const filesQ = useQuery({
    queryKey: ['pm', 'files', task.id, occ.due_month],
    queryFn: () => get(`/api/pm/tasks/${task.id}/attachments?due=${occ.due_month}`),
  });
  const fileCount = filesQ.data?.items?.length ?? occ.files ?? 0;
  // "done" needs evidence — the server enforces it too
  const doneBlocked = !fileCount && occ.status !== 'done';

  return (
    <Modal title={`${occ.label || ''} · ${thMonthYear(occ.due_month)}`} onClose={onClose}>
      <form onSubmit={(e) => {
        e.preventDefault();
        // moving the month while still "รอทำ" means it was postponed
        const wasAt = occ.planned_month || occ.due_month;
        onSave(f.planned_month !== wasAt && f.status === 'planned' ? { ...f, status: 'postponed' } : f);
      }} className="p-5 space-y-4">
        <div className="text-sm text-earth-ink">
          <div className="font-semibold">{task.wbs ? `${task.wbs} ` : ''}{task.title}</div>
          <div className="text-earth-ink2 text-xs mt-0.5">{recText(task.recurrence)}</div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            สถานะปัจจุบัน <span className={`px-2 rounded ${derived.chip}`}>{derived.label}</span>
            {occ.updated_by && <span className="text-earth-ink3">แก้ล่าสุดโดย {occ.updated_by}</span>}
          </div>
        </div>
        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {EDITABLE_STATUSES.map(s => (
              <button key={s} type="button" onClick={() => set('status')(s)} disabled={s === 'done' && doneBlocked}
                title={s === 'done' && doneBlocked ? 'แนบไฟล์หลักฐานก่อน' : undefined}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${f.status === s ? STATUS[s].chip : 'bg-earth-card text-earth-ink2'} disabled:opacity-40 disabled:cursor-not-allowed`}>{STATUS[s].label}</button>
            ))}
          </div>
          {canEdit && doneBlocked && <p className="text-xs text-amber-700 -mt-2">ต้องแนบไฟล์หลักฐานอย่างน้อย 1 ไฟล์ก่อนจึงจะบันทึกว่า "เสร็จแล้ว" ได้</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>เดือนตามแผน {moved && <span className="text-violet-700">(เลื่อนจาก {thMonthYear(occ.due_month)})</span>}</label>
              <input type="month" className={inputCls} value={f.planned_month} onChange={set('planned_month')} />
            </div>
            <div><label className={label}>ผู้ดำเนินการ</label><input className={inputCls} value={f.done_by} onChange={set('done_by')} /></div>
            <div><label className={label}>วันที่เริ่มจริง</label><input type="date" className={inputCls} value={f.actual_start} onChange={set('actual_start')} /></div>
            <div><label className={label}>วันที่เสร็จจริง</label><input type="date" className={inputCls} value={f.actual_end} onChange={set('actual_end')} /></div>
          </div>
          <div><label className={label}>หมายเหตุ / ผลการตรวจ</label><textarea className={inputCls} rows={3} value={f.remark} onChange={set('remark')} /></div>
        </fieldset>
        <Attachments taskId={task.id} due={occ.due_month} query={filesQ} canEdit={canEdit} />
        <ErrorLine error={error} />
        <div className="flex justify-between gap-2">
          {canEdit && occ.updated_at
            ? <button type="button" className={btn.ghost} onClick={onReset} disabled={pending} title="ล้างสถานะ/ผลจริง กลับไปตามรอบความถี่">คืนค่าตามแผน</button>
            : <span />}
          <div className="flex gap-2">
            <button type="button" className={btn.ghost} onClick={onClose}>ปิด</button>
            {canEdit && <button type="submit" className={btn.primary} disabled={pending}>{pending ? 'กำลังบันทึก…' : 'บันทึก'}</button>}
          </div>
        </div>
        {!canEdit && <p className="text-xs text-earth-ink3">เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่แก้ไขได้</p>}
      </form>
    </Modal>
  );
}

// ── Evidence files of one occurrence ────────────────────────────────────────
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc';
const MAX_MB = 25;

function Attachments({ taskId, due, query, canEdit }) {
  const qc = useQueryClient();
  const input = useRef(null);
  const [pickErr, setPickErr] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['pm'] });
  const up = useMutation({
    mutationFn: async (files) => { for (const f of files) await upload(`/api/pm/tasks/${taskId}/attachments?due=${due}`, f); },
    onSettled: refresh,
  });
  const rm = useMutation({ mutationFn: (id) => del(`/api/pm/attachments/${id}`), onSuccess: refresh });
  const items = query.data?.items || [];

  const pick = (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const big = files.find(f => f.size > MAX_MB * 1048576);
    setPickErr(big ? new Error(`${big.name} ใหญ่เกิน ${MAX_MB} MB`) : null);
    if (!big && files.length) up.mutate(files);
  };

  return (
    <div className="rounded-xl border border-earth-border bg-white/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-earth-ink">📎 ไฟล์หลักฐาน ({items.length})</span>
        {canEdit && (
          <>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={pick} />
            <button type="button" className={btn.ghost} onClick={() => input.current?.click()} disabled={up.isPending}>
              {up.isPending ? 'กำลังอัปโหลด…' : '＋ แนบไฟล์'}
            </button>
          </>
        )}
      </div>
      {query.isLoading ? <p className="text-xs text-earth-ink3">กำลังโหลด…</p>
        : items.length === 0 ? <p className="text-xs text-earth-ink3">ยังไม่มีไฟล์ (PDF, รูป, Excel, Word ไม่เกิน {MAX_MB} MB)</p>
        : (
          <ul className="divide-y divide-earth-border">
            {items.map(a => (
              <li key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
                <a href={`${BASE}/api/pm/attachments/${a.id}/file`} target="_blank" rel="noreferrer"
                  className="flex-1 min-w-0 truncate text-teal-800 hover:underline" title={a.file_name}>{a.file_name}</a>
                <span className="text-xs text-earth-ink3 whitespace-nowrap hidden sm:inline">{fmtSize(a.size)} · {a.uploaded_by} · {a.uploaded_at?.slice(0, 10)}</span>
                {canEdit && (
                  <button type="button" onClick={() => rm.mutate(a.id)} disabled={rm.isPending}
                    className="w-6 h-6 rounded text-xs hover:bg-red-100 text-earth-ink2" title="ลบไฟล์" aria-label="ลบไฟล์">🗑</button>
                )}
              </li>
            ))}
          </ul>
        )}
      <ErrorLine error={pickErr || up.error || rm.error || query.error} />
    </div>
  );
}

// ── Plan ─────────────────────────────────────────────────────────────────────
export function PlanModal({ plan, onSave, onClose, pending, error }) {
  const [f, setF] = useState({
    title: plan?.title || '', code: plan?.code || '', org_unit: plan?.org_unit || '', forecast_years: plan?.forecast_years ?? 4,
  });
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));
  return (
    <Modal title={plan ? 'แก้ไขแผน' : 'สร้างแผนใหม่'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, forecast_years: Number(f.forecast_years) }); }} className="p-5 space-y-3">
        <div><label className={label}>ชื่อแผน *</label><input className={inputCls} value={f.title} onChange={set('title')} required /></div>
        <div><label className={label}>หน่วยงาน</label><input className={inputCls} value={f.org_unit} onChange={set('org_unit')} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>รหัสแผน</label><input className={inputCls} value={f.code} onChange={set('code')} /></div>
          <div><label className={label}>คาดการณ์ล่วงหน้า (ปี)</label><input type="number" min="0" max="10" className={inputCls} value={f.forecast_years} onChange={set('forecast_years')} /></div>
        </div>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>ยกเลิก</button>
          <button type="submit" className={btn.primary} disabled={pending}>บันทึก</button>
        </div>
      </form>
    </Modal>
  );
}
