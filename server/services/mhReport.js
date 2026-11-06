// รายงานการผลิตน้ำประจำวัน (F-MS-HACCP-กผจ-15) — fills templates/MH_report_theme.xlsx.
// Example of a filled form: templates/MH_report_example.xlsx.
//
// The sheet XML is edited directly (jszip) so the template keeps every style,
// merge and print setting. The template's broken formulas (#REF!, external
// link [1]Data!) are replaced by values, and the external link is removed.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const THEME = path.join(__dirname, '..', 'templates', 'MH_report_theme.xlsx');
const SHEET = 'xl/worksheets/sheet1.xml';
const NO_DIRS = { createFolders: false }; // don't add folder entries to the zip

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const thaiDate = d => `${+d.slice(8, 10)} ${THAI_MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(0, 4) + 543}`;

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sum = (...vs) => (vs.every(v => num(v) !== null) ? vs.reduce((a, b) => a + b, 0) : null);
const mul = (v, k) => (num(v) !== null ? v * k : null);
function avg(vs) {
  const ok = vs.filter(v => num(v) !== null);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

// ── Backwash (same rules as parseBWPhase in client OpRecord.jsx) ──────────────
// Per phase: total wash water (m³), number of wash events, and average filter run (ชม.) over the events.
const P3_LEVEL_IDS = [7944, 7951, 7945, 7952, 7946, 7953, 7947, 7954, 7948, 7955, 7949, 7956, 7950, 7957];
const P4_LEVEL_IDS = [7958, 7965, 7959, 7966, 7960, 7967, 7961, 7968, 7962, 7969, 7963, 7970, 7964, 7971];
const BW_PHASES = [
  { station: 'FWS1', base: 317, beds: 8 },
  { station: 'FWS1', base: 399, beds: 8 },
  { station: 'FWS2', base: 479, beds: 14, levelIds: P3_LEVEL_IDS },
  { station: 'FWS2', base: 621, beds: 14, levelIds: P4_LEVEL_IDS },
];
const BW_SLOTS = ['08:00', '16:00', '24:00'];

function backwashByPhase(historyMap) {
  return BW_PHASES.map(({ station, base, beds, levelIds }) => {
    const h = historyMap?.[station];
    if (!h) return { wash: null, count: null, run: null, runs: [] };
    let wash = 0, count = 0;
    const runs = [];
    for (let i = 0; i < beds; i++) {
      const b = base + i * 10;
      const ids = [b, b + 1, levelIds ? levelIds[i] : b + 2, b + 3, b + 5, b + 6];
      for (const slot of BW_SLOTS) {
        const vals = ids.map(id => parseFloat(h[String(id)]?.[slot]));
        if (!vals.some(v => !isNaN(v) && v !== 0)) continue; // no wash in this slot
        count++;
        if (!isNaN(vals[5]) && vals[5] !== 0) wash += vals[5];
        if (!isNaN(vals[1]) && vals[1] !== 0) runs.push(vals[1]);
      }
    }
    return { wash, count, run: avg(runs), runs };
  });
}

// ── Report → cells ────────────────────────────────────────────────────────────
// Returns { addr: number|null } for every value cell of the form (names/date are added on export).
function buildMhCells(r, historyMap) {
  const c = {};
  const rw = r.card1_raw_water || {}, lv = r.card2_water_level || {}, pu = r.card3_pumped || {};
  const pr = r.card4_pressure || {}, cd = r.card14_chem_dosing || {}, rem = r.card13_chem_remaining || {};
  const sl = r.card11_sludge || {}, en = r.card12_energy || {}, sm = r.summary || {};

  // 1. สถานีสูบน้ำดิบ
  Object.assign(c, { I10: rw.phase1, I11: rw.phase2, I12: rw.phase3, I13: rw.phase4 });
  Object.assign(c, { U12: lv.rw_max, X12: lv.rw_min, AC10: lv.cwt_max, AF10: lv.cwt_min, AC13: lv.cwt_at24 });

  // 2. สถานีสูบจ่ายและสูบส่ง
  Object.assign(c, { I18: pu.dps_lineA, I19: pu.dps_lineB, M21: pu.tps });
  Object.assign(c, { U19: pr.dps_max, X19: pr.dps_min, U21: pr.tps_max, X21: pr.tps_min });
  c.AC17 = sm.service_water_m3;
  c.AC21 = mul(sm.water_loss_pct, 0.01); // cell format is 0.00%

  // 3. การใช้สารเคมี — use (ตัน) D/F/H/J · dose (mg/L) O/Q/S/U · stock W (เฟส 1,2) Z (เฟส 3,4) · received AF
  const USE = ['D', 'F', 'H', 'J'], DOSE = ['O', 'Q', 'S', 'U'];
  const chemRow = (row, useKeys, doseKeys, k = 1) => {
    useKeys.forEach((key, i) => { c[USE[i] + row] = mul(cd[key], k); });
    doseKeys.forEach((key, i) => { c[DOSE[i] + row] = cd[key]; });
  };
  const ph = p => [1, 2, 3, 4].map(n => `${p}${n}`);
  chemRow(27, ph('alum_use_p'), ph('alum_actual_p'));
  chemRow(29, ph('cl_use_pre_p'), ph('cl_actual_pre_p'), 0.001);   // kg → ตัน
  chemRow(33, ph('cl_use_post_p'), ph('cl_actual_post_p'), 0.001);
  chemRow(35, ph('pacl_use_p'), ph('pacl_actual_p'));
  // Int. คลอรีน (row 31) is fixed 0 in the template; Polymer (row 37) has no data source → left blank.

  Object.assign(c, {
    W27: mul(rem.alum?.chem1_m3, 1.33), Z27: mul(rem.alum?.chem2_m3, 1.33),
    W29: rem.chlorine?.chem1_ton, Z29: rem.chlorine?.chem2_ton,
    W35: mul(rem.pacl?.chem1_m3, 1.19), Z35: mul(rem.pacl?.chem2_m3, 1.19),
    AF27: sum(r.card9_chem1_alum?.in, r.card10_chem2_alum?.in),
    AF29: r.cl_income,                                   // ท่อ (1 ท่อ = 1 ตัน)
    AF35: sum(r.card5_chem1_pacl?.in, r.card6_chem2_pacl?.in),
  });

  // 4. การตกตะกอนและการกรอง — phase columns I/L/O/R
  const PH = ['I', 'L', 'O', 'R'];
  const bw = backwashByPhase(historyMap);
  const fa = r.filter_availability || [];
  [sl.phase1, sl.phase2, sl.phase3, sl.phase4].forEach((v, i) => { c[PH[i] + 42] = v; });
  bw.forEach((b, i) => { c[PH[i] + 44] = b.wash; c[PH[i] + 46] = b.run; });
  PH.forEach((col, i) => { const f = fa[i]; c[col + 48] = f?.cap ? f.available / f.cap : null; });

  // 5. ต้นทุน (บาท/ลบ.ม.)
  Object.assign(c, { AF42: sm.chem_cost_per_m3, AF44: sm.energy_per_m3, AF46: sm.sludge_cost_per_m3, AF48: sm.op_cost_per_m3 });

  // 6. การใช้ไฟฟ้า (MWh) — same mapping as detail_table Energy_SS*
  Object.assign(c, { I53: en.dps, L53: en.tps, O53: en.rws1, R53: en.rws2, U53: en.fws1, X53: en.fws2, AA53: en.bldg, AD53: en.total });

  for (const k of Object.keys(c)) c[k] = num(c[k]);
  return c;
}

// summary_table / detail_table columns → cells. Used for days saved before the
// full cell snapshot existed, so the printout shows what was saved to the DB.
const DB_SUMMARY_CELLS = {
  CWT_Lvl24: 'AC13', CWT_minLvl: 'AF10', CWT_maxLvl: 'AC10', TPS: 'M21',
  Service_water_F: 'AC17', Plant_Energy_USEtotal: 'AD53',
};
const DB_DETAIL_CELLS = {
  RWS1_P1F: 'I10', RWS1_P2F: 'I11', RWS2_P3F: 'I12', RWS2_P4F: 'I13',
  RWS_maxLvl: 'U12', RWS_minLvl: 'X12', DPS_AF: 'I18', DPS_BF: 'I19',
  DPS_maxPresure: 'U19', DPS_minPresure: 'X19', TPS_maxPressure: 'U21', TPS_minPressure: 'X21',
  Sludge_drain_P1: 'I42', Sludge_drain_P2: 'L42', Sludge_drain_P3: 'O42', Sludge_drain_P4: 'R42',
  Energy_SS1A: 'I53', Energy_SS1B: 'L53', Energy_SS2A: 'O53', Energy_SS2B: 'R53',
  Energy_SS3A: 'U53', Energy_SS3B: 'X53', Energy_SS3: 'AA53',
  Cl_P12_stock: 'W29', Cl_P34_stock: 'Z29', Alum_P12_stock: 'W27', Alum_P34_stock: 'Z27',
  PACl_P12_stock: 'W35', PACl_P34_stock: 'Z35',
};
function overlayDbCells(cells, summaryRow, detailRow) {
  const put = (row, map) => {
    if (!row) return;
    for (const [col, addr] of Object.entries(map)) if (num(row[col]) !== null) cells[addr] = row[col];
  };
  put(summaryRow, DB_SUMMARY_CELLS);
  put(detailRow, DB_DETAIL_CELLS);
  const s = summaryRow || {};
  if (num(s.Water_loss) !== null) cells.AC21 = s.Water_loss / 100;
  if (num(s.Alum_income) !== null) cells.AF27 = s.Alum_income;
  if (num(s.Pacl_income) !== null) cells.AF35 = s.Pacl_income;
  // Units follow MH_report.db: Cl_income in ท่อ (ตัน), costs in baht/m³.
  // Saves before 31/10/2569 used kg and baht/day — recognised by their size.
  if (num(s.Cl_income) !== null) cells.AF29 = s.Cl_income > 200 ? s.Cl_income / 1000 : s.Cl_income;
  // (old saves also stored DPS+TPS in DPS_TotalF, so that is the divisor for their baht/day)
  const oldPump = num(s.DPS_TotalF);
  const perM3 = (v, addr) => {
    if (num(v) === null) return;
    if (v < 1000) cells[addr] = v;
    else if (oldPump) cells[addr] = v / oldPump;
  };
  perM3(s.Chem_cost, 'AF42'); perM3(s.Energy_cost, 'AF44'); perM3(s.Sludge_disposal_cost, 'AF46');
  if ([cells.AF42, cells.AF44, cells.AF46].every(v => num(v) !== null)) cells.AF48 = cells.AF42 + cells.AF44 + cells.AF46;
  return cells;
}

// Totals that the template computes with formulas — written as values.
function addTotals(c) {
  const r = { ...c };
  r.M10 = sum(c.I10, c.I11); r.M12 = sum(c.I12, c.I13); r.Q10 = sum(r.M10, r.M12);
  r.M18 = sum(c.I18, c.I19); r.Q18 = sum(r.M18, c.M21);
  r.L27 = sum(c.D27, c.F27, c.H27, c.J27);
  r.L29 = sum(c.D29, c.F29, c.H29, c.J29, c.D33, c.F33, c.H33, c.J33); // Pre + Int (0) + Post
  r.L35 = sum(c.D35, c.F35, c.H35, c.J35);
  r.AC27 = sum(c.W27, c.Z27); r.AC29 = sum(c.W29, c.Z29); r.AC35 = sum(c.W35, c.Z35);
  r.U42 = sum(c.I42, c.L42, c.O42, c.R42);
  r.U44 = sum(c.I44, c.L44, c.O44, c.R44);
  r.U46 = avg([c.I46, c.L46, c.O46, c.R46]);
  r.U48 = avg([c.I48, c.L48, c.O48, c.R48]);
  return r;
}

// ── XML cell writer ───────────────────────────────────────────────────────────
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colNum = col => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

function setCell(xml, addr, value) {
  const [, col, row] = addr.match(/^([A-Z]+)(\d+)$/);
  const body = value === null || value === undefined || value === ''
    ? null
    : typeof value === 'number'
      ? { t: '', inner: `<v>${value}</v>` }
      : { t: ' t="inlineStr"', inner: `<is><t xml:space="preserve">${xmlEsc(value)}</t></is>` };
  const build = s => (body ? `<c r="${addr}"${s}${body.t}>${body.inner}</c>` : `<c r="${addr}"${s}/>`);

  const re = new RegExp(`<c r="${addr}"((?:\\s+[a-z]+="[^"]*")*)\\s*(?:/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(re);
  if (m) {
    const s = (m[1].match(/\s+s="\d+"/) || [''])[0]; // keep the style, drop t= and the formula
    return xml.replace(re, build(s));
  }
  if (!body) return xml;
  // Cell not in the template: insert into its row in column order.
  const rowRe = new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
  const rm = xml.match(rowRe);
  if (!rm) throw new Error(`row ${row} not found in template`);
  const cells = rm[2].match(/<c r="[A-Z]+\d+"[\s\S]*?(?:\/>|<\/c>)/g) || [];
  const at = cells.findIndex(x => colNum(x.match(/r="([A-Z]+)/)[1]) > colNum(col));
  const newCell = build('');
  const inner = at < 0 ? rm[2] + newCell : rm[2].replace(cells[at], newCell + cells[at]);
  return xml.replace(rowRe, `$1${inner}$3`);
}

// ── Signature block (ผู้จัดทำ D64:I65 · ผู้ทบทวน Q64:V65) ─────────────────────────
// Name and position rows are merged across the block and centred in TH SarabunPSK 11.
const SIGN_MERGES = ['D64:I64', 'D65:I65', 'Q64:V64', 'Q65:V65'];
const SIGN_XF = '<xf numFmtId="0" fontId="FONT" fillId="0" borderId="0" xfId="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" shrinkToFit="1"/></xf>';   // shrink a long line instead of cutting it off

// Adds the font + cell style to styles.xml; returns the new style index.
function addSignStyle(styles) {
  const fonts = styles.match(/<fonts count="(\d+)"([^>]*)>([\s\S]*?)<\/fonts>/);
  const fontN = +fonts[1];
  const font = '<font><sz val="11"/><color theme="1"/><name val="TH SarabunPSK"/><family val="2"/><charset val="222"/></font>';
  styles = styles.replace(fonts[0], `<fonts count="${fontN + 1}"${fonts[2]}>${fonts[3]}${font}</fonts>`);
  const xfs = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  const idx = +xfs[1];
  styles = styles.replace(xfs[0], `<cellXfs count="${idx + 1}">${xfs[2]}${SIGN_XF.replace('FONT', fontN)}</cellXfs>`);
  return { styles, idx };
}

const colName = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
function applySignBlock(xml, styleIdx) {
  for (const ref of SIGN_MERGES) {
    const [a, b] = ref.split(':');
    const row = a.match(/\d+/)[0];
    for (let c = colNum(a.match(/[A-Z]+/)[0]); c <= colNum(b.match(/[A-Z]+/)[0]); c++) {
      const addr = colName(c) + row;
      const re = new RegExp(`<c r="${addr}"((?:\\s+[a-z]+="[^"]*")*)`);
      const m = xml.match(re);
      if (!m) { xml = setCell(xml, addr, ' '); continue; } // not expected: template has every cell
      const attrs = m[1].replace(/\s+s="\d+"/, '') + ` s="${styleIdx}"`;
      xml = xml.replace(re, `<c r="${addr}"${attrs}`);
    }
  }
  const existing = (xml.match(/<mergeCell ref="([^"]+)"\/>/g) || []).map(x => x.match(/ref="([^"]+)"/)[1]);
  const add = SIGN_MERGES.filter(r => !existing.includes(r));
  if (!add.length) return xml;
  const tags = add.map(r => `<mergeCell ref="${r}"/>`).join('');
  if (/<mergeCells /.test(xml)) {
    return xml.replace(/<mergeCells count="(\d+)">([\s\S]*?)<\/mergeCells>/,
      (m0, n, inner) => `<mergeCells count="${+n + add.length}">${inner}${tags}</mergeCells>`);
  }
  return xml.replace('</sheetData>', `</sheetData><mergeCells count="${add.length}">${tags}</mergeCells>`);
}

// Formula cells left in the template after filling (e.g. Polymer total) — recalculated on open.
async function writeMhReport({ date, cells, preparer, reviewer }) {
  const zip = await JSZip.loadAsync(fs.readFileSync(THEME));
  let xml = await zip.file(SHEET).async('string');

  const all = { ...addTotals(cells), P4: thaiDate(date) };
  if (preparer?.name) { all.D64 = preparer.name; all.D65 = preparer.position || null; }
  if (reviewer?.name) { all.Q64 = reviewer.name; all.Q65 = reviewer.position || null; }
  for (const [addr, v] of Object.entries(all)) xml = setCell(xml, addr, v);
  const st = addSignStyle(await zip.file('xl/styles.xml').async('string'));
  zip.file('xl/styles.xml', st.styles, NO_DIRS);
  xml = applySignBlock(xml, st.idx);
  zip.file(SHEET, xml, NO_DIRS);

  // Drop the external link ([1]Data!) and the stale calc chain; recalc on open.
  let wb = await zip.file('xl/workbook.xml').async('string');
  wb = wb.replace(/<externalReferences>[\s\S]*?<\/externalReferences>/, '')
         .replace(/<calcPr([^>]*?)\/>/, (m0, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`);
  zip.file('xl/workbook.xml', wb, NO_DIRS);
  let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  rels = rels.replace(/<Relationship [^>]*(?:externalLink|calcChain)[^>]*\/>/g, '');
  zip.file('xl/_rels/workbook.xml.rels', rels, NO_DIRS);
  let ct = await zip.file('[Content_Types].xml').async('string');
  ct = ct.replace(/<Override PartName="\/xl\/(?:externalLinks\/externalLink1|calcChain)\.xml"[^>]*\/>/g, '');
  zip.file('[Content_Types].xml', ct, NO_DIRS);
  for (const p of ['xl/calcChain.xml', 'xl/externalLinks/externalLink1.xml', 'xl/externalLinks/_rels/externalLink1.xml.rels']) zip.remove(p);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildMhCells, overlayDbCells, writeMhReport, thaiDate, backwashByPhase };
