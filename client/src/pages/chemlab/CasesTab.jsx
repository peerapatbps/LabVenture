import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, patch } from '../../api.js';
import { fmtNum, fmtTs, CASE_SCOPE } from '../../config/chemLab.js';
import { Section, ChemBadge, CaseBadge, VerdictBadge, TicketLink, ErrorLine, ReasonModal, Modal, Empty, btn, inputCls, useLabSpec } from './shared.jsx';

// 5.10 — compensation case: failing trips, target kg, task checklist, operator offsets.
// (CAR link is hidden from this flow for now — backend car-draft / car endpoints still exist.)
// A case is cancelled by undoing the composite's final result (sample stepper), not from here.
export default function CasesTab({ caseId, onSelect, canWrite, canOffset, onOpenComposite }) {
  const [status, setStatus] = useState('open');
  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'cases', status],
    queryFn: () => get(`/api/chem-lab/cases${status ? `?status=${status}` : ''}`),
  });
  const cases = data?.cases || [];

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr] items-start">
      <Section title="เคสชดเชย" subtitle="เปิดอัตโนมัติเมื่อผล final ไม่ผ่าน">
        <div className="px-4 py-3 flex gap-2 border-b border-earth-border">
          {[['open', 'เปิดอยู่'], ['closed', 'ปิดแล้ว'], ['cancelled', 'ยกเลิก'], ['', 'ทั้งหมด']].map(([v, l]) => (
            <button key={v} onClick={() => setStatus(v)}
              className={`px-3 py-1 rounded-full text-xs font-semibold ${status === v ? 'bg-teal-700 text-white' : 'bg-earth-card text-earth-ink2'}`}>{l}</button>
          ))}
        </div>
        {isLoading && <Empty>กำลังโหลด...</Empty>}
        <div className="p-4"><ErrorLine error={error} /></div>
        {!isLoading && cases.length === 0 && <Empty>ไม่มีเคส</Empty>}
        <ul className="divide-y divide-earth-border max-h-[70vh] overflow-y-auto">
          {cases.map(c => <CaseListItem key={c.id} c={c} active={c.id === caseId} onClick={() => onSelect(c.id)} />)}
        </ul>
      </Section>
      {caseId
        ? <CaseDetail id={caseId} canWrite={canWrite} canOffset={canOffset} onOpenComposite={onOpenComposite} />
        : <Section><Empty>เลือกเคสทางซ้าย</Empty></Section>}
    </div>
  );
}

