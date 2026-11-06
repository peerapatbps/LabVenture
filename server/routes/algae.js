const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ExcelJS = require('exceljs');
const { sendFile } = require('../services/sendFile');
const { getDb, nowTH } = require('../services/db');
const { fetchUserProfile } = require('../services/aquadat');

const EXPORTER = path.join(__dirname, '..', 'algae_exporter.py');
const MASTER = path.join(__dirname, '..', 'templates', 'Algae_theme.xlsx');

function decodeToken(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  } catch { return null; }
}

async function resolveSignerInfo(req) {
  const token = req.cookies?.aquadat_token;
  if (!token) return null;
  const payload = decodeToken(token);
  if (!payload || payload.exp < Date.now() / 1000) return null;
  const profile = await fetchUserProfile(token).catch(() => null);
  if (!profile?.name) return null;
  const db = getDb();
  const entry = db.get(
    `SELECT position_label, dept_label FROM car_whitelist WHERE name = ? LIMIT 1`,
    [profile.name]
  );
  return {
    name: profile.name,
    position_label: entry?.position_label || '',
    dept_label: entry?.dept_label || '',
  };
}

// GET /api/algae/species?q=<text>
router.get('/species', (req, res) => {
  const q = (req.query.q || '').trim();
  const db = getDb();
  let rows;
  if (q) {
    rows = db.all(
      `SELECT id, division, species_name, category, is_active
       FROM algae_species WHERE species_name LIKE ? AND is_active = 1
       ORDER BY division, species_name LIMIT 50`,
      [`%${q}%`]
    );
  } else {
    rows = db.all(
      `SELECT id, division, species_name, category, is_active
       FROM algae_species WHERE is_active = 1
       ORDER BY division, species_name LIMIT 100`
    );
  }
  res.json(rows);
});

// POST /api/algae/species  — add new species
router.post('/species', (req, res) => {
  const { division, species_name, category } = req.body;
  if (!species_name) return res.status(400).json({ error: 'species_name required' });
  const db = getDb();
  try {
    db.run(
      'INSERT INTO algae_species (division, species_name, category) VALUES (?, ?, ?)',
      [division || null, species_name.trim(), category || null]
    );
    const row = db.get('SELECT * FROM algae_species WHERE species_name = ?', [species_name.trim()]);
    res.json(row);
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'species already exists' });
    throw e;
  }
});

// GET /api/algae/records?date=YYYY-MM-DD&station=RW
router.get('/records', (req, res) => {
  const { date, station } = req.query;
  if (!date || !station) return res.status(400).json({ error: 'date and station required' });
  const db = getDb();
  const rows = db.all(
    `SELECT ar.id, ar.species_id, ar.count, s.species_name, s.division, s.category
     FROM algae_records ar
     JOIN algae_species s ON s.id = ar.species_id
     WHERE ar.record_date = ? AND ar.station = ?
     ORDER BY s.division, s.species_name`,
    [date, station]
  );
  res.json(rows);
});

// POST /api/algae/records  — upsert records for a date+station
// body: { date, station, items: [{ species_id, count }] }
router.post('/records', (req, res) => {
  const { date, station, items } = req.body;
  if (!date || !station || !Array.isArray(items)) {
    return res.status(400).json({ error: 'date, station, items[] required' });
  }
  const db = getDb();
  const now = nowTH();
  for (const item of items) {
    db.run(
      `INSERT INTO algae_records (record_date, station, species_id, count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(record_date, station, species_id) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at`,
      [date, station, item.species_id, item.count ?? null, now, now]
    );
  }
  res.json({ ok: true, saved: items.length });
});

// GET /api/algae/week-status?date=YYYY-MM-DD
// Returns how many records exist per station for the week containing `date`
router.get('/week-status', (req, res) => {
  const date = req.query.date || nowTH().split('T')[0];
  const d = new Date(date + 'T00:00:00');
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d); monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const fmt = dt => new Date(dt.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
  const db = getDb();
  const rows = db.all(
    `SELECT station, COUNT(*) as cnt FROM algae_records
     WHERE record_date >= ? AND record_date <= ? GROUP BY station`,
    [fmt(monday), fmt(sunday)]
  );
  const stationMap = {};
  for (const r of rows) stationMap[r.station] = r.cnt;
  res.json({ week_start: fmt(monday), week_end: fmt(sunday), stations: stationMap });
});

