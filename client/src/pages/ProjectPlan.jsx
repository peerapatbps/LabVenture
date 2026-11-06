import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, put, del } from '../api.js';
import { Modal, ErrorLine, Empty, btn, inputCls } from './chemlab/shared.jsx';
import GanttGrid from './pm/GanttGrid.jsx';
import { TaskModal, OccurrenceModal, PlanModal } from './pm/modals.jsx';
import { STATUS, fyOf } from './pm/util.js';

// /pm — หน้าแผนงาน: Gantt ปีงบ (ต.ค.–ก.ย.) + คาดการณ์หลายปี. Tasks carry a recurrence rule; the server
// expands it into cells (server/services/pm.js). Admin edits rows/frequency and records actual status per cell.

const ctlCls = inputCls.replace('w-full ', '');

function Kpi({ label, value, cls }) {
  return (
    <div className="rounded-xl border border-earth-border bg-earth px-4 py-2 min-w-[96px]">
      <div className="text-xs text-earth-ink2">{label}</div>
      <div className={`text-xl font-bold ${cls || 'text-earth-ink'}`}>{value}</div>
    </div>
  );
}

export default function ProjectPlan() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me'), retry: false });
  const isAdmin = !!me?.is_admin;

  const { data: plansData, isLoading: plansLoading } = useQuery({ queryKey: ['pm', 'plans'], queryFn: () => get('/api/pm/plans') });
  const plans = plansData?.items || [];
  const planId = Number(params.get('plan')) || plans[0]?.id || null;
  const plan = plans.find(p => p.id === planId);
  const fy = Number(params.get('fy')) || null;
  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); n.set(k, v); return n; }, { replace: true });

  const { data, isLoading, error } = useQuery({
    queryKey: ['pm', 'gantt', planId, fy],
    queryFn: () => get(`/api/pm/plans/${planId}/gantt${fy ? `?fy=${fy}` : ''}`),
    enabled: !!planId,
  });
  const curFy = data?.fy || fy;

  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [showAllForecast, setShowAllForecast] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [modal, setModal] = useState(null); // {type:'task'|'occ'|'plan'|'delete', ...}
  useEffect(() => { if (!isAdmin) setEditing(false); }, [isAdmin]);

  const done = () => { qc.invalidateQueries({ queryKey: ['pm'] }); setModal(null); };
  const saveTask = useMutation({
    mutationFn: ({ id, body }) => (id ? put(`/api/pm/tasks/${id}`, body) : post(`/api/pm/plans/${planId}/tasks`, body)),
    onSuccess: done,
  });
  const saveOcc = useMutation({
    mutationFn: ({ taskId, due, body }) => put(`/api/pm/tasks/${taskId}/occurrences/${due}`, body),
    onSuccess: done,
  });
  const resetOcc = useMutation({
    mutationFn: ({ taskId, due }) => del(`/api/pm/tasks/${taskId}/occurrences/${due}`),
    onSuccess: done,
  });
  const delTask = useMutation({ mutationFn: (id) => del(`/api/pm/tasks/${id}`), onSuccess: done });
  const moveTask = useMutation({
    mutationFn: ({ id, direction }) => post(`/api/pm/tasks/${id}/move`, { direction }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pm', 'gantt'] }),
  });
  const savePlan = useMutation({
    mutationFn: ({ id, body }) => (id ? put(`/api/pm/plans/${id}`, body) : post('/api/pm/plans', body)),
    onSuccess: (r) => { done(); if (r?.plan?.id) setParam('plan', r.plan.id); },
  });

  const toggle = (id) => setCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const flatTasks = (data?.rows || []).map(r => ({ ...r.task, depth: r.depth }));
  const kpi = data?.kpi;
  const pct = kpi?.total ? Math.round((kpi.done / kpi.total) * 100) : 0;
  const thisFy = data ? fyOf(data.today, plan?.fy_start_month || 10) : null;
  const openTask = (task, parent) => { saveTask.reset(); setModal({ type: 'task', task, parent }); };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* header + toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-earth-ink truncate">{plan?.title || 'แผนงาน'}</h1>
          {plan?.org_unit && <p className="text-sm text-earth-ink2 truncate">{plan.org_unit}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plans.length > 1 && (
            <select className={ctlCls} value={planId || ''} onChange={e => setParam('plan', e.target.value)}>
              {plans.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          )}
          {planId && (
            <div className="flex items-center rounded-lg border border-earth-border bg-earth overflow-hidden">
              <button className="px-3 py-2 hover:bg-earth-card" onClick={() => setParam('fy', curFy - 1)} aria-label="ปีงบก่อนหน้า">◀</button>
              <span className="px-2 text-sm font-semibold text-earth-ink whitespace-nowrap">ปีงบ {curFy || '…'}</span>
              <button className="px-3 py-2 hover:bg-earth-card" onClick={() => setParam('fy', curFy + 1)} aria-label="ปีงบถัดไป">▶</button>
            </div>
          )}
          {thisFy && curFy !== thisFy && <button className={btn.ghost} onClick={() => setParam('fy', thisFy)}>ปีงบปัจจุบัน</button>}
          <input className={`${ctlCls} w-40`} placeholder="ค้นหารายการ…" value={search} onChange={e => setSearch(e.target.value)} />
          {isAdmin && planId && (
            <button className={editing ? btn.primary : btn.ghost} onClick={() => setEditing(v => !v)}>{editing ? '✓ เสร็จการแก้ไข' : '✎ แก้ไขแผน'}</button>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-300 bg-teal-50 px-4 py-2 text-sm">
          <span className="text-teal-900 font-semibold">โหมดแก้ไข</span>
          <button className={btn.primary} onClick={() => openTask(null, null)}>＋ เพิ่มหมวด/รายการ</button>
          <button className={btn.ghost} onClick={() => { savePlan.reset(); setModal({ type: 'plan', plan }); }}>ตั้งค่าแผน</button>
          <button className={btn.ghost} onClick={() => { savePlan.reset(); setModal({ type: 'plan', plan: null }); }}>สร้างแผนใหม่</button>
          <span className="text-teal-800 text-xs">ใช้ ↑ ↓ ✎ ＋ 🗑 ท้ายแต่ละแถว · คลิกช่องสีเพื่อบันทึกผล/เลื่อนเดือน</span>
        </div>
      )}

      {kpi && (
        <div className="flex flex-wrap gap-2">
          <Kpi label={`งานทั้งปีงบ ${curFy}`} value={kpi.total} />
          <Kpi label="เสร็จแล้ว" value={kpi.done} cls="text-emerald-700" />
          <Kpi label="กำลังทำ" value={kpi.in_progress} cls="text-amber-600" />
          <Kpi label="รอทำ" value={kpi.pending} cls="text-sky-700" />
          <Kpi label="เกินกำหนด" value={kpi.overdue} cls={kpi.overdue ? 'text-red-600' : ''} />
          <div className="rounded-xl border border-earth-border bg-earth px-4 py-2 flex-1 min-w-[160px]">
            <div className="text-xs text-earth-ink2">ความคืบหน้า {pct}%</div>
            <div className="mt-2 h-2.5 rounded-full bg-earth-card overflow-hidden">
              <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-earth-ink2">
        {['planned', 'in_progress', 'done', 'postponed', 'overdue', 'cancelled'].map(s => (
          <span key={s} className="flex items-center gap-1"><span className={`inline-block w-6 h-3.5 rounded ${STATUS[s].chip}`} />{STATUS[s].label}</span>
        ))}
        <span className="flex items-center gap-1"><span className="inline-block w-6 h-3.5 rounded border border-dashed border-sky-500" />ตำแหน่งเดิมก่อนเลื่อน</span>
        <label className="flex items-center gap-1 ml-auto cursor-pointer">
          <input type="checkbox" checked={showAllForecast} onChange={e => setShowAllForecast(e.target.checked)} /> แสดงงาน 1Y ในช่องคาดการณ์
        </label>
      </div>

      <ErrorLine error={error} />
      {plansLoading || (planId && isLoading) ? <Empty>กำลังโหลด…</Empty>
        : !planId ? (
          <div className="text-center py-16 space-y-3">
            <p className="text-earth-ink2">ยังไม่มีแผนงาน</p>
            {isAdmin && <button className={btn.primary} onClick={() => setModal({ type: 'plan', plan: null })}>สร้างแผนใหม่</button>}
          </div>
        ) : data?.rows?.length === 0 ? (
          <Empty>แผนนี้ยังไม่มีรายการ{isAdmin ? ' — กด "แก้ไขแผน" เพื่อเพิ่ม' : ''}</Empty>
        ) : data && (
          <GanttGrid data={data} editing={editing} collapsed={collapsed} onToggle={toggle} search={search} showAllForecast={showAllForecast}
            onCell={(task, occ) => { saveOcc.reset(); resetOcc.reset(); setModal({ type: 'occ', task, occ }); }}
            onEditTask={(task) => openTask(task, null)}
            onAddChild={(parent) => openTask(null, parent)}
            onMove={(task, direction) => moveTask.mutate({ id: task.id, direction })}
            onDelete={(task) => { delTask.reset(); setModal({ type: 'delete', task }); }} />
        )}

      {modal?.type === 'task' && (
        <TaskModal task={modal.task} parent={modal.parent} tasks={flatTasks} today={data?.today}
          pending={saveTask.isPending} error={saveTask.error} onClose={() => setModal(null)}
          onSave={(body) => saveTask.mutate({ id: modal.task?.id, body })} />
      )}
      {modal?.type === 'occ' && (
        <OccurrenceModal task={modal.task} occ={modal.occ} canEdit={isAdmin}
          pending={saveOcc.isPending || resetOcc.isPending} error={saveOcc.error || resetOcc.error} onClose={() => setModal(null)}
          onSave={(body) => saveOcc.mutate({ taskId: modal.task.id, due: modal.occ.due_month, body })}
          onReset={() => resetOcc.mutate({ taskId: modal.task.id, due: modal.occ.due_month })} />
      )}
      {modal?.type === 'plan' && (
        <PlanModal plan={modal.plan} pending={savePlan.isPending} error={savePlan.error} onClose={() => setModal(null)}
          onSave={(body) => savePlan.mutate({ id: modal.plan?.id, body })} />
      )}
      {modal?.type === 'delete' && (
        <ConfirmDelete task={modal.task} pending={delTask.isPending} error={delTask.error}
          onClose={() => setModal(null)} onConfirm={() => delTask.mutate(modal.task.id)} />
      )}
    </div>
  );
}

function ConfirmDelete({ task, onConfirm, onClose, pending, error }) {
  return (
    <Modal title="ลบรายการ" onClose={onClose}>
      <div className="p-5 space-y-4">
        <p className="text-sm text-earth-ink2">
          ลบ "{task.wbs ? `${task.wbs} ` : ''}{task.title}" และรายการย่อยทั้งหมดออกจากแผน? (ประวัติผลการทำงานยังเก็บไว้)
        </p>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-2">
          <button className={btn.ghost} onClick={onClose}>ยกเลิก</button>
          <button className={btn.danger} onClick={onConfirm} disabled={pending}>ลบ</button>
        </div>
      </div>
    </Modal>
  );
}
