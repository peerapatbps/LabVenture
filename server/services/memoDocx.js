// บันทึกข้อความ F-MS-HACCP-สคบ-14 REV02 — filled from the original Word form (server/templates).
// The .doc is the master; the .docx beside it is the same file saved by Word (layout untouched).
// We only put text into existing paragraphs (anchored by w14:paraId) — never change formatting.
// PDF = the filled .docx exported by Word itself (COM, scripts/docx2pdf.ps1), so both match the form.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const TEMPLATES = { PACL: 'F-MS-HACCP-สคบ-14 Rev02.docx' };

// paraIds in the PACL template
const P = {
  docNo: '6D2328D7',     // ที่  («     สคบฝผม ... /»)
  docDate: '2E57441B',   // วันที่
  addressee: '61BC2AC6', // เรียน .....
  body: '0AC1DB1B',      // ผลการวิเคราะห์คุณภาพ... (dotted slots: บริษัท, งวดวันที่, จำนวน, สุ่ม, ตามรายละเอียด)
  rdHeader: '60688F57',  // ความหนาแน่นสัมพัทธ์ ที่ ..... °C
  conclusion: '69B926DA',
};
const DATA_ROWS = 5; // blank result rows printed on the form

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thaiDate(ymd, short) {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return `${d} ${(short ? THAI_MONTHS_SHORT : THAI_MONTHS)[m - 1]} ${y + 543}`;
}
function specText(p) {
  if (p.min != null && p.max != null) return `${p.min} – ${p.max}`;
  if (p.min != null) return `≥ ${p.min}`;
  if (p.max != null) return `≤ ${p.max}`;
  return '-';
}

