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

// ── FWS1 ─────────────────────────────────────────────────────────────────────
// FWS1: 16 filters (A1..A4, B1..B4, C1..C4, D1..D4)
// Status configID pattern derived from DailyReportValidator:
//   Filter group A: statusIds[888,904,920,936], totIds[899,915,931,947], flowIds[889,905,921,937]
//   Filter group B: statusIds[952,968,984,1000], totIds[963,979,995,1011], flowIds[953,969,985,1001]
//   Filter group C: statusIds[1016,1032,1048,1064], totIds[1027,1043,1059,1075], flowIds[1017,1033,1049,1065]
//   Filter group D: statusIds[1080,1096,1112,1128], totIds[1091,1107,1123,1139], flowIds[1081,1097,1113,1129]

const FWS1_FILTERS = [
  // Group A
  { name:'A1', statusId:888,  flowId:889,  totId:899,  turbId:890,  hhId:900,  blowId:898,  filterRunId:901 },
  { name:'A2', statusId:904,  flowId:905,  totId:915,  turbId:906,  hhId:916,  blowId:914,  filterRunId:917 },
  { name:'A3', statusId:920,  flowId:921,  totId:931,  turbId:922,  hhId:932,  blowId:930,  filterRunId:933 },
  { name:'A4', statusId:936,  flowId:937,  totId:947,  turbId:938,  hhId:948,  blowId:946,  filterRunId:949 },
  // Group B
  { name:'B1', statusId:952,  flowId:953,  totId:963,  turbId:954,  hhId:964,  blowId:962,  filterRunId:965 },
  { name:'B2', statusId:968,  flowId:969,  totId:979,  turbId:970,  hhId:980,  blowId:978,  filterRunId:981 },
  { name:'B3', statusId:984,  flowId:985,  totId:995,  turbId:986,  hhId:996,  blowId:994,  filterRunId:997 },
  { name:'B4', statusId:1000, flowId:1001, totId:1011, turbId:1002, hhId:1012, blowId:1010, filterRunId:1013 },
  // Group C
  { name:'C1', statusId:1016, flowId:1017, totId:1027, turbId:1018, hhId:1028, blowId:1026, filterRunId:1029 },
  { name:'C2', statusId:1032, flowId:1033, totId:1043, turbId:1034, hhId:1044, blowId:1042, filterRunId:1045 },
  { name:'C3', statusId:1048, flowId:1049, totId:1059, turbId:1050, hhId:1060, blowId:1058, filterRunId:1061 },
  { name:'C4', statusId:1064, flowId:1065, totId:1075, turbId:1066, hhId:1076, blowId:1074, filterRunId:1077 },
  // Group D
  { name:'D1', statusId:1080, flowId:1081, totId:1091, turbId:1082, hhId:1092, blowId:1090, filterRunId:1093 },
  { name:'D2', statusId:1096, flowId:1097, totId:1107, turbId:1098, hhId:1108, blowId:1106, filterRunId:1109 },
  { name:'D3', statusId:1112, flowId:1113, totId:1123, turbId:1114, hhId:1124, blowId:1122, filterRunId:1125 },
  { name:'D4', statusId:1128, flowId:1129, totId:1139, turbId:1130, hhId:1140, blowId:1138, filterRunId:1141 },
];

// Header-level cfgs for FWS1
const FWS1_HDR = {
  totalFlow: 887,       // FWS1 total flow inst
  turbidity: 886,       // FWS1 outlet turbidity
  pressure_in: 884,
  pressure_out: 885,
};

function validateFWS1(data) {
  // Step 1 — Total flow not zero when any filter is online
  function step1() {
    const marks = []; let found = false;
    for (const slot of SLOTS_1H) {
      const anyOn = FWS1_FILTERS.some(f => isOn(getStr(data, f.statusId, slot)) === true);
      const totalFlow = getVal(data, FWS1_HDR.totalFlow, slot);
      if (anyOn && (totalFlow === null || totalFlow <= 0)) {
        marks.push(mark(FWS1_HDR.totalFlow, slot, 'red')); found = true;
      }
    }
    return mkStep(1, 'Total Flow vs Filter Status', found ? 'FAILED' : 'PASSED',
      found ? ['Total flow = 0 ขณะที่มี Filter ทำงาน'] : [], marks);
  }

  // Step 2 — Per-filter flow consistency with status
  function step2() {
    const marks = []; const msgs = []; let found = false;
    for (const f of FWS1_FILTERS) {
      for (const slot of SLOTS_1H) {
        const running = isOn(getStr(data, f.statusId, slot));
        const flow = getVal(data, f.flowId, slot);
        if (running === true && (flow === null || flow <= 0)) {
          marks.push(mark(f.flowId, slot, 'orange')); marks.push(mark(f.statusId, slot, 'orange'));
          msgs.push(`${slot} Filter ${f.name}: Filter ON แต่ Flow=0`); found = true;
        }
        if (running === false && flow !== null && flow > 0) {
          marks.push(mark(f.flowId, slot, 'orange'));
          msgs.push(`${slot} Filter ${f.name}: Filter OFF แต่มี Flow`); found = true;
        }
      }
    }
    return mkStep(2, 'Per-Filter Flow vs Status', found ? 'WARNING' : 'PASSED', msgs, marks);
  }

  // Step 3 — Turbidity should be recorded when filter is online
  function step3() {
    const marks = []; const msgs = []; let found = false;
    for (const f of FWS1_FILTERS) {
      for (const slot of SLOTS_1H) {
        const running = isOn(getStr(data, f.statusId, slot));
        const turb = getVal(data, f.turbId, slot);
        if (running === true && turb === null) {
          marks.push(mark(f.turbId, slot, 'orange')); found = true;
        }
        if (running === true && turb !== null && turb > 1.0) {
          marks.push(mark(f.turbId, slot, 'red'));
          msgs.push(`${slot} Filter ${f.name}: Turbidity=${turb.toFixed(2)} NTU > 1.0`); found = true;
        }
      }
    }
    return mkStep(3, 'Filter Turbidity Check', found ? 'WARNING' : 'PASSED',
      found ? ['Turbidity ผิดปกติบางช่วงเวลา', ...msgs] : [], marks);
  }

  // Step 4 — Totalizer accumulation check at 00:00 vs day sum
  function step4() {
    const marks = []; const msgs = []; let found = false;
    for (const f of FWS1_FILTERS) {
      const daily = getVal(data, f.totId, '00:00');
      if (daily === null || daily <= 0) { marks.push(mark(f.totId, '00:00', 'orange')); found = true; }
    }
    return mkStep(4, 'Filter Daily Totalizer Check', found ? 'WARNING' : 'PASSED',
      found ? ['Totalizer รายวันบาง Filter ไม่มีค่า'] : [], marks);
  }

  const steps = [step1(), step2(), step3(), step4()];
  return { station: 'FWS1', steps, cellMarks: dedup(steps.flatMap(s => s.cellMarks)), summary: { errors: steps.filter(s => s.status === 'FAILED').length, warnings: steps.filter(s => s.status === 'WARNING').length } };
}

