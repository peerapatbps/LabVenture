import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, put } from '../../api.js';
import { CHEM_STYLE, fmtNum, fmtTs } from '../../config/chemLab.js';
import { Section, ChemBadge, TicketLink, ErrorLine, ReasonModal, Empty, DateBar, CompositeChip, ByTag, btn, inputCls } from './shared.jsx';

// Step 1 — receiving bottles (1 trip = 1 bottle). Mixing is a separate tab.
// A bottle can be changed until a composite holding it has a final result (changes to saved rows need a reason).
export default function BottlesTab({ date, onDate, canWrite, focus, onMix }) {
  const [chem, setChem] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'bottles', date],
    queryFn: () => get(`/api/chem-lab/bottles?date=${date}`),
  });
  const groups = (data?.groups || []).filter(g => !chem || g.chemical === chem);

  return (
    <div className="space-y-4">
      <Section title="รับขวดตัวอย่าง" subtitle="1 เที่ยวรถ = 1 ขวด — บันทึกว่าได้รับขวดหรือไม่ แล้วไปผสมที่แท็บ “ผสมตัวอย่าง”"
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
        <BottleGroup key={`${g.chemical}|${g.company}`} date={date} g={g} canWrite={canWrite} onMix={onMix}
          highlight={focus && focus.chemical === g.chemical && focus.company === g.company} />
      ))}
    </div>
  );
}

