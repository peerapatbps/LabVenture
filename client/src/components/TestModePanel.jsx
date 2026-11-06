import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, put, patch, del } from '../api.js';

// Test mode ของหน้า /config (Ctrl+Shift+F10, เฉพาะ super admin)
// - เปลี่ยนสถานการณ์จริง แต่ log ติดป้าย [TEST] + ปุ่มคืนสถานการณ์ก่อนทดสอบ
// - ฉีดค่าแล็ปปลอมเข้า Uroboros (เก็บในหน่วยความจำ หมดอายุเอง) → alarm วิ่งจริงถึง BellBeast/device
//   occurrence ใน LabVenture ติดป้าย TEST และไม่ออก CAR

const BASELINE_KEY = 'lv.testmode.baseline';   // สถานการณ์ก่อนเริ่มทดสอบ (ต่อแท็บ)
const ss = {
  get: () => { try { return JSON.parse(sessionStorage.getItem(BASELINE_KEY) || 'null'); } catch { return null; } },
  set: (v) => { try { sessionStorage.setItem(BASELINE_KEY, JSON.stringify(v)); } catch {} },
  clear: () => { try { sessionStorage.removeItem(BASELINE_KEY); } catch {} },
};

const input = 'w-full border border-earth-border rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-fuchsia-400';
const btnPri = 'px-3 py-1.5 text-sm font-semibold rounded-lg bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-40';
const btnSec = 'px-3 py-1.5 text-sm rounded-lg bg-earth-card text-earth-ink2 hover:bg-earth-border disabled:opacity-40';
const round = (v) => (v == null ? '' : String(Math.round(v * 1000) / 1000));

function Section({ title, children }) {
  return (
    <section className="space-y-2 border-t border-earth-border pt-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-fuchsia-700">{title}</h3>
      {children}
    </section>
  );
}

function minutesLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  return ms <= 0 ? 'หมดอายุ' : `เหลือ ${Math.ceil(ms / 60000)} นาที`;
}

