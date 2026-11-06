// CAR/PAR number prefix (server assigns "<PREFIX> NN/<ปีงบ>" when car_number is left blank) — server: services/carCreate.js
export const CAR_PREFIXES = [
  ['HA', 'ตรวจติดตามคุณภาพภายใน HACCP'],
  ['EA', 'ตรวจติดตามคุณภาพภายใน ISO14001'],
  ['OA', 'ตรวจติดตามคุณภาพภายใน ISO45001'],
  ['CC', 'ไม่สอดคล้องด้านการควบคุมกระบวนการ HACCP/ISO14001/ISO45001'],
  ['CQ', 'ไม่สอดคล้องด้านการควบคุมคุณภาพน้ำระบบผลิต'],
  ['LC', 'ไม่ปฏิบัติตามกฎหมาย'],
];