// ── XML helpers ────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const RUN_RE = /<w:r[ >][\s\S]*?<\/w:r>/g;
const runText = r => [...r.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
const withText = (run, text) => run.replace(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/, `<w:t xml:space="preserve">${esc(text)}</w:t>`);
const isDots = t => /[.…]/.test(t) && /^[\s.…]+$/.test(t);

function paraRange(xml, id) {
  const at = xml.indexOf(`w14:paraId="${id}"`);
  if (at < 0) throw new Error(`template: paragraph ${id} not found`);
  const start = xml.lastIndexOf('<w:p ', at);
  const end = xml.indexOf('</w:p>', at) + 6;
  return [start, end];
}
function editPara(xml, id, fn) {
  const [s, e] = paraRange(xml, id);
  return xml.slice(0, s) + fn(xml.slice(s, e)) + xml.slice(e);
}

// whole paragraph text → first run keeps its rPr; empty paragraph → run built from the paragraph-mark rPr
function setText(p, text) {
  const lines = String(text).split('\n');
  const runs = p.match(RUN_RE) || [];
  let run;
  if (runs.length) {
    run = runs[0].replace(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g, '').replace(/<w:tab\/>/g, '');
  } else {
    const rPr = (p.match(/<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/) || [])[1] || '';
    run = `<w:r>${rPr}</w:r>`;
  }
  const body = lines.map((l, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(l)}</w:t>`).join('');
  const newRun = run.replace('</w:r>', `${body}</w:r>`);
  const stripped = p.replace(RUN_RE, '').replace(/<w:proofErr [^>]*\/>/g, '');
  return stripped.replace('</w:p>', `${newRun}</w:p>`);
}

// dotted leader runs in order ← values (null/'' keeps the dots)
function fillDots(p, values) {
  let i = 0;
  return p.replace(RUN_RE, r => {
    if (!isDots(runText(r))) return r;
    const v = values[i++];
    return v == null || v === '' ? r : withText(r, v);
  });
}

// ── fill ───────────────────────────────────────────────────────────────────
async function buildDocx(memo, rows, spec) {
  const file = TEMPLATES[memo.chemical];
  if (!file) {
    const e = new Error(`ยังไม่มีแบบฟอร์มต้นฉบับ สคบ-14 สำหรับ ${spec?.label || memo.chemical}`);
    e.status = 400;
    throw e;
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(TEMPLATE_DIR, file)));
  let xml = await zip.file('word/document.xml').async('string');

  const temps = [...new Set(rows.map(r => r.final_attempt.temp_c_rd).filter(t => t != null))];
  const rdTemp = temps.length === 1 ? temps[0] : null;
  const companies = [...new Set(rows.map(r => r.company_name).filter(Boolean))];
  const mixed = companies.length > 1;

  xml = editPara(xml, P.docNo, p => setText(p, `     ${memo.doc_no}`));
  xml = editPara(xml, P.docDate, p => setText(p, `  ${thaiDate(memo.doc_date)}`));
  xml = editPara(xml, P.addressee, p => fillDots(p, [memo.addressee]));
  xml = editPara(xml, P.body, p => fillDots(p, [
    companies.join(', '),
    `${thaiDate(memo.period_from)} ถึง ${thaiDate(memo.period_to)}`,
    String(memo.n_samples ?? ''),
    String(memo.m_analyzed ?? ''),
    memo.spec_ref,
  ]));
  if (rdTemp != null) xml = editPara(xml, P.rdHeader, p => fillDots(p, [String(rdTemp)]));
  xml = editPara(xml, P.conclusion, p => fillDots(p, [memo.conclusion]));

  // results table: header row, DATA_ROWS blank rows, "มาตรฐานที่กำหนด" row
  const head = xml.indexOf('>ตัวอย่างวันที่<');
  const tblStart = xml.lastIndexOf('<w:tbl>', head);
  const tblEnd = xml.indexOf('</w:tbl>', head);
  let tbl = xml.slice(tblStart, tblEnd);
  const trs = tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g);
  const blank = trs[DATA_ROWS];
  const cellParas = tr => tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g).map(tc => tc.match(/<w:p[ >][\s\S]*?<\/w:p>/)[0]);
  const fillRow = (tr, texts) => {
    let out = tr;
    cellParas(tr).forEach((p, i) => { if (texts[i] != null) out = out.replace(p, setText(p, texts[i])); });
    return out;
  };

  const dataTrs = [];
  const n = Math.max(DATA_ROWS, rows.length);
  for (let i = 0; i < n; i++) {
    // extra rows beyond the form's 5 = copies of the last blank row (paraIds dropped — must stay unique)
    const src = i < DATA_ROWS ? trs[1 + i] : blank.replace(/ w14:(paraId|textId)="[^"]*"/g, '');
    const r = rows[i];
    if (!r) { dataTrs.push(src); continue; }
    const fa = r.final_attempt;
    const texts = [
      thaiDate(r.sample_date, true) + (mixed ? `\n${r.company_name}` : ''),
      ...spec.params.map(p => {
        const v = fa.values[p.key];
        if (v == null) return '-';
        return p.with_temp && rdTemp == null && fa.temp_c_rd != null ? `${v} (${fa.temp_c_rd}°C)` : String(v);
      }),
      r.verdict === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน',
    ];
    dataTrs.push(fillRow(src, texts));
  }
  const stdTr = fillRow(trs[DATA_ROWS + 1], [null, ...spec.params.map(specText), null]);

  // rebuild: keep everything outside the data/standard rows exactly as-is
  const a = tbl.indexOf(trs[1]);
  const b = tbl.indexOf(trs[DATA_ROWS + 1]) + trs[DATA_ROWS + 1].length;
  tbl = tbl.slice(0, a) + dataTrs.join('') + stdTr + tbl.slice(b);
  xml = xml.slice(0, tblStart) + tbl + xml.slice(tblEnd);

  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── PDF via Word (services/officePdf.js) ──
const toPdf = buf => require('./officePdf').toPdf(buf, 'docx');

module.exports = { buildDocx, toPdf };
