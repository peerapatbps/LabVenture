import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from '../api.js';
import DateSyncBar from '../components/DateSyncBar.jsx';

const TANKS = ['A', 'B', 'C', 'D'];
const TODAY = () => new Date().toISOString().split('T')[0];

const CHEM_CONFIG = {
  Alum: { label: 'Alum', color: 'blue', capacity: { A: 750, B: 750, C: 750, D: 650 } },
  PACl: { label: 'PACl', color: 'amber', capacity: { A: 25, B: 25, C: 25, D: 23 } },
};

const CHEM_TANK_CFG = {
  Alum: {
    A: { value: 93,   status: 95  },
    B: { value: 96,   status: 98  },
    C: { value: 155,  status: 157 },
    D: { value: 158,  status: 160 },
  },
  PACl: {
    A: { value: 8405, status: 8406 },
    B: { value: 8407, status: 8408 },
    C: { value: 8419, status: 8420 },
    D: { value: 8421, status: 8422 },
  },
};

const COLOR = {
  blue:  { dot: 'bg-blue-600', ring: 'ring-blue-400', pill: 'bg-blue-100 text-blue-800 border-blue-300', tank: 'bg-blue-500', tankBg: 'bg-blue-50 border-blue-200', label: 'text-blue-700', header: 'bg-blue-600' },
  amber: { dot: 'bg-amber-500', ring: 'ring-amber-400', pill: 'bg-amber-100 text-amber-800 border-amber-300', tank: 'bg-amber-400', tankBg: 'bg-amber-50 border-amber-200', label: 'text-amber-700', header: 'bg-amber-500' },
};

function toNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function fmt(v, digits = 1) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtWeight(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// ─── Tank Graphic 2×2 ─────────────────────────────────────────────────────
function TankGraphic({ chemType, tanks, aqLevels }) {
  const cfg = CHEM_CONFIG[chemType];
  if (!cfg) return null;
  const c = COLOR[cfg.color];

  return (
    <div className={`flex flex-col h-full border rounded-xl overflow-hidden ${c.tankBg}`}>
      <div className="grid grid-cols-2 gap-2 p-2 flex-1">
        {TANKS.map(t => {
          const cap = cfg.capacity[t];
          const before = parseFloat(tanks[t][0]) || 0;
          const after = parseFloat(tanks[t][1]) || 0;
          const fillPct = Math.min((after / cap) * 100, 100);
          const beforePct = Math.min((before / cap) * 100, 100);
          const hasBefore = tanks[t][0] !== '';
          const hasAfter = tanks[t][1] !== '';
          const aq = aqLevels?.[t];
          const aqPct = aq?.value != null ? Math.min((aq.value / cap) * 100, 100) : null;
          const bgColor = cfg.color === 'blue' ? '#3b82f6' : '#f59e0b';
          const statusCfg = aq?.status === 'on'      ? { dot: 'bg-green-500', text: 'ON',      textCls: 'text-green-700' }
                          : aq?.status === 'standby' ? { dot: 'bg-red-500',   text: 'STANDBY', textCls: 'text-red-600'   }
                          : aq?.status === 'repair'  ? { dot: 'bg-gray-900',  text: 'REPAIR',  textCls: 'text-gray-700'  }
                          : null;
          return (
            <div key={t} className="flex flex-col items-center gap-1 h-full">
              <div className="w-full flex items-center justify-between px-0.5">
                <span className={`text-sm font-bold ${c.label}`}>{t}</span>
                <div className="flex items-center gap-1">
                  {aq?.value != null && (
                    <span className={`text-sm font-mono font-semibold ${c.label}`}>{aq.value.toFixed(1)}</span>
                  )}
                  {statusCfg && (
                    <>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${statusCfg.dot}`} />
                      <span className={`text-sm font-semibold ${statusCfg.textCls}`}>{statusCfg.text}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="relative w-full flex-1 rounded-lg border-2 border-gray-300 bg-white overflow-hidden">
                {aqPct != null && !hasBefore && (
                  <div className="absolute bottom-0 left-0 right-0 opacity-15 transition-all duration-500"
                    style={{ height: `${aqPct}%`, background: bgColor }} />
                )}
                {hasBefore && (
                  <div className="absolute bottom-0 left-0 right-0 opacity-20 transition-all duration-500"
                    style={{ height: `${beforePct}%`, background: bgColor }} />
                )}
                {hasAfter && (
                  <div className={`absolute bottom-0 left-0 right-0 ${c.tank} opacity-75 transition-all duration-500`}
                    style={{ height: `${fillPct}%` }} />
                )}
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-gray-200" />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-sm text-gray-400 leading-none">{cap} m³</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Top Form ──────────────────────────────────────────────────────────────
function TopForm({ me, onSaved, wdataFetchedAt, editRecord, onCancelEdit, canSave }) {
  const blank = { truck: '', delivery_book: '', delivery_no: '', sg: '', temperature: '' };
  const blankTanks = { A: ['', ''], B: ['', ''], C: ['', ''], D: ['', ''] };

  const [fields, setFields] = useState(blank);
  const [tanks, setTanks] = useState(blankTanks);
  const [chemType, setChemType] = useState(null);
  const [aqLevels, setAqLevels] = useState(null);
  const [aqTs, setAqTs] = useState(null);
  const [aqFetching, setAqFetching] = useState(false);
  const truckRef = useRef(null);
  const isEditing = !!editRecord;

  useEffect(() => {
    setConfirmDelete(false);
    if (!editRecord) {
      setFields(blank);
      setTanks(blankTanks);
      setChemType(null);
      return;
    }
    const r = editRecord;
    setFields({
      truck: r.truck || '',
      delivery_book: r.delivery_book || '',
      delivery_no: r.delivery_no || '',
      sg: r.sg != null ? String(r.sg) : '',
      temperature: r.temperature != null ? String(r.temperature) : '',
    });
    setTanks({
      A: [r.tank_a_before != null ? String(r.tank_a_before) : '', r.tank_a_after != null ? String(r.tank_a_after) : ''],
      B: [r.tank_b_before != null ? String(r.tank_b_before) : '', r.tank_b_after != null ? String(r.tank_b_after) : ''],
      C: [r.tank_c_before != null ? String(r.tank_c_before) : '', r.tank_c_after != null ? String(r.tank_c_after) : ''],
      D: [r.tank_d_before != null ? String(r.tank_d_before) : '', r.tank_d_after != null ? String(r.tank_d_after) : ''],
    });
    setChemType(r.chemical_type || null);
  }, [editRecord]);

  useEffect(() => {
    setAqLevels(null);
    setAqTs(null);
    if (!isEditing) setTanks(blankTanks);
    if (!chemType || isEditing) return;

    const cfgMap = CHEM_TANK_CFG[chemType];
    if (!cfgMap) return;

    setAqFetching(true);
    get('/api/chem-intake/chem-summary')
      .then(data => {
        if (!data?.Aq) return;
        const aq = data.Aq;
        const levels = {};
        let ts = null;
        for (const tank of TANKS) {
          const { value: vCfg, status: sCfg } = cfgMap[tank];
          const vEntry = aq[String(vCfg)];
          const sEntry = aq[String(sCfg)];
          const val = vEntry?.value ?? null;
          const statusRaw = sEntry?.value ?? sEntry?.value_text ?? null;
          let status = null;
          if (statusRaw != null) {
            const s = String(statusRaw).toUpperCase().trim();
            if (s === 'REPAIR') status = 'repair';
            else if (Number(statusRaw) === 0 || s === '0' || s === 'OFF' || s === 'STANDBY') status = 'standby';
            else status = 'on';
          }
          levels[tank] = { value: val, status };
          if (!ts && vEntry?.ts) ts = vEntry.ts;
        }
        setAqLevels(levels);
        setAqTs(ts);
        setTanks(prev => {
          const next = { ...prev };
          for (const tank of TANKS) {
            const val = levels[tank]?.value;
            if (val != null && next[tank][0] === '') {
              next[tank] = [String(Math.round(val * 10) / 10), next[tank][1]];
            }
          }
          return next;
        });
      })
      .catch(() => {})
      .finally(() => setAqFetching(false));
  }, [chemType, isEditing]);

  const createMutation = useMutation({
    mutationFn: (body) => post('/api/chem-intake', body),
    onSuccess: () => {
      setFields(blank); setTanks(blankTanks); setChemType(null); setAqLevels(null); setAqTs(null);
      truckRef.current?.focus();
      onSaved();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }) => patch(`/api/chem-intake/${id}`, body),
    onSuccess: () => { onCancelEdit(); onSaved(); },
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: (id) => del(`/api/chem-intake/${id}`),
    onSuccess: () => { onCancelEdit(); onSaved(); },
  });

  const mutation = isEditing ? updateMutation : createMutation;

  function buildBody() {
    return {
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
    };
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!fields.truck.trim()) return;
    if (isEditing) {
      updateMutation.mutate({ id: editRecord.id, body: buildBody() });
    } else {
      createMutation.mutate(buildBody());
    }
  }

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500';

  return (
    <section className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${isEditing ? 'border-amber-400 ring-2 ring-amber-300' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="font-bold text-lg text-gray-800">
            Top · {isEditing ? `แก้ไขรายการ — ${editRecord.truck}` : 'บันทึกข้อมูล'}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {isEditing ? 'แก้ไขข้อมูลแล้วกด "บันทึกการแก้ไข"' : 'กรอกข้อมูลจากหน้างาน — ใช้ทะเบียนรถเป็นตัวอ้างอิงหลัก'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing && (
            <button type="button" onClick={onCancelEdit}
              className="text-sm font-semibold px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200">
              ยกเลิกแก้ไข
            </button>
          )}
          <span className={`text-sm font-semibold px-3 py-1.5 rounded-full ${isEditing ? 'bg-amber-100 text-amber-700' : 'bg-amber-100 text-amber-700'}`}>
            {isEditing ? 'Edit Mode' : 'Entry Form'}
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-gray-600">ทะเบียนรถ *</label>
            <input ref={truckRef} className={inp} value={fields.truck}
              onChange={e => setFields(f => ({ ...f, truck: e.target.value }))}
              placeholder="เช่น 93-6790" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-gray-600">ค่า ถ.พ.</label>
            <input className={inp} value={fields.sg} type="number" step="0.001"
              onChange={e => setFields(f => ({ ...f, sg: e.target.value }))}
              placeholder="0.000" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-gray-600">อุณหภูมิ (°C)</label>
            <input className={inp} value={fields.temperature} type="number" step="0.1"
              onChange={e => setFields(f => ({ ...f, temperature: e.target.value }))}
              placeholder="0.0" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-gray-600">ใบนำส่ง เล่มที่</label>
            <input className={inp} value={fields.delivery_book}
              onChange={e => setFields(f => ({ ...f, delivery_book: e.target.value }))}
              placeholder="เล่มที่" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-gray-600">ใบนำส่ง เลขที่</label>
            <input className={inp} value={fields.delivery_no}
              onChange={e => setFields(f => ({ ...f, delivery_no: e.target.value }))}
              placeholder="เลขที่" />
          </div>
        </div>

        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-600">สารเคมีและการเติมถัง</span>
            {!chemType && <span className="text-sm text-amber-600 font-semibold">← เลือกประเภทสารเคมีก่อน</span>}
            {aqFetching && <span className="text-sm text-blue-500">กำลังโหลดระดับถัง...</span>}
          </div>
          <div className="flex divide-x divide-gray-100" style={{ minHeight: 200 }}>
            <div className="flex flex-col p-3" style={{ width: '15%' }}>
              <span className="text-sm font-semibold text-gray-500 mb-2">ประเภท *</span>
              <div className="flex flex-col gap-2">
                {Object.entries(CHEM_CONFIG).map(([key, cfg]) => {
                  const c = COLOR[cfg.color];
                  const active = chemType === key;
                  return (
                    <button key={key} type="button" onClick={() => setChemType(active ? null : key)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-bold transition-all text-left ${
                        active ? `${c.pill} border-current ring-1 ${c.ring}` : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
                      }`}>
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${active ? c.dot : 'bg-gray-300'}`} />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
              {chemType && (() => {
                const cfg = CHEM_CONFIG[chemType];
                const c = COLOR[cfg.color];
                const tsLabel = aqTs
                  ? aqTs.includes('T')
                    ? new Date(aqTs).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                    : aqTs.split(' ')[1]?.slice(0, 8) ?? aqTs
                  : aqFetching ? '...' : '—';
                return (
                  <div className="mt-auto pt-3 border-t border-gray-100 space-y-0.5">
                    <span className={`block text-sm font-bold ${c.label}`}>{cfg.label}</span>
                    <span className={`block text-sm font-mono px-1.5 py-0.5 rounded border ${c.pill} leading-tight`}>
                      ณ {tsLabel}
                    </span>
                  </div>
                );
              })()}
            </div>

            <div className="p-2 flex flex-col" style={{ width: '25%' }}>
              {chemType
                ? <TankGraphic key={chemType} chemType={chemType} tanks={tanks} aqLevels={aqLevels} />
                : (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-sm text-gray-300 text-center">เลือกประเภทสารเคมี<br />เพื่อดูแผนผังถัง</span>
                  </div>
                )
              }
            </div>

            <div className="flex flex-col" style={{ width: '60%' }}>
              <table className="w-full text-lg border-collapse flex-1">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-2 text-sm text-gray-500 font-semibold border-b border-r border-gray-100 w-24">ถัง</th>
                    <th className="text-left px-4 py-2 text-sm text-gray-500 font-semibold border-b border-r border-gray-100">ก่อนเติม</th>
                    <th className="text-left px-4 py-2 text-sm text-gray-500 font-semibold border-b border-gray-100">หลังเติม</th>
                  </tr>
                </thead>
                <tbody>
                  {TANKS.map((t, i) => {
                    const cap = chemType ? CHEM_CONFIG[chemType].capacity[t] : null;
                    const disabled = !chemType;
                    const inpCls = `${inp} ${disabled ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`;
                    return (
                      <tr key={t} className={`${i < TANKS.length - 1 ? 'border-b border-gray-100' : ''} ${disabled ? 'opacity-50' : ''}`}>
                        <th className="text-left px-4 py-2 border-r border-gray-100 bg-gray-50 w-24">
                          <span className="text-lg font-bold text-gray-700">Tank {t}</span>
                          {cap && <span className="block text-sm text-gray-400 font-normal">{cap} m³</span>}
                        </th>
                        <td className="px-2 py-1.5 border-r border-gray-100">
                          <input className={inpCls} value={tanks[t][0]} type="number" step="0.1" placeholder="0.0"
                            disabled={disabled}
                            onChange={e => setTanks(tk => ({ ...tk, [t]: [e.target.value, tk[t][1]] }))} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className={inpCls} value={tanks[t][1]} type="number" step="0.1" placeholder="0.0"
                            disabled={disabled}
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
          <p className="text-sm text-gray-400">ข้อมูลน้ำหนักจะแสดงใน Bottom เมื่อ sync กับ WDATA ได้</p>
          <div className="flex gap-2">
            {isEditing && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-600 font-semibold">ยืนยันลบรายการนี้?</span>
                  <button type="button" onClick={() => deleteMutation.mutate(editRecord.id)}
                    disabled={deleteMutation.isPending}
                    className="px-4 py-2 text-lg font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                    {deleteMutation.isPending ? 'กำลังลบ...' : 'ยืนยัน'}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)}
                    className="px-4 py-2 text-lg font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2 text-lg font-semibold rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-200">
                  ลบรายการ
                </button>
              )
            )}
            <button type="button" onClick={() => {
              setFields(blank); setTanks(blankTanks); setChemType(null);
              setAqLevels(null); setAqTs(null); setConfirmDelete(false);
              if (isEditing) onCancelEdit();
            }} className="px-4 py-2 text-lg font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
              ล้างข้อมูล
            </button>
            <button type="submit"
              disabled={mutation.isPending || !fields.truck.trim() || !canSave}
              title={!canSave ? 'เฉพาะ Operator Class เท่านั้นที่บันทึกได้ (Bypass active)' : undefined}
              className={`px-5 py-2 text-lg font-semibold rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed ${isEditing ? 'bg-amber-500 hover:bg-amber-600' : 'bg-teal-700 hover:bg-teal-800'}`}>
              {mutation.isPending ? 'กำลังบันทึก...' : isEditing ? 'บันทึกการแก้ไข' : 'บันทึก'}
            </button>
          </div>
        </div>
        {mutation.isError && <p className="text-sm text-red-600">{mutation.error?.message}</p>}
      </form>
    </section>
  );
}

// ─── Claim Popup ───────────────────────────────────────────────────────────
function ClaimPopup({ productName, rows, onClose, onConfirm }) {
  const [toggles, setToggles] = useState(() =>
    Object.fromEntries(rows.map(r => [r.id, true]))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-lg text-gray-800">รับ Sampling — {productName}</h3>
          <p className="text-sm text-gray-500 mt-0.5">ตรวจสอบขวดแต่ละคัน แล้วยืนยันการรับ</p>
        </div>
        <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {rows.map(r => (
            <div key={r.id} className="flex items-center justify-between px-5 py-3">
              <span className="font-mono font-bold text-lg text-gray-800">{r.truck}</span>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold ${toggles[r.id] ? 'text-teal-700' : 'text-red-600'}`}>
                  {toggles[r.id] ? 'พบ' : 'ไม่พบ'}
                </span>
                <button onClick={() => setToggles(t => ({ ...t, [r.id]: !t[r.id] }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${toggles[r.id] ? 'bg-teal-600' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${toggles[r.id] ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 text-lg font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
            ยกเลิก
          </button>
          <button onClick={() => onConfirm(rows.map(r => ({ id: r.id, found: toggles[r.id] })))}
            className="px-5 py-2 text-lg font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-800">
            ยืนยันรับสารเคมี
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Daily income calculation ───────────────────────────────────────────────
function computeChemIncome(enrichedRecords, chemType) {
  const filtered = enrichedRecords.filter(r => r.chemical_type === chemType);
  const tankSummary = {};
  for (const t of TANKS) {
    tankSummary[t] = { netVol: 0, netWeight: 0, firstBefore: null, lastAfter: null, hasData: false };
  }

  for (const r of filtered) {
    const tankVols = {};
    let tripTotalVol = 0;
    for (const t of TANKS) {
      const before = r[`tank_${t.toLowerCase()}_before`];
      const after = r[`tank_${t.toLowerCase()}_after`];
      if (before != null && after != null) {
        const vol = after - before;
        if (vol > 0) { tankVols[t] = vol; tripTotalVol += vol; }
      }
    }
    for (const [t, vol] of Object.entries(tankVols)) {
      const allocWeight = (tripTotalVol > 0 && r.net != null) ? (vol / tripTotalVol) * r.net : null;
      const ts = tankSummary[t];
      const before = r[`tank_${t.toLowerCase()}_before`];
      const after = r[`tank_${t.toLowerCase()}_after`];
      ts.hasData = true;
      ts.netVol += vol;
      if (allocWeight != null) ts.netWeight += allocWeight;
      if (ts.firstBefore === null) ts.firstBefore = before;
      ts.lastAfter = after;
    }
  }

  const totalWeight = Object.values(tankSummary).reduce((s, t) => s + t.netWeight, 0);
  const hasSyncedWeight = filtered.some(r => r.net != null);
  return { tanks: tankSummary, totalWeight, hasSyncedWeight };
}

// ─── Chem Income Column (Alum or PACl) ────────────────────────────────────
function ChemIncomeColumn({ chemType, enrichedRecords }) {
  const cfg = CHEM_CONFIG[chemType];
  const c = COLOR[cfg.color];
  const { tanks, totalWeight, hasSyncedWeight } = computeChemIncome(enrichedRecords, chemType);
  const anyData = Object.values(tanks).some(t => t.hasData);

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className={`px-4 py-2.5 flex items-center gap-2 ${c.header}`}>
        <span className="w-2.5 h-2.5 rounded-full bg-white opacity-80" />
        <span className="font-bold text-white text-sm tracking-wide">{cfg.label}</span>
      </div>

      {!anyData ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <span className="text-sm text-gray-300">ยังไม่มีรายการ {cfg.label}</span>
        </div>
      ) : (
        <div className="flex-1 p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="text-left pb-2 font-semibold w-14">ถัง</th>
                <th className="text-center pb-2 font-semibold">ก่อน → หลัง</th>
                <th className="text-right pb-2 font-semibold">ปริมาตร (m³)</th>
                <th className="text-right pb-2 font-semibold">น้ำหนัก (kg)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {TANKS.map(t => {
                const ts = tanks[t];
                if (!ts.hasData) {
                  return (
                    <tr key={t} className="text-gray-300">
                      <td className="py-2 font-bold">Tank {t}</td>
                      <td className="py-2 text-center">—</td>
                      <td className="py-2 text-right">—</td>
                      <td className="py-2 text-right">—</td>
                    </tr>
                  );
                }
                return (
                  <tr key={t} className="text-gray-700">
                    <td className="py-2 font-bold text-gray-800">Tank {t}</td>
                    <td className="py-2 text-center font-mono text-xs">
                      {fmt(ts.firstBefore, 1)} → {fmt(ts.lastAfter, 1)}
                    </td>
                    <td className="py-2 text-right font-mono">{fmt(ts.netVol, 1)}</td>
                    <td className="py-2 text-right font-mono">
                      {ts.netWeight > 0 ? fmtWeight(ts.netWeight) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200">
                <td colSpan={3} className="pt-2.5 text-sm font-bold text-gray-700">น้ำหนักรวม</td>
                <td className="pt-2.5 text-right font-bold text-gray-900 font-mono">
                  {totalWeight > 0 ? fmtWeight(totalWeight) : '—'}
                  {!hasSyncedWeight && anyData && (
                    <span className="block text-xs text-orange-500 font-normal">รอ WDATA sync</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Complete Column ────────────────────────────────────────────────────────
function CompleteColumn({ date, records, onCompleted }) {
  const stageCount = records.filter(r => !r.is_completed).length;
  const isCompleted = records.length > 0 && stageCount === 0;
  const completedAt = isCompleted
    ? records.find(r => r.completed_at)?.completed_at
    : null;

  const completeMutation = useMutation({
    mutationFn: () => patch(`/api/chem-intake/complete-day?date=${date}`, {}),
    onSuccess: () => onCompleted(),
  });

  const [confirm, setConfirm] = useState(false);

  const completedLabel = completedAt
    ? (() => {
        const d = new Date(completedAt);
        return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
      })()
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="px-4 py-2.5 flex items-center gap-2 bg-gray-700">
        <span className="font-bold text-white text-sm tracking-wide">สถานะวัน</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
        {records.length === 0 ? (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2">
              <span className="text-2xl text-gray-300">○</span>
            </div>
            <p className="text-sm text-gray-400">ยังไม่มีรายการ</p>
          </div>
        ) : isCompleted ? (
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-teal-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-8 h-8 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-bold text-teal-700">Completed</p>
            {completedLabel && <p className="text-xs text-gray-400 mt-1">เวลา {completedLabel} น.</p>}
          </div>
        ) : (
          <div className="text-center w-full">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-2">
              <span className="text-lg font-bold text-amber-600">{stageCount}</span>
            </div>
            <p className="text-sm text-amber-700 font-semibold mb-1">{stageCount} รายการในคิว</p>
            <p className="text-xs text-gray-400 mb-4">ยืนยันข้อมูลครบแล้ว?</p>

            {confirm ? (
              <div className="space-y-2">
                <p className="text-xs text-red-600 font-semibold">กด Complete จะล็อกรายการทั้งหมด</p>
                <button
                  onClick={() => { setConfirm(false); completeMutation.mutate(); }}
                  disabled={completeMutation.isPending}
                  className="w-full px-3 py-2 text-sm font-bold rounded-xl bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                  {completeMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยัน Complete'}
                </button>
                <button onClick={() => setConfirm(false)}
                  className="w-full px-3 py-2 text-sm font-semibold rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200">
                  ยกเลิก
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirm(true)}
                className="w-full px-3 py-2.5 text-sm font-bold rounded-xl bg-teal-700 text-white hover:bg-teal-800 shadow-sm">
                Complete วันนี้
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Middle Section — Record ประจำวัน ──────────────────────────────────────
function RecordSection({ enrichedRecords, date, onDateChange, onEdit, onForceSync, isSyncing }) {
  const syncCount = enrichedRecords.filter(r => r.synced).length;
  const unsyncCount = enrichedRecords.filter(r => !r.synced).length;

  return (
    <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 gap-3 flex-wrap">
        <h2 className="font-bold text-lg text-gray-800">Middle · Record ประจำวัน</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm px-3 py-1.5 rounded-full bg-teal-100 text-teal-700 font-semibold">SYNC {syncCount} รายการ</span>
          <span className="text-sm px-3 py-1.5 rounded-full bg-red-100 text-red-700 font-semibold">UNSYNC {unsyncCount} รายการ</span>
          <button onClick={onForceSync} disabled={isSyncing}
            className="text-sm px-3 py-1.5 rounded-full font-semibold border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5">
            {isSyncing
              ? <><span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />กำลัง sync...</>
              : 'Force Sync'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-lg border-collapse min-w-[1200px]">
          <thead>
            <tr className="bg-gray-50 text-sm text-gray-500 uppercase tracking-wide">
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">สถานะ</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">ทะเบียนรถ</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">สินค้า / บริษัท</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">ใบนำส่ง</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">ถ.พ.</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">อุณหภูมิ</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">Tank A</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">Tank B</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">Tank C</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">Tank D</th>
              <th className="text-right px-4 py-3 border-b border-gray-100 font-semibold">น้ำหนักรวม (kg)</th>
              <th className="text-right px-4 py-3 border-b border-gray-100 font-semibold">น้ำหนักรถ (kg)</th>
              <th className="text-right px-4 py-3 border-b border-gray-100 font-semibold">สุทธิ (kg)</th>
              <th className="text-left px-4 py-3 border-b border-gray-100 font-semibold">ขวด</th>
            </tr>
          </thead>
          <tbody>
            {enrichedRecords.length === 0 && (
              <tr>
                <td colSpan={14} className="text-center py-10 text-gray-400 text-lg">ไม่มีรายการในวันนี้</td>
              </tr>
            )}
            {enrichedRecords.map(r => (
              <tr key={r.id} onClick={() => onEdit(r)} className="border-b border-gray-50 hover:bg-amber-50/60 cursor-pointer">
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className={`text-sm font-bold px-2.5 py-1 rounded-full ${r.synced ? 'bg-teal-100 text-teal-700' : 'bg-red-100 text-red-700'}`}>
                      {r.synced ? 'SYNC' : 'UNSYNC'}
                    </span>
                    {r.is_completed ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Done</span>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600">Stage</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono font-bold text-gray-800">{r.truck}</span>
                </td>
                <td className="px-4 py-3 text-gray-700 text-sm">
                  {r.synced
                    ? <><span className="block font-semibold text-gray-800">{r.w?.Product}</span><span className="text-gray-400">{r.w?.Company}</span></>
                    : <span className="text-gray-400">ยังไม่พบใน chem_report</span>}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {r.delivery_book && <span className="block text-sm text-gray-500">เล่ม {r.delivery_book}</span>}
                  {r.delivery_no || '—'}
                </td>
                <td className="px-4 py-3 font-mono text-gray-700">{r.sg ?? '—'}</td>
                <td className="px-4 py-3 text-gray-700">{r.temperature != null ? `${r.temperature} °C` : '—'}</td>
                <td className="px-4 py-3 text-gray-600 text-sm">{r.tank_a_before ?? '—'} / {r.tank_a_after ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600 text-sm">{r.tank_b_before ?? '—'} / {r.tank_b_after ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600 text-sm">{r.tank_c_before ?? '—'} / {r.tank_c_after ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600 text-sm">{r.tank_d_before ?? '—'} / {r.tank_d_after ?? '—'}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-800">{r.w ? fmtWeight(r.w.GrossIn) : '—'}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-800">{r.w ? fmtWeight(r.w.GrossOut) : '—'}</td>
                <td className="px-4 py-3 text-right font-mono font-bold text-gray-900">{r.net != null ? fmtWeight(r.net) : '—'}</td>
                <td className="px-4 py-3">
                  {r.bottle_claimed_at
                    ? <span className="text-sm text-teal-700 font-semibold">✓ รับแล้ว</span>
                    : <span className="text-sm text-gray-400">รอรับ</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {enrichedRecords.length > 0 && (
        <p className="px-5 py-3 text-sm text-gray-400">
          ข้อมูล WDATA: poll ทุก 15 นาที เมื่อมีรายการ UNSYNC — PK: TRUCK
        </p>
      )}
    </section>
  );
}

// ─── Bottom Section — Daily Income + Sampling ──────────────────────────────
function BottomSection({ records, enrichedRecords, wdata, date, me, onClaimed, onCompleted, canSampling }) {
  const [popup, setPopup] = useState(null);
  const qc = useQueryClient();

  const claimMutation = useMutation({
    mutationFn: (body) => patch('/api/chem-intake/claim-batch', body),
    onSuccess: () => { setPopup(null); onClaimed(); },
  });

  // group by product for sampling block
  const seqMap2 = {};
  const byProduct = {};
  for (const r of records) {
    seqMap2[r.truck] = (seqMap2[r.truck] || 0) + 1;
    const seq = seqMap2[r.truck];
    const w = wdata.find(w => w.Truck === r.truck && w.truck_seq === seq)
           || wdata.find(w => w.Truck === r.truck);
    const productName = w?.Product || 'ไม่ทราบประเภท';
    if (!byProduct[productName]) byProduct[productName] = [];
    byProduct[productName].push(r);
  }

  return (
    <div className="space-y-4">
      {/* Block 1: Daily chemical income */}
      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg text-gray-800">Bottom · Daily Chemical Income</h2>
            <p className="text-sm text-gray-500 mt-0.5">สรุปปริมาณสารเคมีที่รับเข้าวันนี้ แยกตามประเภทและถัง</p>
          </div>
          <span className="text-sm font-semibold px-3 py-1.5 rounded-full bg-indigo-100 text-indigo-700">Summary</span>
        </div>

        {/* 3-column grid: 40% Alum | 40% PACl | 20% Complete */}
        <div className="grid border-t border-gray-100" style={{ gridTemplateColumns: '40% 40% 20%' }}>
          <div className="border-r border-gray-100 min-h-[220px]">
            <ChemIncomeColumn chemType="Alum" enrichedRecords={enrichedRecords} />
          </div>
          <div className="border-r border-gray-100 min-h-[220px]">
            <ChemIncomeColumn chemType="PACl" enrichedRecords={enrichedRecords} />
          </div>
          <div className="min-h-[220px]">
            <CompleteColumn date={date} records={records} onCompleted={onCompleted} />
          </div>
        </div>
      </section>

      {/* Block 2: Sampling */}
      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-lg text-gray-800">Bottom · Sampling</h2>
            <p className="text-sm text-gray-500 mt-0.5">ขวดตัวอย่างประจำวัน — 1 คัน = 1 ขวด</p>
          </div>
          <span className="text-sm font-semibold px-3 py-1.5 rounded-full bg-violet-100 text-violet-700">Sampling</span>
        </div>

        {records.length === 0 ? (
          <p className="px-5 py-6 text-lg text-gray-400 text-center">ยังไม่มีรายการของวันนี้</p>
        ) : (
          <div className="p-5 flex flex-wrap gap-4">
            {Object.entries(byProduct).map(([productName, rows]) => {
              const allClaimed = rows.every(r => r.bottle_claimed_at);
              const claimedCount = rows.filter(r => r.bottle_claimed_at).length;
              return (
                <div key={productName} className={`flex items-center gap-4 px-5 py-4 rounded-xl border ${allClaimed ? 'border-teal-200 bg-teal-50' : 'border-gray-200 bg-gray-50'}`}>
                  <div>
                    <p className="text-lg font-bold text-gray-800">{productName}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {allClaimed
                        ? `รับครบ ${rows.length} ขวด — โดย ${rows[0]?.bottle_claimed_by}`
                        : `${rows.length} ขวด (รับแล้ว ${claimedCount})`}
                    </p>
                  </div>
                  <button
                    onClick={() => canSampling && setPopup({ productName, rows })}
                    disabled={!canSampling}
                    title={!canSampling ? 'เฉพาะ Scientist Class เท่านั้นที่รับ Sampling ได้ (Bypass active)' : undefined}
                    className={`ml-2 px-4 py-2 text-sm font-semibold rounded-lg whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${allClaimed ? 'bg-teal-100 text-teal-700 hover:bg-teal-200' : 'bg-teal-700 text-white hover:bg-teal-800'}`}>
                    {allClaimed ? 'ดูรายละเอียด' : 'รับ Sampling'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {popup && (
        <ClaimPopup
          productName={popup.productName}
          rows={popup.rows}
          onClose={() => setPopup(null)}
          onConfirm={(claims) => claimMutation.mutate({ claims, claimed_by: me?.name || 'unknown' })}
        />
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function ChemIntake() {
  const [date, setDate] = useState(TODAY);
  const [editRecord, setEditRecord] = useState(null);
  const topFormRef = useRef(null);
  const qc = useQueryClient();

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: () => get('/api/auth/me'),
  });
  const me = meData;

  // Role comes from LabVenture's own /api/auth/me (bypass token carries role field)
  const bypassRole = (me?.bypass && me?.role) ? me.role : null;
  // Top · บันทึกข้อมูล: operator + superadmin only when bypass active
  const canSaveTop  = !bypassRole || bypassRole === 'operator'  || bypassRole === 'superadmin';
  // Bottom · Sampling: scientist + superadmin only when bypass active
  const canSampling = !bypassRole || bypassRole === 'scientist' || bypassRole === 'superadmin';

  const { data: recordsData, refetch: refetchRecords } = useQuery({
    queryKey: ['chem-intake', date],
    queryFn: () => get(`/api/chem-intake?date=${date}`),
    refetchInterval: false,
  });
  const records = recordsData?.data || [];

  const { data: wdataRes, refetch: refetchWdata, isFetching: wdataFetching } = useQuery({
    queryKey: ['chem-wdata', date],
    queryFn: () => get(`/api/chem-intake/chem-report?date=${date}`),
    retry: false,
  });
  const wdataRaw = wdataRes?.rows || [];
  const wSeqMap = {};
  const wdata = wdataRaw.map(w => {
    wSeqMap[w.Truck] = (wSeqMap[w.Truck] || 0) + 1;
    return { ...w, truck_seq: wSeqMap[w.Truck] };
  });

  // Enrich records with WDATA at page level (shared by all sections)
  const seqMap = {};
  const enrichedRecords = records.map(r => {
    seqMap[r.truck] = (seqMap[r.truck] || 0) + 1;
    const seq = seqMap[r.truck];
    const w = wdata.find(w => w.Truck === r.truck && w.truck_seq === seq)
           || wdata.find(w => w.Truck === r.truck);
    return { ...r, truck_seq: seq, w, synced: !!w, net: w?.NetWeight ?? null };
  });

  const hasUnsync = enrichedRecords.some(r => !r.synced);
  useEffect(() => {
    if (!hasUnsync) return;
    const t = setInterval(() => { refetchRecords(); refetchWdata(); }, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, [hasUnsync, refetchRecords, refetchWdata]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['chem-intake', date] });
  }

  function handleEdit(record) {
    setEditRecord(record);
    topFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chemical Intake Daily Log</h1>
          <p className="text-lg text-gray-500 mt-0.5">ใช้ทะเบียนรถเป็นตัวอ้างอิงหลักสำหรับรายการรับสารเคมี</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me?.name && (
            <span className="text-sm px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-600">
              <strong>Operator</strong> {me.name}
            </span>
          )}
          <DateSyncBar date={date} onDateChange={setDate} hideSync />
        </div>
      </div>

      <div ref={topFormRef}>
        <TopForm
          me={me}
          onSaved={invalidate}
          wdataFetchedAt={null}
          editRecord={editRecord}
          onCancelEdit={() => setEditRecord(null)}
          canSave={canSaveTop}
        />
      </div>

      <RecordSection
        enrichedRecords={enrichedRecords}
        date={date}
        onDateChange={setDate}
        onEdit={handleEdit}
        onForceSync={() => refetchWdata()}
        isSyncing={wdataFetching}
      />

      <BottomSection
        records={records}
        enrichedRecords={enrichedRecords}
        wdata={wdata}
        date={date}
        me={me}
        onClaimed={invalidate}
        onCompleted={invalidate}
        canSampling={canSampling}
      />
    </div>
  );
}
