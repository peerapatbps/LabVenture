'use strict';

// ── RWS1 ConfigID groups (from DailyReportValidator.vb) ──────────────────────
const RWS1 = {
  statusIds: new Set([10, 15, 20, 25, 29]),
  totA: 4, totB: 7, netA: 8384, netB: 8385,
  hourlyRequired: [3, 4, 6, 7, 9],
  zeroNotAllowed: new Set([9]),
  pump2H: new Set([
    12,17,22,27,31, 13,18,23,
    6371,6372,6373,6374,6375,6377,
    6380,6381,6382,6383,6384,6386,
    6389,6390,6391,6392,6393,6395,
    6398,6399,6400,6401,6402,6404,
    6407,6408,6409,6410,6411,6413,
  ]),
  feederActive:   [33, 35],
  feederReactive: [34, 36],
  dailyTotalizer: new Set([14, 19, 24, 28, 32]),
  dailyRuntime:   new Set([6369, 6378, 6387, 6396, 6405]),
  pumps: [
    { name:'1P01A', power:12, speed:13,   tempIds:[6371,6372,6373,6374,6375,6377], statusId:10, totId:14, rtId:6369 },
    { name:'1P01B', power:17, speed:18,   tempIds:[6380,6381,6382,6383,6384,6386], statusId:15, totId:19, rtId:6378 },
    { name:'1P01C', power:22, speed:23,   tempIds:[6389,6390,6391,6392,6393,6395], statusId:20, totId:24, rtId:6387 },
    { name:'1P02A', power:27, speed:null, tempIds:[6398,6399,6400,6401,6402,6404], statusId:25, totId:28, rtId:6396 },
    { name:'1P02B', power:31, speed:null, tempIds:[6407,6408,6409,6410,6411,6413], statusId:29, totId:32, rtId:6405 },
  ],
};

// All RWS1 configIDs that appear in setpoint + pump columns at 2H slots
const SETPOINT_2H = [1, 2, 8384, 8385];

const SLOTS_2H = Array.from({ length: 13 }, (_, i) => String(i * 2).padStart(2, '0') + ':00');
const SLOTS_1H = Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00');

// ── Helpers ───────────────────────────────────────────────────────────────────

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function getVal(data, cfgId, slot) {
  return num(data?.[String(cfgId)]?.[slot]);
}

function getStatusStr(data, cfgId, slot) {
  const v = data?.[String(cfgId)]?.[slot];
  return (v === null || v === undefined || v === '') ? null : String(v).trim();
}

function isRunning(statusStr) {
  if (statusStr === null) return null;
  const s = statusStr.toUpperCase();
  if (s === 'ON' || s === '1' || s === 'TRUE') return true;
  if (s === 'STANDBY' || s === '0' || s === 'FALSE' || s === 'OFF') return false;
  return null;
}

function mkStep(index, label, status, messages, cellMarks) {
  return { index, label, status, messages: messages || [], cellMarks: cellMarks || [] };
}

function mark(cfgId, slot, color) {
  return { configparam_id: cfgId, slot, color };
}

