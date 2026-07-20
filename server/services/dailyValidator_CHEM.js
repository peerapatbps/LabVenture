'use strict';

// CHEM1: Chemical feed (Alum, PACl, Chlorine) for Zone 1
// CHEM2: Chemical feed for Zone 2
// Each chemical type has: tank level, dosing pump status, dosing rate, day totalizer
// ConfigIDs from DailyReportValidator reference:
//
// CHEM1:
//   Alum:     tank=1545, status=1546, rate=1547, tot=1548, density=1549
//   PACl:     tank=1552, status=1553, rate=1554, tot=1555, density=1556
//   Chlorine: tank=1559, status=1560, rate=1561, tot=1562
//   Lime:     tank=1565, status=1566, rate=1567, tot=1568
//   KMnO4:    tank=1571, status=1572, rate=1573, tot=1574
//   Polymer:  tank=1577, status=1578, rate=1579, tot=1580
//
// CHEM2 (similar, shifted by ~40):
//   Alum:     tank=1585, status=1586, rate=1587, tot=1588
//   PACl:     tank=1592, status=1593, rate=1594, tot=1595
//   Chlorine: tank=1599, status=1600, rate=1601, tot=1602
//   Lime:     tank=1605, status=1606, rate=1607, tot=1608
//   KMnO4:    tank=1611, status=1612, rate=1613, tot=1614

const SLOTS_1H = Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');

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

// Tank level thresholds
const TANK_LOW_PCT = 10; // percent — warning when level < 10%

