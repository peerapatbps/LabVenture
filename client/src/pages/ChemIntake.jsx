import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api.js';
import { isSuperadmin, hasRole } from '../config/pageAccess.js';
import { TABS, LEGACY_TABS, todayTH, addDays, groupKey, parseGroupKey } from '../config/chemLab.js';
import { TraceContext, useLabMe, useLabSpec } from './chemlab/shared.jsx';
import PipelineBoard from './chemlab/PipelineBoard.jsx';
import WorkflowDetail from './chemlab/WorkflowDetail.jsx';
import BottlesTab from './chemlab/BottlesTab.jsx';
import MixTab from './chemlab/MixTab.jsx';
import AnalysisTab from './chemlab/AnalysisTab.jsx';
import ExternalTab from './chemlab/ExternalTab.jsx';
import MemoTab from './chemlab/MemoTab.jsx';
import CasesTab from './chemlab/CasesTab.jsx';
import OffsetTab from './chemlab/OffsetTab.jsx';
import TraceDrawer from './chemlab/TraceDrawer.jsx';

// /chem-intake — Chemical lab QC (HACCP 5.3–5.11). Operator receiving of trucks happens in TruckSidecar.
// Tabs follow the people doing each step: รับขวด → ผสมตัวอย่าง (many composites per sample, may overlap) →
// ผลวิเคราะห์ (in-house, final per composite) / Lab ภายนอก → (เคสชดเชย) → สคบ-14. Every step can be undone with a reason;
// state lives in Uroboros chemlab.db via /api/chem-lab/* (see handoff/chem_lab_backend_spec.md).
export default function ChemIntake() {
  const [params, setParams] = useSearchParams();
  const [trace, setTrace] = useState(null);
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => get('/api/auth/me') });
  const { data: labMe } = useLabMe();
  const { data: spec } = useLabSpec();
  const { data: openCases } = useQuery({ queryKey: ['chem-lab', 'cases', 'open'], queryFn: () => get('/api/chem-lab/cases?status=open') });
  const { data: extPending } = useQuery({ queryKey: ['chem-lab', 'ext-sends', 'sent', 'all'], queryFn: () => get('/api/chem-lab/ext-sends?status=sent') });

  const role = labMe?.actor?.role ?? me?.role ?? null;
  const superadmin = isSuperadmin(me) || !!labMe?.actor?.isSuperadmin;
  const tabs = TABS.filter(t => role === null || superadmin || hasRole({ role }, t.roles));
  const defaultTab = role === 'operator' && !superadmin ? 'offset' : 'pipeline';
  const asked = LEGACY_TABS[params.get('tab')] || params.get('tab');
  const tab = tabs.some(t => t.key === asked) ? asked : defaultTab;
  const today = todayTH();
  const from = params.get('from') || addDays(today, -13);
  const to = params.get('to') || today;
  const date = params.get('date') || today;
  const aFrom = params.get('afrom') || addDays(today, -6);
  const aTo = params.get('ato') || today;
  const xFrom = params.get('xfrom') || today;
  const xTo = params.get('xto') || today;
  const group = parseGroupKey(params.get('g'));
  const compositeId = params.get('c') ? Number(params.get('c')) : null;
  const caseId = params.get('case') ? Number(params.get('case')) : null;

  function go(next) {
    setParams(p => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(next)) { if (v == null) n.delete(k); else n.set(k, String(v)); }
      return n;
    });
  }
  const openGroup = (g) => go({ tab: 'pipeline', g: groupKey(g.date, g.chemical, g.company) });
  // c = composite summary (has sample_date) or a bare id
  const openComposite = (c) => {
    setTrace(null);
    const id = typeof c === 'object' ? c.id : c;
    const d = typeof c === 'object' ? c.sample_date : null;
    go({ tab: 'analysis', c: id, ...(d && (d < aFrom || d > aTo) ? { afrom: d, ato: d } : {}) });
  };
  const openCase = (id) => { setTrace(null); go({ tab: 'cases', case: id }); };
  const goStep = (t, g) => go({ tab: t, date: g.date || group?.date, g: groupKey(g.date || group?.date, g.chemical, g.company) });
  const traceCtx = useMemo(() => ({ openTrace: setTrace }), []);

  const canSci = !!labMe?.can_sci_write;
  const canOffset = !!labMe?.can_offset;
  const openCount = openCases?.cases?.length || 0;
  const offsetPending = (openCases?.cases || []).filter(c => c.remaining_kg > 0).length;
  const extCount = extPending?.sends?.length || 0;
  const focus = group && group.date === date ? group : null;

  return (
    <TraceContext.Provider value={traceCtx}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-earth-ink">รับสารเคมี · ตรวจรับคุณภาพ</h1>
            <p className="text-sm text-earth-ink2 mt-0.5">รับขวด → ผสมตัวอย่าง → ผลวิเคราะห์ / Lab ภายนอก → ผล final → (เคสชดเชย) → สคบ-14 · ทุกขั้นแก้/ย้อนกลับได้ (บันทึก audit ทุกครั้ง)</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {spec?.mock && <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-violet-100 text-violet-700" title="services.json chem_lab.mock = true">MOCK backend</span>}
            {labMe?.actor && (
              <span className="text-sm px-3 py-1.5 rounded-full border border-earth-border bg-earth text-earth-ink2">
                {labMe.actor.name}{role ? ` · ${role}` : ''}
              </span>
            )}
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-earth-border">
          {tabs.map(t => {
            const badge = t.key === 'cases' ? openCount : t.key === 'offset' ? offsetPending : t.key === 'external' ? extCount : 0;
            return (
              <button key={t.key} onClick={() => go({ tab: t.key, g: null, c: null })}
                className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px flex items-center gap-1.5 ${
                  tab === t.key ? 'border-teal-700 text-teal-800' : 'border-transparent text-earth-ink2 hover:text-earth-ink'}`}>
                <span>{t.icon}</span>{t.label}
                {badge > 0 && <span className={`ml-1 min-w-5 px-1.5 rounded-full text-white text-xs leading-5 text-center ${t.key === 'external' ? 'bg-violet-600' : 'bg-red-600'}`}>{badge}</span>}
              </button>
            );
          })}
        </nav>

        {tab === 'pipeline' && !group && (
          <PipelineBoard from={from} to={to} onRange={(r) => go(r)} onOpen={openGroup} />
        )}
        {tab === 'pipeline' && group && (
          <WorkflowDetail key={params.get('g')} group={group} onBack={() => go({ g: null })} onGo={goStep}
            onOpenComposite={openComposite} onOpenCase={openCase} onOpenMemo={() => go({ tab: 'memo', g: null })} />
        )}
        {tab === 'bottles' && (
          <BottlesTab date={date} onDate={(d) => go({ date: d, g: null })} canWrite={canSci} focus={focus} onMix={(g) => goStep('mix', { ...g, date })} />
        )}
        {tab === 'mix' && (
          <MixTab date={date} onDate={(d) => go({ date: d, g: null })} canWrite={canSci} focus={focus}
            onAnalyze={openComposite} onReceive={(g) => goStep('bottles', { ...g, date })} />
        )}
        {tab === 'analysis' && (
          <AnalysisTab from={aFrom} to={aTo} onRange={(r) => go({ afrom: r.from, ato: r.to })}
            selected={compositeId} onSelect={(id) => go({ c: id })} canWrite={canSci}
            onOpenCase={openCase} onOpenMemo={() => go({ tab: 'memo', c: null })} onMix={() => go({ tab: 'mix', c: null })} />
        )}
        {tab === 'external' && (
          <ExternalTab from={xFrom} to={xTo} onRange={(r) => go({ xfrom: r.from, xto: r.to })} canWrite={canSci} onOpenComposite={openComposite} />
        )}
        {tab === 'memo' && <MemoTab canWrite={canSci} />}
        {tab === 'cases' && <CasesTab caseId={caseId} onSelect={(id) => go({ case: id })} canWrite={canSci} canOffset={canOffset} onOpenComposite={openComposite} />}
        {tab === 'offset' && <OffsetTab canOffset={canOffset} />}

        {trace && <TraceDrawer ticket1={trace} onClose={() => setTrace(null)} onOpenComposite={openComposite} onOpenCase={openCase} />}
      </div>
    </TraceContext.Provider>
  );
}
