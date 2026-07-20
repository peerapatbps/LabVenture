'use strict';

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

// ── CWS1 — Pulsator (4 clarifiers) ──────────────────────────────────────────
// Each clarifier has: status, level, turbidity, flow, dosing
// CWS1 configID pattern (from DailyReportValidator):
// Clarifier 1: status=1395, level=1396, turb=1397, flow=1398, blowdown=1399, sludge=1400, tot=1408
// Clarifier 2: status=1413, ...gap +18 per clarifier
// Clarifier 3: status=1431, ...
// Clarifier 4: status=1449, ...
// Header: inlet_flow=1390, outlet_turb=1391, chem_alum=1392, chem_pacl=1393, chem_cl=1394

const CWS1_CLARIFIERS = [
  { name:'Clarifier 1', statusId:1395, levelId:1396, turbId:1397, flowId:1398, blowdownId:1399, sludgeId:1400,
    totVolId:1408, drainStatusId:1409, drainTotId:1410 },
  { name:'Clarifier 2', statusId:1413, levelId:1414, turbId:1415, flowId:1416, blowdownId:1417, sludgeId:1418,
    totVolId:1426, drainStatusId:1427, drainTotId:1428 },
  { name:'Clarifier 3', statusId:1431, levelId:1432, turbId:1433, flowId:1434, blowdownId:1435, sludgeId:1436,
    totVolId:1444, drainStatusId:1445, drainTotId:1446 },
  { name:'Clarifier 4', statusId:1449, levelId:1450, turbId:1451, flowId:1452, blowdownId:1453, sludgeId:1454,
    totVolId:1462, drainStatusId:1463, drainTotId:1464 },
];

const CWS1_HDR = {
  inletFlow: 1390,
  outletTurb: 1391,
  chemAlum: 1392,
  chemPacl: 1393,
  chemCl: 1394,
};

function validateCWS1(data) {
  // Step 1 — Inlet flow present when any clarifier is running
  function step1() {
    const marks = []; let found = false;
    for (const slot of SLOTS_1H) {
      const anyOn = CWS1_CLARIFIERS.some(c => isOn(getStr(data, c.statusId, slot)) === true);
      const flow = getVal(data, CWS1_HDR.inletFlow, slot);
      if (anyOn && (flow === null || flow <= 0)) {
        marks.push(mark(CWS1_HDR.inletFlow, slot, 'red')); found = true;
      }
    }
    return mkStep(1, 'Inlet Flow vs Clarifier Status', found ? 'FAILED' : 'PASSED',
      found ? ['Inlet Flow = 0 ขณะที่มี Clarifier ทำงาน'] : [], marks);
  }

  // Step 2 — Outlet turbidity must be recorded when any clarifier is running
  function step2() {
    const marks = []; const msgs = []; let found = false;
    for (const slot of SLOTS_1H) {
      const anyOn = CWS1_CLARIFIERS.some(c => isOn(getStr(data, c.statusId, slot)) === true);
      const turb = getVal(data, CWS1_HDR.outletTurb, slot);
      if (anyOn && turb === null) { marks.push(mark(CWS1_HDR.outletTurb, slot, 'orange')); found = true; }
      if (anyOn && turb !== null && turb > 2.0) {
        marks.push(mark(CWS1_HDR.outletTurb, slot, 'red'));
        msgs.push(`${slot}: Outlet Turb=${turb.toFixed(2)} NTU > 2.0`); found = true;
      }
    }
    return mkStep(2, 'Outlet Turbidity Check', found ? 'WARNING' : 'PASSED',
      found ? ['Outlet turbidity ผิดปกติ', ...msgs] : [], marks);
  }

  // Step 3 — Per-clarifier checks (level/turb when running, flow vs status)
  function step3() {
    const marks = []; const msgs = []; let found = false;
    for (const c of CWS1_CLARIFIERS) {
      for (const slot of SLOTS_1H) {
        const running = isOn(getStr(data, c.statusId, slot));
        const flow = getVal(data, c.flowId, slot);
        const level = getVal(data, c.levelId, slot);
        const turb = getVal(data, c.turbId, slot);
        if (running === true) {
          if (flow === null || flow <= 0) { marks.push(mark(c.flowId, slot, 'orange')); found = true; }
          if (level === null) { marks.push(mark(c.levelId, slot, 'orange')); found = true; }
          if (level !== null && (level < 0.5 || level > 5.0)) {
            marks.push(mark(c.levelId, slot, 'orange'));
            msgs.push(`${slot} ${c.name}: Level=${level.toFixed(2)} ผิดปกติ`); found = true;
          }
          if (turb !== null && turb > 5.0) {
            marks.push(mark(c.turbId, slot, 'red'));
            msgs.push(`${slot} ${c.name}: Turbidity=${turb.toFixed(2)} > 5.0 NTU`); found = true;
          }
        }
        if (running === false && flow !== null && flow > 0) {
          marks.push(mark(c.flowId, slot, 'orange')); found = true;
        }
      }
    }
    return mkStep(3, 'Per-Clarifier Flow/Level/Turb', found ? 'WARNING' : 'PASSED', msgs, marks);
  }

  // Step 4 — Drain at 24:00 (sludge/blowdown totalizer must be non-zero)
  function step4() {
    const marks = []; const msgs = []; let found = false;
    for (const c of CWS1_CLARIFIERS) {
      const v = getVal(data, c.totVolId, '00:00');
      if (v === null || v <= 0) {
        marks.push(mark(c.totVolId, '00:00', 'orange'));
        msgs.push(`${c.name}: Daily volume totalizer ไม่มีค่า`); found = true;
      }
    }
    return mkStep(4, 'Daily Volume Totalizer @00:00', found ? 'WARNING' : 'PASSED', msgs, marks);
  }

  // Step 5 — Chemical dosing non-zero when clarifiers running
  function step5() {
    const marks = []; let found = false;
    for (const slot of SLOTS_1H) {
      const anyOn = CWS1_CLARIFIERS.some(c => isOn(getStr(data, c.statusId, slot)) === true);
      if (!anyOn) continue;
      for (const chemId of [CWS1_HDR.chemAlum, CWS1_HDR.chemPacl]) {
        const v = getVal(data, chemId, slot);
        if (v === null || v <= 0) { marks.push(mark(chemId, slot, 'orange')); found = true; }
      }
    }
    return mkStep(5, 'Chemical Dosing (ALUM/PACl)', found ? 'WARNING' : 'PASSED',
      found ? ['Chemical dosing ว่างหรือ 0 ขณะ Clarifier ทำงาน'] : [], marks);
  }

  const steps = [step1(), step2(), step3(), step4(), step5()];
  return { station: 'CWS1', steps, cellMarks: dedup(steps.flatMap(s => s.cellMarks)), summary: { errors: steps.filter(s => s.status === 'FAILED').length, warnings: steps.filter(s => s.status === 'WARNING').length } };
}

