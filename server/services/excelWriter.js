const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const WRITER = path.join(__dirname, '..', 'excel_writer.py');
const { getControlValues } = require('./scenario');

let _excelForceFail = false;
function setExcelForceFail(v) { _excelForceFail = !!v; }
function getExcelForceFail() { return _excelForceFail; }

async function writeToExcel(records, recordersByDate = {}) {
  if (!records || records.length === 0) return { written: 0 };
  if (_excelForceFail) throw new Error('[force-fail] Excel write disabled for testing');
  return new Promise((resolve, reject) => {
    // controls = Control Value ของสถานการณ์ที่ active → เติมช่องค่าควบคุมในฟอร์ม
    const input = JSON.stringify({ records, recorders: recordersByDate, controls: getControlValues() });
    const py = spawn('python', [WRITER, input]);
    py.stdout.setEncoding('utf8');   // กัน UTF-8 ภาษาไทยถูกตัดกลาง byte ระหว่าง chunk
    py.stderr.setEncoding('utf8');
    let out = '';
    let err = '';
    const timer = setTimeout(() => { err += 'timeout 120s'; py.kill(); }, 120000);
    py.stdout.on('data', d => out += d);
    py.stderr.on('data', d => err += d);
    py.on('error', e => { clearTimeout(timer); reject(e); });  // python หาไม่เจอ/เปิดไม่ได้ → เข้า excel_queue แทนทำ server ล่ม
    py.on('close', code => {
      clearTimeout(timer);
      if (err) process.stderr.write('[excel_writer] ' + err);
      if (code !== 0) return reject(new Error(err || `python exit ${code}`));
      try { resolve(JSON.parse(out.trim())); }
      catch (e) { reject(new Error('bad JSON from excel_writer: ' + out)); }
    });
  });
}

// ไฟล์ DailyLab สำหรับดาวน์โหลด/พิมพ์ (1 ชีทต่อวัน) — JSON ส่งผ่านไฟล์ temp เพราะทั้งเดือนเกินขีดจำกัด argv ของ Windows
// extraCells = { date: { addr: value } } — written last (e.g. Daily Dosage from the Daily Report)
async function buildDailyLab(dates, records, recordersByDate = {}, extraCells = {}) {
  const base = path.join(os.tmpdir(), `lv_dailylab_${process.pid}_${Date.now()}`);
  const inF = `${base}.json`;
  const outF = `${base}.xlsx`;
  fs.writeFileSync(inF, JSON.stringify({ dates, records, recorders: recordersByDate, controls: getControlValues(), cells: extraCells }));
  try {
    await new Promise((resolve, reject) => {
      const py = spawn('python', [WRITER, '--build', inF, outF]);
      py.stderr.setEncoding('utf8');
      let err = '';
      py.stderr.on('data', d => err += d);
      py.on('close', code => (code === 0 && fs.existsSync(outF) ? resolve() : reject(new Error(err || `python exit ${code}`))));
      py.on('error', reject);
    });
    return fs.readFileSync(outF);
  } finally {
    fs.rmSync(inF, { force: true });
    fs.rmSync(outF, { force: true });
  }
}

module.exports = { writeToExcel, buildDailyLab, setExcelForceFail, getExcelForceFail };
