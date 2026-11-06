// /api/health — สถานะ DB (ไฟล์ที่เปิดอยู่จริง, ตารางที่ขาด, Event Class) — อ่านได้ไม่ต้อง login เหมือน /api/eventclass
const express = require('express');
const router = express.Router();
const dbHealth = require('../services/dbHealth');

// GET /api/health/db → { ok, path, table_count, missing, event_classes: { rows, enabled, recreated_at }, last_init, last_repair }
router.get('/db', (req, res) => {
  const st = dbHealth.status();
  res.status(st.ok ? 200 : 503).json(st);
});

// POST /api/health/db/repair → ซ่อมทันที (ปกติทำเองทุก 60 วิ) — สร้างแค่ตารางที่ขาด ไม่ลบข้อมูล
router.post('/db/repair', (req, res) => {
  dbHealth.ensureDb('manual repair');
  const st = dbHealth.status();
  res.status(st.ok ? 200 : 503).json(st);
});

module.exports = router;
