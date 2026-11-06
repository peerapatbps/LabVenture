import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, put, del } from '../../api.js';
import { CASE_SCOPE, EXT_STATUS, fmtNum, fmtTs, specRange, paramVerdict, verdictInputCls } from '../../config/chemLab.js';
import {
  Section, ChemBadge, VerdictBadge, CaseBadge, TicketLink, ErrorLine, ReasonModal, Modal, Empty, RangeBar, ByTag, SourceBadge,
  btn, inputCls, useLabSpec, OptionPicker,
} from './shared.jsx';
import { ChemFilter } from './BottlesTab.jsx';

// Step 3–4 — results per composite. Pick a composite (shows which bottles it was mixed from) → record in-house results,
// send it to an external lab, choose the final result (changeable, tagged with who chose it).
// Attempts stay editable until สคบ-14 — except the one used as final.
export default function AnalysisTab({ from, to, onRange, selected, onSelect, canWrite, onOpenCase, onOpenMemo, onMix }) {
  const [chem, setChem] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'composites', from, to],
    queryFn: () => get(`/api/chem-lab/composites?from=${from}&to=${to}`),
  });
  const list = (data?.composites || []).filter(c => (!chem || c.chemical === chem) && (!openOnly || !c.final_attempt_id));

  return (
    <div className="space-y-4">
      <Section title="ผลวิเคราะห์" subtitle="เลือกขวดผสม แล้วบันทึกผล / ส่ง Lab ภายนอก / เลือกผล final"
        right={
          <div className="flex items-center gap-3 flex-wrap">
            <RangeBar label="วันที่ส่ง" from={from} to={to} onChange={onRange} />
            <ChemFilter value={chem} onChange={setChem} />
            <label className="flex items-center gap-1.5 text-sm text-earth-ink2">
              <input type="checkbox" className="accent-teal-700" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} /> เฉพาะที่ยังไม่มี final
            </label>
          </div>
        }>
        {isLoading && <Empty>กำลังโหลด...</Empty>}
        {error && <div className="p-5"><ErrorLine error={error} /></div>}
        {!isLoading && !error && !list.length && (
          <Empty>ไม่มีขวดผสมในช่วงนี้ — สร้างที่แท็บ “ผสมตัวอย่าง”{onMix && <> · <button className="text-teal-700 font-semibold hover:underline" onClick={onMix}>ไปผสมตัวอย่าง</button></>}</Empty>
        )}
        {list.length > 0 && (
          <div className="p-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {list.map(c => <CompositeTile key={c.id} c={c} active={c.id === selected} onClick={() => onSelect(c.id === selected ? null : c.id)} />)}
          </div>
        )}
      </Section>

      {selected && (
        <CompositeDetail key={selected} id={selected} canWrite={canWrite} onOpenCase={onOpenCase} onOpenMemo={onOpenMemo} onClose={() => onSelect(null)} />
      )}
    </div>
  );
}

