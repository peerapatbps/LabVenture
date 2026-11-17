// หน่วยของ "ค่าที่พบ / เกณฑ์" ในฟอร์มออก CAR (dropdown). 5 ตัวแรกตรงกับ params.json; ที่เหลือเป็นหน่วยที่ใช้บ่อยในโรงงาน
// ไม่มีในลิสต์ → เลือก "อื่นๆ" แล้วพิมพ์เอง
export const CAR_UNITS = [
  'NTU', 'mg/L', 'µS/cm', '°C', 'CFU/100mL',
  'pH', '%', 'ppm', 'm³/hr', 'm³/s', 'bar', 'm', 'mV',
];
export const CAR_UNIT_OTHER = '__other__';
