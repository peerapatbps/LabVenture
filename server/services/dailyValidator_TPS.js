'use strict';

const SLOTS_1H = Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');
const SLOTS_3H = ['00:00','03:00','06:00','09:00','12:00','15:00','18:00','21:00'];
const KEY_TIMES = ['09:00', '22:00', '24:00'];

function num(v) { if (v === null || v === undefined || v === '') return null; const n = parseFloat(v); return isNaN(n) ? null : n; }
function getVal(data, cfgId, slot) { return num(data?.[String(cfgId)]?.[slot]); }
function getStr(data, cfgId, slot) { const v = data?.[String(cfgId)]?.[slot]; return (v === null || v === undefined || v === '') ? null : String(v).trim(); }
function isOn(v) { if (v === null) return null; const s = v.toUpperCase(); if (s === 'ON' || s === '1' || s === 'TRUE') return true; if (s === 'STANDBY' || s === '0' || s === 'FALSE' || s === 'OFF') return false; return null; }
function mkStep(index, label, status, messages, cellMarks) { return { index, label, status, messages: messages || [], cellMarks: cellMarks || [] }; }
function mark(cfgId, slot, color) { return { configparam_id: cfgId, slot, color }; }
function dedup(marks) {
  const m = new Map();
  for (const mk of marks) { const k = `${mk.configparam_id}:${mk.slot}`; const e = m.get(k); if (!e || (mk.color === 'red' && e.color === 'orange')) m.set(k, mk); }
  return [...m.values()];
}

// ── TPS ──────────────────────────────────────────────────────────────────────

const TPS = {
  statusIds: new Set([761, 777, 793, 7984]),
  pumps: [
    { name:'TPS-1A', statusId:761, powerMW:762, pair2:765, currentId:769, totId:776, rtId:768,
      tempIds:[771,772,773,774,775], suctionId:766, dischargeId:767, speedId:763 },
    { name:'TPS-1B', statusId:777, powerMW:778, pair2:781, currentId:785, totId:792, rtId:784,
      tempIds:[787,788,789,790,791], suctionId:782, dischargeId:783, speedId:779 },
    { name:'TPS-1C', statusId:793, powerMW:794, pair2:797, currentId:801, totId:808, rtId:800,
      tempIds:[803,804,805,806,807], suctionId:798, dischargeId:799, speedId:795 },
    { name:'TPS-2A', statusId:7984, powerMW:7998, pair2:7987, currentId:7990, totId:7997, rtId:7989,
      tempIds:[7992,7993,7994,7995,7996], suctionId:7999, dischargeId:7988, speedId:7985 },
  ],
  cfg758: 758, cfg759: 759, cfg8388: 8388, cfg760: 760,
  cfg809: 809, cfg810: 810, cfg6534: 6534,
  feederA: 9278, feederB: 9277,
  bldgTot: [6775, 6776],
  cfg813_815: [813, 814, 815],
};

