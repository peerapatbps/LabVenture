import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { get, post, put, patch, del, BASE } from '../api.js';
import { CAR_PREFIXES } from '../config/carPrefixes.js';
import { CAR_UNITS, CAR_UNIT_OTHER } from '../config/carUnits.js';

// ─── Status system ─────────────────────────────────────────────────────────

const STATUS = {
  10: { label: 'ออกใบแล้ว',   color: 'bg-blue-100 text-blue-700 border-blue-200' },
  15: { label: 'ส่งต่อแล้ว',   color: 'bg-sky-100 text-sky-700 border-sky-200' },
  20: { label: 'รออนุมัติ',    color: 'bg-orange-100 text-orange-700 border-orange-200' },
  30: { label: 'รอติดตาม#1', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  40: { label: 'รอติดตาม#2', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  50: { label: 'แก้ไขแล้ว',   color: 'bg-teal-100 text-teal-700 border-teal-200' },
  60: { label: 'ปิด',         color: 'bg-green-100 text-green-700 border-green-200' },
  70: { label: 'ตีกลับ',      color: 'bg-red-100 text-red-700 border-red-200' },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function isOverdue(deadline, code) {
  if (!deadline || code >= 60) return false;
  return new Date(deadline) < new Date();
}

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

// filled from the original Excel forms (server/templates) — xlsx download / pdf exported by Excel
const carFormUrl = (id, fmt) => `${BASE}/api/car/${id}/form/${fmt}`;
const carLogUrl = (fmt, fy, system) => `${BASE}/api/car/log/${fmt}?fy=${fy}${system ? `&system=${encodeURIComponent(system)}` : ''}`;
// Thai fiscal year (BE): 1 Oct starts the next year — same rule as server carCreate.fiscalYearBE
const fiscalYearBE = (d = new Date()) => d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0);
const FILE_BTN = {
  xlsx: 'inline-block px-3 py-1 rounded-lg border border-green-700 text-green-700 text-xs font-bold hover:bg-green-50',
  pdf: 'inline-block px-3 py-1 rounded-lg border border-red-700 text-red-700 text-xs font-bold hover:bg-red-50',
};

function FileButtons({ url }) {
  return (
    <span className="whitespace-nowrap space-x-2">
      <a href={url('xlsx')} className={FILE_BTN.xlsx}>Excel</a>
      <a href={url('pdf')} target="_blank" rel="noreferrer" className={FILE_BTN.pdf}>PDF</a>
    </span>
  );
}

// ทะเบียน CAR/PAR (สบค-09) by fiscal year × system
function LogExport({ cars }) {
  const [fy, setFy] = useState(fiscalYearBE());
  const [system, setSystem] = useState('');
  const years = useMemo(() => {
    const ys = new Set([fiscalYearBE()]);
    for (const c of cars) if (c.issued_at) ys.add(fiscalYearBE(new Date(String(c.issued_at).replace(' ', 'T') + 'Z')));
    return [...ys].sort((a, b) => b - a);
  }, [cars]);
  const sel = 'border border-earth-border rounded-lg px-2 py-1 text-sm bg-earth-card';
  return (
    <div className="flex items-center gap-2 flex-wrap bg-earth-DEFAULT border border-earth-border rounded-xl px-4 py-2.5">
      <span className="text-sm font-semibold text-earth-ink">ทะเบียน CAR/PAR (สบค-09)</span>
      <select value={fy} onChange={e => setFy(Number(e.target.value))} className={sel}>
        {years.map(y => <option key={y} value={y}>ปีงบ {y}</option>)}
      </select>
      <select value={system} onChange={e => setSystem(e.target.value)} className={sel}>
        <option value="">ทุกระบบ</option>
        <option>HACCP</option>
        <option>ISO14001:2015</option>
        <option>ISO45001:2018</option>
      </select>
      <span className="ml-auto"><FileButtons url={fmt => carLogUrl(fmt, fy, system)} /></span>
    </div>
  );
}

function parseFd(car) {
  try { return JSON.parse(car.form_data || '{}'); } catch { return {}; }
}

// ─── Progress stage dots ──────────────────────────────────────────────────

function ProgressStages({ car }) {
  const raw = car.status_code || 10;
  const code = raw === 15 ? 10 : raw;   // 15 (ส่งต่อ) ยังอยู่ขั้นที่ 1
  const stages = [10, 20, 30, 40, 50];

  return (
    <div className="flex items-center gap-0.5 mt-2">
      {stages.map((s, i) => {
        const done = code > s;
        const active = code === s;
        return (
          <React.Fragment key={s}>
            {i > 0 && <div className={`h-px w-2.5 ${done ? 'bg-brand' : 'bg-gray-200'}`} />}
            <div title={STATUS[s]?.label}
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border
                ${done ? 'bg-brand text-white border-brand'
                  : active ? 'bg-white text-brand border-brand ring-1 ring-brand ring-offset-1'
                  : 'bg-earth-card text-earth-ink3 border-earth-border'}`}>
              {s / 10}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Mini calendar ────────────────────────────────────────────────────────

const TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function MiniCalendar({ year, month, events, selectedDate, onDateClick }) {
  const firstDow = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isToday = d => today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
  const toDateStr = d => `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const isSelected = d => d && selectedDate === toDateStr(d);

  const byDay = {};
  for (const ev of events) {
    if (!ev.date) continue;
    const dt = new Date(ev.date);
    if (dt.getFullYear() === year && dt.getMonth() === month) {
      const d = dt.getDate();
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(ev);
    }
  }

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= lastDate; d++) cells.push(d);
  // pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);
  const weekRows = cells.length / 7;

  return (
    <div className="bg-earth-card rounded-xl px-3 pt-3 pb-2 shadow-sm border border-earth-border flex flex-col h-full">
      {/* Month header */}
      <p className="text-base font-bold text-earth-ink text-center mb-1.5 shrink-0">
        {TH_MONTHS[month]} {year + 543}
      </p>

      {/* Day-name row */}
      <div className="grid grid-cols-7 shrink-0 mb-0.5">
        {['อา','จ','อ','พ','พฤ','ศ','ส'].map(d => (
          <div key={d} className="text-center text-xs font-semibold text-earth-ink3">{d}</div>
        ))}
      </div>

      {/* Date grid — fills remaining height */}
      <div
        className="grid grid-cols-7 flex-1"
        style={{ gridTemplateRows: `repeat(${weekRows}, 1fr)` }}
      >
        {cells.map((d, i) => {
          const evs = d ? (byDay[d] || []) : [];
          return (
            <div key={i}
              onClick={() => d && onDateClick?.(isSelected(d) ? null : toDateStr(d))}
              className={`flex flex-col items-center justify-center rounded-lg mx-0.5 my-0.5 transition-colors
                ${d ? 'cursor-pointer hover:bg-earth-card' : ''}
                ${d && isSelected(d) ? 'bg-brand text-white ring-2 ring-brand' : ''}
                ${d && isToday(d) && !isSelected(d) ? 'bg-brand/10 ring-1 ring-brand/30' : ''}`}>
              {d && (
                <>
                  <span className={`text-sm font-medium leading-none
                    ${isSelected(d) ? 'text-white font-bold' : isToday(d) ? 'font-extrabold text-brand' : 'text-earth-ink'}`}>
                    {d}
                  </span>
                  {evs.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-0.5 mt-1">
                      {evs.map((ev, j) => (
                        <div key={j} title={ev.label}
                          className={`w-2 h-2 rounded-full ${
                            ev.type === 'deadline'   ? 'bg-red-500'
                          : ev.type === 'correction' ? 'bg-orange-400'
                          : ev.type === 'prevention' ? 'bg-green-500'
                          : 'bg-purple-400'}`} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 border-t border-earth-border pt-1 mt-1 shrink-0">
        {[['bg-red-500','Deadline'],['bg-orange-400','แก้ไข'],['bg-green-500','ป้องกัน'],['bg-purple-400','ติดตาม#2']].map(([c,l]) => (
          <div key={l} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${c}`} />
            <span className="text-xs text-earth-ink2">{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Car card ─────────────────────────────────────────────────────────────

// โลโก้ LINE (ฟองคำพูดสีขาวบนพื้นเขียว)
function LineIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="5.5" fill="#06C755" />
      <path fill="#fff" d="M12 4.6c-4.3 0-7.8 2.8-7.8 6.3 0 3.1 2.8 5.7 6.5 6.2.3.1.6.2.7.4.1.2.1.5 0 .7l-.1.7c0 .2-.2.8.7.4.9-.4 4.8-2.8 6.5-4.8 1.2-1.3 1.7-2.6 1.7-4 0-3.1-3.5-5.9-8.2-5.9z" />
      <path fill="#06C755" d="M7.3 12.9h1.6c.2 0 .3-.1.3-.3s-.1-.3-.3-.3H7.7V9.5c0-.2-.1-.3-.3-.3s-.3.1-.3.3v3.1c0 .2.1.3.2.3zm2.6-3.4c-.2 0-.3.1-.3.3v3.1c0 .2.1.3.3.3s.3-.1.3-.3V9.8c0-.2-.1-.3-.3-.3zm3.8 0c-.2 0-.3.1-.3.3v1.9l-1.6-2.1c-.1-.1-.2-.1-.3-.1-.2 0-.3.1-.3.3v3.1c0 .2.1.3.3.3s.3-.1.3-.3v-1.9l1.6 2.1c.1.1.2.1.3.1.2 0 .3-.1.3-.3V9.8c0-.2-.1-.3-.3-.3zm2.5 1.1c.2 0 .3-.1.3-.3s-.1-.3-.3-.3h-1.6c-.2 0-.3.1-.3.3v3.1c0 .2.1.3.3.3h1.6c.2 0 .3-.1.3-.3s-.1-.3-.3-.3h-1.3v-.6h1.3c.2 0 .3-.1.3-.3s-.1-.3-.3-.3h-1.3v-.6h1.3z" />
    </svg>
  );
}

function CarCard({ car, onClick, onResendLine, onCopyUrl }) {
  const code = car.status_code || 10;
  const st = STATUS[code] || STATUS[10];
  const overdue = isOverdue(car.deadline_at, code);

  return (
    <div onClick={onClick}
      className={`bg-earth-DEFAULT rounded-xl px-4 py-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow
        ${overdue ? 'border-red-300' : 'border-earth-border'}`}>
      {/* Row 1: number · dates · key  |  badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap text-sm min-w-0">
          <span className="font-semibold text-earth-ink shrink-0">{car.car_number || '(ยังไม่ระบุเลข)'}</span>
          <span className="text-earth-ink3 shrink-0">ออกใบ: {fmtDate(car.issued_at)}</span>
          {car.deadline_at && (
            <span className={`shrink-0 ${overdue ? 'text-red-500 font-semibold' : 'text-earth-ink3'}`}>
              Deadline: {fmtDate(car.deadline_at)}{overdue ? ' ⚠' : ''}
            </span>
          )}
          <span className="text-earth-ink3 font-mono text-xs shrink-0">({car.unique_key})</span>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border ${st.color}`}>
          {st.label}
        </span>
      </div>
      {/* Row 2: description */}
      {car.parameter_name && (
        <p className="text-sm text-earth-ink mt-1 line-clamp-1">{car.parameter_name}</p>
      )}
      {/* Row 3: progress · ใบ CAR (สบค-08) files — clicks here must not open the slide panel */}
      <div className="flex items-end justify-between gap-2">
        <ProgressStages car={car} />
        <span onClick={e => e.stopPropagation()} className="flex items-center gap-1.5">
          {onResendLine && (
            <button type="button" onClick={() => onResendLine(car)} title="ส่ง LINE ซ้ำ (re-send)"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-earth-border bg-white hover:bg-green-50 hover:border-green-300">
              <LineIcon />
            </button>
          )}
          {onCopyUrl && (
            <button type="button" onClick={() => onCopyUrl(car)} title="คัดลอก URL ของ CAR นี้"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-earth-border bg-white text-earth-ink2 hover:bg-earth-card">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
                <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
              </svg>
            </button>
          )}
          <FileButtons url={fmt => carFormUrl(car.id, fmt)} />
        </span>
      </div>
    </div>
  );
}

// คัดลอกข้อความ — navigator.clipboard ใช้ได้เฉพาะ https/localhost; เครื่อง deploy เป็น http → fallback execCommand
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

// dialog ยืนยันการส่ง LINE ซ้ำ / ลบ CAR — แสดงสรุปใบ CAR ให้เห็นก่อนกด
function CarConfirmDialog({ kind, car, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const isLine = kind === 'line';
  const code = car.status_code || 10;
  const st = STATUS[code] || STATUS[10];
  const run = async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} />
      <div role="dialog" aria-modal="true"
        className="relative w-full max-w-md bg-earth-card rounded-2xl shadow-2xl border border-earth-border overflow-hidden">
        {/* header */}
        <div className={`flex items-center gap-3 px-5 py-4 border-b ${isLine ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          {isLine
            ? <LineIcon className="w-9 h-9 shrink-0" />
            : <span className="w-9 h-9 shrink-0 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-lg">🗑</span>}
          <div>
            <h3 className={`font-semibold ${isLine ? 'text-green-900' : 'text-red-900'}`}>
              {isLine ? 'ส่งแจ้งเตือน LINE ซ้ำ' : 'ลบ CAR ถาวร'}
            </h3>
            <p className={`text-xs ${isLine ? 'text-green-700' : 'text-red-700'}`}>
              {isLine ? 'ข้อความตามสถานะปัจจุบันจะถูกส่งเข้ากลุ่ม LINE' : 'ลบทั้งใบและประวัติสถานะ — กู้คืนไม่ได้'}
            </p>
          </div>
        </div>

        {/* CAR summary */}
        <div className="px-5 py-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-earth-ink">{car.car_number || '(ยังไม่ระบุเลข)'}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${st.color}`}>{st.label}</span>
          </div>
          {car.parameter_name && <p className="text-sm text-earth-ink line-clamp-2">{car.parameter_name}</p>}
          <div className="text-xs text-earth-ink3 space-y-0.5">
            {car.receiver_name && <p>ผู้รับ: {car.receiver_name}{car.receiver_dept ? ` (${car.receiver_dept})` : ''}</p>}
            <p>ออกใบ: {fmtDate(car.issued_at)}{car.line_sent_at ? ` · ส่ง LINE ล่าสุด: ${String(car.line_sent_at).slice(0, 16).replace('T', ' ')}` : ''}</p>
          </div>
        </div>

        {/* actions */}
        <div className="flex justify-end gap-2 px-5 py-3 bg-earth-DEFAULT border-t border-earth-border">
          {/* ลบ: โฟกัสที่ "ยกเลิก" กัน Enter แล้วลบโดยไม่ตั้งใจ */}
          <button type="button" onClick={onCancel} disabled={busy} autoFocus={!isLine}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-earth-border bg-white text-earth-ink hover:bg-earth-card disabled:opacity-50">
            ยกเลิก
          </button>
          <button type="button" onClick={run} disabled={busy} autoFocus={isLine}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 flex items-center gap-2
              ${isLine ? 'bg-[#06C755] hover:bg-[#05b14c]' : 'bg-red-600 hover:bg-red-700'}`}>
            {busy && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
            {busy ? (isLine ? 'กำลังส่ง…' : 'กำลังลบ…') : (isLine ? 'ส่ง LINE' : 'ลบถาวร')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ป้ายข้อความกลางจอ แสดง ~2 วินาทีแล้วค่อย ๆ จางหาย
function CenterToast({ toast }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
      <div className={`px-5 py-3 rounded-xl shadow-2xl text-sm font-medium text-white transition-opacity duration-500
        ${toast.error ? 'bg-red-600' : 'bg-gray-900/90'} ${visible ? 'opacity-100' : 'opacity-0'}`}>
        {toast.text}
      </div>
    </div>
  );
}

// ─── Bucket ───────────────────────────────────────────────────────────────

function Bucket({ title, cars, onSelect, badge, onResendLine, onCopyUrl }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-earth-ink2 uppercase tracking-wide">{title}</h2>
        <span className="px-1.5 py-0.5 bg-earth-card text-earth-ink3 text-xs rounded-full font-medium">{badge}</span>
      </div>
      {cars.length === 0
        ? <div className="text-center py-3 text-earth-ink3 text-sm border border-dashed border-earth-border rounded-xl">— ไม่มีรายการ —</div>
        : <div className="space-y-2">{cars.map(c => <CarCard key={c.id} car={c} onClick={() => onSelect(c)} onResendLine={onResendLine} onCopyUrl={onCopyUrl} />)}</div>
      }
    </div>
  );
}

// ─── Form primitives ──────────────────────────────────────────────────────

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs text-earth-ink3 mb-0.5">{label}</p>
      <p className="text-sm text-earth-ink whitespace-pre-wrap">{value || '—'}</p>
    </div>
  );
}

function Inp({ label, name, value, onChange, type = 'text', required, cls = '', readOnly = false }) {
  return (
    <div className={cls}>
      <label className="block text-xs font-medium text-earth-ink2 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        {readOnly && <span className="ml-1 text-earth-ink3 font-normal">(อัตโนมัติ)</span>}
      </label>
      <input type={type} name={name} value={value || ''} onChange={readOnly ? undefined : onChange}
        readOnly={readOnly}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand
          ${readOnly ? 'border-earth-border bg-earth-card text-earth-ink3 cursor-default' : 'border-earth-border'}`} />
    </div>
  );
}

function Txt({ label, name, value, onChange, rows = 3, cls = '' }) {
  return (
    <div className={cls}>
      <label className="block text-xs font-medium text-earth-ink2 mb-1">{label}</label>
      <textarea name={name} value={value || ''} onChange={onChange} rows={rows}
        className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
    </div>
  );
}

function SecHeader({ n, title, active }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${active ? 'bg-brand/10' : 'bg-earth-DEFAULT'}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0
        ${active ? 'bg-brand text-white' : 'bg-earth-card text-earth-ink3'}`}>{n}</div>
      <span className={`text-sm font-semibold ${active ? 'text-brand' : 'text-earth-ink2'}`}>{title}</span>
      {active && <span className="ml-auto text-xs text-brand font-medium">รอดำเนินการ</span>}
    </div>
  );
}

function SaveBtn({ onClick, disabled, color = 'bg-brand hover:bg-sky-700', children }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full ${color} disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm`}>
      {children}
    </button>
  );
}

// ─── ตัวเลือกบุคคล: [กลุ่ม] [ชื่อ-สกุล] [ส่วน/กอง] ─────────────────────────
// กลุ่ม: ผลัด 1-4 / ผู้ปฏิบัติงาน (ลูกจ้าง AquaDAT) → ชื่อจาก whitelist · อื่นๆ → พิมพ์ชื่อและส่วน/กองเอง
// row = { group: '1'..'4' | 'worker' | 'other' | '', name, dept }
const PERSON_GROUPS = [['1', 'ผลัด 1'], ['2', 'ผลัด 2'], ['3', 'ผลัด 3'], ['4', 'ผลัด 4'], ['worker', 'ผู้ปฏิบัติงาน'], ['other', 'อื่นๆ']];
const blankPerson = () => ({ group: '', name: '', dept: '' });
const personText = p => `${p.name}${p.dept ? ` (${p.dept})` : ''}`;
const namesOf = rows => (rows || []).filter(p => p.name?.trim()).map(p => p.name.trim()).join(', ');
// ข้อความเดิม (คั่นด้วย , หรือขึ้นบรรทัด) → แถว "อื่นๆ"
const personsFromText = s => String(s || '').split(/[,\n]+/).map(x => x.trim()).filter(Boolean)
  .map(name => ({ group: 'other', name, dept: '' }));

function useReceivers() {
  const { data = [] } = useQuery({
    queryKey: ['car-receivers'],
    queryFn: () => get('/api/car-admin/receivers'),
    staleTime: 60 * 1000,
  });
  return data;
}

function PersonRow({ row, onChange, receivers, defaultHead = false, label }) {
  const grp = receivers.find(r => String(r.shift) === String(row.group));
  const cls = 'w-full min-w-0 border border-earth-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand';
  const isOther = row.group === 'other';
  return (
    <>
      <select value={row.group} aria-label={`${label} — กลุ่ม`} className={cls}
        onChange={e => {
          const g = e.target.value;
          const r = receivers.find(x => String(x.shift) === g);
          onChange({
            group: g,
            name: g === 'other' ? row.name : (defaultHead && r?.head) || '',
            dept: g === 'other' ? row.dept : (r?.dept_label || ''),
          });
        }}>
        <option value="">— กลุ่ม —</option>
        {PERSON_GROUPS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      {isOther || !row.group ? (
        <input value={row.name} disabled={!row.group} placeholder={row.group ? 'พิมพ์ชื่อ-สกุล' : 'เลือกกลุ่มก่อน'}
          aria-label={`${label} — ชื่อ`} onChange={e => onChange({ ...row, name: e.target.value })}
          className={`${cls} disabled:bg-earth-card`} />
      ) : (
        <select value={row.name} aria-label={`${label} — ชื่อ`} className={cls}
          onChange={e => onChange({ ...row, name: e.target.value })}>
          <option value="">{grp?.members.length ? '— เลือกชื่อ —' : 'ไม่มีรายชื่อ — Sync ที่หน้า Config'}</option>
          {row.name && !grp?.members.some(m => m.name === row.name) && <option value={row.name}>{row.name}</option>}
          {grp?.members.map(m => <option key={m.name} value={m.name}>{m.name}{m.position ? ` (${m.position})` : ''}</option>)}
        </select>
      )}
      {(() => {
        const ro = !!row.group && !isOther && row.group !== 'worker';   // ผลัด 1-4 = จาก whitelist; ผู้ปฏิบัติงาน/อื่นๆ แก้ได้
        return (
          <input value={row.dept} readOnly={ro} placeholder="ส่วน/กอง" aria-label={`${label} — ส่วน/กอง`}
            onChange={e => onChange({ ...row, dept: e.target.value })}
            className={`${cls} ${ro ? 'bg-earth-card text-earth-ink3' : ''}`} />
        );
      })()}
    </>
  );
}

// หลายคน + ปุ่ม "+" อยู่ท้ายบรรทัดล่าสุด
function PersonRows({ label, rows, onChange, receivers }) {
  const list = rows?.length ? rows : [blankPerson()];
  const set = (i, v) => onChange(list.map((r, k) => (k === i ? v : r)));
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-earth-ink2">{label}</label>
      {list.map((row, i) => (
        <div key={i} className="grid grid-cols-[8.5rem_minmax(0,1.4fr)_minmax(0,1fr)_5rem] gap-2 items-center">
          <PersonRow row={row} onChange={v => set(i, v)} receivers={receivers} label={`${label} ${i + 1}`} />
          <div className="flex gap-1">
            {list.length > 1 && (
              <button type="button" title="ลบบรรทัดนี้" onClick={() => onChange(list.filter((_, k) => k !== i))}
                className="w-9 h-9 rounded-lg border border-earth-border text-earth-ink3 hover:text-red-600 hover:border-red-300">−</button>
            )}
            {i === list.length - 1 && (
              <button type="button" title="เพิ่มบรรทัด" onClick={() => onChange([...list, blankPerson()])}
                className="w-9 h-9 rounded-lg bg-brand text-white hover:bg-sky-700 text-lg leading-none">+</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// popup กลางจอ: ผู้รับไม้แรกเปิดใบที่ส่งต่อไปแล้ว
function ForwardedLockDialog({ holder, forwardedAt, onUnlock, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true"
        className="relative w-full max-w-md bg-earth-card rounded-2xl shadow-2xl border border-earth-border overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 bg-sky-50 border-b border-sky-100">
          <span className="w-9 h-9 shrink-0 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-lg">🔒</span>
          <h3 className="font-semibold text-sky-900">CAR นี้ถูกส่งต่อแล้ว</h3>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm text-earth-ink">
          <p>
            CAR นี้ถูกส่งมอบให้ <b>{holder.name}</b>{holder.dept ? ` (${holder.dept})` : ''} เป็นผู้ตอบ
            {forwardedAt ? <> เมื่อวันที่ <b>{String(forwardedAt).slice(0, 16).replace('T', ' ')}</b></> : null}
          </p>
          <p className="text-earth-ink2">หากต้องการดำเนินการด้วยตนเอง ให้ทำการปลดล็อก</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 bg-earth-DEFAULT border-t border-earth-border">
          <button type="button" onClick={onClose} disabled={busy} autoFocus
            className="px-4 py-2 rounded-lg text-sm font-medium border border-earth-border bg-white text-earth-ink hover:bg-earth-card disabled:opacity-50">
            ดูอย่างเดียว
          </button>
          <button type="button" disabled={busy}
            onClick={async () => { setBusy(true); try { await onUnlock(); } finally { setBusy(false); } }}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 flex items-center gap-2">
            {busy && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
            🔓 ปลดล็อก
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Slide panel ──────────────────────────────────────────────────────────

function CarSlidePanel({ car, onClose, onUpdate, saving, carUser, onEdit, onDelete, onForward, onReclaim }) {
  const code = car.status_code || 10;
  const fd = parseFd(car);

  const cu = carUser || {};
  const cuGroups = cu.groups || (cu.group ? [cu.group] : []);
  const isG1 = cuGroups.includes('1') || cu.isAdmin;
  const isG2 = cuGroups.includes('2') || cu.isAdmin;
  const isG3a = cuGroups.includes('3a') || cu.isAdmin;
  const isG3b = cuGroups.includes('3b') || cu.isAdmin;
  const isObserver = !!cu.isObserver;

  // ── ผู้ถือใบ / ส่งต่อ (status 15) ──
  const receivers = useReceivers();
  const holder = car.assignee_name
    ? { name: car.assignee_name, dept: car.assignee_dept || '' }
    : { name: car.receiver_name || '', dept: car.receiver_dept || '' };
  const forwards = Array.isArray(fd.s2_forwards) ? fd.s2_forwards : [];
  const lastForward = [...forwards].reverse().find(f => f.type === 'forward');
  const holderShift = Number(/สคน(\d)กผจ/.exec(holder.dept)?.[1]) || null;
  // ผู้รับไม้แรกเปิดใบที่ส่งต่อไปแล้ว → popup กลางจอ + ปลดล็อกได้ (Admin ไม่ถูกล็อก)
  const isFirstReceiverLocked = code === 15 && !cu.isAdmin && !!cu.name && cu.name === car.receiver_name && cu.name !== holder.name;
  // ตอบ/ส่งต่อได้: Admin · ผู้ถือใบ · กลุ่ม 2 ผลัดเดียวกับผู้ถือ (เหมือนกติกาฝั่ง server canHold)
  const canAct = !isObserver && (cu.isAdmin || (!isFirstReceiverLocked && ((!!cu.name && cu.name === holder.name)
    || (cuGroups.includes('2') && (cu.bypass || (!!holderShift && Number(cu.shift) === holderShift))))));
  const [lockOpen, setLockOpen] = useState(isFirstReceiverLocked);
  const [fwdOpen, setFwdOpen] = useState(false);
  const [fwd, setFwd] = useState(blankPerson());
  const [fwdReason, setFwdReason] = useState('');
  const [fwdBusy, setFwdBusy] = useState(false);

  // Section 2 — respondent (ผู้เข้าประชุม / ผู้รับผิดชอบ เป็นรายการบุคคล; CAR เก่าแปลงจากข้อความ)
  const [s2, setS2] = useState({
    s2_attendees: Array.isArray(fd.s2_attendees) ? fd.s2_attendees : personsFromText(fd.s2_meeting_members),
    s2_root_cause: fd.s2_root_cause || '',
    s2_correction: fd.s2_correction || '',
    s2_correction_deadline: fd.s2_correction_deadline || '',
    s2_correction_owners: Array.isArray(fd.s2_correction_owners) ? fd.s2_correction_owners : personsFromText(fd.s2_correction_owner),
    s2_prevention: fd.s2_prevention || '',
    s2_prevention_deadline: fd.s2_prevention_deadline || '',
    s2_prevention_owners: Array.isArray(fd.s2_prevention_owners) ? fd.s2_prevention_owners : personsFromText(fd.s2_prevention_owner),
    s2_respondent: fd.s2_respondent || cu.name || '',
    s2_respondent_pos: fd.s2_respondent_pos || cu.deptLabel || '',
    s2_responded_at: fd.s2_responded_at || new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10),
  });
  // บันทึก: เก็บรายการบุคคล + ข้อความเดิม (ชื่อคั่นด้วย ,) ให้ใบ สบค-08 / CAR เก่าใช้ต่อได้
  const s2Payload = () => {
    const clean = rows => (rows || []).filter(p => p.name?.trim()).map(p => ({ ...p, name: p.name.trim(), dept: (p.dept || '').trim() }));
    const att = clean(s2.s2_attendees), co = clean(s2.s2_correction_owners), po = clean(s2.s2_prevention_owners);
    return {
      ...s2,
      s2_attendees: att, s2_correction_owners: co, s2_prevention_owners: po,
      s2_meeting_members: namesOf(att), s2_correction_owner: namesOf(co), s2_prevention_owner: namesOf(po),
    };
  };
  // Section 2 — approver
  const [s2a, setS2a] = useState({
    s2_approver: fd.s2_approver || (isG3a && cu.name ? cu.name : ''),
    s2_approved_at: fd.s2_approved_at || new Date().toISOString().slice(0, 10),
  });
  // Section 4 — check 1
  const [s4a, setS4a] = useState({
    s4_check1_result: fd.s4_check1_result || '',
    s4_check1_notes: fd.s4_check1_notes || '',
    s4_check1_date: fd.s4_check1_date || new Date().toISOString().slice(0, 10),
    s4_check1_by: fd.s4_check1_by || (isG1 && cu.name ? cu.name : ''),
    s4_check1_by_pos: fd.s4_check1_by_pos || (isG1 && cu.deptLabel ? cu.deptLabel : ''),
    s4_check2_deadline: fd.s4_check2_deadline || '',
    s4_check2_owner: fd.s4_check2_owner || '',
  });
  // Section 4 — check 2
  const [s4b, setS4b] = useState({
    s4_check2_result: fd.s4_check2_result || '',
    s4_check2_notes: fd.s4_check2_notes || '',
    s4_check2_date: fd.s4_check2_date || new Date().toISOString().slice(0, 10),
    s4_check2_by: fd.s4_check2_by || (isG1 && cu.name ? cu.name : ''),
    s4_check2_by_pos: fd.s4_check2_by_pos || (isG1 && cu.deptLabel ? cu.deptLabel : ''),
  });
  // Section 5
  const [s5, setS5] = useState({
    s5_decision: fd.s5_decision || '',
    s5_reason: fd.s5_reason || '',
    s5_action: fd.s5_action || '',
    s5_approver: fd.s5_approver || (isG3b && cu.name ? cu.name : ''),
    s5_approved_at: fd.s5_approved_at || new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // ค่าที่พบหลายบรรทัด (car.findings JSON) — CAR เก่าที่ไม่มี findings ใช้ค่าเดี่ยวเดิม
  const findings = (() => {
    try { const a = JSON.parse(car.findings || 'null'); if (Array.isArray(a) && a.length) return a; } catch { /* ignore */ }
    return car.recorded_value != null
      ? [{ value: car.recorded_value, direction: car.threshold_direction === 'below' ? 'below' : 'above', threshold: car.threshold_value, unit: '' }]
      : [];
  })();
  const fmtFinding = f => {
    const u = f.unit ? ` ${f.unit}` : '';
    const dir = f.direction === 'below' ? '≥' : '≤';
    return `${f.value ?? '—'}${f.value != null ? u : ''}${f.threshold != null ? ` (เกณฑ์: ${dir} ${f.threshold}${u})` : ''}`;
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-3/4 bg-earth-card z-50 shadow-2xl flex flex-col">

        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-earth-border shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-earth-ink">{car.car_number || '(ยังไม่ระบุเลข)'}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS[code]?.color}`}>
                {STATUS[code]?.label}
              </span>
            </div>
            <p className="text-xs text-earth-ink3 font-mono mt-0.5">{car.unique_key}</p>
          </div>
          <div className="ml-auto mr-3 flex items-center gap-2">
            <span className="text-xs text-earth-ink3">ใบ {car.car_type || 'CAR'} (สบค-08)</span>
            <FileButtons url={fmt => carFormUrl(car.id, fmt)} />
            {cu.isAdmin && !isObserver && (
              <>
                <button onClick={() => onEdit?.(car)} title="แก้ไขส่วนที่ 1"
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-earth-border bg-white text-earth-ink hover:bg-earth-DEFAULT">
                  ✎ แก้ไข
                </button>
                <button onClick={() => onDelete?.(car)} title="ลบ CAR ถาวร"
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 bg-red-50 text-red-600 hover:bg-red-100">
                  🗑 ลบ
                </button>
              </>
            )}
          </div>
          <button onClick={onClose} className="text-earth-ink3 hover:text-earth-ink text-xl leading-none px-2">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Key dates */}
          <div className="grid grid-cols-2 gap-3 bg-earth-DEFAULT rounded-xl p-3 text-sm">
            <Field label="วันที่ออกใบ" value={fmtDate(car.issued_at)} />
            <Field label="Deadline" value={fmtDate(car.deadline_at)} />
            {car.correction_deadline && <Field label="กำหนดแก้ไขเสร็จ" value={fmtDate(car.correction_deadline)} />}
            {car.prevention_deadline && <Field label="กำหนดป้องกันเสร็จ" value={fmtDate(car.prevention_deadline)} />}
            {car.followup2_deadline && <Field label="กำหนดติดตาม#2" value={fmtDate(car.followup2_deadline)} />}
          </div>

          {/* ── Section 1 ── */}
          <SecHeader n="1" title="รายละเอียดสิ่งที่ไม่เป็นไปตามข้อกำหนด" active={false} />
          <div className="grid grid-cols-2 gap-3 px-1">
            <Field label="ประเภท" value={`${car.car_type || 'CAR'}${car.system_type ? ` · ${car.system_type}` : ''}`} />
            <Field label="ประเภทปัญหา" value={car.issue_type} />
            <div className="col-span-2"><Field label="1.1 เรื่องที่พบ" value={car.parameter_name} /></div>
            {findings.length > 0 && (
              <div className="col-span-2">
                <Field label="ค่าที่พบ"
                  value={findings.length === 1 ? fmtFinding(findings[0]) : findings.map((f, i) => `${i + 1}) ${fmtFinding(f)}`).join('\n')} />
              </div>
            )}
            <Field label="1.2 ผู้ออก" value={`${car.issuer_name || '—'}${car.issuer_dept ? ` (${car.issuer_dept})` : ''}`} />
            <Field label="1.3 ผู้รับ" value={`${car.receiver_name || '—'}${car.receiver_dept ? ` (${car.receiver_dept})` : ''}`} />
          </div>

          {/* ── Section 2 ── */}
          <SecHeader n="2" title="วิเคราะห์หาสาเหตุ และกำหนดแผนการแก้ไขและป้องกัน" active={code <= 20} />

          {/* ผู้ถือใบ + ประวัติการส่งต่อ */}
          {(code === 10 || code === 15 || forwards.length > 0) && (
            <div className="mx-1 rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50 to-white overflow-hidden">
              {/* ผู้รับปัจจุบัน + ปุ่มส่งต่อ / ปลดล็อก */}
              {(code === 10 || code === 15) && (
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="w-9 h-9 shrink-0 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-semibold">
                    {(holder.name || '?').replace(/^(นาย|นางสาว|นาง|น\.ส\.|คุณ)/, '').trim().charAt(0) || '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-sky-600">
                      {code === 15 ? 'ผู้รับปัจจุบัน · ส่งต่อแล้ว' : 'ผู้รับ'}
                    </p>
                    <p className="text-sm text-sky-950 truncate">
                      <b>{holder.name || '—'}</b>{holder.dept && <span className="text-sky-700"> · {holder.dept}</span>}
                      {!canAct && !isFirstReceiverLocked && <span className="text-sky-600"> · รอผู้รับตอบ</span>}
                    </p>
                  </div>
                  {canAct && !fwdOpen && (
                    <button type="button" onClick={() => setFwdOpen(true)}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold text-sky-700 bg-white border border-sky-300 shadow-sm hover:bg-sky-600 hover:text-white hover:border-sky-600 transition-colors">
                      <span aria-hidden="true">↪</span> ส่งให้ผู้อื่นตอบ
                    </button>
                  )}
                  {isFirstReceiverLocked && (
                    <button type="button" onClick={() => setLockOpen(true)}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 shadow-sm">
                      🔓 ปลดล็อก
                    </button>
                  )}
                </div>
              )}

              {/* ฟอร์มส่งต่อ (กางในการ์ดเดียวกัน) */}
              {canAct && fwdOpen && (
                <div className="mx-4 mb-3 rounded-xl bg-white border border-sky-200 p-3 space-y-3 shadow-sm">
                  <p className="text-sm font-semibold text-sky-900">↪ ส่งต่อให้ผู้อื่นเป็นผู้ตอบ</p>
                  <div className="grid grid-cols-[8.5rem_minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
                    <PersonRow row={fwd} onChange={setFwd} receivers={receivers} defaultHead label="ส่งต่อให้" />
                  </div>
                  <input value={fwdReason} onChange={e => setFwdReason(e.target.value)} placeholder="เหตุผล (เช่น เกิดในเวรของผลัด 2)"
                    className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => { setFwdOpen(false); setFwd(blankPerson()); setFwdReason(''); }}
                      className="px-4 py-2 rounded-lg text-sm font-medium border border-earth-border bg-white text-earth-ink hover:bg-earth-DEFAULT">ยกเลิก</button>
                    <button type="button" disabled={!fwd.name?.trim() || fwd.name === holder.name || fwdBusy}
                      onClick={async () => {
                        setFwdBusy(true);
                        try { await onForward?.(car, { to_name: fwd.name.trim(), to_dept: fwd.dept, to_group: fwd.group, reason: fwdReason.trim() }); }
                        finally { setFwdBusy(false); }
                      }}
                      className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-40 inline-flex items-center gap-2">
                      {fwdBusy && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />}
                      {fwdBusy ? 'กำลังส่งต่อ…' : 'ยืนยันส่งต่อ'}
                    </button>
                  </div>
                </div>
              )}

              {/* ประวัติการส่งต่อ (timeline) */}
              {forwards.length > 0 && (
                <ol className="border-t border-sky-100 px-4 py-2.5 space-y-1.5">
                  {forwards.map((f, i) => (
                    <li key={i} className="flex gap-2 text-xs text-sky-900">
                      <span className={`mt-1 w-2 h-2 shrink-0 rounded-full ${f.type === 'reclaim' ? 'bg-amber-400' : 'bg-sky-400'}`} />
                      <span>
                        <span className="text-sky-500 tabular-nums">{String(f.at || '').slice(0, 16).replace('T', ' ')}</span>{' '}
                        {f.type === 'reclaim'
                          ? <>🔓 <b>{f.by}</b> ปลดล็อก ยกเลิกการส่งต่อจาก {f.from_name}</>
                          : <><b>{f.from_name}</b> ส่งต่อให้ <b>{f.to_name}</b>{f.to_dept ? ` (${f.to_dept})` : ''}{f.reason ? <span className="text-sky-700"> — {f.reason}</span> : null}</>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {(code === 10 || code === 15) ? (
            canAct ? (
            <div className="space-y-4 px-1">
              <PersonRows label="ผู้เข้าประชุม" rows={s2.s2_attendees} receivers={receivers}
                onChange={v => setS2(p => ({ ...p, s2_attendees: v }))} />
              <Txt label="2.1 สาเหตุของปัญหา *" name="s2_root_cause" value={s2.s2_root_cause}
                onChange={e => setS2(p => ({ ...p, s2_root_cause: e.target.value }))} />
              <Txt label="2.2 กำหนดการแก้ไข *" name="s2_correction" value={s2.s2_correction}
                onChange={e => setS2(p => ({ ...p, s2_correction: e.target.value }))} />
              <div className="grid grid-cols-[12rem_1fr] gap-3 items-start">
                <Inp label="กำหนดเสร็จวันที่" name="s2_correction_deadline" type="date"
                  value={s2.s2_correction_deadline} onChange={e => setS2(p => ({ ...p, s2_correction_deadline: e.target.value }))} />
                <PersonRows label="ผู้รับผิดชอบ (แก้ไข)" rows={s2.s2_correction_owners} receivers={receivers}
                  onChange={v => setS2(p => ({ ...p, s2_correction_owners: v }))} />
              </div>
              <Txt label="2.3 กำหนดการป้องกัน" name="s2_prevention" value={s2.s2_prevention}
                onChange={e => setS2(p => ({ ...p, s2_prevention: e.target.value }))} />
              <div className="grid grid-cols-[12rem_1fr] gap-3 items-start">
                <Inp label="กำหนดเสร็จวันที่" name="s2_prevention_deadline" type="date"
                  value={s2.s2_prevention_deadline} onChange={e => setS2(p => ({ ...p, s2_prevention_deadline: e.target.value }))} />
                <PersonRows label="ผู้รับผิดชอบ (ป้องกัน)" rows={s2.s2_prevention_owners} receivers={receivers}
                  onChange={v => setS2(p => ({ ...p, s2_prevention_owners: v }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Inp label="ผู้ตอบ *" name="s2_respondent" value={s2.s2_respondent}
                  onChange={e => setS2(p => ({ ...p, s2_respondent: e.target.value }))}
                  cls="col-span-2" readOnly={!!cu.name} />
                <Inp label="ตำแหน่ง" name="s2_respondent_pos" value={s2.s2_respondent_pos}
                  onChange={e => setS2(p => ({ ...p, s2_respondent_pos: e.target.value }))}
                  readOnly={!!cu.name} />
              </div>
              {cu.name && holder.name && cu.name !== holder.name && (
                <p className="text-xs text-amber-700 -mt-2">ผู้ตอบไม่ใช่ผู้รับ ({holder.name}) — ระบบบันทึกชื่อคนที่กดบันทึกจริง</p>
              )}
              <Inp label="วันที่ตอบ" name="s2_responded_at" type="date"
                value={s2.s2_responded_at} onChange={e => setS2(p => ({ ...p, s2_responded_at: e.target.value }))} />
              {!isObserver && (
                <SaveBtn onClick={() => onUpdate(car.id, { status_code: 20, form_data: s2Payload() })}
                  disabled={saving || !s2.s2_root_cause || !s2.s2_correction || !s2.s2_respondent}
                  color="bg-orange-500 hover:bg-orange-600">
                  บันทึกคำตอบ → รออนุมัติ
                </SaveBtn>
              )}

            </div>
            ) : (
              <p className="px-1 text-sm text-earth-ink3">
                {isFirstReceiverLocked ? 'ใบนี้ถูกส่งต่อแล้ว — ดูได้อย่างเดียว (กด "ปลดล็อก" เพื่อดำเนินการเอง)' : 'รอผู้รับตอบ'}
              </p>
            )
          ) : (
            <div className="space-y-2 px-1">
              {(fd.s2_attendees?.length > 0 || fd.s2_meeting_members) && (
                <Field label="ผู้เข้าประชุม"
                  value={fd.s2_attendees?.length ? fd.s2_attendees.map(personText).join('\n') : fd.s2_meeting_members} />
              )}
              {fd.s2_root_cause && <Field label="2.1 สาเหตุของปัญหา" value={fd.s2_root_cause} />}
              {fd.s2_correction && (
                <>
                  <Field label="2.2 กำหนดการแก้ไข" value={fd.s2_correction} />
                  <div className="flex gap-4 text-xs text-earth-ink3">
                    {fd.s2_correction_deadline && <span>กำหนดเสร็จ: {fmtDate(fd.s2_correction_deadline)}</span>}
                    {(fd.s2_correction_owners?.length > 0 || fd.s2_correction_owner) && (
                      <span>ผู้รับผิดชอบ: {fd.s2_correction_owners?.length ? fd.s2_correction_owners.map(personText).join(', ') : fd.s2_correction_owner}</span>
                    )}
                  </div>
                </>
              )}
              {fd.s2_prevention && (
                <>
                  <Field label="2.3 กำหนดการป้องกัน" value={fd.s2_prevention} />
                  <div className="flex gap-4 text-xs text-earth-ink3">
                    {fd.s2_prevention_deadline && <span>กำหนดเสร็จ: {fmtDate(fd.s2_prevention_deadline)}</span>}
                    {(fd.s2_prevention_owners?.length > 0 || fd.s2_prevention_owner) && (
                      <span>ผู้รับผิดชอบ: {fd.s2_prevention_owners?.length ? fd.s2_prevention_owners.map(personText).join(', ') : fd.s2_prevention_owner}</span>
                    )}
                  </div>
                </>
              )}
              {fd.s2_respondent && (
                <p className="text-xs text-earth-ink3">
                  ผู้ตอบ: {fd.s2_respondent}{fd.s2_respondent_pos ? ` (${fd.s2_respondent_pos})` : ''}{fd.s2_responded_at ? ` · ${fmtDate(fd.s2_responded_at)}` : ''}
                </p>
              )}

              {/* Approval action */}
              {code === 20 && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-3 mt-2">
                  <p className="text-xs font-semibold text-orange-700">ผู้อนุมัติ (หัวหน้า / ผอ.)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Inp label="ชื่อผู้อนุมัติ *" name="s2_approver" value={s2a.s2_approver}
                      onChange={e => setS2a(p => ({ ...p, s2_approver: e.target.value }))}
                      readOnly={isG3a && !!cu.name} />
                    <Inp label="วันที่อนุมัติ" name="s2_approved_at" type="date"
                      value={s2a.s2_approved_at} onChange={e => setS2a(p => ({ ...p, s2_approved_at: e.target.value }))} />
                  </div>
                  {!isObserver && isG3a && (
                    <SaveBtn onClick={() => onUpdate(car.id, { status_code: 30, form_data: s2a })}
                      disabled={saving || !s2a.s2_approver}>
                      อนุมัติ → รอติดตามผล#1
                    </SaveBtn>
                  )}
                </div>
              )}

              {code > 20 && fd.s2_approver && (
                <p className="text-xs text-earth-ink3">
                  ผู้อนุมัติ: {fd.s2_approver}{fd.s2_approved_at ? ` · ${fmtDate(fd.s2_approved_at)}` : ''}
                </p>
              )}
            </div>
          )}

          {/* ── Section 4 ── */}
          {code >= 30 && (
            <>
              <SecHeader n="4" title="ติดตามผลการแก้ไข / ป้องกัน" active={code === 30 || code === 40} />
              <div className="px-1 space-y-3">
                <p className="text-xs font-semibold text-earth-ink2">ติดตามผล ครั้งที่ 1</p>

                {code === 30 ? (
                  <>
                    <div className="flex flex-wrap gap-4">
                      {[['pass','✅ เป็นไปตามที่กำหนด'], ['fail','❌ ไม่เป็นไปตามที่กำหนด']].map(([v, lbl]) => (
                        <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="radio" value={v} checked={s4a.s4_check1_result === v}
                            onChange={() => setS4a(p => ({ ...p, s4_check1_result: v }))} className="accent-brand" />
                          {lbl}
                        </label>
                      ))}
                    </div>
                    <Txt label="ผลการตรวจสอบ" name="s4_check1_notes" value={s4a.s4_check1_notes}
                      onChange={e => setS4a(p => ({ ...p, s4_check1_notes: e.target.value }))} rows={2} />
                    <div className="grid grid-cols-3 gap-3">
                      <Inp label="ผู้ติดตาม *" name="s4_check1_by" value={s4a.s4_check1_by}
                        onChange={e => setS4a(p => ({ ...p, s4_check1_by: e.target.value }))}
                        cls="col-span-2" readOnly={isG1 && !!cu.name} />
                      <Inp label="ตำแหน่ง" name="s4_check1_by_pos" value={s4a.s4_check1_by_pos}
                        onChange={e => setS4a(p => ({ ...p, s4_check1_by_pos: e.target.value }))}
                        readOnly={isG1 && !!cu.name} />
                    </div>
                    <Inp label="วันที่ตรวจ" name="s4_check1_date" type="date"
                      value={s4a.s4_check1_date} onChange={e => setS4a(p => ({ ...p, s4_check1_date: e.target.value }))} />
                    {s4a.s4_check1_result === 'fail' && (
                      <div className="grid grid-cols-2 gap-3 bg-purple-50 border border-purple-100 rounded-xl p-3">
                        <Inp label="กำหนดติดตามครั้งที่ 2 *" name="s4_check2_deadline" type="date"
                          value={s4a.s4_check2_deadline} onChange={e => setS4a(p => ({ ...p, s4_check2_deadline: e.target.value }))} />
                        <Inp label="ผู้รับผิดชอบ" name="s4_check2_owner"
                          value={s4a.s4_check2_owner} onChange={e => setS4a(p => ({ ...p, s4_check2_owner: e.target.value }))} />
                      </div>
                    )}
                    {!isObserver && isG1 && (
                      <SaveBtn
                        onClick={() => onUpdate(car.id, {
                          status_code: s4a.s4_check1_result === 'pass' ? 50 : 40,
                          form_data: s4a,
                        })}
                        disabled={saving || !s4a.s4_check1_result || !s4a.s4_check1_by
                          || (s4a.s4_check1_result === 'fail' && !s4a.s4_check2_deadline)}
                        color={s4a.s4_check1_result === 'pass' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-purple-600 hover:bg-purple-700'}>
                        {s4a.s4_check1_result === 'pass' ? 'บันทึกผลผ่าน → แก้ไขแล้ว'
                          : s4a.s4_check1_result === 'fail' ? 'บันทึกผลไม่ผ่าน → รอติดตาม#2'
                          : 'บันทึกผลติดตาม#1'}
                      </SaveBtn>
                    )}
                  </>
                ) : (
                  <div className="space-y-1">
                    <p className={`text-sm font-medium ${fd.s4_check1_result === 'pass' ? 'text-green-700' : 'text-red-700'}`}>
                      {fd.s4_check1_result === 'pass' ? '✅ เป็นไปตามที่กำหนด' : '❌ ไม่เป็นไปตามที่กำหนด'}
                    </p>
                    {fd.s4_check1_notes && <p className="text-xs text-earth-ink2">{fd.s4_check1_notes}</p>}
                    <p className="text-xs text-earth-ink3">
                      {fd.s4_check1_by}{fd.s4_check1_by_pos ? ` (${fd.s4_check1_by_pos})` : ''}{fd.s4_check1_date ? ` · ${fmtDate(fd.s4_check1_date)}` : ''}
                    </p>
                  </div>
                )}

                {/* Check 2 */}
                {(code === 40 || fd.s4_check2_result) && (
                  <>
                    <p className="text-xs font-semibold text-earth-ink2 pt-2 border-t border-earth-border">ติดตามผล ครั้งที่ 2</p>
                    {fd.s4_check2_deadline && <p className="text-xs text-purple-600">กำหนด: {fmtDate(fd.s4_check2_deadline)}</p>}

                    {code === 40 ? (
                      <>
                        <div className="flex flex-wrap gap-4">
                          {[['pass','✅ เป็นไปตามที่กำหนด'], ['fail','❌ ไม่เป็นไปตามที่กำหนด']].map(([v, lbl]) => (
                            <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="radio" value={v} checked={s4b.s4_check2_result === v}
                                onChange={() => setS4b(p => ({ ...p, s4_check2_result: v }))} className="accent-brand" />
                              {lbl}
                            </label>
                          ))}
                        </div>
                        <Txt label="ผลการตรวจสอบ" name="s4_check2_notes" value={s4b.s4_check2_notes}
                          onChange={e => setS4b(p => ({ ...p, s4_check2_notes: e.target.value }))} rows={2} />
                        <div className="grid grid-cols-3 gap-3">
                          <Inp label="ผู้ติดตาม *" name="s4_check2_by" value={s4b.s4_check2_by}
                            onChange={e => setS4b(p => ({ ...p, s4_check2_by: e.target.value }))}
                            cls="col-span-2" readOnly={isG1 && !!cu.name} />
                          <Inp label="ตำแหน่ง" name="s4_check2_by_pos" value={s4b.s4_check2_by_pos}
                            onChange={e => setS4b(p => ({ ...p, s4_check2_by_pos: e.target.value }))}
                            readOnly={isG1 && !!cu.name} />
                        </div>
                        <Inp label="วันที่ตรวจ" name="s4_check2_date" type="date"
                          value={s4b.s4_check2_date} onChange={e => setS4b(p => ({ ...p, s4_check2_date: e.target.value }))} />
                        {!isObserver && isG1 && (
                          <SaveBtn
                            onClick={() => onUpdate(car.id, { status_code: 50, form_data: s4b })}
                            disabled={saving || !s4b.s4_check2_result || !s4b.s4_check2_by || s4b.s4_check2_result !== 'pass'}
                            color="bg-teal-600 hover:bg-teal-700">
                            บันทึกผลผ่าน → แก้ไขแล้ว
                          </SaveBtn>
                        )}
                      </>
                    ) : (
                      <div className="space-y-1">
                        <p className={`text-sm font-medium ${fd.s4_check2_result === 'pass' ? 'text-green-700' : 'text-red-700'}`}>
                          {fd.s4_check2_result === 'pass' ? '✅ เป็นไปตามที่กำหนด' : '❌ ไม่เป็นไปตามที่กำหนด'}
                        </p>
                        {fd.s4_check2_notes && <p className="text-xs text-earth-ink2">{fd.s4_check2_notes}</p>}
                        <p className="text-xs text-earth-ink3">
                          {fd.s4_check2_by}{fd.s4_check2_by_pos ? ` (${fd.s4_check2_by_pos})` : ''}{fd.s4_check2_date ? ` · ${fmtDate(fd.s4_check2_date)}` : ''}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {/* ── Section 5 ── */}
          {code >= 50 && (
            <>
              <SecHeader n="5" title="การพิจารณาอนุมัติโดยผู้อำนวยการฝ่าย" active={code === 50} />
              <div className="px-1 space-y-3">
                {code === 50 ? (
                  <>
                    <div className="flex gap-6">
                      {[['close','✅ ปิด'], ['reject','❌ ตีกลับ']].map(([v, lbl]) => (
                        <label key={v} className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                          <input type="radio" value={v} checked={s5.s5_decision === v}
                            onChange={() => setS5(p => ({ ...p, s5_decision: v }))} className="accent-brand" />
                          {lbl}
                        </label>
                      ))}
                    </div>
                    <Txt label="เหตุผล" name="s5_reason" value={s5.s5_reason}
                      onChange={e => setS5(p => ({ ...p, s5_reason: e.target.value }))} rows={2} />
                    <Txt label="การดำเนินการ" name="s5_action" value={s5.s5_action}
                      onChange={e => setS5(p => ({ ...p, s5_action: e.target.value }))} rows={2} />
                    <div className="grid grid-cols-2 gap-3">
                      <Inp label="ผู้อนุมัติ (ผอ.ฝ.) *" name="s5_approver" value={s5.s5_approver}
                        onChange={e => setS5(p => ({ ...p, s5_approver: e.target.value }))}
                        readOnly={isG3b && !!cu.name} />
                      <Inp label="วันที่" name="s5_approved_at" type="date"
                        value={s5.s5_approved_at} onChange={e => setS5(p => ({ ...p, s5_approved_at: e.target.value }))} />
                    </div>
                    {!isObserver && isG3b && (
                      <SaveBtn
                        onClick={() => onUpdate(car.id, { status_code: s5.s5_decision === 'close' ? 60 : 70, form_data: s5 })}
                        disabled={saving || !s5.s5_decision || !s5.s5_approver}
                        color={s5.s5_decision === 'close' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}>
                        {s5.s5_decision === 'close' ? 'อนุมัติปิด CAR' : s5.s5_decision === 'reject' ? 'ตีกลับ (ต้องออกใบใหม่)' : 'บันทึกการพิจารณา'}
                      </SaveBtn>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className={`text-sm font-medium ${fd.s5_decision === 'close' ? 'text-green-700' : 'text-red-700'}`}>
                      {fd.s5_decision === 'close' ? '✅ อนุมัติปิด' : '❌ ตีกลับ'}
                    </p>
                    {fd.s5_reason && <Field label="เหตุผล" value={fd.s5_reason} />}
                    {fd.s5_action && <Field label="การดำเนินการ" value={fd.s5_action} />}
                    {fd.s5_approver && (
                      <p className="text-xs text-earth-ink3">
                        {fd.s5_approver} (ผอ.ฝ.){fd.s5_approved_at ? ` · ${fmtDate(fd.s5_approved_at)}` : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="h-4" />
        </div>
      </div>

      {lockOpen && isFirstReceiverLocked && (
        <ForwardedLockDialog
          holder={holder}
          forwardedAt={lastForward?.at}
          onClose={() => setLockOpen(false)}
          onUnlock={async () => { await onReclaim?.(car); }}
        />
      )}
    </>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────

// dropdown หน่วย; "อื่นๆ" → ช่องพิมพ์เอง (หน่วยที่ไม่อยู่ในลิสต์จาก prefill ก็เข้าโหมดนี้อัตโนมัติ)
function UnitSelect({ value, onChange, label }) {
  const custom = !!value && !CAR_UNITS.includes(value);
  const [other, setOther] = useState(custom);
  if (other || custom) {
    return (
      <div className="flex gap-1">
        <input value={value} onChange={e => onChange(e.target.value)} placeholder="พิมพ์หน่วย" aria-label={label}
          className="w-full min-w-0 border border-earth-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
        <button type="button" onClick={() => { setOther(false); onChange(''); }} title="กลับไปเลือกจากรายการ"
          className="px-2 rounded-lg border border-earth-border text-earth-ink3 hover:text-earth-ink text-xs">▾</button>
      </div>
    );
  }
  return (
    <select value={value} aria-label={label}
      onChange={e => { if (e.target.value === CAR_UNIT_OTHER) { setOther(true); onChange(''); } else onChange(e.target.value); }}
      className="w-full border border-earth-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
      <option value="">—</option>
      {CAR_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
      <option value={CAR_UNIT_OTHER}>อื่นๆ…</option>
    </select>
  );
}


const INIT = {
  car_type: 'CAR', system_type: '', issue_type: '',
  car_prefix: '', car_number: '', parameter_name: '',
  issuer_name: '', issuer_dept: '', receiver_name: '', receiver_dept: '',
  findings: [{ value: '', direction: 'above', threshold: '', unit: '' }],   // ค่าที่พบ — หลายบรรทัดได้
  receiver_shift: '',                                                       // ผลัด 1-4 → เลือกผู้รับ/หน่วยงานอัตโนมัติ
  record_datetime: '',   // ใส่ตอนสร้างฟอร์มด้วย nowTHLocal() (เวลาไทย ณ ตอนเปิดฟอร์ม ไม่ใช่ตอนโหลดไฟล์)
};

// เวลาไทย (GMT+7) รูปแบบ datetime-local "YYYY-MM-DDTHH:mm" — ไม่พึ่ง timezone/ปฏิทิน (พ.ศ.) ของเครื่อง
const nowTHLocal = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16);
const newForm = () => ({ ...INIT, findings: [blankFinding()], record_datetime: nowTHLocal() });

// CAR ที่มีอยู่ → ฟอร์มส่วนที่ 1 (โหมดแก้ไข)
function formFromCar(car) {
  let rows = null;
  try { const a = JSON.parse(car.findings || 'null'); if (Array.isArray(a) && a.length) rows = a; } catch { /* ignore */ }
  if (!rows && car.recorded_value != null) {
    rows = [{ value: car.recorded_value, direction: car.threshold_direction === 'below' ? 'below' : 'above', threshold: car.threshold_value, unit: '' }];
  }
  const shift = /สคน(\d)กผจ/.exec(car.receiver_dept || '')?.[1] || '';
  return {
    ...INIT,
    car_type: car.car_type || 'CAR', system_type: car.system_type || '', issue_type: car.issue_type || '',
    // เลขรูปแบบอัตโนมัติ (เช่น "CQ 01/2570") → ให้ dropdown แสดงรหัสเดิม; รูปแบบอื่น = "กรอกเอง"
    car_prefix: CAR_PREFIXES.find(([p]) => new RegExp(`^${p} \\d+/\\d{4}$`).test(car.car_number || ''))?.[0] || '',
    car_number: car.car_number || '', parameter_name: car.parameter_name || '',
    issuer_name: car.issuer_name || '', issuer_dept: car.issuer_dept || '',
    receiver_name: car.receiver_name || '', receiver_dept: car.receiver_dept || '', receiver_shift: shift,
    findings: (rows || [blankFinding()]).map(r => ({
      value: r.value ?? '', direction: r.direction === 'below' ? 'below' : 'above', threshold: r.threshold ?? '', unit: r.unit || '',
    })),
    record_datetime: String(car.record_datetime || '').replace(' ', 'T').slice(0, 16),
  };
}

const UNIT_ALIAS = { degC: '°C', 'uS/cm': 'µS/cm' };   // ชื่อหน่วยใน params.json → ที่แสดงใน dropdown
const blankFinding = () => ({ value: '', direction: 'above', threshold: '', unit: '' });

// prefill จาก Event Class / Chem Lab ส่งมาเป็นค่าเดี่ยว (recorded_value/threshold_*) → แปลงเป็นบรรทัดแรกของ findings
function initialForm(prefill) {
  if (!prefill) return newForm();
  const { recorded_value, threshold_value, threshold_direction, unit, findings, ...rest } = prefill;
  let rows = Array.isArray(findings) && findings.length ? findings : null;
  if (!rows && (recorded_value != null || threshold_value != null)) {
    rows = [{
      value: recorded_value ?? '', direction: threshold_direction === 'below' ? 'below' : 'above',
      threshold: threshold_value ?? '', unit: UNIT_ALIAS[unit] || unit || '',
    }];
  }
  return { ...newForm(), ...rest, ...(rows ? { findings: rows } : {}) };
}

// ─── Group labels ─────────────────────────────────────────────────────────
const GROUP_LABEL = { '1': 'นักวิทยาศาสตร์', '2': 'Operator', '3a': 'ผอ.กผจ.', '3b': 'ผอ.ฝผม.' };

// ─── Admin panel ──────────────────────────────────────────────────────────

function AdminPanel({ onClose }) {
  const qc = useQueryClient();
  const { data: whitelist = [], isLoading } = useQuery({
    queryKey: ['whitelist'],
    queryFn: () => get('/api/car-admin/whitelist'),
  });
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [addForm, setAddForm] = useState({ name: '', group_code: '3a', shift: '', dept_label: '', is_admin: false });

  async function handleSync() {
    setSyncing(true); setSyncMsg('');
    try {
      const r = await post('/api/car-admin/sync', {});
      setSyncMsg(`✅ Sync สำเร็จ: ${r.synced} รายชื่อ${r.errors?.length ? ` (${r.errors.length} org ล้มเหลว)` : ''}`);
      qc.invalidateQueries({ queryKey: ['whitelist'] });
      qc.invalidateQueries({ queryKey: ['myRole'] });
    } catch (e) {
      setSyncMsg(`❌ ${e.message}`);
    } finally { setSyncing(false); }
  }

  async function handleAdd() {
    if (!addForm.name || !addForm.group_code) return;
    await post('/api/car-admin/manual', { ...addForm, shift: addForm.shift ? parseInt(addForm.shift) : null, is_admin: addForm.is_admin ? 1 : 0 });
    qc.invalidateQueries({ queryKey: ['whitelist'] });
    setAddForm({ name: '', group_code: '3a', shift: '', dept_label: '', is_admin: false });
  }

  async function handleToggleAdmin(entry) {
    await patch(`/api/car-admin/${entry.id}`, { is_admin: entry.is_admin ? 0 : 1 });
    qc.invalidateQueries({ queryKey: ['whitelist'] });
  }

  async function handleDelete(id) {
    if (!confirm('ลบรายชื่อนี้?')) return;
    await del(`/api/car-admin/${id}`);
    qc.invalidateQueries({ queryKey: ['whitelist'] });
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-4 md:inset-10 bg-earth-card z-50 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-earth-border shrink-0">
          <h2 className="font-bold text-earth-ink text-lg">จัดการ Whitelist</h2>
          <button onClick={onClose} className="text-earth-ink3 hover:text-earth-ink text-xl px-2">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Sync EHR */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
            <p className="text-sm font-semibold text-blue-800">Sync จากระบบ EHR (กลุ่ม 1 + Operator ผลัด 1-4)</p>
            <p className="text-xs text-blue-600">ดึงรายชื่อพนักงานล่าสุดจาก ehr.mwa.co.th โดยอัตโนมัติ</p>
            <button onClick={handleSync} disabled={syncing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {syncing ? 'กำลัง Sync...' : '🔄 Sync EHR ตอนนี้'}
            </button>
            {syncMsg && <p className="text-sm">{syncMsg}</p>}
          </div>

          {/* Add manual entry (Group 3 / Admin) */}
          <div className="bg-earth-card border border-earth-border rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-earth-ink">เพิ่มรายชื่อด้วยตนเอง (ผู้บริหาร / Admin)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-earth-ink2 mb-1">ชื่อ-สกุล (ต้องตรงกับที่ login)</label>
                <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="นาย/นาง/น.ส. ชื่อ สกุล"
                  className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-earth-ink2 mb-1">กลุ่ม</label>
                <select value={addForm.group_code} onChange={e => setAddForm(f => ({ ...f, group_code: e.target.value }))}
                  className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm">
                  <option value="1">กลุ่ม 1 — นักวิทยาศาสตร์</option>
                  <option value="2">กลุ่ม 2 — Operator</option>
                  <option value="3a">กลุ่ม 3a — ผอ.กผจ.</option>
                  <option value="3b">กลุ่ม 3b — ผอ.ฝผม.</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-earth-ink2 mb-1">ผลัด (เฉพาะ Operator)</label>
                <input type="number" min="1" max="4" value={addForm.shift} onChange={e => setAddForm(f => ({ ...f, shift: e.target.value }))}
                  placeholder="1-4" className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-earth-ink2 mb-1">ชื่อหน่วยงาน/ส่วน</label>
                <input value={addForm.dept_label} onChange={e => setAddForm(f => ({ ...f, dept_label: e.target.value }))}
                  placeholder="เช่น ผอ.กผจ.ฝผม." className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex items-center gap-2 pt-4">
                <input type="checkbox" id="isAdminChk" checked={addForm.is_admin}
                  onChange={e => setAddForm(f => ({ ...f, is_admin: e.target.checked }))} />
                <label htmlFor="isAdminChk" className="text-sm text-earth-ink">ให้สิทธิ์ Admin</label>
              </div>
            </div>
            <button onClick={handleAdd} disabled={!addForm.name}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              + เพิ่มรายชื่อ
            </button>
          </div>

          {/* Whitelist table */}
          {isLoading ? <p className="text-sm text-earth-ink3">กำลังโหลด...</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-earth-card text-left text-xs text-earth-ink2">
                    <th className="px-3 py-2 rounded-tl-lg">ชื่อ-สกุล</th>
                    <th className="px-3 py-2">กลุ่ม</th>
                    <th className="px-3 py-2">ผลัด</th>
                    <th className="px-3 py-2">หน่วยงาน</th>
                    <th className="px-3 py-2">Admin</th>
                    <th className="px-3 py-2 rounded-tr-lg"></th>
                  </tr>
                </thead>
                <tbody>
                  {whitelist.map(e => (
                    <tr key={e.id} className="border-b border-earth-border hover:bg-earth-DEFAULT">
                      <td className="px-3 py-2 font-medium">{e.name}</td>
                      <td className="px-3 py-2">{GROUP_LABEL[e.group_code] || e.group_code}</td>
                      <td className="px-3 py-2 text-center">{e.shift || '—'}</td>
                      <td className="px-3 py-2 text-earth-ink2 text-xs">{e.dept_label || '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => handleToggleAdmin(e)}
                          className={`px-2 py-0.5 rounded text-xs font-medium ${e.is_admin ? 'bg-yellow-100 text-yellow-700' : 'bg-earth-card text-earth-ink3'}`}>
                          {e.is_admin ? 'Admin' : '—'}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => handleDelete(e.id)} className="text-red-400 hover:text-red-600 text-xs">ลบ</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {whitelist.length === 0 && <p className="text-center py-4 text-earth-ink3 text-sm">ยังไม่มีรายชื่อ — กด Sync EHR ก่อน</p>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────

export default function CARLog() {
  const location = useLocation();
  const navigate = useNavigate();
  const prefill = location.state?.prefill;
  const chemLabCase = location.state?.chemLabCase; // { id } — CAR issued from a chem-lab compensation case
  const eventOccurrence = location.state?.eventOccurrence; // { id, event_class_id } — CAR issued from an alarm (Event Class)
  const [linkError, setLinkError] = useState(null);

  const [tab, setTab] = useState(prefill ? 'create' : 'list');
  const [selectedCar, setSelectedCar] = useState(null);
  const [form, setForm] = useState(() => initialForm(prefill));
  const [filterDate, setFilterDate] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const qc = useQueryClient();

  const { data: cars = [], isLoading } = useQuery({
    queryKey: ['cars'],
    queryFn: () => get('/api/car'),
  });

  // Deep link /car?key=<unique_key> (from chem-lab case) → open that CAR once the list is loaded
  const [searchParams, setSearchParams] = useSearchParams();
  const deepKey = searchParams.get('key');
  useEffect(() => {
    if (!deepKey || isLoading) return;
    const car = cars.find(c => c.unique_key === deepKey);
    if (car) { setTab('list'); setSelectedCar(car); }
    setSearchParams({}, { replace: true });
  }, [deepKey, isLoading, cars]);

  const { data: nextNo } = useQuery({
    queryKey: ['car-next-number', form.car_prefix, form.car_type],
    queryFn: () => get(`/api/car/next-number?prefix=${form.car_prefix}&car_type=${form.car_type}`),
    enabled: tab === 'create' && !!form.car_prefix,
  });

  const { data: myRole } = useQuery({
    queryKey: ['myRole'],
    queryFn: () => get('/api/car-admin/my-role'),
    staleTime: 5 * 60 * 1000,
  });

  // Pre-fill locked fields from login identity
  useEffect(() => {
    if (myRole?.name) {
      setForm(f => ({ ...f, issuer_name: myRole.name, issuer_dept: myRole.deptLabel || f.issuer_dept }));
    }
  }, [myRole?.name, myRole?.deptLabel]);

  // ── ปุ่มบนการ์ด: ส่ง LINE ซ้ำ / คัดลอก URL ──
  const [toast, setToast] = useState(null);           // { text, error?, id } — id ใหม่ทุกครั้งให้แสดงซ้ำได้
  const showToast = (text, error = false) => setToast({ text, error, id: Date.now() });
  async function handleCopyUrl(car) {
    const url = `${window.location.origin}${BASE}/car?key=${encodeURIComponent(car.unique_key)}`;
    showToast((await copyText(url)) ? 'คัดลอก URL แล้ว' : 'คัดลอกไม่สำเร็จ', false);
  }
  // dialog ยืนยัน (แทน confirm() ของเบราว์เซอร์): { kind: 'line' | 'delete', car }
  const [confirmBox, setConfirmBox] = useState(null);
  const handleResendLine = car => setConfirmBox({ kind: 'line', car });
  async function doResendLine(car) {
    try {
      await post(`/api/car/${car.id}/resend-line`, {});
      showToast('ส่ง LINE แล้ว');
      qc.invalidateQueries({ queryKey: ['cars'] });
    } catch (e) {
      showToast(e.message || 'ส่ง LINE ไม่สำเร็จ', true);
    }
  }

  const [editingId, setEditingId] = useState(null);   // โหมดแก้ไขส่วนที่ 1 (admin) — ใช้ฟอร์มเดียวกับสร้าง
  function startEdit(car) {
    setForm(formFromCar(car));
    setEditingId(car.id);
    setSelectedCar(null);
    setTab('create');
  }
  function cancelEdit() {
    setEditingId(null);
    setForm(newForm());
    setTab('list');
  }
  // ส่วนที่ 2: ส่งต่อ / ปลดล็อก
  async function handleForward(car, body) {
    try {
      const r = await post(`/api/car/${car.id}/forward`, body);
      qc.invalidateQueries({ queryKey: ['cars'] });
      if (r?.car) setSelectedCar(r.car);
      showToast(`ส่งต่อให้ ${body.to_name} แล้ว`);
    } catch (e) { showToast(e.message || 'ส่งต่อไม่สำเร็จ', true); }
  }
  async function handleReclaim(car) {
    try {
      const r = await post(`/api/car/${car.id}/reclaim`, {});
      qc.invalidateQueries({ queryKey: ['cars'] });
      if (r?.car) setSelectedCar(r.car);
      showToast('ปลดล็อกแล้ว — ดำเนินการต่อได้');
    } catch (e) { showToast(e.message || 'ปลดล็อกไม่สำเร็จ', true); }
  }

  const handleDelete = car => setConfirmBox({ kind: 'delete', car });
  async function doDelete(car) {
    try {
      await del(`/api/car/${car.id}`);
      setSelectedCar(null);
      qc.invalidateQueries({ queryKey: ['cars'] });
      qc.invalidateQueries({ queryKey: ['car-next-number'] });
      qc.invalidateQueries({ queryKey: ['eventclass'] });
      showToast(`ลบ ${car.car_number || 'CAR'} แล้ว`);
    } catch (e) { showToast(`ลบไม่สำเร็จ: ${e.message}`, true); }
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const { receiver_shift, findings, ...rest } = form;
      return (editingId ? (body => put(`/api/car/${editingId}/section1`, body)) : (body => post('/api/car', body)))({
        ...rest,
        // ทิ้งบรรทัดที่ว่างทั้งค่าและเกณฑ์; server mirror บรรทัดแรกลง recorded_value/threshold_* ให้เอง
        findings: findings
          .filter(r => r.value !== '' || r.threshold !== '')
          .map(r => ({
            value: r.value === '' ? null : parseFloat(r.value),
            direction: r.direction,
            threshold: r.threshold === '' ? null : parseFloat(r.threshold),
            unit: r.unit,
          })),
      });
    },
    onSuccess: async (result) => {
      qc.invalidateQueries({ queryKey: ['cars'] });
      qc.invalidateQueries({ queryKey: ['car-next-number'] });
      if (editingId) {
        setEditingId(null);
        setForm(newForm());
        setTab('list');
        if (result?.car) setSelectedCar(result.car);
        return;
      }
      if (chemLabCase) {
        try {
          await post(`/api/chem-lab/cases/${chemLabCase.id}/car`, { car_key: result.unique_key });
          qc.invalidateQueries({ queryKey: ['chem-lab'] });
          navigate(`/chem-intake?tab=cases&case=${chemLabCase.id}`, { replace: true });
          return;
        } catch (e) {
          setLinkError(`ออก CAR ${result.unique_key} แล้ว แต่ผูกกับเคสชดเชย #${chemLabCase.id} ไม่สำเร็จ: ${e.message}`);
        }
      }
      if (eventOccurrence) {
        try {
          await post(`/api/eventclass/occurrences/${eventOccurrence.id}/car`, { car_key: result.unique_key });
          qc.invalidateQueries({ queryKey: ['eventclass'] });
          navigate('/event-class?tab=occurrences', { replace: true });
          return;
        } catch (e) {
          setLinkError(`ออก CAR ${result.unique_key} แล้ว แต่ผูกกับเหตุการณ์แจ้งเตือน #${eventOccurrence.id} ไม่สำเร็จ: ${e.message}`);
        }
      }
      setTab('list');
      setForm(newForm());
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }) => patch(`/api/car/${id}`, data),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ['cars'] });
      if (result?.car) setSelectedCar(result.car);
    },
  });

  function setF(e) { setForm(f => ({ ...f, [e.target.name]: e.target.value })); }

  // ── ค่าที่พบหลายบรรทัด ──
  const setFinding = (i, patchObj) =>
    setForm(f => ({ ...f, findings: f.findings.map((r, k) => (k === i ? { ...r, ...patchObj } : r)) }));
  const addFinding = () => setForm(f => ({ ...f, findings: [...f.findings, blankFinding()] }));
  const removeFinding = i =>
    setForm(f => ({ ...f, findings: f.findings.length > 1 ? f.findings.filter((_, k) => k !== i) : [blankFinding()] }));

  // ── ผู้รับ: ผลัด 1-4 → ส่วน/กอง (จาก whitelist) + ผู้รับ default = หัวหน้าส่วน (เปลี่ยนได้) ──
  const { data: receivers = [] } = useQuery({
    queryKey: ['car-receivers'],
    queryFn: () => get('/api/car-admin/receivers'),
    staleTime: 60 * 1000,
    enabled: tab === 'create',
  });
  const recvShift = receivers.find(r => String(r.shift) === String(form.receiver_shift));
  function pickShift(shift) {
    const r = receivers.find(x => String(x.shift) === String(shift));
    setForm(f => ({
      ...f,
      receiver_shift: shift,
      receiver_name: r?.head || '',
      receiver_dept: r?.dept_label || '',
    }));
  }

  const sorted = arr => [...arr].sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at));

  const matchesDate = (car, date) => {
    if (!date) return true;
    return [car.deadline_at, car.correction_deadline, car.prevention_deadline, car.followup2_deadline]
      .some(d => d && d.slice(0, 10) === date);
  };

  const inProgress = useMemo(() => sorted(cars.filter(c => { const x = c.status_code || 10; return x >= 10 && x <= 50; }).filter(c => matchesDate(c, filterDate))), [cars, filterDate]);
  const rejected   = useMemo(() => sorted(cars.filter(c => (c.status_code || 10) === 70).filter(c => matchesDate(c, filterDate))), [cars, filterDate]);
  const closed     = useMemo(() => sorted(cars.filter(c => (c.status_code || 10) === 60).filter(c => matchesDate(c, filterDate))), [cars, filterDate]);

  // Calendar events from active CARs
  const calEvents = useMemo(() => {
    const evs = [];
    for (const car of cars) {
      if ((car.status_code || 10) >= 60) continue;
      const lbl = car.car_number || car.unique_key;
      if (car.deadline_at)          evs.push({ date: car.deadline_at,          type: 'deadline',   label: `${lbl} — Deadline` });
      if (car.correction_deadline)  evs.push({ date: car.correction_deadline,  type: 'correction', label: `${lbl} — แก้ไข` });
      if (car.prevention_deadline)  evs.push({ date: car.prevention_deadline,  type: 'prevention', label: `${lbl} — ป้องกัน` });
      if (car.followup2_deadline)   evs.push({ date: car.followup2_deadline,   type: 'followup2',  label: `${lbl} — ติดตาม#2` });
    }
    return evs;
  }, [cars]);

  const now = new Date();
  const thisYear = now.getFullYear(), thisMonth = now.getMonth();
  const nextMonth = (thisMonth + 1) % 12, nextYear = thisMonth === 11 ? thisYear + 1 : thisYear;

  return (
    <div className="flex gap-5 items-start w-full">

      {/* ── 65% left: CAR content ── */}
      <div className="flex-[13] min-w-0 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-earth-ink">CAR Log</h1>
          {(myRole?.groups?.length > 0 || myRole?.group) && (() => {
            const gs = myRole.groups || [myRole.group];
            return gs.map(g => (
              <span key={g} className="px-2 py-0.5 rounded-full text-xs font-medium bg-earth-card text-earth-ink2 border border-earth-border">
                {GROUP_LABEL[g] || g}
                {g === '2' && myRole.shift ? ` ผลัด ${myRole.shift}` : ''}
              </span>
            ));
          })()}
          {myRole?.isAdmin && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 border border-yellow-200">⭐ Admin</span>
          )}
          {filterDate && (
            <span className="flex items-center gap-1.5 bg-brand/10 text-brand text-sm font-medium px-3 py-1 rounded-full">
              {filterDate}
              <button onClick={() => setFilterDate(null)} className="hover:text-brand/60 leading-none">✕</button>
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => (editingId ? cancelEdit() : setTab('list'))}
            className={`px-4 py-2 rounded-lg text-sm font-medium touch-target ${tab === 'list' ? 'bg-brand text-white' : 'bg-earth-card text-earth-ink'}`}>
            รายการ
          </button>
          {(!myRole?.group || (myRole.groups || [myRole.group]).includes('1') || myRole.isAdmin) && (
            <button onClick={() => { if (editingId) { setEditingId(null); setForm(newForm()); } setTab('create'); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium touch-target ${tab === 'create' ? 'bg-brand text-white' : 'bg-earth-card text-earth-ink'}`}>
              + สร้าง CAR
            </button>
          )}
          {myRole?.isAdmin && (
            <button onClick={() => setShowAdmin(true)}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-earth-card text-earth-ink hover:bg-earth-card touch-target"
              title="จัดการ Whitelist">
              ⚙
            </button>
          )}
        </div>
      </div>

      {/* List view */}
      {tab === 'list' && (
        <>
          {isLoading
            ? <div className="text-center py-8 text-earth-ink3">กำลังโหลด...</div>
            : (
              <div className="space-y-6">
                <LogExport cars={cars} />
                <Bucket title="กำลังดำเนินการ" cars={inProgress} onSelect={setSelectedCar} badge={inProgress.length}
                  onResendLine={myRole?.isObserver ? null : handleResendLine} onCopyUrl={handleCopyUrl} />
                <Bucket title="ตีกลับ" cars={rejected} onSelect={setSelectedCar} badge={rejected.length}
                  onResendLine={myRole?.isObserver ? null : handleResendLine} onCopyUrl={handleCopyUrl} />
                <Bucket title="ปิดแล้ว" cars={closed} onSelect={setSelectedCar} badge={closed.length}
                  onResendLine={myRole?.isObserver ? null : handleResendLine} onCopyUrl={handleCopyUrl} />
              </div>
            )
          }
        </>
      )}

      {/* Create form */}
      {tab === 'create' && (
        <div className="bg-earth-DEFAULT rounded-xl p-5 shadow-sm border border-earth-border space-y-4">
          {eventOccurrence && (
            <p className="text-sm font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-3 py-2">
              🔔 ออก CAR จากเหตุการณ์แจ้งเตือน #{eventOccurrence.id} ({eventOccurrence.event_class_id}) — ระบบกรอกเรื่องที่พบ/ค่า/เกณฑ์ให้แล้ว ตรวจสอบ แล้วกรอกผู้รับ ก่อนกดออกใบ
            </p>
          )}
          {chemLabCase && (
            <p className="text-sm font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-3 py-2">
              🚩 ออก CAR จากเคสชดเชย #{chemLabCase.id} (ห้องปฏิบัติการเคมี) — ระบบกรอกเรื่องที่พบ/ค่า/เกณฑ์ให้แล้ว ตรวจสอบ แล้วกรอกเลข CAR และผู้รับ ก่อนกดออกใบ
            </p>
          )}
          {editingId && (
            <p className="text-sm font-semibold text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
              ✎ กำลังแก้ไขส่วนที่ 1 ของ {form.car_number || `CAR #${editingId}`} — ไม่เปลี่ยนสถานะ และไม่ส่ง LINE
            </p>
          )}
          <h2 className="font-semibold text-earth-ink">ส่วนที่ 1 — รายละเอียดสิ่งที่ไม่เป็นไปตามข้อกำหนด</h2>
          <div className="grid grid-cols-2 gap-4">

            <div>
              <label className="block text-xs font-medium text-earth-ink2 mb-2">ประเภท</label>
              <div className="flex gap-4">
                {['CAR','PAR'].map(t => (
                  <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="car_type" value={t} checked={form.car_type === t} onChange={setF} className="accent-brand" />
                    {t}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-earth-ink2 mb-1">ระบบ</label>
              <select name="system_type" value={form.system_type} onChange={setF}
                className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">—</option>
                <option>HACCP</option>
                <option>ISO14001:2015</option>
                <option>ISO45001:2018</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-earth-ink2 mb-1">เลข {form.car_type}</label>
              <div className="flex gap-2">
                <select name="car_prefix" value={form.car_prefix}
                  onChange={e => {
                    const p = e.target.value;
                    // เลือกรหัสใหม่ → ล้างเลขเดิมที่ไม่ใช่รหัสนี้ ให้ระบบออกเลขอัตโนมัติ (สำคัญตอนแก้ไข: เลขเดิมค้างอยู่ในช่อง)
                    setForm(f => ({ ...f, car_prefix: p, car_number: p && !String(f.car_number).startsWith(`${p} `) ? '' : f.car_number }));
                  }}
                  className="w-24 shrink-0 border border-earth-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                  <option value="">กรอกเอง</option>
                  {CAR_PREFIXES.map(([p, d]) => <option key={p} value={p} title={d}>{p}</option>)}
                </select>
                <input name="car_number" value={form.car_number} onChange={setF}
                  placeholder={form.car_prefix ? (nextNo?.car_number ? `อัตโนมัติ: ${nextNo.car_number}` : 'อัตโนมัติ') : 'เช่น CQ 01/2569'}
                  className="flex-1 min-w-0 border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
              </div>
              {form.car_prefix && (
                <p className="text-[11px] text-earth-ink3 mt-1">
                  {form.car_prefix} = {CAR_PREFIXES.find(([p]) => p === form.car_prefix)?.[1]}
                  {!form.car_number && ` · ระบบออกเลขให้ตอนกดออกใบ (นับแยก ${form.car_type} · เริ่มใหม่ทุกปีงบประมาณ 1 ต.ค.)`}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-earth-ink2 mb-1">ประเภทของปัญหา</label>
              <select name="issue_type" value={form.issue_type} onChange={setF}
                className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">—</option>
                <option value="ผลิตภัณฑ์ที่ไม่เป็นไปตามข้อกำหนด">ผลิตภัณฑ์ NC</option>
                <option value="การตรวจติดตามภายใน">การตรวจติดตามภายใน</option>
                <option value="ข้อร้องเรียนของลูกค้า">ข้อร้องเรียนของลูกค้า</option>
                <option value="อื่นๆ">อื่นๆ</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-earth-ink2 mb-1">1.1 เรื่องที่พบ <span className="text-red-500">*</span></label>
              <textarea name="parameter_name" value={form.parameter_name} onChange={setF} rows={3} required
                placeholder="ระบุสิ่งที่ไม่เป็นไปตามข้อกำหนด..."
                className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>

            {/* ค่าที่พบ + เกณฑ์ + หน่วย — เพิ่มบรรทัดได้ ปุ่ม + อยู่ท้ายบรรทัดล่าสุดเสมอ */}
            <div className="col-span-2 space-y-2">
              <div className="grid grid-cols-[1fr_minmax(0,1.6fr)_7rem_5.5rem] gap-2 text-xs font-medium text-earth-ink2">
                <span>ค่าที่พบ</span><span>เกณฑ์</span><span>หน่วย</span><span />
              </div>
              {form.findings.map((row, i) => {
                const last = i === form.findings.length - 1;
                return (
                  <div key={i} className="grid grid-cols-[1fr_minmax(0,1.6fr)_7rem_5.5rem] gap-2 items-start">
                    <input type="number" step="any" value={row.value}
                      onChange={e => setFinding(i, { value: e.target.value })}
                      aria-label={`ค่าที่พบ บรรทัด ${i + 1}`}
                      className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                    <div className="flex gap-2">
                      <select value={row.direction} onChange={e => setFinding(i, { direction: e.target.value })}
                        aria-label={`เงื่อนไข บรรทัด ${i + 1}`}
                        className="border border-earth-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                        <option value="above">เกิน (≤)</option>
                        <option value="below">ต่ำกว่า (≥)</option>
                      </select>
                      <input type="number" step="any" value={row.threshold}
                        onChange={e => setFinding(i, { threshold: e.target.value })}
                        aria-label={`เกณฑ์ บรรทัด ${i + 1}`}
                        className="flex-1 min-w-0 border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                    </div>
                    <UnitSelect value={row.unit} onChange={u => setFinding(i, { unit: u })} label={`หน่วย บรรทัด ${i + 1}`} />
                    <div className="flex gap-1 pt-0.5">
                      {form.findings.length > 1 && (
                        <button type="button" onClick={() => removeFinding(i)} title="ลบบรรทัดนี้"
                          className="w-9 h-9 rounded-lg border border-earth-border text-earth-ink3 hover:text-red-600 hover:border-red-300">−</button>
                      )}
                      {last && (
                        <button type="button" onClick={addFinding} title="เพิ่มบรรทัดค่าที่พบ"
                          className="w-9 h-9 rounded-lg bg-brand text-white hover:bg-sky-700 text-lg leading-none">+</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-earth-ink2 mb-1">วันที่-เวลาที่พบ <span className="text-red-500">*</span></label>
              <input type="datetime-local" name="record_datetime" value={form.record_datetime} onChange={setF}
                className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>

            <Inp label="1.2 ผู้ออก *" name="issuer_name" value={form.issuer_name} onChange={setF} readOnly={!!myRole?.name} />
            <Inp label="ส่วน/กอง" name="issuer_dept" value={form.issuer_dept} onChange={setF} readOnly={!!myRole?.name} />
            {/* 1.3 ผู้รับ: เลือกผลัด → ส่วน/กอง (จาก whitelist) + ผู้รับ default = หัวหน้าส่วน (เปลี่ยนได้) */}
            <div className="col-span-2 grid grid-cols-[7rem_1fr_1fr] gap-4">
              <div>
                <label className="block text-xs font-medium text-earth-ink2 mb-1">ผลัดผู้รับ *</label>
                <select value={form.receiver_shift} onChange={e => pickShift(e.target.value)}
                  className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                  <option value="">—</option>
                  {[1, 2, 3, 4].map(s => <option key={s} value={s}>ผลัด {s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-earth-ink2 mb-1">1.3 ผู้รับ *</label>
                <select value={form.receiver_name} name="receiver_name" onChange={setF} disabled={!recvShift}
                  className="w-full border border-earth-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-earth-card disabled:text-earth-ink3">
                  {!recvShift && <option value="">เลือกผลัดก่อน</option>}
                  {recvShift && !recvShift.members.length && <option value="">ผลัดนี้ยังไม่มีรายชื่อ — Sync ที่หน้า Config</option>}
                  {recvShift && form.receiver_name && !recvShift.members.some(m => m.name === form.receiver_name) && (
                    <option value={form.receiver_name}>{form.receiver_name} (เดิม)</option>
                  )}
                  {recvShift?.members.map(m => (
                    <option key={m.name} value={m.name}>{m.name}{m.position ? ` (${m.position})` : ''}</option>
                  ))}
                </select>
              </div>
              <Inp label="ส่วน/กอง" name="receiver_dept" value={form.receiver_dept} onChange={setF} readOnly={!!recvShift} />
            </div>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600">เกิดข้อผิดพลาด: {createMutation.error?.message}</p>
          )}
          {linkError && <p className="text-sm text-red-600">{linkError}</p>}
          <div className="flex gap-3">
            {editingId && (
              <button onClick={cancelEdit} disabled={createMutation.isPending}
                className="px-6 bg-earth-card hover:bg-earth-border text-earth-ink font-semibold py-3 rounded-xl touch-target border border-earth-border">
                ยกเลิก
              </button>
            )}
            <button onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !form.parameter_name || !form.record_datetime}
              className="flex-1 bg-brand hover:bg-sky-700 disabled:opacity-40 text-white font-semibold py-3 rounded-xl touch-target transition-colors">
              {createMutation.isPending ? 'กำลังบันทึก...' : editingId ? 'บันทึกการแก้ไข' : 'ออกใบ CAR และส่ง LINE'}
            </button>
          </div>
        </div>
      )}

      </div>{/* end 75% left */}

      {/* ── 40% right: calendar sidebar ── */}
      <div className="flex-[7] sticky top-0 h-[78vh] flex flex-col gap-2 py-1 overflow-hidden">
        <div className="flex-1 min-h-0">
          <MiniCalendar year={thisYear} month={thisMonth} events={calEvents} selectedDate={filterDate} onDateClick={setFilterDate} />
        </div>
        <div className="flex-1 min-h-0">
          <MiniCalendar year={nextYear} month={nextMonth} events={calEvents} selectedDate={filterDate} onDateClick={setFilterDate} />
        </div>
      </div>

      <CenterToast key={toast?.id} toast={toast} />

      {confirmBox && (
        <CarConfirmDialog
          kind={confirmBox.kind}
          car={confirmBox.car}
          onCancel={() => setConfirmBox(null)}
          onConfirm={async () => {
            const { kind, car } = confirmBox;
            if (kind === 'line') await doResendLine(car); else await doDelete(car);
            setConfirmBox(null);
          }}
        />
      )}

      {/* Slide panel (outside flow) */}
      {selectedCar && (
        <CarSlidePanel
          key={`${selectedCar.id}:${selectedCar.status_code}:${selectedCar.assignee_name || ''}`}
          car={selectedCar}
          onForward={handleForward}
          onReclaim={handleReclaim}
          carUser={myRole}
          onClose={() => setSelectedCar(null)}
          saving={updateMutation.isPending}
          onUpdate={(id, data) => updateMutation.mutate({ id, ...data })}
          onEdit={startEdit}
          onDelete={handleDelete}
        />
      )}

      {/* Admin panel */}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  );
}