// ── Step 1 — Blank/Null check ─────────────────────────────────────────────────
function step1_BlankCheck(data) {
  const marks = [];
  let hasIssue = false;

  // Every 1H: hourlyRequired columns
  for (const slot of SLOTS_1H) {
    for (const cfgId of RWS1.hourlyRequired) {
      const v = getVal(data, cfgId, slot);
      if (v === null) {
        marks.push(mark(cfgId, slot, 'red'));
        hasIssue = true;
      } else if (RWS1.zeroNotAllowed.has(cfgId) && v === 0) {
        marks.push(mark(cfgId, slot, 'orange'));
        hasIssue = true;
      }
    }
  }

  // Every 2H: setpoint + pump columns
  const set2H = [...SETPOINT_2H, ...RWS1.pump2H];
  for (const slot of SLOTS_2H) {
    for (const cfgId of set2H) {
      if (RWS1.hourlyRequired.includes(cfgId)) continue; // already checked above
      const v = getVal(data, cfgId, slot);
      if (v === null) {
        marks.push(mark(cfgId, slot, 'red'));
        hasIssue = true;
      }
    }
  }

  // Daily totals: only at 00:00 (value must be > 0); at other slots must be blank
  const dailyIds = [...RWS1.dailyTotalizer, ...RWS1.dailyRuntime];
  for (const cfgId of dailyIds) {
    const v00 = getVal(data, cfgId, '00:00');
    if (v00 === null || v00 <= 0) {
      marks.push(mark(cfgId, '00:00', v00 === null ? 'red' : 'orange'));
      hasIssue = true;
    }
    // Should be blank at all other 2H slots
    for (const slot of SLOTS_2H.filter(s => s !== '00:00')) {
      const v = getVal(data, cfgId, slot);
      if (v !== null && v > 0) {
        marks.push(mark(cfgId, slot, 'red'));
        hasIssue = true;
      }
    }
  }

  return mkStep(1, 'Blank/Null Check', hasIssue ? 'WARNING' : 'PASSED',
    hasIssue ? ['พบข้อมูลว่าง/ไม่ถูกต้องในช่วงเวลาที่กำหนด'] : [], marks);
}

// ── Step 2 — Negative values ──────────────────────────────────────────────────
function step2_NegativeCheck(data) {
  const marks = [];
  let found = false;

  const checkIds = [
    ...SETPOINT_2H, ...RWS1.hourlyRequired,
    ...RWS1.feederActive, ...RWS1.feederReactive,
    ...RWS1.pump2H, ...RWS1.dailyTotalizer, ...RWS1.dailyRuntime,
  ];

  for (const slot of SLOTS_1H) {
    for (const cfgId of checkIds) {
      if (RWS1.statusIds.has(cfgId)) continue;
      const v = getVal(data, cfgId, slot);
      if (v !== null && v < 0) {
        marks.push(mark(cfgId, slot, 'orange'));
        found = true;
      }
    }
  }

  return mkStep(2, 'Negative Values', found ? 'WARNING' : 'PASSED',
    found ? ['พบค่าติดลบในข้อมูลตัวเลข'] : [], marks);
}

// ── Step 3 — Totalizer vs Net (tolerance 1.0) ─────────────────────────────────
function step3_TotalizerNet(data) {
  const marks = [];
  const msgs = [];
  let failed = false;

  for (let i = 1; i < SLOTS_2H.length; i++) {
    const slotNow  = SLOTS_2H[i];
    const slotPrev = SLOTS_2H[i - 1];

    const check = (totId, netId, label) => {
      const totNow  = getVal(data, totId, slotNow);
      const totPrev = getVal(data, totId, slotPrev);
      const netNow  = getVal(data, netId, slotNow);
      if (totNow === null || totPrev === null || netNow === null) return;
      const computed = (totNow - totPrev) * 100;
      const diff = Math.abs(computed - netNow);
      if (diff > 1.0) {
        marks.push(mark(totId, slotNow, 'red'));
        marks.push(mark(netId, slotNow, 'red'));
        msgs.push(`${slotNow} ${label}: diff=${diff.toFixed(2)} เกิน 1.0`);
        failed = true;
      }
    };

    check(RWS1.totA, RWS1.netA, 'TotA/NetA');
    check(RWS1.totB, RWS1.netB, 'TotB/NetB');
  }

  return mkStep(3, 'Totalizer vs Net', failed ? 'FAILED' : 'PASSED',
    failed ? ['Totalizer/Net ไม่สอดคล้องกัน', ...msgs] : [], marks);
}

