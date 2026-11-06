// Chem-lab (รับสารเคมี) — shared constants for /chem-intake tabs

export const CHEM_STYLE = {
  PACL: { label: 'PACl', dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-800 border-amber-300', header: 'bg-amber-500', text: 'text-amber-700' },
  ALUM: { label: 'Alum', dot: 'bg-blue-600',  pill: 'bg-blue-100 text-blue-800 border-blue-300',     header: 'bg-blue-600',  text: 'text-blue-700' },
};

// supplier_coa: shown for old rows only — COA is a hard copy checked at receiving (not recorded here any more)
export const TEST_SOURCE = {
  inhouse:      { label: 'ทดสอบเอง (SD-MS-HACCP-สคบ-02)', short: 'ทดสอบเอง' },
  external_lab: { label: 'ห้องปฏิบัติการภายนอก',           short: 'Lab ภายนอก' },
  supplier_coa: { label: 'ผลวิเคราะห์จากผู้ขาย (COA)',      short: 'COA ผู้ขาย' },
};

// Which trips a failed composite compensates
export const CASE_SCOPE = {
  composite: { label: 'เฉพาะคันที่อยู่ในขวดผสมนี้', short: 'ตามขวดผสม' },
  day:       { label: 'ทุกคันของวันนั้น (บริษัทเดียวกัน)', short: 'ทั้งวัน' },
  custom:    { label: 'เลือกคันเอง', short: 'เลือกเอง' },
};

export const EXT_STATUS = {
  sent:      { label: 'รอผล',       cls: 'bg-amber-100 text-amber-800' },
  resulted:  { label: 'ได้ผลแล้ว',   cls: 'bg-teal-100 text-teal-700' },
  cancelled: { label: 'ยกเลิก',      cls: 'bg-earth-card text-earth-ink3' },
};

// Result input box: red = out of spec, green = within spec
export function verdictInputCls(v) {
  if (v === 'fail') return 'border-2 border-red-500 bg-red-50 text-red-700 font-bold focus:ring-red-400';
  if (v === 'pass') return 'border-2 border-green-600 bg-green-50 text-green-800 focus:ring-green-500';
  return '';
}

export const compositeLabel = (c) => `ขวดผสมใบที่ ${c.seq}`;

export const VERDICT_STYLE = {
  pass:    { label: 'ผ่าน',      cls: 'bg-teal-100 text-teal-700' },
  fail:    { label: 'ไม่ผ่าน',   cls: 'bg-red-100 text-red-700' },
  pending: { label: 'รอผล',      cls: 'bg-amber-100 text-amber-700' },
};

export const CASE_STATUS = {
  open:      { label: 'เปิดอยู่',  cls: 'bg-red-100 text-red-700' },
  closed:    { label: 'ปิดแล้ว',   cls: 'bg-teal-100 text-teal-700' },
  cancelled: { label: 'ยกเลิก',    cls: 'bg-earth-card text-earth-ink3' },
};

// tabs: roles = who sees the tab (null role = unrestricted → sees all; superadmin sees all via hasRole)
// Receiving, mixing and analysis are separate tabs (different people may do each step)
const SCI = ['scientist', 'observer'];
export const TABS = [
  { key: 'pipeline', label: 'ภาพรวม',          icon: '🧪', roles: [...SCI, 'operator'] },
  { key: 'bottles',  label: 'รับขวด',           icon: '📦', roles: SCI },
  { key: 'mix',      label: 'ผสมตัวอย่าง',       icon: '⚗️', roles: SCI },
  { key: 'analysis', label: 'ผลวิเคราะห์',       icon: '🔬', roles: SCI },
  { key: 'external', label: 'Lab ภายนอก',       icon: '🏛️', roles: SCI },
  { key: 'memo',     label: 'รายงาน สคบ-14',   icon: '📄', roles: SCI },
  { key: 'cases',    label: 'เคสชดเชย',        icon: '🚩', roles: [...SCI, 'operator'] },
  { key: 'offset',   label: 'ตัดยอดชดเชย',     icon: '✂️', roles: ['operator'] },
];
// old tab keys (bookmarks) → new tab
export const LEGACY_TABS = {};

// Stage of one sample group (day × chemical × company) — derived from /pipeline data (its composites).
// The group sits in the stage of its least advanced composite. Every stage can be stepped back with a reason.
export const STAGES = [
  { key: 'receive', no: 1, label: 'รับขวด / ผสม',        hint: 'รับขวดแล้วสร้างขวดผสม',        dot: 'bg-stone-400',  head: 'border-stone-400' },
  { key: 'ready',   no: 2, label: 'รอวิเคราะห์',         hint: 'มีขวดผสม ยังไม่มีผล',          dot: 'bg-sky-500',    head: 'border-sky-500' },
  { key: 'testing', no: 3, label: 'กำลังวิเคราะห์',       hint: 'มีผล / ส่ง Lab — รอเลือก final', dot: 'bg-amber-500',  head: 'border-amber-500' },
  { key: 'case',    no: 4, label: 'ไม่ผ่าน · เคสชดเชย',   hint: 'ตัดยอดชดเชยให้ครบ',            dot: 'bg-red-500',    head: 'border-red-500' },
  { key: 'final',   no: 5, label: 'สรุปผลแล้ว',          hint: 'รอออก สคบ-14',                 dot: 'bg-teal-600',   head: 'border-teal-600' },
  { key: 'memo',    no: 6, label: 'ออก สคบ-14 แล้ว',      hint: 'ครบขั้นตอน',                   dot: 'bg-indigo-500', head: 'border-indigo-500' },
];
export const STAGE_BY_KEY = Object.fromEntries(STAGES.map(s => [s.key, s]));

export function compositeStage(c) {
  if (c.memo_id) return 'memo';
  if (c.final_attempt_id) return c.case?.status === 'open' ? 'case' : 'final';
  return c.attempts > 0 || c.ext_pending > 0 ? 'testing' : 'ready';
}

export function stageOf(g) {
  const comps = g.composites || [];
  if (!comps.length) return 'receive';
  const stages = comps.map(compositeStage);
  for (const s of ['ready', 'testing', 'case', 'final']) if (stages.includes(s)) return s;
  return 'memo';
}

export const groupKey = (date, chemical, company) => `${date}|${chemical}|${company}`;
export function parseGroupKey(k) {
  const [date, chemical, company] = String(k || '').split('|');
  return date && chemical && company ? { date, chemical, company } : null;
}

export const todayTH = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtNum(v, digits = 0) {
  if (v === null || v === undefined || v === '') return '—';
  return Number(v).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtTs(ts) {
  if (!ts) return '—';
  // "2026-09-27T10:00:00.000+07:00" → "27/09 10:00"
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : ts;
}

export function specRange(p) {
  if (p.min != null && p.max != null) return `${p.min} – ${p.max}`;
  if (p.min != null) return `≥ ${p.min}`;
  if (p.max != null) return `≤ ${p.max}`;
  return '—';
}

export function paramVerdict(p, raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return 'fail';
  if (p.min != null && v < p.min) return 'fail';
  if (p.max != null && v > p.max) return 'fail';
  return 'pass';
}
