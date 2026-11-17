import React, { useState } from 'react';
import { timeTH } from './shared.jsx';

// รวมสถานะ server / Uroboros เป็นรายการปัญหา
function healthIssues(status, s) {
  const out = [];
  if (status.error) out.push({ level: 'red', text: `เรียก /api/testmode ไม่สำเร็จ (${status.error.message}) — ถ้าเพิ่งอัปเดตโค้ด ให้รีสตาร์ท server LabVenture (:8889) · ปุ่มทั้งหมดถูกปิดไว้` });
  const u = s?.uroboros;
  if (!u) return out;
  if (u.error) out.push({ level: 'red', text: u.error });
  const off = u.tasks ? Object.entries(u.tasks).filter(([, on]) => !on).map(([n]) => n) : [];
  if (['eventclass.sync', 'alarm.eval'].some(t => u.tasks?.[t] === false)) {
    out.push({ level: 'red', text: `Uroboros ยังไม่เปิด task ของ alarm (ปิดอยู่: ${off.join(', ')}) — ฉีดค่าได้แต่ไม่มีใครประเมิน · เปิด eventclass.sync และ alarm.eval ที่หน้า Admin ของ Uroboros (MHxView) แล้วกด Start` });
  }
  if (u.realtime_error) out.push({ level: 'red', text: u.realtime_error });
  else if (u.ok && u.realtime_rules == null) out.push({ level: 'red', text: 'Uroboros รุ่นนี้ยังไม่ประเมิน Event Class realtime (คลอรีน) — ต้อง publish Uroboros ใหม่' });
  if (u.dry_run) out.push({ level: 'amber', text: 'Uroboros อยู่ใน dry_run — alarm จะไม่ถูกส่งถึง BellBeast' });
  return out;
}

export default function Header({ status, s, onClose }) {
  const [open, setOpen] = useState(false);
  const issues = healthIssues(status, s);
  const hasRed = issues.some(i => i.level === 'red');
  const u = s?.uroboros;

  const chip = status.isLoading
    ? { cls: 'bg-white/20', text: 'กำลังโหลด...' }
    : issues.length === 0
      ? { cls: 'bg-emerald-500', text: `● Uroboros ปกติ · eval ${timeTH(u?.last_eval)}` }
      : { cls: hasRed ? 'bg-red-500' : 'bg-amber-500', text: `⚠ ${issues.length} ปัญหา` };

  return (
    <div className="bg-fuchsia-600 text-white">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-lg">🧪</span>
        <div className="mr-auto min-w-0">
          <p className="font-bold leading-tight">TEST MODE</p>
          <p className="text-[11px] opacity-90">Ctrl+Shift+F10 เพื่อปิด · เฉพาะ super admin</p>
        </div>
        <button onClick={() => setOpen(o => !o)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chip.cls} hover:brightness-110`}
          title="ดูรายละเอียดสถานะ">
          {chip.text} {open ? '▴' : '▾'}
        </button>
        <button onClick={onClose} className="rounded px-2 py-1 hover:bg-white/20" aria-label="ปิด test mode">✕</button>
      </div>
      {open && (
        <div className="space-y-1 bg-white px-4 py-2 text-xs text-earth-ink border-b border-earth-border">
          {issues.map((i, k) => (
            <p key={k} className={`rounded-md px-3 py-1.5 ${i.level === 'red' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{i.text}</p>
          ))}
          {u?.ok && (
            <p className="text-earth-ink3">
              sync ล่าสุด {u.last_sync ? timeTH(u.last_sync) : 'ยังไม่เคย'} · eval ล่าสุด {u.last_eval ? timeTH(u.last_eval) : 'ยังไม่เคย'}
              {' · '}กฎแล็ป {u.lab_rules ?? '—'} · กฎ realtime {u.realtime_rules ?? '—'}
            </p>
          )}
          {issues.length === 0 && !u?.ok && <p className="text-earth-ink3">ยังไม่มีข้อมูล</p>}
        </div>
      )}
    </div>
  );
}
