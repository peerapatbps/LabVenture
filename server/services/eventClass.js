// Event Class — normalize / validate / row mapping + Uroboros metric schema + clip vocabulary.
// Contract: Re-plan Overview §3.1 (field names match Uroboros AlarmModel.cs EventClass, snake_case).
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const CONFIG_DIR = path.join(__dirname, '..', 'config');

const SEVERITIES = ['info', 'warning', 'critical'];
const AUDIO_MODES = ['A', 'B'];
const UI_TYPES = ['map', 'value', 'status'];
const OPS = ['>', '>=', '<', '<=', '==', '!='];
const CAR_POLICIES = ['none', 'suggest', 'auto'];
// alarm setpoint อ้างอิงเกณฑ์ควบคุมของสถานการณ์ที่ active (rule.ref) — แปลงเป็นตัวเลขตอนส่งให้ Uroboros
const REF_BOUNDS = ['UCL', 'LCL'];            // UCL = max, LCL = min ใน scenario_*.json
const REF_MODES = ['eq', 'pct', 'offset', 'abs'];
const LEVELS = {
  l2: { label: 'L2', bound: 'LCL', op: '<', severity: 'critical' },
  l1: { label: 'L1', bound: 'LCL', op: '<', severity: 'warning' },
  h1: { label: 'H1', bound: 'UCL', op: '>', severity: 'warning' },
  h2: { label: 'H2', bound: 'UCL', op: '>', severity: 'critical' },
};
const { paramIndex, allScenarioThresholds, getActiveScenario } = require('./scenario');
const { CAR_PREFIXES } = require('./carCreate');
const ID_RE = /^[a-z][a-z0-9_]{2,63}$/;
const PH_RE = /^\{([a-z_]+)\}$/;
const CLIP_RE = /^[a-z0-9_]{1,64}$/;   // BellBeast AudioLibraryService.IdRx
// used when Uroboros is unreachable — mirrors MetricsSchemaHandlers.cs
const DEFAULT_PLACEHOLDERS = ['{value}', '{limit}', '{unit}', '{title}'];

const isPlaceholder = (tok) => PH_RE.test(tok);
const placeholdersInText = (s) => (String(s || '').match(/\{[a-z_]+\}/g) || []);

// "lab:123" | {kind:'lab_sample', configparam_id:123} | "RWS.turbidity" → comparable key
function metricKey(sm) {
  if (sm && typeof sm === 'object') return sm.configparam_id != null ? `lab:${sm.configparam_id}` : null;
  if (typeof sm !== 'string' || !sm.trim()) return null;
  const m = sm.trim().match(/^(?:lab[:.]|configparam:)(\d+)$/i);
  return m ? `lab:${m[1]}` : sm.trim();
}

function num(v) {
  if (v === '' || v == null) return NaN;
  return typeof v === 'number' ? v : Number(v);
}

