// /api/chem-lab/* — Chemical lab QC workflow (bottle receipt, analysis, สคบ-14 memo, compensation cases)
// LabVenture = auth/role guard + actor stamp + spec/template enrichment + CAR draft/link.
// Data lives in Uroboros chemlab.db (LAB_* tables), reached via /api/chemlab/* on Uroboros (:8888).
// services.json chem_lab.mock = true → in-process mock (services/chemLabMock.js), same contract.
// Contract: handoff/chem_lab_backend_spec.md
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { getDb, nowTH } = require('../services/db');
const { attachActor, can, SCI_WRITE } = require('../services/actor');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const SERVER_DIR = path.join(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8'));
}
const labCfg = () => readJson('services.json').chem_lab || {};
const specCfg = () => readJson('lab_chem_spec.json');
const taskCfg = () => readJson('lab_case_tasks.json');

// role null = unrestricted (same rule as ROLE_PAGES)
const OFFSET_WRITE = new Set([null, 'operator']);

function guard(req, res, next) {
  if (req.method === 'GET') return next();
  const isOffset = req.method === 'POST' && /^\/cases\/\d+\/offsets(\/\d+\/void)?$/.test(req.path);
  const allowed = can(req.actor, isOffset ? OFFSET_WRITE : SCI_WRITE);
  if (!allowed) {
    return res.status(403).json({ error: isOffset ? 'เฉพาะ Operator เท่านั้นที่ตัดยอดชดเชยได้' : 'เฉพาะนักวิทยาศาสตร์เท่านั้นที่บันทึกได้' });
  }
  next();
}

// ── backend call (mock in-process | Uroboros HTTP) ─────────────────────────
async function callBackend(method, subPath, query, body, actor, ts) {
  const cfg = labCfg();
  if (cfg.mock) {
    return require('../services/chemLabMock').handle(cfg, SERVER_DIR, { method, path: subPath, query: query || {}, body, actor, ts });
  }
  const qs = new URLSearchParams(query || {}).toString();
  const url = `${cfg.base_url || 'http://localhost:443'}${cfg.prefix || '/api/chemlab'}${subPath}${qs ? `?${qs}` : ''}`;
  try {
    const r = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-LabVenture-Actor': encodeURIComponent(actor?.name || ''),
        'X-LabVenture-Role': actor?.role || '',
        'X-LabVenture-Ts': ts,
      },
      body: method === 'GET' ? undefined : JSON.stringify({ ...(body || {}), actor, ts }),
    });
    const data = await r.json().catch(() => ({ error: `Uroboros returned ${r.status}` }));
    return { status: r.status, body: data };
  } catch (err) {
    return { status: 502, body: { error: `Cannot reach Uroboros chemlab: ${err.message}` } };
  }
}

const send = (res, out) => res.status(out.status).json(out.body);

router.use(attachActor);

// ── served locally from config ─────────────────────────────────────────────
router.get('/spec', (req, res) => {
  try { res.json({ ok: true, ...specCfg(), case_tasks: taskCfg().tasks, mock: !!labCfg().mock }); }
  catch (e) { res.status(500).json({ error: `lab_chem_spec.json: ${e.message}` }); }
});

router.get('/me', (req, res) => {
  res.json({ ok: true, actor: req.actor, can_sci_write: can(req.actor, SCI_WRITE), can_offset: can(req.actor, OFFSET_WRITE) });
});

// Dropdown lists for the external-lab forms: lab names + document storage locations (shared by all users).
const OPTIONS_FILE = path.join(CONFIG_DIR, 'lab_ext_options.json');
const OPTION_KINDS = ['labs', 'doc_locations'];
function readOptions() {
  try {
    const o = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'));
    return Object.fromEntries(OPTION_KINDS.map(k => [k, Array.isArray(o[k]) ? o[k] : []]));
  } catch { return { labs: [], doc_locations: [] }; }
}

router.get('/options', (req, res) => res.json({ ok: true, ...readOptions() }));

router.use(guard);

router.post('/options/:kind', (req, res) => {
  const { kind } = req.params;
  if (!OPTION_KINDS.includes(kind)) return res.status(404).json({ error: 'unknown option list' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'ระบุชื่อ' });
  if (name.length > 200) return res.status(400).json({ error: 'ชื่อยาวเกินไป' });
  const opts = readOptions();
  if (!opts[kind].includes(name)) {
    opts[kind].push(name);
    fs.writeFileSync(OPTIONS_FILE, JSON.stringify(opts, null, 2), 'utf8');
  }
  res.json({ ok: true, ...opts, added: name });
});