export function CaseListItem({ c, active, onClick }) {
  const pct = c.target_kg > 0 ? Math.min(100, (c.offset_kg / c.target_kg) * 100) : 100;
  return (
    <li>
      <button onClick={onClick} className={`w-full text-left px-4 py-3 hover:bg-earth-card ${active ? 'bg-earth-card border-l-4 border-red-500' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-earth-ink">🚩 เคส #{c.id}</span>
          <CaseBadge status={c.status} />
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs text-earth-ink2">
          <ChemBadge chemical={c.chemical} /> <span className="truncate">{c.company_name}</span>
        </div>
        <div className="text-xs text-earth-ink3 mt-1">ตัวอย่างวันที่ {c.sample_date}{c.composite_seq ? ` · ใบที่ ${c.composite_seq}` : ''} · {c.n_tickets ?? '?'} คัน · งาน {c.tasks_done}/{c.tasks_total}</div>
        <div className="mt-2 h-1.5 rounded-full bg-earth-border overflow-hidden"><div className="h-full bg-teal-600" style={{ width: `${pct}%` }} /></div>
        <div className="text-xs text-earth-ink2 mt-1 font-mono">คงเหลือ {fmtNum(c.remaining_kg)} / {fmtNum(c.target_kg)} kg</div>
      </button>
    </li>
  );
}

export function CaseDetail({ id, canWrite, canOffset, onOpenComposite, compact }) {
  const qc = useQueryClient();
  const { data: specData } = useLabSpec();
  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'case', id],
    queryFn: () => get(`/api/chem-lab/cases/${id}`),
  });
  const [modal, setModal] = useState(null); // 'target' | {task} | {voidOffset}
  const [newTask, setNewTask] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['chem-lab'] });

  const patchCase = useMutation({
    mutationFn: (body) => patch(`/api/chem-lab/cases/${id}`, body),
    onSuccess: () => { setModal(null); invalidate(); },
  });
  const addTask = useMutation({
    mutationFn: () => post(`/api/chem-lab/cases/${id}/tasks`, { title: newTask }),
    onSuccess: () => { setNewTask(''); invalidate(); },
  });
  const doneTask = useMutation({
    mutationFn: ({ taskId, remark }) => patch(`/api/chem-lab/cases/${id}/tasks/${taskId}`, { remark }),
    onSuccess: () => { setModal(null); invalidate(); },
  });
  const voidOffset = useMutation({
    mutationFn: ({ offsetId, reason }) => post(`/api/chem-lab/cases/${id}/offsets/${offsetId}/void`, { reason }),
    onSuccess: () => { setModal(null); invalidate(); },
  });

  if (isLoading) return <Section><Empty>กำลังโหลด...</Empty></Section>;
  if (error) return <Section><div className="p-5"><ErrorLine error={error} /></div></Section>;

  const { case: c, composite, final_attempt: fa, tickets, tasks, offsets, audit } = data;
  const spec = specData?.chemicals?.[c.chemical];
  const open = c.status === 'open';
  const totalNet = tickets.reduce((s, t) => s + (t.net_kg || 0), 0);
  const pct = c.target_kg > 0 ? Math.min(100, (c.offset_kg / c.target_kg) * 100) : 100;

  return (
    <div className="space-y-4">
      <Section
        title={<span className="flex items-center gap-2 flex-wrap">🚩 เคสชดเชย #{c.id} <ChemBadge chemical={c.chemical} /> <CaseBadge status={c.status} /></span>}
        subtitle={`${c.company_name} · ตัวอย่างวันที่ ${c.sample_date}${c.composite_seq ? ` · ขวดผสมใบที่ ${c.composite_seq}` : ''} · ชดเชย${CASE_SCOPE[c.scope]?.short ? ` (${CASE_SCOPE[c.scope].short})` : ''} ${tickets.length} คัน · เปิดโดย ${c.opened_by} ${fmtTs(c.opened_at)}`}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            {!compact && composite && (
              <button className={btn.ghost} onClick={() => onOpenComposite(composite)}
                title="ยกเลิกเคสได้โดยเปลี่ยน/ย้อนผล final ของขวดผสม">🔬 ขวดผสมใบที่ {composite.seq ?? '?'}</button>
            )}
          </div>
        }
      >
        <div className="p-5 grid gap-4 md:grid-cols-3">
          <Stat label="น้ำหนักสุทธิเที่ยวที่ไม่ผ่าน" value={`${fmtNum(totalNet)} kg`} />
          <Stat label="ปริมาณชดเชย (เป้า)" value={`${fmtNum(c.target_kg)} kg`}
            sub={c.target_kg !== c.suggested_kg ? `แนะนำ ${fmtNum(c.suggested_kg)} kg · ${c.override_reason || ''}` : 'ตามค่าแนะนำ'}
            action={canWrite && open ? <button className="text-xs text-teal-700 font-semibold hover:underline" onClick={() => setModal('target')}>แก้ไข</button> : null} />
          <Stat label="ตัดยอดแล้ว / คงเหลือ" value={`${fmtNum(c.offset_kg)} / ${fmtNum(c.remaining_kg)} kg`}
            sub={<span className="block mt-1 h-1.5 rounded-full bg-earth-border overflow-hidden"><span className="block h-full bg-teal-600" style={{ width: `${pct}%` }} /></span>} />
        </div>
        {c.status === 'cancelled' && <p className="px-5 pb-4 text-sm text-earth-ink2">ยกเลิกเมื่อ {fmtTs(c.closed_at)} — {c.cancel_reason}</p>}
        {fa && spec && (
          <div className="px-5 pb-4 text-sm text-earth-ink2 flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-semibold">ผล final #{fa.attempt_no}:</span>
            {spec.params.map(p => fa.values[p.key] != null && (
              <span key={p.key} className={fa.param_verdicts[p.key] === 'fail' ? 'text-red-600 font-bold' : ''}>
                {p.label_th} {fa.values[p.key]}{p.unit ? ` ${p.unit}` : ''}{p.is_key ? ' (หลัก)' : ''}
              </span>
            ))}
            <VerdictBadge verdict={fa.verdict} />
          </div>
        )}
      </Section>

      <Section title="งานค้างเพื่อปิดเคส" subtitle="เคสปิดอัตโนมัติเมื่อทุกงานเสร็จ">
        <ul className="divide-y divide-earth-border">
          {tasks.map(t => (
            <li key={t.id} className="px-5 py-3 flex items-start gap-3">
              <span className={`mt-0.5 w-5 h-5 shrink-0 rounded border flex items-center justify-center text-xs ${t.done_at ? 'bg-teal-600 border-teal-600 text-white' : 'border-earth-border bg-white/60'}`}>{t.done_at ? '✓' : ''}</span>
              <div className="flex-1">
                <p className={`text-sm ${t.done_at ? 'text-earth-ink3 line-through' : 'text-earth-ink'}`}>
                  {t.title} {t.auto_key && <span className="text-[11px] no-underline text-indigo-600">(อัตโนมัติ)</span>}
                  {t.source === 'manual' && <span className="text-[11px] text-earth-ink3"> (เพิ่มเอง)</span>}
                </p>
                {t.done_at && <p className="text-[11px] text-earth-ink3">{t.done_by} · {fmtTs(t.done_at)}{t.remark ? ` · ${t.remark}` : ''}</p>}
              </div>
              {canWrite && open && !t.done_at && !t.auto_key && (
                <button className={btn.ghost} onClick={() => setModal({ task: t })}>เสร็จแล้ว</button>
              )}
            </li>
          ))}
        </ul>
        {canWrite && open && (
          <div className="px-5 py-3 border-t border-earth-border flex gap-2">
            <input className={inputCls} value={newTask} onChange={e => setNewTask(e.target.value)} placeholder="เพิ่มงาน (เช่น ประสานผู้ขายนัดส่งชดเชย)" />
            <button className={btn.ghost} disabled={!newTask.trim() || addTask.isPending} onClick={() => addTask.mutate()}>เพิ่ม</button>
          </div>
        )}
        <div className="px-5 pb-3"><ErrorLine error={addTask.error || doneTask.error} /></div>
      </Section>

      <Section title="เที่ยวรถที่ไม่ผ่าน (สอบกลับ)">
        <TripTable rows={tickets.map(t => ({ ...t.trip, ticket1: t.ticket1, net_kg: t.net_kg, sidecar: t.sidecar }))} />
      </Section>

      <Section title="การตัดยอดชดเชย" subtitle="operator ตัดยอดทางบัญชีจากเที่ยวส่งถัดไปของบริษัทเดียวกัน — ยกเลิกรายการได้ (เคสที่ปิดแล้วจะเปิดใหม่)">
        {offsets.length === 0 ? <Empty>ยังไม่มีการตัดยอด</Empty> : (
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-earth-card text-xs text-earth-ink2">
              <th className="text-left px-5 py-2">Track ID</th><th className="text-left px-3 py-2">วันที่ส่ง</th><th className="text-left px-3 py-2">ทะเบียน</th>
              <th className="text-right px-3 py-2">สุทธิ (kg)</th><th className="text-right px-3 py-2">ตัดชดเชย (kg)</th><th className="text-right px-3 py-2">คิดเงิน (kg)</th><th className="text-left px-3 py-2">โดย</th><th className="px-5 py-2" />
            </tr></thead>
            <tbody>
              {offsets.map(o => (
                <tr key={o.id} className={`border-b border-earth-border ${o.voided_at ? 'opacity-60 line-through' : ''}`}>
                  <td className="px-5 py-2"><TicketLink ticket1={o.ticket1} /></td>
                  <td className="px-3 py-2">{o.trip?.dayin}</td>
                  <td className="px-3 py-2 font-mono">{o.trip?.plate}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtNum(o.net_kg)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-red-600">−{fmtNum(o.offset_kg)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtNum((o.net_kg || 0) - o.offset_kg)}</td>
                  <td className="px-3 py-2 text-xs text-earth-ink3">{o.by_user} · {fmtTs(o.at)}{o.remark ? ` · ${o.remark}` : ''}
                    {o.voided_at && <span className="block no-underline text-red-600">ยกเลิก {o.voided_by} · {fmtTs(o.voided_at)} — {o.void_reason}</span>}</td>
                  <td className="px-5 py-2 text-right">
                    {canOffset && !o.voided_at && c.status !== 'cancelled' && (
                      <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => setModal({ voidOffset: o })}>ยกเลิกการตัดยอด</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {!compact && (
        <Section title="ประวัติ (audit)">
          <ul className="px-5 py-3 space-y-1 text-xs text-earth-ink2">
            {audit.map(a => (
              <li key={a.id}><span className="font-mono text-earth-ink3">{fmtTs(a.ts)}</span> · {a.user} · <strong>{a.action}</strong>{a.reason ? ` — ${a.reason}` : ''}</li>
            ))}
          </ul>
        </Section>
      )}

      {modal?.voidOffset && (
        <ReasonModal title={`ยกเลิกการตัดยอด ${modal.voidOffset.ticket1}`} danger confirmLabel="ยกเลิกการตัดยอด"
          consequences={[
            { text: `ยอดคงเหลือของเคสจะเพิ่มขึ้น ${fmtNum(modal.voidOffset.offset_kg)} kg และเที่ยวนี้กลับไปคิดเงินเต็มจำนวน` },
            ...(c.status === 'closed' ? [{ text: 'เคสที่ปิดแล้วจะถูกเปิดใหม่' }] : []),
          ]}
          pending={voidOffset.isPending} error={voidOffset.error}
          onClose={() => setModal(null)} onConfirm={(reason) => voidOffset.mutate({ offsetId: modal.voidOffset.id, reason })} />
      )}
      {modal === 'target' && (
        <TargetModal c={c} pending={patchCase.isPending} error={patchCase.error}
          onClose={() => setModal(null)} onSave={(body) => patchCase.mutate(body)} />
      )}
      {modal?.task && (
        <Modal title="ปิดงาน" onClose={() => setModal(null)}>
          <TaskDoneForm task={modal.task} pending={doneTask.isPending} error={doneTask.error}
            onCancel={() => setModal(null)} onDone={(remark) => doneTask.mutate({ taskId: modal.task.id, remark })} />
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, sub, action }) {
  return (
    <div className="rounded-xl border border-earth-border bg-white/40 px-4 py-3">
      <div className="flex items-center justify-between"><span className="text-xs text-earth-ink2">{label}</span>{action}</div>
      <p className="text-xl font-bold font-mono text-earth-ink mt-1">{value}</p>
      {sub && <div className="text-xs text-earth-ink3 mt-0.5">{sub}</div>}
    </div>
  );
}

function TargetModal({ c, onSave, onClose, pending, error }) {
  const [kg, setKg] = useState(String(c.target_kg));
  const [reason, setReason] = useState(c.override_reason || '');
  const differs = Number(kg) !== c.suggested_kg;
  return (
    <Modal title="กำหนดปริมาณชดเชย" onClose={onClose}>
      <div className="p-5 space-y-3 text-sm">
        <p className="text-earth-ink2">ค่าแนะนำ {fmtNum(c.suggested_kg)} kg (ΣNET × (1 − ค่าวัด/เกณฑ์ ของพารามิเตอร์หลัก)) — ใส่ 0 = ตักเตือนอย่างเดียว</p>
        <input type="number" min="0" className={`${inputCls} font-mono`} value={kg} onChange={e => setKg(e.target.value)} />
        {differs && <textarea className={inputCls} rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="เหตุผล/ข้อตกลง ที่ต่างจากค่าแนะนำ (ไม่บังคับ)" />}
        <ErrorLine error={error} />
      </div>
      <div className="px-5 py-4 border-t border-earth-border flex justify-end gap-2">
        <button className={btn.ghost} onClick={onClose}>ยกเลิก</button>
        <button className={btn.primary} disabled={kg === '' || pending}
          onClick={() => onSave({ target_kg: Number(kg), override_reason: differs ? reason.trim() || null : null })}>บันทึก</button>
      </div>
    </Modal>
  );
}

function TaskDoneForm({ task, onDone, onCancel, pending, error }) {
  const [remark, setRemark] = useState('');
  return (
    <>
      <div className="p-5 space-y-3 text-sm">
        <p className="text-earth-ink">{task.title}</p>
        <input className={inputCls} value={remark} onChange={e => setRemark(e.target.value)} placeholder="หมายเหตุ (เช่น เลขที่หนังสือ)" autoFocus />
        <ErrorLine error={error} />
      </div>
      <div className="px-5 py-4 border-t border-earth-border flex justify-end gap-2">
        <button className={btn.ghost} onClick={onCancel}>ยกเลิก</button>
        <button className={btn.primary} disabled={pending} onClick={() => onDone(remark.trim() || null)}>ยืนยันเสร็จ</button>
      </div>
    </>
  );
}

export function TripTable({ rows }) {
  if (!rows.length) return <Empty>—</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[720px]">
        <thead><tr className="bg-earth-card text-xs text-earth-ink2">
          <th className="text-left px-5 py-2">Track ID</th><th className="text-left px-3 py-2">วันที่/เวลาเข้า</th><th className="text-left px-3 py-2">ทะเบียน</th>
          <th className="text-right px-3 py-2">สุทธิ (kg)</th><th className="text-left px-3 py-2">ใบนำส่ง</th><th className="text-left px-3 py-2">ถ.พ.</th><th className="text-left px-5 py-2">ถัง</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.ticket1} className="border-b border-earth-border">
              <td className="px-5 py-2"><TicketLink ticket1={r.ticket1} /></td>
              <td className="px-3 py-2">{r.dayin} {r.tmin?.slice(0, 5)}</td>
              <td className="px-3 py-2 font-mono font-bold">{r.plate}</td>
              <td className="px-3 py-2 text-right font-mono">{fmtNum(r.net_kg)}</td>
              <td className="px-3 py-2">{r.sidecar ? `${r.sidecar.bill_book ? `${r.sidecar.bill_book}/` : ''}${r.sidecar.bill_no || '—'}` : <span className="text-xs text-orange-600">ไม่มี sidecar</span>}</td>
              <td className="px-3 py-2 font-mono">{r.sidecar?.sg ?? '—'}</td>
              <td className="px-5 py-2 text-xs">{r.sidecar?.fills?.map(f => `${f.tank} ${f.before ?? '?'}→${f.after ?? '?'}`).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
