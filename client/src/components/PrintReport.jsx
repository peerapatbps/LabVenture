// หน้า /record · วันที่ = วันที่เลือกมุมขวาบนของหน้า
// พิมพ์รายงาน (ExportBar): popup เลือกเอกสาร
//   DailyLab   ฟอร์ม theme
//   สาหร่าย   ฟอร์ม algae_master (ต้องมีการเก็บตัวอย่างในวันนั้น)
// Query daily chemical dosing (DosingSyncButton): QUERY DATA ของ Daily Report (ไม่ redirect) แล้วบันทึก
//   Daily Dosage (ACTUAL) ลงไฟล์ DailyLab ใน excel_data_dir · ข้อมูลไม่ครบ → หน้าตรวจข้อมูล แล้วถามก่อนบันทึก
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post, BASE } from '../api.js';
import { dailyReportIssues } from '../utils/dailyReportIssues.js';
import { ChemAccuracyWall, buildChemDonutRows } from './ChemAccuracyWall.jsx';
import { FWS_BW_PHASES, parseBWPhase } from '../../../server/shared/dailyReportRules.mjs';

const THAI_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thaiShort = s => `${+s.slice(8)} ${THAI_MON[+s.slice(5, 7) - 1]}`;
// Thai date (UTC+7) `n` days before today
const thaiDaysAgo = n => new Date(Date.now() + 7 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);

const DOCS = [
  { key: 'daily',   title: 'DailyLab', desc: 'ผลแล็บที่บันทึกไว้' },
  { key: 'algae',   title: 'สาหร่าย', desc: 'ฟอร์มสาหร่าย' },
];

// ── Query daily chemical dosing → บันทึก Daily Dosage (ACTUAL) ลง Excel dir ──────────
export function DosingSyncButton({ date, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="ดึง Operation daily report แล้วบันทึก Daily Dosage (ACTUAL) ลงไฟล์ DailyLab"
        className={`px-4 py-1.5 rounded-lg text-sm font-bold border border-earth-ink text-earth-ink bg-earth-card hover:bg-earth transition-colors touch-target ${className}`}>
        🧪 Query daily chemical dosing
      </button>
      {open && <DosingModal date={date} onClose={() => setOpen(false)} />}
    </>
  );
}