// Coerce form input into the stored shape (no validation here)
function normalize(body, id) {
  const b = body || {};
  const r = b.rule || {};
  let tpl = b.message_template;
  if (typeof tpl === 'string') tpl = tpl.trim() ? [tpl.trim()] : [];
  const ref = r.ref && typeof r.ref === 'object' && r.ref.mode
    ? { bound: r.ref.bound, mode: r.ref.mode, amount: r.ref.mode === 'eq' ? 0 : num(r.ref.amount) }
    : null;
  const rule = {
    op: r.op || '>',
    value: ref ? null : num(r.value),   // ref → ค่าจริงคำนวณตอนส่งออก (resolveItem)
    unit: r.unit || '',
    hysteresis: r.hysteresis === '' || r.hysteresis == null ? 0 : num(r.hysteresis),
    for_polls: r.for_polls === '' || r.for_polls == null ? 1 : num(r.for_polls),
  };
  if (r.max_age_min !== '' && r.max_age_min != null) rule.max_age_min = num(r.max_age_min);
  if (r.decimals !== '' && r.decimals != null) rule.decimals = num(r.decimals);   // ไม่ใส่ = Uroboros ใช้ 2
  if (ref) rule.ref = ref;
  let sm = b.source_metric;
  if (sm && typeof sm === 'object') sm = { kind: sm.kind || 'lab_sample', configparam_id: num(sm.configparam_id) };
  else sm = typeof sm === 'string' ? sm.trim() : sm;
  return {
    event_class_id: String(id ?? b.event_class_id ?? '').trim(),
    param_key: (b.param_key || '').trim() || null,
    title: (b.title || '').trim() || null,
    category: (b.category || '').trim() || null,
    severity: b.severity || 'warning',
    source_metric: sm,
    rule,
    audio_mode: b.audio_mode || 'B',
    message_template: Array.isArray(tpl) ? tpl.map(t => String(t).trim()).filter(Boolean) : [],
    fallback_text: (b.fallback_text || '').trim() || null,
    ui: { type: 'value', ...(b.ui && typeof b.ui === 'object' ? b.ui : {}) },
    zone: (b.zone || '').trim() || null,
    enabled: b.enabled === undefined ? true : !!b.enabled,
    scenario_id: b.scenario_id === '' || b.scenario_id == null ? null : num(b.scenario_id),
    car_policy: b.car_policy || 'suggest',
    car_prefix: b.car_prefix || 'CQ',
  };
}

