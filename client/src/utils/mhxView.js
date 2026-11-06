// กลับไปหน้า MHxView ของ BellBeast
// ผ่าน proxy (:443/labventure) → path เดียวกัน origin เดียวกัน
// เปิด LabVenture ตรงพอร์ตตัวเอง (8889 / vite dev) → ชี้ไป BellBeast ที่ :443 ของเครื่องเดียวกัน
const MHXVIEW_PATH = '/MHxViewer/MHxView';

export function mhxViewUrl() {
  const { protocol, hostname, port, pathname } = window.location;
  const viaBellBeast = pathname.startsWith('/labventure') && port !== '8889';
  return viaBellBeast ? MHXVIEW_PATH : `${protocol}//${hostname}:443${MHXVIEW_PATH}`;
}