function DosingModal({ date, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [review, setReview] = useState(null); // { report, fwsMap, issues }
  const [done, setDone] = useState(null);     // response ของ POST /api/write/dosage
  // วันนี้ / เมื่อวาน → QUERY DATA สด · เก่ากว่านั้น → ข้อมูลที่ SAVE DB ไว้ (server ใช้กฎเดียวกัน)
  const liveOp = date >= thaiDaysAgo(1);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await post('/api/write/dosage', { date });
      setReview(null);
      setDone(r);
    } catch (e) {
      setErr('บันทึกไม่สำเร็จ: ' + e.message);
    } finally { setBusy(false); }
  }

  async function run() {
    setBusy(true); setErr('');
    try {
      if (!liveOp) {
        const s = await get(`/api/daily-report/saved?date=${date}`);
        if (!s.saved) { setErr(`ยังไม่ได้ SAVE DB วันที่ ${thaiShort(date)} ${+date.slice(0, 4) + 543} — ไป SAVE DB ที่หน้า DAILY ก่อน`); return; }
        setBusy(false);
        return save();
      }
      const d = await get(`/api/daily-report/fetch-all?date=${date}`);
      // หน้า DAILY อ่านผลนี้ต่อได้ (key เดียวกับ OpRecord)
      try {
        sessionStorage.setItem(`dr_report_${date}`, JSON.stringify(d.report));
        if (d.fwsMap) sessionStorage.setItem(`dr_fwsbw_${date}`, JSON.stringify({ p12: d.fwsMap.FWS1, p3: d.fwsMap.FWS2, p4: d.fwsMap.FWS2 }));
      } catch {}
      // แสดง popup Daily Report ทุกครั้ง (มี CHEMICAL ACCURACY WALL ให้ดูก่อนบันทึก)
      setReview({ report: d.report, fwsMap: d.fwsMap, issues: dailyReportIssues(d.report, d.fwsMap) });
    } catch (e) {
      setErr('ดึง Daily Report ไม่สำเร็จ: ' + e.message);
    } finally { setBusy(false); }
  }

  const label = busy ? (liveOp ? 'กำลังดึง Daily Report...' : 'กำลังบันทึก...') : (liveOp ? 'ดึงข้อมูลและบันทึกลง Excel' : 'บันทึกลง Excel');
  const note = liveOp ? 'QUERY DATA สด · ใช้เวลาประมาณ 20 วินาที' : 'ใช้ข้อมูลที่ SAVE DB ไว้ในหน้า DAILY';
  const doneCells = done?.cells ? Object.entries(done.cells) : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className={`bg-earth-card rounded-xl shadow-xl w-full ${review ? 'max-w-[1400px]' : 'max-w-lg'} max-h-[90vh] flex flex-col text-sm`}
        onClick={e => e.stopPropagation()}>
        {review ? (
          <ReviewView date={date} {...review} onBack={() => setReview(null)} onClose={onClose} onExport={save}
            question="จะบันทึก Daily Dosage ลง Excel หรือไม่?" actionLabel={busy ? 'กำลังบันทึก...' : 'บันทึกลง Excel'}
            busy={busy} err={err} canExport={review.report?.day_complete !== false} />
        ) : (
          <>
            <div className="px-4 py-3 border-b border-earth-border flex items-center justify-between">
              <div className="font-bold text-earth-ink text-base">Query daily chemical dosing</div>
              <span className="text-xs text-earth-ink3">วันที่ {thaiShort(date)} {+date.slice(0, 4) + 543}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {!done && <p className="text-earth-ink2">ดึง Operation daily report แล้วบันทึก Daily Dosage (ACTUAL, mg/l) ของ Alum · PACl · Pre Cl2 · Post Cl2 ลงไฟล์ DailyLab ในโฟลเดอร์ที่ตั้งใน config (ช่อง X–AA แถว 4, 5, 7, 9)</p>}
              {done?.ok && <div className="rounded bg-green-50 border border-green-300 text-green-800 px-3 py-2">
                ✅ บันทึกลง Excel แล้ว {doneCells.length} ช่อง
                {done.result?.details?.[0]?.file && <div className="text-[11px] mt-0.5 break-all">{done.result.details[0].file} · ชีท {done.result.details[0].sheet}</div>}
              </div>}
              {done && !done.ok && <div className="rounded bg-amber-50 border border-amber-300 text-amber-800 px-3 py-2">
                ⚠️ เขียนไฟล์ไม่สำเร็จ — เข้าคิว retry อัตโนมัติแล้ว
                <div className="text-[11px] mt-0.5 break-all">{done.error}</div>
              </div>}
              {doneCells.length > 0 && <div className="flex flex-wrap gap-1 text-[11px] font-mono">
                {doneCells.map(([a, v]) => <span key={a} className="px-1.5 py-0.5 rounded border border-earth-border text-earth-ink2">{a}={v}</span>)}
              </div>}
            </div>
            <div className="px-4 py-3 border-t border-earth-border flex items-center justify-end gap-2">
              <span className="mr-auto text-xs">
                {err ? <span className="text-red-600">{err}</span> : !done && <span className="text-earth-ink3">{note}</span>}
              </span>
              <button onClick={onClose} disabled={busy} className="px-3 py-1.5 rounded-lg border border-earth-border text-earth-ink2 hover:bg-earth disabled:opacity-50">{done ? 'ปิด' : 'ยกเลิก'}</button>
              {!done && <button onClick={run} disabled={busy} className="px-3 py-1.5 rounded-lg bg-green-700 text-white font-bold hover:bg-green-800 disabled:opacity-50">{label}</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ExportBar({ date, weekly, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className={`px-4 py-1.5 rounded-lg text-sm font-bold border border-earth-ink bg-earth-ink text-white hover:opacity-90 transition-opacity touch-target ${className}`}>
        🖨 พิมพ์รายงาน
      </button>
      {open && <PrintModal date={date} weekly={weekly} onClose={() => setOpen(false)} />}
    </>
  );
}

function PrintModal({ date, weekly, onClose }) {
  const [doc, setDoc] = useState(weekly ? 'algae' : 'daily');
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // สาหร่าย: วันเก็บตัวอย่างไม่ตรงกันทุกสัปดาห์ → เลือกวันเองจากปฏิทิน (null = ยังไม่ได้เลือก)
  const [algaeDate, setAlgaeDate] = useState(null);
  const { data: algaeInfo, isFetching } = useQuery({
    queryKey: ['algae-export-info', algaeDate, algaeDate],
    queryFn: () => get(`/api/algae/export-info?from=${algaeDate}&to=${algaeDate}`),
    enabled: doc === 'algae' && !!algaeDate,
  });

  const go = url => { window.location.href = url; onClose(); };

  let canGo = true, goLabel = 'ดาวน์โหลด Excel', note = null;
  let onGo = () => go(`${BASE}/api/write/export.xlsx?from=${date}&to=${date}`);
  if (doc === 'algae') {
    onGo = () => go(`${BASE}/api/algae/export.xlsx?from=${algaeDate}&to=${algaeDate}`);
    if (!algaeDate) { canGo = false; note = 'เลือกวันที่มีข้อมูลจากปฏิทิน'; }
    else note = `วันที่เก็บตัวอย่าง ${thaiShort(algaeDate)} ${+algaeDate.slice(0, 4) + 543}`;
  }
  const headDate = doc === 'algae' ? algaeDate : date;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-earth-card rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col text-sm"
        onClick={e => e.stopPropagation()}>
        {(
          <>
            <div className="px-4 py-3 border-b border-earth-border flex items-center justify-between">
              <div className="font-bold text-earth-ink text-base">พิมพ์รายงาน</div>
              <span className="text-xs text-earth-ink3">{headDate ? `วันที่ ${thaiShort(headDate)} ${+headDate.slice(0, 4) + 543}` : 'ยังไม่ได้เลือกวัน'}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="text-xs font-semibold text-earth-ink2 mb-1.5">เลือกเอกสาร</div>
              <div className="space-y-1.5">
                {DOCS.map(d => (
                  <label key={d.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${doc === d.key ? 'border-earth-ink bg-earth' : 'border-earth-border hover:bg-earth'}`}>
                    <input type="radio" name="print-doc" className="mt-0.5" checked={doc === d.key} onChange={() => setDoc(d.key)} />
                    <span>
                      <span className="block font-semibold text-earth-ink">{d.title}</span>
                      <span className="block text-xs text-earth-ink3">{d.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
              {doc === 'algae' && <AlgaeCalendar refDate={date} value={algaeDate} onChange={setAlgaeDate} />}
              {doc === 'algae' && algaeDate && isFetching && !algaeInfo && <p className="text-earth-ink3 text-xs mt-2">กำลังตรวจข้อมูล...</p>}
              {doc === 'algae' && algaeInfo?.unmapped?.length > 0 && (
                <p className="text-amber-700 text-xs mt-2">⚠️ ชนิดต่อไปนี้ไม่มีในฟอร์ม จะไม่ถูกพิมพ์: {algaeInfo.unmapped.join(', ')}</p>
              )}
            </div>
            <div className="px-4 py-3 border-t border-earth-border flex items-center justify-end gap-2">
              <span className="mr-auto text-xs text-earth-ink3">{note}</span>
              <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-earth-border text-earth-ink2 hover:bg-earth">ยกเลิก</button>
              <button onClick={onGo} disabled={!canGo} className="px-3 py-1.5 rounded-lg bg-green-700 text-white font-bold hover:bg-green-800 disabled:opacity-50">{goLabel}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── ปฏิทินสาหร่าย: แสดงวันที่มีข้อมูล (เลือกได้เฉพาะวันนั้น) ─────────────────
const WEEKDAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
const THAI_MON_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const pad2 = n => String(n).padStart(2, '0');

function AlgaeCalendar({ refDate, value, onChange }) {
  const [ym, setYm] = useState(refDate.slice(0, 7));
  const autoPicked = React.useRef(false);
  const [y, m] = ym.split('-').map(Number);
  const nDays = new Date(y, m, 0).getDate();
  const first = `${ym}-01`, last = `${ym}-${pad2(nDays)}`;

  const { data, isFetching, isError } = useQuery({
    queryKey: ['algae-export-info', first, last],
    queryFn: () => get(`/api/algae/export-info?from=${first}&to=${last}`),
  });
  const has = new Set(data?.dates ?? []);

  // เปิดครั้งแรก: เลือกวันเก็บตัวอย่างล่าสุดที่ไม่เกินวันที่ของหน้า (ในเดือนนั้น)
  useEffect(() => {
    if (autoPicked.current || !data || value) return;
    autoPicked.current = true;
    const pick = [...has].filter(d => d <= refDate).sort().pop();
    if (pick) onChange(pick);
  }, [data]); // eslint-disable-line

  const shift = k => { const d = new Date(y, m - 1 + k, 1); setYm(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`); };
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // จันทร์ = คอลัมน์แรก
  const cells = [...Array(lead).fill(null), ...Array.from({ length: nDays }, (_, i) => `${ym}-${pad2(i + 1)}`)];

  return (
    <div className="mt-3 rounded-lg border border-earth-border p-3" data-testid="algae-calendar">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => shift(-1)} className="px-2 py-0.5 rounded border border-earth-border text-earth-ink2 hover:bg-earth" aria-label="เดือนก่อน">‹</button>
        <span className="font-semibold text-earth-ink text-sm">📅 {THAI_MON_FULL[m - 1]} {y + 543}</span>
        <button onClick={() => shift(1)} className="px-2 py-0.5 rounded border border-earth-border text-earth-ink2 hover:bg-earth" aria-label="เดือนถัดไป">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {WEEKDAYS.map(w => <div key={w} className="text-earth-ink3 font-semibold py-0.5">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={'e' + i} />;
          const ok = has.has(d), sel = d === value;
          return (
            <button key={d} disabled={!ok} onClick={() => onChange(d)} data-date={d}
              title={ok ? 'มีข้อมูลสาหร่าย' : 'ไม่มีข้อมูล'}
              className={`py-1.5 rounded-md border ${sel ? 'bg-emerald-700 border-emerald-700 text-white font-bold'
                : ok ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-semibold hover:bg-emerald-200'
                : 'border-transparent text-earth-ink3 opacity-50 cursor-not-allowed'} ${d === refDate && !sel ? 'ring-1 ring-earth-ink' : ''}`}>
              {+d.slice(8)}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-earth-ink3">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-100 border border-emerald-300" />มีข้อมูล</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded ring-1 ring-earth-ink" />วันที่ของหน้า</span>
        <span className="ml-auto">
          {isError ? <span className="text-red-600">โหลดไม่สำเร็จ</span>
            : isFetching && !data ? 'กำลังโหลด...'
            : `${has.size} วันที่มีข้อมูลในเดือนนี้`}
        </span>
      </div>
    </div>
  );
}

// ── หน้าตรวจข้อมูล (Daily Report ไม่ครบ) ─────────────────────────────────────
const fmtN = (v, dec = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const sumS = (...xs) => (xs.some(x => x == null) ? null : xs.reduce((a, b) => a + b, 0));

function Val({ v, dec = 0, unit }) {
  if (v == null) return <span className="text-red-600 font-bold">N/A</span>;
  return <span className="font-mono text-earth-ink">{fmtN(v, dec)}{unit && <span className="text-earth-ink3 font-sans ml-0.5 text-[11px]">{unit}</span>}</span>;
}

const cellCls = v => `px-2 py-1 border border-earth-border text-right ${v == null ? 'bg-red-50' : ''}`;
const thCls = 'px-2 py-1 border border-earth-border text-earth-ink2 font-semibold bg-earth';

// Card: label/value rows (water quantities)
function QtyCard({ title, rows, dec = 0 }) {
  const bad = rows.some(r => r.v == null || r.red);
  return (
    <div className={`rounded-lg border ${bad ? 'border-red-300' : 'border-earth-border'} overflow-hidden`}>
      <div className={`px-2 py-1 text-xs font-semibold ${bad ? 'bg-red-50 text-red-700' : 'bg-earth text-earth-ink2'}`}>{title}</div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className={r.bold ? 'font-semibold' : ''}>
              <td className="px-2 py-0.5 text-earth-ink2">{r.label}</td>
              <td className={`px-2 py-0.5 text-right ${r.v == null || r.red ? 'bg-red-50' : ''}`}>
                <Val v={r.v} dec={r.dec ?? dec} />
                {r.hint && <div className="text-[10px] text-red-600">{r.hint}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COVERED = new Set([
  'สถานีสูบน้ำดิบ 1 และ 2', 'สถานีสูบส่งและสูบจ่าย', 'ปริมาณน้ำระบายตะกอน', 'SERVICE WATER', 'WASH Water',
  'การใช้สารเคมี (USE / INCOME / RETURN)',
  'CHEMICAL — CHEM1 PACl', 'CHEMICAL — CHEM2 PACl', 'CHEMICAL — CHEM1 ALUM', 'CHEMICAL — CHEM2 ALUM',
  'CHEMICAL — CHEM1 Chlorine', 'CHEMICAL — CHEM2 Chlorine',
]);

function ReviewView({ date, report: d, fwsMap, issues, onBack, onClose, onExport,
  question = 'จะ export Excel DailyLab หรือไม่?', actionLabel = 'Export Excel DailyLab', busy = false, err = '', canExport = true }) {
  const dayOpen = d?.day_complete === false;
  const nIssues = issues.reduce((n, g) => n + g.items.length, 0);
  const others = issues.filter(g => !COVERED.has(g.section) && g.section !== 'Daily Report');

  const rw = d.card1_raw_water || {}, pu = d.card3_pumped || {}, sl = d.card11_sludge || {};

  // WASH Water ต่อเฟส (เหมือนการ์ดในหน้า DAILY: ปริมาณรวม, แดงเมื่อมีรอบล้างที่ข้อมูลไม่ครบ)
  const hist = fwsMap ? { P1: fwsMap.FWS1, P2: fwsMap.FWS1, P3: fwsMap.FWS2, P4: fwsMap.FWS2 } : {};
  const washRows = FWS_BW_PHASES.map((ph, i) => {
    const ev = fwsMap ? parseBWPhase(hist[ph.id], ph.base, ph.totalBeds, ph.startNo, ph.levelIds ?? null) : null;
    const bad = (ev || []).filter(e => !e.complete);
    return {
      label: `Phase ${i + 1}`,
      v: ev ? ev.reduce((s, e) => s + (e.washQty ?? 0), 0) : null,
      red: bad.length > 0,
      hint: bad.length ? `ไม่ครบ: ${bad.map(e => `#${e.no} ${e.slot}`).join(', ')}` : null,
    };
  });

  const chem = [
    { name: 'PACl', unit: 'TON', dec: 2, rows: [['CHEM1', d.card5_chem1_pacl], ['CHEM2', d.card6_chem2_pacl]].map(([s, c]) => [s, c?.in, c?.out]) },
    { name: 'Alum', unit: 'TON', dec: 2, rows: [['CHEM1', d.card9_chem1_alum], ['CHEM2', d.card10_chem2_alum]].map(([s, c]) => [s, c?.in, c?.out]) },
    { name: 'Chlorine', unit: 'kg', dec: 1, rows: [['CHEM1', d.card7_chem1_cl], ['CHEM2', d.card8_chem2_cl]].map(([s, c]) => [s, c?.in_kg, c?.use_kg]) },
  ];
  const cd = d.card14_chem_dosing || {};
  const dose = key => [1, 2, 3, 4].map(p => (key && !dayOpen ? cd[`${key}_p${p}`] : null));
  const tot = c => ({ in: sumS(...c.rows.map(r => r[1])), use: sumS(...c.rows.map(r => r[2])) });
  const summary = [
    { name: 'Alum', unit: 'TON', dec: 2, ...tot(chem[1]), doses: [['', dose('alum_actual')]] },
    { name: 'PACl', unit: 'TON', dec: 2, ...tot(chem[0]), doses: [['', dose('pacl_actual')]] },
    { name: 'Chlorine', unit: 'kg', dec: 1, ...tot(chem[2]),
      doses: [['Pre Cl2', dose('cl_actual_pre')], ['Intermediate Cl2', dose(null)], ['Post Cl2', dose('cl_actual_post')]] },
  ];

  return (
    <>
      <div className="px-4 py-3 border-b border-earth-border">
        <div className="flex items-start justify-between gap-3">
          <div className="font-bold text-earth-ink text-base">Daily Report {thaiShort(date)} {nIssues > 0 || dayOpen ? 'ข้อมูลไม่ครบ' : 'ข้อมูลครบ'}</div>
          <div className="text-[11px] text-earth-ink3 text-right lg:whitespace-nowrap pt-1">"ว่าง" = ไม่ลงค่าในฟอร์ม (เฟสที่ไม่ได้จ่ายสาร, ข้อมูลไม่พอคำนวณ หรือวันยังไม่ครบ)</div>
        </div>
        {!dayOpen && nIssues > 0 && <div className="text-earth-ink2 text-xs mt-0.5">
          หน้า Daily Report มีช่อง N/A หรือพื้นแดง {nIssues} รายการ ควรแก้ข้อมูลใน AquaDAT แล้วสร้างใหม่
        </div>}
        {dayOpen && <div className="mt-1.5 text-xs rounded bg-amber-50 border border-amber-300 text-amber-800 px-2 py-1">วันยังไม่ครบ (ก่อน 24:00) ค่าทั้งวันจึงยังเป็น N/A และจะไม่ลง Daily Dosage</div>}
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        <div className="flex-1 min-w-0 lg:overflow-y-auto px-4 py-2 space-y-2.5">
        <section>
          <div className="text-xs font-semibold text-earth-ink2 mb-1.5">1. ปริมาณน้ำ (ลบ.ม./วัน)</div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            <QtyCard title="ปริมาณน้ำดิบ" rows={[
              { label: 'เฟส 1', v: rw.phase1 }, { label: 'เฟส 2', v: rw.phase2 }, { label: 'เฟส 3', v: rw.phase3 }, { label: 'เฟส 4', v: rw.phase4 },
              { label: 'รวม', v: rw.total, bold: true }]} />
            <QtyCard title="ปริมาณน้ำสูบส่งและสูบจ่าย" rows={[
              { label: 'สูบจ่าย Line A', v: pu.dps_lineA }, { label: 'สูบจ่าย Line B', v: pu.dps_lineB }, { label: 'สูบส่ง', v: pu.tps },
              { label: 'รวม', v: pu.total, bold: true }]} />
            <QtyCard title="ปริมาณน้ำระบายตะกอน" rows={[
              { label: 'เฟส 1', v: sl.phase1 }, { label: 'เฟส 2', v: sl.phase2 }, { label: 'เฟส 3', v: sl.phase3 }, { label: 'เฟส 4', v: sl.phase4 },
              { label: 'รวม', v: sl.total, bold: true }]} />
            <QtyCard title="ปริมาณน้ำ Service water" rows={[{ label: 'Service water', v: d.summary?.service_water_m3 }]} />
            <QtyCard title="ปริมาณน้ำ WASH Water" rows={washRows} />
          </div>
        </section>

        <section>
          <div className="text-xs font-semibold text-earth-ink2 mb-1.5">2. สารเคมี IN / OUT (USE)</div>
          <table className="w-full text-xs border border-earth-border">
            <thead><tr>{['สารเคมี', 'สถานี', 'IN', 'OUT (USE)', 'หน่วย'].map(h => <th key={h} className={thCls}>{h}</th>)}</tr></thead>
            <tbody>
              {chem.flatMap(c => c.rows.map(([s, vin, vout], i) => (
                <tr key={c.name + s}>
                  {i === 0 && <td rowSpan={c.rows.length} className="px-2 py-1 border border-earth-border font-semibold text-earth-ink">{c.name}</td>}
                  <td className="px-2 py-1 border border-earth-border text-earth-ink2">{s}</td>
                  <td className={cellCls(vin)}><Val v={vin} dec={c.dec} /></td>
                  <td className={cellCls(vout)}><Val v={vout} dec={c.dec} /></td>
                  <td className="px-2 py-1 border border-earth-border text-earth-ink3 text-center">{c.unit}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </section>

        <section>
          <div className="text-xs font-semibold text-earth-ink2 mb-1.5">3. สรุปสารเคมี · Daily Dosage ที่จะลงฟอร์ม (mg/l, ACTUAL)</div>
          <table className="w-full text-xs border border-earth-border">
            <thead><tr>{['สารเคมี', 'IN รวม', 'USE รวม', '', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'].map((h, i) => <th key={i} className={thCls}>{h}</th>)}</tr></thead>
            <tbody>
              {summary.flatMap(s => s.doses.map(([sub, vals], i) => (
                <tr key={s.name + sub}>
                  {i === 0 && <>
                    <td rowSpan={s.doses.length} className="px-2 py-1 border border-earth-border font-semibold text-earth-ink">{s.name}</td>
                    <td rowSpan={s.doses.length} className={cellCls(s.in)}><Val v={s.in} dec={s.dec} unit={s.unit} /></td>
                    <td rowSpan={s.doses.length} className={cellCls(s.use)}><Val v={s.use} dec={s.dec} unit={s.unit} /></td>
                  </>}
                  <td className="px-2 py-1 border border-earth-border text-earth-ink2 whitespace-nowrap">{sub || 'Dosage'}</td>
                  {vals.map((v, p) => (
                    <td key={p} className="px-2 py-1 border border-earth-border text-center font-mono text-earth-ink">
                      {v == null ? <span className="text-earth-ink3">ว่าง</span> : v.toFixed(2)}
                    </td>
                  ))}
                </tr>
              )))}
            </tbody>
          </table>
        </section>

        {others.length > 0 && (
          <section>
            <div className="text-xs font-semibold text-earth-ink2 mb-1.5">N/A อื่นในหน้า Daily Report</div>
            <div className="space-y-1">
              {others.map(g => (
                <div key={g.section} className="text-xs">
                  <span className="text-red-700 font-semibold">{g.section}:</span>{' '}
                  <span className="text-earth-ink2">{g.items.join(', ')}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        </div>

        {/* ขวา: C. CHEMICAL ACCURACY WALL (component เดียวกับหน้า DAILY) */}
        <div className="shrink-0 lg:w-[580px] border-t lg:border-t-0 lg:border-l border-earth-border overflow-y-auto">
          <ChemAccuracyWall rows={buildChemDonutRows(d)} className="min-h-full" />
        </div>
      </div>

      <div className="px-4 py-3 border-t border-earth-border flex items-center justify-end gap-2">
        <span className="mr-auto text-earth-ink2">{err ? <span className="text-red-600 text-xs">{err}</span> : canExport ? question : 'วันยังไม่ครบ — ยังบันทึกไม่ได้'}</span>
        <button onClick={onBack} disabled={busy} className="px-3 py-1.5 rounded-lg border border-earth-border text-earth-ink2 hover:bg-earth disabled:opacity-50">ย้อนกลับ</button>
        <button onClick={onClose} disabled={busy} className="px-3 py-1.5 rounded-lg border border-earth-border text-earth-ink2 hover:bg-earth disabled:opacity-50">ยกเลิก</button>
        <button onClick={onExport} disabled={busy || !canExport} className="px-3 py-1.5 rounded-lg bg-green-700 text-white font-bold hover:bg-green-800 disabled:opacity-50">{actionLabel}</button>
      </div>
    </>
  );
}