// ctx: { vocabulary: {known:Set, present:Set, strict:bool} | null, schema: {metrics:Set, placeholders:Set} | null }
// errors block save; warnings are shown but allowed (e.g. a check source is offline / not authoritative yet).
// Reference checks (metric in schema, clip in library) only block an ENABLED class — a disabled draft
// (e.g. imported from a scenario) may be saved first and completed later; enabling re-runs this.
function validate(ec, ctx = {}) {
  const errors = [];
  const warnings = [];
  const err = (field, msg) => errors.push({ field, msg });
  const warn = (field, msg) => warnings.push({ field, msg });
  const refErr = (field, msg) => (ec.enabled ? err : warn)(field, ec.enabled ? msg : `${msg} (ต้องแก้ก่อนเปิดใช้)`);

  if (!ID_RE.test(ec.event_class_id)) err('event_class_id', 'ต้องเป็น a-z, 0-9, _ ขึ้นต้นด้วยตัวอักษร ยาว 3–64 ตัว');
  if (!SEVERITIES.includes(ec.severity)) err('severity', `ต้องเป็น ${SEVERITIES.join(' | ')}`);
  if (!AUDIO_MODES.includes(ec.audio_mode)) err('audio_mode', 'ต้องเป็น A หรือ B');
  if (!UI_TYPES.includes(ec.ui?.type)) err('ui.type', `ต้องเป็น ${UI_TYPES.join(' | ')}`);
  if (ec.scenario_id != null && !Number.isInteger(ec.scenario_id)) err('scenario_id', 'ต้องเป็นเลขจำนวนเต็ม');
  if (!CAR_POLICIES.includes(ec.car_policy)) err('car_policy', `ต้องเป็น ${CAR_POLICIES.join(' | ')}`);
  if (!CAR_PREFIXES.includes(ec.car_prefix)) err('car_prefix', `ต้องเป็น ${CAR_PREFIXES.join(' | ')}`);

  // rule (§5.5)
  const r = ec.rule || {};
  if (!OPS.includes(r.op)) err('rule.op', `ต้องเป็น ${OPS.join(' ')}`);
  if (r.ref) {
    if (!REF_BOUNDS.includes(r.ref.bound)) err('rule.ref', `ต้องอ้างอิง ${REF_BOUNDS.join(' หรือ ')}`);
    if (!REF_MODES.includes(r.ref.mode)) err('rule.ref', `วิธีคำนวณต้องเป็น ${REF_MODES.join(' | ')}`);
    else if (!Number.isFinite(r.ref.amount)) err('rule.ref', 'ต้องใส่ตัวเลข');
    else if (r.ref.mode === 'pct' && r.ref.amount <= 0) err('rule.ref', '% ต้องมากกว่า 0');
    if (!ec.param_key) err('param_key', 'alarm แบบอ้างอิงเกณฑ์ต้องระบุพารามิเตอร์');
    else if (!paramIndex()[ec.param_key]) err('param_key', `ไม่พบ "${ec.param_key}" ใน nodes.json`);
  } else if (!Number.isFinite(r.value)) err('rule.value', 'ต้องเป็นตัวเลข');
  if (!Number.isFinite(r.hysteresis) || r.hysteresis < 0) err('rule.hysteresis', 'ต้องเป็นตัวเลข ≥ 0');
  if (!Number.isInteger(r.for_polls) || r.for_polls < 1) err('rule.for_polls', 'ต้องเป็นจำนวนเต็ม ≥ 1');
  if (r.max_age_min !== undefined && (!Number.isInteger(r.max_age_min) || r.max_age_min < 1)) err('rule.max_age_min', 'ต้องเป็นจำนวนเต็ม ≥ 1');
  if (r.decimals !== undefined && (!Number.isInteger(r.decimals) || r.decimals < 0 || r.decimals > 6)) err('rule.decimals', 'ต้องเป็นจำนวนเต็ม 0–6');

  // source_metric (§5.4)
  const key = metricKey(ec.source_metric);
  if (ec.source_metric && typeof ec.source_metric === 'object' && !Number.isInteger(ec.source_metric.configparam_id)) {
    err('source_metric', 'configparam_id ต้องเป็นเลขจำนวนเต็ม');
  } else if (!key) {
    err('source_metric', 'ต้องระบุ');
  } else if (!ctx.schema) {
    warn('source_metric', 'ติดต่อ Uroboros ไม่ได้ — ยังไม่ได้ยืนยันว่ามี metric นี้');
  } else if (!ctx.schema.metrics.has(key)) {
    refErr('source_metric', `ไม่พบ "${key}" ใน schema ของ Uroboros`);
  }

  // message_template (§5.2, §5.3)
  const tpl = ec.message_template || [];
  const allowedPh = ctx.schema?.placeholders || new Set(DEFAULT_PLACEHOLDERS);
  if (tpl.length === 0) err('message_template', 'ต้องมีอย่างน้อย 1 รายการ');
  const v = ctx.vocabulary;
  if (ec.audio_mode === 'A') {
    // A = one sentence clip, TTS'd by BellBeast from fallback_text and cached under this clip-id
    const tok = tpl[0];
    if (tpl.length > 1) err('message_template', 'โหมด A = ทั้งประโยคเป็นคลิปเดียว ต้องมี 1 clip-id');
    if (tok && !CLIP_RE.test(tok)) err('message_template', `"${tok}" ไม่ใช่ clip-id (a-z 0-9 _) — ประโยคให้ใส่ใน fallback_text`);
    else if (tok && v && !v.present.has(tok)) warn('message_template', `ยังไม่มีไฟล์เสียง "${tok}" ใน BellBeast — ต้อง TTS จาก fallback_text ก่อน`);
    if (!ec.fallback_text) err('fallback_text', 'โหมด A ต้องมี fallback_text (ใช้เป็นข้อความ TTS)');
    else if (placeholdersInText(ec.fallback_text).length) err('fallback_text', 'โหมด A เป็นคลิปตายตัว ใส่ {placeholder} ไม่ได้ — ใช้โหมด B');
  } else {
    for (const tok of tpl) {
      if (isPlaceholder(tok)) {
        if (!allowedPh.has(tok)) err('message_template', `placeholder ${tok} ไม่รองรับ (มี ${[...allowedPh].join(' ')})`);
      } else if (!CLIP_RE.test(tok)) {
        err('message_template', `token "${tok}" ไม่ใช่ clip-id (a-z 0-9 _ เท่านั้น)`);
      } else if (v && !v.known.has(tok)) {
        if (v.strict) refErr('message_template', `ไม่มี clip "${tok}" ในคลังเสียง BellBeast — ให้ admin เพิ่มใน vocab ก่อน`);
        else warn('message_template', `ไม่พบ clip "${tok}" ในคลังเสียง (seed)`);
      } else if (v && v.strict && !v.present.has(tok)) {
        warn('message_template', `"${tok}" อยู่ในรายการคำแต่ยังไม่มีไฟล์เสียง — device จะเล่น horn + fallback แทน`);
      }
    }
    if (!v) warn('message_template', 'โหลดคลังเสียงไม่ได้ — ยังไม่ได้ตรวจ clip-id');
  }

  for (const ph of placeholdersInText(ec.fallback_text)) {
    if (!allowedPh.has(ph)) err('fallback_text', `placeholder ${ph} ไม่รองรับ`);
  }
  if (!ec.fallback_text) warn('fallback_text', 'ไม่มี fallback_text — device จะใช้ข้อความ default ของ Uroboros เมื่อเล่นคลิปไม่ได้');

  return { errors, warnings };
}

