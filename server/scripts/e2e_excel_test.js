// E2E: บันทึก Excel ทุกพารามิเตอร์ / กรณีไม่สำเร็จ + retry / print-out DailyLab + สาหร่าย
// รัน server ชุดทดสอบแยก (port 3999) ด้วย DB สำเนา + โฟลเดอร์ Excel ชั่วคราว
// AquaDAT / BellBeast ชี้ไปที่อยู่ที่ไม่มีอะไรรับ → ไม่มีข้อมูลทดสอบหลุดไป production
//   node scripts/e2e_excel_test.js
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.join(__dirname, '..');
const PORT = +process.env.E2E_PORT || 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DATE = '2099-01-15';          // ไฟล์เดือน → 01DailyLab_Jan42.xlsx, ชีท "15"
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lv_e2e_'));
const PUSH = path.join(TMP, 'push');
const LOCAL = path.join(TMP, 'local');
const DB = path.join(TMP, 'labventure.db');
fs.mkdirSync(PUSH); fs.mkdirSync(LOCAL);
fs.copyFileSync(path.join(SERVER, 'labventure.db'), DB);
const PUSH_FILE = path.join(PUSH, '01DailyLab_Jan42.xlsx');

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256' })}.${b64({ sub: 'e2e', role: 'scientist', bypass: true, exp: 4102444800 })}.bypass`;
const HEADERS = { Cookie: `aquadat_token=${TOKEN}`, 'Content-Type': 'application/json' };

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, type, data };
}

