import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, post, put, patch, del } from '../api.js';
import { Section, Modal, ReasonModal, ErrorLine, Empty, btn, inputCls } from './chemlab/shared.jsx';
import { CAR_PREFIXES } from '../config/carPrefixes.js';

// /event-class — Event Class authoring (Re-plan Labventure_plan.md). Uroboros pulls the enabled set
// from GET /api/eventclass?enabled=true, evaluates rules against live/lab data and emits alarms.
// Server-side validation: server/services/eventClass.js (this page shows its errors/warnings live).
// Tab "เหตุการณ์" = episodes Uroboros reported active (services/alarmWatcher.js) + CAR follow-up per car_policy.

const SEVERITY = {
  info:     { label: 'info',     cls: 'bg-sky-100 text-sky-800' },
  warning:  { label: 'warning',  cls: 'bg-amber-100 text-amber-800' },
  critical: { label: 'critical', cls: 'bg-red-100 text-red-700' },
};
const OPS = ['>', '>=', '<', '<=', '==', '!='];
const UI_TYPES = ['value', 'status', 'map'];
// inputCls without w-full, for fixed-width toolbar controls
const ctlCls = inputCls.replace('w-full ', '');
// ตรงกับ Uroboros ClipResolver.FormatNumber: ทศนิยมคงที่ตาม decimals แต่ถ้าเป็น .00 ล้วนตัดทิ้ง (ไม่พูด)
function formatNumber(v, decimals) {
  const d = Number.isInteger(decimals) && decimals >= 0 && decimals <= 6 ? decimals : 2;
  let s = v.toFixed(d);
  if (s.includes('.') && /^0+$/.test(s.split('.')[1])) s = s.split('.')[0];
  return s === '-0' ? '0' : s;
}
const SAMPLE_VALUE = 1.4;
const SAMPLE_LIMIT = 1;
const sampleFor = (decimals) => ({
  '{value}': formatNumber(SAMPLE_VALUE, decimals), '{limit}': formatNumber(SAMPLE_LIMIT, decimals), '{unit}': 'NTU',
});

const EMPTY = {
  event_class_id: '', title: '', category: 'water_quality', severity: 'warning', zone: '',
  source_kind: 'lab_sample', configparam_id: '', metric: '',
  rule: { op: '>', value: '', unit: '', hysteresis: '0', for_polls: '1', max_age_min: '', decimals: '' },
  audio_mode: 'B', tokens: [], sentence: '', fallback_text: '',
  ui: { type: 'value', sparkline: false }, enabled: true, scenario_id: '',
  car_policy: 'suggest', car_prefix: 'CQ',
};

function toForm(item) {
  const sm = item.source_metric;
  const lab = sm && typeof sm === 'object';
  const tpl = item.message_template || [];
  const r = item.rule || {};
  return {
    ...EMPTY, ...item,
    title: item.title || '', category: item.category || '', zone: item.zone || '', fallback_text: item.fallback_text || '',
    source_kind: lab ? 'lab_sample' : 'realtime',
    configparam_id: lab ? String(sm.configparam_id ?? '') : '',
    metric: lab ? '' : (sm || ''),
    rule: {
      op: r.op || '>', value: String(r.value ?? ''), unit: r.unit || '', hysteresis: String(r.hysteresis ?? 0),
      for_polls: String(r.for_polls ?? 1), max_age_min: r.max_age_min == null ? '' : String(r.max_age_min),
      decimals: r.decimals == null ? '' : String(r.decimals),
      ref: r.ref ? { ...r.ref, amount: r.ref.mode === 'eq' ? '' : String(r.ref.amount) } : null,
    },
    param_key: item.param_key || '',
    tokens: item.audio_mode === 'B' ? tpl : [],
    sentence: item.audio_mode === 'A' ? (tpl[0] || '') : '',
    ui: { type: 'value', ...(item.ui || {}) },
    scenario_id: item.scenario_id == null ? '' : String(item.scenario_id),
  };
}

function toPayload(f) {
  return {
    event_class_id: f.event_class_id.trim(), title: f.title, category: f.category, severity: f.severity, zone: f.zone,
    source_metric: f.source_kind === 'lab_sample' ? { kind: 'lab_sample', configparam_id: f.configparam_id } : f.metric,
    rule: f.rule, audio_mode: f.audio_mode,
    message_template: f.audio_mode === 'A' ? (f.sentence.trim() ? [f.sentence.trim()] : []) : f.tokens,
    fallback_text: f.fallback_text, ui: f.ui, enabled: f.enabled, scenario_id: f.scenario_id,
    car_policy: f.car_policy, car_prefix: f.car_prefix, param_key: f.param_key,
  };
}

function metricLabel(sm, schema) {
  if (sm && typeof sm === 'object') {
    const m = schema?.lab?.find(x => x.configparam_id === sm.configparam_id);
    return m ? `${m.equipment_name || ''} · ${m.param_name || ''}` : `lab:${sm.configparam_id}`;
  }
  return sm || '—';
}

const CAR_POLICY = {
  none:    'ไม่ออก CAR (บันทึกเหตุการณ์อย่างเดียว)',
  suggest: 'เสนอให้ออก CAR — นักวิทย์ตัดสินใจ',
  auto:    'ออก CAR อัตโนมัติทันทีที่เกิดเหตุ',
};
const ruleText = (r) => `${r.op} ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.hysteresis ? ` ±${r.hysteresis}` : ''} ×${r.for_polls || 1}`;