const parse = (s, dflt) => { try { return s == null ? dflt : JSON.parse(s); } catch { return dflt; } };

function rowToEc(row) {
  if (!row) return null;
  return {
    ...row,
    source_metric: parse(row.source_metric, row.source_metric),
    rule: parse(row.rule, {}),
    message_template: parse(row.message_template, []),
    ui: parse(row.ui, { type: 'value' }),
    enabled: !!row.enabled,
  };
}

function ecToParams(ec) {
  return {
    title: ec.title, category: ec.category, severity: ec.severity,
    source_metric: JSON.stringify(ec.source_metric), rule: JSON.stringify(ec.rule),
    audio_mode: ec.audio_mode, message_template: JSON.stringify(ec.message_template),
    fallback_text: ec.fallback_text, ui: JSON.stringify(ec.ui), zone: ec.zone,
    enabled: ec.enabled ? 1 : 0, scenario_id: ec.scenario_id,
    car_policy: ec.car_policy, car_prefix: ec.car_prefix, param_key: ec.param_key || null,
  };
}

// ── rule.ref → ตัวเลขจริง ──────────────────────────────────────────────────
const round6 = (v) => Math.round(v * 1e6) / 1e6;

// t = { min, max } ของพารามิเตอร์ในสถานการณ์หนึ่ง (undefined = ไม่มีเกณฑ์) → ตัวเลข หรือ null (ใช้ไม่ได้ในสถานการณ์นี้)
function refValue(ref, t) {
  if (!ref) return null;
  if (ref.mode === 'abs') return Number.isFinite(ref.amount) ? ref.amount : null;
  const base = t ? (ref.bound === 'UCL' ? t.max : t.min) : null;
  if (base === null || base === undefined || !Number.isFinite(Number(base))) return null;
  const b = Number(base);
  if (ref.mode === 'eq') return b;
  if (ref.mode === 'pct') return round6(b * ref.amount / 100);
  if (ref.mode === 'offset') return round6(b + ref.amount);
  return null;
}

const byParamKey = (thresholds) => Object.fromEntries((thresholds || []).map(t => [t.param_key, t]));

// คลาสที่มี ref → rule.value เป็นตัวเลขของสถานการณ์นั้น และตัด ref ออก (รูปแบบเดิมที่ Uroboros รู้จัก)
// คืน null ถ้าสถานการณ์นั้นไม่มี bound ที่อ้างอิง (= คลาสนี้ไม่มีผล)
function resolveItem(item, thresholdsByKey) {
  if (!item?.rule?.ref) return item;
  const value = refValue(item.rule.ref, thresholdsByKey[item.param_key]);
  if (value === null) return null;
  const { ref, ...rule } = item.rule;
  return { ...item, rule: { ...rule, value } };
}