function validateTPS(data) {
  // Step 2 — cfg758 null/0
  function step2() {
    const marks = []; let found = false;
    for (const slot of SLOTS_1H) {
      const v = getVal(data, TPS.cfg758, slot);
      if (v === null || v === 0) { marks.push(mark(TPS.cfg758, slot, 'orange')); found = true; }
    }
    return mkStep(2, 'Flow Rate (cfg758) Check', found ? 'WARNING' : 'PASSED',
      found ? ['cfg758 มีค่าว่างหรือ 0 บางช่วงเวลา'] : [], marks);
  }

  // Step 3 — Totalizer cfg759 vs Net cfg8388
  function step3() {
    const marks = []; const msgs = []; let failed = false;
    for (let i = 1; i < SLOTS_1H.length; i++) {
      const slotNow = SLOTS_1H[i], slotPrev = SLOTS_1H[i - 1];
      const tN = getVal(data, TPS.cfg759, slotNow), tP = getVal(data, TPS.cfg759, slotPrev);
      const nN = getVal(data, TPS.cfg8388, slotNow);
      if (tN === null || tP === null || nN === null) continue;
      const computed = (tN - tP) * 100;
      const diff = Math.abs(computed - nN);
      if (diff > 1.0) {
        marks.push(mark(TPS.cfg759, slotNow, 'red')); marks.push(mark(TPS.cfg8388, slotNow, 'red'));
        msgs.push(`${slotNow}: diff=${diff.toFixed(2)} เกิน 1.0`); failed = true;
      }
    }
    return mkStep(3, 'Totalizer vs Net (cfg759/cfg8388)', failed ? 'FAILED' : 'PASSED',
      failed ? ['Totalizer/Net ไม่สอดคล้องกัน', ...msgs] : [], marks);
  }

  // Step 4 — cfg760 null/0 (unless cfg8388 < 3000)
  function step4() {
    const marks = []; let found = false;
    for (const slot of SLOTS_1H) {
      const v760 = getVal(data, TPS.cfg760, slot);
      const v8388 = getVal(data, TPS.cfg8388, slot);
      if (v760 === null || (v760 === 0 && (v8388 === null || v8388 >= 3000))) {
        marks.push(mark(TPS.cfg760, slot, 'red')); found = true;
      }
    }
    return mkStep(4, 'cfg760 Null/Zero Check', found ? 'FAILED' : 'PASSED',
      found ? ['cfg760 เป็น 0 หรือว่างในช่วงที่ cfg8388 ≥ 3000'] : [], marks);
  }

  // Step 5 — cfg809/cfg810
  function step5() {
    const marks = []; const msgs = []; let found = false;
    for (const slot of SLOTS_1H) {
      const v809 = getVal(data, TPS.cfg809, slot);
      const v810 = getVal(data, TPS.cfg810, slot);
      if (v809 === null || v809 === 0) { marks.push(mark(TPS.cfg809, slot, 'orange')); found = true; }
      if (v810 === null || v810 === 0) { marks.push(mark(TPS.cfg810, slot, 'orange')); msgs.push(`${slot} cfg810 ว่าง/ศูนย์`); found = true; }
    }
    return mkStep(5, 'Pressure/Level (cfg809/cfg810)', found ? 'WARNING' : 'PASSED',
      found ? ['ค่า Pressure/Level บางช่วงผิดปกติ', ...msgs] : [], marks);
  }

  // Step 6 — Pump groups (hourly + 3H)
  function step6() {
    const marks = []; const msgs = []; let found = false;
    for (const pump of TPS.pumps) {
      const prevTemp = {};
      for (const slot of SLOTS_1H) {
        const running = isOn(getStr(data, pump.statusId, slot));
        const power = getVal(data, pump.powerMW, slot);
        if (running === null) continue;
        if (running) {
          if (power === null || power === 0) { marks.push(mark(pump.powerMW, slot, 'orange')); marks.push(mark(pump.statusId, slot, 'orange')); msgs.push(`${slot} ${pump.name}: ทำงานแต่ Power=0`); found = true; }
          const p2 = getVal(data, pump.pair2, slot);
          if (p2 === null || p2 === 0) { marks.push(mark(pump.pair2, slot, 'orange')); found = true; }
        } else {
          if (power !== null && power > 0) { marks.push(mark(pump.powerMW, slot, 'orange')); msgs.push(`${slot} ${pump.name}: หยุดแต่ Power>0`); found = true; }
        }
      }
      // 3H: current, temp, pressure, speed
      for (const slot of SLOTS_3H) {
        const running = isOn(getStr(data, pump.statusId, slot));
        if (running !== true) continue;
        const cur = getVal(data, pump.currentId, slot);
        if (cur === null || cur === 0) { marks.push(mark(pump.currentId, slot, 'orange')); found = true; }
        if (pump.speedId) { const spd = getVal(data, pump.speedId, slot); if (spd === null || spd <= 300) { marks.push(mark(pump.speedId, slot, 'orange')); found = true; } }
        if (pump.suctionId) { const su = getVal(data, pump.suctionId, slot); if (su === null || su <= 0 || su >= 1) { marks.push(mark(pump.suctionId, slot, 'orange')); found = true; } }
        if (pump.dischargeId) { const dis = getVal(data, pump.dischargeId, slot); if (dis === null || dis <= 1.5) { marks.push(mark(pump.dischargeId, slot, 'orange')); found = true; } }
        for (const tId of pump.tempIds) {
          const t = getVal(data, tId, slot);
          if (t === null) { marks.push(mark(tId, slot, 'orange')); found = true; }
          else { if (prevTemp[tId] !== undefined && Math.abs(t - prevTemp[tId]) > 10) { marks.push(mark(tId, slot, 'orange')); msgs.push(`${slot} ${pump.name} cfg${tId}: อุณหภูมิกระโดด`); found = true; } prevTemp[tId] = t; }
        }
      }
    }
    return mkStep(6, 'Pump Groups (hourly + 3H)', found ? 'WARNING' : 'PASSED',
      found ? ['ตรวจพบพฤติกรรมผิดปกติในกลุ่มปั๊ม TPS', ...msgs] : [], marks);
  }

  // Step 7 — cfg813/814/815 at 3H
  function step7() {
    const marks = []; const msgs = []; let found = false;
    for (const slot of SLOTS_3H) {
      const anyOn = TPS.pumps.some(p => isOn(getStr(data, p.statusId, slot)) === true);
      for (const cfgId of TPS.cfg813_815) {
        const v = getVal(data, cfgId, slot);
        if (anyOn && (v === null || v <= 15)) { marks.push(mark(cfgId, slot, 'orange')); msgs.push(`${slot} cfg${cfgId}: ปั๊มทำงานแต่ค่า ≤ 15`); found = true; }
        if (!anyOn && v !== null && v !== 0) { marks.push(mark(cfgId, slot, 'orange')); msgs.push(`${slot} cfg${cfgId}: ปั๊มหยุดแต่ค่า ≠ 0`); found = true; }
      }
    }
    return mkStep(7, 'Check cfg813/814/815 @3H', found ? 'WARNING' : 'PASSED', msgs, marks);
  }

  // Step 8 — Daily energy totalizer
  function step8() {
    const marks = []; const msgs = []; let found = false;
    for (const pump of TPS.pumps) {
      const daily = getVal(data, pump.totId, '00:00');
      if (daily === null || daily <= 0) { marks.push(mark(pump.totId, '00:00', 'orange')); msgs.push(`${pump.name}: Daily totalizer ไม่มีค่า`); found = true; continue; }
      let sum = 0, cnt = 0;
      for (const slot of SLOTS_1H.slice(0, -1)) { const kw = getVal(data, pump.powerMW, slot); if (kw !== null) { sum += kw; cnt++; } }
      if (cnt === 0) continue;
      const diff = Math.abs(daily - sum / 1000);
      if (sum > 0 && diff / (sum / 1000) > 0.10) { msgs.push(`${pump.name}: Daily=${daily.toFixed(3)} vs Σ MW=${(sum/1000).toFixed(3)} MWhr (${(diff/(sum/1000)*100).toFixed(1)}%)`); found = true; }
    }
    return mkStep(8, 'Daily Energy vs Σ MW (10%)', found ? 'WARNING' : 'PASSED',
      found ? ['Daily MWhr ไม่สอดคล้องกับผลรวม MW', ...msgs] : [], marks);
  }

  // Step 9 — IHM vs ON hours
  function step9() {
    const msgs = []; let failed = false;
    for (const pump of TPS.pumps) {
      const rt = getVal(data, pump.rtId, '00:00'); if (rt === null) continue;
      let hrs = 0;
      for (const slot of SLOTS_1H.slice(0, -1)) { if (isOn(getStr(data, pump.statusId, slot)) === true) hrs++; }
      const diff = Math.abs(rt - hrs);
      if (diff > 2) { msgs.push(`${pump.name}: IHM=${rt.toFixed(1)}h vs สถานะ=${hrs}h`); if (diff > 4) failed = true; }
    }
    return mkStep(9, 'Pump Runtime IHM (±2h)', msgs.length ? (failed ? 'FAILED' : 'WARNING') : 'PASSED',
      msgs.length ? ['Pump runtime ไม่สอดคล้องกับสถานะ', ...msgs] : [], []);
  }

  // Step 10 — cfg6534 service water
  function step10() {
    const v24 = getVal(data, TPS.cfg6534, '24:00'), v00 = getVal(data, TPS.cfg6534, '00:00');
    if (v24 === null || v00 === null) return mkStep(10, 'Service Water (cfg6534)', 'WARNING', ['cfg6534 ไม่มีค่า'], []);
    const delta = v24 - v00;
    if (delta <= 1000) return mkStep(10, 'Service Water (cfg6534)', 'FAILED', [`Delta=${delta.toFixed(0)} m³ ≤ 1000 (ผิดปกติ)`], [mark(TPS.cfg6534, '24:00', 'red')]);
    return mkStep(10, 'Service Water (cfg6534)', 'PASSED', [], []);
  }

  // Step 11 — Feeder cfg9278/9277
  function step11() {
    const marks = []; const msgs = []; let failed = false;
    for (const cfgId of [TPS.feederA, TPS.feederB]) {
      let prev = null;
      for (const slot of KEY_TIMES) {
        const v = getVal(data, cfgId, slot);
        if (v === null || v === 0) { marks.push(mark(cfgId, slot, 'orange')); msgs.push(`${slot} cfg${cfgId}: ว่างหรือ 0`); failed = true; }
        if (prev !== null && v !== null && v < prev) { marks.push(mark(cfgId, slot, 'red')); msgs.push(`${slot} cfg${cfgId}: ไม่ monotonic`); failed = true; }
        if (v !== null) prev = v;
      }
    }
    return mkStep(11, 'Feeder Totalizer (cfg9278/9277)', failed ? 'FAILED' : 'PASSED',
      failed ? ['Feeder totalizer ผิดปกติ', ...msgs] : [], marks);
  }

  // Step 12 — cfg6775/6776
  function step12() {
    const marks = []; const msgs = []; let found = false;
    for (const cfgId of TPS.bldgTot) {
      const v24 = getVal(data, cfgId, '24:00'), v00 = getVal(data, cfgId, '00:00');
      if (v24 !== null && v00 !== null && v24 - v00 <= 0) {
        marks.push(mark(cfgId, '24:00', 'red')); msgs.push(`cfg${cfgId}: delta ≤ 0`); found = true;
      }
    }
    return mkStep(12, 'Building Totalizer (cfg6775/6776)', found ? 'FAILED' : 'PASSED', msgs, marks);
  }

  const steps = [step2(), step3(), step4(), step5(), step6(), step7(), step8(), step9(), step10(), step11(), step12()];
  return { station: 'TPS', steps, cellMarks: dedup(steps.flatMap(s => s.cellMarks)), summary: { errors: steps.filter(s => s.status === 'FAILED').length, warnings: steps.filter(s => s.status === 'WARNING').length } };
}