export default function TestModePanel({ onClose }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['testmode-status'], queryFn: () => get('/api/testmode/status'), refetchInterval: 5000 });
  const { data: scenarios } = useQuery({ queryKey: ['scenarios-list'], queryFn: () => get('/api/scenarios') });
  const s = status.data;
  // /api/testmode ใช้ไม่ได้ (เช่น server ยังเป็นรุ่นก่อนมี test mode) → ห้ามทำอะไรใน panel
  // เพราะ server รุ่นเก่าจะเปลี่ยนสถานการณ์จริงโดยไม่ตรวจสิทธิ์และไม่ log [TEST]
  const serverOk = !!s && !status.error;

  const [msg, setMsg] = useState(null);   // { ok, text }
  const [busy, setBusy] = useState(false);
  const run = async (fn, okText) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg({ ok: true, text: typeof okText === 'function' ? okText(r) : okText }); }
    catch (e) { setMsg({ ok: false, text: e?.message || 'ไม่สำเร็จ' }); }
    finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ['testmode-status'] });
      qc.invalidateQueries({ queryKey: ['eventclass'] });
    }
  };

  // ── สถานการณ์ ──
  const [target, setTarget] = useState('');
  const [baseline, setBaseline] = useState(ss.get);
  const nameOf = (id) => scenarios?.find(x => x.id === id)?.name ?? `#${id}`;
  const invalidateScenario = () => ['scenarios-list', 'active-scenario', 'scenario-log', 'scenario-thresholds'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const switchTo = (id, note) => run(async () => {
    if (!baseline && s?.scenario) { const b = { id: s.scenario.id, name: s.scenario.name }; ss.set(b); setBaseline(b); }
    const r = await put(`/api/scenarios/${id}/activate`, { test: true, note });
    invalidateScenario();
    return r;
  }, (r) => `เปลี่ยนเป็น ${nameOf(id)} แล้ว · Uroboros: ${r?.sync ?? '—'}`);
  const restore = () => run(async () => {
    const r = await put(`/api/scenarios/${baseline.id}/activate`, { test: true, note: 'คืนสถานการณ์หลังทดสอบ' });
    ss.clear(); setBaseline(null); invalidateScenario();
    return r;
  }, `คืนเป็น ${baseline?.name} แล้ว`);

  // ── ฉีดค่า ──
  const classes = s?.classes || [];
  const [classId, setClassId] = useState('');
  const cls = classes.find(c => c.event_class_id === classId);
  const [value, setValue] = useState('');
  const [count, setCount] = useState(1);
  const [ttl, setTtl] = useState(15);   // short: while a test runs, the real value of this param is hidden
  useEffect(() => {
    if (!cls) return;
    // ค่าเริ่มต้น = เกินเกณฑ์ 20% ไปทางที่ alarm ดัง
    if (cls.limit != null) setValue(round(cls.op?.startsWith('<') ? cls.limit * 0.8 : cls.limit * 1.2 || 1));
    setCount(cls.for_polls || 1);
  }, [classId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const titleByCid = useMemo(() => {
    const m = {};
    for (const c of classes) (m[c.configparam_id] ||= []).push(c.title || c.event_class_id);
    return m;
  }, [classes]);

  // คลาสที่ปิดอยู่ Uroboros ไม่ประเมิน → เปิดใช้ก่อนแล้วค่อยฉีด (ถ้าเปิดไม่ผ่าน เช่น ขาดคลิปเสียง จะไม่ฉีด)
  const inject = () => run(
    async () => {
      if (!cls.enabled) await patch(`/api/eventclass/${cls.event_class_id}/enabled`, { enabled: true });
      return post('/api/testmode/inject', { configparam_id: cls.configparam_id, value: Number(value), count: Number(count), ttl_min: Number(ttl) });
    },
    (r) => `${cls.enabled ? '' : 'เปิดใช้ Event Class แล้ว · '}ฉีดค่า ${value} ${cls.unit} แล้ว · Uroboros: ${r?.eval}`,
  );
  const enabledClasses = classes.filter(c => c.enabled);
  const disabledClasses = classes.filter(c => !c.enabled);
  const optionText = (c) => `${c.title || c.event_class_id} · ${c.op} ${c.limit ?? '—'} ${c.unit}`;
  const clear = (cid) => run(() => del(`/api/testmode/inject${cid ? `?configparam_id=${cid}` : ''}`), (r) => `ล้างค่าปลอม ${r?.removed ?? 0} รายการ`);
  const enableClass = (id, enabled) => run(() => patch(`/api/eventclass/${id}/enabled`, { enabled }), enabled ? 'เปิด Event Class แล้ว · แจ้ง Uroboros ให้ sync ทันที' : 'ปิด Event Class แล้ว');

  return (
    <aside className="fixed right-0 top-0 z-40 h-full w-full max-w-sm overflow-y-auto border-l-4 border-fuchsia-500 bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-fuchsia-600 px-4 py-3 text-white">
        <span className="text-lg">🧪</span>
        <div className="mr-auto">
          <p className="font-bold leading-tight">TEST MODE</p>
          <p className="text-xs opacity-90">Ctrl+Shift+F10 เพื่อปิด · เฉพาะ super admin</p>
        </div>
        <button onClick={onClose} className="rounded px-2 py-1 hover:bg-white/20" aria-label="ปิด test mode">✕</button>
      </div>

      <div className="space-y-4 p-4 text-sm text-earth-ink">
        {status.isLoading && <p className="text-earth-ink3">กำลังโหลด...</p>}
        {status.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            <b>ใช้ test mode ไม่ได้</b> — เรียก /api/testmode ไม่สำเร็จ ({status.error.message})
            <span className="block mt-1">ถ้าเพิ่งอัปเดตโค้ด ให้รีสตาร์ท server LabVenture (:8889) ก่อน · ปุ่มใน panel ถูกปิดไว้จนกว่าจะเชื่อมได้</span>
          </p>
        )}
        {s?.uroboros?.error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{s.uroboros.error}</p>}
        {s?.uroboros?.tasks && ['eventclass.sync', 'alarm.eval'].some(t => s.uroboros.tasks[t] === false) && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 space-y-1">
            <p><b>Uroboros ยังไม่เปิด task ของ alarm</b> — ฉีดค่าได้ แต่จะไม่มีใครประเมิน จึงไม่มี alarm</p>
            <p>ปิดอยู่: {Object.entries(s.uroboros.tasks).filter(([, on]) => !on).map(([n]) => n).join(', ')}</p>
            <p>เปิดอย่างน้อย <b>eventclass.sync</b> และ <b>alarm.eval</b> ที่หน้า Admin ของ Uroboros (MHxView) แล้วกด Start</p>
          </div>
        )}
        {s?.uroboros?.ok && (
          <p className="text-[11px] text-earth-ink3">
            Uroboros: sync ล่าสุด {s.uroboros.last_sync ? new Date(s.uroboros.last_sync).toLocaleTimeString('th-TH') : 'ยังไม่เคย'}
            {' · '}eval ล่าสุด {s.uroboros.last_eval ? new Date(s.uroboros.last_eval).toLocaleTimeString('th-TH') : 'ยังไม่เคย'}
            {' · '}กฎแล็ป {s.uroboros.lab_rules ?? '—'}
          </p>
        )}
        {s?.uroboros?.dry_run &&<p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">Uroboros อยู่ใน dry_run — alarm จะไม่ถูกส่งถึง BellBeast</p>}
        {msg && <p className={`rounded-md px-3 py-2 text-xs ${msg.ok ? 'bg-teal-50 text-teal-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}

        <Section title="สถานการณ์ (เปลี่ยนจริง · log [TEST])">
          <p>ตอนนี้: <b>{s?.scenario?.name ?? '—'}</b>{s?.scenario?.epidemic && <span className="ml-1 text-red-600">+ โรคระบาด</span>}</p>
          <div className="flex gap-2">
            <select className={input} value={target} onChange={e => setTarget(e.target.value)}>
              <option value="">— เลือกสถานการณ์ —</option>
              {(scenarios || []).filter(x => x.id !== s?.scenario?.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button className={btnPri} disabled={!serverOk || !target || busy} onClick={() => { switchTo(Number(target), 'ทดสอบ alarm'); setTarget(''); }}>เปลี่ยน</button>
          </div>
          {baseline && baseline.id !== s?.scenario?.id && (
            <button className={`${btnSec} w-full border border-fuchsia-300`} disabled={!serverOk || busy} onClick={restore}>
              ↩ คืนสถานการณ์ก่อนทดสอบ: {baseline.name}
            </button>
          )}
        </Section>

        <Section title="ฉีดค่าแล็ปปลอมเข้า Uroboros">
          <select className={input} disabled={!serverOk} value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">— เลือก Event Class —</option>
            <optgroup label={`เปิดใช้อยู่ (${enabledClasses.length}) — ดังได้ทันที`}>
              {enabledClasses.map(c => <option key={c.event_class_id} value={c.event_class_id}>{optionText(c)}</option>)}
            </optgroup>
            <optgroup label={`ปิดอยู่ (${disabledClasses.length}) — จะเปิดใช้ให้ตอนฉีดค่า`}>
              {disabledClasses.map(c => <option key={c.event_class_id} value={c.event_class_id}>⏸ {optionText(c)}</option>)}
            </optgroup>
          </select>
          {cls && (
            <>
              <p className="text-xs text-earth-ink3">
                {cls.event_class_id} · configparam {cls.configparam_id} · zone {cls.zone || '—'} · เกณฑ์ตอนนี้ {cls.op} {cls.limit ?? 'ไม่มี'} {cls.unit}
              </p>
              {!cls.enabled && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Event Class นี้ปิดอยู่ — กดปุ่มด้านล่างจะ<b>เปิดใช้ให้ก่อน</b>แล้วค่อยฉีดค่า
                  (เปิดแล้วจะเตือนจากผลแล็ปจริงด้วย · ปิดคืนได้หลังทดสอบที่ปุ่ม “ปิดใช้” ด้านล่าง)
                </p>
              )}
              {cls.enabled && !cls.in_force && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">สถานการณ์นี้ไม่มีเกณฑ์ของพารามิเตอร์นี้ — alarm จะไม่ดัง</p>
              )}
              <p className="rounded-md bg-purple-50 px-3 py-2 text-xs text-purple-900">
                ทุกจุดรับ (MHxView, เครื่องเตือนภัย IoT) จะประกาศขึ้นต้นว่า <b>“นี่เป็นสัญญาณทดสอบ”</b> และแสดงป้าย TEST สีม่วง ·
                ⚠️ ระหว่างทดสอบ <b>ค่าจริงของพารามิเตอร์นี้ถูกบัง</b> จนครบอายุหรือกดล้าง — ตั้งอายุให้สั้นที่สุดที่พอทดสอบ
              </p>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-earth-ink2">ค่า ({cls.unit || '—'})<input className={input} inputMode="decimal" value={value} onChange={e => setValue(e.target.value.trim())} /></label>
                <label className="text-xs text-earth-ink2">จำนวนตัวอย่าง<input className={input} type="number" min={1} max={10} value={count} onChange={e => setCount(e.target.value)} /></label>
                <label className="text-xs text-earth-ink2">อายุ (นาที)<input className={input} type="number" min={1} max={240} value={ttl} onChange={e => setTtl(e.target.value)} /></label>
              </div>
              <button className={`${btnPri} w-full`} disabled={!serverOk || busy || value === '' || !Number.isFinite(Number(value))} onClick={inject}>
                {busy ? 'กำลังทำ...' : cls.enabled ? 'ฉีดค่า' : 'เปิดใช้ แล้วฉีดค่า'}
              </button>
              {cls.enabled && (
                <button className={`${btnSec} w-full`} disabled={!serverOk || busy} onClick={() => enableClass(cls.event_class_id, false)}>
                  ปิดใช้ Event Class นี้ (หลังทดสอบเสร็จ)
                </button>
              )}
            </>
          )}
        </Section>

        <Section title={`ค่าปลอมที่ค้างอยู่ (${s?.overlay?.length ?? 0})`}>
          {(s?.overlay || []).length === 0 ? <p className="text-xs text-earth-ink3">ไม่มี</p> : (
            <ul className="space-y-1">
              {s.overlay.map(o => (
                <li key={o.configparam_id} className="flex items-center gap-2 rounded-md bg-fuchsia-50 px-2 py-1.5 text-xs">
                  <span className="mr-auto">
                    <b>{(titleByCid[o.configparam_id] || [`configparam ${o.configparam_id}`])[0]}</b> = {o.value} ×{o.count}
                    <span className="block text-earth-ink3">{minutesLeft(o.expires_at)}</span>
                  </span>
                  <button className={btnSec} disabled={busy} onClick={() => clear(o.configparam_id)}>ล้าง</button>
                </li>
              ))}
            </ul>
          )}
          {(s?.overlay || []).length > 0 && <button className={`${btnSec} w-full`} disabled={busy} onClick={() => clear(null)}>ล้างทั้งหมด</button>}
        </Section>

        <Section title="alarm แล็ปใน Uroboros ตอนนี้">
          {(s?.alarms || []).length === 0 ? <p className="text-xs text-earth-ink3">ไม่มี</p> : (
            <ul className="space-y-1">
              {s.alarms.map(a => (
                <li key={a.alarm_id} className={`rounded-md px-2 py-1.5 text-xs ${a.active ? 'bg-red-50 text-red-800' : 'bg-earth-card text-earth-ink2'}`}>
                  <span className="font-semibold">{a.active ? '● ' : '○ '}{a.title || a.alarm_id}</span>
                  {a.test && <span className="ml-1 rounded bg-fuchsia-600 px-1 text-[10px] font-bold text-white">TEST</span>}
                  <span className="block">{a.alarm_id} · ค่า {a.value} {a.unit} · {a.zone}{a.active ? '' : ' · จบแล้ว (ช่วงหน่วง)'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-earth-ink3">อัปเดตทุก 5 วิ · Uroboros eval ทุก 30 วิ (ฉีดค่าแล้วสั่ง eval ทันที)</p>
        </Section>
      </div>
    </aside>
  );
}