const activeThresholdsByKey = () => byParamKey(getActiveScenario()?.thresholds);

// ค่าในทุกสถานการณ์ สำหรับหน้าแก้ไข: { [scenario_id]: number|null }
function resolvedByScenario(item, scenarios = allScenarioThresholds()) {
  if (!item?.rule?.ref) return null;
  return Object.fromEntries(scenarios.map(s => [s.id, refValue(item.rule.ref, byParamKey(s.thresholds)[item.param_key])]));
}

// ── external lookups (cached 60s; last good copy kept on failure) ──────────
const readServices = () => JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'services.json'), 'utf8'));
const TTL_MS = 60_000;
const cache = { schema: null, schemaAt: 0, schemaError: null };

async function getMetricSchema({ fresh = false } = {}) {
  if (!fresh && cache.schema && Date.now() - cache.schemaAt < TTL_MS) return { schema: cache.schema, error: null };
  const cfg = readServices().uroboros || {};
  const url = `${cfg.base_url || 'http://localhost:8888'}${cfg.metrics_schema_path || '/api/metrics/schema'}`;
  try {
    const r = await fetch(url, { timeout: 5000 });
    if (!r.ok) throw new Error(`Uroboros returned ${r.status}`);
    const data = await r.json();
    cache.schema = {
      server_ts: data.server_ts || null,
      realtime: data.realtime || [],
      lab: data.lab || [],
      placeholders: data.placeholders?.length ? data.placeholders : DEFAULT_PLACEHOLDERS,
    };
    cache.schemaAt = Date.now();
    cache.schemaError = null;
    return { schema: cache.schema, error: null };
  } catch (e) {
    cache.schemaError = e.message;
    return { schema: cache.schema, error: `Cannot reach Uroboros schema: ${e.message}`, stale: !!cache.schema };
  }
}

function schemaCtx(schema) {
  if (!schema) return null;
  const metrics = new Set();
  for (const m of schema.realtime) if (m.source_metric) metrics.add(metricKey(m.source_metric));
  for (const m of schema.lab) metrics.add(`lab:${m.configparam_id}`);
  return { metrics, placeholders: new Set(schema.placeholders) };
}

// Clip library: BellBeast GET /api/audio/clips (clips = files on disk, vocabulary = ids it expects).
// Unreachable → last good copy (still strict) → local seed config/audio_vocabulary.json (warnings only).
const vcache = { data: null, at: 0 };

function localVocabulary(error) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'audio_vocabulary.json'), 'utf8'));
    const clips = (data.clips || []).map(c => ({ ...c, group: c.group || null, present: false }));
    return { source: 'local', strict: false, clips, error };
  } catch (e) {
    return { source: 'none', strict: false, clips: [], error: `${error ? `${error} · ` : ''}audio_vocabulary.json: ${e.message}` };
  }
}

async function getVocabulary({ fresh = false } = {}) {
  if (!fresh && vcache.data && Date.now() - vcache.at < TTL_MS) return vcache.data;
  const cfg = readServices().bellbeast_audio || {};
  const url = `${cfg.base_url || 'http://localhost:443'}${cfg.clips_path || '/api/audio/clips'}`;
  try {
    const r = await fetch(url, { timeout: 5000 });
    if (!r.ok) throw new Error(`BellBeast returned ${r.status}`);
    const data = await r.json();
    const byId = new Map();
    for (const v of data.vocabulary || []) byId.set(v.id, { id: v.id, text: v.text || null, group: v.group || null, present: !!v.present });
    for (const c of data.clips || []) {
      const prev = byId.get(c.id);
      byId.set(c.id, { id: c.id, text: c.text || prev?.text || null, group: prev?.group || (c.source === 'tts' ? 'sentence' : null), present: true, version: c.version });
    }
    const clips = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    vcache.data = { source: 'bellbeast', strict: true, clips, tts_configured: !!data.tts_configured, error: null, fetched_at: new Date().toISOString() };
    vcache.at = Date.now();
    return vcache.data;
  } catch (e) {
    const error = `Cannot reach BellBeast audio library: ${e.message}`;
    if (vcache.data) return { ...vcache.data, source: 'cache', error };
    return localVocabulary(error);
  }
}

