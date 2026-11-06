// Daily Report (/op-record?station=DAILY) rules shared by the browser and the server.
// Plain JS, no React — imported by client (OpRecord.jsx, dailyReportIssues.js, PrintReport.jsx)
// and by server/routes/dailyReport.js (auto-run) via dynamic import().
// dailyReportIssues() mirrors the N/A / red-box checks in OpRecord.jsx DailyReportTab; keep them in step.

// ── Filtration backwash ──────────────────────────────────────────────────────

// FWS2 LEVEL BEFORE BACKWASH IDs are not in the normal stride (+2 from byShift).
// They live in a separate, interleaved range (7944-7971) and must be listed explicitly.
const P3_LEVEL_IDS = [7944,7951,7945,7952,7946,7953,7947,7954,7948,7955,7949,7956,7950,7957];
const P4_LEVEL_IDS = [7958,7965,7959,7966,7960,7967,7961,7968,7962,7969,7963,7970,7964,7971];

export const FWS_BW_PHASES = [
  { id: 'P1', src: 'FWS#1', totalBeds: 8,  startNo: 1,  station: 'FWS1', topic: 'BACKWASHING P#12', base: 317 },
  { id: 'P2', src: 'FWS#1', totalBeds: 8,  startNo: 9,  station: 'FWS1', topic: 'BACKWASHING P#12', base: 399 },
  { id: 'P3', src: 'FWS#2', totalBeds: 14, startNo: 1,  station: 'FWS2', topic: 'BACKWASHING P#3',  base: 479, levelIds: P3_LEVEL_IDS },
  { id: 'P4', src: 'FWS#2', totalBeds: 14, startNo: 1,  station: 'FWS2', topic: 'BACKWASHING P#4',  base: 621, levelIds: P4_LEVEL_IDS },
];

const BW_SLOTS = ['08:00', '16:00', '24:00'];

// Parse backwash events from raw history for a phase.
// Returns a flat list — one entry per wash event (slot with any data).
// Each bed may contribute 0–3 entries (one per BW_SLOT).
// complete=true if all 6 fields present (green card), false = some missing (red card).
// Fields: +0 byShift, +1 filterRun, +2 level, +3 startTime, +5 endTime, +6 washQty
export function parseBWPhase(history, base, count, startNo = 1, levelIds = null) {
  if (!history) return null;
  const events = [];
  for (let i = 0; i < count; i++) {
    const b           = base + i * 10;
    const byShiftId   = b;
    const filterRunId = b + 1;
    const levelId     = levelIds ? levelIds[i] : b + 2;
    const startTimeId = b + 3;
    const endTimeId   = b + 5;
    const washQtyId   = b + 6;
    const fieldIds    = [byShiftId, filterRunId, levelId, startTimeId, endTimeId, washQtyId];
    for (const slot of BW_SLOTS) {
      const vals = fieldIds.map(id => history[String(id)]?.[slot]);
      const hasValue = v => v !== null && v !== undefined && v !== '' && parseFloat(v) !== 0;
      const anyNonZero = vals.some(hasValue);
      if (!anyNonZero) continue;         // all null/zero → ไม่มีการล้าง ไม่สร้างการ์ด
      // START/END TIME are stored as numbers, so 00:00 arrives as 0. Count 0 as a
      // real time when the other time is non-zero; both 0 is still treated as missing.
      const isSet = v => v !== null && v !== undefined && v !== '';
      const [, , , startV, endV] = vals;
      const timeOk = (v, other) => hasValue(v) || (isSet(v) && parseFloat(v) === 0 && hasValue(other));
      const allNonZero = hasValue(vals[0]) && hasValue(vals[1]) && hasValue(vals[2])
        && timeOk(startV, endV) && timeOk(endV, startV) && hasValue(vals[5]);
      const shiftNum  = parseInt(history[String(byShiftId)]?.[slot], 10);
      const filterRun = parseFloat(history[String(filterRunId)]?.[slot]);
      const washQty   = parseFloat(history[String(washQtyId)]?.[slot]);
      events.push({
        no:        startNo + i,
        byShiftId: b,
        slot,
        shift:     !isNaN(shiftNum)  ? shiftNum   : null,
        filterRun: !isNaN(filterRun) && filterRun !== 0 ? filterRun  : null,
        washQty:   !isNaN(washQty)   && washQty   !== 0 ? washQty    : null,
        complete:  allNonZero,
      });
    }
  }
  return events;
}

// ── Red-box issues ───────────────────────────────────────────────────────────

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
