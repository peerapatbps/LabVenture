import React from 'react';

// ของใช้ร่วมของ Test Mode panel (components/testmode/*)

export const input = 'w-full border border-earth-border rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-400 disabled:bg-earth-card';
export const btnPri = 'px-3 py-1.5 text-sm font-semibold rounded-lg bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-40';
export const btnSec = 'px-3 py-1.5 text-sm rounded-lg bg-earth-card text-earth-ink2 hover:bg-earth-border disabled:opacity-40';
export const btnTiny = 'px-2 py-0.5 text-xs rounded-md bg-white/70 text-earth-ink2 border border-earth-border hover:bg-earth-border disabled:opacity-40';
export const label = 'text-xs text-earth-ink2';

export const round = (v) => (v == null ? '' : String(Math.round(v * 1000) / 1000));

export function minutesLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  return ms <= 0 ? 'หมดอายุ' : `เหลือ ${Math.ceil(ms / 60000)} นาที`;
}
export const timeTH = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('th-TH') : '—';
};

// sessionStorage (ต่อแท็บ) — อ่าน/เขียนพังได้ (private mode) จึงห่อ try ไว้
export const store = (key) => ({
  get: () => { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } },
  set: (v) => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch {} },
  clear: () => { try { sessionStorage.removeItem(key); } catch {} },
});

// ── คลอรีน (Event Class realtime "CHEMx.cl_Sn/Dn") ──
export const CL_PLANTS = [{ id: 'CHEM1', name: 'โรงคลอรีน 1' }, { id: 'CHEM2', name: 'โรงคลอรีน 2' }];
export const CL_POINTS = [
  { param: 'cl_S1', name: 'ห้องเก็บ #1' }, { param: 'cl_S2', name: 'ห้องเก็บ #2' },
  { param: 'cl_S3', name: 'ห้องเก็บ #3' }, { param: 'cl_S4', name: 'ห้องเก็บ #4' },
  { param: 'cl_D1', name: 'ห้องจ่าย #1' }, { param: 'cl_D2', name: 'ห้องจ่าย #2' },
];
export const clPointName = (stream, param) => {
  const pl = CL_PLANTS.find(x => x.id === String(stream).toUpperCase());
  const pt = CL_POINTS.find(x => x.param.toLowerCase() === String(param).toLowerCase());
  return `${pt?.name ?? param} · ${pl?.name ?? stream}`;
};

// ข้อความผลลัพธ์ใต้ปุ่ม
export function Msg({ msg }) {
  if (!msg) return null;
  return (
    <p className={`rounded-md px-3 py-2 text-xs ${msg.ok ? 'bg-teal-50 text-teal-800' : 'bg-red-50 text-red-700'}`}>
      {msg.ok ? '✓ ' : '✕ '}{msg.text}
    </p>
  );
}

// คำเตือนสั้นบรรทัดเดียว
export function Note({ tone = 'amber', children }) {
  const cls = {
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
    purple: 'bg-purple-50 text-purple-900',
  }[tone];
  return <p className={`rounded-md px-3 py-1.5 text-xs ${cls}`}>{children}</p>;
}

// คำอธิบายยาว พับไว้
export function Info({ title = 'ผลที่จะเกิดเมื่อกดฉีด', children }) {
  return (
    <details className="rounded-md bg-purple-50 px-3 py-1.5 text-xs text-purple-900">
      <summary className="cursor-pointer select-none font-semibold">ⓘ {title}</summary>
      <div className="mt-1 space-y-1">{children}</div>
    </details>
  );
}

export function TestBadge() {
  return <span className="ml-1 rounded bg-fuchsia-600 px-1 text-[10px] font-bold text-white">TEST</span>;
}
