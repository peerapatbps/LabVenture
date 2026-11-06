// ทดสอบประวัติเกณฑ์ (scenario_periods) + ไฟล์พิมพ์ DailyLab ที่ลงสี/นับ/หมายเหตุตามเกณฑ์ ณ เวลา
// ใช้ DB สำเนาในโฟลเดอร์ temp — ไม่แตะ labventure.db จริง และไม่แตะไฟล์ config
//   node scripts/test_scenario_history.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SERVER = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lv_hist_'));
process.env.LV_DB_PATH = path.join(TMP, 'labventure.db');
fs.copyFileSync(path.join(SERVER, 'labventure.db'), process.env.LV_DB_PATH);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  const { initDb, getDb } = require('../services/db');
  await initDb();
  const db = getDb();
  db.run('DELETE FROM scenario_periods');
  db.run('DELETE FROM scenario_period_thresholds');
  db.run('DELETE FROM scenario_log');
  const hist = require('../services/scenarioHistory');

  // ── 1. ย้ายจาก log (ว่าง) → 1 ช่วง 'init' + rev ของทุกสถานการณ์ ──
  hist.initScenarioHistory();
  const periods = db.all('SELECT * FROM scenario_periods');
  const active = db.get('SELECT id FROM scenarios WHERE active = 1');
  check('1a migrate: 1 ช่วง init ของสถานการณ์ที่ active, source=migrated',
    periods.length === 1 && periods[0].reason === 'init' && periods[0].scenario_id === active.id && periods[0].source === 'migrated',
    JSON.stringify(periods));
  const nScen = db.get('SELECT COUNT(*) n FROM scenarios').n;
  const revs = db.all('SELECT DISTINCT scenario_id, rev FROM scenario_period_thresholds WHERE scenario_id > 0');
  check('1b ทุกสถานการณ์มีเกณฑ์ rev 1', revs.length === nScen && revs.every(r => r.rev === 1), JSON.stringify(revs));
  check('1c sync ซ้ำโดยไม่มีอะไรเปลี่ยน → ไม่สร้างช่วงใหม่', hist.syncNow().changed === false);

  // ── 2. จำลอง: ปกติ จนถึง 2099-01-15 11:00 แล้วเปลี่ยนเป็น "น้ำด้อยคุณภาพระดับเฝ้าระวัง" (CW ≤3, ไม่มีเกณฑ์ CW Cl2)
  // ช่วงสุดท้ายต้องตรงกับ config ปัจจุบัน ไม่งั้น auto-sync จะเปิดช่วงใหม่ (ถูกต้องตามออกแบบ)
  const normal = db.get(`SELECT id FROM scenarios WHERE threshold_file = 'scenario_normal.json'`).id;
  db.run('UPDATE scenarios SET active = 0');
  db.run(`UPDATE scenarios SET active = 1 WHERE threshold_file = 'scenario_flood_watch.json'`);
  const crisis = db.get(`SELECT id FROM scenarios WHERE threshold_file = 'scenario_flood_watch.json'`).id;
  const epi = require('../services/scenario').readAppSettings().epidemic ? 1 : 0;
  db.run('DELETE FROM scenario_periods');
  const T = '2099-01-15T11:00:00.000+07:00';
  db.run(`INSERT INTO scenario_periods (scenario_id, rev, epidemic, started_at, ended_at, reason, actor, source)
          VALUES (?, 1, 0, '2000-01-01T00:00:00.000+07:00', ?, 'init', 'test', 'live')`, [normal, T]);
  db.run(`INSERT INTO scenario_periods (scenario_id, rev, epidemic, started_at, ended_at, reason, actor, note, source)
          VALUES (?, 1, 0, ?, NULL, 'scenario', 'test', 'ทดสอบ', 'live')`, [crisis, T]);
  if (epi) throw new Error('ทดสอบนี้ต้องปิดโหมดโรคระบาดใน app_settings.json');

  const at09 = hist.thresholdsAt('2099-01-15', '09:00'), at13 = hist.thresholdsAt('2099-01-15', '13:00');
  check('2a เกณฑ์ ณ เวลา: 09:00 = ปกติ, 13:00 = เฝ้าระวัง',
    at09.scenario.id === normal && at13.scenario.id === crisis, `${at09.scenario.id} / ${at13.scenario.id}`);

  // ค่า: CW1.turb ปกติ ≤5, เฝ้าระวัง ≤3 · TW1.turb ≤1 (เกินข้ามวันจาก 14 ม.ค. 23:00)
  const recs = [
    ['CW1.turb', '2099-01-15', '05:00', '4'],    // ปกติ: ผ่าน
    ['CW1.turb', '2099-01-15', '09:00', '6'],    // ปกติ: เกินครั้งแรก
    ['CW1.turb', '2099-01-15', '13:00', '3.5'],  // เฝ้าระวัง: เกินต่อเนื่อง (ถ้าใช้เกณฑ์ปกติจะผ่าน)
    ['CW1.turb', '2099-01-15', '17:00', '1.5'],  // ผ่าน
    ['TW1.turb', '2099-01-14', '23:00', '1.5'],  // เกินครั้งแรก
    ['TW1.turb', '2099-01-15', '01:00', '1.2'],  // เกินต่อเนื่องข้ามวัน
    ['TW1.turb', '2099-01-15', '03:00', '0.5'],
  ];
  for (const [k, d, s, v] of recs) {
    db.run('INSERT OR REPLACE INTO node_records (param_key, trans_dtm, trans_time, trans_value) VALUES (?, ?, ?, ?)', [k, d, s, v]);
  }
  const { streaksBefore } = require('../services/scenario');
  const st = streaksBefore('2099-01-15', '17:00');
  check('2b streak ก่อน 17:00: CW1.turb = 2 (นับด้วยเกณฑ์ของแต่ละรอบ)', st['CW1.turb']?.streak === 2, JSON.stringify(st['CW1.turb']));

  const toRec = ([param_key, trans_dtm, trans_time, trans_value]) => ({ param_key, trans_dtm, trans_time, trans_value });
  const { dailyLabMarkup } = require('../services/dailyLabMarkup');
  const dates = ['2099-01-14', '2099-01-15'];
  const m = dailyLabMarkup(dates, recs.map(toRec));
  const f15 = m.fonts['2099-01-15'], c15 = m.cells['2099-01-15'], c14 = m.cells['2099-01-14'];
  check('3a สี: I34 น้ำเงิน, I35 แดง, I33/I36 ไม่ลงสี, C58 แดง (ต่อจากวันก่อน), C69 วันก่อนน้ำเงิน',
    f15.I34 === 'first' && f15.I35 === 'repeat' && !f15.I33 && !f15.I36 && f15.C58 === 'repeat' && m.fonts['2099-01-14'].C69 === 'first',
    JSON.stringify(m.fonts));
  check('3b Control Value: 15 ม.ค. = เฝ้าระวัง (H53=3, K53="-"), 14 ม.ค. = ปกติ (H53=5, K53=0.3)',
    c15.H53 === 3 && c15.K53 === '-' && c14.H53 === 5 && c14.K53 === 0.3, `15: H53=${c15.H53} K53=${c15.K53} · 14: H53=${c14.H53} K53=${c14.K53}`);
  check('3c ตัวเลขนับ: T5 = 2, AF52 = 2, T9 = 1 (15 ม.ค.)', c15.T5 === 2 && c15.AF52 === 2 && c15.T9 === 1, `T5=${c15.T5} AF52=${c15.AF52} T9=${c15.T9}`);
  check('3d หมายเหตุ B77 ขึ้นต้นด้วยการเปลี่ยนเกณฑ์ 11:00 + note, 14 ม.ค. ไม่มีหมายเหตุ',
    /^\*11:00 เปลี่ยนสถานการณ์ .+→.+: ทดสอบ$/.test(c15.B77 || '') && !c14.B77, c15.B77);

  // ── 4. ไฟล์พิมพ์จริง (excel_writer --build) ──
  const { buildDailyLab } = require('../services/excelWriter');
  const buf = await buildDailyLab(dates, recs.map(toRec), {}, m.cells, m.fonts);
  const out = path.join(TMP, 'dailylab.xlsx');
  fs.writeFileSync(out, buf);
  const py = spawnSync('python', ['-c', `
import sys, json
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1]); ws = wb['15']
col = lambda a: (ws[a].font.color.rgb if ws[a].font and ws[a].font.color is not None and isinstance(ws[a].font.color.rgb, str) else None)
print(json.dumps({'I34': col('I34'), 'I35': col('I35'), 'I33': col('I33'), 'H53': ws['H53'].value, 'B77': ws['B77'].value,
  'P77': ws['P77'].value, 'C36': col('C36'), 'D74': ws['D74'].value, 'T5': ws['T5'].value, 'cf': len(list(ws.conditional_formatting))}, ensure_ascii=False))`, out],
    { encoding: 'utf-8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const x = JSON.parse(py.stdout || '{}');
  check('4a xlsx: I34 น้ำเงิน, I35 แดง, I33 สีเดิม', x.I34 === 'FF0000FF' && x.I35 === 'FFFF0000' && x.I33 !== 'FF0000FF' && x.I33 !== 'FFFF0000', JSON.stringify(x));
  check('4b xlsx: H53=3, T5=2, B77 หมายเหตุ, ไม่มีชื่อค้างที่ P77, ป้าย D74 = "ResCl2 =", ไม่มี conditional formatting',
    x.H53 === 3 && x.T5 === 2 && /^\*11:00/.test(x.B77 || '') && x.P77 == null && x.D74 === 'ResCl2 =' && x.cf === 0, py.stderr || '');
  check('4c xlsx: สีแดงที่ทาตายตัวใน template (C36) ถูกล้าง เมื่อค่าไม่เกินเกณฑ์', x.C36 !== 'FFFF0000', `C36=${x.C36}`);

  const fail = results.filter(ok => !ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed   (temp: ${TMP})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
