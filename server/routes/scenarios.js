const express = require('express');
const router = express.Router();
const { getDb, persist, nowTH } = require('../services/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getActiveScenario, allScenarioThresholds, activeLimits, streaksBefore, epidemicThresholds, validateThresholds } = require('../services/scenario');
const { attachActor, can, SCI_WRITE } = require('../services/actor');
const { kickSync } = require('../services/uroboros');
const hist = require('../services/scenarioHistory');

const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');
const APP_SETTINGS_PATH = path.join(__dirname, '..', 'config', 'app_settings.json');

function readAppSettings() {
  try { return JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, 'utf8')); }
  catch { return { epidemic: false }; }
}
function writeAppSettings(data) {
  fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(data, null, 2));
}

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.all('SELECT * FROM scenarios ORDER BY created_at DESC');
  res.json(rows);
});

router.get('/active', (req, res) => {
  const active = getActiveScenario();
  if (!active) return res.json(null);
  res.json({ ...active.row, thresholds: active.thresholds, epidemic: active.epidemic });
});

// เกณฑ์ของทุกสถานการณ์ในครั้งเดียว (หน้าแก้เกณฑ์ + พรีวิว alarm ใน Event Class)
router.get('/thresholds', (req, res) => {
  res.json(allScenarioThresholds());
});

// เกณฑ์ของสถานการณ์ที่ active ต่อพารามิเตอร์ (+ configparam_id) — อ่านได้ไม่ต้อง login
// ผู้ใช้: Dashboard, /record และ MHxView ของ BellBeast (GET /labventure/api/scenarios/limits ผ่าน proxy :443)
router.get('/limits', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(activeLimits());
});

// จำนวนครั้งที่เกินเกณฑ์ติดกันก่อนรอบนี้ (/record ใช้ตัดสินน้ำเงิน/แดง) ?date=YYYY-MM-DD&slot=HH:MM|daily
router.get('/streaks', (req, res) => {
  const { date, slot } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !slot) return res.status(400).json({ error: 'date and slot required' });
  res.json(streaksBefore(date, String(slot)));
});

router.post('/', (req, res) => {
  const db = getDb();
  const { name, description, threshold_file, notes } = req.body;
  if (!name || !threshold_file) return res.status(400).json({ error: 'name and threshold_file required' });
  db.run(
    'INSERT INTO scenarios (name, description, threshold_file, notes) VALUES (?, ?, ?, ?)',
    [name, description || null, threshold_file, notes || null]
  );
  persist();
  res.json({ ok: true });
});

// ประกาศ/ยกเลิกภาวะ = เปลี่ยนสถานการณ์ที่ active · เฉพาะนักวิทย์/superadmin · เก็บประวัติใน scenario_periods
// แล้วแจ้ง Uroboros ให้ดึงเกณฑ์ใหม่ทันที (alarm แบบอ้างเกณฑ์ไม่ต้องรอรอบ sync 120 วิ)
// test: true = เปลี่ยนจาก test mode (Ctrl+Shift+F10) — เฉพาะ super admin, log ติดป้าย [TEST]
router.put('/:id/activate', attachActor, async (req, res) => {
  const isTest = !!req.body?.test;
  if (isTest && !req.actor.isAdmin) return res.status(403).json({ error: 'test mode ใช้ได้เฉพาะ super admin' });
  if (!isTest && !can(req.actor, SCI_WRITE)) return res.status(403).json({ error: 'เฉพาะนักวิทยาศาสตร์เท่านั้นที่เปลี่ยนสถานการณ์ได้' });
  const db = getDb();
  const id = Number(req.params.id);
  const target = db.get('SELECT id, name FROM scenarios WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ error: 'ไม่พบสถานการณ์' });
  const prev = db.get('SELECT id FROM scenarios WHERE active = 1 LIMIT 1');
  if (prev?.id === id) return res.json({ ok: true, unchanged: true });
  const now = nowTH();
  db.run('UPDATE scenarios SET active = 0, deactivated_at = ? WHERE active = 1', [now]);
  db.run('UPDATE scenarios SET active = 1, activated_at = ? WHERE id = ?', [now, id]);
  const text = String(req.body?.note || '').trim();
  const note = isTest ? `[TEST]${text ? ` ${text}` : ''}` : (text || null);
  const { period } = hist.syncNow({ actor: req.actor.name, note, isTest });   // ช่วงใหม่ใน scenario_periods
  persist();
  console.log(`[scenario] ${req.actor.name} → ${target.name}${note ? ` (${note})` : ''}`);
  const sync = await kickSync();
  hist.setSyncResult(period?.id, sync);
  res.json({ ok: true, sync });
});

// ประวัติการเปลี่ยนเกณฑ์ (ล่าสุดก่อน) จาก scenario_periods — reason: scenario | thresholds | epidemic | epidemic_thresholds | init
router.get('/log', (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 20);
  res.json(hist.listPeriods({ limit }));
});