// ── DPS ──────────────────────────────────────────────────────────────────────

const DPS = {
  statusIds: new Set([816, 829, 842, 857]),
  pumps: [
    { name:'DPS-1A', statusId:816, powerKW:818, speedId:817, currentId:820, totId:828, rtId:819,
      tempIds:[821,822,823,824,825,826,827], currentIds:[820] },
    { name:'DPS-1B', statusId:829, powerKW:831, speedId:830, currentId:833, totId:841, rtId:832,
      tempIds:[834,835,836,837,838,839,840], currentIds:[833] },
    { name:'DPS-2A', statusId:842, powerKW:844, speedId:843, currentId:null, totId:856, rtId:845,
      tempIds:[849,850,851,852,853,854,855], currentIds:[846,847,848] },
    { name:'DPS-2B', statusId:857, powerKW:859, speedId:858, currentId:null, totId:871, rtId:860,
      tempIds:[864,865,866,867,868,869,870], currentIds:[861,862,863] },
  ],
  totA: 873, totB: 875, netA: 8389, netB: 8390,
  flowA: 872, flowB: 874,
  level876: 876, level8469: 8469,
  pressure878: 878, pressure879: 879,
  feederActive: [883, 885],
  feederReactive: [884, 886],
};

function validateDPS(data) {
  function step2() {
    const marks = []; let found = false;
    for (const slot of SLOTS_1H) {
      for (const cfgId of [DPS.flowA, DPS.flowB]) {
        const v = getVal(data, cfgId, slot);
        if (v === null || v === 0) { marks.push(mark(cfgId, slot, 'orange')); found = true; }
      }
    }
    return mkStep(2, 'Flow Inst Null/Zero (cfg872/874)', found ? 'WARNING' : 'PASSED',
      found ? ['Flow instantaneous บางช่วงเวลาว่างหรือ 0'] : [], marks);
  }

  function step3() {
    const marks = []; const msgs = []; let failed = false;
    for (let i = 1; i < SLOTS_1H.length; i++) {
      const sN = SLOTS_1H[i], sP = SLOTS_1H[i - 1];
      const check = (totId, netId, lbl) => {
        const tN = getVal(data, totId, sN), tP = getVal(data, totId, sP), nN = getVal(data, netId, sN);
        if (tN === null || tP === null || nN === null) return;
        const diff = Math.abs((tN - tP) * 100 - nN);
        if (diff > 1.0) { marks.push(mark(totId, sN, 'red')); marks.push(mark(netId, sN, 'red')); msgs.push(`${sN} ${lbl}: diff=${diff.toFixed(2)}`); failed = true; }
      };
      check(DPS.totA, DPS.netA, 'TotA/NetA');
      check(DPS.totB, DPS.netB, 'TotB/NetB');
    }
    return mkStep(3, 'Totalizer vs Net (DPS)', failed ? 'FAILED' : 'PASSED',
      failed ? ['Totalizer/Net ไม่สอดคล้องกัน', ...msgs] : [], marks);
  }

  function step5() {
    const marks = []; const msgs = []; let found = false;
    // Cross-check: cfg876 (cm) vs cfg8469 (m) — ratio should be ~100
    for (const slot of SLOTS_1H) {
      const cm = getVal(data, DPS.level876, slot), m = getVal(data, DPS.level8469, slot);
      if (cm !== null && m !== null && m > 0) {
        if (Math.abs(cm / m - 100) > 10) { marks.push(mark(DPS.level876, slot, 'orange')); marks.push(mark(DPS.level8469, slot, 'orange')); msgs.push(`${slot}: cfg876/cfg8469 ไม่สอดคล้องกัน`); found = true; }
      }
      // Pressure
      const p878 = getVal(data, DPS.pressure878, slot), p879 = getVal(data, DPS.pressure879, slot);
      if (p878 !== null && p879 !== null && p878 > 0 && p879 > 0 && Math.abs(p878 - p879) / Math.max(p878, p879) > 0.05) {
        marks.push(mark(DPS.pressure878, slot, 'orange')); marks.push(mark(DPS.pressure879, slot, 'orange')); found = true;
      }
    }
    return mkStep(5, 'Level/Pressure Cross-check', found ? 'WARNING' : 'PASSED', msgs, marks);
  }

  function step6() {
    const marks = []; const msgs = []; let found = false;
    for (const pump of DPS.pumps) {
      const prevTemp = {};
      for (const slot of SLOTS_1H) {
        const running = isOn(getStr(data, pump.statusId, slot));
        const power = getVal(data, pump.powerKW, slot);
        if (running === null) continue;
        if (running) {
          if (power === null || power === 0) { marks.push(mark(pump.powerKW, slot, 'orange')); marks.push(mark(pump.statusId, slot, 'orange')); msgs.push(`${slot} ${pump.name}: ทำงานแต่ kW=0`); found = true; }
          if (pump.speedId) { const s = getVal(data, pump.speedId, slot); if (s === null || s === 0) { marks.push(mark(pump.speedId, slot, 'orange')); found = true; } }
        } else {
          if (power !== null && power > 0) { marks.push(mark(pump.powerKW, slot, 'orange')); msgs.push(`${slot} ${pump.name}: หยุดแต่มีค่า kW`); found = true; }
        }
      }
      // 3H: current + temp
      for (const slot of SLOTS_3H) {
        const running = isOn(getStr(data, pump.statusId, slot));
        if (running !== true) continue;
        for (const cId of pump.currentIds) { const c = getVal(data, cId, slot); if (c === null || c === 0) { marks.push(mark(cId, slot, 'orange')); found = true; } }
        for (const tId of pump.tempIds) {
          const t = getVal(data, tId, slot);
          if (t === null) { marks.push(mark(tId, slot, 'orange')); found = true; }
          else { if (prevTemp[tId] !== undefined && Math.abs(t - prevTemp[tId]) > 10) { marks.push(mark(tId, slot, 'orange')); msgs.push(`${slot} ${pump.name} cfg${tId}: อุณหภูมิกระโดด`); found = true; } prevTemp[tId] = t; }
        }
      }
    }
    return mkStep(6, 'Pump Groups (hourly + 3H)', found ? 'WARNING' : 'PASSED',
      found ? ['ตรวจพบพฤติกรรมผิดปกติในกลุ่มปั๊ม DPS', ...msgs] : [], marks);
  }

  function step8() {
    const marks = []; const msgs = []; let found = false;
    for (const pump of DPS.pumps) {
      const daily = getVal(data, pump.totId, '00:00');
      if (daily === null || daily <= 0) { marks.push(mark(pump.totId, '00:00', 'orange')); found = true; continue; }
      let sum = 0, cnt = 0;
      for (const slot of SLOTS_1H.slice(0, -1)) { const kw = getVal(data, pump.powerKW, slot); if (kw !== null) { sum += kw; cnt++; } }
      if (cnt === 0) continue;
      const exp = sum / 1000;
      if (exp > 0 && Math.abs(daily - exp) / exp > 0.10) { msgs.push(`${pump.name}: Daily=${daily.toFixed(3)} vs Σ kW=${exp.toFixed(3)} MWhr`); found = true; }
    }
    return mkStep(8, 'Daily Energy vs Σ kW (10%)', found ? 'WARNING' : 'PASSED',
      found ? ['Daily MWhr ไม่สอดคล้องกับผลรวม kW', ...msgs] : [], marks);
  }

  function step9() {
    const msgs = []; let failed = false;
    for (const pump of DPS.pumps) {
      const rt = getVal(data, pump.rtId, '00:00'); if (rt === null) continue;
      let hrs = 0;
      for (const slot of SLOTS_1H.slice(0, -1)) { if (isOn(getStr(data, pump.statusId, slot)) === true) hrs++; }
      const diff = Math.abs(rt - hrs);
      if (diff > 2) { msgs.push(`${pump.name}: IHM=${rt.toFixed(1)}h vs สถานะ=${hrs}h`); if (diff > 4) failed = true; }
    }
    return mkStep(9, 'Pump Runtime IHM (±2h)', msgs.length ? (failed ? 'FAILED' : 'WARNING') : 'PASSED',
      msgs.length ? ['Pump runtime ไม่สอดคล้องกับสถานะ', ...msgs] : [], []);
  }

  function step11() {
    const marks = []; const msgs = []; let failed = false;
    let prev = null;
    for (const slot of KEY_TIMES) {
      const v = DPS.feederActive.reduce((s, id) => { const x = getVal(data, id, slot); return x !== null ? s + x : s; }, 0);
      if (v === 0) { for (const id of DPS.feederActive) marks.push(mark(id, slot, 'orange')); msgs.push(`${slot}: Feeder sum=0`); failed = true; }
      if (prev !== null && v < prev) { for (const id of DPS.feederActive) marks.push(mark(id, slot, 'red')); msgs.push(`${slot}: Feeder ไม่ monotonic`); failed = true; }
      if (v > 0) prev = v;
    }
    return mkStep(11, 'Feeder Active (cfg883/885)', failed ? 'FAILED' : 'PASSED',
      failed ? ['Feeder totalizer ผิดปกติ', ...msgs] : [], marks);
  }

  const steps = [step2(), step3(), step5(), step6(), step8(), step9(), step11()];
  return { station: 'DPS', steps, cellMarks: dedup(steps.flatMap(s => s.cellMarks)), summary: { errors: steps.filter(s => s.status === 'FAILED').length, warnings: steps.filter(s => s.status === 'WARNING').length } };
}

module.exports = { validateTPS, validateDPS };
