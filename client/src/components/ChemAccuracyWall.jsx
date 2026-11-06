// C. CHEMICAL ACCURACY WALL — ใช้ร่วมกันระหว่างหน้า DAILY (OpRecord) และ popup Query daily chemical dosing (/record)
// คำนวณจาก report.card14_chem_dosing ของ Daily Report: TARGET / USE / ACTUAL ต่อเฟส และ % ความแม่น
import React from 'react';
import { PieChart, Pie, Cell } from 'recharts';

function NA() {
  return <span className="text-red-600 font-bold">N/A</span>;
}

export const CHEM_DONUT_ROWS = [
  { col: 'left',  phase: 'PACl PHASE#1',    useUnit: 'TON', doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'right', phase: 'PRE-CL PHASE#1',  useUnit: 'kg',  doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'left',  phase: 'PACl PHASE#2',    useUnit: 'TON', doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'right', phase: 'PRE-CL PHASE#2',  useUnit: 'kg',  doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'left',  phase: 'PACl PHASE#3',    useUnit: 'TON', doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'right', phase: 'PRE-CL PHASE#3',  useUnit: 'kg',  doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'left',  phase: 'PACl PHASE#4',    useUnit: 'TON', doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'right', phase: 'PRE-CL PHASE#4',  useUnit: 'kg',  doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'left',  phase: 'ALUM PHASE#1',    useUnit: 'TON', doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'right', phase: 'POST-CL PHASE#1', useUnit: 'kg',  doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'left',  phase: 'ALUM PHASE#2',    useUnit: 'TON', doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'right', phase: 'POST-CL PHASE#2', useUnit: 'kg',  doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'left',  phase: 'ALUM PHASE#3',    useUnit: 'TON', doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'right', phase: 'POST-CL PHASE#3', useUnit: 'kg',  doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'left',  phase: 'ALUM PHASE#4',    useUnit: 'TON', doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
  { col: 'right', phase: 'POST-CL PHASE#4', useUnit: 'kg',  doseUnit: 'mg/L', use: 0, target: 0, actual: 0, pct: 0 },
];

// phase label → card14_chem_dosing key stem: target `${t}_pN` · use `${u}_pN` · actual `${a}_pN`
const KEYS = {
  'PACl':    { t: 'pacl',    u: 'pacl_use',    a: 'pacl_actual' },
  'ALUM':    { t: 'alum',    u: 'alum_use',    a: 'alum_actual' },
  'PRE-CL':  { t: 'pre_cl',  u: 'cl_use_pre',  a: 'cl_actual_pre' },
  'POST-CL': { t: 'post_cl', u: 'cl_use_post', a: 'cl_actual_post' },
};

// d = Daily Report (computeDailyReport) หรือ null ถ้ายังไม่ได้ query
export function buildChemDonutRows(d) {
  const cd = d?.card14_chem_dosing;
  const dayOpen = !!d && d.day_complete === false;
  return CHEM_DONUT_ROWS.map(r => {
    const [, chem, p] = r.phase.match(/^(.+) PHASE#(\d)$/);
    const k = KEYS[chem];
    const v = cd?.[`${k.t}_p${p}`];
    const u = cd?.[`${k.u}_p${p}`];
    const a = cd?.[`${k.a}_p${p}`];
    const tgt = v != null ? +v.toFixed(2) : 0;
    const act = a != null ? +a.toFixed(2) : 0;
    const pct = tgt > 0 ? Math.max(0, Math.round((tgt - Math.abs(act - tgt)) / tgt * 100)) : 0;
    return {
      ...r,
      target: tgt,
      use:    u != null ? +u.toFixed(3) : 0,
      actual: act,
      noData: v == null,
      // day not finished (before 24:00) → TARGET is only a partial-day average: not final
      targetNA: dayOpen,
      useNA:    dayOpen || (!!d && u == null),
      actualNA: dayOpen || (!!d && a == null),
      pct,
    };
  });
}

export function ChemDonutCard({ phase, useUnit, doseUnit, use, target, actual, pct, noData, useNA = false, actualNA = false, targetNA = false }) {
  const inactive = noData === true;
  const red = !inactive && (useNA || actualNA || targetNA);
  const color = red ? '#dc2626' : inactive ? '#9ca3af'
              : pct >= 80 ? '#16a34a'
              : pct >= 70 ? '#d97706'
              :             '#dc2626';
  const data = inactive || red
    ? [{ value: 0 }, { value: 100 }]
    : [{ value: pct }, { value: 100 - pct }];
  return (
    <div className={`border rounded p-1.5 flex gap-2 items-center ${red ? 'border-red-400 bg-red-50' : 'border-earth-border bg-earth-DEFAULT'}`}>
      <div className="relative shrink-0" style={{ width: 60, height: 60 }}>
        <PieChart width={60} height={60}>
          <Pie data={data} cx={25} cy={25} innerRadius={17} outerRadius={27} startAngle={90} endAngle={-270} dataKey="value" stroke="none">
            <Cell fill={color} />
            <Cell fill="#e5e7eb" />
          </Pie>
        </PieChart>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-black leading-none" style={{ color, fontSize: 12 }}>
            {inactive ? '—' : red ? 'N/A' : `${pct}%`}
          </span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className={`font-bold leading-tight mb-1 ${red ? 'text-red-700' : 'text-earth-ink'}`} style={{ fontSize: 14 }}>{phase}</div>
        <div className="grid grid-cols-3 gap-x-1 text-earth-ink2" style={{ fontSize: 14 }}>
          <span>USE</span><span>TARGET</span><span>ACTUAL</span>
          <span className="font-mono text-earth-ink">{useNA && !inactive ? <NA /> : use}<span className="text-earth-ink3 font-sans font-normal ml-0.5" style={{ fontSize: 11 }}>{useUnit}</span></span>
          <span className="font-mono text-earth-ink">{inactive ? '—' : targetNA ? <NA /> : (target ?? 0)}<span className="text-earth-ink3 font-sans font-normal ml-0.5" style={{ fontSize: 11 }}>{doseUnit}</span></span>
          <span className="font-mono text-earth-ink">{inactive ? '—' : actualNA ? <NA /> : actual}<span className="text-earth-ink3 font-sans font-normal ml-0.5" style={{ fontSize: 11 }}>{doseUnit}</span></span>
        </div>
      </div>
    </div>
  );
}

// rows = buildChemDonutRows(report) · 2 คอลัมน์: ซ้าย PACl/ALUM · ขวา PRE-CL/POST-CL
export function ChemAccuracyWall({ rows, className = '', style }) {
  const left  = rows.filter(r => r.col === 'left');
  const right = rows.filter(r => r.col === 'right');
  return (
    <div className={`flex flex-col overflow-hidden bg-earth-DEFAULT ${className}`} style={style}>
      <div className="shrink-0 px-3 py-1 bg-earth-card border-b border-earth-border">
        <span className="text-base font-bold text-earth-ink2 uppercase tracking-wider">C. CHEMICAL ACCURACY WALL</span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col gap-0.5 p-1">
        {left.map((ld, i) => (
          <div key={ld.phase} className="flex-1 min-h-0 grid grid-cols-2 gap-1">
            <ChemDonutCard {...ld} />
            <ChemDonutCard {...right[i]} />
          </div>
        ))}
      </div>
    </div>
  );
}
