// หน้าแผนงาน — shared helpers. Months are 'YYYY-MM' (ค.ศ.) as the server sends them; display is พ.ศ.
// expand() mirrors server/services/pm.js so the frequency editor can preview without a round trip.

export const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export const ymParts = (ym) => ({ y: Number(ym.slice(0, 4)), m: Number(ym.slice(5, 7)) });
export const beYear = (ym) => ymParts(ym).y + 543;
export const thMonth = (ym) => TH_MONTH[ymParts(ym).m - 1];
export const thMonthYear = (ym) => (ym ? `${thMonth(ym)} ${String(beYear(ym)).slice(2)}` : '');

const ymToIdx = (ym) => ymParts(ym).y * 12 + ymParts(ym).m - 1;
const idxToYm = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

export function fyOf(ym, startMonth = 10) {
  const { y, m } = ymParts(ym);
  return (startMonth === 1 || m < startMonth ? y : y + 1) + 543;
}

export function expand(rec, fromYM, toYM) {
  if (!rec?.anchor || !/^\d{4}-(0[1-9]|1[0-2])$/.test(rec.anchor)) return [];
  const a = ymToIdx(rec.anchor);
  const lo = ymToIdx(fromYM);
  let hi = ymToIdx(toYM);
  if (rec.until) hi = Math.min(hi, ymToIdx(rec.until));
  if (!rec.every) return a >= lo && a <= hi ? [rec.anchor] : [];
  const out = [];
  for (let i = a + Math.max(0, Math.ceil((lo - a) / rec.every)) * rec.every; i <= hi; i += rec.every) out.push(idxToYm(i));
  return out;
}

export const addMonths = (ym, n) => idxToYm(ymToIdx(ym) + n);

export function recLabel(rec) {
  if (!rec) return '';
  if (rec.label) return rec.label;
  if (!rec.every) return '1x';
  return rec.every % 12 === 0 ? `${rec.every / 12}Y` : `${rec.every}M`;
}

export function recText(rec) {
  if (!rec) return '';
  if (!rec.every) return `ครั้งเดียว ${thMonthYear(rec.anchor)}`;
  const every = rec.every % 12 === 0 ? `${rec.every / 12} ปี/ครั้ง` : `${rec.every} เดือน/ครั้ง`;
  return `${every} เริ่ม ${thMonthYear(rec.anchor)}${rec.until ? ` ถึง ${thMonthYear(rec.until)}` : ''}`;
}

// derived status → chip style. "derived" adds overdue on top of the stored status.
export const STATUS = {
  planned:     { label: 'รอทำ',       chip: 'bg-sky-500 text-white' },
  in_progress: { label: 'กำลังทำ',    chip: 'bg-amber-400 text-amber-950' },
  done:        { label: 'เสร็จแล้ว',   chip: 'bg-emerald-600 text-white' },
  postponed:   { label: 'เลื่อน',      chip: 'bg-violet-500 text-white' },
  cancelled:   { label: 'ยกเลิก',     chip: 'bg-stone-300 text-stone-600 line-through' },
  overdue:     { label: 'เกินกำหนด',  chip: 'bg-red-600 text-white' },
};
export const EDITABLE_STATUSES = ['planned', 'in_progress', 'done', 'postponed', 'cancelled'];

export const FREQ_PRESETS = [
  { label: '1 ปี', every: 12 },
  { label: '2 ปี', every: 24 },
  { label: '3 ปี', every: 36 },
  { label: '5 ปี', every: 60 },
  { label: '6 เดือน', every: 6 },
  { label: 'ครั้งเดียว', every: 0 },
];
