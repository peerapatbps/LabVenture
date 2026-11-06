import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, put } from '../api.js';
import { Modal, ErrorLine, btn } from '../pages/chemlab/shared.jsx';

// แก้เกณฑ์ควบคุมของสถานการณ์หนึ่ง — เก็บใน server/scenarios/<threshold_file> (min = LCL, max = UCL)
// เกณฑ์นี้คือต้นฉบับ: หน้า Record / Excel Control Value / Report / alarm ใน Event Class อ่านจากที่นี่

const cell = 'border border-earth-border rounded-md px-2 py-1 text-sm bg-white/60 focus:outline-none focus:ring-2 focus:ring-teal-500';
const toStr = (v) => (v === null || v === undefined ? '' : String(v));
let rowSeq = 0;
const mkRow = (t = {}) => ({ _id: ++rowSeq, param_key: t.param_key || '', min: toStr(t.min), max: toStr(t.max) });

// source (ไม่ใส่ = ไฟล์ของ scenario): ชุดเกณฑ์อื่นที่ใช้ตารางเดียวกัน เช่น เกณฑ์โหมดโรคระบาด
//   { title, loadUrl, saveUrl, queryKey, note } — loadUrl ต้องคืน { thresholds }
export default function ScenarioThresholdModal({ scenario, scenarios = [], canEdit, onClose, source }) {
  const qc = useQueryClient();
  const file = scenario?.threshold_file;
  const loadUrl = source?.loadUrl ?? `/api/config/scenarios/files/${file}`;
  const saveUrl = source?.saveUrl ?? `/api/config/scenarios/files/${file}`;
  const dataKey = source?.queryKey ?? ['scenario-file', file];
  const { data: nodesConfig } = useQuery({ queryKey: ['nodes-config'], queryFn: () => get('/api/config/nodes') });
  const { data: fileData, isLoading, error: loadError } = useQuery({
    queryKey: dataKey,
    queryFn: () => get(loadUrl),
  });

  const [rows, setRows] = useState(null);
  const [copyFrom, setCopyFrom] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (fileData && rows === null) setRows((fileData.thresholds || []).map(mkRow)); }, [fileData, rows]);

  const params = useMemo(() => {
    const idx = {};
    for (const n of nodesConfig?.nodes || []) for (const p of n.parameters || []) idx[p.param_key] = { ...p, node: n };
    return idx;
  }, [nodesConfig]);
  const nodes = useMemo(() => [...(nodesConfig?.nodes || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)), [nodesConfig]);

  // ตรวจในหน้าจอ (server ตรวจซ้ำตอนบันทึก)
  const rowIssue = useMemo(() => {
    const out = {};
    const count = {};
    for (const r of rows || []) if (r.param_key) count[r.param_key] = (count[r.param_key] || 0) + 1;
    for (const r of rows || []) {
      const min = r.min === '' ? null : Number(r.min);
      const max = r.max === '' ? null : Number(r.max);
      if (!r.param_key) out[r._id] = 'เลือกพารามิเตอร์';
      else if (count[r.param_key] > 1) out[r._id] = 'ซ้ำ';
      else if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) out[r._id] = 'ต้องเป็นตัวเลข';
      else if (min === null && max === null) out[r._id] = 'ใส่ LCL หรือ UCL';
      else if (min !== null && max !== null && min >= max) out[r._id] = 'LCL ต้อง < UCL';
    }
    return out;
  }, [rows]);
  const issueCount = Object.keys(rowIssue).length;

  const update = (id, patch) => { setSaved(false); setRows(rs => rs.map(r => (r._id === id ? { ...r, ...patch } : r))); };
  const remove = (id) => { setSaved(false); setRows(rs => rs.filter(r => r._id !== id)); };
  const add = () => { setSaved(false); setRows(rs => [...rs, mkRow()]); };

  async function doCopy() {
    const src = scenarios.find(s => String(s.id) === copyFrom);
    if (!src) return;
    if (rows.length && !window.confirm(`แทนที่เกณฑ์ทั้งหมด ${rows.length} รายการ ด้วยของ "${src.name}"?`)) return;
    try {
      const d = await get(`/api/config/scenarios/files/${src.threshold_file}`);
      setRows((d.thresholds || []).map(mkRow));
      setSaved(false);
      setCopyFrom('');
    } catch (e) { setError(e); }
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      await put(saveUrl, {
        thresholds: rows.map(r => ({ param_key: r.param_key, min: r.min === '' ? null : Number(r.min), max: r.max === '' ? null : Number(r.max) })),
      });
      setSaved(true);
      qc.invalidateQueries({ queryKey: dataKey });
      qc.invalidateQueries({ queryKey: ['active-scenario'] });
      qc.invalidateQueries({ queryKey: ['scenario-log'] });
      qc.invalidateQueries({ queryKey: ['scenarios-list'] });
      qc.invalidateQueries({ queryKey: ['scenario-thresholds'] });
      qc.invalidateQueries({ queryKey: ['eventclass'] });
    } catch (e) { setError(e); } finally { setSaving(false); }
  }

  const dirty = rows && fileData && JSON.stringify(rows.map(({ _id, ...r }) => r)) !== JSON.stringify((fileData.thresholds || []).map(t => { const { _id, ...r } = mkRow(t); return r; }));

  return (
    <Modal title={source?.title ?? `เกณฑ์ควบคุม — ${scenario.name}`} onClose={onClose} wide>
      <div className="p-5 space-y-3">
        <p className="text-sm text-earth-ink2">
          ใส่ <b>LCL</b> (ต่ำสุดที่ยอมรับ) และ/หรือ <b>UCL</b> (สูงสุดที่ยอมรับ) ของแต่ละพารามิเตอร์ — เว้นว่างได้ข้างหนึ่ง
          · ใช้กับหน้าบันทึกผล, Control Value ใน Excel, กราฟรายงาน และเป็นฐานของ alarm ใน Event Class
          {source?.note ? <span className="block mt-1 text-amber-800">{source.note}</span> : <span className="text-earth-ink3"> · ไฟล์ {file}</span>}
        </p>

        {canEdit && scenarios.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-earth-ink2 whitespace-nowrap">คัดลอกจาก</span>
            <select className={`${cell} w-64`} value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
              <option value="">— เลือกสถานการณ์ —</option>
              {scenarios.filter(s => s.id !== scenario?.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className={btn.ghost} disabled={!copyFrom} onClick={doCopy}>คัดลอก</button>
          </div>
        )}

        {isLoading || rows === null ? (
          <p className="text-sm text-earth-ink3 py-6 text-center">{loadError ? <ErrorLine error={loadError} /> : 'กำลังโหลด...'}</p>
        ) : (
          <div className="border border-earth-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-earth-card text-earth-ink2 text-xs">
                <tr>
                  <th className="text-left px-3 py-2">พารามิเตอร์</th>
                  <th className="text-left px-2 py-2 w-28">LCL</th>
                  <th className="text-left px-2 py-2 w-28">UCL</th>
                  <th className="text-left px-2 py-2 w-16">หน่วย</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-earth-ink3">ยังไม่มีเกณฑ์</td></tr>}
                {rows.map(r => (
                  <tr key={r._id} className="border-t border-earth-border">
                    <td className="px-3 py-1.5">
                      <select className={`${cell} w-full`} value={r.param_key} disabled={!canEdit} onChange={e => update(r._id, { param_key: e.target.value })}>
                        <option value="">— เลือก —</option>
                        {r.param_key && !params[r.param_key] && <option value={r.param_key}>{r.param_key} (ไม่พบ)</option>}
                        {nodes.map(n => (
                          <optgroup key={n.id} label={n.label}>
                            {(n.parameters || []).map(p => <option key={p.param_key} value={p.param_key}>{p.param_key} · {p.label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5"><input className={`${cell} w-full`} inputMode="decimal" value={r.min} disabled={!canEdit} onChange={e => update(r._id, { min: e.target.value.trim() })} placeholder="—" /></td>
                    <td className="px-2 py-1.5"><input className={`${cell} w-full`} inputMode="decimal" value={r.max} disabled={!canEdit} onChange={e => update(r._id, { max: e.target.value.trim() })} placeholder="—" /></td>
                    <td className="px-2 py-1.5 text-xs text-earth-ink3">{params[r.param_key]?.unit || ''}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {rowIssue[r._id] && <span className="text-xs text-red-600 mr-2">{rowIssue[r._id]}</span>}
                      {canEdit && <button className="text-earth-ink3 hover:text-red-600" onClick={() => remove(r._id)} aria-label="ลบแถว">✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && rows && <button className={btn.ghost} onClick={add}>+ เพิ่มพารามิเตอร์</button>}
        <ErrorLine error={error} />
      </div>
      <div className="px-5 py-4 border-t border-earth-border flex items-center justify-end gap-2">
        {saved && !dirty && <span className="text-sm text-teal-700 font-semibold mr-auto">บันทึกแล้ว</span>}
        {issueCount > 0 && <span className="text-sm text-red-600 mr-auto">ต้องแก้ {issueCount} แถวก่อนบันทึก</span>}
        <button className={btn.ghost} onClick={onClose}>ปิด</button>
        {canEdit && (
          <button className={btn.primary} disabled={saving || issueCount > 0 || !dirty} onClick={save}>
            {saving ? 'กำลังบันทึก...' : `บันทึก ${rows?.length ?? 0} เกณฑ์`}
          </button>
        )}
      </div>
    </Modal>
  );
}
