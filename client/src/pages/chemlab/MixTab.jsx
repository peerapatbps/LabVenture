import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, put, del } from '../../api.js';
import { fmtNum } from '../../config/chemLab.js';
import { Section, ChemBadge, VerdictBadge, TicketLink, ErrorLine, ReasonModal, Modal, Empty, DateBar, CompositeChip, ByTag, btn, inputCls } from './shared.jsx';
import { ChemFilter } from './BottlesTab.jsx';

// Step 2 — mixing. Any received bottles of one sample group (day × chemical × company) can be mixed, as many times
// as needed and overlapping (e.g. 50% of bottles 1–2 + another of bottles 1–3 for cross-checking).
// A composite's bottles can change until it has an analysis result; it can be deleted until it has a final result.
export default function MixTab({ date, onDate, canWrite, focus, onAnalyze, onReceive }) {
  const [chem, setChem] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'bottles', date],
    queryFn: () => get(`/api/chem-lab/bottles?date=${date}`),
  });
  const groups = (data?.groups || []).filter(g => !chem || g.chemical === chem);

  return (
    <div className="space-y-4">
      <Section title="ผสมตัวอย่าง (composite)" subtitle="เลือกขวดที่รับแล้วมาผสม — ผสมกี่ใบก็ได้ และขวดเดียวกันอยู่ได้หลายใบ"
        right={
          <div className="flex items-center gap-3 flex-wrap">
            <DateBar date={date} onChange={onDate} />
            <ChemFilter value={chem} onChange={setChem} />
          </div>
        }>
        {isLoading && <Empty>กำลังโหลด...</Empty>}
        {error && <div className="p-5"><ErrorLine error={error} /></div>}
        {!isLoading && !error && !groups.length && <Empty>ไม่มีเที่ยวรถ PACl / Alum ที่ชั่งออกในวันที่ {date}</Empty>}
      </Section>
      {groups.map(g => (
        <MixGroup key={`${g.chemical}|${g.company}`} date={date} g={g} canWrite={canWrite} onAnalyze={onAnalyze} onReceive={onReceive}
          highlight={focus && focus.chemical === g.chemical && focus.company === g.company} />
      ))}
    </div>
  );
}