function CompositeTile({ c, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`text-left rounded-xl border px-3 py-2.5 transition ${active ? 'border-teal-600 ring-2 ring-teal-300 bg-teal-50/60' : 'border-earth-border bg-earth hover:border-teal-600'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <ChemBadge chemical={c.chemical} /><span className="text-xs text-earth-ink2 truncate">{c.company_name}</span>
        </span>
        {c.final_attempt_id ? <VerdictBadge verdict={c.verdict} /> : <span className="text-[11px] font-semibold text-amber-700">{c.attempts ? `ผล ${c.attempts} ครั้ง` : 'รอผล'}</span>}
      </div>
      <p className="mt-1 font-bold text-earth-ink text-sm">⚗️ ใบที่ {c.seq} <span className="font-normal text-earth-ink3 text-xs">· {c.sample_date} · {c.n_bottles} ขวด</span></p>
      <p className="text-[11px] font-mono text-earth-ink2 truncate">{c.tickets.join(', ')}</p>
      {c.note && <p className="text-[11px] text-earth-ink3 truncate">“{c.note}”</p>}
      <div className="flex flex-wrap gap-1 mt-1">
        {c.ext_pending > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">ส่ง Lab รอผล</span>}
        {c.case?.status === 'open' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">เคสชดเชย #{c.case.id}</span>}
        {c.memo_doc_no && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{c.memo_doc_no}</span>}
      </div>
    </button>
  );
}

function CompositeDetail({ id, canWrite, onOpenCase, onOpenMemo, onClose }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['chem-lab'] });
  const { data: specData } = useLabSpec();
  const { data, isLoading, error } = useQuery({ queryKey: ['chem-lab', 'composite', id], queryFn: () => get(`/api/chem-lab/composites/${id}`) });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [finalAsk, setFinalAsk] = useState(null);
  const [undo, setUndo] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const deleteM = useMutation({
    mutationFn: ({ a, reason }) => del(`/api/chem-lab/composites/${id}/attempts/${a.id}`, { reason }),
    onSuccess: () => { setDeleting(null); invalidate(); },
  });
  const undoM = useMutation({
    mutationFn: (reason) => del(`/api/chem-lab/composites/${id}/final`, { reason }),
    onSuccess: () => { setUndo(false); invalidate(); },
  });

  if (isLoading) return <Section><Empty>กำลังโหลด...</Empty></Section>;
  if (error) return <Section><div className="p-5"><ErrorLine error={error} /></div></Section>;
  const { composite: c, bottles, attempts, ext_sends: sends, case: activeCase } = data;
  const spec = specData?.chemicals?.[c.chemical];
  if (!spec) return <Section><div className="p-5"><ErrorLine error={`ยังไม่มีเกณฑ์ของ ${c.chemical} ใน lab_chem_spec.json`} /></div></Section>;
  const memo = !!c.memo_id;
  const finalAttempt = attempts.find(a => a.id === c.final_attempt_id) || null;

  const undoConsequences = [];
  if (memo) undoConsequences.push({ block: true, text: `อยู่ใน สคบ-14 ${c.memo_doc_no || ''} แล้ว — ยกเลิก สคบ-14 ก่อน` });
  if (activeCase) {
    if (activeCase.offset_kg > 0) undoConsequences.push({ block: true, text: `เคส #${activeCase.id} ตัดยอดชดเชยไปแล้ว ${fmtNum(activeCase.offset_kg)} kg — ให้ Operator ยกเลิกการตัดยอดก่อน` });
    else undoConsequences.push({ text: `เคสชดเชย #${activeCase.id} จะถูกยกเลิก` });
  }

  return (
    <div className="space-y-4" id="composite-detail">
      <Section className="ring-2 ring-teal-300"
        title={<span className="flex items-center gap-2 flex-wrap">⚗️ ขวดผสมใบที่ {c.seq} <ChemBadge chemical={c.chemical} /> <span className="font-normal text-base text-earth-ink2">{c.company_name}</span> {finalAttempt && <VerdictBadge verdict={c.verdict} />}</span>}
        subtitle={`วันที่ส่ง ${c.sample_date} · ${c.n_bottles} ขวด${c.note ? ` · “${c.note}”` : ''}`}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            {canWrite && !memo && <button className={btn.ghost} onClick={() => setSendOpen(true)}>🏛️ ส่ง Lab ภายนอก</button>}
            <button className="text-earth-ink3 hover:text-earth-ink text-xl leading-none px-2" onClick={onClose} aria-label="ปิด">×</button>
          </div>
        }>
        <div className="px-5 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-earth-ink2">ผสมจากขวด:</span>
            {bottles.map(b => (
              <span key={b.ticket1} className="inline-flex items-center gap-1 text-xs rounded-lg border border-earth-border bg-earth px-1.5 py-0.5">
                <TicketLink ticket1={b.ticket1} /><span className="text-earth-ink3">{b.trip?.plate} · {fmtNum(b.trip?.net_kg)} kg</span>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <ByTag icon="⚗️" label="ผสมโดย " name={c.created_by} ts={c.created_at} />
            {finalAttempt && <ByTag icon="★" label="final โดย " name={c.finalized_by} ts={c.finalized_at} tone="teal" />}
          </div>
          {!spec.verified && (
            <p className="text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-3 py-2">
              ⚠ เกณฑ์ของ {spec.label} ยังไม่ได้ยืนยันกับสัญญา/มอก. (lab_chem_spec.json → verified=false)
            </p>
          )}
          {memo && <p className="text-sm text-indigo-800 bg-indigo-50 border border-indigo-300 rounded-lg px-3 py-2">📄 อยู่ใน สคบ-14 {c.memo_doc_no} — ผลถูกล็อก (ยกเลิก สคบ-14 ได้ในแท็บรายงาน) <button className="font-semibold hover:underline ml-1" onClick={onOpenMemo}>ไปที่ สคบ-14</button></p>}
        </div>

        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full text-sm border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-earth-card text-xs text-earth-ink2">
                <th className="text-left px-3 py-2 border-b border-earth-border">ครั้งที่</th>
                {spec.params.map(p => (
                  <th key={p.key} className="text-right px-3 py-2 border-b border-earth-border">
                    {p.label_th}{p.unit && <span className="block font-normal">{p.unit}</span>}
                    <span className="block font-normal text-earth-ink3">{specRange(p)}</span>
                  </th>
                ))}
                <th className="text-left px-3 py-2 border-b border-earth-border">สรุป</th>
                <th className="px-3 py-2 border-b border-earth-border" />
              </tr>
            </thead>
            <tbody>
              {attempts.length === 0 && <tr><td colSpan={spec.params.length + 3} className="px-3 py-6 text-center text-earth-ink3">ยังไม่มีผลวิเคราะห์</td></tr>}
              {attempts.map(a => {
                const isFinal = c.final_attempt_id === a.id;
                return (
                  <tr key={a.id} className={`border-b border-earth-border ${isFinal ? 'bg-teal-50' : editing?.id === a.id ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-2 font-semibold text-earth-ink align-top">
                      <span className="flex items-center gap-1.5">#{a.attempt_no} <SourceBadge source={a.test_source} /></span>
                      {a.ext_lab && <span className="block text-[11px] font-normal text-violet-700">{a.ext_lab}{a.ext_report_no ? ` · ${a.ext_report_no}` : ''}</span>}
                      <span className="block text-[11px] text-earth-ink3 font-normal">{a.tested_by} · {fmtTs(a.tested_at)}</span>
                      {a.updated_at && <span className="block text-[11px] text-amber-700 font-normal">แก้ไข {a.updated_by} · {fmtTs(a.updated_at)}</span>}
                      {isFinal && <span className="mt-1 inline-block"><ByTag icon="★" label="final · " name={c.finalized_by} ts={c.finalized_at} tone="teal" /></span>}
                    </td>
                    {spec.params.map(p => {
                      const v = a.values[p.key];
                      const pv = a.param_verdicts[p.key];
                      return (
                        <td key={p.key} className="px-2 py-1.5 text-right align-top">
                          <span className={`inline-block min-w-[3.5rem] rounded-md px-2 py-1 font-mono ${pv === 'fail' ? 'bg-red-100 text-red-700 font-bold ring-1 ring-red-400' : pv === 'pass' ? 'bg-green-50 text-green-800 ring-1 ring-green-300' : 'text-earth-ink3'}`}>
                            {v ?? '—'}
                          </span>
                          {p.with_temp && a.temp_c_rd != null && v != null && <span className="block text-[11px] text-earth-ink3">@{a.temp_c_rd}°C</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 align-top"><VerdictBadge verdict={a.verdict} />{a.remark && <span className="block text-[11px] text-earth-ink3">{a.remark}</span>}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap align-top space-x-1">
                      {canWrite && !memo && !isFinal && (
                        <>
                          <button className="text-xs font-semibold text-earth-ink2 hover:underline px-1" onClick={() => setEditing(a)}>แก้ไข</button>
                          <button className="text-xs font-semibold text-red-600 hover:underline px-1" onClick={() => setDeleting(a)}>ลบ</button>
                          <button className={btn.ghost} onClick={() => setFinalAsk(a)}>{finalAttempt ? 'เปลี่ยนเป็นผล final' : 'ใช้เป็นผล final'}</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(finalAttempt || activeCase) && (
          <div className="px-5 pb-4 space-y-2">
            {finalAttempt && (
              <div className="flex items-center justify-between gap-2 flex-wrap rounded-xl border border-teal-300 bg-teal-50 px-4 py-2.5">
                <span className="text-sm text-teal-900 font-semibold flex items-center gap-2 flex-wrap">★ ผล final: ครั้งที่ {finalAttempt.attempt_no} <VerdictBadge verdict={finalAttempt.verdict} /></span>
                {canWrite && !memo && <button className={btn.ghost} onClick={() => setUndo(true)}>↩ ย้อนผล final</button>}
              </div>
            )}
            {activeCase && (
              <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm text-red-700 font-semibold flex items-center gap-2 flex-wrap">
                  🚩 เคสชดเชย #{activeCase.id} <CaseBadge status={activeCase.status} />
                  {CASE_SCOPE[activeCase.scope]?.short || ''} {activeCase.n_tickets} คัน · เป้า {fmtNum(activeCase.target_kg)} kg · คงเหลือ {fmtNum(activeCase.remaining_kg)} kg
                </span>
                <button className={btn.ghost} onClick={() => onOpenCase(activeCase.id)}>เปิดเคส</button>
              </div>
            )}
          </div>
        )}

        {sends.length > 0 && (
          <div className="px-5 pb-4">
            <p className="text-xs font-semibold text-earth-ink2 mb-1">ส่ง Lab ภายนอก</p>
            <ul className="space-y-1">
              {sends.map(s => (
                <li key={s.id} className="text-xs text-earth-ink2 flex items-center gap-2 flex-wrap">
                  <span className={`font-bold px-1.5 py-0.5 rounded ${EXT_STATUS[s.status]?.cls}`}>{EXT_STATUS[s.status]?.label}</span>
                  <span className="font-semibold text-earth-ink">{s.lab_name}</span> · ส่ง {s.sent_by} {fmtTs(s.sent_at)}
                  {s.note && <span>· {s.note}</span>}
                  {s.status === 'resulted' && <span>· บันทึกผล {s.resulted_by} {fmtTs(s.resulted_at)}</span>}
                  {s.status === 'cancelled' && <span className="text-red-600">· {s.cancel_reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {canWrite && !memo && (
        <AttemptForm key={editing?.id ?? 'new'} spec={spec} attempt={editing}
          mode={editing ? (editing.test_source === 'inhouse' ? 'inhouse' : 'external') : 'inhouse'}
          title={editing ? `แก้ไขผลวิเคราะห์ ครั้งที่ ${editing.attempt_no}` : `บันทึกผลทดสอบเอง — ขวดผสมใบที่ ${c.seq}`}
          subtitle={editing ? 'ค่าก่อน/หลังแก้จะถูกเก็บใน audit' : 'ช่องแดง = ไม่ผ่านเกณฑ์ · ช่องเขียว = ผ่านเกณฑ์ (ผล Lab ภายนอก บันทึกที่แท็บ “Lab ภายนอก”)'}
          submit={(body) => editing ? put(`/api/chem-lab/composites/${id}/attempts/${editing.id}`, body) : post(`/api/chem-lab/composites/${id}/attempts`, body)}
          onDone={() => { setEditing(null); invalidate(); }} onCancel={editing ? () => setEditing(null) : null} />
      )}

      {deleting && (
        <ReasonModal title={`ลบผลวิเคราะห์ครั้งที่ ${deleting.attempt_no}`} danger confirmLabel="ลบ"
          message="ผลที่ลบจะไม่แสดงในรายการ แต่ยังเก็บไว้ใน audit"
          pending={deleteM.isPending} error={deleteM.error}
          onClose={() => setDeleting(null)} onConfirm={(reason) => deleteM.mutate({ a: deleting, reason })} />
      )}
      {undo && (
        <ReasonModal title="ย้อนผล final" danger confirmLabel="ย้อนผล final"
          consequences={[...undoConsequences, { text: 'ขวดผสมกลับไปสถานะ “กำลังวิเคราะห์” — เลือกผล final ใหม่ได้' }]}
          pending={undoM.isPending} error={undoM.error}
          onClose={() => setUndo(false)} onConfirm={(reason) => undoM.mutate(reason)} />
      )}
      {finalAsk && (
        <FinalModal c={c} attempt={finalAsk} current={finalAttempt} activeCase={activeCase} bottles={bottles}
          onClose={() => setFinalAsk(null)} onDone={() => { setFinalAsk(null); invalidate(); }} />
      )}
      {sendOpen && <SendExtModal c={c} onClose={() => setSendOpen(false)} onDone={() => { setSendOpen(false); invalidate(); }} />}
    </div>
  );
}

// Choose / change the final result. A failing final opens a case over the trips the user picks.
function FinalModal({ c, attempt, current, activeCase, bottles, onClose, onDone }) {
  const fail = attempt.verdict === 'fail';
  const changing = !!current;
  const [scope, setScope] = useState('composite');
  const [picked, setPicked] = useState(() => new Set(c.tickets));
  const [reason, setReason] = useState('');
  const dayQ = useQuery({
    queryKey: ['chem-lab', 'bottles', c.sample_date],
    queryFn: () => get(`/api/chem-lab/bottles?date=${c.sample_date}`),
    enabled: fail,
  });
  const dayTrips = dayQ.data?.groups?.find(g => g.chemical === c.chemical && g.company === c.company)?.rows || [];
  const mine = new Set(c.tickets);
  const trips = scope === 'day' ? dayTrips : scope === 'composite' ? dayTrips.filter(t => mine.has(t.ticket1)) : dayTrips.filter(t => picked.has(t.ticket1));
  const totalNet = trips.reduce((s, t) => s + (t.net_kg || 0), 0);
  const keyFail = attempt.key_param && attempt.param_verdicts[attempt.key_param] === 'fail' && attempt.key_value != null && attempt.key_min;
  const suggested = keyFail ? Math.round(totalNet * Math.max(0, 1 - attempt.key_value / attempt.key_min)) : 0;
  const blocked = activeCase && activeCase.offset_kg > 0;

  const m = useMutation({
    mutationFn: () => put(`/api/chem-lab/composites/${c.id}/final`, {
      attempt_id: attempt.id,
      ...(changing && reason.trim() ? { reason: reason.trim() } : {}),
      ...(fail ? { case_scope: scope, ...(scope === 'custom' ? { case_tickets: [...picked] } : {}) } : {}),
    }),
    onSuccess: onDone,
  });
  const ready = !blocked && (!fail || trips.length > 0);
  const toggle = (t) => setPicked(p => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });

  return (
    <Modal title={`${changing ? 'เปลี่ยน' : 'ใช้'}ผลครั้งที่ ${attempt.attempt_no} เป็นผล final — ใบที่ ${c.seq}`} onClose={onClose} wide={fail}>
      <div className="p-5 space-y-3 text-sm text-earth-ink">
        <p className="flex items-center gap-2">ผลสรุป: <VerdictBadge verdict={attempt.verdict} /> <span className="text-earth-ink3">ระบบจะบันทึกชื่อคุณเป็นผู้เลือกผล final</span></p>
        {changing && <p className="rounded-lg px-3 py-2 border bg-amber-50 border-amber-300 text-amber-800">⚠ แทนผล final เดิม (ครั้งที่ {current.attempt_no}, เลือกโดย {c.finalized_by || '—'})</p>}
        {activeCase && !blocked && <p className="rounded-lg px-3 py-2 border bg-amber-50 border-amber-300 text-amber-800">⚠ เคสชดเชย #{activeCase.id} เดิมจะถูกยกเลิก</p>}
        {blocked && <p className="rounded-lg px-3 py-2 border bg-red-50 border-red-300 text-red-700 font-semibold">⛔ เคส #{activeCase.id} ตัดยอดชดเชยไปแล้ว {fmtNum(activeCase.offset_kg)} kg — ให้ Operator ยกเลิกการตัดยอดก่อน</p>}

        {fail && (
          <div className="rounded-xl border border-red-300 bg-red-50/50 p-3 space-y-2">
            <p className="font-semibold text-red-700">ผลไม่ผ่าน → เปิดเคสชดเชย · เลือกวิธีชดเชย</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CASE_SCOPE).map(([k, s]) => (
                <label key={k} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer ${scope === k ? 'bg-red-600 text-white border-red-600' : 'bg-white/70 border-earth-border text-earth-ink2'}`}>
                  <input type="radio" className="hidden" checked={scope === k} onChange={() => setScope(k)} />{s.label}
                </label>
              ))}
            </div>
            {dayQ.isLoading ? <p className="text-earth-ink3">กำลังโหลดเที่ยวรถ...</p> : (
              <ul className="divide-y divide-earth-border border border-earth-border rounded-lg bg-white/70 max-h-56 overflow-y-auto">
                {dayTrips.map(t => {
                  const on = trips.some(x => x.ticket1 === t.ticket1);
                  return (
                    <li key={t.ticket1}>
                      <label className={`flex items-center gap-3 px-3 py-1.5 ${scope === 'custom' ? 'cursor-pointer' : ''} ${on ? '' : 'opacity-50'}`}>
                        <input type="checkbox" className="w-4 h-4 accent-red-600" disabled={scope !== 'custom'} checked={on} onChange={() => toggle(t.ticket1)} />
                        <span className="font-mono">{t.ticket1}</span><span className="text-xs text-earth-ink2">{t.plate}</span>
                        {mine.has(t.ticket1) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">ในใบผสม</span>}
                        <span className="ml-auto font-mono text-xs">{fmtNum(t.net_kg)} kg</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-earth-ink">
              {trips.length} คัน · สุทธิรวม <b>{fmtNum(totalNet)}</b> kg · ชดเชยแนะนำ <b>{fmtNum(suggested)}</b> kg
              {!keyFail && <span className="text-earth-ink3"> (พารามิเตอร์หลักผ่าน — กำหนดปริมาณเองในหน้าเคส)</span>}
            </p>
            <p className="text-[11px] text-earth-ink3">เที่ยวรถหนึ่งอยู่ได้ในเคสที่ยังไม่ยกเลิกได้เพียงเคสเดียว (กันชดเชยซ้ำจากขวดผสมที่ซ้อนกัน)</p>
          </div>
        )}
        {changing && <textarea className={inputCls} rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="เหตุผลที่เปลี่ยนผล final (ไม่บังคับ — บันทึกใน audit)" />}
        <ErrorLine error={m.error} />
      </div>
      <div className="px-5 py-4 border-t border-earth-border flex justify-end gap-2">
        <button className={btn.ghost} onClick={onClose}>ยกเลิก</button>
        <button className={fail ? btn.danger : btn.primary} disabled={!ready || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? 'กำลังบันทึก...' : fail ? 'ยืนยันผล final และเปิดเคส' : 'ยืนยันผล final'}
        </button>
      </div>
    </Modal>
  );
}

function SendExtModal({ c, onClose, onDone }) {
  const [lab, setLab] = useState('');
  const [note, setNote] = useState('');
  const m = useMutation({ mutationFn: () => post(`/api/chem-lab/composites/${c.id}/ext-sends`, { lab_name: lab.trim(), note: note.trim() || null }), onSuccess: onDone });
  return (
    <Modal title={`ส่งขวดผสมใบที่ ${c.seq} ไปห้องปฏิบัติการภายนอก`} onClose={onClose}>
      <div className="p-5 space-y-3">
        <p className="text-sm text-earth-ink2">รายการจะไปรอผลในแท็บ “Lab ภายนอก” — เมื่อได้ผลให้บันทึกที่นั่น</p>
        <label className="block text-sm text-earth-ink2 space-y-1"><span>ห้องปฏิบัติการ *</span>
          <OptionPicker kind="labs" value={lab} onChange={setLab} placeholder="— เลือกห้องปฏิบัติการ —" addLabel="เพิ่มชื่อห้องปฏิบัติการ" autoFocus /></label>
        <input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="หมายเหตุ (เช่น เลขใบส่งตัวอย่าง)" />
        <ErrorLine error={m.error} />
      </div>
      <div className="px-5 py-4 border-t border-earth-border flex justify-end gap-2">
        <button className={btn.ghost} onClick={onClose}>ยกเลิก</button>
        <button className={btn.primary} disabled={!lab.trim() || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'กำลังบันทึก...' : 'บันทึกการส่ง'}</button>
      </div>
    </Modal>
  );
}

// Result form. mode inhouse = every parameter + temperature required; external = partial allowed + lab/report fields.
// Boxes turn red (out of spec) / green (within spec) while typing.
export function AttemptForm({ spec, attempt, mode = 'inhouse', title, subtitle, submit, onDone, onCancel, defaultLab = '' }) {
  const editMode = !!attempt;
  const external = mode === 'external';
  const blank = { ext_lab: defaultLab, ext_report_no: '', attachment_ref: '', temp_c_rd: '', remark: '', values: {}, reason: '' };
  const [f, setF] = useState(() => editMode ? {
    ext_lab: attempt.ext_lab || '', ext_report_no: attempt.ext_report_no || '', attachment_ref: attempt.attachment_ref || '',
    temp_c_rd: attempt.temp_c_rd ?? '', remark: attempt.remark || '',
    values: Object.fromEntries(Object.entries(attempt.values || {}).map(([k, v]) => [k, String(v)])), reason: '',
  } : blank);
  useEffect(() => { if (!editMode) setF(x => ({ ...x, ext_lab: x.ext_lab || defaultLab })); }, [defaultLab, editMode]);

  const mutation = useMutation({
    mutationFn: () => submit({ ...f, test_source: editMode ? attempt.test_source : external ? 'external_lab' : 'inhouse' }),
    onSuccess: () => { setF(blank); onDone(); },
  });

  const verdicts = spec.params.map(p => paramVerdict(p, f.values[p.key]));
  const filled = verdicts.filter(Boolean).length;
  const fails = verdicts.filter(v => v === 'fail').length;
  const preview = fails ? 'fail' : filled ? 'pass' : null;
  const complete = external ? filled > 0 : filled === spec.params.length && (!spec.params.some(p => p.with_temp) || f.temp_c_rd !== '');
  const ready = complete;

  return (
    <Section title={title} subtitle={subtitle}
      right={onCancel ? <button className={btn.ghost} onClick={onCancel}>{editMode ? 'ยกเลิกการแก้ไข' : 'ปิด'}</button> : null}
      className={editMode ? 'ring-2 ring-amber-300' : ''}>
      <div className="p-5 space-y-4">
        {external && (
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm text-earth-ink2 space-y-1"><span>ห้องปฏิบัติการ</span>
              <OptionPicker kind="labs" value={f.ext_lab} onChange={v => setF(x => ({ ...x, ext_lab: v }))} addLabel="เพิ่มชื่อห้องปฏิบัติการ" /></label>
            <label className="text-sm text-earth-ink2 space-y-1"><span>เลขที่รายงาน</span>
              <input className={inputCls} value={f.ext_report_no} onChange={e => setF(x => ({ ...x, ext_report_no: e.target.value }))} /></label>
            <label className="text-sm text-earth-ink2 space-y-1"><span>ที่เก็บเอกสาร (อ้างอิง)</span>
              <OptionPicker kind="doc_locations" value={f.attachment_ref} onChange={v => setF(x => ({ ...x, attachment_ref: v }))} addLabel="เพิ่มที่เก็บเอกสาร (เช่น เลขแฟ้ม)" /></label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {spec.params.map((p, i) => {
            const v = verdicts[i];
            return (
              <label key={p.key} className="text-sm text-earth-ink2 space-y-1">
                <span className="flex justify-between gap-2">
                  <span className="font-semibold">{p.label_th} {p.unit && <span className="font-normal">({p.unit})</span>}{p.is_key && <span className="text-[10px] text-teal-700"> หลัก</span>}</span>
                  <span className="text-earth-ink3">{specRange(p)}</span>
                </span>
                <div className="flex gap-2 items-center">
                  <input type="number" step="any" inputMode="decimal" value={f.values[p.key] ?? ''}
                    onChange={e => setF(x => ({ ...x, values: { ...x.values, [p.key]: e.target.value } }))}
                    className={`${inputCls} font-mono ${verdictInputCls(v)}`} />
                  {v && <span className={`text-lg leading-none ${v === 'fail' ? 'text-red-600' : 'text-green-700'}`} aria-label={v === 'fail' ? 'ไม่ผ่าน' : 'ผ่าน'}>{v === 'fail' ? '✗' : '✓'}</span>}
                  {p.with_temp && (
                    <input type="number" step="any" value={f.temp_c_rd} title="อุณหภูมิที่วัด (°C)"
                      onChange={e => setF(x => ({ ...x, temp_c_rd: e.target.value }))}
                      className={`${inputCls} w-24 font-mono`} placeholder="°C" />
                  )}
                </div>
              </label>
            );
          })}
        </div>
        <label className="block text-sm text-earth-ink2 space-y-1"><span>หมายเหตุ</span>
          <input className={inputCls} value={f.remark} onChange={e => setF(x => ({ ...x, remark: e.target.value }))} /></label>
        {editMode && (
          <label className="block text-sm text-earth-ink2 space-y-1"><span className="font-semibold">เหตุผลที่แก้ไข (ไม่บังคับ)</span>
            <input className={inputCls} value={f.reason} onChange={e => setF(x => ({ ...x, reason: e.target.value }))} placeholder="เช่น พิมพ์ตัวเลขผิด" /></label>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-earth-ink2 flex items-center gap-2">สรุปเบื้องต้น: {preview ? <VerdictBadge verdict={preview} /> : '—'}
            {filled > 0 && <span className="text-xs">({filled - fails} ผ่าน · {fails} ไม่ผ่าน{external ? '' : ` · กรอก ${filled}/${spec.params.length}`})</span>}</span>
          <div className="flex items-center gap-2">
            <ErrorLine error={mutation.error} />
            <button className={btn.primary} disabled={!ready || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? 'กำลังบันทึก...' : editMode ? 'บันทึกการแก้ไข' : 'บันทึกผล'}
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}
