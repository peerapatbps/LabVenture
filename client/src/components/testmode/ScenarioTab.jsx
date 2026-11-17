import React, { useState } from 'react';
import { input, btnPri, btnSec, Msg, Note } from './shared.jsx';

// เปลี่ยนสถานการณ์จริง (log ติดป้าย [TEST]) + คืนสถานการณ์ก่อนทดสอบ
export default function ScenarioTab({ s, scenarios, baseline, serverOk, busy, switchTo, restore, msg }) {
  const [target, setTarget] = useState('');
  const changed = baseline && baseline.id !== s?.scenario?.id;

  return (
    <div className="space-y-3">
      <p>ตอนนี้: <b>{s?.scenario?.name ?? '—'}</b>{s?.scenario?.epidemic && <span className="ml-1 text-red-600">+ โรคระบาด</span>}</p>
      <Note>เปลี่ยน<b>สถานการณ์จริง</b>ของระบบ (log ติด [TEST]) — เกณฑ์ alarm / CAR เปลี่ยนตามทันที</Note>
      <div className="flex gap-2">
        <select className={input} value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">— เลือกสถานการณ์ —</option>
          {(scenarios || []).filter(x => x.id !== s?.scenario?.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className={btnPri} disabled={!serverOk || !target || busy} onClick={() => { switchTo(Number(target)); setTarget(''); }}>เปลี่ยน</button>
      </div>
      {changed && (
        <button className={`${btnSec} w-full border border-fuchsia-300`} disabled={!serverOk || busy} onClick={restore}>
          ↩ คืนสถานการณ์ก่อนทดสอบ: {baseline.name}
        </button>
      )}
      <Msg msg={msg} />
    </div>
  );
}