function vocabCtx(vocab) {
  if (!vocab || vocab.source === 'none') return null;
  return {
    known: new Set(vocab.clips.map(c => c.id)),
    present: new Set(vocab.clips.filter(c => c.present).map(c => c.id)),
    strict: vocab.strict,
  };
}

// ── ชุด alarm L2/L1/H1/H2 ของพารามิเตอร์เดียว (อ้างอิงเกณฑ์ควบคุมของสถานการณ์) ──
// param_key → nodes.json configparam_id (= AquaDAT configID = Uroboros lab_import_daily.configparam_id)
const ZONE_BY_PREFIX = { RW: 'RWS', CW: 'CWS', FW: 'FWS', TW: 'TPS' };
const UNIT_CLIP = { 'NTU': 's_ntu', 'mg/L': 's_mgl' };
const UNIT_TEXT = { s_ntu: 'เอ็นทียู', s_mgl: 'มิลลิกรัมต่อลิตร' };
// spoken Thai title for imported classes (scientist can edit) — RW น้ำดิบ, CW น้ำตกตะกอน, FW น้ำกรอง, TW น้ำประปา
const POINT_TH = { RW: 'น้ำดิบ', CW: 'น้ำตกตะกอน', FW: 'น้ำกรอง', TW: 'น้ำประปา' };
const PARAM_TH = { turb: 'ความขุ่น', ResCl2: 'คลอรีนคงเหลือ', pH: 'พีเอช', DO: 'ออกซิเจนละลายน้ำ',
  Conduct: 'ค่าการนำไฟฟ้า', OC: 'ออกซิเจนคอนซูม', Total: 'สาหร่ายรวม', ClogFilter: 'สาหร่ายอุดตันบ่อกรอง' };
