// ส่วนที่ "ขึ้นกับเกณฑ์" ของไฟล์พิมพ์ DailyLab — คำนวณที่นี่ทั้งหมด แล้ว excel_writer.py แค่เขียนตามที่ได้
// (แทน conditional formatting ใน template; ไม่ผูกกับวิธีเขียนไฟล์ → วันหน้าใช้กับไฟล์ปลายทางได้ด้วย)
//   cells: Control Value ณ สิ้นวัน (ไม่มีเกณฑ์ = '-') · ตัวเลขนับครั้งที่เกิน · หมายเหตุการเปลี่ยนเกณฑ์ B77–B79
//   fonts: สีตัวอักษรของค่าที่เกินเกณฑ์ ตามเกณฑ์ ณ เวลาของตัวอย่าง (first = น้ำเงิน, repeat = แดง)
const fs = require('fs');
const path = require('path');
const { breachMarks } = require('./scenario');
const hist = require('./scenarioHistory');

const CONFIG = path.join(__dirname, '..', 'config');
const readCfg = (f, key) => { try { return JSON.parse(fs.readFileSync(path.join(CONFIG, f), 'utf8'))[key] || {}; } catch { return {}; } };

const REMARK_CELLS = ['B77', 'B78', 'B79'];
const LOOKBACK_DAYS = 7;   // นับการเกินต่อเนื่องข้ามวัน (เท่ากับ streaksBefore)

function remarkLines(date) {
  const lines = hist.periodsOnDate(date).map(p => {
    const t = String(p.started_at).slice(11, 16);
    const what = {
      scenario: `เปลี่ยนสถานการณ์ ${p.prev_name ?? '—'}→${p.name}`,
      init: `เริ่มใช้เกณฑ์ ${p.name}`,
      thresholds: `แก้เกณฑ์ ${p.name} (rev ${p.rev})`,
      epidemic: `${p.epidemic ? 'เปิด' : 'ปิด'}โหมดโรคระบาด`,
      epidemic_thresholds: 'แก้เกณฑ์โหมดโรคระบาด',
    }[p.reason] ?? p.reason;
    return `*${t} ${what}${p.note ? `: ${p.note}` : ''}`;
  });
  if (lines.length > REMARK_CELLS.length) {
    const extra = lines.length - REMARK_CELLS.length;
    lines.length = REMARK_CELLS.length;
    lines[lines.length - 1] += ` (+อีก ${extra} รายการ)`;
  }
  return lines;
}

// dates: ['YYYY-MM-DD'] · records: ค่าในช่วง dates (ตัวล่าสุดต่อ param/วัน/รอบ) · lookback: ค่าก่อนวันแรก (นับต่อเนื่อง)
// คืน { cells: { date: { addr: value } }, fonts: { date: { addr: level } } }
function dailyLabMarkup(dates, records, lookback = []) {
  const cellMap = JSON.parse(fs.readFileSync(path.join(CONFIG, 'excel_cell_map.json'), 'utf8'));
  const controlCells = readCfg('excel_control_cells.json', 'cells');
  const countCells = readCfg('excel_breach_counts.json', 'cells');
  const resolve = hist.makeResolver();
  const marks = breachMarks([...lookback, ...records], resolve);
  const dateSet = new Set(dates);

  const cells = {}, fonts = {};
  for (const d of dates) { cells[d] = {}; fonts[d] = {}; }

  const breachCount = {};   // date → param → n
  for (const [k, level] of marks) {
    const [param, date, slot] = k.split('|');
    if (!dateSet.has(date)) continue;
    const addr = cellMap[param]?.[slot];
    if (addr) fonts[date][addr] = level;
    const c = (breachCount[date] ||= {});
    c[param] = (c[param] || 0) + 1;
  }

  for (const d of dates) {
    const byKey = resolve(d, 'daily');   // Control Value = เกณฑ์ ณ สิ้นวัน
    for (const [addr, { param_key, field }] of Object.entries(controlCells)) {
      const v = byKey[param_key]?.[field];
      cells[d][addr] = v === null || v === undefined ? '-' : v;
    }
    for (const [addr, params] of Object.entries(countCells)) {
      cells[d][addr] = params.reduce((n, p) => n + (breachCount[d]?.[p] || 0), 0);
    }
    remarkLines(d).forEach((line, i) => { cells[d][REMARK_CELLS[i]] = line; });
  }
  return { cells, fonts };
}

module.exports = { dailyLabMarkup, remarkLines, LOOKBACK_DAYS };
