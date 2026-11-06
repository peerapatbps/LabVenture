import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../api.js';
import { STAGES, stageOf, groupKey, fmtNum, CHEM_STYLE } from '../../config/chemLab.js';
import { Section, ChemBadge, VerdictBadge, ErrorLine, Empty, inputCls } from './shared.jsx';

const COLUMN_LIMIT = 12; // cards shown per column before "show more"

// Board of every sample group (day × chemical × company) in the date range, one column per stage
export default function PipelineBoard({ from, to, onRange, onOpen }) {
  const [chem, setChem] = useState('');
  const [expanded, setExpanded] = useState({});
  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'pipeline', from, to],
    queryFn: () => get(`/api/chem-lab/pipeline?from=${from}&to=${to}`),
  });

  const columns = useMemo(() => {
    const cols = Object.fromEntries(STAGES.map(s => [s.key, []]));
    for (const g of data?.groups || []) {
      if (chem && g.chemical !== chem) continue;
      cols[stageOf(g)].push(g);
    }
    return cols;
  }, [data, chem]);
  const needAction = (columns.receive.length + columns.ready.length + columns.testing.length);

  return (
    <div className="space-y-4">
      <Section
        title="ภาพรวมตัวอย่างสารเคมี"
        subtitle="1 การ์ด = ตัวอย่างของวัน × สาร × บริษัท (อาจมีขวดผสมหลายใบ — การ์ดอยู่ในคอลัมน์ของใบที่ช้าที่สุด) — คลิกเพื่อดูขั้นตอน"
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" className={inputCls.replace("w-full", "w-auto")} value={from} onChange={e => onRange({ from: e.target.value, to })} />
            <span className="text-earth-ink3">–</span>
            <input type="date" className={inputCls.replace("w-full", "w-auto")} value={to} onChange={e => onRange({ from, to: e.target.value })} />
            <div className="flex gap-1">
              {[['', 'ทุกสาร'], ...Object.entries(CHEM_STYLE).map(([k, s]) => [k, s.label])].map(([k, l]) => (
                <button key={k} onClick={() => setChem(k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold ${chem === k ? 'bg-teal-700 text-white' : 'bg-earth-card text-earth-ink2'}`}>{l}</button>
              ))}
            </div>
          </div>
        }
      >
        {isLoading && <Empty>กำลังโหลด...</Empty>}
        {error && <div className="p-5"><ErrorLine error={error} /></div>}
        {!isLoading && !error && (
          <p className="px-5 py-3 text-sm text-earth-ink2">
            ทั้งหมด {data?.groups?.length || 0} ตัวอย่าง · ต้องดำเนินการ {needAction} · เคสชดเชยเปิด {columns.case.length}
          </p>
        )}
      </Section>

      {!isLoading && !error && (
        <div className="flex gap-3 overflow-x-auto pb-2 items-start">
          {STAGES.map(s => {
            const list = columns[s.key];
            const shown = expanded[s.key] ? list : list.slice(0, COLUMN_LIMIT);
            return (
              <div key={s.key} className={`rounded-2xl bg-earth-card/60 border border-earth-border border-t-4 ${s.head} w-64 shrink-0 xl:w-auto xl:flex-1 xl:min-w-0`}>
                <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-earth-ink flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded-full ${s.dot} text-white text-[11px] flex items-center justify-center shrink-0`}>{s.no}</span>
                      <span className="truncate">{s.label}</span>
                    </p>
                    <p className="text-[11px] text-earth-ink3 truncate">{s.hint}</p>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-earth text-earth-ink2">{list.length}</span>
                </div>
                <div className="px-2 pb-2 space-y-2 max-h-[65vh] overflow-y-auto">
                  {list.length === 0 && <p className="text-center text-xs text-earth-ink3 py-4">—</p>}
                  {shown.map(g => <GroupCard key={groupKey(g.date, g.chemical, g.company)} g={g} stage={s.key} onClick={() => onOpen(g)} />)}
                  {list.length > COLUMN_LIMIT && (
                    <button className="w-full text-xs font-semibold text-teal-700 py-1.5 hover:underline"
                      onClick={() => setExpanded(x => ({ ...x, [s.key]: !x[s.key] }))}>
                      {expanded[s.key] ? 'ย่อ' : `แสดงอีก ${list.length - COLUMN_LIMIT}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupCard({ g, stage, onClick }) {
  const comps = g.composites || [];
  const finals = comps.filter(c => c.final_attempt_id);
  const fails = finals.filter(c => c.verdict === 'fail').length;
  const ext = comps.reduce((s, c) => s + (c.ext_pending || 0), 0);
  const remaining = comps.filter(c => c.case?.status === 'open').reduce((s, c) => s + c.case.remaining_kg, 0);
  const memoNos = [...new Set(comps.map(c => c.memo_doc_no).filter(Boolean))];
  const warns = [];
  if (g.pending > 0) warns.push({ text: `ยังไม่บันทึกขวด ${g.pending}`, cls: 'bg-amber-100 text-amber-800' });
  if (g.unmixed > 0 && comps.length > 0) warns.push({ text: `ยังไม่ผสม ${g.unmixed} ขวด`, cls: 'bg-orange-100 text-orange-700' });
  if (ext > 0) warns.push({ text: `ส่ง Lab รอผล ${ext}`, cls: 'bg-violet-100 text-violet-700' });
  if (remaining > 0) warns.push({ text: `ชดเชยคงเหลือ ${fmtNum(remaining)} kg`, cls: 'bg-red-100 text-red-700' });
  return (
    <button onClick={onClick}
      className="w-full text-left rounded-xl bg-earth border border-earth-border px-3 py-2.5 hover:border-teal-600 hover:shadow-sm transition">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm text-earth-ink">{g.date}</span>
        {finals.length > 0 && stage !== 'receive' && <VerdictBadge verdict={fails ? 'fail' : finals.length === comps.length ? 'pass' : 'pending'} />}
      </div>
      <div className="flex items-center gap-1.5 mt-1 min-w-0">
        <ChemBadge chemical={g.chemical} />
        <span className="text-xs text-earth-ink2 truncate">{g.company_name}</span>
      </div>
      <p className="text-[11px] text-earth-ink3 mt-1">
        ขวด {g.received}/{g.expected}{comps.length ? ` · ผสม ${comps.length} ใบ` : ''}{comps.length ? ` · final ${finals.length}/${comps.length}` : ''}
        {memoNos.length ? ` · ${memoNos.join(', ')}` : ''}
      </p>
      {warns.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {warns.map(w => <span key={w.text} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${w.cls}`}>{w.text}</span>)}
        </div>
      )}
    </button>
  );
}