// ── attempt: verdicts computed here from lab_chem_spec.json ────────────────
function evaluate(spec, body) {
  const values = {};
  const verdicts = {};
  const inhouse = body.test_source === 'inhouse';
  for (const p of spec.params) {
    const raw = body.values?.[p.key];
    if (raw === undefined || raw === null || raw === '') {
      if (inhouse) throw new Error(`กรอกค่า ${p.label_th} ให้ครบ (ทดสอบเอง)`);
      verdicts[p.key] = 'n/a';
      continue;
    }
    const v = Number(raw);
    if (!Number.isFinite(v)) throw new Error(`ค่า ${p.label_th} ไม่ใช่ตัวเลข`);
    values[p.key] = v;
    const low = p.min != null && v < p.min;
    const high = p.max != null && v > p.max;
    verdicts[p.key] = low || high ? 'fail' : 'pass';
  }
  if (!Object.keys(values).length) throw new Error('ต้องมีค่าผลวิเคราะห์อย่างน้อย 1 รายการ');
  if (inhouse && spec.params.some(p => p.with_temp) && (body.temp_c_rd === undefined || body.temp_c_rd === null || body.temp_c_rd === '')) {
    throw new Error('ระบุอุณหภูมิที่วัดความหนาแน่นสัมพัทธ์');
  }
  const key = spec.params.find(p => p.is_key);
  return {
    values,
    param_verdicts: verdicts,
    verdict: Object.values(verdicts).includes('fail') ? 'fail' : 'pass',
    key_param: key?.key || null,
    key_value: key ? values[key.key] ?? null : null,
    key_min: key?.min ?? null,
  };
}

// POST = new attempt · PUT .../:aid = correct an attempt (allowed until the final is chosen; needs reason)
router.post('/composites/:id/attempts', attemptWrite);
router.put('/composites/:id/attempts/:aid', attemptWrite);

