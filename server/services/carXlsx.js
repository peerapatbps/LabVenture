// ใบ CAR (F-MS-QSHE-สบค-08 Rev02) and ทะเบียน CAR (F-MS-QSHE-สบค-09 Rev02) — filled from the original Excel forms
// in server/templates. Same rule as the สคบ-14 memo: never build a layout — only put text into the form's existing
// cells (sheet XML edited in place; styles, merges, page setup, print area untouched).
// Labels with dotted/space leaders get the value written into the leader; checkboxes (Wingdings o/q/¨) become þ (☑).
// PDF = the filled .xlsx exported by Excel itself (services/officePdf.js).
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { fiscalYearBE } = require('./carCreate');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const CAR_FORM = 'F-MS-QSHE-สบค-08 Rev02.xlsx';
const CAR_LOG = 'F-MS-QSHE-สบค-09 Rev02.xlsx';
const SHEET = 'xl/worksheets/sheet1.xml';

// ── dates ──────────────────────────────────────────────────────────────────
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
// issued_at comes from SQLite datetime('now') = UTC; every other date is typed in Thai time
function ymdTH(s, utc) {
  if (!s) return null;
  if (!utc) return String(s).slice(0, 10);
  const d = new Date(String(s).replace(' ', 'T') + (/[zZ+]/.test(s) ? '' : 'Z'));
  return new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
}
const parts = ymd => { const [y, m, d] = ymd.split('-').map(Number); return { d, m, y: y + 543 }; };
const longDate = ymd => { if (!ymd) return ''; const p = parts(ymd); return `${p.d} ${TH_MONTHS[p.m - 1]} ${p.y}`; };
const dmy = ymd => { if (!ymd) return [null, null, null]; const p = parts(ymd); return [String(p.d), String(p.m), String(p.y)]; };
const shortDate = ymd => { if (!ymd) return ''; const p = parts(ymd); return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${String(p.y).slice(-2)}`; };

// ── text layout ────────────────────────────────────────────────────────────
// visible width: Thai above/below marks take no space
const vlen = s => [...s].filter(c => !/[ัิ-ฺ็-๎]/.test(c)).length;
const seg = new Intl.Segmenter('th', { granularity: 'word' });
// split into lines of at most widths[i] visible chars (last width repeats), breaking at Thai word boundaries
function wrap(text, widths) {
  widths = [].concat(widths);
  const out = [];
  for (const para of String(text || '').split(/\r?\n/)) {
    let line = '';
    for (const { segment } of seg.segment(para)) {
      const width = widths[Math.min(out.length, widths.length - 1)];
      if (line && vlen(line + segment) > width) {
        const open = line.match(/[(\[\s]*\($/)?.[0] || ''; // never end a line on an opening bracket
        out.push(line.slice(0, line.length - open.length).trimEnd());
        line = open.trimStart() + segment.trimStart();
      }
      else line += segment;
      while (vlen(line) > width) { out.push(line.slice(0, width)); line = line.slice(width); }
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out;
}
// lines → fixed number of cells; overflow is joined into the last one (never silently dropped)
function spread(text, widths, n) {
  const lines = wrap(text, widths);
  if (lines.length > n) lines.splice(n - 1, lines.length, lines.slice(n - 1).join(' '));
  return lines;
}

// ── sheet XML helpers ──────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const T_RE = /<t(?: [^>]*)?>([^<]*)<\/t>/g;
const BOX = /^([oq¨])(\s*)$/; // Wingdings: o/q = ❏/❑, ¨ = ◻ ; þ = ☑

class Sheet {
  constructor(xml, sst) { this.xml = xml; this.sst = sst; }
  static async load(file) {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(TEMPLATE_DIR, file)));
    const sstXml = await zip.file('xl/sharedStrings.xml').async('string');
    const sst = sstXml.match(/<si>[\s\S]*?<\/si>/g).map(si => si.slice(4, -5));
    const s = new Sheet(await zip.file(SHEET).async('string'), sst);
    s.zip = zip;
    return s;
  }
  cellRe(ref) { return new RegExp(`<c r="${ref}"(?: [^>]*?)?(?:/>|>[\\s\\S]*?</c>)`); }
  // the cell's rich/plain string body (<r>…</r>… or <t>…</t>), '' when empty
  body(ref) {
    const c = this.xml.match(this.cellRe(ref))?.[0];
    if (!c) throw new Error(`template: cell ${ref} not found`);
    if (/t="s"/.test(c)) return this.sst[Number(c.match(/<v>(\d+)<\/v>/)[1])];
    return c.match(/<is>([\s\S]*)<\/is>/)?.[1] || '';
  }
  // write an inline string (same style index s=)
  put(ref, isBody) {
    this.xml = this.xml.replace(this.cellRe(ref), c => {
      const s = c.match(/ s="(\d+)"/);
      return `<c r="${ref}"${s ? s[0] : ''} t="inlineStr"><is>${isBody}</is></c>`;
    });
  }
  // map each text node of the cell (index, text) → new text
  edit(ref, fn) {
    let i = 0;
    const body = this.body(ref).replace(T_RE, (m, t) => {
      const v = fn(unesc(t), i++);
      return v == null ? m : `<t xml:space="preserve">${esc(v)}</t>`;
    });
    this.put(ref, body);
  }
  text(ref, v) { if (v != null && v !== '') this.put(ref, `<t xml:space="preserve">${esc(v)}</t>`); }
  // tick checkbox #k (0-based, in reading order) for each k in ks
  tick(ref, ks) {
    ks = ks.filter(k => k != null);
    if (!ks.length) return;
    let k = 0;
    this.edit(ref, t => { const m = t.match(BOX); if (!m) return null; return ks.includes(k++) ? 'þ' + m[2] : null; });
  }
  // dotted leaders (…/.) in reading order ← values (null/'' keeps the dots)
  dots(ref, values) {
    let i = 0;
    this.edit(ref, t => t.replace(/[.…]{2,}/g, d => { const v = values[i++]; return v == null || v === '' ? d : ` ${v} `; }));
  }
  // space leaders (≥2 spaces) in reading order ← values; the gap keeps roughly its width so later labels stay put
  // (a character is ~2.2 spaces wide in these fonts)
  gaps(ref, values) {
    let i = 0;
    this.edit(ref, t => t.replace(/ {2,}/g, g => {
      const v = values[i++];
      if (v == null || v === '') return g;
      return ` ${v}` + ' '.repeat(Math.max(2, Math.round(g.length - 2.2 * vlen(v) - 1)));
    }));
  }
  // merge a range whose cells share one border style (printed look unchanged) so text can use its full width
  merge(range) {
    this.xml = this.xml.replace(/<mergeCells count="(\d+)">/, (m, n) => `<mergeCells count="${+n + 1}"><mergeCell ref="${range}"/>`);
  }
  // "label :" + value on the same cell (value overflows into the empty cells to the right, as when typed by hand)
  append(ref, v) {
    if (v == null || v === '') return;
    const n = (this.body(ref).match(T_RE) || []).length;
    this.edit(ref, (t, i) => (i === n - 1 ? `${t.trimEnd()} ${v}` : null));
  }
  async save() {
    this.zip.file(SHEET, this.xml);
    return this.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}

const fdOf = car => { try { return JSON.parse(car.form_data || '{}'); } catch { return {}; } };
const SYSTEMS = ['HACCP', 'ISO14001:2015', 'ISO45001:2018'];
const ISSUE_ROWS = { 'ผลิตภัณฑ์ที่ไม่เป็นไปตามข้อกำหนด': 'G6', 'การตรวจติดตามภายใน': 'G7', 'ข้อร้องเรียนของลูกค้า': 'G8', 'อื่นๆ': 'G9' };
const idx = (v, list) => { const i = list.indexOf(v); return i < 0 ? null : i; };

function findingText(car) {
  // ≥/≤ have no glyph in the form's Thai fonts (Excel falls back to an oversized one)
  let t = String(car.parameter_name || '').replace(/\s*≥\s*/g, ' ไม่ต่ำกว่า ').replace(/\s*≤\s*/g, ' ไม่เกิน ');
  if (car.recorded_value != null) {
    const dir = car.threshold_direction === 'below' ? 'ไม่ต่ำกว่า' : 'ไม่เกิน';
    t += ` — ค่าที่พบ ${car.recorded_value}${car.threshold_value != null ? ` (เกณฑ์ ${dir} ${car.threshold_value})` : ''}`;
  }
  return t;
}

// ── สบค-08: one CAR ────────────────────────────────────────────────────────
async function buildCarForm(car) {
  const s = await Sheet.load(CAR_FORM);
  const fd = fdOf(car);
  const code = car.status_code || 10;

  // header
  const sys = idx(car.system_type, SYSTEMS);
  s.tick('B2', [sys == null ? null : sys === 0 ? 0 : 1]); // title: ¨ HACCP ¨ SHE
  s.tick('C3', [idx(car.car_type || 'CAR', ['CAR', 'PAR'])]);
  s.tick('E3', [sys]);
  s.dots('J3', [car.car_number]);

  // ส่วนที่ 1
  // B5:D5 (after the label) and B6:D6 are merged → clipped at D; B7 overflows up to F
  const found = spread(findingText(car), [34, 50, 80], 3);
  s.gaps('B5', [found[0]]);
  s.text('B6', found[1]);
  s.text('B7', found[2]);
  s.dots('J5', [longDate(ymdTH(car.issued_at, true))]);
  if (ISSUE_ROWS[car.issue_type]) s.tick(ISSUE_ROWS[car.issue_type], [0]);
  s.text('C8', car.issuer_name);
  s.append('D8', car.issuer_dept); // "ส่วน/กอง :" overflows into E — filling E would cut the label
  s.text('C9', car.receiver_name);
  s.append('D9', car.receiver_dept);

  // ส่วนที่ 2
  const members = String(fd.s2_meeting_members || '').split(/[,\n]+/).map(x => x.trim()).filter(Boolean);
  if (members.length > 6) members.splice(5, members.length, members.slice(5).join(', '));
  // E:F and H:I slots are two narrow cells styled bold+underline+wrap → merge the pair, write a plain run
  ['C12', 'E12', 'H12', 'C13', 'E13', 'H13'].forEach((ref, i) => {
    if (!members[i]) return;
    if (ref[0] !== 'C') s.merge(`${ref}:${String.fromCharCode(ref.charCodeAt(0) + 1)}${ref.slice(1)}`);
    s.put(ref, `<r><rPr><sz val="14"/><rFont val="AngsanaUPC"/><family val="1"/><charset val="222"/></rPr><t xml:space="preserve">${esc(members[i])}</t></r>`);
  });
  spread(fd.s2_root_cause, 105, 3).forEach((l, i) => s.text(`B${15 + i}`, l));
  spread(fd.s2_correction, 75, 3).forEach((l, i) => s.text(`B${19 + i}`, l));
  s.append('H18', fd.s2_correction_deadline && longDate(fd.s2_correction_deadline));
  s.append('H19', fd.s2_correction_owner);
  spread(fd.s2_prevention, 75, 3).forEach((l, i) => s.text(`B${23 + i}`, l));
  s.append('H22', fd.s2_prevention_deadline && longDate(fd.s2_prevention_deadline));
  s.append('H23', fd.s2_prevention_owner);
  if (fd.s2_respondent) s.dots('B26', [fd.s2_respondent, fd.s2_respondent_pos, ...dmy(fd.s2_responded_at)]);
  if (code >= 30 && fd.s2_approver) s.dots('F26', [fd.s2_approver, '.กผจ.', ...dmy(fd.s2_approved_at)]);

  // ส่วนที่ 3 — ลงรับ/ส่ง is done by hand; the follow-up person is who recorded check #1
  if (fd.s4_check1_by) s.dots('B31', [fd.s4_check1_by, fd.s4_check1_by_pos]);

  // ส่วนที่ 4
  const kinds = [fd.s2_correction ? 0 : null, fd.s2_prevention ? 1 : null];
  const result = r => (r === 'pass' ? 0 : r === 'fail' ? 1 : null);
  if (fd.s4_check1_result) {
    s.tick('C33', kinds);
    s.tick('I33', [result(fd.s4_check1_result)]);
    spread(fd.s4_check1_notes, 75, 2).forEach((l, i) => s.text(`B${35 + i}`, l));
    s.gaps('B37', [fd.s4_check1_by, fd.s4_check1_by_pos, ...dmy(fd.s4_check1_date)]);
  }
  if (fd.s4_check1_result === 'fail') {
    s.append('H35', fd.s4_check2_deadline && longDate(fd.s4_check2_deadline));
    s.append('H36', fd.s4_check2_owner);
  }
  if (fd.s4_check2_result) {
    s.tick('C38', kinds);
    s.tick('I38', [result(fd.s4_check2_result)]);
    spread(fd.s4_check2_notes, 105, 2).forEach((l, i) => s.text(`B${40 + i}`, l));
    s.gaps('B42', [fd.s4_check2_by, fd.s4_check2_by_pos, ...dmy(fd.s4_check2_date)]);
  }

  // ส่วนที่ 5
  if (fd.s5_decision && code >= 60) {
    s.tick('F44', [fd.s5_decision === 'close' ? 0 : 1]);
    s.append('B45', fd.s5_reason);
    s.append('B46', fd.s5_action);
    s.gaps('B47', [fd.s5_approver, null, null, ...dmy(fd.s5_approved_at)]);
  }
  return s.save();
}

// ── สบค-09: CAR/PAR log ────────────────────────────────────────────────────
// The form prints rows 5..36 (32 × 23.1pt). Text wraps inside its cell and the row grows to fit — how Thai text
// wraps is only known to Excel, so the layout is finished by Excel itself (scripts/xlsxlog.ps1, via officePdf.excelLog):
// autofit data rows → page breaks by real height (header rows repeat) → last page padded with blank form rows.
// Here: fill the text, one form row per CAR + LOG_SPARE blank form rows for the padding.
// Column G (วันที่รับส่วนที่ 3) stays blank — stamped by hand on the paper copy.
const FIRST = 5;
const TPL_ROWS = { first: 5, mid: 6 };
const LOG_SPARE = 32;
const LOG_PAGE_PT = 32 * 23.1;
const WRAP_COLS = ['C', 'D', 'E', 'K'];
const ONE_LINE_COLS = ['A', 'B', 'H', 'I', 'J', 'L']; // CAR no. + dates: never split, shrink if needed
const stripTitle = n => String(n || '').replace(/^(นางสาว|นาง|นาย|น\.ส\.|ดร\.)\s*/, '');

function logCells(car) {
  const fd = fdOf(car);
  return {
    A: car.car_number || car.unique_key,
    B: shortDate(ymdTH(car.issued_at, true)),
    C: String(car.parameter_name || '').replace(/\s+/g, ' ').trim(),
    D: car.issuer_dept || stripTitle(car.issuer_name),
    E: car.receiver_dept || stripTitle(car.receiver_name),
    H: shortDate(car.correction_deadline || fd.s2_correction_deadline),
    I: fd.s4_check1_result ? shortDate(fd.s4_check1_date) : '',
    J: fd.s4_check2_result ? shortDate(fd.s4_check2_date) : '',
    K: stripTitle(fd.s4_check2_by || fd.s4_check1_by),
    L: car.status_code === 60 ? shortDate(fd.s5_approved_at) : '',
  };
}

// cars: already filtered, oldest first. systems: which boxes to tick in the title.
// → { buf, layout } — layout goes to officePdf.excelLog to finish the pages
async function buildCarLog(cars, systems = []) {
  const s = await Sheet.load(CAR_LOG);
  s.tick('A1', systems.map(x => idx(x, SYSTEMS)));

  // rows 5..36 → one template row per CAR + spare blank rows
  const rowXml = r => s.xml.match(new RegExp(`<row r="${r}"[\\s\\S]*?</row>`))[0];
  const tpl = { first: rowXml(TPL_ROWS.first), mid: rowXml(TPL_ROWS.mid) };
  const n = cars.length + LOG_SPARE;
  const out = Array.from({ length: n }, (_, i) => {
    const r = FIRST + i;
    return tpl[i === 0 ? 'first' : 'mid'].replace(/<row r="\d+"/, `<row r="${r}"`).replace(/ r="([A-Z]+)\d+"/g, ` r="$1${r}"`);
  });
  const lastRow = FIRST + n; // the template's stray row 37 (one border cell) moves right after
  const start = s.xml.indexOf(`<row r="${FIRST}"`);
  const end = s.xml.indexOf('</row>', s.xml.indexOf('<row r="36"')) + 6;
  s.xml = s.xml.slice(0, start) + out.join('') + s.xml.slice(end)
    .replace(/<row r="37"([^>]*)><c r="L37"/, `<row r="${lastRow}"$1><c r="L${lastRow}"`);
  s.xml = s.xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:N${lastRow}"/>`);
  const wbXml = await s.zip.file('xl/workbook.xml').async('string');
  s.zip.file('xl/workbook.xml', wbXml.replace(/(_xlnm\.Print_Area[^>]*>'[^']+'!\$A\$1:\$L\$)\d+/, `$1${lastRow - 1}`)
    .replace(/(<definedName name="_xlnm\.Print_Area"[^>]*>('[^']+')![^<]*<\/definedName>)/,
      (all, def, sheet) => `${def}<definedName name="_xlnm.Print_Titles" localSheetId="0">${sheet}!$1:$4</definedName>`));

  // all data cells top-left; text columns wrap (row grows); CAR no. and dates stay on one line
  const rows = Array.from({ length: n }, (_, i) => FIRST + i);
  const TOP_LEFT = { horizontal: 'left', vertical: 'top' };
  await alignStyles(s, WRAP_COLS.flatMap(c => rows.map(r => `${c}${r}`)), { ...TOP_LEFT, wrapText: '1' });
  await alignStyles(s, ONE_LINE_COLS.flatMap(c => rows.map(r => `${c}${r}`)), { ...TOP_LEFT, shrinkToFit: '1' });

  cars.forEach((car, i) => {
    for (const [col, v] of Object.entries(logCells(car))) s.text(`${col}${FIRST + i}`, v);
  });
  return { buf: await s.save(), layout: { first: FIRST, count: cars.length, spare: LOG_SPARE, pagePt: LOG_PAGE_PT } };
}

// give the listed cells a copy of their own style with these alignment attributes set (font/border/etc. unchanged)
async function alignStyles(s, refs, attrs) {
  let styles = await s.zip.file('xl/styles.xml').async('string');
  const m = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  const xfs = m[2].match(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g);
  const added = [];
  const map = {};
  const clone = i => {
    if (map[i] != null) return map[i];
    let x = xfs[i];
    const cur = Object.fromEntries([...(x.match(/<alignment([^>]*?)\/>/)?.[1] || '').matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
    const align = `<alignment ${Object.entries({ ...cur, ...attrs }).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`;
    if (/<alignment[^>]*\/>/.test(x)) x = x.replace(/<alignment[^>]*\/>/, align);
    else if (x.endsWith('/>')) x = x.slice(0, -2) + `>${align}</xf>`;
    else x = x.replace('</xf>', `${align}</xf>`);
    if (!/applyAlignment=/.test(x)) x = x.replace('<xf ', '<xf applyAlignment="1" ');
    added.push(x);
    return (map[i] = xfs.length + added.length - 1);
  };
  const set = new Set(refs);
  s.xml = s.xml.replace(/<c r="([A-Z]+\d+)" s="(\d+)"/g, (all, ref, si) => (set.has(ref) ? `<c r="${ref}" s="${clone(Number(si))}"` : all));
  styles = styles.replace(m[0], `<cellXfs count="${xfs.length + added.length}">${m[2]}${added.join('')}</cellXfs>`);
  s.zip.file('xl/styles.xml', styles);
}

module.exports = { buildCarForm, buildCarLog, fiscalYearBE, ymdTH, SYSTEMS };