// เกณฑ์ ณ วัน/รอบ (หน้า /record ใช้ตอนดูย้อนหลัง) ?date=YYYY-MM-DD&slot=HH:MM|daily|weekly
router.get('/at', (req, res) => {
  const { date, slot } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !slot) return res.status(400).json({ error: 'date and slot required' });
  const r = hist.thresholdsAt(date, String(slot));
  if (!r) return res.json(null);
  res.json({ id: r.scenario.id, name: r.scenario.name, rev: r.rev, epidemic: r.epidemic, estimated: r.estimated, period_id: r.period_id, thresholds: r.thresholds });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, description, threshold_file, notes } = req.body;
  db.run(
    'UPDATE scenarios SET name = ?, description = ?, threshold_file = ?, notes = ? WHERE id = ?',
    [name, description || null, threshold_file, notes || null, req.params.id]
  );
  persist();
  hist.syncNow({ actor: 'system' });   // เปลี่ยนไฟล์เกณฑ์ของสถานการณ์ → rev ใหม่
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.run('DELETE FROM scenarios WHERE id = ?', [req.params.id]);
  persist();
  res.json({ ok: true });
});

// Epidemic toggle — GET /api/scenarios/epidemic  PATCH /api/scenarios/epidemic
router.get('/epidemic', (req, res) => {
  const s = readAppSettings();
  res.json({ epidemic: !!s.epidemic });
});

router.patch('/epidemic', attachActor, (req, res) => {
  const s = readAppSettings();
  const changed = !!s.epidemic !== !!req.body.epidemic;
  s.epidemic = !!req.body.epidemic;
  writeAppSettings(s);
  if (changed) hist.syncNow({ actor: req.actor.name, note: req.body?.note ? String(req.body.note).trim() || null : null });
  if (changed) kickSync().catch(() => {});   // เกณฑ์ที่ใช้เปลี่ยน → alarm แบบอ้างเกณฑ์ต้องได้ค่าใหม่
  res.json({ epidemic: s.epidemic });
});

// เกณฑ์ของโหมดโรคระบาด (ทับสถานการณ์ที่ active เมื่อเปิดโหมด) — GET อ่านได้, PUT เฉพาะนักวิทย์/superadmin
router.get('/epidemic/thresholds', (req, res) => {
  res.json({ thresholds: epidemicThresholds() });
});

router.put('/epidemic/thresholds', attachActor, (req, res) => {
  if (!can(req.actor, SCI_WRITE)) return res.status(403).json({ error: 'เฉพาะนักวิทยาศาสตร์เท่านั้นที่แก้เกณฑ์ได้' });
  const { thresholds, errors } = validateThresholds(req.body?.thresholds);
  if (errors.length) return res.status(400).json({ error: errors.join(' · '), errors });
  const s = readAppSettings();
  s.epidemic_thresholds = thresholds;
  writeAppSettings(s);
  hist.syncNow({ actor: req.actor.name });   // rev ใหม่ของเกณฑ์โรคระบาด (+ ช่วงใหม่ถ้าเปิดโหมดอยู่)
  console.log(`[scenario] ${req.actor.name} saved epidemic thresholds (${thresholds.length})`);
  if (s.epidemic) kickSync().catch(() => {});
  res.json({ ok: true, count: thresholds.length });
});