async function attemptWrite(req, res) {
  const ts = nowTH();
  const comp = await callBackend('GET', `/composites/${req.params.id}`, {}, null, req.actor, ts);
  if (comp.status !== 200) return send(res, comp);
  const spec = specCfg().chemicals[comp.body.composite.chemical];
  if (!spec) return res.status(400).json({ error: `ไม่มีเกณฑ์ของ ${comp.body.composite.chemical} ใน lab_chem_spec.json` });
  // supplier COA is no longer recorded here (COA is a hard copy checked at receiving); old rows stay editable
  if (req.method === 'POST' && req.body?.test_source === 'supplier_coa') {
    return res.status(400).json({ error: 'ไม่รับผล COA ผู้ขายแล้ว — COA ตรวจตอนรับสารเคมี' });
  }
  let ev;
  try { ev = evaluate(spec, req.body || {}); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const body = {
    test_source: req.body.test_source,
    ext_lab: req.body.ext_lab, ext_report_no: req.body.ext_report_no, attachment_ref: req.body.attachment_ref,
    temp_c_rd: req.body.temp_c_rd === '' ? null : req.body.temp_c_rd ?? null,
    remark: req.body.remark,
    ...(req.method === 'PUT' ? { reason: req.body.reason } : {}),
    ...ev,
  };
  send(res, await callBackend(req.method, req.path, req.query, body, req.actor, ts));
}

// External lab result → becomes an attempt (test_source external_lab) on the composite that was sent out
router.post('/ext-sends/:sid/result', async (req, res) => {
  const ts = nowTH();
  const got = await callBackend('GET', `/ext-sends/${req.params.sid}`, {}, null, req.actor, ts);
  if (got.status !== 200) return send(res, got);
  const chemical = got.body.send?.composite?.chemical;
  const spec = specCfg().chemicals[chemical];
  if (!spec) return res.status(400).json({ error: `ไม่มีเกณฑ์ของ ${chemical} ใน lab_chem_spec.json` });
  let ev;
  try { ev = evaluate(spec, { ...req.body, test_source: 'external_lab' }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const body = {
    ext_lab: req.body.ext_lab, ext_report_no: req.body.ext_report_no, attachment_ref: req.body.attachment_ref,
    temp_c_rd: req.body.temp_c_rd === '' ? null : req.body.temp_c_rd ?? null,
    remark: req.body.remark,
    ...ev,
  };
  send(res, await callBackend('POST', req.path, req.query, body, req.actor, ts));
});

// ── final: attaches the task template (fail → Uroboros opens the case over case_scope/case_tickets; CAR is issued by a person, below) ─
router.put('/composites/:id/final', async (req, res) => {
  send(res, await callBackend('PUT', req.path, req.query, { ...req.body, task_template: taskCfg().tasks }, req.actor, nowTH()));
});

// CAR fields from the case's final attempt: value/threshold = key param when it failed,
// else the first failed param (above-max → 'above')
function carFromCase(c, comp, fa, ts) {
  const spec = specCfg().chemicals[comp.chemical] || { label: comp.chemical, params: [] };
  const failedParams = spec.params.filter(p => fa?.param_verdicts?.[p.key] === 'fail');
  const lead = failedParams.find(p => p.is_key) || failedParams[0];
  const leadValue = lead ? fa.values[lead.key] ?? null : null;
  const leadAbove = !!lead && lead.max != null && leadValue != null && leadValue > lead.max;
  const failed = failedParams.map(p => {
    const range = p.min != null && p.max != null ? `${p.min}–${p.max}` : p.min != null ? `≥ ${p.min}` : `≤ ${p.max}`;
    return `${p.label_th} ${fa.values[p.key]}${p.unit ? ` ${p.unit}` : ''} (เกณฑ์ ${range})`;
  });
  return {
    car_type: 'CAR', car_prefix: 'CQ', system_type: 'HACCP', issue_type: 'ผลิตภัณฑ์ที่ไม่เป็นไปตามข้อกำหนด',
    parameter_name: `คุณภาพสาร ${spec.label} ไม่ผ่านเกณฑ์ — ${c.company_name} ตัวอย่างวันที่ ${c.sample_date}: ${failed.join(', ') || 'ดูผลวิเคราะห์'}`,
    recorded_value: leadValue,
    threshold_value: lead ? (leadAbove ? lead.max : lead.min) ?? null : null,
    threshold_direction: leadAbove ? 'above' : 'below',
    record_datetime: ts,
    notes: `chem-lab case #${c.id} · composite #${comp.id} · ${comp.n_bottles} ขวด · ชดเชยแนะนำ ${c.suggested_kg} kg`,
  };
}

// ── CAR for a case: issued by a person through the normal CAR form (/car) ─────
// 1) draft → client opens the CAR form prefilled; user adds เลข CAR / ผู้รับ and issues it via POST /api/car
// 2) link  → CARLog posts the new car's unique_key back here
async function caseForCar(req, res) {
  const got = await callBackend('GET', `/cases/${req.params.id}`, {}, null, req.actor, nowTH());
  if (got.status !== 200) { send(res, got); return null; }
  const { case: c } = got.body;
  if (c.car_key) { res.status(409).json({ error: `เคสนี้ออก CAR แล้ว (${c.car_key})` }); return null; }
  if (c.status === 'cancelled') { res.status(409).json({ error: 'เคสถูกยกเลิกแล้ว — ออก CAR ไม่ได้' }); return null; }
  return got.body;
}

router.get('/cases/:id/car-draft', async (req, res) => {
  const body = await caseForCar(req, res);
  if (!body) return;
  res.json({ ok: true, draft: carFromCase(body.case, body.composite, body.final_attempt, nowTH()) });
});

router.post('/cases/:id/car', async (req, res) => {
  const carKey = req.body?.car_key;
  if (!carKey) return res.status(400).json({ error: 'ต้องระบุ car_key' });
  if (!getDb().get('SELECT id FROM car_log WHERE unique_key = ?', [carKey])) {
    return res.status(404).json({ error: `ไม่พบ CAR ${carKey}` });
  }
  if (!await caseForCar(req, res)) return;
  send(res, await callBackend('PATCH', `/cases/${req.params.id}`, {}, { car_key: carKey }, req.actor, nowTH()));
});

// ── สคบ-14 from the original Word form: .docx (Word) / .pdf (exported by Word) ─
router.get('/memos/:id/:fmt(docx|pdf)', async (req, res) => {
  const got = await callBackend('GET', `/memos/${req.params.id}`, {}, null, req.actor, nowTH());
  if (got.status !== 200) return send(res, got);
  const { memo, rows } = got.body;
  const spec = specCfg().chemicals[memo.chemical];
  if (!spec) return res.status(400).json({ error: `ไม่มีเกณฑ์ของ ${memo.chemical} ใน lab_chem_spec.json` });
  try {
    const { buildDocx, toPdf } = require('../services/memoDocx');
    const docx = await buildDocx(memo, rows, spec);
    const pdf = req.params.fmt === 'pdf';
    const name = `สคบ-14 ${memo.doc_no}`.replace(/[\\/:*?"<>|]/g, '_') + (pdf ? '.pdf' : '.docx');
    res.set('Content-Type', pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `${pdf ? 'inline' : 'attachment'}; filename="memo.${req.params.fmt}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(pdf ? await toPdf(docx) : docx);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── everything else: pass-through ──────────────────────────────────────────
router.all('*', async (req, res) => {
  const body = req.method === 'GET' ? null : req.body;
  send(res, await callBackend(req.method, req.path, req.query, body, req.actor, nowTH()));
});

module.exports = router;
