import React, { createContext, useContext, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../../api.js';
import { CHEM_STYLE, VERDICT_STYLE, CASE_STATUS, TEST_SOURCE, todayTH, addDays, fmtTs } from '../../config/chemLab.js';

export const TraceContext = createContext({ openTrace: () => {} });

export function useLabSpec() {
  return useQuery({ queryKey: ['chem-lab', 'spec'], queryFn: () => get('/api/chem-lab/spec'), staleTime: 60_000 });
}

export function useLabMe() {
  return useQuery({ queryKey: ['chem-lab', 'me'], queryFn: () => get('/api/chem-lab/me'), staleTime: 60_000 });
}

// Dropdown + "+" button to add a new name to a shared list (kind: 'labs' | 'doc_locations').
export function OptionPicker({ kind, value, onChange, placeholder = '— เลือก —', addLabel = 'เพิ่มชื่อ', autoFocus }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['chem-lab', 'options'], queryFn: () => get('/api/chem-lab/options'), staleTime: 60_000 });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const add = useMutation({
    mutationFn: () => post(`/api/chem-lab/options/${kind}`, { name: draft.trim() }),
    onSuccess: r => {
      qc.setQueryData(['chem-lab', 'options'], r);
      onChange(r.added);
      setDraft('');
      setAdding(false);
    },
  });
  const list = data?.[kind] || [];
  // keep an old value that is not in the list yet (e.g. editing an older record)
  const options = value && !list.includes(value) ? [value, ...list] : list;

  if (adding) {
    const save = () => draft.trim() && !add.isPending && add.mutate();
    return (
      <div className="space-y-1">
        <div className="flex gap-2">
          <input className={inputCls} value={draft} autoFocus placeholder={addLabel}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') setAdding(false); }} />
          <button type="button" className={btn.primary} disabled={!draft.trim() || add.isPending} onClick={save}>
            {add.isPending ? '...' : 'เพิ่ม'}
          </button>
          <button type="button" className={btn.ghost} onClick={() => { setAdding(false); setDraft(''); }}>ยกเลิก</button>
        </div>
        <ErrorLine error={add.error} />
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value)} autoFocus={autoFocus}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <button type="button" className={`${btn.ghost} shrink-0 font-bold`} title={addLabel} aria-label={addLabel}
        onClick={() => setAdding(true)}>+</button>
    </div>
  );
}

export function Section({ title, subtitle, right, children, className = '' }) {
  return (
    <section className={`bg-earth border border-earth-border rounded-2xl shadow-sm overflow-hidden ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-b border-earth-border">
          <div>
            {title && <h2 className="font-bold text-lg text-earth-ink">{title}</h2>}
            {subtitle && <p className="text-sm text-earth-ink2 mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function ChemBadge({ chemical }) {
  const s = CHEM_STYLE[chemical] || { label: chemical, pill: 'bg-earth-card text-earth-ink2 border-earth-border', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full border ${s.pill}`}>
      <span className={`w-2 h-2 rounded-full ${s.dot}`} />{s.label}
    </span>
  );
}

export function VerdictBadge({ verdict }) {
  const s = VERDICT_STYLE[verdict] || VERDICT_STYLE.pending;
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

export function CaseBadge({ status }) {
  const s = CASE_STATUS[status] || CASE_STATUS.open;
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

export function TicketLink({ ticket1 }) {
  const { openTrace } = useContext(TraceContext);
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); openTrace(ticket1); }}
      className="font-mono text-sm text-teal-700 hover:underline" title="ดูการสอบกลับทั้งหมด">
      {ticket1}
    </button>
  );
}

export function ErrorLine({ error }) {
  if (!error) return null;
  return <p className="text-sm text-red-600 font-semibold">{error.message || String(error)}</p>;
}

export const btn = {
  primary: 'px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed',
  ghost:   'px-4 py-2 text-sm font-semibold rounded-lg bg-earth-card text-earth-ink2 hover:bg-earth-border disabled:opacity-40 disabled:cursor-not-allowed',
  danger:  'px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed',
};
export const inputCls = 'w-full border border-earth-border rounded-lg px-3 py-2 text-sm bg-white/60 focus:outline-none focus:ring-2 focus:ring-teal-500';