// ── CWS2 — Solid Contact (4 clarifiers) ──────────────────────────────────────
// CWS2 similar structure but Solid Contact type; configIDs shifted ~80 from CWS1
// Pattern: starts at cfg 1467

const CWS2_CLARIFIERS = [
  { name:'SC Clarifier 1', statusId:1470, levelId:1471, turbId:1472, flowId:1473, blowdownId:1474, sludgeId:1475,
    totVolId:1483, drainStatusId:1484, drainTotId:1485 },
  { name:'SC Clarifier 2', statusId:1488, levelId:1489, turbId:1490, flowId:1491, blowdownId:1492, sludgeId:1493,
    totVolId:1501, drainStatusId:1502, drainTotId:1503 },
  { name:'SC Clarifier 3', statusId:1506, levelId:1507, turbId:1508, flowId:1509, blowdownId:1510, sludgeId:1511,
    totVolId:1519, drainStatusId:1520, drainTotId:1521 },
  { name:'SC Clarifier 4', statusId:1524, levelId:1525, turbId:1526, flowId:1527, blowdownId:1528, sludgeId:1529,
    totVolId:1537, drainStatusId:1538, drainTotId:1539 },
];

const CWS2_HDR = {
  inletFlow: 1467,
  outletTurb: 1468,
  chemAlum: 1540,
  chemPacl: 1541,
  chemCl: 1542,
  stirrerId: 1469,
};

