// วันที่อ้างอิงที่ใช้ร่วมกันระหว่างหน้า (Dashboard / Record / OpDashboard / OpRecord)
// เก็บไว้ใน memory เท่านั้น → ทุกครั้งที่โหลดหน้าใหม่ (เปิด browser / F5) จะกลับเป็นวันปัจจุบันเสมอ
// เพื่อป้องกันการบันทึกผิดวัน; ถ้าผู้ใช้เปลี่ยนวันที่ จะคงอยู่เฉพาะระหว่างสลับหน้าภายในแอป

let refDate = null;

// URL ตอนโหลดหน้า — ถ้า ?date= มากับการโหลดหน้า (F5 / bookmark) จะไม่ใช้
const loadHref = window.location.href;

// ล้าง cookie เดิม (เวอร์ชันก่อนเก็บวันที่ไว้ใน cookie 30 วัน)
document.cookie = 'reference_date=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';

function todayStr() {
  // Thai time UTC+7
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

export function getRefDate() {
  return refDate ?? todayStr();
}

export function setRefDate(date) {
  refDate = date;
}

// ใช้ ?date= จาก URL เฉพาะเมื่อมาจากการ navigate ภายในแอป ไม่ใช่จากการโหลดหน้า
export function initRefDate(urlDate) {
  if (urlDate && window.location.href !== loadHref) setRefDate(urlDate);
  return getRefDate();
}

export function isToday(date) {
  return date === todayStr();
}

// YYYY-MM-DD → DD/MM/พ.ศ.
export function fmtThaiDate(d) {
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${Number(y) + 543}`;
}

export function todayThai() {
  return fmtThaiDate(todayStr());
}

// ยืนยันก่อนบันทึก ถ้าวันที่ที่จะบันทึกไม่ใช่วันปัจจุบัน — คืน true ถ้าเป็นวันนี้หรือผู้ใช้กดยืนยัน
export function confirmNonToday(date) {
  if (date === todayStr()) return true;
  const fmt = fmtThaiDate;
  return window.confirm(
    `⚠️ วันที่ที่จะบันทึก (${fmt(date)}) ไม่ใช่วันปัจจุบัน (${fmt(todayStr())})\n\nต้องการบันทึกลงวันที่ ${fmt(date)} ใช่หรือไม่?`
  );
}
