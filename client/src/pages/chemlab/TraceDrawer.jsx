import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../api.js';
import { fmtNum, fmtTs, TEST_SOURCE } from '../../config/chemLab.js';
import { ChemBadge, VerdictBadge, CaseBadge, ErrorLine } from './shared.jsx';

// Full trace of one trip (TICKET1): scale → sidecar → bottle → composite/attempts → cases → offsets
export default function TraceDrawer({ ticket1, onClose, onOpenComposite, onOpenCase }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'trace', ticket1],
    queryFn: () => get(`/api/chem-lab/trace/${encodeURIComponent(ticket1)}`),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="w-full max-w-md h-full bg-earth shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-earth-card border-b border-earth-border px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-earth-ink2">สอบกลับเที่ยวรถ</p>
            <h3 className="font-bold text-lg text-earth-ink font-mono">{ticket1}</h3>
          </div>
          <button onClick={onClose} className="text-2xl text-earth-ink3 hover:text-earth-ink" aria-label="ปิด">×</button>
        </div>
        {isLoading && <p className="p-5 text-earth-ink3">กำลังโหลด...</p>}
        <div className="px-5"><ErrorLine error={error} /></div>
        {data && (
          <div className="p-5 space-y-5 text-sm">
            <Step n="1" title="ตาชั่ง (WDATA)">
              {data.trip ? (
                <Grid rows={[
                  ['สาร', <ChemBadge chemical={data.trip.chemical} />], ['บริษัท', data.trip.company_name], ['ทะเบียน', data.trip.plate],
                  ['เข้า', `${data.trip.dayin} ${data.trip.tmin}`], ['ออก', `${data.trip.dayout} ${data.trip.tmout}`],
                  ['W1 / W2', `${fmtNum(data.trip.w1)} / ${fmtNum(data.trip.w2)} kg`], ['สุทธิ', `${fmtNum(data.trip.net_kg)} kg`],
                  ['TICKET2', data.trip.ticket2],
                ]} />
              ) : <Missing>ไม่พบใน WDATA (ยังไม่ชั่งออก หรือถูกยกเลิก)</Missing>}
            </Step>
            <Step n="2" title="บันทึกหน้างาน (Sidecar)">
              {data.sidecar ? (
                <Grid rows={[
                  ['ถ.พ. / อุณหภูมิ', `${data.sidecar.sg ?? '—'} / ${data.sidecar.temp_c ?? '—'} °C`],
                  ['ใบนำส่ง', `${data.sidecar.bill_book || '—'} / ${data.sidecar.bill_no || '—'}`],
                  ['ถัง', data.sidecar.fills.map(f => `${f.tank} ${f.before ?? '?'}→${f.after ?? '?'}`).join(', ') || '—'],
                  ['ผู้บันทึก', data.sidecar.created_by], ['ครบถ้วน', data.sidecar.is_complete ? 'ใช่' : 'ยังไม่ครบ'],
                ]} />
              ) : <Missing>ไม่มีบันทึก sidecar</Missing>}
            </Step>
            <Step n="3" title="ขวดตัวอย่าง">
              {data.bottle ? (
                <Grid rows={[
                  ['สถานะ', data.bottle.status === 'received' ? '✓ ได้รับ' : '✗ ไม่ได้รับ'], ['หมายเหตุ', data.bottle.remark || '—'],
                  ['รับโดย', `${data.bottle.received_by} · ${fmtTs(data.bottle.received_at)}`],
                  ['แก้ไขล่าสุด', `${data.bottle.updated_by} · ${fmtTs(data.bottle.updated_at)}`],
                ]} />
              ) : <Missing>ยังไม่บันทึกรับขวด</Missing>}
              {data.audit.length > 1 && (
                <ul className="mt-2 text-xs text-earth-ink3 space-y-0.5">
                  {data.audit.map(a => <li key={a.id}>{fmtTs(a.ts)} · {a.user} · {a.action}{a.reason ? ` — ${a.reason}` : ''}</li>)}
                </ul>
              )}
            </Step>
            <Step n="4" title="ขวดผสม / ผลวิเคราะห์">
              {data.composites?.length ? data.composites.map(c => (
                <div key={c.id} className="mb-3">
                  <button className="text-teal-700 font-semibold hover:underline" onClick={() => onOpenComposite(c)}>
                    ⚗️ ใบที่ {c.seq} · {c.sample_date} · {c.n_bottles} ขวด
                  </button>{' '}{c.final_attempt_id ? <VerdictBadge verdict={c.verdict} /> : <span className="text-xs text-amber-700">ยังไม่มี final</span>}
                  <p className="text-[11px] text-earth-ink3">ผสมโดย {c.created_by} · {fmtTs(c.created_at)}{c.finalized_by ? ` · final โดย ${c.finalized_by}` : ''}</p>
                  <ul className="mt-1 space-y-1">
                    {c.attempts_list.map(a => (
                      <li key={a.id} className="text-xs text-earth-ink2">
                        #{a.attempt_no} {TEST_SOURCE[a.test_source]?.short}{a.ext_lab ? ` (${a.ext_lab})` : ''} · {a.tested_by} · {fmtTs(a.tested_at)} <VerdictBadge verdict={a.verdict} />
                        {c.final_attempt_id === a.id && <span className="text-teal-700 font-semibold"> ★ final</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )) : <Missing>ยังไม่ถูกผสม</Missing>}
            </Step>
            <Step n="5" title="เคสชดเชย / การตัดยอด">
              {data.cases.length === 0 && data.offsets_applied.length === 0 && <Missing>—</Missing>}
              {data.cases.map(c => (
                <p key={c.id}>
                  <button className="text-teal-700 font-semibold hover:underline" onClick={() => onOpenCase(c.id)}>🚩 เคส #{c.id}</button>{' '}
                  <CaseBadge status={c.status} /> · เป้า {fmtNum(c.target_kg)} kg · คงเหลือ {fmtNum(c.remaining_kg)} kg
                </p>
              ))}
              {data.offsets_applied.map(o => (
                <p key={o.id} className="text-xs text-earth-ink2">
                  ถูกตัดยอดชดเชยให้เคส #{o.case_id}: −{fmtNum(o.offset_kg)} kg · {o.by_user} · {fmtTs(o.at)}
                </p>
              ))}
            </Step>
          </div>
        )}
      </aside>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="relative pl-8">
      <span className="absolute left-0 top-0 w-6 h-6 rounded-full bg-teal-700 text-white text-xs font-bold flex items-center justify-center">{n}</span>
      <p className="font-semibold text-earth-ink mb-1.5">{title}</p>
      {children}
    </div>
  );
}
function Grid({ rows }) {
  return (
    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
      {rows.map(([k, v]) => <React.Fragment key={k}><dt className="text-earth-ink3">{k}</dt><dd className="text-earth-ink">{v ?? '—'}</dd></React.Fragment>)}
    </dl>
  );
}
function Missing({ children }) {
  return <p className="text-xs font-semibold text-orange-600">{children}</p>;
}