function py(code, args = []) {
  const r = spawnSync('python', ['-c', code, ...args], { encoding: 'utf-8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

// อ่านค่าเซลล์จากไฟล์ xlsx: { sheet: { addr: value } } + ข้อมูลเสริม
function readCells(file, sheet, addrs) {
  return py(`
import sys, json
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], data_only=False)
ws = wb[sys.argv[2]]
print(json.dumps({a: ws[a].value for a in json.loads(sys.argv[3])}, default=str))`, [file, sheet, JSON.stringify(addrs)]);
}

function dbRows(sql, params = []) {
  return py(`
import sys, json, sqlite3
c = sqlite3.connect(sys.argv[1])
print(json.dumps(c.execute(sys.argv[2], json.loads(sys.argv[3])).fetchall()))`, [DB, sql, JSON.stringify(params)]);
}

const same = (a, b) => a === b || (a != null && b != null && !isNaN(+a) && !isNaN(+b) && Math.abs(+a - +b) < 1e-9) || String(a) === String(b);

// ถือไฟล์แบบ deny-write เหมือน Excel บนเครื่องอื่นเปิดค้างผ่าน share (ไม่โผล่ใน xw.apps ของเครื่องนี้)
function holdLock(file) {
  const p = spawn('python', ['-c', `
import sys, win32file
h = win32file.CreateFile(sys.argv[1], win32file.GENERIC_READ, win32file.FILE_SHARE_READ, None, win32file.OPEN_EXISTING, 0, None)
print('locked', flush=True)
sys.stdin.readline()
h.Close()`, file]);
  return new Promise((resolve, reject) => {
    p.stdout.once('data', () => resolve(() => new Promise(r => { p.on('close', r); p.stdin.end('\n'); })));
    p.stderr.on('data', d => reject(new Error(String(d))));
  });
}

// ไฟล์ปลายทางของระบบเดิม (มีชีทครบทุกวันอยู่แล้ว) — ระบบไม่สร้างเอง · H53 = เกณฑ์ของระบบเดิม ต้องไม่ถูกทับ
const OLD_CONTROL = { addr: 'H53', value: 99 };
py(`
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
ws = wb.copy_worksheet(wb['theme']); ws.title = '15'
ws[sys.argv[3]] = float(sys.argv[4])
wb.save(sys.argv[2])
print('{}')`, [path.join(SERVER, 'templates', 'DailyLab_theme.xlsx'), PUSH_FILE, OLD_CONTROL.addr, String(OLD_CONTROL.value)]);

async function main() {
  const server = spawn('node', ['index.js'], {
    cwd: SERVER,
    env: {
      ...process.env, PORT: String(PORT), LV_DB_PATH: DB, LV_EXCEL_DIR: PUSH, LV_LOCAL_DATA: LOCAL,
      AQUADAT_GRAPHQL_URL: 'http://127.0.0.1:9/graphql', AQUADAT_REST_BASE: 'http://127.0.0.1:9',
      BELLBEAST_STAGE_URL: 'http://127.0.0.1:9/api/stage', LINE_CHANNEL_ACCESS_TOKEN: '', LINE_GROUP_ID: '',
    },
  });
  let log = '';
  server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
  for (let i = 0; i < 60 && !log.includes('running on'); i++) await new Promise(r => setTimeout(r, 500));
  if (!log.includes('running on')) throw new Error('server did not start:\n' + log);

  try {
    // ── 1. บันทึกทุกพารามิเตอร์ใน excel_cell_map (ส่งทีละรอบเวลาเหมือนหน้าเว็บ) ──
    const cellMap = JSON.parse(fs.readFileSync(path.join(SERVER, 'config', 'excel_cell_map.json'), 'utf8'));
    const freqOf = {};
    const uiSlotOf = {};   // param รายวัน → slot ที่หน้าเว็บบันทึกจริง
    for (const node of JSON.parse(fs.readFileSync(path.join(SERVER, 'config', 'nodes.json'), 'utf8')).nodes) {
      for (const p of node.parameters) {
        // param รายวันที่ตั้ง inSlot (OC ของ CW/FW) หน้าเว็บบันทึกในรอบ fixedTime
        freqOf[p.param_key] = p.frequency === 'daily' && p.inSlot ? 'at:' + p.fixedTime : p.frequency;
        uiSlotOf[p.param_key] = freqOf[p.param_key].startsWith('at:') ? p.fixedTime : p.frequency === 'daily' ? 'daily' : null;
      }
    }
    const bySlot = {};
    let n = 0;
    const usedAddr = new Set();   // บาง param มีหลาย key ชี้เซลล์เดียวกัน (เช่น OC: daily + 01:00) → เขียนครั้งเดียวต่อเซลล์
    for (const [param_key, slots] of Object.entries(cellMap)) {
      for (const [slot, addr] of Object.entries(slots).sort(([a], [b]) => (a === 'daily' ? -1 : b === 'daily' ? 1 : 0))) {
        if (usedAddr.has(addr)) continue;
        if (freqOf[param_key]?.startsWith('at:')) { if (slot !== freqOf[param_key].slice(3)) continue; }
        else if ((freqOf[param_key] === 'daily') !== (slot === 'daily')) continue;   // บันทึกตามความถี่จริงเหมือนหน้าเว็บ (key 'daily' ของ param ราย ชม. มีไว้รองรับข้อมูลเก่า)
        usedAddr.add(addr);
        n++;
        const value = /RecommendDose/.test(param_key) ? `dose-${n}` : String(n + 0.25);
        (bySlot[slot] ||= []).push({ param_key, trans_dtm: TEST_DATE, trans_time: slot, trans_value: value });
      }
    }
    const slots = Object.keys(bySlot).sort();
    let excelWarn = [];
    let modes = new Set();
    for (const slot of slots) {
      const r = await api('POST', '/api/write/nodes', { records: bySlot[slot], plant_id: 2, recorder_name: null });
      if (r.data.warnings?.excel) excelWarn.push(`${slot}: ${r.data.warnings.excel.slice(0, 200)}`);
      for (const d of r.data.excelResult?.details || []) modes.add(d.mode);
    }
    check(`1a บันทึก ${n} ค่า (${Object.keys(cellMap).length} พารามิเตอร์, ${slots.length} รอบ) ไม่มี excel warning`,
      excelWarn.length === 0, excelWarn.join(' | '));
    check('1b ไฟล์ปลายทางเขียนผ่าน xlwings อย่างเดียว (ไม่ rewrite / ไม่สร้างไฟล์ของระบบเดิม)',
      modes.size === 1 && modes.has('xlwings'), [...modes].join(','));

    // ค่าใน Excel ต้องตรงกับ node_records ทุกเซลล์ (รวมค่าที่ server คำนวณเพิ่ม เช่น JarTest summary)
    const expected = {};
    for (const [k, slotVal, v] of dbRows('SELECT param_key, trans_time, trans_value FROM node_records WHERE trans_dtm = ?', [TEST_DATE])) {
      const addr = cellMap[k]?.[slotVal];
      if (addr) expected[addr] = { v, k, slotVal };
    }
    const got = readCells(PUSH_FILE, '15', Object.keys(expected));
    const bad = Object.entries(expected).filter(([a, e]) => !same(got[a], e.v)).map(([a, e]) => `${a} ${e.k}@${e.slotVal} exp=${e.v} got=${got[a]}`);
    check(`1c Excel ตรงกับ DB ทุกเซลล์ (${Object.keys(expected).length} เซลล์)`, bad.length === 0, bad.slice(0, 5).join('; '));

    // 1e: param รายวันทุกตัวในหน้าเว็บ ต้องมีเซลล์ใน cell map สำหรับ slot ที่หน้าเว็บบันทึกจริง (กันเขียน Excel ข้ามเงียบ ๆ)
    const noCell = Object.entries(uiSlotOf).filter(([k, s]) => s && cellMap[k] && !cellMap[k][s]).map(([k, s]) => `${k}@${s}`);
    check('1e param รายวันทุกตัวมีเซลล์ Excel ตรงกับ slot ที่หน้าเว็บบันทึก', noCell.length === 0, noCell.slice(0, 6).join(', '));

    // 1d: progress นับ OC ของ CW/FW เป็นรอบ 09:00 รอบเดียว (ไม่มี 21:00 / ไม่อยู่แท็บรายวัน)
    const prog = await api('GET', `/api/progress/nodes-today?date=${TEST_DATE}`);
    const pOf = k => prog.data.nodes.flatMap(nd => nd.params).find(x => x.param_key === k);
    const cw = pOf('CW1.OC'), fw = pOf('FW4.OC'), rw = pOf('RW.OC');
    check('1d progress: CW/FW OC = รอบ 09:00 อย่างเดียว (บันทึกแล้ว), RW OC = 09:00 + 21:00',
      JSON.stringify(cw?.slots.map(s => [s.slot, s.done])) === '[["09:00",true]]'
        && JSON.stringify(fw?.slots.map(s => s.slot)) === '["09:00"]'
        && JSON.stringify(rw?.slots.map(s => s.slot)) === '["09:00","21:00"]',
      `CW1=${JSON.stringify(cw?.slots.map(s => [s.slot, s.done]))} FW4=${JSON.stringify(fw?.slots.map(s => s.slot))} RW=${JSON.stringify(rw?.slots.map(s => s.slot))}`);

    // ── 2. ไม่สำเร็จ: ไฟล์ถูกเปิดค้าง (จำลองเครื่องอื่นถือไฟล์) ──
    const [k2, s2] = ['RW.turb', '03:00'];
    const addr2 = cellMap[k2][s2];
    const release = await holdLock(PUSH_FILE);
    let r = await api('POST', '/api/write/nodes', { records: [{ param_key: k2, trans_dtm: TEST_DATE, trans_time: s2, trans_value: '111' }], plant_id: 2 });
    check('2a ไฟล์ถูกล็อก → response มี warnings.excel (ไม่ตอบว่าเขียนแล้ว)',
      !!r.data.warnings?.excel && /ถูกเปิดค้าง/.test(r.data.warnings.excel), (r.data.warnings?.excel || 'null').slice(0, 120));
    r = await api('POST', '/api/write/nodes', { records: [{ param_key: k2, trans_dtm: TEST_DATE, trans_time: s2, trans_value: '222' }], plant_id: 2 });
    let q = await api('GET', '/api/write/queue');
    check('2b เข้า excel_queue (2 รายการ)', q.data.excel_count === 2, `excel_count=${q.data.excel_count}`);
    r = await api('POST', '/api/write/queue/retry-excel');
    check('2c กด Retry ขณะยังล็อก → ok=false, ยังค้าง', r.data.ok === false && r.data.remaining === 2, JSON.stringify(r.data).slice(0, 160));
    await release();
    r = await api('POST', '/api/write/queue/retry-excel');
    check('2d ปิดไฟล์แล้ว Retry → ok=true, คิวว่าง', r.data.ok === true && r.data.remaining === 0, JSON.stringify(r.data).slice(0, 160));
    const v2 = readCells(PUSH_FILE, '15', [addr2])[addr2];
    check('2e ค่าใน Excel เป็นค่าล่าสุด (222) ไม่ใช่ค่าเก่าในคิว', same(v2, '222'), `got=${v2}`);

    // 2f: โฟลเดอร์ปลายทางเข้าไม่ได้ → excel_writer ต้อง exit 1 (เดิมกลืน error)
    const wr = spawnSync('python', [path.join(SERVER, 'excel_writer.py'), JSON.stringify({ records: [{ param_key: k2, trans_dtm: '2099-02-01', trans_time: s2, trans_value: '1' }] })],
      { encoding: 'utf-8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', LV_LOCAL_DATA: LOCAL, LV_EXCEL_DIR: 'Z:\\lv_no_such_share' } });
    check('2f โฟลเดอร์ปลายทางเข้าไม่ได้ → exit code ≠ 0', wr.status !== 0, (wr.stderr || '').trim().split('\n').pop().slice(0, 140));

    // ── 3. Print-out ──
    // 3a DailyLab
    r = await api('GET', `/api/write/export.xlsx?from=${TEST_DATE}&to=${TEST_DATE}`);
    const dl = path.join(TMP, 'dailylab.xlsx');
    fs.writeFileSync(dl, r.data);
    const dlGot = readCells(dl, '15', Object.keys(expected));
    const dlBad = Object.entries(expected).filter(([a, e]) => a !== addr2 && !same(dlGot[a], e.v));
    check(`3a ดาวน์โหลด DailyLab: ค่าตรงกับ DB`, r.status === 200 && r.type.includes('spreadsheet') && dlBad.length === 0,
      dlBad.slice(0, 3).map(([a, e]) => `${a} exp=${e.v} got=${dlGot[a]}`).join('; '));

    // 4. Control Value: ไฟล์พิมพ์ = เกณฑ์ ณ วันนั้น (ไม่มีเกณฑ์ = '-') · ไฟล์ปลายทาง = ของระบบเดิม ไม่ถูกทับ
    const controlCells = JSON.parse(fs.readFileSync(path.join(SERVER, 'config', 'excel_control_cells.json'), 'utf8')).cells;
    const at = await api('GET', `/api/scenarios/at?date=${TEST_DATE}&slot=daily`);
    const byKey = Object.fromEntries((at.data?.thresholds || []).map(t => [t.param_key, t]));
    const CONTROL = Object.fromEntries(Object.entries(controlCells).map(([a, { param_key, field }]) => [a, byKey[param_key]?.[field] ?? '-']));
    const cv = readCells(dl, '15', Object.keys(CONTROL));
    const badCv = Object.entries(CONTROL).filter(([a, v]) => !same(cv[a], v)).map(([a, v]) => `${a} exp=${v} got=${cv[a]}`);
    check(`4a Control Value ในไฟล์พิมพ์ = เกณฑ์ ${at.data?.name} ครบ ${Object.keys(CONTROL).length} ช่อง`, badCv.length === 0, badCv.join('; '));
    const old = readCells(PUSH_FILE, '15', [OLD_CONTROL.addr])[OLD_CONTROL.addr];
    check('4b ไฟล์ปลายทาง: Control Value ของระบบเดิมไม่ถูกทับ', same(old, OLD_CONTROL.value), `${OLD_CONTROL.addr}=${old}`);

    // 5. ยังไม่มีไฟล์ปลายทาง (เดือนอื่น) → ไม่สร้างเอง, เข้าคิวรอ
    const MISSING = path.join(PUSH, '03DailyLab_Mar42.xlsx');
    r = await api('POST', '/api/write/nodes', { records: [{ param_key: k2, trans_dtm: '2099-03-01', trans_time: s2, trans_value: '5' }], plant_id: 2 });
    check('5a ไม่มีไฟล์ปลายทาง → warnings.excel "ยังไม่มีไฟล์ปลายทาง" และไม่สร้างไฟล์',
      /ยังไม่มีไฟล์ปลายทาง/.test(r.data.warnings?.excel || '') && !fs.existsSync(MISSING), (r.data.warnings?.excel || 'null').slice(0, 140));
    q = await api('GET', '/api/write/queue');
    check('5b เข้า excel_queue รอคนสร้างไฟล์', q.data.excel_count >= 1, `excel_count=${q.data.excel_count}`);

    // 3b-3e สาหร่าย
    const species = dbRows(`SELECT id, species_name FROM algae_species WHERE species_name IN ('Aulacoseira sp.','Microcystis sp.','TestSpecies sp.')`);
    const id = name => species.find(s => s[1] === name)?.[0];
    await api('POST', '/api/algae/records', { date: TEST_DATE, station: 'RW', items: [{ species_id: id('Aulacoseira sp.'), count: 8000 }, { species_id: id('TestSpecies sp.'), count: 5 }] });
    await api('POST', '/api/algae/records', { date: TEST_DATE, station: 'CW2', items: [{ species_id: id('Microcystis sp.'), count: 300 }] });
    await api('POST', '/api/algae/records', { date: '2099-01-20', station: 'TW1', items: [{ species_id: id('Microcystis sp.'), count: 40 }] });

    r = await api('GET', `/api/algae/export-info?from=2099-01-12&to=2099-01-31`);
    check('3b export-info: เจอ 2 วันที่ + เตือนชนิดที่ไม่มีในฟอร์ม',
      JSON.stringify(r.data.dates) === JSON.stringify([TEST_DATE, '2099-01-20']) && JSON.stringify(r.data.unmapped) === '["TestSpecies sp."]',
      JSON.stringify(r.data));

    r = await api('GET', `/api/algae/export.xlsx?from=2099-01-12&to=2099-01-31`);
    const al = path.join(TMP, 'algae.xlsx');
    fs.writeFileSync(al, r.data);
    const info = py(`
import sys, json, zipfile
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], rich_text=True)
ws = wb['15 ม.ค.']
hidden = lambda r: bool(ws.row_dimensions[r].hidden)
af = ws.auto_filter
names = zipfile.ZipFile(sys.argv[1]).namelist()
print(json.dumps({
  'sheets': wb.sheetnames, 'F3': ws['F3'].value, 'D15': ws['D15'].value, 'H74': ws['H74'].value,
  'D9': ws['D9'].value, 'E9': ws['E9'].value, 'F9': ws['F9'].value,
  'hidden_15': hidden(15), 'hidden_16': hidden(16), 'hidden_74': hidden(74), 'hidden_row_TW1': hidden(10),
  'filter': [af.ref] + [[fc.colId, [(c.operator, c.val) for c in fc.customFilters.customFilter]] for fc in af.filterColumn],
  'D95': ws['D95'].value, 'G8_rich': type(ws['G8'].value).__name__,
  'logo': any(n.startswith('xl/media/') for n in names) and 'xl/drawings/drawing1.xml' in names and 'xl/drawings/drawing2.xml' in names,
}, default=str, ensure_ascii=False))`, [al]);
    const turb09 = dbRows(`SELECT trans_value FROM node_records WHERE trans_dtm=? AND param_key='RW.turb' AND trans_time='09:00'`, [TEST_DATE])[0]?.[0];
    const ph09 = dbRows(`SELECT trans_value FROM node_records WHERE trans_dtm=? AND param_key='RW.pH' AND trans_time='09:00'`, [TEST_DATE])[0]?.[0];
    const q1 = (k, s) => dbRows(`SELECT trans_value FROM node_records WHERE trans_dtm=? AND param_key=? AND trans_time=?`, [TEST_DATE, k, s])[0]?.[0];
    check('3g สาหร่าย: OC จากรอบ 09:00', same(info.F9, q1('RW.OC', '09:00')), `RW F9=${info.F9}/${q1('RW.OC', '09:00')}`);
    check('3c สาหร่าย: 1 ชีทต่อวันที่เก็บตัวอย่าง', r.status === 200 && JSON.stringify(info.sheets) === JSON.stringify(['15 ม.ค.', '20 ม.ค.']), JSON.stringify(info.sheets));
    check('3d สาหร่าย: วันที่ไทย + ค่านับ + คุณภาพน้ำ 09:00',
      info.F3.trim() === '15 มกราคม 2642' && same(info.D15, 8000) && same(info.H74, 300) && same(info.D9, turb09) && same(info.E9, ph09),
      `F3=${info.F3} D15=${info.D15} H74=${info.H74} D9=${info.D9}/${turb09} E9=${info.E9}/${ph09}`);
    check('3e สาหร่าย: filter A13:K89 คอลัมน์ D ไม่ว่าง (CW2 อย่างเดียวถูกซ่อน), ซ่อนสถานีที่ไม่มีข้อมูล, สูตร, โลโก้, rich text',
      !info.hidden_15 && info.hidden_16 && info.hidden_74 && info.hidden_row_TW1
        && JSON.stringify(info.filter) === JSON.stringify(['A13:K89', [3, [['notEqual', ' ']]]])
        && info.D95 === '=SUM(D15:D89)' && info.logo && info.G8_rich === 'CellRichText',
      JSON.stringify(info));

    r = await api('GET', `/api/algae/export.xlsx?from=2098-01-01&to=2098-01-07`);
    check('3f สาหร่าย: ช่วงที่ไม่มีข้อมูล → 404', r.status === 404, String(r.status));
  } finally {
    server.kill();
  }

  const fail = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed   (temp: ${TMP})`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