function validateCWS2(data) {
  function step1() {
    const marks = []; let found = false;
    for (const slot of SLOTS_1H) {
      const anyOn = CWS2_CLARIFIERS.some(c => isOn(getStr(data, c.statusId, slot)) === true);
      const flow = getVal(data, CWS2_HDR.inletFlow, slot);
      if (anyOn && (flow === null || flow <= 0)) {
        marks.push(mark(CWS2_HDR.inletFlow, slot, 'red')); found = true;
      }
    }
    return mkStep(1, 'Inlet Flow vs SC Clarifier Status', found ? 'FAILED' : 'PASSED',
      found ? ['Inlet Flow = 0 ขณะมี SC Clarifier ทำงาน'] : [], marks);
  }

  function step2() {
    const marks = []; const msgs = []; let found = false;
    for (const slot of SLOTS_1H) {
      const anyOn = CWS2_CLARIFIERS.some(c => isOn(getStr(data, c.statusId, slot)) === true);
      const turb = getVal(data, CWS2_HDR.outletTurb, slot);
      if (anyOn && turb === null) { marks.push(mark(CWS2_HDR.outletTurb, slot, 'orange')); found = true; }
      if (anyOn && turb !== null && turb > 2.0) {
        marks.push(mark(CWS2_HDR.outletTurb, slot, 'red'));
        msgs.push(`${slot}: Outlet Turb=${turb.toFixed(2)} > 2.0`); found = true;
      }
    }
    return mkStep(2, 'SC Outlet Turbidity Check', found ? 'WARNING' : 'PASSED',
      found ? ['Outlet turbidity CWS2 ผิดปกติ', ...msgs] : [], marks);
  }

  function step3() {
    const marks = []; const msgs = []; let found = false;
    for (const c of CWS2_CLARIFIERS) {
      for (const slot of SLOTS_1H) {
        const running = isOn(getStr(data, c.statusId, slot));
        const flow = getVal(data, c.flowId, slot);
        const level = getVal(data, c.levelId, slot);
        if (running === true) {
          if (flow === null || flow <= 0) { marks.push(mark(c.flowId, slot, 'orange')); found = true; }
          if (level === null) { marks.push(mark(c.levelId, slot, 'orange')); found = true; }
          if (level !== null && level > 4.5) {
            marks.push(mark(c.levelId, slot, 'red'));
            msgs.push(`${slot} ${c.name}: Level=${level.toFixed(2)} สูงมาก`); found = true;
          }
        }
      }
    }
    return mkStep(3, 'Per-SC Flow/Level Check', found ? 'WARNING' : 'PASSED', msgs, marks);
  }

  function step4() {
    const marks = []; let found = false;
    for (const c of CWS2_CLARIFIERS) {
      const v = getVal(data, c.totVolId, '00:00');
      if (v === null || v <= 0) { marks.push(mark(c.totVolId, '00:00', 'orange')); found = true; }
    }
    return mkStep(4, 'Daily Volume Totalizer @00:00', found ? 'WARNING' : 'PASSED',
      found ? ['SC Clarifier daily totalizer ไม่มีค่า'] : [], marks);
  }

  function step5() {
    const marks = []; let found = false;
    for (const slot of SLOTS_1H) {
      const anyOn = CWS2_CLARIFIERS.some(c => isOn(getStr(data, c.statusId, slot)) === true);
      if (!anyOn) continue;
      for (const chemId of [CWS2_HDR.chemAlum, CWS2_HDR.chemPacl]) {
        const v = getVal(data, chemId, slot);
        if (v === null || v <= 0) { marks.push(mark(chemId, slot, 'orange')); found = true; }
      }
    }
    return mkStep(5, 'Chemical Dosing (ALUM/PACl)', found ? 'WARNING' : 'PASSED',
      found ? ['Chemical dosing ว่าง/0 ขณะ SC Clarifier ทำงาน'] : [], marks);
  }

  // Step 6 — Stirrer/mixer must be running when clarifier is ON
  function step6() {
    const marks = []; let found = false;
    for (const slot of SLOTS_1H) {
      const anyOn = CWS2_CLARIFIERS.some(c => isOn(getStr(data, c.statusId, slot)) === true);
      if (!anyOn) continue;
      const stirrer = getVal(data, CWS2_HDR.stirrerId, slot);
      if (stirrer === null || stirrer <= 0) { marks.push(mark(CWS2_HDR.stirrerId, slot, 'orange')); found = true; }
    }
    return mkStep(6, 'Stirrer Speed Check', found ? 'WARNING' : 'PASSED',
      found ? ['Stirrer speed ว่างหรือ 0 ขณะ Clarifier ทำงาน'] : [], marks);
  }

  const steps = [step1(), step2(), step3(), step4(), step5(), step6()];
  return { station: 'CWS2', steps, cellMarks: dedup(steps.flatMap(s => s.cellMarks)), summary: { errors: steps.filter(s => s.status === 'FAILED').length, warnings: steps.filter(s => s.status === 'WARNING').length } };
}

module.exports = { validateCWS1, validateCWS2 };
