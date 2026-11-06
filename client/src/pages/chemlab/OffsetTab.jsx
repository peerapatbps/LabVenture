import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../../api.js';
import { fmtNum } from '../../config/chemLab.js';
import { Section, ChemBadge, TicketLink, ErrorLine, Modal, Empty, btn, inputCls } from './shared.jsx';
import { CaseListItem, CaseDetail } from './CasesTab.jsx';

// Operator: settle compensation as an accounting offset on later deliveries of the same company
// (e.g. case 6 t → next trip 26 t is billed as 20 t)
export default function OffsetTab({ canOffset }) {
  const [caseId, setCaseId] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'cases', ''],
    queryFn: () => get('/api/chem-lab/cases'),
  });
  // cases still to offset first, then ones already offset (so a wrong offset can be voided)
  const all = (data?.cases || []).filter(c => c.status !== 'cancelled' && (c.remaining_kg > 0 || c.offset_kg > 0));
  const cases = [...all.filter(c => c.remaining_kg > 0), ...all.filter(c => c.remaining_kg <= 0)];
  const selected = caseId ?? cases[0]?.id ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr] items-start">
      <Section title="เคสที่ต้องตัดยอด" subtitle="เคสที่มียอดคงเหลืออยู่บนสุด · เคสที่ตัดครบแล้วยังเปิดดู/ยกเลิกรายการได้">
        {isLoading && <Empty>กำลังโหลด...</Empty>}
        <div className="px-4"><ErrorLine error={error} /></div>
        {!isLoading && cases.length === 0 && <Empty>ไม่มียอดชดเชยค้าง ✓</Empty>}
        <ul className="divide-y divide-earth-border">
          {cases.map(c => <CaseListItem key={c.id} c={c} active={c.id === selected} onClick={() => setCaseId(c.id)} />)}
        </ul>
      </Section>
      {selected
        ? <div className="space-y-4">
            <OffsetPanel key={selected} caseId={selected} canOffset={canOffset} />
            <CaseDetail id={selected} canWrite={false} canOffset={canOffset} compact />
          </div>
        : <Section><Empty>—</Empty></Section>}
    </div>
  );
}

function OffsetPanel({ caseId, canOffset }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(null); // { row, kg }
  const [kgs, setKgs] = useState({});
  const [remark, setRemark] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['chem-lab', 'offset-candidates', caseId],
    queryFn: () => get(`/api/chem-lab/offset-candidates?case_id=${caseId}`),
  });
  const mutation = useMutation({
    mutationFn: ({ row, kg }) => post(`/api/chem-lab/cases/${caseId}/offsets`, { ticket1: row.ticket1, offset_kg: kg, remark: remark || null }),
    onSuccess: () => { setConfirm(null); setKgs({}); setRemark(''); qc.invalidateQueries({ queryKey: ['chem-lab'] }); },
  });

  if (isLoading) return <Section><Empty>กำลังโหลด...</Empty></Section>;
  if (error) return <Section><div className="p-5"><ErrorLine error={error} /></div></Section>;
  const c = data.case;
  const defaultKg = (row) => Math.min(c.remaining_kg, row.available_kg);

  return (
    <Section
      title={<span className="flex items-center gap-2">✂️ ตัดยอดชดเชย เคส #{c.id} <ChemBadge chemical={c.chemical} /></span>}
      subtitle={`${c.company_name} · คงเหลือต้องตัด ${fmtNum(c.remaining_kg)} kg — เลือกเที่ยวส่งของบริษัทเดียวกันหลังวันที่ ${c.sample_date}`}
    >
      {c.remaining_kg <= 0 ? <Empty>ตัดยอดครบแล้ว ✓ — ถ้าตัดผิด ยกเลิกรายการได้ในตารางการตัดยอดด้านล่าง</Empty>
        : data.candidates.length === 0 ? <Empty>ยังไม่มีเที่ยวส่งถัดไปของบริษัทนี้</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[720px]">
            <thead><tr className="bg-earth-card text-xs text-earth-ink2">
              <th className="text-left px-5 py-2">Track ID</th><th className="text-left px-3 py-2">วันที่ส่ง</th><th className="text-left px-3 py-2">ทะเบียน</th>
              <th className="text-right px-3 py-2">สุทธิ (kg)</th><th className="text-right px-3 py-2">ตัดได้ (kg)</th><th className="text-right px-3 py-2 w-40">ตัดชดเชย (kg)</th><th className="px-5 py-2" />
            </tr></thead>
            <tbody>
              {data.candidates.map(r => {
                const kg = kgs[r.ticket1] ?? String(defaultKg(r));
                const n = Number(kg);
                const valid = n > 0 && n <= c.remaining_kg && n <= r.available_kg;
                return (
                  <tr key={r.ticket1} className="border-b border-earth-border">
                    <td className="px-5 py-2"><TicketLink ticket1={r.ticket1} /></td>
                    <td className="px-3 py-2">{r.dayin} {r.tmin?.slice(0, 5)}</td>
                    <td className="px-3 py-2 font-mono font-bold">{r.plate}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtNum(r.net_kg)}</td>
                    <td className="px-3 py-2 text-right font-mono text-earth-ink2">{fmtNum(r.available_kg)}</td>
                    <td className="px-3 py-2"><input type="number" min="0" disabled={!canOffset} className={`${inputCls} text-right font-mono py-1`} value={kg}
                      onChange={e => setKgs(x => ({ ...x, [r.ticket1]: e.target.value }))} /></td>
                    <td className="px-5 py-2 text-right">
                      {canOffset && <button className={btn.primary} disabled={!valid} onClick={() => setConfirm({ row: r, kg: n })}>ตัดยอด</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!canOffset && <p className="px-5 py-3 text-xs text-earth-ink3">เฉพาะ Operator เท่านั้นที่ตัดยอดชดเชยได้</p>}

      {confirm && (
        <Modal title="ยืนยันการตัดยอดชดเชย" onClose={() => setConfirm(null)}>
          <div className="p-5 space-y-2 text-sm text-earth-ink">
            <p>เที่ยว <span className="font-mono">{confirm.row.ticket1}</span> · {confirm.row.plate} · {confirm.row.dayin}</p>
            <p>น้ำหนักสุทธิ {fmtNum(confirm.row.net_kg)} kg − ตัดชดเชย <strong className="text-red-600">{fmtNum(confirm.kg)} kg</strong>
              {' '}= คิดเงิน <strong>{fmtNum(confirm.row.available_kg - confirm.kg)} kg</strong></p>
            <p className="text-earth-ink2">คงเหลือในเคสหลังตัด {fmtNum(c.remaining_kg - confirm.kg)} kg</p>
            <input className={inputCls} value={remark} onChange={e => setRemark(e.target.value)} placeholder="หมายเหตุ (เช่น เลขที่ใบแจ้งหนี้)" />
            <ErrorLine error={mutation.error} />
          </div>
          <div className="px-5 py-4 border-t border-earth-border flex justify-end gap-2">
            <button className={btn.ghost} onClick={() => setConfirm(null)}>ยกเลิก</button>
            <button className={btn.primary} disabled={mutation.isPending} onClick={() => mutation.mutate(confirm)}>
              {mutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันตัดยอด'}
            </button>
          </div>
        </Modal>
      )}
    </Section>
  );
}
