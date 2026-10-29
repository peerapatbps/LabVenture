// เกณฑ์ของสถานการณ์ที่ active (+ โหมดโรคระบาด) และ Control Value ของฟอร์ม DailyLab
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');
const APP_SETTINGS_PATH = path.join(__dirname, '..', 'config', 'app_settings.json');
const CONTROL_CELLS_PATH = path.join(__dirname, '..', 'config', 'excel_control_cells.json');

function readAppSettings() {
  try { return JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, 'utf8')); }
  catch { return { epidemic: false }; }
}

// โหมดโรคระบาด = ชุดเกณฑ์ที่ "ทับ" สถานการณ์ที่ active (app_settings.json epidemic_thresholds)
// ไม่เคยตั้ง → ค่าเดิม TW1–4 คลอรีนคงเหลือ 1.4–1.8 mg/L
const DEFAULT_EPIDEMIC = [1, 2, 3, 4].map(n => ({ param_key: `TW${n}.ResCl2`, min: 1.4, max: 1.8 }));
function epidemicThresholds(settings = readAppSettings()) {
  return Array.isArray(settings.epidemic_thresholds) ? settings.epidemic_thresholds : DEFAULT_EPIDEMIC;
}
// แทนที่ param ที่มีอยู่ (คงลำดับ) และเพิ่ม param ที่สถานการณ์ไม่มี
function applyEpidemic(thresholds, overlay) {
  const out = thresholds.map(t => ({ ...t }));
  for (const e of overlay) {
    const i = out.findIndex(t => t.param_key === e.param_key);
    const v = { param_key: e.param_key, min: e.min ?? null, max: e.max ?? null };
    if (i >= 0) out[i] = v; else out.push(v);
  }
  return out;
}

// คืน { row, thresholds, epidemic } หรือ null ถ้าไม่มีสถานการณ์ active
function getActiveScenario() {
  const row = getDb().get('SELECT * FROM scenarios WHERE active = 1 LIMIT 1');
  if (!row) return null;
  const settings = readAppSettings();
  let thresholds = [];
  try {
    thresholds = JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, row.threshold_file), 'utf8')).thresholds || [];
  } catch {}
  if (settings.epidemic) thresholds = applyEpidemic(thresholds, epidemicThresholds(settings));
  return { row, thresholds, epidemic: !!settings.epidemic };
}

// { "E20": 100, "H73": 6.5, ... } สำหรับเติมช่อง Control Value ในฟอร์ม
function getControlValues() {
  const active = getActiveScenario();
  if (!active) return {};
  let cells = {};
  try { cells = JSON.parse(fs.readFileSync(CONTROL_CELLS_PATH, 'utf8')).cells || {}; } catch {}
  const byKey = Object.fromEntries(active.thresholds.map(t => [t.param_key, t]));
  const out = {};
  for (const [addr, { param_key, field }] of Object.entries(cells)) {
    const v = byKey[param_key]?.[field];
    if (v !== null && v !== undefined) out[addr] = v;
  }
  return out;
}

// param_key → { ...param, node_label } จาก nodes.json
function paramIndex() {
  const nodes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'nodes.json'), 'utf8')).nodes || [];
  const idx = {};
  for (const n of nodes) for (const p of n.parameters || []) idx[p.param_key] = { ...p, node_label: n.label };
  return idx;
}

// เกณฑ์ของทุกสถานการณ์: [{ id, name, active, threshold_file, thresholds }] (+ โหมดโรคระบาดเฉพาะตัวที่ active)
function allScenarioThresholds() {
  const settings = readAppSettings();
  return getDb().all('SELECT id, name, active, threshold_file FROM scenarios ORDER BY id').map(row => {
    let thresholds = [];
    try { thresholds = JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, row.threshold_file), 'utf8')).thresholds || []; } catch {}
    if (settings.epidemic && row.active) thresholds = applyEpidemic(thresholds, epidemicThresholds(settings));
    return { ...row, active: !!row.active, thresholds };
  });
}

