const { spawn } = require('child_process');
const path = require('path');

const WRITER = path.join(__dirname, '..', 'excel_writer.py');

let _excelForceFail = false;
function setExcelForceFail(v) { _excelForceFail = !!v; }
function getExcelForceFail() { return _excelForceFail; }

async function writeToExcel(records, recordersByDate = {}) {
  if (!records || records.length === 0) return { written: 0 };
  if (_excelForceFail) throw new Error('[force-fail] Excel write disabled for testing');
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({ records, recorders: recordersByDate });
    const py = spawn('python', [WRITER, input]);
    let out = '';
    let err = '';
    py.stdout.on('data', d => out += d);
    py.stderr.on('data', d => err += d);
    py.on('close', code => {
      if (err) process.stderr.write('[excel_writer] ' + err);
      if (code !== 0) return reject(new Error(err || `python exit ${code}`));
      try { resolve(JSON.parse(out.trim())); }
      catch (e) { reject(new Error('bad JSON from excel_writer: ' + out)); }
    });
  });
}

module.exports = { writeToExcel, setExcelForceFail, getExcelForceFail };