// ── FWS2 ─────────────────────────────────────────────────────────────────────
// FWS2: 28 filters (A1..A7, B1..B7, C1..C7, D1..D7) — 4 groups × 7 filters
// ConfigID pattern follows FWS1 but shifted; base starts ~1145

function buildFWS2Filters() {
  const groups = ['A','B','C','D'];
  const filters = [];
  let base = 1145;
  for (const grp of groups) {
    for (let i = 1; i <= 7; i++) {
      filters.push({
        name: `${grp}${i}`,
        statusId: base,
        flowId: base + 1,
        turbId: base + 2,
        totId: base + 12,
        hhId: base + 13,
        blowId: base + 11,
        filterRunId: base + 14,
      });
      base += 16;
    }
  }
  return filters;
}

const FWS2_FILTERS = buildFWS2Filters();

const FWS2_HDR = {
  totalFlow: 1144,
  turbidity: 1143,
  pressure_in: 1141,
  pressure_out: 1142,
};

function validateFWS2(data) {
  function step1() {
    const marks = []; let found = false;
    for (const slot of SLOTS_1H) {
      const anyOn = FWS2_FILTERS.some(f => isOn(getStr(data, f.statusId, slot)) === true);
      const totalFlow = getVal(data, FWS2_HDR.totalFlow, slot);
      if (anyOn && (totalFlow === null || totalFlow <= 0)) {
        marks.push(mark(FWS2_HDR.totalFlow, slot, 'red')); found = true;
      }
    }
    return mkStep(1, 'Total Flow vs Filter Status', found ? 'FAILED' : 'PASSED',
      found ? ['Total flow = 0 ขณะที่มี Filter ทำงาน'] : [], marks);
  }

  function step2() {
    const marks = []; const msgs = []; let found = false;
    for (const f of FWS2_FILTERS) {
      for (const slot of SLOTS_1H) {
        const running = isOn(getStr(data, f.statusId, slot));
        const flow = getVal(data, f.flowId, slot);
        if (running === true && (flow === null || flow <= 0)) {
          marks.push(mark(f.flowId, slot, 'orange')); marks.push(mark(f.statusId, slot, 'orange'));
          msgs.push(`${slot} Filter ${f.name}: ON แต่ Flow=0`); found = true;
        }
        if (running === false && flow !== null && flow > 0) {
          marks.push(mark(f.flowId, slot, 'orange')); found = true;
        }
      }
    }
    return mkStep(2, 'Per-Filter Flow vs Status', found ? 'WARNING' : 'PASSED', msgs, marks);
  }

  function step3() {
    const marks = []; const msgs = []; let found = false;
    for (const f of FWS2_FILTERS) {
      for (const slot of SLOTS_1H) {
        const running = isOn(getStr(data, f.statusId, slot));
        const turb = getVal(data, f.turbId, slot);
        if (running === true && turb === null) { marks.push(mark(f.turbId, slot, 'orange')); found = true; }
        if (running === true && turb !== null && turb > 1.0) {
          marks.push(mark(f.turbId, slot, 'red'));
          msgs.push(`${slot} Filter ${f.name}: Turbidity=${turb.toFixed(2)} > 1.0`); found = true;
        }
      }
    }
    return mkStep(3, 'Filter Turbidity Check', found ? 'WARNING' : 'PASSED',
      found ? ['Turbidity ผิดปกติ', ...msgs] : [], marks);
  }

  function step4() {
    const marks = []; let found = false;
    for (const f of FWS2_FILTERS) {
      const daily = getVal(data, f.totId, '00:00');
      if (daily === null || daily <= 0) { marks.push(mark(f.totId, '00:00', 'orange')); found = true; }
    }
    return mkStep(4, 'Filter Daily Totalizer Check', found ? 'WARNING' : 'PASSED',
      found ? ['Totalizer รายวัน ไม่มีค่าบาง Filter'] : [], marks);
  }

  const steps = [step1(), step2(), step3(), step4()];
  return { station: 'FWS2', steps, cellMarks: dedup(steps.flatMap(s => s.cellMarks)), summary: { errors: steps.filter(s => s.status === 'FAILED').length, warnings: steps.filter(s => s.status === 'WARNING').length } };
}

module.exports = { validateFWS1, validateFWS2 };