function MixGroup({ date, g, canWrite, onAnalyze, onReceive, highlight }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['chem-lab'] });
  const received = g.rows.filter(r => r.bottle?.status === 'received');
  const [picked, setPicked] = useState(() => new Set());
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  useEffect(() => {
    if (highlight) document.getElementById(`mix-${g.chemical}-${g.company}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [highlight, g.chemical, g.company]);

  const createM = useMutation({
    mutationFn: () => post('/api/chem-lab/composites', { date, chemical: g.chemical, company: g.company, tickets: [...picked], note: note.trim() || null }),
    onSuccess: () => { setPicked(new Set()); setNote(''); invalidate(); },
  });
  const deleteM = useMutation({
    mutationFn: ({ c, reason }) => del(`/api/chem-lab/composites/${c.id}`, { reason }),
    onSuccess: () => { setDeleting(null); invalidate(); },
  });

  const toggle = (t) => setPicked(p => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const pickedKg = received.filter(r => picked.has(r.ticket1)).reduce((s, r) => s + (r.net_kg || 0), 0);

  return (
    <div id={`mix-${g.chemical}-${g.company}`}>
      <Section className={highlight ? 'ring-2 ring-teal-400' : ''}
        title={<span className="flex items-center gap-2 flex-wrap"><ChemBadge chemical={g.chemical} /> {g.company_name}</span>}
        subtitle={`ขวดที่รับแล้ว ${g.received}/${g.expected}${g.pending ? ` · ยังไม่บันทึกรับ ${g.pending}` : ''} · ยังไม่ถูกผสม ${g.unmixed} · ขวดผสม ${g.composites.length} ใบ`}
        right={g.pending > 0 && onReceive ? <button className={btn.ghost} onClick={() => onReceive(g)}>📦 ไปรับขวด</button> : null}
      >
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {/* new composite */}
          <div className="rounded-xl border border-earth-border bg-white/40">
            <div className="px-4 py-2.5 border-b border-earth-border flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-sm text-earth-ink">สร้างขวดผสมใบใหม่</span>
              {canWrite && received.length > 0 && (
                <span className="flex gap-2 text-xs font-semibold">
                  <button className="text-teal-700 hover:underline" onClick={() => setPicked(new Set(received.map(r => r.ticket1)))}>ทั้งหมด</button>
                  <button className="text-teal-700 hover:underline" onClick={() => setPicked(new Set(received.filter(r => !r.bottle.composite_ids.length).map(r => r.ticket1)))}>ที่ยังไม่ผสม</button>
                  <button className="text-earth-ink3 hover:underline" onClick={() => setPicked(new Set())}>ล้าง</button>
                </span>
              )}
            </div>
            {received.length === 0 ? <Empty>ยังไม่มีขวดที่บันทึกรับ</Empty> : (
              <ul className="divide-y divide-earth-border max-h-80 overflow-y-auto">
                {received.map((r, i) => (
                  <li key={r.ticket1}>
                    <label className={`flex items-center gap-3 px-4 py-2 ${canWrite ? 'cursor-pointer hover:bg-teal-50/60' : ''}`}>
                      <input type="checkbox" className="w-4 h-4 accent-teal-700" disabled={!canWrite} checked={picked.has(r.ticket1)} onChange={() => toggle(r.ticket1)} />
                      <span className="w-6 text-xs font-bold text-earth-ink3">{i + 1}</span>
                      <span className="flex-1 min-w-0">
                        <TicketLink ticket1={r.ticket1} /> <span className="font-mono text-xs text-earth-ink2">{r.plate}</span>
                        <span className="block text-[11px] text-earth-ink3">{fmtNum(r.net_kg)} kg · รับโดย {r.bottle.received_by}</span>
                      </span>
                      <span className="flex flex-wrap gap-1 justify-end">
                        {r.bottle.composite_seqs.length ? r.bottle.composite_seqs.map(n => <CompositeChip key={n} c={n} />)
                          : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">ยังไม่ผสม</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && received.length > 0 && (
              <div className="px-4 py-3 border-t border-earth-border space-y-2">
                <input className={inputCls} value={note} onChange={e => setNote(e.target.value)}
                  placeholder="หมายเหตุ/เงื่อนไขการผสม เช่น 50% ของขวด 1–2" />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs text-earth-ink2">เลือก {picked.size} ขวด{picked.size ? ` · ${fmtNum(pickedKg)} kg` : ''}</span>
                  <button className={btn.primary} disabled={!picked.size || createM.isPending} onClick={() => createM.mutate()}>
                    {createM.isPending ? 'กำลังบันทึก...' : `⚗️ ผสม ${picked.size || ''} ขวด`}
                  </button>
                </div>
                <ErrorLine error={createM.error} />
              </div>
            )}
          </div>

          {/* composites of the group */}
          <div className="space-y-2">
            {g.composites.length === 0 && <p className="text-sm text-earth-ink3 px-1 py-6 text-center">ยังไม่มีขวดผสม</p>}
            {g.composites.map(c => (
              <CompositeCard key={c.id} c={c} rows={g.rows} canWrite={canWrite}
                onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)} onAnalyze={() => onAnalyze?.(c)} />
            ))}
          </div>
        </div>
      </Section>

      {editing && <EditCompositeModal c={editing} received={received} onClose={() => setEditing(null)} onDone={() => { setEditing(null); invalidate(); }} />}
      {deleting && (
        <ReasonModal title={`ลบขวดผสมใบที่ ${deleting.seq}`} danger confirmLabel="ลบใบผสม"
          consequences={[
            ...(deleting.attempts ? [{ text: `ผลวิเคราะห์ ${deleting.attempts} ครั้งของใบนี้จะไม่แสดงอีก (ยังอยู่ใน audit)` }] : []),
            ...(deleting.ext_pending ? [{ text: `รายการส่ง Lab ภายนอกที่รอผล ${deleting.ext_pending} รายการจะถูกยกเลิก` }] : []),
            { text: 'เลขใบผสมเดิมจะไม่ถูกใช้ซ้ำ' },
          ]}
          pending={deleteM.isPending} error={deleteM.error}
          onClose={() => setDeleting(null)} onConfirm={(reason) => deleteM.mutate({ c: deleting, reason })} />
      )}
    </div>
  );
}

function CompositeCard({ c, rows, canWrite, onEdit, onDelete, onAnalyze }) {
  const idx = Object.fromEntries(rows.map((r, i) => [r.ticket1, i + 1]));
  const locked = !!c.final_attempt_id;
  return (
    <div className={`rounded-xl border px-4 py-3 ${locked ? 'border-teal-300 bg-teal-50/40' : 'border-earth-border bg-white/40'}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="font-bold text-earth-ink flex items-center gap-2 flex-wrap">
            ⚗️ ใบที่ {c.seq} <span className="text-xs font-normal text-earth-ink2">{c.n_bottles} ขวด</span>
            {locked ? <VerdictBadge verdict={c.verdict} /> : c.attempts ? <span className="text-xs text-amber-700 font-semibold">ผล {c.attempts} ครั้ง</span> : <span className="text-xs text-sky-700 font-semibold">รอวิเคราะห์</span>}
            {c.ext_pending > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">ส่ง Lab รอผล</span>}
            {c.memo_doc_no && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{c.memo_doc_no}</span>}
          </p>
          {c.note && <p className="text-sm text-earth-ink2 mt-0.5">“{c.note}”</p>}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {onAnalyze && <button className={btn.ghost} onClick={onAnalyze}>🔬 ผลวิเคราะห์</button>}
          {canWrite && !locked && !c.memo_id && (
            <>
              <button className="text-xs font-semibold text-earth-ink2 hover:underline px-1" onClick={onEdit}>แก้ไข</button>
              <button className="text-xs font-semibold text-red-600 hover:underline px-1" onClick={onDelete}>ลบ</button>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        {c.tickets.map(t => (
          <span key={t} className="inline-flex items-center gap-1 text-xs rounded-lg border border-earth-border bg-earth px-1.5 py-0.5">
            <span className="font-bold text-earth-ink3">{idx[t] ?? '?'}</span><TicketLink ticket1={t} />
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        <ByTag icon="⚗️" label="ผสมโดย " name={c.created_by} ts={c.created_at} />
        {c.updated_by && <ByTag icon="✏️" label="แก้ " name={c.updated_by} ts={c.updated_at} />}
        {locked && <ByTag icon="★" label="final โดย " name={c.finalized_by} ts={c.finalized_at} tone="teal" />}
      </div>
    </div>
  );
}

function EditCompositeModal({ c, received, onClose, onDone }) {
  const [picked, setPicked] = useState(() => new Set(c.tickets));
  const [note, setNote] = useState(c.note || '');
  const [reason, setReason] = useState('');
  const bottlesLocked = c.attempts > 0;
  const ticketsChanged = useMemo(() => [...picked].sort().join() !== [...c.tickets].sort().join(), [picked, c.tickets]);
  const m = useMutation({
    mutationFn: () => put(`/api/chem-lab/composites/${c.id}`, {
      ...(ticketsChanged ? { tickets: [...picked] } : {}), note: note.trim() || null, reason: reason.trim() || null,
    }),
    onSuccess: onDone,
  });
  const toggle = (t) => setPicked(p => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });
  return (
    <Modal title={`แก้ไขขวดผสมใบที่ ${c.seq}`} onClose={onClose}>
      <div className="p-5 space-y-3">
        {bottlesLocked && (
          <p className="text-sm rounded-lg px-3 py-2 border bg-amber-50 border-amber-300 text-amber-800">
            ⚠ ใบนี้มีผลวิเคราะห์แล้ว — เปลี่ยนขวดไม่ได้ (แก้หมายเหตุได้) ถ้าต้องผสมใหม่ให้สร้างใบใหม่
          </p>
        )}
        <ul className="divide-y divide-earth-border border border-earth-border rounded-lg max-h-64 overflow-y-auto">
          {received.map((r, i) => (
            <li key={r.ticket1}>
              <label className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <input type="checkbox" className="w-4 h-4 accent-teal-700" disabled={bottlesLocked} checked={picked.has(r.ticket1)} onChange={() => toggle(r.ticket1)} />
                <span className="w-5 text-xs font-bold text-earth-ink3">{i + 1}</span>
                <span className="font-mono">{r.ticket1}</span><span className="text-xs text-earth-ink2">{r.plate}</span>
              </label>
            </li>
          ))}
        </ul>
        <input className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder="หมายเหตุ/เงื่อนไขการผสม" />
        <textarea className={inputCls} rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="เหตุผลที่แก้ไข (ไม่บังคับ — บันทึกใน audit)" />
        <ErrorLine error={m.error} />
      </div>
      <div className="px-5 py-4 border-t border-earth-border flex justify-end gap-2">
        <button className={btn.ghost} onClick={onClose}>ปิด</button>
        <button className={btn.primary} disabled={!picked.size || m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
        </button>
      </div>
    </Modal>
  );
}
