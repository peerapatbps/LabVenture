// "ค่าที่พบ" ของ CAR ได้หลายบรรทัด: [{ value, direction: 'above'|'below', threshold, unit }]
// เก็บเป็น JSON ใน car_log.findings; แถวแรก mirror ลงคอลัมน์เดิม (recorded_value / threshold_value / threshold_direction)
// CAR เก่าที่ไม่มี findings → สร้างจากคอลัมน์เดิม (ไม่มีหน่วย)

const num = v => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// รับ input จาก client / draft → array สะอาด (ทิ้งแถวที่ไม่มีทั้งค่าและเกณฑ์)
function normalizeFindings(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map(r => ({
      value: num(r?.value),
      direction: r?.direction === 'below' ? 'below' : 'above',
      threshold: num(r?.threshold),
      unit: String(r?.unit || '').trim(),
    }))
    .filter(r => r.value != null || r.threshold != null);
}

// อ่านจากแถว car_log
function getFindings(car) {
  try {
    const arr = JSON.parse(car?.findings || 'null');
    if (Array.isArray(arr) && arr.length) return arr;
  } catch { /* fall through */ }
  if (car?.recorded_value != null) {
    return [{
      value: car.recorded_value,
      direction: car.threshold_direction === 'below' ? 'below' : 'above',
      threshold: car.threshold_value ?? null,
      unit: '',
    }];
  }
  return [];
}

// symbols: 'math' → ≤ / ≥ (LINE, หน้าเว็บ) · 'thai' → ไม่เกิน / ไม่ต่ำกว่า (ฟอร์ม Excel — ฟอนต์ไทยไม่มี glyph ≤ ≥)
function formatFinding(f, symbols = 'math') {
  const u = f.unit ? ` ${f.unit}` : '';
  const dir = symbols === 'thai'
    ? (f.direction === 'below' ? 'ไม่ต่ำกว่า' : 'ไม่เกิน')
    : (f.direction === 'below' ? '≥' : '≤');
  const val = f.value != null ? `${f.value}${u}` : '—';
  return f.threshold != null ? `${val} (เกณฑ์ ${dir} ${f.threshold}${u})` : val;
}

module.exports = { normalizeFindings, getFindings, formatFinding };