// ── Step 4 — Daily totals at midnight (summary of step 1) ────────────────────
function step4_DailyAtMidnight(data) {
  const marks = [];
  const msgs = [];
  let found = false;

  for (const cfgId of [...RWS1.dailyTotalizer, ...RWS1.dailyRuntime]) {
    const v = getVal(data, cfgId, '00:00');
    if (v === null) {
      marks.push(mark(cfgId, '00:00', 'red'));
      msgs.push(`cfg${cfgId}: ไม่มีค่าที่ 00:00`);
      found = true;
    } else if (v <= 0) {
      marks.push(mark(cfgId, '00:00', 'orange'));
      msgs.push(`cfg${cfgId}: ค่าที่ 00:00 ≤ 0`);
      found = true;
    }
  }

  return mkStep(4, 'Daily Totals at Midnight', found ? 'WARNING' : 'PASSED', msgs, marks);
}

// ── Step 5 — Setpoint vs Actual (tolerance 15%) ───────────────────────────────
function step5_SetpointActual(data) {
  const marks = [];
  const msgs = [];
  let found = false;
  const TOL = 0.15;
  const pairs = [[1, 3], [2, 6]]; // [setpointId, actualId]

  for (const slot of SLOTS_2H) {
    for (const [spId, actualId] of pairs) {
      const sp     = getVal(data, spId, slot);
      const actual = getVal(data, actualId, slot);
      if (sp === null || actual === null) continue;
      const denom = Math.max(Math.abs(sp), Math.abs(actual));
      if (denom > 0 && Math.abs(sp - actual) / denom > TOL) {
        marks.push(mark(spId, slot, 'orange'));
        marks.push(mark(actualId, slot, 'orange'));
        msgs.push(`${slot} cfg${spId}/cfg${actualId}: เบี่ยงเบน ${((Math.abs(sp - actual) / denom) * 100).toFixed(1)}%`);
        found = true;
      }
    }
  }

  return mkStep(5, 'Setpoint vs Actual (15%)', found ? 'WARNING' : 'PASSED',
    found ? ['ตรวจพบความแตกต่างระหว่าง Setpoint และ Actual เกิน 15%', ...msgs] : [], marks);
}

// ── Step 6 — Energy Feeder ────────────────────────────────────────────────────
function step6_EnergyFeeder(data) {
  const marks = [];
  const msgs = [];
  let found = false;

  for (const slot of SLOTS_2H) {
    for (const cfgId of [...RWS1.feederActive, ...RWS1.feederReactive]) {
      const v = getVal(data, cfgId, slot);
      if (v === null) {
        marks.push(mark(cfgId, slot, 'orange'));
        if (!msgs.some(m => m.includes(`cfg${cfgId}`))) {
          msgs.push(`cfg${cfgId} (Feeder): ไม่มีข้อมูลบางช่วง`);
        }
        found = true;
      }
    }
  }

  return mkStep(6, 'Energy Feeder', found ? 'WARNING' : 'PASSED', msgs, marks);
}

// ── Step 7 — Pump Groups ──────────────────────────────────────────────────────
function step7_PumpGroups(data) {
  const marks = [];
  const msgs = [];
  let found = false;

  for (const pump of RWS1.pumps) {
    const prevTemp = {}; // tempId → last value

    for (const slot of SLOTS_2H) {
      const statusStr = getStatusStr(data, pump.statusId, slot);
      const running   = isRunning(statusStr);
      const power     = getVal(data, pump.power, slot);

      if (running === null) continue;

      if (running) {
        if (power === null || power === 0) {
          marks.push(mark(pump.power, slot, 'orange'));
          marks.push(mark(pump.statusId, slot, 'orange'));
          msgs.push(`${slot} ${pump.name}: ทำงานแต่ Power=0`);
          found = true;
        }
        if (pump.speed !== null) {
          const speed = getVal(data, pump.speed, slot);
          if (speed === null || speed === 0) {
            marks.push(mark(pump.speed, slot, 'orange'));
            found = true;
          }
        }
        for (const tempId of pump.tempIds) {
          const temp = getVal(data, tempId, slot);
          if (temp === null) {
            marks.push(mark(tempId, slot, 'orange'));
            msgs.push(`${slot} ${pump.name} cfg${tempId}: อุณหภูมิว่าง`);
            found = true;
          } else {
            const prev = prevTemp[tempId];
            if (prev !== undefined && Math.abs(temp - prev) > 20) {
              marks.push(mark(tempId, slot, 'orange'));
              msgs.push(`${slot} ${pump.name} cfg${tempId}: อุณหภูมิกระโดด ${Math.abs(temp - prev).toFixed(1)}°C`);
              found = true;
            }
            prevTemp[tempId] = temp;
          }
        }
      } else {
        if (power !== null && power > 0) {
          marks.push(mark(pump.power, slot, 'orange'));
          marks.push(mark(pump.statusId, slot, 'orange'));
          msgs.push(`${slot} ${pump.name}: หยุดแต่มีค่า Power`);
          found = true;
        }
      }
    }
  }

  return mkStep(7, 'Pump Groups', found ? 'WARNING' : 'PASSED',
    found ? ['ตรวจพบพฤติกรรมผิดปกติในกลุ่มปั๊ม', ...msgs] : [], marks);
}