// DELETE /api/algae/records/:id
router.delete('/records/:id', (req, res) => {
  const db = getDb();
  db.run('DELETE FROM algae_records WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ── Print-out สาหร่าย: สร้างไฟล์ใหม่จาก templates/Algae_theme.xlsx (1 ชีทต่อวันที่เก็บตัวอย่าง) ──
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EXPORT_DAYS = 62;
const WQ_PARAMS_09 = [
  'RW.turb', 'RW.pH', 'RW.Conduct',
  'TW1.turb', 'TW1.pH', 'TW1.Conduct',
  'TW2.turb', 'TW2.pH', 'TW2.Conduct',
  'CW1.turb', 'CW2.turb', 'CW3.turb', 'CW4.turb',
  'RW.OC', 'TW1.OC', 'TW2.OC', 'CW1.OC', 'CW2.OC', 'CW3.OC', 'CW4.OC',   // OC บันทึก 09:00 + 21:00 (ใช้ 09:00)
];
// รองรับข้อมูลเก่าที่บันทึก OC เป็น daily (ค่า 09:00 ทับถ้ามี)
const WQ_PARAMS_DAILY = ['RW.OC', 'TW1.OC', 'TW2.OC', 'CW1.OC', 'CW2.OC', 'CW3.OC', 'CW4.OC'];

function parseRange(q) {
  const { from, to } = q;
  if (!RE_DATE.test(from || '') || !RE_DATE.test(to || '') || from > to) return { error: 'ช่วงวันที่ไม่ถูกต้อง' };
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days > MAX_EXPORT_DAYS) return { error: `เลือกได้ไม่เกิน ${MAX_EXPORT_DAYS} วัน` };
  return { from, to };
}

function sampleDates(db, from, to) {
  return db.all(
    `SELECT DISTINCT record_date FROM algae_records
      WHERE record_date BETWEEN ? AND ? AND count IS NOT NULL AND count > 0
      ORDER BY record_date`,
    [from, to]
  ).map(r => r.record_date);
}

// ชื่อชนิดในฟอร์ม theme (คอลัมน์ C แถว 15-89) — อ่านครั้งเดียวต่อการแก้ไฟล์
let _masterSpecies = null, _masterMtime = 0;
async function masterSpecies() {
  const mtime = fs.statSync(MASTER).mtimeMs;
  if (_masterSpecies && mtime === _masterMtime) return _masterSpecies;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(MASTER);
  const ws = wb.worksheets[0];
  const set = new Set();
  for (let r = 15; r <= 89; r++) {
    const v = ws.getCell(`C${r}`).value;
    if (typeof v === 'string' && v.trim()) set.add(v.trim());
  }
  _masterSpecies = set; _masterMtime = mtime;
  return set;
}

// GET /api/algae/export-info?from=&to= → วันที่ที่มีข้อมูล + ชนิดที่ไม่มีในฟอร์ม (ให้ UI เตือนก่อนดาวน์โหลด)
router.get('/export-info', async (req, res) => {
  const r = parseRange(req.query);
  if (r.error) return res.status(400).json({ error: r.error });
  const db = getDb();
  const dates = sampleDates(db, r.from, r.to);
  const names = db.all(
    `SELECT DISTINCT s.species_name FROM algae_records ar JOIN algae_species s ON s.id = ar.species_id
      WHERE ar.record_date BETWEEN ? AND ? AND ar.count IS NOT NULL AND ar.count > 0`,
    [r.from, r.to]
  ).map(x => x.species_name.trim());
  const known = await masterSpecies();
  res.json({ dates, unmapped: names.filter(n => !known.has(n)).sort() });
});

// GET /api/algae/export.xlsx?from=&to=
router.get('/export.xlsx', async (req, res) => {
  const r = parseRange(req.query);
  if (r.error) return res.status(400).json({ error: r.error });
  const db = getDb();
  const dates = sampleDates(db, r.from, r.to);
  if (dates.length === 0) return res.status(404).json({ error: 'ไม่มีข้อมูลสาหร่ายในช่วงนี้' });

  const days = dates.map(date => {
    const records = db.all(
      `SELECT ar.station, s.species_name, ar.count
         FROM algae_records ar JOIN algae_species s ON s.id = ar.species_id
        WHERE ar.record_date = ? AND ar.count IS NOT NULL AND ar.count > 0`,
      [date]
    );
    const wqRows = [
      ...db.all(
        `SELECT param_key, trans_value FROM node_records
          WHERE trans_dtm = ? AND trans_time = 'daily' AND param_key IN (${WQ_PARAMS_DAILY.map(() => '?').join(',')})`,
        [date, ...WQ_PARAMS_DAILY]
      ),
      ...db.all(
        `SELECT param_key, trans_value FROM node_records
          WHERE trans_dtm = ? AND trans_time = '09:00' AND param_key IN (${WQ_PARAMS_09.map(() => '?').join(',')})`,
        [date, ...WQ_PARAMS_09]
      ),
    ];
    const wq = {};
    for (const w of wqRows) wq[w.param_key] = w.trans_value;
    return { date, records, wq };
  });

  const signer = await resolveSignerInfo(req).catch(() => null);
  const base = path.join(os.tmpdir(), `lv_algae_${process.pid}_${Date.now()}`);
  const inF = `${base}.json`, outF = `${base}.xlsx`;
  fs.writeFileSync(inF, JSON.stringify({ days, signer }));
  try {
    await new Promise((resolve, reject) => {
      const py = spawn('python', [EXPORTER, inF, outF]);
      py.stderr.setEncoding('utf8');
      let err = '';
      py.stderr.on('data', d => err += d);
      py.on('error', reject);
      py.on('close', code => (code === 0 && fs.existsSync(outF) ? resolve() : reject(new Error(err || `python exit ${code}`))));
    });
    const be = d => `${+d.slice(0, 4) + 543}-${d.slice(5)}`;
    const name = r.from === r.to ? `Algae_${be(r.from)}` : `Algae_${be(r.from)}_${be(r.to)}`;
    sendFile(res, 'xlsx', name, fs.readFileSync(outF), 'algae');
  } catch (e) {
    console.error('[algae/export]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    fs.rmSync(inF, { force: true });
    fs.rmSync(outF, { force: true });
  }
});

module.exports = router;
