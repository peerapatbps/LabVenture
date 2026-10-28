import React, { useState, useEffect } from 'react';

// Shared slot-strip pieces used by the Scientist Dashboard and the Operator Dashboard.

export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function nowHours(d = new Date()) {
  return d.getHours() + d.getMinutes() / 60;
}

// Re-render once a minute so the "now" line and due/overdue states stay current
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export const SLOT_STYLE = {
  done:     'bg-[#DCE8C8] border border-[#A9C08A]',
  modified: 'border border-[#E2B860] bg-[repeating-linear-gradient(135deg,#F6E2B0_0_4px,#E8C47A_4px_6px)]',
  partial:  'border border-[#E2B860] bg-[linear-gradient(90deg,#E8C47A_0_50%,#FBF0D2_50%_100%)]',
  due:      'bg-[#FBE3DC] border-[1.5px] border-[#D9614C] animate-pulse',
  overdue:  'bg-[#D9614C] border border-[#B84A36]',
  future:   'border border-dashed border-earth-ink3/60',
  optional: 'border border-earth-border bg-earth-DEFAULT',
  none:     '',
};

export const SLOT_TEXT = {
  done:     { text: '✓ บันทึกแล้ว',            cls: 'text-[#5E7A40]' },
  modified: { text: '✎ แก้ไขแล้ว',             cls: 'text-amber-700' },
  partial:  { text: '◑ บันทึกบางส่วน',          cls: 'text-amber-700' },
  due:      { text: '● ถึงรอบ — บันทึกได้เลย',  cls: 'text-[#B84A36]' },
  overdue:  { text: '✗ เลยเวลา ยังไม่บันทึก',   cls: 'text-[#B84A36]' },
  future:   { text: 'ยังไม่ถึงเวลา',            cls: 'text-earth-ink3' },
  optional: { text: 'ไม่บังคับบันทึก',          cls: 'text-earth-ink3' },
  none:     { text: 'ไม่มีรอบนี้',              cls: 'text-earth-ink3' },
};

const CLICKABLE = ['due', 'overdue', 'modified', 'partial'];

export function SlotCell({ slot, status, modifiedCount, onClickSlot, extraText, className = '', style, children }) {
  const [show, setShow] = useState(false);
  const isClickable = CLICKABLE.includes(status);
  const label = slot === 'daily' ? 'รายวัน' : slot;
  const tip = SLOT_TEXT[status];
  const tipText = status === 'modified' ? `${tip.text} (${modifiedCount} ค่า)` : tip.text;
  return (
    <div className={`relative h-[22px] ${className}`} style={style}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button type="button" disabled={!isClickable}
        aria-label={`${label} ${tipText}`}
        onClick={() => onClickSlot(slot)}
        className={`w-full h-full rounded-md flex items-center justify-center transition-transform duration-150 ${SLOT_STYLE[status]} ${isClickable ? 'cursor-pointer hover:scale-y-110 hover:brightness-95' : 'cursor-default'}`}>
        {children}
      </button>
      {show && status !== 'none' && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none bg-earth-card border border-earth-border rounded-lg px-2 py-1.5 shadow-md whitespace-nowrap">
          <span className="block text-xs font-mono font-semibold text-earth-ink">{label}</span>
          <span className={`block text-xs ${tip.cls}`}>{tipText}</span>
          {extraText && [].concat(extraText).map((t, i) => (
            <span key={i} className="block text-xs text-earth-ink2">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const LEGEND_TEXT = {
  done: 'บันทึกครบ', modified: 'แก้ไขค่าแล้ว', partial: 'บันทึกบางส่วน', due: 'ถึงรอบ',
  overdue: 'เลยเวลา', future: 'ยังไม่ถึงเวลา', optional: 'ไม่บังคับ',
};

export function SlotLegend({ items = ['done', 'modified', 'due', 'overdue', 'future'] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-earth-ink2">
      {items.map(k => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={`inline-block w-3.5 h-3 rounded-[3px] ${SLOT_STYLE[k].replace('animate-pulse', '')}`} />{LEGEND_TEXT[k]}
        </span>
      ))}
      <span className="flex items-center gap-1.5"><span className="inline-block w-0.5 h-3.5 rounded-full bg-brand-dark/80" />เวลาปัจจุบัน</span>
    </div>
  );
}
