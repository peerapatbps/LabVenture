import React, { useState } from 'react';
import { post } from '../../api.js';
import { input, btnPri, label, CL_PLANTS, CL_POINTS, clPointName, Msg, Note, Info } from './shared.jsx';

// คลอรีน (Event Class realtime "CHEMx.cl_Sn/Dn")
// ค่าปลอมเห็นเฉพาะตัวประเมิน alarm ของ Uroboros — ค่าบนเว็บ / บอร์ดหน้าโรง / summary ยังเป็นค่าจริง
export default function ChlorineTab({ s, serverOk, busy, run, msg }) {
  const [plant, setPlant] = useState('CHEM1');
  const [param, setParam] = useState('cl_S3');
  const [value, setValue] = useState('1.5');
  const [ttl, setTtl] = useState(15);
  const cls = (s?.cl_classes || []).filter(c => c.stream === plant && c.param.toLowerCase() === param.toLowerCase());
  const enabledCls = cls.filter(c => c.enabled);
  const valueOk = value !== '' && Number.isFinite(Number(value));

  const inject = () => run(
    () => post('/api/testmode/inject-realtime', { stream: plant, param, value: Number(value), ttl_min: Number(ttl) }),
    (r) => `ฉีด ${clPointName(plant, param)} = ${value} ppm แล้ว · eval ${r?.eval_rounds ?? 0}/${r?.for_polls ?? 1} รอบ`
      + ((r?.eval_rounds ?? 0) >= (r?.for_polls ?? 1) ? ' → ควรดังแล้ว' : ' → จะดังในรอบ eval ถัดไป (≤ 30 วิ)')
      + ` · Uroboros: ${r?.eval}`,
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>โรง
          <select className={input} disabled={!serverOk} value={plant} onChange={e => setPlant(e.target.value)}>
            {CL_PLANTS.map(p => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}
          </select>
        </label>
        <label className={label}>จุด
          <select className={input} disabled={!serverOk} value={param} onChange={e => setParam(e.target.value)}>
            {CL_POINTS.map(p => <option key={p.param} value={p.param}>{p.name}</option>)}
          </select>
        </label>
      </div>

      {cls.length === 0 ? (
        <Note>ไม่มี Event Class ของ {plant}.{param} — ฉีดไปก็ไม่ดัง</Note>
      ) : (
        <ul className="space-y-0.5 text-xs text-earth-ink3">
          {cls.map(c => (
            <li key={c.event_class_id}>
              {c.event_class_id} · เกณฑ์ <b className="text-earth-ink2">{c.op} {c.limit ?? '—'} {c.unit}</b> ติดกัน {c.for_polls} รอบ · zone {c.zone || '—'} · จุด {c.highlight || '—'}
              {!c.enabled && <b className="text-amber-700"> · ปิดอยู่ (ไม่ดัง)</b>}
              {c.enabled && s?.uroboros?.realtime_rules != null && !c.in_uroboros && <b className="text-amber-700"> · Uroboros ยังไม่ได้ sync</b>}
              {c.uro_state && <span> · {c.uro_state}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className={label}>ค่า (ppm)<input className={input} inputMode="decimal" value={value} onChange={e => setValue(e.target.value.trim())} /></label>
        <label className={label}>อายุ (นาที)<input className={input} type="number" min={1} max={240} value={ttl} onChange={e => setTtl(e.target.value)} /></label>
      </div>
      <button className={`${btnPri} w-full`} disabled={!serverOk || busy || enabledCls.length === 0 || !valueOk} onClick={inject}>
        {busy ? 'กำลังทำ...' : 'ฉีดค่า'}
      </button>
      <Msg msg={msg} />
      <Info>
        <p>บอร์ดขึ้นหัวม่วง <b>“สัญญาณทดสอบ · {plant}”</b> จุดที่เลือกม่วงกะพริบ และประกาศ <b>“นี่เป็นสัญญาณทดสอบ …”</b></p>
        <p>ค่าปลอมเห็นเฉพาะตัวประเมิน alarm — <b>ค่าบนเว็บและหน้าโรงบนบอร์ดยังเป็นค่าจริง</b></p>
      </Info>
    </div>
  );
}