// ── Step 8 — Daily Energy vs Σ kW (tolerance 10%) ────────────────────────────
function step8_DailyEnergy(data) {
  const msgs = [];
  let found = false;
  const TOL = 0.10;

  for (const pump of RWS1.pumps) {
    const dailyMWhr = getVal(data, pump.totId, '00:00');
    if (dailyMWhr === null) continue;

    let sumKwh = 0;
    let countValid = 0;
    for (let i = 0; i < SLOTS_2H.length - 1; i++) {
      const kw = getVal(data, pump.power, SLOTS_2H[i]);
      if (kw !== null) { sumKwh += kw * 2; countValid++; }
    }
    if (countValid === 0) continue;

    const expectedMWhr = sumKwh / 1000;
    if (expectedMWhr > 0) {
      const pct = Math.abs(dailyMWhr - expectedMWhr) / expectedMWhr;
      if (pct > TOL) {
        msgs.push(`${pump.name}: Daily=${dailyMWhr.toFixed(3)} MWhr vs Σ kW=${expectedMWhr.toFixed(3)} MWhr (${(pct * 100).toFixed(1)}%)`);
        found = true;
      }
    }
  }

  return mkStep(8, 'Daily Energy vs Σ kW (10%)', found ? 'WARNING' : 'PASSED',
    found ? ['Daily MWhr ไม่สอดคล้องกับผลรวม kW', ...msgs] : [], []);
}

// ── Step 9 — Pump Runtime IHM (tolerance ±4h) ─────────────────────────────────
function step9_PumpRuntime(data) {
  const msgs = [];
  let failed = false;
  const TOL = 4;

  for (const pump of RWS1.pumps) {
    const dailyRt = getVal(data, pump.rtId, '00:00');
    if (dailyRt === null) continue;

    let runHours = 0;
    for (const slot of SLOTS_2H.slice(0, -1)) {
      const statusStr = getStatusStr(data, pump.statusId, slot);
      if (isRunning(statusStr) === true) runHours += 2;
    }

    const diff = Math.abs(dailyRt - runHours);
    if (diff > TOL) {
      msgs.push(`${pump.name}: IHM=${dailyRt.toFixed(1)}h vs สถานะ=${runHours}h (ต่าง ${diff.toFixed(1)}h)`);
      if (diff > TOL * 2) failed = true;
    }
  }

  const hasIssue = msgs.length > 0;
  return mkStep(9, 'Pump Runtime IHM (±4h)', hasIssue ? (failed ? 'FAILED' : 'WARNING') : 'PASSED',
    hasIssue ? ['Pump runtime ไม่สอดคล้องกับสถานะ', ...msgs] : [], []);
}