function buildChemValidator(station, chemicals) {
  return function validateCHEM(data) {
    // Step 1 — Dosing rate vs pump status consistency
    function step1() {
      const marks = []; const msgs = []; let found = false;
      for (const chem of chemicals) {
        for (const slot of SLOTS_1H) {
          const running = isOn(getStr(data, chem.statusId, slot));
          const rate = getVal(data, chem.rateId, slot);
          if (running === true && (rate === null || rate <= 0)) {
            marks.push(mark(chem.rateId, slot, 'orange')); marks.push(mark(chem.statusId, slot, 'orange'));
            msgs.push(`${slot} ${chem.name}: ปั๊มทำงานแต่ Rate=0`); found = true;
          }
          if (running === false && rate !== null && rate > 0) {
            marks.push(mark(chem.rateId, slot, 'orange'));
            msgs.push(`${slot} ${chem.name}: ปั๊มหยุดแต่ Rate>0`); found = true;
          }
        }
      }
      return mkStep(1, 'Dosing Rate vs Pump Status', found ? 'WARNING' : 'PASSED', msgs, marks);
    }

    // Step 2 — Tank level should not drop below threshold
    function step2() {
      const marks = []; const msgs = []; let found = false;
      for (const chem of chemicals) {
        if (!chem.tankId) continue;
        for (const slot of SLOTS_1H) {
          const level = getVal(data, chem.tankId, slot);
          if (level === null) continue;
          if (level < TANK_LOW_PCT) {
            marks.push(mark(chem.tankId, slot, 'orange'));
            msgs.push(`${slot} ${chem.name} Tank: ${level.toFixed(1)}% ต่ำกว่า ${TANK_LOW_PCT}%`); found = true;
          }
          if (level < 5) {
            marks.pop(); marks.push(mark(chem.tankId, slot, 'red')); // upgrade to red
          }
          if (level < 0 || level > 105) {
            marks.push(mark(chem.tankId, slot, 'red'));
            msgs.push(`${slot} ${chem.name} Tank: ${level.toFixed(1)}% ผิดช่วง (0-100%)`); found = true;
          }
        }
      }
      return mkStep(2, 'Tank Level Low Alert', found ? 'WARNING' : 'PASSED', msgs, marks);
    }

    // Step 3 — Daily totalizer must be non-zero if any dosing occurred
    function step3() {
      const marks = []; const msgs = []; let found = false;
      for (const chem of chemicals) {
        const dosedAny = SLOTS_1H.slice(0, -1).some(slot => {
          const r = getVal(data, chem.rateId, slot); return r !== null && r > 0;
        });
        if (!dosedAny) continue;
        const daily = getVal(data, chem.totId, '00:00');
        if (daily === null || daily <= 0) {
          marks.push(mark(chem.totId, '00:00', 'red'));
          msgs.push(`${chem.name}: มีการจ่ายสารแต่ Daily Totalizer = 0`); found = true;
        }
      }
      return mkStep(3, 'Daily Totalizer Check', found ? 'FAILED' : 'PASSED', msgs, marks);
    }

    // Step 4 — Hourly totalizer monotonic (non-decreasing)
    function step4() {
      const marks = []; const msgs = []; let found = false;
      for (const chem of chemicals) {
        let prev = null;
        for (const slot of SLOTS_1H) {
          const v = getVal(data, chem.totId, slot);
          if (v === null) continue;
          if (prev !== null && v < prev - 0.01) {
            marks.push(mark(chem.totId, slot, 'red'));
            msgs.push(`${slot} ${chem.name}: Totalizer ลดลง (${v.toFixed(2)} < ${prev.toFixed(2)})`); found = true;
          }
          prev = v;
        }
      }
      return mkStep(4, 'Totalizer Monotonic', found ? 'FAILED' : 'PASSED', msgs, marks);
    }

    // Step 5 — Chlorine: dosing rate should not exceed safety threshold (15 mg/L × flow)
    const chlorine = chemicals.find(c => c.name.toLowerCase().includes('chlorine') || c.name.toLowerCase().includes('cl2'));
    function step5() {
      if (!chlorine) return mkStep(5, 'Chlorine Safety Limit', 'PASSED', [], []);
      const marks = []; const msgs = []; let found = false;
      for (const slot of SLOTS_1H) {
        const rate = getVal(data, chlorine.rateId, slot);
        if (rate !== null && rate > 15.0) {
          marks.push(mark(chlorine.rateId, slot, 'red'));
          msgs.push(`${slot} Chlorine: Rate=${rate.toFixed(2)} mg/L เกิน 15 mg/L`); found = true;
        }
      }
      return mkStep(5, 'Chlorine Safety Limit (≤15 mg/L)', found ? 'FAILED' : 'PASSED', msgs, marks);
    }

    const steps = [step1(), step2(), step3(), step4(), step5()];
    return { station, steps, cellMarks: dedup(steps.flatMap(s => s.cellMarks)), summary: { errors: steps.filter(s => s.status === 'FAILED').length, warnings: steps.filter(s => s.status === 'WARNING').length } };
  };
}

const CHEM1_CHEMICALS = [
  { name:'Alum',     tankId:1545, statusId:1546, rateId:1547, totId:1548 },
  { name:'PACl',     tankId:1552, statusId:1553, rateId:1554, totId:1555 },
  { name:'Chlorine', tankId:1559, statusId:1560, rateId:1561, totId:1562 },
  { name:'Lime',     tankId:1565, statusId:1566, rateId:1567, totId:1568 },
  { name:'KMnO4',    tankId:1571, statusId:1572, rateId:1573, totId:1574 },
  { name:'Polymer',  tankId:1577, statusId:1578, rateId:1579, totId:1580 },
];

const CHEM2_CHEMICALS = [
  { name:'Alum',     tankId:1585, statusId:1586, rateId:1587, totId:1588 },
  { name:'PACl',     tankId:1592, statusId:1593, rateId:1594, totId:1595 },
  { name:'Chlorine', tankId:1599, statusId:1600, rateId:1601, totId:1602 },
  { name:'Lime',     tankId:1605, statusId:1606, rateId:1607, totId:1608 },
  { name:'KMnO4',    tankId:1611, statusId:1612, rateId:1613, totId:1614 },
];

const validateCHEM1 = buildChemValidator('CHEM1', CHEM1_CHEMICALS);
const validateCHEM2 = buildChemValidator('CHEM2', CHEM2_CHEMICALS);

module.exports = { validateCHEM1, validateCHEM2 };
