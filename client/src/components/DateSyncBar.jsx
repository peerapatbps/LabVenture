import React, { useRef } from 'react';

const THAI_DAYS   = ['วันอาทิตย์','วันจันทร์','วันอังคาร','วันพุธ','วันพฤหัสบดี','วันศุกร์','วันเสาร์'];
const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                     'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

export function thaiDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${THAI_DAYS[d.getDay()]}ที่ ${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

// Props:
//   date, onDateChange — required
//   onSync, syncing, syncMsg — optional (omit or pass hideSync to hide button)
//   maxDate — optional upper bound for date input
//   hideSync — hides the Sync button entirely
export default function DateSyncBar({ date, onDateChange, onSync, syncing, syncMsg, maxDate, hideSync, disabled }) {
  const dateRef = useRef(null);
  const label = thaiDateLabel(date);

  const pill = (
    <div
      className={`flex items-center gap-0 border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
      onClick={() => !disabled && dateRef.current?.showPicker?.()}
    >
      <span className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-50 border-r border-gray-200 select-none whitespace-nowrap">
        {label}
      </span>
      <input
        ref={dateRef}
        type="date"
        value={date}
        max={maxDate}
        disabled={disabled}
        onChange={e => !disabled && onDateChange?.(e.target.value)}
        className="px-3 py-1.5 text-xs font-mono text-gray-600 bg-white focus:outline-none border-none disabled:cursor-not-allowed"
      />
    </div>
  );

  if (hideSync) {
    return <div className="flex items-center gap-2">{pill}</div>;
  }

  return (
    <div className="flex items-center gap-2">
      {syncMsg && (
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-lg whitespace-nowrap">
          {syncMsg}
        </span>
      )}
      <button
        onClick={onSync}
        disabled={syncing}
        title="ดึงข้อมูลจาก AquaDAT"
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition-colors text-xs disabled:opacity-40"
      >
        <span className={syncing ? 'animate-spin inline-block' : ''}>⟳</span>
        <span>Sync</span>
      </button>
      {pill}
    </div>
  );
}