function thaiTitle(paramKey, label) {
  // Algae.RW.Total → จุด RW + พารามิเตอร์ Total
  const parts = paramKey.split('.');
  const [point, param] = parts.length > 2 ? parts.slice(1) : parts;
  const m = point.match(/^([A-Z]+)(\d*)(?:_([A-Z]))?$/);
  const where = m && POINT_TH[m[1]] ? [POINT_TH[m[1]], m[2] && (m[1] === 'TW' ? m[2] : `เฟส ${m[2]}`), m[3] && `ถัง ${m[3]}`].filter(Boolean).join(' ') : point;
  return `${where} ${PARAM_TH[param] || label || param}`;
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const levelId = (paramKey, lvl) => `${slug(paramKey)}_${lvl}`;

// spec: { mode, amount, severity } ของระดับ lvl → Event Class (enabled ตามที่ส่งมา)
// prev: คลาสเดิม (ถ้ามี) — คงข้อความเสียง/hysteresis/CAR ที่ผู้ใช้แก้ไว้ เปลี่ยนเฉพาะเกณฑ์และ severity
function levelItem(paramKey, lvl, spec, { prev, enabled = true, defaults = {} } = {}) {
  const L = LEVELS[lvl];
  const p = paramIndex()[paramKey];
  if (!L) throw new Error(`ระดับ ${lvl} ไม่รองรับ`);
  if (!p?.configparam_id) throw new Error(`ไม่พบ configparam_id ของ ${paramKey} ใน nodes.json`);
  const unit = p.unit || '';
  // จุดเก็บตัวอย่างอาจไม่ใช่ส่วนแรก เช่น Algae.RW.Total → RW (RWS)
  const prefix = paramKey.split('.').map(s => s.match(/^[A-Z]+/)?.[0]).find(x => ZONE_BY_PREFIX[x])
    ?? paramKey.match(/^[A-Z]+/)?.[0];
  const ref = { bound: L.bound, mode: spec.mode, amount: spec.mode === 'eq' ? 0 : spec.amount };
  if (prev) {
    return {
      ...prev, param_key: paramKey, enabled,
      severity: spec.severity || prev.severity,
      rule: { ...prev.rule, op: L.op, unit: prev.rule?.unit || unit, ref },
    };
  }
  const [word, wordText] = L.op === '>' ? ['s_high', 'สูงกว่าเกณฑ์'] : ['s_low', 'ต่ำกว่าเกณฑ์'];
  return {
    event_class_id: levelId(paramKey, lvl),
    param_key: paramKey,
    title: thaiTitle(paramKey, p.label),
    category: 'water_quality',
    severity: spec.severity || L.severity,
    source_metric: { kind: 'lab_sample', configparam_id: Number(p.configparam_id) },
    rule: { op: L.op, value: null, unit, hysteresis: 0, for_polls: 1, ref },
    audio_mode: 'B',
    message_template: [`s_lab_${slug(paramKey)}`, word, 's_latest_value', '{value}', ...(UNIT_CLIP[unit] ? [UNIT_CLIP[unit]] : [])],
    fallback_text: `{title} ${wordText} ค่าล่าสุด {value}${unit ? ' {unit}' : ''}`,
    ui: { type: 'value', sparkline: true },
    zone: ZONE_BY_PREFIX[prefix] || prefix || null,
    enabled,
    scenario_id: null,
    car_policy: defaults.car_policy || 'suggest',
    car_prefix: defaults.car_prefix || 'CQ',
  };
}

// ลำดับผิดในสถานการณ์ใด (เช่น H1 ≥ H2, L1 ≤ L2, L ≥ H) → [string]
function levelOrderWarnings(paramKey, specs, scenarios = allScenarioThresholds()) {
  const out = [];
  for (const s of scenarios) {
    const t = byParamKey(s.thresholds)[paramKey];
    const v = {};
    for (const [lvl, spec] of Object.entries(specs)) {
      if (spec && LEVELS[lvl]) v[lvl] = refValue({ bound: LEVELS[lvl].bound, mode: spec.mode, amount: spec.amount }, t);
    }
    const bad = [];
    if (v.h1 != null && v.h2 != null && v.h1 >= v.h2) bad.push('H1 ต้อง < H2');
    if (v.l1 != null && v.l2 != null && v.l1 <= v.l2) bad.push('L1 ต้อง > L2');
    const lo = v.l1 ?? v.l2, hi = v.h1 ?? v.h2;
    if (lo != null && hi != null && lo >= hi) bad.push('ระดับ L ต้องต่ำกว่าระดับ H');
    if (bad.length) out.push(`${s.name}: ${bad.join(', ')}`);
  }
  return out;
}

// Clip-ids used by Event Classes that BellBeast does not list yet → shaped as BellBeast
// App_Data/audio/vocab.json entries ({id, text}) so an admin can paste them in and record/TTS.
function clipsNeeded(items, vocab) {
  const known = new Set((vocab?.clips || []).map(c => c.id));
  const local = Object.fromEntries((localVocabulary().clips || []).map(c => [c.id, c.text]));
  const out = new Map();
  for (const it of items) {
    const toks = it.audio_mode === 'A' ? (it.message_template || []).slice(0, 1) : (it.message_template || []);
    for (const tok of toks) {
      if (isPlaceholder(tok) || !CLIP_RE.test(tok) || known.has(tok)) continue;
      const e = out.get(tok) || {
        id: tok,
        text: it.audio_mode === 'A' ? it.fallback_text : (UNIT_TEXT[tok] || local[tok] || (tok.startsWith('s_lab_') ? it.title : null)),
        group: it.audio_mode === 'A' ? 'sentence' : undefined,
        used_by: [],
      };
      e.used_by.push(it.event_class_id);
      out.set(tok, e);
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ── CAR from an alarm occurrence (P3) — same field shape as POST /api/car ──
const OP_TH = { '>': 'สูงกว่าเกณฑ์', '>=': 'ถึง/สูงกว่าเกณฑ์', '<': 'ต่ำกว่าเกณฑ์', '<=': 'ถึง/ต่ำกว่าเกณฑ์', '==': 'เท่ากับค่าที่กำหนด', '!=': 'ไม่เท่ากับค่าที่กำหนด' };
const fmt = (v) => (v == null ? '—' : String(Math.round(v * 1000) / 1000));

function carDraftFromOccurrence(rawItem, occ) {
  // เกณฑ์ ณ ตอนเกิด (เก็บไว้ใน occurrence) มาก่อน — สลับสถานการณ์ภายหลังต้องไม่ทำให้ CAR ได้เกณฑ์ผิด
  // แถวเก่าที่ยังไม่มีค่านี้ → ใช้ค่าของสถานการณ์ที่ active ตอนออก CAR แบบเดิม
  let item = rawItem;
  if (occ.threshold_value != null || occ.scenario_id != null) {
    const { ref, ...rule } = rawItem.rule || {};
    item = { ...rawItem, rule: { ...rule, value: occ.threshold_value ?? rawItem.rule?.value ?? null }, scenario_id: occ.scenario_id };
  } else if (rawItem.rule?.ref) {
    const active = getActiveScenario();
    const resolved = resolveItem(rawItem, byParamKey(active?.thresholds));
    item = { ...(resolved || { ...rawItem, rule: { ...rawItem.rule, value: null } }), scenario_id: active?.row?.id ?? null };
  }
  const r = item.rule || {};
  const unit = r.unit || occ.unit || '';
  const u = unit ? ` ${unit}` : '';
  const sm = item.source_metric;
  const value = occ.value_worst ?? occ.value_first;
  return {
    car_type: 'CAR', car_prefix: item.car_prefix || 'CQ', system_type: 'HACCP',
    issue_type: 'ผลิตภัณฑ์ที่ไม่เป็นไปตามข้อกำหนด',
    parameter_name: `${item.title || item.event_class_id} ${OP_TH[r.op] || ''} — ค่า ${fmt(value)}${u} (เกณฑ์ ${r.op} ${fmt(r.value)}${u})`,
    configparam_id: sm && typeof sm === 'object' ? sm.configparam_id : null,
    recorded_value: value,
    threshold_value: r.value,
    threshold_direction: r.op && r.op.startsWith('<') ? 'below' : 'above',
    scenario_id: item.scenario_id,
    station_code: item.zone,
    record_datetime: occ.since || occ.first_seen_at,
    notes: `แจ้งเตือนอัตโนมัติ Event Class ${item.event_class_id} · occurrence #${occ.id} · ${occ.severity || item.severity}`
      + ` · เริ่ม ${occ.since || occ.first_seen_at}${occ.cleared_at ? ` · กลับสู่ปกติ ${occ.cleared_at}` : ''}`,
  };
}

module.exports = {
  SEVERITIES, AUDIO_MODES, UI_TYPES, OPS, CAR_POLICIES, DEFAULT_PLACEHOLDERS, carDraftFromOccurrence,
  normalize, validate, rowToEc, ecToParams, metricKey,
  getMetricSchema, schemaCtx, getVocabulary, vocabCtx, clipsNeeded,
  LEVELS, REF_BOUNDS, REF_MODES, refValue, resolveItem, resolvedByScenario, activeThresholdsByKey,
  levelId, levelItem, levelOrderWarnings,
};