// Confirm modal with an optional reason (edits after the first save, undo steps, override) — never required.
// consequences: [{ text, block? }] — what the action will also do; any `block` disables confirm (do that step first).
export function ReasonModal({ title, message, consequences = [], confirmLabel = 'ยืนยัน', danger, onConfirm, onClose, pending, error }) {
  const [reason, setReason] = useState('');
  const blocked = consequences.some(c => c.block);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="p-5 space-y-3">
        {message && <p className="text-sm text-earth-ink2">{message}</p>}
        {consequences.length > 0 && (
          <ul className="space-y-1.5">
            {consequences.map((c, i) => (
              <li key={i} className={`text-sm rounded-lg px-3 py-2 border ${c.block ? 'bg-red-50 border-red-300 text-red-700 font-semibold' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
                {c.block ? '⛔ ' : '⚠ '}{c.text}
              </li>
            ))}
          </ul>
        )}
        {!blocked && <textarea className={inputCls} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="เหตุผล / หมายเหตุ (ไม่บังคับ — บันทึกใน audit)" autoFocus />}
        <ErrorLine error={error} />
      </div>
      <div className="px-5 py-4 border-t border-earth-border flex justify-end gap-2">
        <button className={btn.ghost} onClick={onClose}>ปิด</button>
        <button className={danger ? btn.danger : btn.primary} disabled={blocked || pending} onClick={() => onConfirm(reason.trim() || null)}>
          {pending ? 'กำลังบันทึก...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`bg-earth rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] flex flex-col overflow-hidden`}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-earth-border flex items-center justify-between">
          <h3 className="font-bold text-lg text-earth-ink">{title}</h3>
          <button onClick={onClose} className="text-earth-ink3 hover:text-earth-ink text-xl leading-none" aria-label="ปิด">×</button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }) {
  return <p className="px-5 py-10 text-center text-earth-ink3">{children}</p>;
}

// One day picker with ‹ วันนี้ › shortcuts
export function DateBar({ date, onChange, label = 'วันที่ส่ง' }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-sm text-earth-ink2">{label}</span>
      <button className={`${btn.ghost} px-2.5`} onClick={() => onChange(addDays(date, -1))} aria-label="วันก่อน">‹</button>
      <input type="date" className={inputCls.replace('w-full', 'w-auto')} value={date} onChange={e => e.target.value && onChange(e.target.value)} />
      <button className={`${btn.ghost} px-2.5`} onClick={() => onChange(addDays(date, 1))} aria-label="วันถัดไป">›</button>
      {date !== todayTH() && <button className="text-xs font-semibold text-teal-700 hover:underline px-1" onClick={() => onChange(todayTH())}>วันนี้</button>}
    </div>
  );
}

export function RangeBar({ from, to, onChange, label }) {
  const cls = inputCls.replace('w-full', 'w-auto');
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {label && <span className="text-sm text-earth-ink2">{label}</span>}
      <input type="date" className={cls} value={from} onChange={e => e.target.value && onChange({ from: e.target.value, to })} />
      <span className="text-earth-ink3">–</span>
      <input type="date" className={cls} value={to} onChange={e => e.target.value && onChange({ from, to: e.target.value })} />
      {(from !== todayTH() || to !== todayTH()) && (
        <button className="text-xs font-semibold text-teal-700 hover:underline px-1" onClick={() => onChange({ from: todayTH(), to: todayTH() })}>วันนี้</button>
      )}
    </div>
  );
}

// "ใบที่ 2" pill
export function CompositeChip({ c, active, onClick }) {
  const cls = `text-[11px] font-bold px-2 py-0.5 rounded-full border ${active ? 'bg-teal-700 text-white border-teal-700' : 'bg-sky-50 text-sky-800 border-sky-300'}`;
  return onClick
    ? <button type="button" className={`${cls} hover:border-teal-600`} onClick={onClick}>ใบที่ {c.seq ?? c}</button>
    : <span className={cls}>ใบที่ {c.seq ?? c}</span>;
}

// "who did it" tag (received by / mixed by / final by)
export function ByTag({ icon = '👤', label, name, ts, tone = 'earth' }) {
  if (!name) return null;
  const tones = {
    earth: 'bg-earth-card text-earth-ink2 border-earth-border',
    teal: 'bg-teal-50 text-teal-800 border-teal-300',
    amber: 'bg-amber-50 text-amber-800 border-amber-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${tones[tone]}`} title={ts || ''}>
      <span>{icon}</span>{label && <span className="font-normal">{label}</span>}{name}{ts && <span className="font-normal opacity-75">· {fmtTs(ts)}</span>}
    </span>
  );
}

export function SourceBadge({ source }) {
  const s = TEST_SOURCE[source];
  const cls = source === 'external_lab' ? 'bg-violet-100 text-violet-700' : source === 'supplier_coa' ? 'bg-stone-200 text-stone-700' : 'bg-sky-100 text-sky-700';
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{s?.short || source}</span>;
}
