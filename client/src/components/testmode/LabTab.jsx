import React, { useEffect, useState } from 'react';
import { post, patch } from '../../api.js';
import { input, btnPri, btnSec, label, round, Msg, Note, Info } from './shared.jsx';

// ฉีดค่าแล็ปปลอมเข้า Uroboros (Event Class ที่ source_metric = configparam)
export default function LabTab({ s, serverOk, busy, run, msg, track, untrack }) {
  const classes = s?.classes || [];
  const [classId, setClassId] = useState('');
  const cls = classes.find(c => c.event_class_id === classId);
  const [value, setValue] = useState('');
  const [count, setCount] = useState(1);
  const [ttl, setTtl] = useState(15);   // สั้นไว้: ระหว่างทดสอบ ค่าจริงของพารามิเตอร์นี้ถูกบัง
  useEffect(() => {
    if (!cls) return;
    // ค่าเริ่มต้น = เกินเกณฑ์ 20% ไปทางที่ alarm ดัง
    if (cls.limit != null) setValue(round(cls.op?.startsWith('<') ? cls.limit * 0.8 : cls.limit * 1.2 || 1));
    setCount(cls.for_polls || 1);
  }, [classId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // คลาสที่ปิดอยู่ Uroboros ไม่ประเมิน → เปิดใช้ก่อนแล้วค่อยฉีด (ถ้าเปิดไม่ผ่าน เช่น ขาดคลิปเสียง จะไม่ฉีด)
  const inject = () => run(
    async () => {
      if (!cls.enabled) {
        await patch(`/api/eventclass/${cls.event_class_id}/enabled`, { enabled: true });
        track(cls.event_class_id);
      }
      return post('/api/testmode/inject', { configparam_id: cls.configparam_id, value: Number(value), count: Number(count), ttl_min: Number(ttl) });
    },
    (r) => `${cls.enabled ? '' : 'เปิดใช้ Event Class แล้ว · '}ฉีด ${value} ${cls.unit} ×${count} แล้ว · Uroboros: ${r?.eval}`,
  );
  const disable = () => run(
    async () => { await patch(`/api/eventclass/${cls.event_class_id}/enabled`, { enabled: false }); untrack(cls.event_class_id); },
    'ปิด Event Class แล้ว',
  );

  const enabledClasses = classes.filter(c => c.enabled);
  const disabledClasses = classes.filter(c => !c.enabled);
  const optionText = (c) => `${c.title || c.event_class_id} · ${c.op} ${c.limit ?? '—'} ${c.unit}`;
  const valueOk = value !== '' && Number.isFinite(Number(value));

  return (
    <div className="space-y-3">
      <label className={`${label} block`}>Event Class
        <select className={input} disabled={!serverOk} value={classId} onChange={e => setClassId(e.target.value)}>
          <option value="">— เลือก Event Class —</option>
          <optgroup label={`เปิดใช้อยู่ (${enabledClasses.length}) — ดังได้ทันที`}>
            {enabledClasses.map(c => <option key={c.event_class_id} value={c.event_class_id}>{optionText(c)}</option>)}
          </optgroup>
          <optgroup label={`ปิดอยู่ (${disabledClasses.length}) — จะเปิดใช้ให้ตอนฉีดค่า`}>
            {disabledClasses.map(c => <option key={c.event_class_id} value={c.event_class_id}>⏸ {optionText(c)}</option>)}
          </optgroup>
        </select>
      </label>

      {!cls ? (
        <p className="text-xs text-earth-ink3">เลือก Event Class เพื่อกรอกค่าที่จะฉีด</p>
      ) : (
        <>
          <p className="text-xs text-earth-ink3">
            {cls.event_class_id} · configparam {cls.configparam_id} · zone {cls.zone || '—'} · เกณฑ์ตอนนี้ <b className="text-earth-ink2">{cls.op} {cls.limit ?? 'ไม่มี'} {cls.unit}</b> · ติดกัน {cls.for_polls} ตัวอย่าง
          </p>
          {!cls.enabled && <Note>Event Class นี้ปิดอยู่ — กดฉีดจะ<b>เปิดใช้ให้ก่อน</b> (ปิดคืนได้ด้วยปุ่ม “เก็บกวาดทั้งหมด”)</Note>}
          {cls.enabled && !cls.in_force && <Note>สถานการณ์นี้ไม่มีเกณฑ์ของพารามิเตอร์นี้ — alarm จะไม่ดัง</Note>}
          <Note tone="red">ระหว่างทดสอบ <b>ค่าจริงของพารามิเตอร์นี้ถูกบัง</b> จนครบอายุหรือกดล้าง — ตั้งอายุให้สั้นที่สุด</Note>

          <div className="grid grid-cols-3 gap-2">
            <label className={label}>ค่า ({cls.unit || '—'})<input className={input} inputMode="decimal" value={value} onChange={e => setValue(e.target.value.trim())} /></label>
            <label className={label}>จำนวนตัวอย่าง<input className={input} type="number" min={1} max={10} value={count} onChange={e => setCount(e.target.value)} /></label>
            <label className={label}>อายุ (นาที)<input className={input} type="number" min={1} max={240} value={ttl} onChange={e => setTtl(e.target.value)} /></label>
          </div>
          <button className={`${btnPri} w-full`} disabled={!serverOk || busy || !valueOk} onClick={inject}>
            {busy ? 'กำลังทำ...' : cls.enabled ? 'ฉีดค่า' : 'เปิดใช้ แล้วฉีดค่า'}
          </button>
          <Msg msg={msg} />
          {cls.enabled && (
            <button className={`${btnSec} w-full`} disabled={!serverOk || busy} onClick={disable}>ปิดใช้ Event Class นี้</button>
          )}
          <Info>
            <p>ทุกจุดรับ (MHxView, เครื่องเตือนภัย IoT) จะประกาศขึ้นต้นว่า <b>“นี่เป็นสัญญาณทดสอบ”</b> และแสดงป้าย TEST สีม่วง</p>
            <p>occurrence ใน LabVenture ติดป้าย TEST และไม่ออก CAR · ค่าปลอมเก็บในหน่วยความจำ Uroboros หมดอายุเอง ไม่เขียน data.db</p>
          </Info>
        </>
      )}
    </div>
  );
}