// ตรวจรายการเกณฑ์ก่อนบันทึก (min = LCL, max = UCL) → { thresholds (ทำความสะอาดแล้ว), errors: [string] }
function validateThresholds(list) {
  const idx = paramIndex();
  const errors = [];
  const seen = new Set();
  const out = [];
  const toNum = (v) => (v === '' || v == null ? null : Number(v));
  (Array.isArray(list) ? list : []).forEach((t, i) => {
    const row = `แถว ${i + 1}`;
    const key = String(t?.param_key || '').trim();
    if (!key) return errors.push(`${row}: ยังไม่ได้เลือกพารามิเตอร์`);
    if (!idx[key]) return errors.push(`${row}: ไม่พบพารามิเตอร์ "${key}" ใน nodes.json`);
    if (seen.has(key)) return errors.push(`${row}: "${key}" ซ้ำ`);
    seen.add(key);
    const min = toNum(t.min), max = toNum(t.max);
    if (min !== null && !Number.isFinite(min)) return errors.push(`${row} ${key}: LCL ต้องเป็นตัวเลข`);
    if (max !== null && !Number.isFinite(max)) return errors.push(`${row} ${key}: UCL ต้องเป็นตัวเลข`);
    if (min === null && max === null) return errors.push(`${row} ${key}: ต้องมี LCL หรือ UCL อย่างน้อยหนึ่งค่า`);
    if (min !== null && max !== null && min >= max) return errors.push(`${row} ${key}: LCL ต้องน้อยกว่า UCL`);
    out.push({ param_key: key, min, max });
  });
  return { thresholds: out, errors };
}

// ── เกณฑ์ที่ใช้แสดงผลทุกหน้า (/record, Dashboard, MHxView ของ BellBeast) ─────────────
// เกินเกณฑ์ = ต่ำกว่า LCL หรือสูงกว่า UCL · นับครั้งที่เกินติดกันของตัวอย่างที่มีค่า:
// 1 = เกินครั้งแรก (น้ำเงิน) · ≥2 = เกินต่อเนื่อง (แดง) · ตัวอย่างที่เข้าเกณฑ์ → นับใหม่
function isBreach(value, t) {
  const v = typeof value === 'number' ? value : parseFloat(value);
  if (!t || !Number.isFinite(v)) return false;
  if (t.max !== null && t.max !== undefined && v > t.max) return true;
  if (t.min !== null && t.min !== undefined && v < t.min) return true;
  return false;
}

// เกณฑ์ของสถานการณ์ที่ active พร้อม configparam_id (BellBeast/Uroboros ใช้ id นี้)
function activeLimits() {
  const active = getActiveScenario();
  const idx = paramIndex();
  const items = (active?.thresholds || []).map(t => ({
    param_key: t.param_key,
    configparam_id: idx[t.param_key]?.configparam_id ?? null,
    unit: idx[t.param_key]?.unit || '',
    lcl: t.min ?? null,
    ucl: t.max ?? null,
  }));
  return {
    scenario: active ? { id: active.row.id, name: active.row.name, threshold_file: active.row.threshold_file } : null,
    epidemic: !!active?.epidemic,
    items,
  };
}

// จำนวนครั้งที่เกินติดกัน "ก่อน" รอบ (date, slot) ของแต่ละพารามิเตอร์ จาก node_records (ย้อนไม่เกิน 7 วัน)
// คืน { [param_key]: { streak, last: { date, slot, value } | null } }
function streaksBefore(date, slot) {
  const active = getActiveScenario();
  const byKey = Object.fromEntries((active?.thresholds || []).map(t => [t.param_key, t]));
  const keys = Object.keys(byKey);
  if (!keys.length) return {};
  const from = new Date(`${date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 7);
  const rows = getDb().all(
    `SELECT param_key, trans_dtm, trans_time, trans_value FROM node_records
      WHERE param_key IN (${keys.map(() => '?').join(',')})
        AND trans_dtm >= ? AND (trans_dtm < ? OR (trans_dtm = ? AND trans_time < ?))
        AND trans_value IS NOT NULL AND trans_value <> ''
      ORDER BY param_key, trans_dtm DESC, trans_time DESC`,
    [...keys, from.toISOString().slice(0, 10), date, date, slot]
  );
  const out = {};
  for (const r of rows) {
    if (!Number.isFinite(parseFloat(r.trans_value))) continue;   // ค่าที่ไม่ใช่ตัวเลข (เช่น ผลแบคทีเรีย) ไม่นับ
    const o = out[r.param_key] || (out[r.param_key] = { streak: 0, last: null, done: false });
    if (o.done) continue;
    if (!o.last) o.last = { date: r.trans_dtm, slot: r.trans_time, value: r.trans_value };
    if (isBreach(r.trans_value, byKey[r.param_key])) o.streak += 1;
    else o.done = true;
  }
  for (const k of Object.keys(out)) delete out[k].done;
  return out;
}

module.exports = {
  getActiveScenario, getControlValues, readAppSettings, paramIndex, allScenarioThresholds, validateThresholds,
  epidemicThresholds,
  isBreach, activeLimits, streaksBefore,
};
