import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, patch } from '../api.js';

const TANKS = ['A', 'B', 'C', 'D'];
const TODAY = () => new Date().toISOString().split('T')[0];

const CHEM_CONFIG = {
  Alum: { label: 'Alum', color: 'blue', capacity: { A: 750, B: 750, C: 750, D: 650 } },
  PACl: { label: 'PACl', color: 'amber', capacity: { A: 25, B: 25, C: 25, D: 23 } },
};

const COLOR = {
  blue:  { dot: 'bg-blue-600', ring: 'ring-blue-400', pill: 'bg-blue-100 text-blue-800 border-blue-300', tank: 'bg-blue-500', tankBg: 'bg-blue-50 border-blue-200', label: 'text-blue-700' },
  amber: { dot: 'bg-amber-500', ring: 'ring-amber-400', pill: 'bg-amber-100 text-amber-800 border-amber-300', tank: 'bg-amber-400', tankBg: 'bg-amber-50 border-amber-200', label: 'text-amber-700' },
};

function nowTag() {
  return new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// ─── Tank Graphic 2×2 ─────────────────────────────────────────────────────
function TankGraphic({ chemType, tanks, fetchedAt }) {
  const cfg = CHEM_CONFIG[chemType];
  if (!cfg) return null;
  const c = COLOR[cfg.color];

  const fetchedLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '—';

  return (
    <div className={`flex flex-col h-full border rounded-xl overflow-hidden ${c.tankBg}`}>
      <div className={`flex items-center justify-between px-3 py-2 border-b ${c.tankBg}`}>
        <span className={`text-xs font-bold ${c.label}`}>{cfg.label}</span>
        <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${c.pill}`}>ข้อมูล ณ {fetchedLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 p-2 flex-1">
        {TANKS.map(t => {
          const cap = cfg.capacity[t];
          const before = parseFloat(tanks[t][0]) || 0;
          const after = parseFloat(tanks[t][1]) || 0;
          const fillPct = Math.min((after / cap) * 100, 100);
          const beforePct = Math.min((before / cap) * 100, 100);
          const hasBefore = tanks[t][0] !== '';
          const hasAfter = tanks[t][1] !== '';
          return (
            <div key={t} className="flex flex-col items-center gap-1">
              <div className="relative w-full rounded-lg border-2 border-gray-300 bg-white overflow-hidden" style={{ height: 64 }}>
                {hasBefore && (
                  <div className="absolute bottom-0 left-0 right-0 opacity-20 transition-all duration-500"
                    style={{ height: `${beforePct}%`, background: cfg.color === 'blue' ? '#3b82f6' : '#f59e0b' }} />
                )}
                {hasAfter && (
                  <div className={`absolute bottom-0 left-0 right-0 ${c.tank} opacity-75 transition-all duration-500`}
                    style={{ height: `${fillPct}%` }} />
                )}
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-gray-200" />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-base font-black text-gray-700 leading-none">{t}</span>
                  <span className="text-xs text-gray-400 leading-none mt-0.5">{cap} m³</span>
                </div>
              </div>
              {(hasBefore || hasAfter) && (
                <span className={`text-xs font-semibold leading-none ${c.label}`}>
                  {hasBefore ? before : '—'} → {hasAfter ? after : '—'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function fmt(v, digits = 1) {
  if (v === null || v === undefined) return '-';
  return Number(v).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtWeight(v) {
  if (v === null || v === undefined) return '-';
  return Number(v).toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// ─── Top Form ──────────────────────────────────────────────────────────────
function TopForm({ me, onSaved, wdataFetchedAt }) {
  const blank = { truck: '', delivery_book: '', delivery_no: '', sg: '', temperature: '' };
  const blankTanks = { A: ['', ''], B: ['', ''], C: ['', ''], D: ['', ''] };

  const [fields, setFields] = useState(blank);
  const [tanks, setTanks] = useState(blankTanks);
  const [chemType, setChemType] = useState(null);
  const truckRef = useRef(null);

  const mutation = useMutation({
    mutationFn: (body) => post('/api/chem-intake', body),
    onSuccess: () => {
      setFields(blank);
      setTanks(blankTanks);
      setChemType(null);
      truckRef.current?.focus();
      onSaved();
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!fields.truck.trim()) return;
    mutation.mutate({
      truck: fields.truck,
      delivery_book: fields.delivery_book || null,
      delivery_no: fields.delivery_no || null,
      sg: toNum(fields.sg),
      temperature: toNum(fields.temperature),
      tank_a_before: toNum(tanks.A[0]), tank_a_after: toNum(tanks.A[1]),
      tank_b_before: toNum(tanks.B[0]), tank_b_after: toNum(tanks.B[1]),
      tank_c_before: toNum(tanks.C[0]), tank_c_after: toNum(tanks.C[1]),
      tank_d_before: toNum(tanks.D[0]), tank_d_after: toNum(tanks.D[1]),
      operator: me?.name || null,
      shift: me?.shift || null,
      chemical_type: chemType,
    });
  }

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500';

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="font-bold text-base text-gray-800">Top · บันทึกข้อมูล</h2>
          <p className="text-xs text-gray-500 mt-0.5">กรอกข้อมูลจากหน้างาน — ใช้ทะเบียนรถเป็นตัวอ้างอิงหลัก</p>
        </div>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-100 text-amber-700">Entry Form</span>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-5">
        {/* Fields row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600">ทะเบียนรถ *</label>
            <input ref={truckRef} className={inp} value={fields.truck}
              onChange={e => setFields(f => ({ ...f, truck: e.target.value }))}
              placeholder="เช่น 93-6790" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600">ค่า ถ.พ.</label>
            <input className={inp} value={fields.sg} type="number" step="0.001"
              onChange={e => setFields(f => ({ ...f, sg: e.target.value }))}
              placeholder="0.000" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600">อุณหภูมิ (°C)</label>
            <input className={inp} value={fields.temperature} type="number" step="0.1"
              onChange={e => setFields(f => ({ ...f, temperature: e.target.value }))}
              placeholder="0.0" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600">ใบนำส่ง เล่มที่</label>
            <input className={inp} value={fields.delivery_book}
              onChange={e => setFields(f => ({ ...f, delivery_book: e.target.value }))}
              placeholder="เล่มที่" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-600">ใบนำส่ง เลขที่</label>
            <input className={inp} value={fields.delivery_no}
              onChange={e => setFields(f => ({ ...f, delivery_no: e.target.value }))}
              placeholder="เลขที่" />
          </div>
        </div>

        {/* Chemical + Tank card: 3 columns 15-25-60 */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600">สารเคมีและการเติมถัง</div>
          <div className="flex divide-x divide-gray-100" style={{ minHeight: 200 }}>

            {/* Col 1 — 15% — chemical selector vertical */}
            <div className="flex flex-col gap-2 p-3 justify-start" style={{ width: '15%' }}>
              <span className="text-xs font-semibold text-gray-500 mb-1">ประเภท</span>
              {Object.entries(CHEM_CONFIG).map(([key, cfg]) => {
                const c = COLOR[cfg.color];
                const active = chemType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setChemType(active ? null : key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold transition-all text-left ${
                      active
                        ? `${c.pill} border-current ring-1 ${c.ring}`
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${active ? c.dot : 'bg-gray-300'}`} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>

            {/* Col 2 — 25% — tank graphic 2x2 */}
            <div className="p-2 flex flex-col" style={{ width: '25%' }}>
              {chemType
                ? <TankGraphic chemType={chemType} tanks={tanks} fetchedAt={wdataFetchedAt} />
                : (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-xs text-gray-300 text-center">เลือกประเภทสารเคมี<br />เพื่อดูแผนผังถัง</span>
                  </div>
                )
              }
            </div>

            {/* Col 3 — 60% — tank fill matrix */}
            <div className="flex flex-col" style={{ width: '60%' }}>
              <table className="w-full text-sm border-collapse flex-1">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-semibold border-b border-r border-gray-100 w-24">ถัง</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-semibold border-b border-r border-gray-100">ก่อนเติม</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-semibold border-b border-gray-100">หลังเติม</th>
                  </tr>
                </thead>
                <tbody>
                  {TANKS.map((t, i) => {
                    const cap = chemType ? CHEM_CONFIG[chemType].capacity[t] : null;
                    return (
                      <tr key={t} className={i < TANKS.length - 1 ? 'border-b border-gray-100' : ''}>
                        <th className="text-left px-4 py-2 border-r border-gray-100 bg-gray-50 w-24">
                          <span className="text-sm font-bold text-gray-700">Tank {t}</span>
                          {cap && <span className="block text-xs text-gray-400 font-normal">{cap} m³</span>}
                        </th>
                        <td className="px-2 py-1.5 border-r border-gray-100">
                          <input className={inp} value={tanks[t][0]} type="number" step="0.1" placeholder="0.0"
                            onChange={e => setTanks(tk => ({ ...tk, [t]: [e.target.value, tk[t][1]] }))} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className={inp} value={tanks[t][1]} type="number" step="0.1" placeholder="0.0"
                            onChange={e => setTanks(tk => ({ ...tk, [t]: [tk[t][0], e.target.value] }))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">ข้อมูลน้ำหนักจะแสดงใน Bottom เมื่อ sync กับ WDATA ได้</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setFields(blank); setTanks(blankTanks); setChemType(null); }}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
              ล้างข้อมูล
            </button>
            <button type="submit" disabled={mutation.isPending || !fields.truck.trim()}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50">
              {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
        {mutation.isError && (
          <p className="text-xs text-red-600">{mutation.error?.message}</p>
        )}
      </form>
    </section>
  );
}

// ─── Claim Popup ───────────────────────────────────────────────────────────
function ClaimPopup({ productName, rows, onClose, onConfirm, claimedBy }) {
  const [toggles, setToggles] = useState(() =>
    Object.fromEntries(rows.map(r => [r.id, true]))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-base text-gray-800">รับ Sampling — {productName}</h3>
          <p className="text-xs text-gray-500 mt-0.5">ตรวจสอบขวดแต่ละคัน แล้วยืนยันการรับ</p>
        </div>
        <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {rows.map(r => (
            <div key={r.id} className="flex items-center justify-between px-5 py-3">
              <span className="font-mono font-bold text-sm text-gray-800">{r.truck}</span>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-semibold ${toggles[r.id] ? 'text-teal-700' : 'text-red-600'}`}>
                  {toggles[r.id] ? 'พบ' : 'ไม่พบ'}
                </span>
                <button
                  onClick={() => setToggles(t => ({ ...t, [r.id]: !t[r.id] }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${toggles[r.id] ? 'bg-teal-600' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${toggles[r.id] ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
            ยกเลิก
          </button>
          <button
            onClick={() => onConfirm(rows.map(r => ({ id: r.id, found: toggles[r.id] })))}
            className="px-5 py-2 text-sm font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-800">
            ยืนยันรับสารเคมี
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Middle Section ────────────────────────────────────────────────────────
function MiddleSection({ records, wdata, me, onClaimed }) {
  const [popup, setPopup] = useState(null); // { productName, rows }
  const qc = useQueryClient();

  const claimMutation = useMutation({
    mutationFn: (body) => patch('/api/chem-intake/claim-batch', body),
    onSuccess: () => {
      setPopup(null);
      onClaimed();
    },
  });

  // merge records with wdata to get product info, group by product
  const byProduct = {};
  for (const r of records) {
    const w = wdata.find(w => w.truck === r.truck);
    const productName = w?.product_name || 'ไม่ทราบประเภท';
    if (!byProduct[productName]) byProduct[productName] = [];
    byProduct[productName].push(r);
  }

  if (records.length === 0) {
    return (
      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-base text-gray-800">Middle · Sampling</h2>
        </div>
        <p className="px-5 py-6 text-sm text-gray-400 text-center">ยังไม่มีรายการของวันนี้</p>
      </section>
    );
  }

  return (
    <>
      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-base text-gray-800">Middle · Sampling</h2>
            <p className="text-xs text-gray-500 mt-0.5">ขวดตัวอย่างประจำวัน — 1 คัน = 1 ขวด</p>
          </div>
          <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-violet-100 text-violet-700">Sampling</span>
        </div>
        <div className="p-5 flex flex-wrap gap-4">
          {Object.entries(byProduct).map(([productName, rows]) => {
            const allClaimed = rows.every(r => r.bottle_claimed_at);
            const claimedCount = rows.filter(r => r.bottle_claimed_at).length;
            return (
              <div key={productName} className={`flex items-center gap-4 px-5 py-4 rounded-xl border ${allClaimed ? 'border-teal-200 bg-teal-50' : 'border-gray-200 bg-gray-50'}`}>
                <div>
                  <p className="text-sm font-bold text-gray-800">{productName}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {allClaimed
                      ? `รับครบ ${rows.length} ขวด — โดย ${rows[0]?.bottle_claimed_by}`
                      : `${rows.length} ขวด (รับแล้ว ${claimedCount})`}
                  </p>
                </div>
                <button
                  onClick={() => setPopup({ productName, rows })}
                  className={`ml-2 px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap ${allClaimed ? 'bg-teal-100 text-teal-700 hover:bg-teal-200' : 'bg-teal-700 text-white hover:bg-teal-800'}`}>
                  {allClaimed ? 'ดูรายละเอียด' : 'รับ Sampling'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {popup && (
        <ClaimPopup
          productName={popup.productName}
          rows={popup.rows}
          claimedBy={me?.name}
          onClose={() => setPopup(null)}
          onConfirm={(claims) => claimMutation.mutate({ claims, claimed_by: me?.name || 'unknown' })}
        />
      )}
    </>
  );
}

// ─── Bottom Section ────────────────────────────────────────────────────────
function BottomSection({ records, wdata, date, onDateChange }) {
  const merged = records.map(r => {
    const w = wdata.find(w => w.truck === r.truck);
    const synced = !!w;
    const net = synced ? (w.w1 - w.w2) : null;
    return { ...r, w, synced, net };
  });

  const syncCount = merged.filter(r => r.synced).length;
  const unsyncCount = merged.filter(r => !r.synced).length;

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="font-bold text-base text-gray-800">Bottom · Record ประจำวัน</h2>
          <p className="text-xs text-gray-500 mt-0.5">รายการทั้งหมดที่บันทึกในวันนี้ merge กับ WDATA ตามทะเบียนรถ</p>
        </div>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-teal-100 text-teal-700">Daily Records</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-50">
        <input type="date" value={date} onChange={e => onDateChange(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
        <span className="text-xs px-3 py-1.5 rounded-full bg-teal-100 text-teal-700 font-semibold">SYNC {syncCount} รายการ</span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-red-100 text-red-700 font-semibold">UNSYNC {unsyncCount} รายการ</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[1200px]">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">สถานะ</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">ทะเบียนรถ</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">ใบนำส่ง</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">ถ.พ.</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">อุณหภูมิ</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">Tank A</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">Tank B</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">Tank C</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">Tank D</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">DAYIN / TMIN</th>
              <th className="text-right px-4 py-3 border-b border-gray-100 font-semibold">W1 (kg)</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">DAYOUT / TMOUT</th>
              <th className="text-right px-4 py-3 border-b border-gray-100 font-semibold">W2 (kg)</th>
              <th className="text-right px-4 py-3 border-b border-gray-100 font-semibold">สุทธิ (kg)</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">ขวด</th>
            </tr>
          </thead>
          <tbody>
            {merged.length === 0 && (
              <tr>
                <td colSpan={15} className="text-center py-10 text-gray-400 text-sm">ไม่มีรายการในวันนี้</td>
              </tr>
            )}
            {merged.map(r => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${r.synced ? 'bg-teal-100 text-teal-700' : 'bg-red-100 text-red-700'}`}>
                    {r.synced ? 'SYNC' : 'UNSYNC'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono font-bold text-gray-800">{r.truck}</span>
                  {r.synced && <span className="block text-xs text-gray-400 mt-0.5">{r.w?.product_name}</span>}
                  {!r.synced && <span className="block text-xs text-gray-400 mt-0.5">ยังไม่พบใน WDATA</span>}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {r.delivery_book && <span className="block text-xs text-gray-500">เล่ม {r.delivery_book}</span>}
                  {r.delivery_no || '-'}
                </td>
                <td className="px-4 py-3 font-mono text-gray-700">{r.sg ?? '-'}</td>
                <td className="px-4 py-3 text-gray-700">{r.temperature != null ? `${r.temperature} °C` : '-'}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{r.tank_a_before ?? '-'} / {r.tank_a_after ?? '-'}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{r.tank_b_before ?? '-'} / {r.tank_b_after ?? '-'}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{r.tank_c_before ?? '-'} / {r.tank_c_after ?? '-'}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{r.tank_d_before ?? '-'} / {r.tank_d_after ?? '-'}</td>
                <td className="px-4 py-3 text-gray-700 text-xs">
                  {r.w ? <>{r.w.dayin}<br /><span className="text-gray-400">{r.w.tmin}</span></> : '-'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-800">{r.w ? fmtWeight(r.w.w1) : '-'}</td>
                <td className="px-4 py-3 text-gray-700 text-xs">
                  {r.w ? <>{r.w.dayout}<br /><span className="text-gray-400">{r.w.tmout}</span></> : '-'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-800">{r.w ? fmtWeight(r.w.w2) : '-'}</td>
                <td className="px-4 py-3 text-right font-mono font-bold text-gray-900">{r.net != null ? fmtWeight(r.net) : '-'}</td>
                <td className="px-4 py-3">
                  {r.bottle_claimed_at
                    ? <span className="text-xs text-teal-700 font-semibold">✓ รับแล้ว</span>
                    : <span className="text-xs text-gray-400">รอรับ</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length > 0 && (
        <p className="px-5 py-3 text-xs text-gray-400">
          ข้อมูล WDATA: poll ทุก 15 นาที เมื่อมีรายการ UNSYNC — PK: TRUCK
        </p>
      )}
    </section>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function ChemIntake() {
  const [date, setDate] = useState(TODAY);
  const qc = useQueryClient();

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => get('/api/auth/me'),
  });
  const me = meData;

  const { data: recordsData, refetch: refetchRecords } = useQuery({
    queryKey: ['chem-intake', date],
    queryFn: () => get(`/api/chem-intake?date=${date}`),
    refetchInterval: false,
  });
  const records = recordsData?.data || [];

  const { data: wdataRes, refetch: refetchWdata, dataUpdatedAt: wdataUpdatedAt } = useQuery({
    queryKey: ['chem-wdata', date],
    queryFn: () => get(`/api/chem-intake/wdata?date=${date}`),
    retry: false,
  });
  const wdata = wdataRes?.data || [];

  // Auto-refresh every 15 min when there are UNSYNC records
  const hasUnsync = records.some(r => !wdata.find(w => w.truck === r.truck));
  useEffect(() => {
    if (!hasUnsync) return;
    const t = setInterval(() => { refetchRecords(); refetchWdata(); }, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, [hasUnsync, refetchRecords, refetchWdata]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['chem-intake', date] });
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Chemical Intake Daily Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">ใช้ทะเบียนรถเป็นตัวอ้างอิงหลักสำหรับรายการรับสารเคมี</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-600">
            <strong>วันที่</strong> {new Date(date + 'T00:00:00').toLocaleDateString('th-TH', { dateStyle: 'long' })}
          </span>
          {me?.name && (
            <span className="text-xs px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-600">
              <strong>Operator</strong> {me.name}
            </span>
          )}
        </div>
      </div>

      <TopForm me={me} onSaved={invalidate} wdataFetchedAt={wdataUpdatedAt || null} />
      <MiddleSection records={records} wdata={wdata} me={me} onClaimed={invalidate} />
      <BottomSection records={records} wdata={wdata} date={date} onDateChange={setDate} />
    </div>
  );
}