// ── Main export ───────────────────────────────────────────────────────────────
function validateRWS1(data) {
  const steps = [
    step1_BlankCheck(data),
    step2_NegativeCheck(data),
    step3_TotalizerNet(data),
    step4_DailyAtMidnight(data),
    step5_SetpointActual(data),
    step6_EnergyFeeder(data),
    step7_PumpGroups(data),
    step8_DailyEnergy(data),
    step9_PumpRuntime(data),
  ];

  const allMarks = steps.flatMap(s => s.cellMarks);

  // Deduplicate marks: red wins over orange for same cell
  const markMap = new Map();
  for (const m of allMarks) {
    const key = `${m.configparam_id}:${m.slot}`;
    const existing = markMap.get(key);
    if (!existing || (m.color === 'red' && existing.color === 'orange')) {
      markMap.set(key, m);
    }
  }

  return {
    station: 'RWS1',
    steps,
    cellMarks: [...markMap.values()],
    summary: {
      errors:   steps.filter(s => s.status === 'FAILED').length,
      warnings: steps.filter(s => s.status === 'WARNING').length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RWS2
// ═══════════════════════════════════════════════════════════════════════════════

const RWS2 = {
  statusIds:      new Set([46, 52, 58, 63, 69]),
  totC: 42, totD: 44, netC: 8386, netD: 8387,
  // cfg42, cfg44, cfg45 must be non-zero every hour
  nonZeroHourly:  new Set([42, 44, 45]),
  hourlyRequired: [42, 44, 45],
  setpoint2H:     [39, 40, 8386, 8387],
  feederActive:   [75, 77],
  feederReactive: [76, 78],
  dailyTotalizer: new Set([51, 57, 62, 68, 74]),   // MWhr per pump
  dailyRuntime:   new Set([6414, 6422, 6430, 6438, 6446]),
  pumps: [
    { name:'2P01A', statusId:46, power:49, speed:50,   tempIds:[6416,6417,6418,6419,6420,6421], totId:51, rtId:6414 },
    { name:'2P01B', statusId:52, power:55, speed:56,   tempIds:[6424,6425,6426,6427,6428,6429], totId:57, rtId:6422 },
    { name:'2P01C', statusId:58, power:61, speed:null, tempIds:[6432,6433,6434,6435,6436,6437], totId:62, rtId:6430 },
    { name:'2P02A', statusId:63, power:66, speed:67,   tempIds:[6440,6441,6442,6443,6444,6445], totId:68, rtId:6438 },
    { name:'2P02B', statusId:69, power:72, speed:73,   tempIds:[6448,6449,6450,6451,6452,6453], totId:74, rtId:6446 },
  ],
};

function validateRWS2(data) {
  // Reuse RWS1 helper pattern — steps are structurally identical, only IDs differ

  function step1() {
    const marks = []; let hasIssue = false;
    for (const slot of SLOTS_1H) {
      for (const cfgId of RWS2.hourlyRequired) {
        const v = getVal(data, cfgId, slot);
        if (v === null) { marks.push(mark(cfgId, slot, 'red')); hasIssue = true; }
        else if (RWS2.nonZeroHourly.has(cfgId) && v === 0) { marks.push(mark(cfgId, slot, 'orange')); hasIssue = true; }
      }
    }
    for (const cfgId of [...RWS2.dailyTotalizer, ...RWS2.dailyRuntime]) {
      const v = getVal(data, cfgId, '00:00');
      if (v === null || v <= 0) { marks.push(mark(cfgId, '00:00', v === null ? 'red' : 'orange')); hasIssue = true; }
    }
    return mkStep(1, 'Blank/Null Check', hasIssue ? 'WARNING' : 'PASSED',
      hasIssue ? ['พบข้อมูลว่าง/ไม่ถูกต้องในช่วงเวลาที่กำหนด'] : [], marks);
  }

  function step2() {
    const marks = []; let found = false;
    const checkIds = [...RWS2.hourlyRequired, ...RWS2.feederActive, ...RWS2.feederReactive,
      ...RWS2.dailyTotalizer, ...RWS2.dailyRuntime];
    for (const slot of SLOTS_1H) for (const cfgId of checkIds) {
      if (RWS2.statusIds.has(cfgId)) continue;
      const v = getVal(data, cfgId, slot);
      if (v !== null && v < 0) { marks.push(mark(cfgId, slot, 'orange')); found = true; }
    }
    return mkStep(2, 'Negative Values', found ? 'WARNING' : 'PASSED',
      found ? ['พบค่าติดลบในข้อมูลตัวเลข'] : [], marks);
  }

  function step3() {
    const marks = []; const msgs = []; let failed = false;
    for (let i = 1; i < SLOTS_1H.length; i++) {
      const slotNow = SLOTS_1H[i], slotPrev = SLOTS_1H[i - 1];
      const check = (totId, netId, label) => {
        const tN = getVal(data, totId, slotNow), tP = getVal(data, totId, slotPrev), nN = getVal(data, netId, slotNow);
        if (tN === null || tP === null || nN === null) return;
        const diff = Math.abs((tN - tP) * 100 - nN);
        if (diff > 1.0) {
          marks.push(mark(totId, slotNow, 'red')); marks.push(mark(netId, slotNow, 'red'));
          msgs.push(`${slotNow} ${label}: diff=${diff.toFixed(2)}`); failed = true;
        }
      };
      check(RWS2.totC, RWS2.netC, 'TotC/NetC');
      check(RWS2.totD, RWS2.netD, 'TotD/NetD');
    }
    return mkStep(3, 'Totalizer vs Net', failed ? 'FAILED' : 'PASSED',
      failed ? ['Totalizer/Net ไม่สอดคล้องกัน', ...msgs] : [], marks);
  }

  function step5() {
    // RWS2: setpoint in m³/hr, actual in m³/s → SP ≈ actual × 3600
    const marks = []; const msgs = []; let found = false;
    const pairs = [[39, 41], [40, 43]];
    for (const slot of SLOTS_1H) for (const [spId, actualId] of pairs) {
      const sp = getVal(data, spId, slot), actual = getVal(data, actualId, slot);
      if (sp === null || actual === null) continue;
      const actualHr = actual * 3600;
      const denom = Math.max(Math.abs(sp), Math.abs(actualHr));
      if (denom > 0 && Math.abs(sp - actualHr) / denom > 0.15) {
        marks.push(mark(spId, slot, 'orange')); marks.push(mark(actualId, slot, 'orange'));
        msgs.push(`${slot} cfg${spId}/cfg${actualId}: เบี่ยงเบน ${((Math.abs(sp-actualHr)/denom)*100).toFixed(1)}%`);
        found = true;
      }
    }
    return mkStep(5, 'Setpoint vs Actual (15%)', found ? 'WARNING' : 'PASSED',
      found ? ['ตรวจพบความแตกต่าง Setpoint vs Actual เกิน 15%', ...msgs] : [], marks);
  }

  function step6() {
    const marks = []; const msgs = []; let found = false;
    for (const slot of SLOTS_1H) for (const cfgId of [...RWS2.feederActive, ...RWS2.feederReactive]) {
      if (getVal(data, cfgId, slot) === null) { marks.push(mark(cfgId, slot, 'orange')); found = true; }
    }
    if (found) msgs.push('ข้อมูล Feeder บางช่วงเวลาหายไป');
    return mkStep(6, 'Energy Feeder', found ? 'WARNING' : 'PASSED', msgs, marks);
  }

  function step7() {
    const marks = []; const msgs = []; let found = false;
    for (const pump of RWS2.pumps) {
      const prevTemp = {};
      for (const slot of SLOTS_2H) {
        const running = isRunning(getStatusStr(data, pump.statusId, slot));
        const power = getVal(data, pump.power, slot);
        if (running === null) continue;
        if (running) {
          if (power === null || power === 0) { marks.push(mark(pump.power, slot, 'orange')); marks.push(mark(pump.statusId, slot, 'orange')); msgs.push(`${slot} ${pump.name}: ทำงานแต่ Power=0`); found = true; }
          if (pump.speed !== null) { const s = getVal(data, pump.speed, slot); if (s === null || s === 0) { marks.push(mark(pump.speed, slot, 'orange')); found = true; } }
          for (const tId of pump.tempIds) {
            const t = getVal(data, tId, slot);
            if (t === null) { marks.push(mark(tId, slot, 'orange')); found = true; }
            else { if (prevTemp[tId] !== undefined && Math.abs(t - prevTemp[tId]) > 20) { marks.push(mark(tId, slot, 'orange')); msgs.push(`${slot} ${pump.name} cfg${tId}: อุณหภูมิกระโดด`); found = true; } prevTemp[tId] = t; }
          }
        } else { if (power !== null && power > 0) { marks.push(mark(pump.power, slot, 'orange')); marks.push(mark(pump.statusId, slot, 'orange')); msgs.push(`${slot} ${pump.name}: หยุดแต่มีค่า Power`); found = true; } }
      }
    }
    return mkStep(7, 'Pump Groups', found ? 'WARNING' : 'PASSED',
      found ? ['ตรวจพบพฤติกรรมผิดปกติในกลุ่มปั๊ม', ...msgs] : [], marks);
  }

  function step8() {
    const msgs = []; let found = false;
    for (const pump of RWS2.pumps) {
      const daily = getVal(data, pump.totId, '00:00'); if (daily === null) continue;
      let sum = 0, cnt = 0;
      for (let i = 0; i < SLOTS_2H.length - 1; i++) { const kw = getVal(data, pump.power, SLOTS_2H[i]); if (kw !== null) { sum += kw * 2; cnt++; } }
      if (cnt === 0) continue;
      const exp = sum / 1000;
      if (exp > 0 && Math.abs(daily - exp) / exp > 0.10) { msgs.push(`${pump.name}: Daily=${daily.toFixed(3)} vs Σ kW=${exp.toFixed(3)} MWhr`); found = true; }
    }
    return mkStep(8, 'Daily Energy vs Σ kW (10%)', found ? 'WARNING' : 'PASSED',
      found ? ['Daily MWhr ไม่สอดคล้องกับผลรวม kW', ...msgs] : [], []);
  }

  function step9() {
    const msgs = []; let failed = false;
    for (const pump of RWS2.pumps) {
      const rt = getVal(data, pump.rtId, '00:00'); if (rt === null) continue;
      let hrs = 0;
      for (const slot of SLOTS_2H.slice(0, -1)) { if (isRunning(getStatusStr(data, pump.statusId, slot)) === true) hrs += 2; }
      const diff = Math.abs(rt - hrs);
      if (diff > 4) { msgs.push(`${pump.name}: IHM=${rt.toFixed(1)}h vs สถานะ=${hrs}h`); if (diff > 8) failed = true; }
    }
    return mkStep(9, 'Pump Runtime IHM (±4h)', msgs.length ? (failed ? 'FAILED' : 'WARNING') : 'PASSED',
      msgs.length ? ['Pump runtime ไม่สอดคล้องกับสถานะ', ...msgs] : [], []);
  }

  const steps = [step1(), step2(), step3(),
    mkStep(4, 'Daily Totals at Midnight', 'PASSED', ['ตรวจสอบใน Step 1 แล้ว'], []),
    step5(), step6(), step7(), step8(), step9()];
  const allMarks = steps.flatMap(s => s.cellMarks);
  const markMap = new Map();
  for (const m of allMarks) { const k = `${m.configparam_id}:${m.slot}`; const e = markMap.get(k); if (!e || (m.color === 'red' && e.color === 'orange')) markMap.set(k, m); }
  return { station: 'RWS2', steps, cellMarks: [...markMap.values()], summary: { errors: steps.filter(s => s.status === 'FAILED').length, warnings: steps.filter(s => s.status === 'WARNING').length } };
}

module.exports = { validateRWS1, validateRWS2 };
