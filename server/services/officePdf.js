// Office files finished/converted by the Office app itself (COM, via scripts/*.ps1), so output matches the form exactly.
// One job at a time — Word/Excel COM do not like parallel instances.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

let chain = Promise.resolve();
// write buf → run script(in, out, ...args) → read out
function runOffice(app, script, buf, inExt, outExt, args = []) {
  const run = () => new Promise((resolve, reject) => {
    const base = path.join(os.tmpdir(), `lv_${inExt}_${process.pid}_${Date.now()}`);
    const inF = `${base}.${inExt}`;
    const outF = `${base}_out.${outExt}`;
    fs.writeFileSync(inF, buf);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'scripts', script), inF, outF, ...args.map(String)],
      { timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
        try {
          if (err || !fs.existsSync(outF)) return reject(new Error(`${app} ทำไฟล์ไม่สำเร็จ: ${(stderr || err?.message || '').trim()}`));
          resolve(fs.readFileSync(outF));
        } finally {
          fs.rmSync(inF, { force: true });
          fs.rmSync(outF, { force: true });
        }
      });
  });
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

const toPdf = (buf, ext) => (ext === 'docx'
  ? runOffice('Word', 'docx2pdf.ps1', buf, 'docx', 'pdf')
  : runOffice('Excel', 'xlsx2pdf.ps1', buf, 'xlsx', 'pdf'));

// CAR log: Excel autofits rows / paginates / pads (scripts/xlsxlog.ps1) → fmt 'xlsx' | 'pdf'
const excelLog = (buf, fmt, { first, count, spare, pagePt }) =>
  runOffice('Excel', 'xlsxlog.ps1', buf, 'xlsx', fmt, [fmt, first, count, spare, pagePt]);

module.exports = { toPdf, excelLog };