// CAR templates — GET /api/scenarios/car-templates  PATCH /api/scenarios/car-templates
router.get('/car-templates', (req, res) => {
  const s = readAppSettings();
  res.json({ car_templates: s.car_templates ?? {} });
});

router.patch('/car-templates', (req, res) => {
  const s = readAppSettings();
  s.car_templates = { ...(s.car_templates ?? {}), ...req.body };
  writeAppSettings(s);
  res.json({ car_templates: s.car_templates });
});

// ข้อความวิ่ง: หลายข้อความ (marquee_items) · ไฟล์เก่าที่มีแต่ marquee_text → นับเป็น 1 ข้อความ
function marqueeItems(s) {
  if (Array.isArray(s.marquee_items)) return s.marquee_items.map(t => String(t ?? '').trim()).filter(Boolean);
  const t = String(s.marquee_text ?? '').trim();
  return t ? [t] : [];
}
const MARQUEE_SEP = ' 📢 ';
const marqueeJoined = items => (items.length ? `📢 ${items.join(MARQUEE_SEP)} 📢` : '');

router.get('/marquee', (req, res) => {
  const items = marqueeItems(readAppSettings());
  res.json({ items, marquee_text: marqueeJoined(items) });
});

// สำหรับ MHxView ของ BellBeast (GET /labventure/api/scenarios/live ผ่าน proxy :443) — อ่านได้ไม่ต้อง login
// rev = ลายนิ้วมือของเกณฑ์ที่ใช้อยู่ (สถานการณ์ + โรคระบาด + ค่า) → เปลี่ยนเมื่อไหร่ MHxView ดึงเกณฑ์ใหม่เอง
router.get('/live', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const limits = activeLimits();
  const rev = crypto.createHash('md5').update(JSON.stringify(limits)).digest('hex').slice(0, 12);
  res.json({ marquee: marqueeItems(readAppSettings()), rev, scenario: limits.scenario, epidemic: limits.epidemic });
});

// Daily report cost / tank settings
router.get('/report-settings', (req, res) => {
  const s = readAppSettings();
  res.json({
    chem_cost:   s.chem_cost   ?? { alum_ton: 0, pacl_ton: 0, chlorine_ton: 0, sludge_day: 0 },
    // max_energy = Demand on-peak rate (บาท/kW/เดือน); demand_kw = billed on-peak kW;
    // service_charge = ค่าบริการ (บาท/เดือน)
    energy_cost: { peak_price: 0, offpeak_price: 0, ft_price: 0, max_energy: 0, demand_kw: 0, service_charge: 312.24, ...(s.energy_cost ?? {}) },
    rw_cost:     s.rw_cost     ?? 0,
    cwt_area_m2: s.cwt_area_m2 ?? 48000,
  });
});

router.patch('/report-settings', (req, res) => {
  const s = readAppSettings();
  if (req.body.chem_cost)   s.chem_cost   = { ...(s.chem_cost ?? {}),   ...req.body.chem_cost };
  if (req.body.energy_cost) s.energy_cost = { ...(s.energy_cost ?? {}), ...req.body.energy_cost };
  if (req.body.rw_cost     !== undefined) s.rw_cost     = Number(req.body.rw_cost);
  if (req.body.cwt_area_m2 !== undefined) s.cwt_area_m2 = Number(req.body.cwt_area_m2);
  writeAppSettings(s);
  res.json({ ok: true });
});

// body: { items: string[] } (ใหม่) หรือ { marquee_text } (เก่า = 1 ข้อความ)
router.patch('/marquee', (req, res) => {
  const s = readAppSettings();
  const raw = Array.isArray(req.body?.items) ? req.body.items : [req.body?.marquee_text];
  s.marquee_items = raw.map(t => String(t ?? '').trim()).filter(Boolean).slice(0, 20);
  delete s.marquee_text;
  writeAppSettings(s);
  res.json({ items: s.marquee_items, marquee_text: marqueeJoined(s.marquee_items) });
});

module.exports = router;
