import React from 'react';
import { Msg } from './shared.jsx';

// แถบ "กำลังทดสอบอยู่" — สรุปสิ่งที่ยังไม่ได้คืน + ปุ่มเก็บกวาดทั้งหมด
export default function PendingBar({ pending, serverOk, busy, onCleanup, msg }) {
  const items = [];
  if (pending.scenario) items.push(`สถานการณ์ → ${pending.scenario.current} (เดิม ${pending.scenario.baseline})`);
  if (pending.lab) items.push(`ค่าปลอมแล็ป ${pending.lab}`);
  if (pending.cl) items.push(`ค่าปลอมคลอรีน ${pending.cl}`);
  if (pending.classes.length) items.push(`Event Class ที่เปิดให้ทดสอบ ${pending.classes.length}`);

  return (
    <div className={`border-b px-4 py-2 text-xs ${items.length ? 'border-fuchsia-200 bg-fuchsia-50' : 'border-earth-border bg-earth-card/50'}`}>
      <div className="flex flex-wrap items-center gap-2">
        {items.length === 0 ? (
          <span className="mr-auto text-earth-ink3">ไม่มีอะไรค้างจากการทดสอบ ✓</span>
        ) : (
          <span className="mr-auto text-fuchsia-900">
            <b>กำลังทดสอบอยู่:</b> {items.join(' · ')}
          </span>
        )}
        {items.length > 0 && (
          <button className="rounded-lg bg-fuchsia-700 px-3 py-1 text-xs font-semibold text-white hover:bg-fuchsia-800 disabled:opacity-40"
            disabled={!serverOk || busy} onClick={onCleanup}>
            ↩ เก็บกวาดทั้งหมด
          </button>
        )}
      </div>
      {msg && <div className="mt-1.5"><Msg msg={msg} /></div>}
    </div>
  );
}
