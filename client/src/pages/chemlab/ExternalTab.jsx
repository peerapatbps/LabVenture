import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../../api.js';
import { EXT_STATUS, fmtTs } from '../../config/chemLab.js';
import { Section, ChemBadge, ErrorLine, ReasonModal, Empty, RangeBar, TicketLink, btn, useLabSpec } from './shared.jsx';
import { AttemptForm } from './AnalysisTab.jsx';

const STATUS_TABS = [['sent', 'รอผล'], ['resulted', 'ได้ผลแล้ว'], ['cancelled', 'ยกเลิก'], ['', 'ทั้งหมด']];

// External lab results. Composites are sent from the ผลวิเคราะห์ tab; here they wait (filtered by send date,
// today by default) until the result is typed in — it becomes an attempt on that composite.
export default function ExternalTab({ from, to, onRange, canWrite, onOpenComposite }) {
  const qc = useQueryClient();
  const { data: specData } = useLabSpec();
  const [status, setStatus] = useState('sent');
  const [filling, setFilling] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'ext-sends', status, from, to],
    queryFn: () => get(`/api/chem-lab/ext-sends?status=${status}&from=${from}&to=${to}`),
  });
  // every pending send regardless of date, so nothing waiting is missed
  const { data: pendingAll } = useQuery({ queryKey: ['chem-lab', 'ext-sends', 'sent', 'all'], queryFn: () => get('/api/chem-lab/ext-sends?status=sent') });
  const olderPending = (pendingAll?.sends || []).filter(s => s.sent_at?.slice(0, 10) < from).length;

  const cancelM = useMutation({
    mutationFn: ({ s, reason }) => post(`/api/chem-lab/ext-sends/${s.id}/cancel`, { reason }),
    onSuccess: () => { setCancelling(null); qc.invalidateQueries({ queryKey: ['chem-lab'] }); },
  });
  const sends = data?.sends || [];

  return (
    <div className="space-y-4">
      <Section title="ผลจากห้องปฏิบัติการภายนอก" subtitle="ขวดผสมที่ส่ง Lab ภายนอก (ส่งจากแท็บ “ผลวิเคราะห์”) — เลือกรายการเพื่อกรอกผล"
        right={
          <div className="flex items-center gap-3 flex-wrap">
            <RangeBar label="วันที่ส่ง Lab" from={from} to={to} onChange={onRange} />
            <div className="flex gap-1">
              {STATUS_TABS.map(([k, l]) => (
                <button key={k} onClick={() => setStatus(k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold ${status === k ? 'bg-teal-700 text-white' : 'bg-earth-card text-earth-ink2'}`}>{l}</button>
              ))}
            </div>
          </div>
        }>
        {olderPending > 0 && (
          <p className="mx-5 mt-4 text-sm font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
            ⚠ มีรายการรอผลที่ส่งก่อนช่วงวันที่นี้ {olderPending} รายการ
            <button className="text-teal-700 hover:underline" onClick={() => { setStatus('sent'); onRange({ from: '2000-01-01', to }); }}>แสดงทั้งหมด</button>
          </p>
        )}
        {isLoading && <Empty>กำลังโหลด...</Empty>}
        {error && <div className="p-5"><ErrorLine error={error} /></div>}
        {!isLoading && !error && !sends.length && <Empty>ไม่มีรายการ{status ? ` “${EXT_STATUS[status]?.label}”` : ''} ในช่วงวันที่นี้</Empty>}
        {sends.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[820px]">
              <thead>
                <tr className="bg-earth-card text-xs text-earth-ink2">
                  <th className="text-left px-4 py-2 border-b border-earth-border">ส่งเมื่อ</th>
                  <th className="text-left px-3 py-2 border-b border-earth-border">ห้องปฏิบัติการ</th>
                  <th className="text-left px-3 py-2 border-b border-earth-border">ขวดผสม</th>
                  <th className="text-left px-3 py-2 border-b border-earth-border">ผสมจากขวด</th>
                  <th className="text-left px-3 py-2 border-b border-earth-border">สถานะ</th>
                  <th className="px-4 py-2 border-b border-earth-border" />
                </tr>
              </thead>
              <tbody>
                {sends.map(s => {
                  const c = s.composite;
                  return (
                    <tr key={s.id} className={`border-b border-earth-border align-top ${filling?.id === s.id ? 'bg-teal-50' : ''}`}>
                      <td className="px-4 py-2 text-earth-ink2 whitespace-nowrap">{fmtTs(s.sent_at)}<span className="block text-[11px] text-earth-ink3">{s.sent_by}</span></td>
                      <td className="px-3 py-2 font-semibold text-earth-ink">{s.lab_name}{s.note && <span className="block text-[11px] font-normal text-earth-ink3">{s.note}</span>}</td>
                      <td className="px-3 py-2">
                        {c && (
                          <button className="text-left hover:underline" onClick={() => onOpenComposite(c)}>
                            <span className="flex items-center gap-1.5"><ChemBadge chemical={c.chemical} /><span className="text-xs text-earth-ink2">{c.company_name}</span></span>
                            <span className="block font-semibold text-earth-ink">⚗️ ใบที่ {c.seq} <span className="font-normal text-xs text-earth-ink3">· ส่ง {c.sample_date}</span></span>
                          </button>
                        )}
                        {c?.deleted && <span className="text-[11px] text-red-600">ใบผสมถูกลบ</span>}
                      </td>
                      <td className="px-3 py-2"><span className="flex flex-wrap gap-1">{c?.tickets.map(t => <TicketLink key={t} ticket1={t} />)}</span></td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${EXT_STATUS[s.status]?.cls}`}>{EXT_STATUS[s.status]?.label}</span>
                        {s.status === 'resulted' && <span className="block text-[11px] text-earth-ink3">{s.resulted_by} · {fmtTs(s.resulted_at)}</span>}
                        {s.status === 'cancelled' && <span className="block text-[11px] text-red-600">{s.cancel_reason}</span>}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap space-x-1">
                        {canWrite && s.status === 'sent' && c && !c.deleted && (
                          <>
                            <button className={btn.primary} onClick={() => setFilling(filling?.id === s.id ? null : s)}>{filling?.id === s.id ? 'ปิดฟอร์ม' : 'กรอกผล'}</button>
                            <button className="text-xs font-semibold text-red-600 hover:underline px-1" onClick={() => setCancelling(s)}>ยกเลิก</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {filling && specData?.chemicals?.[filling.composite.chemical] && (
        <AttemptForm key={filling.id} spec={specData.chemicals[filling.composite.chemical]} mode="external" defaultLab={filling.lab_name}
          title={`กรอกผล ${filling.lab_name} — ขวดผสมใบที่ ${filling.composite.seq} (${filling.composite.company_name} · ${filling.composite.sample_date})`}
          subtitle="กรอกเฉพาะพารามิเตอร์ที่ Lab รายงาน · ช่องแดง = ไม่ผ่านเกณฑ์ · ช่องเขียว = ผ่านเกณฑ์"
          submit={(body) => post(`/api/chem-lab/ext-sends/${filling.id}/result`, body)}
          onDone={() => { setFilling(null); qc.invalidateQueries({ queryKey: ['chem-lab'] }); }}
          onCancel={() => setFilling(null)} />
      )}
      {cancelling && (
        <ReasonModal title={`ยกเลิกการส่ง ${cancelling.lab_name}`} danger confirmLabel="ยกเลิกรายการ"
          pending={cancelM.isPending} error={cancelM.error}
          onClose={() => setCancelling(null)} onConfirm={(reason) => cancelM.mutate({ s: cancelling, reason })} />
      )}
    </div>
  );
}
