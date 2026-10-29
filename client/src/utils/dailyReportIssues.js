// What the Daily Report page (/op-record?station=DAILY) shows as N/A or a red box,
// as a flat list — used by /record before exporting DailyLab.
// Mirrors the null checks in OpRecord.jsx DailyReportTab; keep them in step.
import { FWS_BW_PHASES, parseBWPhase } from '../pages/OpRecord.jsx';

const DONUTS = [
  ['ALUM', 'alum', 'alum_use', 'alum_actual'],
  ['PACl', 'pacl', 'pacl_use', 'pacl_actual'],
  ['PRE-CL', 'pre_cl', 'cl_use_pre', 'cl_actual_pre'],
  ['POST-CL', 'post_cl', 'cl_use_post', 'cl_actual_post'],
];

// → [{ section, items: [label, …] }] (empty = nothing to fix)
export function dailyReportIssues(d, fwsMap) {
  if (!d) return [{ section: 'Daily Report', items: ['ไม่มีผลคำนวณ'] }];
  if (d.day_complete === false) {
    return [{ section: 'Daily Report', items: ['วันยังไม่ครบ (ก่อน 24:00) — ค่าทั้งวันยังเป็น N/A'] }];
  }
  const out = [];
  const add = (section, rows) => {
    const items = rows.filter(([, v]) => v == null).map(([label]) => label);
    if (items.length) out.push({ section, items });
  };
  const sum = (a, b) => (a == null || b == null ? null : a + b);
  const s = d.summary || {};

  add('A. SUMMARY KPI', [
    ['WATER PRODUCED', d.card3_pumped?.total],
    ['% LOSS WATER', s.water_loss_pct],
    ['ENERGY', d.card12_energy?.total],
  ]);
  add('TOTAL COST', [
    ['ต้นทุนสารเคมี', s.chem_cost_per_m3],
    ['ต้นทุนพลังงานไฟฟ้า', s.energy_per_m3],
    ['ต้นทุนกำจัดตะกอน', s.sludge_cost_per_m3],
    ['ต้นทุนรวม', s.op_cost_per_m3],
  ]);

  const rw = d.card1_raw_water || {};
  add('สถานีสูบน้ำดิบ 1 และ 2', [['เฟส 1', rw.phase1], ['เฟส 2', rw.phase2], ['เฟส 3', rw.phase3], ['เฟส 4', rw.phase4], ['ปริมาณน้ำดิบรวม', rw.total]]);
  const wl = d.card2_water_level || {};
  add('ระดับน้ำ', [['CWT 24:00', wl.cwt_at24], ['CWT ต่ำสุด', wl.cwt_min], ['CWT สูงสุด', wl.cwt_max], ['RW ต่ำสุด', wl.rw_min], ['RW สูงสุด', wl.rw_max]]);
  const pu = d.card3_pumped || {};
  add('สถานีสูบส่งและสูบจ่าย', [['สูบจ่าย Line A', pu.dps_lineA], ['สูบจ่าย Line B', pu.dps_lineB], ['สูบส่ง', pu.tps], ['สูบส่ง+สูบจ่ายรวม', pu.total]]);
  const pr = d.card4_pressure || {};
  add('แรงดัน', [['สูบจ่ายต่ำสุด', pr.dps_min], ['สูบจ่ายสูงสุด', pr.dps_max], ['สูบส่งต่ำสุด', pr.tps_min], ['สูบส่งสูงสุด', pr.tps_max]]);
  const sl = d.card11_sludge || {};
  add('ปริมาณน้ำระบายตะกอน', [['เฟส 1', sl.phase1], ['เฟส 2', sl.phase2], ['เฟส 3', sl.phase3], ['เฟส 4', sl.phase4]]);
  const e = d.card12_energy || {};
  add('การใช้ไฟฟ้า', [['SS1A - DPS', e.dps], ['SS1B - TPS', e.tps], ['SS3A - WS1', e.fws1], ['SS3B - WS2', e.fws2], ['SS2A - RW1', e.rws1], ['SS2B - RW2', e.rws2], ['SS3 - Bldg.', e.bldg]]);
  add('SERVICE WATER', [['SERVICE WATER', s.service_water_m3]]);

  const rem = d.card13_chem_remaining || {};
  add('CHEMICAL REMAINING', [
    ['PA1', rem.pacl?.chem1_m3], ['PA2', rem.pacl?.chem2_m3], ['AL1', rem.alum?.chem1_m3], ['AL2', rem.alum?.chem2_m3],
    ['CL1', rem.chlorine?.chem1_ton], ['CL2', rem.chlorine?.chem2_ton],
    ['PA1-2 Day', rem.pacl?.days_ph12], ['PA3-4 Day', rem.pacl?.days_ph34], ['AL1-2 Day', rem.alum?.days_ph12],
    ['AL3-4 Day', rem.alum?.days_ph34], ['CL1 Day', rem.chlorine?.days_chem1], ['CL2 Day', rem.chlorine?.days_chem2],
  ]);
  add('การใช้สารเคมี (USE / INCOME / RETURN)', [
    ['Alum USE', sum(d.card9_chem1_alum?.out, d.card10_chem2_alum?.out)],
    ['Alum INCOME', sum(d.card9_chem1_alum?.in, d.card10_chem2_alum?.in)],
    ['PACl USE', sum(d.card5_chem1_pacl?.out, d.card6_chem2_pacl?.out)],
    ['PACl INCOME', sum(d.card5_chem1_pacl?.in, d.card6_chem2_pacl?.in)],
    ['CHLORINE USE', sum(d.card7_chem1_cl?.use_kg, d.card8_chem2_cl?.use_kg)],
    ['CHLORINE INCOME', d.cl_income],
    ['CHLORINE RETURN', d.cl_return],
  ]);

  // CHEMICAL tab cards
  const tank = (name, c, a, b, ka, kb) => add(`CHEMICAL — ${name}`, [[`Δ Tank ${a}`, c?.[ka]], [`Δ Tank ${b}`, c?.[kb]], ['Net', c?.net], ['IN', c?.in], ['OUT (USE)', c?.out]]);
  tank('CHEM1 PACl', d.card5_chem1_pacl, 'A', 'B', 'tankA_delta', 'tankB_delta');
  tank('CHEM2 PACl', d.card6_chem2_pacl, 'C', 'D', 'tankC_delta', 'tankD_delta');
  tank('CHEM1 ALUM', d.card9_chem1_alum, 'A', 'B', 'tankA_delta', 'tankB_delta');
  tank('CHEM2 ALUM', d.card10_chem2_alum, 'C', 'D', 'tankC_delta', 'tankD_delta');
  const c7 = d.card7_chem1_cl, c8 = d.card8_chem2_cl;
  add('CHEMICAL — CHEM1 Chlorine', [['Δ Line A', c7?.lineA_delta], ['Δ Line B', c7?.lineB_delta], ['IN', c7?.in_kg], ['USE', c7?.use_kg]]);
  add('CHEMICAL — CHEM2 Chlorine', [['Δ Line C', c8?.lineC_delta], ['Δ Line D', c8?.lineD_delta], ['IN', c8?.in_kg], ['USE', c8?.use_kg]]);

  // C. CHEMICAL ACCURACY WALL — a phase that is dosed (TARGET known) but USE/ACTUAL missing
  const cd = d.card14_chem_dosing || {};
  const wall = [];
  for (const [name, t, u, a] of DONUTS) {
    for (const p of [1, 2, 3, 4]) {
      if (cd[`${t}_p${p}`] == null) continue;
      const miss = [cd[`${u}_p${p}`] == null && 'USE', cd[`${a}_p${p}`] == null && 'ACTUAL'].filter(Boolean);
      if (miss.length) wall.push(`${name} PHASE#${p} (${miss.join(', ')})`);
    }
  }
  if (wall.length) out.push({ section: 'C. CHEMICAL ACCURACY WALL', items: wall });

  // WASH Water — red card = a backwash event with some fields missing
  if (fwsMap) {
    const hist = { P1: fwsMap.FWS1, P2: fwsMap.FWS1, P3: fwsMap.FWS2, P4: fwsMap.FWS2 };
    const wash = [];
    FWS_BW_PHASES.forEach((ph, i) => {
      const events = parseBWPhase(hist[ph.id], ph.base, ph.totalBeds, ph.startNo, ph.levelIds ?? null);
      const bad = (events || []).filter(ev => !ev.complete);
      if (bad.length) wash.push(`Phase ${i + 1}: ข้อมูลล้างไม่ครบ ${bad.map(ev => `#${ev.no} ${ev.slot}`).join(', ')}`);
    });
    if (wash.length) out.push({ section: 'WASH Water', items: wash });
  }
  return out;
}
