import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, BASE } from '../../api.js';
import { CHEM_STYLE, fmtTs, todayTH } from '../../config/chemLab.js';
import { Section, VerdictBadge, ErrorLine, ReasonModal, Empty, btn, inputCls, useLabSpec } from './shared.jsx';

const firstOfMonth = () => todayTH().slice(0, 8) + '01';
// filled from the original Word form (server/templates) — docx download / pdf exported by Word
const memoFileUrl = (id, fmt) => `${BASE}/api/chem-lab/memos/${id}/${fmt}`;

// 5.8 — บันทึกข้อความ F-MS-HACCP-สคบ-14: collect final results for a period → save (doc no. typed by hand) → Word / PDF
export default function MemoTab({ canWrite }) {
  const qc = useQueryClient();
  const { data: specData } = useLabSpec();
  const [q, setQ] = useState({ chemical: 'PACL', from: firstOfMonth(), to: todayTH() });
  const spec = specData?.chemicals?.[q.chemical];
  const [form, setForm] = useState({ doc_no: '', doc_date: todayTH(), addressee: '', spec_ref: '', conclusion: '' });

  const { data: preview, isFetching, error } = useQuery({
    queryKey: ['chem-lab', 'memo-preview', q],
    queryFn: () => get(`/api/chem-lab/memos/preview?chemical=${q.chemical}&from=${q.from}&to=${q.to}`),
  });
  const { data: memos } = useQuery({ queryKey: ['chem-lab', 'memos'], queryFn: () => get('/api/chem-lab/memos') });

  // composites going into the memo — every final in the period is ticked by default
  const [picked, setPicked] = useState(() => new Set());
  const previewKey = preview ? preview.rows.map(r => r.composite_id).join() : '';
  useEffect(() => { setPicked(new Set(preview?.rows.map(r => r.composite_id) || [])); }, [previewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = (preview?.rows || []).filter(r => picked.has(r.composite_id));
  const toggle = (id) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = preview?.rows.length > 0 && chosen.length === preview.rows.length;

  // default conclusion from the chosen rows (editable)
  const chosenKey = chosen.map(r => r.composite_id).join();
  useEffect(() => {
    const fails = chosen.filter(r => r.verdict === 'fail').length;
    setForm(f => ({
      ...f,
      spec_ref: f.spec_ref || spec?.spec_ref || '',
      conclusion: chosen.length === 0 ? ''
        : fails === 0 ? `ผลวิเคราะห์ทุกตัวอย่าง (${chosen.length} ตัวอย่าง) ผ่านเกณฑ์มาตรฐานที่กำหนด`
        : `ผลวิเคราะห์ไม่ผ่านเกณฑ์ ${fails} ตัวอย่าง จาก ${chosen.length} ตัวอย่าง (ดำเนินการตามขั้นตอน 5.10)`,
    }));
  }, [chosenKey, spec]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => post('/api/chem-lab/memos', { ...form, chemical: q.chemical, from: q.from, to: q.to, composite_ids: chosen.map(r => r.composite_id) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['chem-lab'] });
      setForm(f => ({ ...f, doc_no: '' }));
      window.open(memoFileUrl(res.memo.id, 'pdf'), '_blank');
    },
  });
  // void = the memo stays on record (struck through) and its samples are released for a new memo
  const [voiding, setVoiding] = useState(null);
  const voidM = useMutation({
    mutationFn: ({ id, reason }) => post(`/api/chem-lab/memos/${id}/void`, { reason }),
    onSuccess: () => { setVoiding(null); qc.invalidateQueries({ queryKey: ['chem-lab'] }); },
  });

  return (
    <div className="space-y-4">
      <Section title="ออกบันทึกข้อความ สคบ-14" subtitle="รวมผล final ของตัวอย่างผสมในช่วงวันที่ — ตัวอย่างที่ออกเอกสารแล้วจะไม่ถูกนำมาซ้ำ">
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-2">
              {Object.entries(CHEM_STYLE).map(([k, s]) => (
                <button key={k} onClick={() => setQ(x => ({ ...x, chemical: k }))}
                  className={`px-3 py-2 rounded-lg text-sm font-bold border ${q.chemical === k ? s.pill : 'border-earth-border text-earth-ink2'}`}>{s.label}</button>
              ))}
            </div>
            <label className="text-sm text-earth-ink2 space-y-1"><span className="block">ตั้งแต่งวดวันที่</span>
              <input type="date" className={inputCls} value={q.from} onChange={e => setQ(x => ({ ...x, from: e.target.value }))} /></label>
            <label className="text-sm text-earth-ink2 space-y-1"><span className="block">ถึง</span>
              <input type="date" className={inputCls} value={q.to} onChange={e => setQ(x => ({ ...x, to: e.target.value }))} /></label>
            {preview && (
              <span className="text-sm px-3 py-2 rounded-lg bg-earth-card text-earth-ink font-semibold">
                จำนวน {preview.n_samples} ตัวอย่าง · เลือกลงเอกสาร {chosen.length}/{preview.m_analyzed} ขวดผสม
                {preview.pending_final > 0 && <span className="text-amber-700"> · รอผล final {preview.pending_final}</span>}
              </span>
            )}
          </div>
          <ErrorLine error={error} />

          {spec && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[720px]">
                <thead>
                  <tr className="bg-earth-card text-xs text-earth-ink2">
                    <th className="px-3 py-2 border-b border-earth-border w-8">
                      <input type="checkbox" className="w-4 h-4 accent-teal-700" aria-label="เลือกทั้งหมด" disabled={!preview?.rows.length}
                        checked={!!allOn} onChange={() => setPicked(allOn ? new Set() : new Set(preview.rows.map(r => r.composite_id)))} />
                    </th>
                    <th className="text-left px-3 py-2 border-b border-earth-border">ตัวอย่างวันที่</th>
                    <th className="text-left px-3 py-2 border-b border-earth-border">บริษัท</th>
                    <th className="text-left px-3 py-2 border-b border-earth-border">ขวดผสม</th>
                    {spec.params.map(p => <th key={p.key} className="text-right px-3 py-2 border-b border-earth-border">{p.label_th}</th>)}
                    <th className="text-left px-3 py-2 border-b border-earth-border">สรุป</th>
                  </tr>
                </thead>
                <tbody>
                  {isFetching && !preview && <tr><td colSpan={spec.params.length + 5}><Empty>กำลังโหลด...</Empty></td></tr>}
                  {preview?.rows.length === 0 && <tr><td colSpan={spec.params.length + 5}><Empty>ไม่มีผล final ที่ยังไม่ได้ออกเอกสารในช่วงนี้</Empty></td></tr>}
                  {preview?.rows.map(r => (
                    <tr key={r.composite_id} className={`border-b border-earth-border ${picked.has(r.composite_id) ? '' : 'opacity-50'}`}>
                      <td className="px-3 py-2"><input type="checkbox" className="w-4 h-4 accent-teal-700" checked={picked.has(r.composite_id)} onChange={() => toggle(r.composite_id)} /></td>
                      <td className="px-3 py-2 text-earth-ink">{r.sample_date}</td>
                      <td className="px-3 py-2 text-earth-ink2 text-xs">{r.company_name}</td>
                      <td className="px-3 py-2 text-xs text-earth-ink2">
                        <span className="font-semibold text-earth-ink">ใบที่ {r.seq}</span> · {r.n_bottles} ขวด
                        {r.finalized_by && <span className="block text-[11px] text-earth-ink3">final โดย {r.finalized_by}</span>}
                      </td>
                      {spec.params.map(p => (
                        <td key={p.key} className={`px-3 py-2 text-right font-mono ${r.final_attempt.param_verdicts[p.key] === 'fail' ? 'text-red-600 font-bold' : ''}`}>
                          {r.final_attempt.values[p.key] ?? '—'}
                        </td>
                      ))}
                      <td className="px-3 py-2"><VerdictBadge verdict={r.verdict} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canWrite && preview?.rows.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 border-t border-earth-border pt-4">
              <label className="text-sm text-earth-ink2 space-y-1"><span className="block">ที่ (เลขที่เอกสาร) *</span>
                <input className={inputCls} value={form.doc_no} onChange={e => setForm(f => ({ ...f, doc_no: e.target.value }))} placeholder="สคบฝผม /" /></label>
              <label className="text-sm text-earth-ink2 space-y-1"><span className="block">วันที่เอกสาร</span>
                <input type="date" className={inputCls} value={form.doc_date} onChange={e => setForm(f => ({ ...f, doc_date: e.target.value }))} /></label>
              <label className="text-sm text-earth-ink2 space-y-1"><span className="block">เรียน</span>
                <input className={inputCls} value={form.addressee} onChange={e => setForm(f => ({ ...f, addressee: e.target.value }))} /></label>
              <label className="text-sm text-earth-ink2 space-y-1"><span className="block">ตามรายละเอียด (สัญญา/มาตรฐาน)</span>
                <input className={inputCls} value={form.spec_ref} onChange={e => setForm(f => ({ ...f, spec_ref: e.target.value }))} /></label>
              <label className="md:col-span-2 text-sm text-earth-ink2 space-y-1"><span className="block">สรุปผลวิเคราะห์</span>
                <textarea className={inputCls} rows={2} value={form.conclusion} onChange={e => setForm(f => ({ ...f, conclusion: e.target.value }))} /></label>
              <div className="md:col-span-2 flex items-center justify-end gap-3">
                <ErrorLine error={save.error} />
                <button className={btn.primary} disabled={!form.doc_no.trim() || !chosen.length || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? 'กำลังบันทึก...' : 'บันทึกและเปิด PDF'}
                </button>
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section title="บันทึกข้อความที่ออกแล้ว">
        {!memos?.memos?.length ? <Empty>ยังไม่มี</Empty> : (
          <table className="w-full text-sm border-collapse">
            <tbody>
              {memos.memos.map(m => {
                const isVoid = m.status === 'void';
                return (
                  <tr key={m.id} className={`border-b border-earth-border ${isVoid ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-2 font-semibold text-earth-ink">
                      <span className={isVoid ? 'line-through' : ''}>{m.doc_no}</span>
                      {isVoid && <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">ยกเลิก</span>}
                      {isVoid && <span className="block text-[11px] font-normal text-red-600">{m.voided_by} · {fmtTs(m.voided_at)} — {m.void_reason}</span>}
                    </td>
                    <td className="px-3 py-2">{CHEM_STYLE[m.chemical]?.label || m.chemical}</td>
                    <td className="px-3 py-2 text-earth-ink2">{m.period_from} – {m.period_to}</td>
                    <td className="px-3 py-2 text-earth-ink2">{m.n_samples} / {m.m_analyzed} ตัวอย่าง</td>
                    <td className="px-3 py-2 text-earth-ink3 text-xs">{m.created_by} · {fmtTs(m.created_at)}</td>
                    <td className="px-5 py-2 text-right whitespace-nowrap space-x-2">
                      {!isVoid && (
                        <>
                          <a href={memoFileUrl(m.id, 'docx')} className="inline-block px-3 py-1 rounded-lg border border-blue-700 text-blue-700 text-xs font-bold hover:bg-blue-50">Word</a>
                          <a href={memoFileUrl(m.id, 'pdf')} target="_blank" rel="noreferrer" className="inline-block px-3 py-1 rounded-lg border border-red-700 text-red-700 text-xs font-bold hover:bg-red-50">PDF</a>
                          {canWrite && <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => setVoiding(m)}>ยกเลิก</button>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      {voiding && (
        <ReasonModal title={`ยกเลิก สคบ-14 ${voiding.doc_no}`} danger confirmLabel="ยกเลิกเอกสาร"
          consequences={[
            { text: `ตัวอย่าง ${voiding.m_analyzed} รายการในฉบับนี้จะถูกปลดล็อก (ย้อนผล final / แก้ไขได้) และนำไปออกฉบับใหม่ได้` },
            { text: 'เลขที่เอกสารเดิมใช้ซ้ำไม่ได้ — ฉบับใหม่ต้องใช้เลขใหม่' },
          ]}
          pending={voidM.isPending} error={voidM.error}
          onClose={() => setVoiding(null)} onConfirm={(reason) => voidM.mutate({ id: voiding.id, reason })} />
      )}
    </div>
  );
}