export function ChemFilter({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[['', 'ทุกสาร'], ...Object.entries(CHEM_STYLE).map(([k, s]) => [k, s.label])].map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold ${value === k ? 'bg-teal-700 text-white' : 'bg-earth-card text-earth-ink2'}`}>{l}</button>
      ))}
    </div>
  );
}

function BottleGroup({ date, g, canWrite, onMix, highlight }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({}); // ticket1 → { status, remark }
  const [askReason, setAskReason] = useState(false);
  useEffect(() => { setDraft({}); }, [g]);
  useEffect(() => {
    if (highlight) document.getElementById(`bottles-${g.chemical}-${g.company}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [highlight, g.chemical, g.company]);

  const saved = useMemo(() => Object.fromEntries(g.rows.map(r => [r.ticket1, r.bottle])), [g]);
  const changes = Object.entries(draft).filter(([t, d]) => {
    const b = saved[t];
    return !b || b.status !== d.status || (b.remark || '') !== (d.remark || '');
  });
  const needsReason = changes.some(([t]) => saved[t]);

  const saveM = useMutation({
    mutationFn: (reason) => put('/api/chem-lab/bottles', {
      items: changes.map(([ticket1, d]) => ({ ticket1, status: d.status, remark: d.remark || null })),
      reason: reason || undefined,
    }),
    onSuccess: () => { setAskReason(false); qc.invalidateQueries({ queryKey: ['chem-lab'] }); },
  });

  function setRow(ticket1, patch) {
    setDraft(d => {
      const base = d[ticket1] || { status: saved[ticket1]?.status || null, remark: saved[ticket1]?.remark || '' };
      return { ...d, [ticket1]: { ...base, ...patch } };
    });
  }
  function markAllPending() {
    setDraft(d => {
      const next = { ...d };
      for (const r of g.rows) if (!r.bottle) next[r.ticket1] = { status: 'received', remark: next[r.ticket1]?.remark || '' };
      return next;
    });
  }
  const s = CHEM_STYLE[g.chemical];

  return (
    <div id={`bottles-${g.chemical}-${g.company}`}>
      <Section className={highlight ? 'ring-2 ring-teal-400' : ''}
        title={<span className="flex items-center gap-2 flex-wrap"><ChemBadge chemical={g.chemical} /> {g.company_name}</span>}
        subtitle={`${g.expected} เที่ยว · ได้รับ ${g.received} · ไม่ได้รับ ${g.not_received} · ยังไม่บันทึก ${g.pending}${g.composites.length ? ` · ขวดผสม ${g.composites.length} ใบ` : ''}`}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            {canWrite && g.pending > 0 && <button className={btn.ghost} onClick={markAllPending}>รับทั้งหมดที่ยังไม่บันทึก</button>}
            {g.received > 0 && onMix && (
              <button className={g.unmixed > 0 ? btn.primary : btn.ghost} onClick={() => onMix(g)}>
                ⚗️ ไปผสม{g.unmixed > 0 ? ` (ยังไม่ผสม ${g.unmixed} ขวด)` : ''}
              </button>
            )}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[900px]">
            <thead>
              <tr className={`${s?.header || 'bg-gray-600'} text-white text-xs uppercase tracking-wide`}>
                <th className="text-left px-3 py-2">Track ID</th>
                <th className="text-left px-3 py-2">ทะเบียน</th>
                <th className="text-left px-3 py-2">เข้า – ออก</th>
                <th className="text-right px-3 py-2">สุทธิ (kg)</th>
                <th className="text-left px-3 py-2">ถ.พ. / °C</th>
                <th className="text-left px-3 py-2">ใบนำส่ง</th>
                <th className="text-left px-3 py-2 w-60">ขวดตัวอย่าง</th>
                <th className="text-left px-3 py-2">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map(r => {
                const d = draft[r.ticket1];
                const status = d ? d.status : r.bottle?.status || null;
                const remark = d ? d.remark : r.bottle?.remark || '';
                const dirty = changes.some(([t]) => t === r.ticket1);
                const locked = !!r.bottle?.locked;
                const rowEditable = canWrite && !locked;
                const seqs = r.bottle?.composite_seqs || [];
                return (
                  <tr key={r.ticket1} className={`border-b border-earth-border ${dirty ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-2">
                      <TicketLink ticket1={r.ticket1} />
                      {seqs.length > 0 && <span className="flex flex-wrap gap-1 mt-0.5">{seqs.map(n => <CompositeChip key={n} c={n} />)}</span>}
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-earth-ink">{r.plate}</td>
                    <td className="px-3 py-2 text-earth-ink2 whitespace-nowrap">{r.tmin?.slice(0, 5)} – {r.tmout?.slice(0, 5)}{r.dayout !== r.dayin && <span className="text-xs text-amber-600"> (+1)</span>}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-earth-ink">{fmtNum(r.net_kg)}</td>
                    {r.sidecar ? (
                      <>
                        <td className="px-3 py-2 font-mono text-earth-ink2">{r.sidecar.sg ?? '—'} / {r.sidecar.temp_c ?? '—'}</td>
                        <td className="px-3 py-2 text-earth-ink2">{r.sidecar.bill_book ? `${r.sidecar.bill_book}/` : ''}{r.sidecar.bill_no || '—'}</td>
                      </>
                    ) : (
                      <td colSpan={2} className="px-3 py-2"><span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">ไม่มีบันทึก sidecar</span></td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {[['received', 'ได้รับ', 'bg-teal-600 text-white border-teal-600'], ['not_received', 'ไม่ได้รับ', 'bg-red-600 text-white border-red-600']].map(([v, label, on]) => (
                          <button key={v} type="button" disabled={!rowEditable}
                            onClick={() => setRow(r.ticket1, { status: v })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${status === v ? on : 'border-earth-border text-earth-ink2 bg-white/50'} disabled:opacity-60 disabled:cursor-not-allowed`}>
                            {label}
                          </button>
                        ))}
                        {locked && <span className="text-[11px]" title="อยู่ในขวดผสมที่เลือกผล final แล้ว">🔒</span>}
                      </div>
                      {r.bottle && (
                        <span className="flex flex-wrap gap-1 mt-1">
                          <ByTag icon="📦" name={r.bottle.received_by} ts={r.bottle.received_at} />
                          {r.bottle.updated_at !== r.bottle.received_at && <span className="text-[10px] text-earth-ink3">แก้ {r.bottle.updated_by} · {fmtTs(r.bottle.updated_at)}</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input className={`${inputCls} py-1`} value={remark} disabled={!rowEditable}
                        onChange={e => setRow(r.ticket1, { remark: e.target.value, status: status || 'received' })}
                        placeholder={status === 'not_received' ? 'ระบุสาเหตุ' : ''} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 flex items-center justify-end gap-3 flex-wrap">
          <ErrorLine error={saveM.error} />
          {canWrite && changes.length > 0 && (
            <>
              <span className="text-sm text-earth-ink2">แก้ไข {changes.length} ขวด{needsReason ? ' (มีรายการที่บันทึกแล้ว — จะถามยืนยันก่อน)' : ''}</span>
              <button className={btn.ghost} onClick={() => setDraft({})}>ล้าง</button>
              <button className={btn.primary} disabled={saveM.isPending || changes.some(([, d]) => !d.status)}
                onClick={() => (needsReason ? setAskReason(true) : saveM.mutate(null))}>
                {saveM.isPending ? 'กำลังบันทึก...' : 'บันทึกการรับขวด'}
              </button>
            </>
          )}
        </div>
        {askReason && (
          <ReasonModal title="แก้ไขการรับขวดที่บันทึกแล้ว"
            message="ขวดที่เปลี่ยนเป็น “ไม่ได้รับ” จะถูกนำออกจากขวดผสมที่ยังไม่มีผลวิเคราะห์ — การแก้ไขบันทึกใน audit"
            pending={saveM.isPending} error={saveM.error}
            onClose={() => setAskReason(false)} onConfirm={(reason) => saveM.mutate(reason)} />
        )}
      </Section>
    </div>
  );
}
