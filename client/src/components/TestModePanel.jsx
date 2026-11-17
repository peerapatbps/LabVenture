import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, put, patch, del } from '../api.js';
import { store } from './testmode/shared.jsx';
import Header from './testmode/Header.jsx';
import PendingBar from './testmode/PendingBar.jsx';
import LabTab from './testmode/LabTab.jsx';
import ChlorineTab from './testmode/ChlorineTab.jsx';
import ScenarioTab from './testmode/ScenarioTab.jsx';
import LivePanel from './testmode/LivePanel.jsx';

// Test mode ของหน้า /config (Ctrl+Shift+F10, เฉพาะ super admin)
// - เปลี่ยนสถานการณ์จริง แต่ log ติดป้าย [TEST] + คืนสถานการณ์ก่อนทดสอบ
// - ฉีดค่าแล็ป/คลอรีนปลอมเข้า Uroboros (เก็บในหน่วยความจำ หมดอายุเอง) → alarm วิ่งจริงถึง BellBeast/device
//   occurrence ใน LabVenture ติดป้าย TEST และไม่ออก CAR
// Layout: header (สถานะ) · แถบสิ่งที่ค้าง + เก็บกวาดทั้งหมด · ซ้าย = แท็บฉีดค่า · ขวา = ผลสด

const baselineStore = store('lv.testmode.baseline');   // สถานการณ์ก่อนเริ่มทดสอบ (ต่อแท็บ)
const enabledStore = store('lv.testmode.enabled');     // Event Class ที่ panel เปิดให้ระหว่างทดสอบ
const TAB_KEY = 'lv.testmode.tab';
const TABS = [
  { id: 'lab', name: 'แล็ป' },
  { id: 'cl', name: 'คลอรีน' },
  { id: 'scenario', name: 'สถานการณ์' },
];
const readTab = () => { try { const t = localStorage.getItem(TAB_KEY); return TABS.some(x => x.id === t) ? t : 'lab'; } catch { return 'lab'; } };

