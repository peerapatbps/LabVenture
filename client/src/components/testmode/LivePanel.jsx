import React, { useMemo } from 'react';
import { del } from '../../api.js';
import { btnTiny, minutesLeft, timeTH, clPointName, TestBadge, Msg } from './shared.jsx';

const Kind = ({ k }) => (
  <span className={`mr-1 rounded px-1 text-[10px] font-bold ${k === 'แล็ป' ? 'bg-sky-100 text-sky-800' : 'bg-teal-100 text-teal-800'}`}>{k}</span>
);
const H = ({ children }) => <h3 className="text-xs font-bold uppercase tracking-wide text-fuchsia-700">{children}</h3>;

// คอลัมน์ขวา: ค่าปลอมที่ค้าง (แล็ป + คลอรีน) · alarm ใน Uroboros · ประวัติที่ทำ
export default function LivePanel({ s, busy, run, msg, history }) {
  const titleByCid = useMemo(() => {
    const m = {};
    for (const c of s?.classes || []) (m[c.configparam_id] ||= []).push(c.title || c.event_class_id);
    return m;
  }, [s?.classes]);

  const overlays = [
    ...(s?.overlay || []).map(o => ({
      key: `lab.${o.configparam_id}`, kind: 'แล็ป', expires_at: o.expires_at,
      name: (titleByCid[o.configparam_id] || [`configparam ${o.configparam_id}`])[0], val: `${o.value} ×${o.count}`,
      clear: () => run(() => del(`/api/testmode/inject?configparam_id=${o.configparam_id}`), (r) => `ล้างค่าปลอมแล็ป ${r?.removed ?? 0} รายการ`),
    })),
    ...(s?.overlay_realtime || []).map(o => ({
      key: `rt.${o.stream}.${o.param}`, kind: 'คลอรีน', expires_at: o.expires_at,
      name: clPointName(o.stream, o.param), val: `${o.value} ppm`,
      clear: () => run(() => del(`/api/testmode/inject-realtime?stream=${o.stream}&param=${o.param}`), (r) => `ล้างค่าปลอมคลอรีน ${r?.removed ?? 0} รายการ`),
    })),
  ];
  const alarms = [
    ...(s?.alarms || []).map(a => ({ ...a, kind: 'แล็ป' })),
    ...(s?.alarms_realtime || []).map(a => ({ ...a, kind: 'คลอรีน' })),
  ].sort((a, b) => Number(b.active) - Number(a.active));

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <H>ค่าปลอมที่ค้าง ({overlays.length})</H>
        {overlays.length === 0 ? <p className="text-xs text-earth-ink3">ไม่มี</p> : (
          <ul className="space-y-1">
            {overlays.map(o => (
              <li key={o.key} className="flex items-center gap-2 rounded-md bg-fuchsia-50 px-2 py-1.5 text-xs">
                <span className="mr-auto min-w-0">
                  <Kind k={o.kind} /><b>{o.name}</b> = {o.val}
                  <span className="block text-earth-ink3">หมด {timeTH(o.expires_at)} · {minutesLeft(o.expires_at)}</span>
                </span>
                <button className={btnTiny} disabled={busy} onClick={o.clear}>ล้าง</button>
              </li>
            ))}
          </ul>
        )}
        <Msg msg={msg} />
      </section>

      <section className="space-y-1.5">
        <H>alarm ใน Uroboros ({alarms.filter(a => a.active).length} ดังอยู่)</H>
        {alarms.length === 0 ? <p className="text-xs text-earth-ink3">ไม่มี</p> : (
          <ul className="space-y-1">
            {alarms.map(a => (
              <li key={a.alarm_id} className={`rounded-md px-2 py-1.5 text-xs ${a.active ? 'bg-red-50 text-red-800' : 'bg-earth-card text-earth-ink2'}`}>
                <span className="font-semibold">{a.active ? '● ' : '○ '}<Kind k={a.kind} />{a.title || a.alarm_id}</span>
                {a.test && <TestBadge />}
                <span className="block">
                  {a.alarm_id} · ค่า {a.value} {a.unit} · {a.zone}
                  {a.ui?.highlight != null && ` · จุด ${a.ui.highlight}`}
                  {a.active ? '' : ' · จบแล้ว (ช่วงหน่วง)'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-earth-ink3">อัปเดตทุก 5 วิ · Uroboros eval ทุก 30 วิ (ฉีดค่าแล้วสั่ง eval ทันที)</p>
      </section>

      <section className="space-y-1.5">
        <H>ประวัติที่ทำ</H>
        {history.length === 0 ? <p className="text-xs text-earth-ink3">ยังไม่ได้ทำอะไร</p> : (
          <ul className="space-y-1">
            {history.map(h => (
              <li key={h.id} className={`text-xs ${h.ok ? 'text-earth-ink2' : 'text-red-700'}`}>
                <span className="text-earth-ink3">{timeTH(h.at)}</span> {h.ok ? '✓' : '✕'} {h.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
