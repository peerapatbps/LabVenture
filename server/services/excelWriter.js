const { spawn } = require('child_process');
const path = require('path');

const WRITER = path.join(__dirname, '..', 'excel_writer.py');

async function writeToExcel(records) {
  if (!records || records.length === 0) return { written: 0 };
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({ records });
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

module.exports = { writeToExcel };