export default function EventClassPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);   // null | 'new' | item
  const [q, setQ] = useState('');
  const [scenFilter, setScenFilter] = useState('');   // '' all | 'none' | scenario id
  const [levelsFor, setLevelsFor] = useState(null);   // null | '' (new) | param_key
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'occurrences' ? 'occurrences' : 'classes';
  const occQ = useQuery({ queryKey: ['eventclass', 'occurrences'], queryFn: () => get('/api/eventclass/occurrences?limit=200'), refetchInterval: 60_000 });
  const { data: scenarios } = useQuery({ queryKey: ['scenarios'], queryFn: () => get('/api/scenarios') });
  const { data: me } = useQuery({ queryKey: ['eventclass', 'me'], queryFn: () => get('/api/eventclass/me'), staleTime: 60_000 });
  const { data, isLoading, error } = useQuery({ queryKey: ['eventclass', 'list'], queryFn: () => get('/api/eventclass') });
  const schemaQ = useQuery({ queryKey: ['eventclass', 'schema'], queryFn: () => get('/api/eventclass/schema'), staleTime: 60_000, retry: false });
  const canWrite = !!me?.can_write;

  const toggle = useMutation({
    mutationFn: ({ id, enabled }) => patch(`/api/eventclass/${encodeURIComponent(id)}/enabled`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eventclass'] }),
  });

  const scenName = useMemo(() => Object.fromEntries((scenarios || []).map(s => [s.id, s.name])), [scenarios]);
  const activeId = data?.active_scenario_id ?? null;
  const inForce = (it) => it.enabled && (it.rule?.ref
    ? it.resolved?.[activeId] != null   // อ้างอิงเกณฑ์ → มีผลเมื่อสถานการณ์ที่ active มีเกณฑ์ข้างนั้น
    : (it.scenario_id == null || it.scenario_id === activeId));
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.items || [])
      .filter(it => scenFilter === '' || (scenFilter === 'none' ? it.scenario_id == null : String(it.scenario_id) === scenFilter))
      .filter(it => !s || [it.event_class_id, it.title, it.zone, it.category].some(v => (v || '').toLowerCase().includes(s)));
  }, [data, q, scenFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-earth-ink">Event Class · นิยามการแจ้งเตือน</h1>
          <p className="text-sm text-earth-ink2 mt-0.5">กำหนดสถานการณ์ที่ต้องเตือน + เกณฑ์ + ข้อความเสียง → Uroboros ดึงไปประเมินกับข้อมูลจริง → BellBeast ส่งไป device</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <UroborosStatus q={schemaQ} />
          {me?.actor && <span className="text-sm px-3 py-1.5 rounded-full border border-earth-border bg-earth text-earth-ink2">{me.actor.name}{me.actor.role ? ` · ${me.actor.role}` : ''}</span>}
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-earth-border">
        {[['classes', '🔔', 'นิยาม Event Class', 0], ['occurrences', '📜', 'เหตุการณ์ + CAR', occQ.data?.pending || 0]].map(([k, icon, label, badge]) => (
          <button key={k} onClick={() => setParams(k === 'classes' ? {} : { tab: k })}
            className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px flex items-center gap-1.5 ${
              tab === k ? 'border-teal-700 text-teal-800' : 'border-transparent text-earth-ink2 hover:text-earth-ink'}`}>
            <span>{icon}</span>{label}
            {badge > 0 && <span className="ml-1 min-w-5 px-1.5 rounded-full bg-red-600 text-white text-xs leading-5 text-center" title="รอตัดสินใจเรื่อง CAR">{badge}</span>}
          </button>
        ))}
      </nav>

      {tab === 'occurrences' && <Occurrences q={occQ} canWrite={canWrite} />}

      {tab === 'classes' && <>
      <Section
        title={`Event Class (${data?.items?.length ?? 0})`}
        subtitle={`มีผลตอนนี้ ${(data?.items || []).filter(inForce).length} รายการ — Uroboros ดึงเฉพาะที่เปิดใช้ และไม่ผูก scenario หรือผูกกับ scenario ที่ active (${scenName[activeId] || '—'})`}
        right={
          <div className="flex gap-2 flex-wrap">
            <select className={`${ctlCls} w-48`} value={scenFilter} onChange={e => setScenFilter(e.target.value)}>
              <option value="">ทุก scenario</option>
              <option value="none">ไม่ผูก scenario</option>
              {(scenarios || []).map(s => <option key={s.id} value={s.id}>{s.name}{s.id === activeId ? ' (active)' : ''}</option>)}
            </select>
            <input className={`${ctlCls} w-56`} placeholder="ค้นหา id / ชื่อ / zone" value={q} onChange={e => setQ(e.target.value)} />
            {canWrite && <button className={`${btn.ghost} whitespace-nowrap`} onClick={() => setLevelsFor('')}>ตั้ง alarm จากเกณฑ์</button>}
            {canWrite && <button className={`${btn.primary} whitespace-nowrap`} onClick={() => setEditing('new')}>+ สร้างใหม่</button>}
          </div>
        }
      >
        {(error || toggle.error) && <div className="px-5 pt-3"><ErrorLine error={error || toggle.error} /></div>}
        {isLoading ? <Empty>กำลังโหลด...</Empty> : items.length === 0 ? <Empty>ยังไม่มี Event Class</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-earth-card text-earth-ink2 text-left">
                <tr>
                  <th className="px-4 py-2">Event Class</th><th className="px-4 py-2">Scenario</th><th className="px-4 py-2">Zone</th><th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Source metric</th><th className="px-4 py-2">Rule</th><th className="px-4 py-2">เสียง</th>
                  <th className="px-4 py-2">เปิดใช้</th><th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.event_class_id} className={`border-t border-earth-border ${inForce(it) ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2">
                      <div className="font-semibold text-earth-ink flex items-center gap-1.5">
                        {inForce(it) && <span className="w-2 h-2 rounded-full bg-teal-600 shrink-0" title="มีผลตอนนี้ (Uroboros ดึงไปใช้)" />}
                        {it.title || it.event_class_id}
                      </div>
                      <div className="font-mono text-xs text-earth-ink3">{it.event_class_id}</div>
                    </td>
                    <td className="px-4 py-2 text-xs text-earth-ink2 whitespace-nowrap">{it.rule?.ref ? 'ตามสถานการณ์' : it.scenario_id == null ? 'ทุก scenario' : (scenName[it.scenario_id] || `#${it.scenario_id}`)}</td>
                    <td className="px-4 py-2 font-mono">{it.zone || '—'}</td>
                    <td className="px-4 py-2"><SeverityBadge s={it.severity} /></td>
                    <td className="px-4 py-2 text-earth-ink2">{metricLabel(it.source_metric, schemaQ.data)}</td>
                    <td className="px-4 py-2 font-mono">
                      {it.rule?.ref ? (
                        <button className="text-left hover:underline" disabled={!canWrite} onClick={() => setLevelsFor(it.param_key)} title="ตั้งระดับ alarm ของพารามิเตอร์นี้">
                          {it.rule.op} {refText(it.rule.ref)}
                          <span className="block text-xs text-earth-ink3">
                            {it.resolved?.[activeId] == null ? 'ไม่ทำงานในสถานการณ์นี้' : `ตอนนี้ = ${fmtV(it.resolved[activeId])}${it.rule.unit ? ` ${it.rule.unit}` : ''}`}
                          </span>
                        </button>
                      ) : ruleText(it.rule || {})}
                    </td>
                    <td className="px-4 py-2 text-xs text-earth-ink2">
                      <span className="font-bold mr-1">{it.audio_mode}</span>{(it.message_template || []).join(' · ')}
                    </td>
                    <td className="px-4 py-2">
                      <Switch on={it.enabled} disabled={!canWrite || toggle.isPending}
                        onChange={() => toggle.mutate({ id: it.event_class_id, enabled: !it.enabled })} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button className="text-teal-700 font-semibold hover:underline" onClick={() => setEditing(it)}>{canWrite ? 'แก้ไข' : 'ดู'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <ClipsNeeded />
      </>}

      {levelsFor !== null && (
        <LevelsModal items={data?.items || []} initialParam={levelsFor} onClose={() => setLevelsFor(null)}
          onDone={() => { qc.invalidateQueries({ queryKey: ['eventclass'] }); }} />
      )}

      {editing && (
        <EditorModal
          initial={editing === 'new' ? EMPTY : toForm(editing)}
          isNew={editing === 'new'}
          canWrite={canWrite}
          schema={schemaQ.data}
          onClose={() => setEditing(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['eventclass'] }); setEditing(null); }}
        />
      )}
    </div>
  );
}

function UroborosStatus({ q }) {
  if (q.isLoading) return null;
  const ok = q.data && !q.data.stale;
  return (
    <span title={q.error?.message || q.data?.error || ''}
      className={`text-xs font-bold px-3 py-1.5 rounded-full ${ok ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'}`}>
      {ok ? `Uroboros schema ✓ (${(q.data.lab?.length || 0) + (q.data.realtime?.length || 0)} metrics)` : 'Uroboros offline — ไม่ได้ตรวจ metric'}
    </span>
  );
}

const SeverityBadge = ({ s }) => {
  const v = SEVERITY[s] || SEVERITY.warning;
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${v.cls}`}>{v.label}</span>;
};

function Switch({ on, onChange, disabled }) {
  return (
    <button type="button" onClick={onChange} disabled={disabled} aria-pressed={on}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-teal-600 border-teal-600' : 'bg-gray-200 border-earth-border'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Field({ label, hint, issues, children, className = '' }) {
  return (
    <div className={`block ${className}`}>
      <span className="text-xs font-semibold text-earth-ink2">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs text-earth-ink3">{hint}</span>}
      {issues?.map((m, i) => <span key={i} className={`block text-xs ${m.error ? 'text-red-600 font-semibold' : 'text-amber-700'}`}>{m.msg}</span>)}
    </div>
  );
}

// ── editor ─────────────────────────────────────────────────────────────────
function EditorModal({ initial, isNew, canWrite, schema, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const [check, setCheck] = useState(null);
  const { data: vocab } = useQuery({ queryKey: ['eventclass', 'vocabulary'], queryFn: () => get('/api/eventclass/vocabulary'), staleTime: 300_000 });
  const { data: scenarios } = useQuery({ queryKey: ['scenarios'], queryFn: () => get('/api/scenarios') });
  const set = (patchObj) => setF(prev => ({ ...prev, ...patchObj }));
  const setRule = (patchObj) => setF(prev => ({ ...prev, rule: { ...prev.rule, ...patchObj } }));
  const payload = useMemo(() => toPayload(f), [f]);
  const placeholders = schema?.placeholders || ['{value}', '{limit}', '{unit}', '{title}'];
  const clipText = useMemo(() => Object.fromEntries((vocab?.clips || []).map(c => [c.id, c.text])), [vocab]);

  // live dry-run validation (debounced)
  useEffect(() => {
    const t = setTimeout(() => { post('/api/eventclass/validate', payload).then(setCheck).catch(() => setCheck(null)); }, 400);
    return () => clearTimeout(t);
  }, [payload]);

  const save = useMutation({
    mutationFn: () => isNew ? post('/api/eventclass', payload) : put(`/api/eventclass/${encodeURIComponent(f.event_class_id)}`, payload),
    onSuccess: onSaved,
  });
  const [confirmDel, setConfirmDel] = useState(false);
  const remove = useMutation({
    mutationFn: () => del(`/api/eventclass/${encodeURIComponent(f.event_class_id)}`),
    onSuccess: onSaved,
  });

  const issues = (field) => [
    ...(check?.errors || []).filter(e => e.field.startsWith(field)).map(e => ({ ...e, error: true })),
    ...(check?.warnings || []).filter(e => e.field.startsWith(field)),
  ];
  const nErr = check?.errors?.length || 0;

  // preview: tokens → spoken text using vocabulary text, placeholders with sample values
  const SAMPLE = sampleFor(f.rule.decimals === '' ? 2 : Number(f.rule.decimals));
  const spoken = f.audio_mode === 'A'
    ? (clipText[f.sentence] || f.fallback_text)
    : f.tokens.map(t => SAMPLE[t] ?? (t === '{title}' ? (f.title || '…') : clipText[t] ?? `[${t}]`)).join(' ');
  const fallbackFromTpl = f.tokens.map(t => (t.startsWith('{') ? t : clipText[t] ?? t)).join(' ');
  const fallbackPreview = f.fallback_text
    .replace('{value}', SAMPLE['{value}']).replace('{limit}', SAMPLE['{limit}'])
    .replace('{unit}', f.rule.unit || SAMPLE['{unit}']).replace('{title}', f.title || '…');

  const ro = !canWrite;
  return (
    <Modal title={isNew ? 'สร้าง Event Class' : `${canWrite ? 'แก้ไข' : 'ดู'} · ${f.event_class_id}`} onClose={onClose} wide>
      <fieldset disabled={ro} className="p-5 space-y-5">
        {/* identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="event_class_id *" hint={isNew ? 'a-z 0-9 _ — แก้ทีหลังไม่ได้' : 'แก้ไม่ได้'} issues={issues('event_class_id')}>
            <input className={`${inputCls} font-mono`} value={f.event_class_id} disabled={!isNew}
              onChange={e => set({ event_class_id: e.target.value.toLowerCase() })} placeholder="raw_water_high_turbidity" />
          </Field>
          <Field label="ชื่อที่แสดง (title)" hint="ใช้เป็น {title} และหัวข้อ overlay">
            <input className={inputCls} value={f.title} onChange={e => set({ title: e.target.value })} placeholder="ความขุ่นน้ำดิบสูง" />
          </Field>
          <Field label="Zone" hint="BellBeast route ไป device ตาม zone" issues={issues('zone')}>
            <input className={`${inputCls} font-mono`} value={f.zone} onChange={e => set({ zone: e.target.value.toUpperCase() })} placeholder="RWS" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Severity" issues={issues('severity')}>
              <select className={inputCls} value={f.severity} onChange={e => set({ severity: e.target.value })}>
                {Object.keys(SEVERITY).map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <input className={inputCls} value={f.category} onChange={e => set({ category: e.target.value })} />
            </Field>
          </div>
        </div>

        {/* source + rule */}
        <div className="rounded-xl border border-earth-border p-4 space-y-3">
          <h4 className="font-bold text-earth-ink">ข้อมูลต้นทาง + เกณฑ์</h4>
          <div className="flex gap-4 text-sm">
            {[['lab_sample', 'ผลแล็บ (lab sample)'], ['realtime', 'Realtime stream']].map(([k, l]) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="radio" checked={f.source_kind === k} onChange={() => set({ source_kind: k })} />{l}
              </label>
            ))}
          </div>
          <Field label="source_metric *" issues={issues('source_metric')}
            hint={f.source_kind === 'lab_sample' ? 'Uroboros ประเมิน rule ทุกครั้งที่มีผลแล็บใหม่ (for_polls = จำนวนตัวอย่างติดกัน)' : 'stream.param จาก metrics_current'}>
            {f.source_kind === 'lab_sample'
              ? (schema?.lab?.length
                ? <select className={inputCls} value={f.configparam_id} onChange={e => {
                    const m = schema.lab.find(x => String(x.configparam_id) === e.target.value);
                    set({ configparam_id: e.target.value, rule: { ...f.rule, unit: f.rule.unit || m?.unit || '' } });
                  }}>
                    <option value="">— เลือก parameter —</option>
                    {schema.lab.map(m => <option key={m.configparam_id} value={m.configparam_id}>{m.configparam_id} · {m.equipment_name} · {m.param_name}{m.unit ? ` (${m.unit})` : ''}</option>)}
                  </select>
                : <input className={`${inputCls} font-mono`} value={f.configparam_id} onChange={e => set({ configparam_id: e.target.value })} placeholder="configparam_id เช่น 101" />)
              : (<>
                  <input className={`${inputCls} font-mono`} list="ec-realtime" value={f.metric} onChange={e => set({ metric: e.target.value })} placeholder="RWS.turbidity" />
                  <datalist id="ec-realtime">{(schema?.realtime || []).map(m => <option key={m.source_metric} value={m.source_metric}>{m.unit || ''}</option>)}</datalist>
                </>)}
          </Field>
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-3">
            <Field label="op" issues={issues('rule.op')}>
              <select className={`${inputCls} font-mono`} value={f.rule.op} onChange={e => setRule({ op: e.target.value })}>{OPS.map(o => <option key={o}>{o}</option>)}</select>
            </Field>
            {f.rule.ref ? (
              <Field label={`อ้างอิง ${f.rule.ref.bound}`} issues={[...issues('rule.ref'), ...issues('param_key')]} className="sm:col-span-2">
                <div className="flex gap-1">
                  <select className={inputCls} value={f.rule.ref.mode} onChange={e => setRule({ ref: { ...f.rule.ref, mode: e.target.value } })}>
                    {Object.entries(REF_MODES).map(([k, l]) => <option key={k} value={k}>{l.replace('เกณฑ์', f.rule.ref.bound)}</option>)}
                  </select>
                  {f.rule.ref.mode !== 'eq' && (
                    <input className={`${inputCls} w-20`} inputMode="decimal" value={f.rule.ref.amount} onChange={e => setRule({ ref: { ...f.rule.ref, amount: e.target.value.trim() } })} />
                  )}
                </div>
              </Field>
            ) : (
              <Field label="value *" issues={issues('rule.value')}><input className={inputCls} inputMode="decimal" value={f.rule.value} onChange={e => setRule({ value: e.target.value })} /></Field>
            )}
            <Field label="unit"><input className={inputCls} value={f.rule.unit} onChange={e => setRule({ unit: e.target.value })} /></Field>
            <Field label="hysteresis" issues={issues('rule.hysteresis')}><input className={inputCls} inputMode="decimal" value={f.rule.hysteresis} onChange={e => setRule({ hysteresis: e.target.value })} /></Field>
            <Field label="for_polls" issues={issues('rule.for_polls')}><input className={inputCls} inputMode="numeric" value={f.rule.for_polls} onChange={e => setRule({ for_polls: e.target.value })} /></Field>
            <Field label="max_age_min" hint="ว่าง = 480" issues={issues('rule.max_age_min')}><input className={inputCls} inputMode="numeric" value={f.rule.max_age_min} onChange={e => setRule({ max_age_min: e.target.value })} /></Field>
            <Field label="decimals" hint="ว่าง = 2 · .00 ไม่พูด" issues={issues('rule.decimals')}><input className={inputCls} inputMode="numeric" value={f.rule.decimals} onChange={e => setRule({ decimals: e.target.value })} /></Field>
          </div>
          {f.rule.ref ? (
            <p className="text-xs text-earth-ink2">
              alarm ระดับนี้อ้างอิงเกณฑ์ควบคุมของ <b>{f.param_key}</b> — ค่าจริงเปลี่ยนตามสถานการณ์ที่ active (ไม่ต้องผูก scenario)
              {f.resolved && <> · {(scenarios || []).map(s => `${s.name} ${f.resolved[s.id] == null ? '—' : fmtV(f.resolved[s.id])}`).join(' · ')}</>}
            </p>
          ) : (
            <Field label="ผูกกับ scenario (ถ้ามี)" issues={issues('scenario_id')}>
              <select className={inputCls} value={f.scenario_id} onChange={e => set({ scenario_id: e.target.value })}>
                <option value="">— ทุก scenario —</option>
                {(scenarios || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
        </div>

        {/* audio */}
        <div className="rounded-xl border border-earth-border p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="font-bold text-earth-ink">ข้อความเสียง</h4>
            <div className="flex gap-4 text-sm">
              {[['B', 'B · ต่อคำ (ใส่ตัวเลขได้)'], ['A', 'A · ทั้งประโยค (คลิปเดียว)']].map(([k, l]) => (
                <label key={k} className="flex items-center gap-1.5"><input type="radio" checked={f.audio_mode === k} onChange={() => set({ audio_mode: k })} />{l}</label>
              ))}
            </div>
          </div>
          {f.audio_mode === 'B'
            ? <TokenBuilder tokens={f.tokens} onChange={tokens => set({ tokens })} vocab={vocab} placeholders={placeholders} clipText={clipText} issues={issues('message_template')} />
            : <Field label="clip-id ของประโยค *" issues={issues('message_template')}
                hint="ประโยคเต็มใส่ใน fallback_text ด้านล่าง — BellBeast TTS จากข้อความนั้นแล้ว cache ไว้ใต้ clip-id นี้ (ใส่ {placeholder} ไม่ได้)">
                <input className={`${inputCls} font-mono`} list="ec-sentences" value={f.sentence}
                  onChange={e => set({ sentence: e.target.value.toLowerCase() })} placeholder="pump_trip_hall1" />
                <datalist id="ec-sentences">{(vocab?.clips || []).filter(c => c.group === 'sentence').map(c => <option key={c.id} value={c.id}>{c.text}</option>)}</datalist>
              </Field>}
          <div className="rounded-lg bg-earth-card px-3 py-2 text-sm">
            <span className="text-xs font-semibold text-earth-ink2">ตัวอย่างเสียง (value = {SAMPLE['{value}']}): </span>
            <span className="text-earth-ink">{spoken || '—'}</span>
          </div>
          <Field label="fallback_text" hint={`ใช้เมื่อ device เล่นคลิปไม่ได้ · placeholder: ${placeholders.join(' ')}`} issues={issues('fallback_text')}>
            <div className="flex gap-2">
              <input className={inputCls} value={f.fallback_text} onChange={e => set({ fallback_text: e.target.value })} />
              {f.audio_mode === 'B' && f.tokens.length > 0 &&
                <button type="button" className={`${btn.ghost} whitespace-nowrap`} onClick={() => set({ fallback_text: fallbackFromTpl })}>สร้างจาก template</button>}
            </div>
          </Field>
          {f.fallback_text && <p className="text-xs text-earth-ink2">แสดงผล: <span className="text-earth-ink">{fallbackPreview}</span></p>}
        </div>

        {/* ui */}
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Overlay (ui.type)" issues={issues('ui.type')}>
            <select className={inputCls} value={f.ui.type} onChange={e => set({ ui: { ...f.ui, type: e.target.value } })}>{UI_TYPES.map(t => <option key={t}>{t}</option>)}</select>
          </Field>
          {f.ui.type === 'value' && (
            <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={!!f.ui.sparkline} onChange={e => set({ ui: { ...f.ui, sparkline: e.target.checked } })} />sparkline</label>
          )}
          <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={f.enabled} onChange={e => set({ enabled: e.target.checked })} />เปิดใช้งาน</label>
        </div>

        {/* CAR follow-up when the class fires (P3) */}
        <div className="rounded-xl border border-earth-border p-4 space-y-3">
          <h4 className="font-bold text-earth-ink">เมื่อเกิดเหตุ → CAR</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="นโยบาย CAR" className="sm:col-span-2" issues={issues('car_policy')}
              hint={f.car_policy === 'auto' ? 'ออกเลข CAR + แจ้ง LINE ทันที โดยไม่มีผู้รับ — ผู้ดูแล CAR ต้องกำหนดผู้รับภายหลัง' : 'ทุกเหตุการณ์จะอยู่ในแท็บ "เหตุการณ์ + CAR"'}>
              <select className={inputCls} value={f.car_policy} onChange={e => set({ car_policy: e.target.value })}>
                {Object.entries(CAR_POLICY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="รหัสเลข CAR" issues={issues('car_prefix')}>
              <select className={inputCls} value={f.car_prefix} disabled={f.car_policy === 'none'} onChange={e => set({ car_prefix: e.target.value })}>
                {CAR_PREFIXES.map(([p, d]) => <option key={p} value={p} title={d}>{p} · {d}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </fieldset>

      <div className="px-5 py-4 border-t border-earth-border flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs">
          {check && (nErr
            ? <span className="text-red-600 font-semibold">ผิด {nErr} จุด — แก้ก่อนบันทึก</span>
            : <span className="text-teal-700 font-semibold">ผ่านการตรวจ{check.warnings?.length ? ` · คำเตือน ${check.warnings.length}` : ''}</span>)}
          <ErrorLine error={save.error || remove.error} />
        </div>
        <div className="flex gap-2">
          {canWrite && !isNew && (confirmDel
            ? <button className={btn.danger} disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? 'กำลังลบ...' : 'ยืนยันลบ'}</button>
            : <button className={btn.ghost} onClick={() => setConfirmDel(true)}>ลบ</button>)}
          <button className={btn.ghost} onClick={onClose}>{canWrite ? 'ยกเลิก' : 'ปิด'}</button>
          {canWrite && <button className={btn.primary} disabled={nErr > 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'กำลังบันทึก...' : 'บันทึก'}</button>}
        </div>
      </div>
    </Modal>
  );
}

const GROUP_LABEL = { point: 'จุด/สถานที่', word: 'คำ', unit: 'หน่วย', number: 'ตัวเลข', sentence: 'ประโยค (A)' };
const VOCAB_SOURCE = {
  bellbeast: { label: 'คลังเสียง BellBeast', cls: 'bg-teal-100 text-teal-800' },
  cache:     { label: 'BellBeast (cache — offline)', cls: 'bg-amber-100 text-amber-800' },
  local:     { label: 'ไฟล์ seed ในเครื่อง (BellBeast offline)', cls: 'bg-amber-100 text-amber-800' },
  none:      { label: 'ไม่มีคลังเสียง', cls: 'bg-red-100 text-red-700' },
};

// audio_mode B: ordered list of clip-ids + {placeholder}; picks from the clip library so typos are rare
function TokenBuilder({ tokens, onChange, vocab, placeholders, clipText, issues }) {
  const [pick, setPick] = useState('');
  const [browse, setBrowse] = useState(false);
  const add = (t) => { const v = t.trim().toLowerCase(); if (v) onChange([...tokens, v]); setPick(''); };
  const move = (i, d) => { const n = [...tokens]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  const clips = vocab?.clips || [];
  const byId = useMemo(() => Object.fromEntries(clips.map(c => [c.id, c])), [clips]);
  const groups = useMemo(() => {
    const s = pick.trim().toLowerCase();
    const g = {};
    for (const c of clips) {
      if (c.group === 'sentence') continue;
      if (s && !c.id.includes(s) && !(c.text || '').toLowerCase().includes(s)) continue;
      (g[c.group || 'word'] ||= []).push(c);
    }
    const order = Object.keys(GROUP_LABEL);
    return Object.entries(g).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  }, [clips, pick]);
  const src = VOCAB_SOURCE[vocab?.source] || VOCAB_SOURCE.none;

  const chipCls = (t) => {
    if (t.startsWith('{')) return 'bg-violet-50 border-violet-200 text-violet-800';
    const c = byId[t];
    if (!c) return 'bg-red-50 border-red-300 text-red-700';                                 // not in library
    if (vocab?.strict && !c.present) return 'bg-amber-50 border-amber-300 text-amber-800'; // listed, no audio file yet
    return 'bg-teal-50 border-teal-200 text-teal-900';
  };

  return (
    <Field label="message_template * (เรียงตามลำดับเสียง)" issues={issues}>
      <div className="flex flex-wrap gap-1.5 min-h-10 p-2 rounded-lg border border-earth-border bg-white/60">
        {tokens.length === 0 && <span className="text-sm text-earth-ink3">ยังไม่มี token</span>}
        {tokens.map((t, i) => (
          <span key={i} title={clipText[t] || ''} className={`inline-flex items-center gap-1 text-xs font-mono pl-2 pr-1 py-1 rounded-md border ${chipCls(t)}`}>
            {t}
            <button type="button" className="px-1 hover:text-earth-ink" onClick={() => move(i, -1)} aria-label="เลื่อนซ้าย">‹</button>
            <button type="button" className="px-1 hover:text-earth-ink" onClick={() => move(i, 1)} aria-label="เลื่อนขวา">›</button>
            <button type="button" className="px-1 hover:text-red-600" onClick={() => onChange(tokens.filter((_, k) => k !== i))} aria-label="ลบ">×</button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <input className={`${inputCls} font-mono flex-1 min-w-48`} value={pick} placeholder="ค้นหาคำ / clip-id (Enter = เพิ่มตามที่พิมพ์)"
          onFocus={() => setBrowse(true)}
          onChange={e => { setPick(e.target.value); setBrowse(true); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(pick); } }} />
        <button type="button" className={btn.ghost} onClick={() => setBrowse(b => !b)}>{browse ? 'ซ่อนคลังเสียง' : 'เปิดคลังเสียง'}</button>
        {placeholders.map(p => <button key={p} type="button" className="px-3 py-2 text-xs font-mono rounded-lg bg-violet-50 text-violet-800 border border-violet-200 hover:bg-violet-100" onClick={() => add(p)}>{p}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-earth-ink2">
        <span className={`font-bold px-2 py-0.5 rounded-full ${src.cls}`} title={vocab?.error || ''}>{src.label}</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-teal-200 mr-1" />มีไฟล์เสียง</span>
        {vocab?.strict && <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-200 mr-1" />มีในรายการแต่ยังไม่อัด/TTS</span>}
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-200 mr-1" />ไม่มีในคลัง</span>
      </div>
      {browse && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-earth-border bg-white/60 p-2 space-y-2">
          {groups.length === 0 && <p className="text-sm text-earth-ink3 px-1">ไม่พบคำที่ค้นหา — กด Enter เพื่อใช้ "{pick}" (ต้องให้ admin เพิ่มใน BellBeast ก่อนเปิดใช้)</p>}
          {groups.map(([g, list]) => (
            <div key={g}>
              <div className="text-xs font-semibold text-earth-ink3 mb-1">{GROUP_LABEL[g] || g} ({list.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {list.map(c => (
                  <button key={c.id} type="button" onClick={() => add(c.id)} title={c.id}
                    className={`text-xs px-2 py-1 rounded-md border hover:shadow-sm ${vocab?.strict && !c.present ? 'bg-amber-50 border-amber-200' : 'bg-teal-50 border-teal-200'}`}>
                    <span className="text-earth-ink">{c.text || c.id}</span>
                    <span className="font-mono text-earth-ink3 ml-1">{c.id}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Field>
  );
}

// clip-ids referenced by Event Classes but missing from BellBeast — formatted for its App_Data/audio/vocab.json
function ClipsNeeded() {
  const [copied, setCopied] = useState(false);
  const { data } = useQuery({ queryKey: ['eventclass', 'clips-needed'], queryFn: () => get('/api/eventclass/clips-needed') });
  if (!data?.needed?.length) return null;
  const json = JSON.stringify(data.vocab, null, 2);
  async function copy() {
    try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }
  return (
    <Section title={`คลิปเสียงที่ยังไม่มีใน BellBeast (${data.needed.length})`}
      subtitle={data.vocabulary_source === 'bellbeast'
        ? 'ส่งรายการนี้ให้ admin BellBeast เพิ่มใน App_Data/audio/vocab.json แล้วอัดเสียง/TTS — Event Class ที่ใช้คำเหล่านี้จะเปิดใช้ได้หลังจากนั้น'
        : 'BellBeast offline — รายการนี้เทียบกับคลังสำรอง อาจไม่ตรงกับของจริง'}
      right={<button className={btn.ghost} onClick={copy}>{copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก vocab.json'}</button>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-earth-card text-earth-ink2 text-left">
            <tr><th className="px-4 py-2">clip-id</th><th className="px-4 py-2">ข้อความที่ต้องพูด (แนะนำ)</th><th className="px-4 py-2">ใช้ใน</th></tr>
          </thead>
          <tbody>
            {data.needed.map(n => (
              <tr key={n.id} className="border-t border-earth-border">
                <td className="px-4 py-2 font-mono">{n.id}</td>
                <td className="px-4 py-2">{n.text || <span className="text-earth-ink3">— ต้องระบุ —</span>}</td>
                <td className="px-4 py-2 font-mono text-xs text-earth-ink2">{n.used_by.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── alarm levels L2/L1/H1/H2 ของพารามิเตอร์เดียว — อ้างอิง LCL/UCL ของสถานการณ์ที่ active ─────────
// ตั้งครั้งเดียว ค่าจริงเปลี่ยนตามสถานการณ์เอง (server แปลงตอน Uroboros ดึง: GET /api/eventclass?enabled=true)
const LEVELS = [
  { key: 'h2', label: 'H2', bound: 'UCL', op: '>', severity: 'critical', dflt: { mode: 'eq', amount: '' } },
  { key: 'h1', label: 'H1', bound: 'UCL', op: '>', severity: 'warning',  dflt: { mode: 'pct', amount: '90' } },
  { key: 'l1', label: 'L1', bound: 'LCL', op: '<', severity: 'warning',  dflt: { mode: 'pct', amount: '110' } },
  { key: 'l2', label: 'L2', bound: 'LCL', op: '<', severity: 'critical', dflt: { mode: 'eq', amount: '' } },
];
const REF_MODES = { eq: '= เกณฑ์', pct: '% ของเกณฑ์', offset: 'เกณฑ์ ± ค่า', abs: 'ค่าตายตัว' };
const slugKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const round6 = (v) => Math.round(v * 1e6) / 1e6;
// ตรงกับ server/services/eventClass.js refValue
function refValue(ref, t) {
  if (!ref) return null;
  const amount = Number(ref.amount);
  const noAmount = ref.amount === '' || ref.amount == null || !Number.isFinite(amount);
  if (ref.mode === 'abs') return noAmount ? null : amount;
  const base = t ? (ref.bound === 'UCL' ? t.max : t.min) : null;
  if (base === null || base === undefined) return null;
  if (ref.mode === 'eq') return Number(base);
  if (noAmount) return null;
  if (ref.mode === 'pct') return round6(base * amount / 100);
  if (ref.mode === 'offset') return round6(base + amount);
  return null;
}
function refText(ref) {
  const a = Number(ref.amount);
  if (ref.mode === 'eq') return ref.bound;
  if (ref.mode === 'pct') return `${ref.amount}% ${ref.bound}`;
  if (ref.mode === 'offset') return `${ref.bound} ${a >= 0 ? '+' : '−'} ${Math.abs(a)}`;
  return String(ref.amount);
}
const fmtV = (v) => (v === null || v === undefined ? '—' : String(round6(v)));

function LevelsModal({ items, initialParam, onClose, onDone }) {
  const { data: scenTh } = useQuery({ queryKey: ['scenario-thresholds'], queryFn: () => get('/api/scenarios/thresholds') });
  const { data: nodesConfig } = useQuery({ queryKey: ['nodes-config'], queryFn: () => get('/api/config/nodes') });
  const [paramKey, setParamKey] = useState(initialParam || '');
  const [levels, setLevels] = useState({});
  const [enabled, setEnabled] = useState(true);
  const [result, setResult] = useState(null);

  const paramInfo = useMemo(() => {
    const idx = {};
    for (const n of nodesConfig?.nodes || []) for (const p of n.parameters || []) idx[p.param_key] = { ...p, node_label: n.label };
    return idx;
  }, [nodesConfig]);
  // พารามิเตอร์ที่มีเกณฑ์อย่างน้อย 1 สถานการณ์ เรียงตาม nodes.json
  const paramOptions = useMemo(() => {
    const has = new Set((scenTh || []).flatMap(s => s.thresholds.map(t => t.param_key)));
    const order = Object.keys(paramInfo);
    return [...has].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [scenTh, paramInfo]);

  // โหลดระดับที่ตั้งไว้แล้วของพารามิเตอร์นี้ (ยังไม่เคยตั้ง = ค่าเริ่มต้น)
  useEffect(() => {
    if (!paramKey || !scenTh) return;
    const next = {};
    let anyExisting = false;
    for (const L of LEVELS) {
      const it = items.find(x => x.event_class_id === `${slugKey(paramKey)}_${L.key}`);
      if (it?.rule?.ref) {
        anyExisting = true;
        next[L.key] = { on: true, mode: it.rule.ref.mode, amount: it.rule.ref.mode === 'eq' ? '' : String(it.rule.ref.amount), severity: it.severity };
      } else {
        next[L.key] = { on: false, ...L.dflt, severity: L.severity };
      }
    }
    if (!anyExisting) {
      // เปิดระดับของฝั่งที่มีเกณฑ์ในบางสถานการณ์
      const ts = scenTh.map(s => s.thresholds.find(t => t.param_key === paramKey)).filter(Boolean);
      if (ts.some(t => t.max != null)) { next.h2.on = true; next.h1.on = true; }
      if (ts.some(t => t.min != null)) { next.l2.on = true; next.l1.on = true; }
    }
    setLevels(next);
    setResult(null);
  }, [paramKey, items, scenTh]);

  const setLv = (k, patchObj) => { setResult(null); setLevels(prev => ({ ...prev, [k]: { ...prev[k], ...patchObj } })); };

  const rows = (scenTh || []).map(s => {
    const t = s.thresholds.find(x => x.param_key === paramKey);
    const v = Object.fromEntries(LEVELS.map(L => [L.key, levels[L.key]?.on ? refValue({ bound: L.bound, ...levels[L.key] }, t) : undefined]));
    const bad = [];
    if (v.h1 != null && v.h2 != null && v.h1 >= v.h2) bad.push('H1 ≥ H2');
    if (v.l1 != null && v.l2 != null && v.l1 <= v.l2) bad.push('L1 ≤ L2');
    const lo = v.l1 ?? v.l2;
    const hi = v.h1 ?? v.h2;
    if (lo != null && hi != null && lo >= hi) bad.push('L ≥ H');
    return { s, t, v, bad };
  });
  const missingAmount = LEVELS.some(L => {
    const lv = levels[L.key];
    return lv?.on && lv.mode !== 'eq' && (lv.amount === '' || !Number.isFinite(Number(lv.amount)));
  });
  const nOn = LEVELS.filter(L => levels[L.key]?.on).length;
  const nExisting = LEVELS.filter(L => items.some(x => x.event_class_id === `${slugKey(paramKey)}_${L.key}`)).length;
  const unit = paramInfo[paramKey]?.unit || '';

  const run = useMutation({
    mutationFn: () => post('/api/eventclass/levels', {
      param_key: paramKey, enabled,
      levels: Object.fromEntries(LEVELS.map(L => {
        const lv = levels[L.key];
        return [L.key, lv?.on ? { mode: lv.mode, amount: lv.mode === 'eq' ? 0 : Number(lv.amount), severity: lv.severity } : null];
      })),
    }),
    onSuccess: (r) => { setResult(r); onDone(); },
  });

  return (
    <Modal title="ตั้ง alarm จากเกณฑ์ควบคุม" onClose={onClose} wide>
      <div className="p-5 space-y-4">
        <p className="text-sm text-earth-ink2">
          ตั้งระดับเตือนครั้งเดียวต่อพารามิเตอร์ แต่ละระดับอ้างอิง <b>UCL / LCL</b> จากหน้า config → สถานการณ์
          — เปลี่ยนสถานการณ์เมื่อไร ค่า alarm ที่ Uroboros ใช้ก็เปลี่ยนตามเอง · สถานการณ์ที่ไม่มีเกณฑ์ข้างนั้น ระดับนั้นจะไม่ทำงาน
        </p>
        <Field label="พารามิเตอร์ (เฉพาะที่มีเกณฑ์อย่างน้อย 1 สถานการณ์)">
          <select className={inputCls} value={paramKey} onChange={e => setParamKey(e.target.value)}>
            <option value="">— เลือก —</option>
            {paramOptions.map(k => (
              <option key={k} value={k}>{k} · {paramInfo[k]?.node_label || ''} {paramInfo[k]?.label || ''}{paramInfo[k]?.unit ? ` (${paramInfo[k].unit})` : ''}</option>
            ))}
          </select>
        </Field>

        {paramKey && levels.h2 && <>
          <div className="border border-earth-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-earth-card text-earth-ink2 text-xs text-left">
                <tr>
                  <th className="px-3 py-2 w-20">ระดับ</th><th className="px-3 py-2">วิธีคำนวณ</th><th className="px-3 py-2 w-24">ค่า</th>
                  <th className="px-3 py-2 w-32">Severity</th><th className="px-3 py-2">สรุป</th>
                </tr>
              </thead>
              <tbody>
                {LEVELS.map(L => {
                  const lv = levels[L.key];
                  return (
                    <tr key={L.key} className={`border-t border-earth-border ${lv.on ? '' : 'opacity-50'}`}>
                      <td className="px-3 py-1.5">
                        <label className="flex items-center gap-2 font-bold text-earth-ink">
                          <input type="checkbox" checked={lv.on} onChange={e => setLv(L.key, { on: e.target.checked })} />{L.label}
                        </label>
                      </td>
                      <td className="px-3 py-1.5">
                        <select className={`${ctlCls} w-full`} value={lv.mode} disabled={!lv.on} onChange={e => setLv(L.key, { mode: e.target.value })}>
                          {Object.entries(REF_MODES).map(([k, l]) => <option key={k} value={k}>{l.replace('เกณฑ์', L.bound)}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        {lv.mode === 'eq'
                          ? <span className="text-earth-ink3 text-xs">—</span>
                          : <input className={`${ctlCls} w-full`} inputMode="decimal" disabled={!lv.on} value={lv.amount}
                              onChange={e => setLv(L.key, { amount: e.target.value.trim() })}
                              placeholder={lv.mode === 'pct' ? '90' : lv.mode === 'offset' ? '-0.2' : '0'} />}
                      </td>
                      <td className="px-3 py-1.5">
                        <select className={`${ctlCls} w-full`} value={lv.severity} disabled={!lv.on} onChange={e => setLv(L.key, { severity: e.target.value })}>
                          {Object.keys(SEVERITY).map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-earth-ink2">{lv.on ? `${L.op} ${refText({ bound: L.bound, ...lv })}` : 'ปิด'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="text-sm font-bold text-earth-ink mb-1.5">ค่าที่จะใช้จริงในแต่ละสถานการณ์{unit ? ` (${unit})` : ''}</h4>
            <div className="border border-earth-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-earth-card text-earth-ink2 text-xs text-left">
                  <tr>
                    <th className="px-3 py-2">สถานการณ์</th><th className="px-3 py-2">LCL</th><th className="px-3 py-2">UCL</th>
                    {LEVELS.map(L => <th key={L.key} className="px-3 py-2">{L.label}</th>)}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ s, t, v, bad }) => (
                    <tr key={s.id} className={`border-t border-earth-border ${s.active ? 'bg-teal-50' : ''}`}>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {s.name}{s.active && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">active</span>}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-earth-ink3">{fmtV(t?.min)}</td>
                      <td className="px-3 py-1.5 font-mono text-earth-ink3">{fmtV(t?.max)}</td>
                      {LEVELS.map(L => (
                        <td key={L.key} className="px-3 py-1.5 font-mono">
                          {v[L.key] === undefined ? '' : v[L.key] === null
                            ? <span className="text-xs text-earth-ink3" title="สถานการณ์นี้ไม่มีเกณฑ์ข้างนี้ — ระดับนี้ไม่ทำงาน">ไม่ทำงาน</span>
                            : fmtV(v[L.key])}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-xs text-red-600 whitespace-nowrap">{bad.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />เปิดใช้ทันที (ไม่ติ๊ก = บันทึกเป็นฉบับร่าง)
          </label>
          {nExisting > nOn && <p className="text-xs text-amber-700">ระดับที่เคยตั้งไว้แต่ตอนนี้ไม่ได้ติ๊ก จะถูกลบ</p>}
          <p className="text-xs text-earth-ink3">
            สร้างเป็น Event Class แยกต่อระดับ (id {slugKey(paramKey)}_h2 …) — แก้ข้อความเสียง / hysteresis / CAR ทีละรายการได้จากปุ่มแก้ไข
            ค่าเหล่านั้นจะคงอยู่เมื่อกลับมาตั้งระดับใหม่
          </p>
        </>}

        {result && (
          <div className="text-sm space-y-1">
            <p className="text-teal-700 font-semibold">บันทึก {result.saved.length} ระดับ{result.deleted.length ? ` · ลบ ${result.deleted.length}` : ''}</p>
            {result.warnings?.map((w, i) => <p key={i} className="text-xs text-amber-700">⚠ {w}</p>)}
          </div>
        )}
        <ErrorLine error={run.error} />
      </div>
      <div className="px-5 py-4 border-t border-earth-border flex justify-end gap-2">
        <button className={btn.ghost} onClick={onClose}>ปิด</button>
        <button className={btn.primary} disabled={!paramKey || missingAmount || (nOn === 0 && nExisting === 0) || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'กำลังบันทึก...' : nOn === 0 ? 'ลบทุกระดับ' : `บันทึก ${nOn} ระดับ`}
        </button>
      </div>
    </Modal>
  );
}

// ── occurrences (P3): alarm episodes from Uroboros + CAR follow-up ───────────
// ทำไม episode จบ (services/alarmWatcher.js clearReason)
const CLEAR_REASON = {
  recovered: 'กลับสู่ปกติ',
  scenario_change: 'จบเพราะเปลี่ยนสถานการณ์',
  class_disabled: 'จบเพราะปิด Event Class',
  vanished: 'หายจาก Uroboros',
};
const CAR_STATUS = {
  none:      { label: 'ไม่ออก CAR', cls: 'bg-gray-100 text-gray-600' },
  pending:   { label: 'รอตัดสินใจ', cls: 'bg-amber-100 text-amber-800' },
  failed:    { label: 'ออกอัตโนมัติไม่สำเร็จ', cls: 'bg-red-100 text-red-700' },
  issued:    { label: 'ออก CAR แล้ว', cls: 'bg-teal-100 text-teal-800' },
  dismissed: { label: 'ไม่ต้องออก', cls: 'bg-gray-100 text-gray-600' },
};
const thTime = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');

function Occurrences({ q, canWrite }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('todo');   // todo | open | all
  const [dismissing, setDismissing] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['eventclass', 'occurrences'] });

  const poll = useMutation({ mutationFn: () => post('/api/eventclass/occurrences/poll'), onSuccess: refresh });
  const draft = useMutation({
    mutationFn: (occ) => get(`/api/eventclass/occurrences/${occ.id}/car-draft`).then(r => ({ occ, draft: r.draft })),
    onSuccess: ({ occ, draft: d }) => navigate('/car', {
      state: { prefill: { ...d, record_datetime: d.record_datetime.slice(0, 16) }, eventOccurrence: { id: occ.id, event_class_id: occ.event_class_id } },
    }),
  });
  const dismiss = useMutation({
    mutationFn: ({ id, reason }) => post(`/api/eventclass/occurrences/${id}/dismiss`, { reason }),
    onSuccess: () => { setDismissing(null); refresh(); },
  });

  const w = q.data?.watcher;
  const items = (q.data?.items || []).filter(o =>
    filter === 'all' ? true : filter === 'open' ? !o.cleared_at : ['pending', 'failed'].includes(o.car_status));

  return (
    <Section
      title="เหตุการณ์ที่ Uroboros แจ้งเตือน"
      subtitle={w
        ? `ตรวจล่าสุด ${thTime(w.last_poll_at)}${w.error ? ` · ติดต่อ Uroboros ไม่ได้: ${w.error}` : ` · กำลังเตือน ${w.active} รายการ`}${w.dry_run ? ' · Uroboros โหมด dry_run (ไม่ออก CAR อัตโนมัติ)' : ''}${w.running ? '' : ' · ตัวติดตามปิดอยู่'}`
        : 'กำลังโหลด...'}
      right={
        <div className="flex gap-2 flex-wrap">
          <select className={`${ctlCls} w-48`} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="todo">รอตัดสินใจเรื่อง CAR</option>
            <option value="open">ยังเตือนอยู่</option>
            <option value="all">ทั้งหมด (200 ล่าสุด)</option>
          </select>
          {canWrite && <button className={`${btn.ghost} whitespace-nowrap`} disabled={poll.isPending} onClick={() => poll.mutate()}>{poll.isPending ? 'กำลังตรวจ...' : 'ตรวจตอนนี้'}</button>}
        </div>
      }
    >
      {(q.error || poll.error || draft.error) && <div className="px-5 pt-3"><ErrorLine error={q.error || poll.error || draft.error} /></div>}
      {q.isLoading ? <Empty>กำลังโหลด...</Empty> : items.length === 0 ? <Empty>{filter === 'todo' ? 'ไม่มีเหตุการณ์ที่รอตัดสินใจ' : 'ไม่มีเหตุการณ์'}</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-earth-card text-earth-ink2 text-left">
              <tr>
                <th className="px-4 py-2">เริ่ม</th><th className="px-4 py-2">Event Class</th><th className="px-4 py-2">ค่า (แรก → แย่สุด)</th>
                <th className="px-4 py-2">สถานะ</th><th className="px-4 py-2">CAR</th><th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map(o => {
                const st = CAR_STATUS[o.car_status] || CAR_STATUS.none;
                const canAct = canWrite && ['pending', 'failed', 'none'].includes(o.car_status);
                return (
                  <tr key={o.id} className="border-t border-earth-border align-top">
                    <td className="px-4 py-2 whitespace-nowrap font-mono text-xs">{thTime(o.since || o.first_seen_at)}</td>
                    <td className="px-4 py-2">
                      <div className="font-semibold text-earth-ink flex items-center gap-1.5">
                        <SeverityBadge s={o.severity} />{o.title || o.event_class_id}
                      </div>
                      <div className="font-mono text-xs text-earth-ink3">{o.event_class_id} · #{o.id}{o.zone ? ` · ${o.zone}` : ''}</div>
                    </td>
                    <td className="px-4 py-2 font-mono whitespace-nowrap">
                      {o.value_first ?? '—'}{o.value_worst != null && o.value_worst !== o.value_first ? ` → ${o.value_worst}` : ''}{o.unit ? ` ${o.unit}` : ''}
                      {(o.threshold_value != null || o.scenario_name) && (
                        <div className="font-sans text-xs text-earth-ink3">
                          {o.threshold_value != null && `เกณฑ์ ${o.threshold_value}`}{o.scenario_name && ` · ${o.scenario_name}`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap">
                      {o.cleared_at
                        ? <span className="text-earth-ink2">{CLEAR_REASON[o.clear_reason] || 'จบแล้ว'} {thTime(o.cleared_at)}</span>
                        : <span className="font-bold text-red-600">● กำลังเตือน</span>}
                      {!!o.is_test && (
                        <div className="mt-1"><span className="px-1.5 py-0.5 rounded bg-fuchsia-600 text-white font-bold">TEST</span></div>
                      )}
                      {!!o.scenario_changed && (
                        <div className="mt-1"><span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">เปลี่ยนสถานการณ์ระหว่างเกิด</span></div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <span className={`font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                      {o.car_key && (
                        <button className="ml-2 font-mono text-teal-700 hover:underline" onClick={() => navigate(`/car?key=${o.car_key}`)}>
                          {o.car_number || o.car_key}
                        </button>
                      )}
                      {o.car_note && <div className="text-earth-ink2 mt-1">{o.car_note}</div>}
                      {o.car_by && <div className="text-earth-ink3 mt-0.5">{o.car_by} · {thTime(o.car_at)}</div>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {canAct && <>
                        <button className="text-teal-700 font-semibold hover:underline" disabled={draft.isPending} onClick={() => draft.mutate(o)}>ออก CAR</button>
                        {o.car_status !== 'none' && <button className="ml-3 text-earth-ink2 hover:underline" onClick={() => setDismissing(o)}>ไม่ต้องออก</button>}
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dismissing && (
        <ReasonModal title={`ไม่ออก CAR · ${dismissing.title || dismissing.event_class_id}`}
          message="ระบุเหตุผลที่เหตุการณ์นี้ไม่ต้องออก CAR (เช่น เก็บตัวอย่างผิดพลาด, มี CAR ครอบคลุมแล้ว) — เก็บไว้เป็นหลักฐาน"
          confirmLabel="ยืนยัน ไม่ออก CAR" pending={dismiss.isPending} error={dismiss.error}
          onConfirm={(reason) => dismiss.mutate({ id: dismissing.id, reason })} onClose={() => setDismissing(null)} />
      )}
    </Section>
  );
}