export default function TestModePanel({ onClose }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['testmode-status'], queryFn: () => get('/api/testmode/status'), refetchInterval: 5000 });
  const { data: scenarios } = useQuery({ queryKey: ['scenarios-list'], queryFn: () => get('/api/scenarios') });
  const s = status.data;
  // /api/testmode ใช้ไม่ได้ (เช่น server ยังเป็นรุ่นก่อนมี test mode) → ห้ามทำอะไรใน panel
  // เพราะ server รุ่นเก่าจะเปลี่ยนสถานการณ์จริงโดยไม่ตรวจสิทธิ์และไม่ log [TEST]
  const serverOk = !!s && !status.error;

  const [tab, setTabState] = useState(readTab);
  const setTab = (t) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch {} };

  // ── การทำงาน: ผลลัพธ์แสดงใต้ปุ่มของส่วนที่กด + เก็บประวัติ 5 รายการ ──
  const [msgs, setMsgs] = useState({});      // { [where]: { ok, text } }
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const run = async (where, fn, okText) => {
    setBusy(true); setMsgs(m => ({ ...m, [where]: null }));
    let entry;
    try {
      const r = await fn();
      entry = { ok: true, text: typeof okText === 'function' ? okText(r) : okText };
    } catch (e) {
      entry = { ok: false, text: e?.message || 'ไม่สำเร็จ' };
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ['testmode-status'] });
      qc.invalidateQueries({ queryKey: ['eventclass'] });
    }
    setMsgs(m => ({ ...m, [where]: entry }));
    setHistory(h => [{ ...entry, id: Date.now() + Math.random(), at: new Date().toISOString() }, ...h].slice(0, 5));
  };
  const runAt = (where) => (fn, okText) => run(where, fn, okText);

  // ── Event Class ที่ panel เปิดให้ (ปิดคืนตอนเก็บกวาด) ──
  const [tracked, setTracked] = useState(() => enabledStore.get() || []);
  const saveTracked = (list) => { setTracked(list); list.length ? enabledStore.set(list) : enabledStore.clear(); };
  const track = (id) => setTracked(prev => { const n = prev.includes(id) ? prev : [...prev, id]; enabledStore.set(n); return n; });
  const untrack = (id) => setTracked(prev => { const n = prev.filter(x => x !== id); n.length ? enabledStore.set(n) : enabledStore.clear(); return n; });
  const trackedOn = tracked.filter(id => (s?.classes || []).some(c => c.event_class_id === id && c.enabled));

  // ── สถานการณ์ ──
  const [baseline, setBaseline] = useState(baselineStore.get);
  const nameOf = (id) => scenarios?.find(x => x.id === id)?.name ?? `#${id}`;
  const invalidateScenario = () => ['scenarios-list', 'active-scenario', 'scenario-log', 'scenario-thresholds'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  const scenarioChanged = !!baseline && !!s?.scenario && baseline.id !== s.scenario.id;
  const switchTo = (id) => run('scenario', async () => {
    if (!baseline && s?.scenario) { const b = { id: s.scenario.id, name: s.scenario.name }; baselineStore.set(b); setBaseline(b); }
    const r = await put(`/api/scenarios/${id}/activate`, { test: true, note: 'ทดสอบ alarm' });
    invalidateScenario();
    return r;
  }, (r) => `เปลี่ยนเป็น ${nameOf(id)} แล้ว · Uroboros: ${r?.sync ?? '—'}`);
  const restoreScenario = async () => {
    await put(`/api/scenarios/${baseline.id}/activate`, { test: true, note: 'คืนสถานการณ์หลังทดสอบ' });
    baselineStore.clear(); setBaseline(null); invalidateScenario();
  };
  const restore = () => run('scenario', restoreScenario, `คืนเป็น ${baseline?.name} แล้ว`);

  // ── เก็บกวาดทั้งหมด ──
  const pending = {
    scenario: scenarioChanged ? { current: s.scenario.name, baseline: baseline.name } : null,
    lab: s?.overlay?.length || 0,
    cl: s?.overlay_realtime?.length || 0,
    classes: trackedOn,
  };
  const cleanupAll = () => {
    const what = [
      pending.lab && `ล้างค่าปลอมแล็ป ${pending.lab}`,
      pending.cl && `ล้างค่าปลอมคลอรีน ${pending.cl}`,
      trackedOn.length && `ปิด Event Class ${trackedOn.join(', ')}`,
      pending.scenario && `คืนสถานการณ์เป็น ${baseline.name}`,
    ].filter(Boolean);
    if (!window.confirm(`เก็บกวาดการทดสอบ:\n• ${what.join('\n• ')}`)) return;
    run('pending', async () => {
      const done = [];
      if (pending.lab) { const r = await del('/api/testmode/inject'); done.push(`ล้างแล็ป ${r?.removed ?? 0}`); }
      if (pending.cl) { const r = await del('/api/testmode/inject-realtime'); done.push(`ล้างคลอรีน ${r?.removed ?? 0}`); }
      for (const id of trackedOn) await patch(`/api/eventclass/${id}/enabled`, { enabled: false });
      if (trackedOn.length) done.push(`ปิด Event Class ${trackedOn.length}`);
      saveTracked([]);
      if (pending.scenario) { await restoreScenario(); done.push(`คืนสถานการณ์ ${baseline.name}`); }
      return done;
    }, (done) => `เก็บกวาดแล้ว: ${done.join(' · ') || 'ไม่มีอะไรต้องเก็บ'}`);
  };

  const ctx = { s, serverOk, busy };

  return (
    <aside className="fixed right-0 top-0 z-40 flex h-full w-full max-w-3xl flex-col border-l-4 border-fuchsia-500 bg-white text-sm text-earth-ink shadow-2xl">
      <Header status={status} s={s} onClose={onClose} />
      <PendingBar pending={pending} serverOk={serverOk} busy={busy} onCleanup={cleanupAll} msg={msgs.pending} />

      <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,300px)] md:overflow-hidden">
        {/* ซ้าย: ฉีดค่า */}
        <div className="p-4 md:overflow-y-auto">
          <div className="mb-3 flex gap-1 rounded-lg bg-earth-card p-1" role="tablist">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${tab === t.id ? 'bg-white text-fuchsia-700 shadow-sm' : 'text-earth-ink2 hover:bg-white/60'}`}>
                {t.name}
                {t.id === 'lab' && pending.lab > 0 && <span className="ml-1 text-xs text-fuchsia-600">({pending.lab})</span>}
                {t.id === 'cl' && pending.cl > 0 && <span className="ml-1 text-xs text-fuchsia-600">({pending.cl})</span>}
                {t.id === 'scenario' && pending.scenario && <span className="ml-1 text-xs text-fuchsia-600">●</span>}
              </button>
            ))}
          </div>
          {tab === 'lab' && <LabTab {...ctx} run={runAt('lab')} msg={msgs.lab} track={track} untrack={untrack} />}
          {tab === 'cl' && <ChlorineTab {...ctx} run={runAt('cl')} msg={msgs.cl} />}
          {tab === 'scenario' && (
            <ScenarioTab {...ctx} scenarios={scenarios} baseline={baseline} switchTo={switchTo} restore={restore} msg={msgs.scenario} />
          )}
        </div>

        {/* ขวา: ผลสด */}
        <div className="border-t border-earth-border bg-earth-card/40 p-4 md:overflow-y-auto md:border-l md:border-t-0">
          <LivePanel s={s} busy={busy} run={runAt('live')} msg={msgs.live} history={history} />
        </div>
      </div>
    </aside>
  );
}
