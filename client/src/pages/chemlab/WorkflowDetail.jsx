import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../api.js';
import { STAGE_BY_KEY, compositeStage, fmtNum } from '../../config/chemLab.js';
import { Section, ChemBadge, VerdictBadge, TicketLink, ErrorLine, Empty, ByTag, btn } from './shared.jsx';

// Overview of one sample group (day × chemical × company) opened from the board: where each step stands, and
// shortcuts to the tab that does it (receive → mix → analysis/final → case → สคบ-14).
export default function WorkflowDetail({ group, onBack, onGo, onOpenComposite, onOpenCase, onOpenMemo }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'bottles', group.date],
    queryFn: () => get(`/api/chem-lab/bottles?date=${group.date}`),
  });
  if (isLoading) return <Section><Empty>กำลังโหลด...</Empty></Section>;
  if (error) return <Section><div className="p-5"><ErrorLine error={error} /></div></Section>;
  const g = data.groups.find(x => x.chemical === group.chemical && x.company === group.company);
  if (!g) return <Section><Empty>ไม่พบเที่ยวรถของ {group.chemical} / {group.company} วันที่ {group.date}</Empty></Section>;

  const comps = g.composites;
  const finals = comps.filter(c => c.final_attempt_id).length;
  const memos = comps.filter(c => c.memo_id).length;
  const openCases = comps.filter(c => c.case?.status === 'open');
  const steps = [
    { label: 'รับขวด', done: g.pending === 0 && g.received > 0, note: `${g.received}/${g.expected} ขวด${g.pending ? ` · ค้าง ${g.pending}` : ''}`, go: 'bottles' },
    { label: 'ผสมตัวอย่าง', done: comps.length > 0 && g.unmixed === 0, note: `${comps.length} ใบ${g.unmixed ? ` · ยังไม่ผสม ${g.unmixed} ขวด` : ''}`, go: 'mix' },
    { label: 'วิเคราะห์ / final', done: comps.length > 0 && finals === comps.length, note: comps.length ? `final ${finals}/${comps.length} ใบ` : '—', go: 'analysis' },
    { label: 'เคสชดเชย', done: openCases.length === 0, note: openCases.length ? `เปิด ${openCases.length} เคส` : 'ไม่มีเคสค้าง', go: openCases.length ? 'case' : null },
    { label: 'สคบ-14', done: comps.length > 0 && memos === comps.length, note: comps.length ? `${memos}/${comps.length} ใบ` : '—', go: 'memo' },
  ];
  const current = steps.findIndex(s => !s.done);

  return (
    <div className="space-y-4">
      <Section
        title={<span className="flex items-center gap-2 flex-wrap">
          <button onClick={onBack} className="text-earth-ink3 hover:text-earth-ink text-base font-normal">← ภาพรวม</button>
          <span>ตัวอย่าง {g.company_name}</span> <ChemBadge chemical={g.chemical} />
        </span>}
        subtitle={`วันที่ส่ง ${group.date} · ${g.expected} เที่ยว · ได้รับ ${g.received} · ไม่ได้รับ ${g.not_received} · ยังไม่บันทึก ${g.pending}`}
      >
        <ol className="px-5 py-4 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:flex lg:items-stretch">
          {steps.map((s, i) => {
            const state = s.done ? 'done' : i === current ? 'current' : 'todo';
            return (
              <li key={s.label} className="lg:flex-1 min-w-0">
                <button disabled={!s.go}
                  onClick={() => s.go === 'case' ? onOpenCase(openCases[0].case.id) : s.go === 'memo' ? onOpenMemo() : onGo(s.go, g)}
                  className={`w-full text-left rounded-xl px-3 py-2 border transition disabled:cursor-default ${
                    state === 'done' ? 'bg-teal-50 border-teal-300' : state === 'current' ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-200' : 'bg-white/40 border-earth-border'}`}>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-earth-ink">
                    <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center shrink-0 ${
                      state === 'done' ? 'bg-teal-600 text-white' : state === 'current' ? 'bg-amber-500 text-white' : 'bg-earth-border text-earth-ink2'}`}>
                      {state === 'done' ? '✓' : i + 1}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </span>
                  <span className="block text-[11px] text-earth-ink3 mt-0.5 truncate">{s.note}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="px-5 pb-4 flex flex-wrap gap-2">
          <button className={btn.ghost} onClick={() => onGo('bottles', g)}>📦 รับขวด</button>
          <button className={btn.ghost} onClick={() => onGo('mix', g)}>⚗️ ผสมตัวอย่าง</button>
        </div>
      </Section>

      <Section title="ขวดผสมของตัวอย่างนี้" subtitle="คลิกเพื่อไปบันทึกผล / เลือกผล final">
        {comps.length === 0 ? <Empty>ยังไม่มีขวดผสม</Empty> : (
          <ul className="divide-y divide-earth-border">
            {comps.map(c => {
              const st = STAGE_BY_KEY[compositeStage(c)];
              return (
                <li key={c.id} className="px-5 py-3 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold text-earth-ink flex items-center gap-2 flex-wrap">
                      ⚗️ ใบที่ {c.seq} <span className="text-xs font-normal text-earth-ink2">{c.n_bottles} ขวด</span>
                      <span className="text-[11px] font-semibold flex items-center gap-1 text-earth-ink2"><span className={`w-2 h-2 rounded-full ${st.dot}`} />{st.label}</span>
                      {c.final_attempt_id && <VerdictBadge verdict={c.verdict} />}
                      {c.case && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">เคส #{c.case.id} · คงเหลือ {fmtNum(c.case.remaining_kg)} kg</span>}
                      {c.memo_doc_no && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{c.memo_doc_no}</span>}
                    </p>
                    <span className="flex flex-wrap gap-1">{c.tickets.map(t => <TicketLink key={t} ticket1={t} />)}</span>
                    {c.note && <p className="text-xs text-earth-ink3">“{c.note}”</p>}
                    <span className="flex flex-wrap gap-1">
                      <ByTag icon="⚗️" label="ผสมโดย " name={c.created_by} ts={c.created_at} />
                      {c.final_attempt_id && <ByTag icon="★" label="final โดย " name={c.finalized_by} ts={c.finalized_at} tone="teal" />}
                    </span>
                  </div>
                  <button className={btn.ghost} onClick={() => onOpenComposite(c)}>🔬 ผลวิเคราะห์</button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
