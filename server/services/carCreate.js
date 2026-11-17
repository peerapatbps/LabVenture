// Shared CAR creation — used by POST /api/car and by chem-lab (fail → CAR)
const { getDb, persist, nowTH } = require('./db');
const { pushCarMessage } = require('./line');
const { v4: uuidv4 } = require('uuid');
const { normalizeFindings } = require('./carFindings');

function addWorkingDays(dateStr, days) {
  const d = new Date(dateStr);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

// ── CAR/PAR number: "<PREFIX> <NN>/<fiscal year BE>", running per prefix × car_type, reset every fiscal year ─
// HA/EA/OA = internal audit HACCP/ISO14001/ISO45001 · CC = process-control NC · CQ = water-quality NC · LC = legal
const CAR_PREFIXES = ['HA', 'EA', 'OA', 'CC', 'CQ', 'LC'];

// Thai fiscal year: 1 Oct (Gregorian year Y) starts FY (Y + 1) → in BE
function fiscalYearBE(isoTH) {
  const y = Number(isoTH.slice(0, 4)), m = Number(isoTH.slice(5, 7));
  return y + 543 + (m >= 10 ? 1 : 0);
}

function nextCarNumber(db, prefix, carType, fy = fiscalYearBE(nowTH())) {
  if (!CAR_PREFIXES.includes(prefix)) throw Object.assign(new Error(`รหัส CAR ไม่ถูกต้อง (${prefix})`), { status: 400 });
  const re = new RegExp(`^${prefix} (\\d+)/${fy}$`);
  const rows = db.all('SELECT car_number FROM car_log WHERE car_type = ? AND car_number LIKE ?', [carType, `${prefix} %/${fy}`]);
  const max = rows.reduce((m, r) => Math.max(m, Number(re.exec(r.car_number)?.[1] || 0)), 0);
  return `${prefix} ${String(max + 1).padStart(2, '0')}/${fy}`;
}

// fields: same shape as POST /api/car body (+ car_prefix → auto number when car_number is blank);
// issuer: { name, dept } (locked identity, optional). Throws {status} 400/409 on bad prefix / duplicate number.
async function createCar(fields, issuer = {}) {
  const db = getDb();
  const {
    car_prefix, car_type, system_type, issue_type,
    parameter_name, issuer_name, issuer_dept, receiver_name, receiver_dept,
    configparam_id, plant_id, station_code,
    recorded_value, threshold_value, threshold_direction, scenario_id,
    record_datetime, notes,
  } = fields;

  // ค่าที่พบหลายบรรทัด (findings[]) — ถ้า caller เก่า (Event Class / Chem Lab) ส่งแค่ค่าเดียว ก็ห่อเป็น 1 บรรทัด
  let findings = normalizeFindings(fields.findings);
  if (!findings.length) {
    findings = normalizeFindings([{
      value: recorded_value, direction: threshold_direction, threshold: threshold_value, unit: fields.unit,
    }]);
  }
  const f0 = findings[0] || null;   // mirror แถวแรกลงคอลัมน์เดิม

  // number + insert run with no await in between → no other request can take the same number
  const type = car_type || 'CAR';
  let car_number = String(fields.car_number || '').trim() || null;
  if (!car_number && car_prefix) car_number = nextCarNumber(db, car_prefix, type);
  if (car_number && db.get('SELECT id FROM car_log WHERE car_number = ? AND car_type = ?', [car_number, type])) {
    throw Object.assign(new Error(`เลข ${type} ${car_number} ถูกใช้แล้ว`), { status: 409 });
  }

  const unique_key = uuidv4().split('-')[0] + '-' + uuidv4().split('-')[1];
  const deadline_at = addWorkingDays(nowTH(), 10);

  db.run(
    `INSERT INTO car_log
      (unique_key, car_number, car_type, system_type, issue_type,
       parameter_name, issuer_name, issuer_dept, receiver_name, receiver_dept,
       configparam_id, plant_id, station_code,
       recorded_value, threshold_value, threshold_direction, scenario_id,
       record_datetime, deadline_at, notes, findings, status_code)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,10)`,
    [
      unique_key, car_number, type, system_type || null, issue_type || null,
      parameter_name, issuer.name || issuer_name || null, issuer.dept || issuer_dept || null,
      receiver_name || null, receiver_dept || null,
      configparam_id || null, plant_id || null, station_code || null,
      f0?.value ?? null, f0?.threshold ?? null, f0 ? f0.direction : (threshold_direction || null), scenario_id || null,
      record_datetime, deadline_at, notes || null,
      findings.length ? JSON.stringify(findings) : null,
    ]
  );

  const car = db.get('SELECT * FROM car_log WHERE unique_key = ?', [unique_key]);

  let line_sent_at = null;
  try {
    if (await pushCarMessage(car, 10)) {
      line_sent_at = nowTH();
      db.run('UPDATE car_log SET line_sent_at = ? WHERE id = ?', [line_sent_at, car.id]);
    }
  } catch (e) {
    console.warn('[CAR] LINE push failed:', e.message);
  }

  persist();
  return { car_id: car.id, unique_key, car_number, deadline_at, line_sent_at };
}

module.exports = { createCar, addWorkingDays, nextCarNumber, fiscalYearBE, CAR_PREFIXES };
