const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.LV_DB_PATH || path.join(__dirname, '..', 'labventure.db');   // env override ใช้ตอน e2e test

let db;
let lastInit = null;   // { at, path, tables, created } — ตารางที่ initDb รอบล่าสุดเห็น/สร้าง (ใช้เทียบใน dbStatus)

const listTables = (d) => d.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(r => r.name);

// เรียกซ้ำได้ (ทุกคำสั่งเป็น IF NOT EXISTS / migration แบบตรวจก่อน) — dbHealth ใช้ซ่อมตารางที่หายตอน server รันอยู่
function initDb() {
  if (db) { try { db.close(); } catch {} }
  db = new Database(DB_PATH);
  const before = new Set(listTables(db));

  db.run(`
    CREATE TABLE IF NOT EXISTS scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      threshold_file TEXT NOT NULL,
      active INTEGER DEFAULT 0,
      activated_at TEXT,
      deactivated_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS car_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unique_key TEXT UNIQUE NOT NULL,
      car_number TEXT,
      parameter_name TEXT NOT NULL,
      configparam_id INTEGER,
      plant_id INTEGER,
      station_code TEXT,
      recorded_value REAL,
      threshold_value REAL,
      threshold_direction TEXT,
      scenario_id INTEGER REFERENCES scenarios(id),
      record_datetime TEXT NOT NULL,
      issued_at TEXT DEFAULT (datetime('now')),
      deadline_at TEXT,
      current_step TEXT DEFAULT 'issued',
      line_sent_at TEXT,
      notes TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS car_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      car_id INTEGER REFERENCES car_log(id),
      step TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      notes TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS node_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      param_key TEXT NOT NULL,
      trans_dtm TEXT NOT NULL,
      trans_time TEXT NOT NULL,
      trans_value TEXT,
      recorded_at TEXT DEFAULT (datetime('now')),
      UNIQUE(param_key, trans_dtm, trans_time)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS aquadat_snapshots (
      param_key   TEXT NOT NULL,
      trans_dtm   TEXT NOT NULL,
      trans_time  TEXT NOT NULL,
      trans_value TEXT,
      fetched_at  TEXT NOT NULL,
      PRIMARY KEY (param_key, trans_dtm, trans_time)
    )
  `);

  // Migration: new CAR status code system + form fields
  const carCols = db.all('PRAGMA table_info(car_log)').map(c => c.name);
  const newCarCols = {
    status_code: 'INTEGER DEFAULT 10',
    car_type: "TEXT DEFAULT 'CAR'",
    system_type: 'TEXT',
    issue_type: 'TEXT',
    issuer_name: 'TEXT',
    issuer_dept: 'TEXT',
    receiver_name: 'TEXT',
    receiver_dept: 'TEXT',
    form_data: 'TEXT',
    correction_deadline: 'TEXT',
    prevention_deadline: 'TEXT',
    followup2_deadline: 'TEXT',
    // ค่าที่พบหลายบรรทัด: JSON [{value, direction:'above'|'below', threshold, unit}]
    // (แถวแรกยัง mirror ลง recorded_value/threshold_* เดิม เพื่อ Event Class / Chem Lab / รายงานเก่า)
    findings: 'TEXT',
    // ผู้รับปัจจุบันเมื่อมีการส่งต่อ (status 15). NULL = ผู้รับตามข้อ 1.3 (receiver_name) ยังถือใบอยู่
    assignee_name: 'TEXT',
    assignee_dept: 'TEXT',
  };
  for (const [col, def] of Object.entries(newCarCols)) {
    if (!carCols.includes(col)) db.run(`ALTER TABLE car_log ADD COLUMN ${col} ${def}`);
  }
  // เลิกใช้สถานะ 45 "นำเข้าที่ประชุม" (ช่วงสั้น ๆ 17 พ.ย. 2569) → 50 + ป้าย s4_to_meeting
  for (const r of db.all('SELECT id, form_data FROM car_log WHERE status_code = 45')) {
    let fd = {};
    try { fd = JSON.parse(r.form_data || '{}'); } catch { /* keep {} */ }
    fd.s4_to_meeting = true;
    db.run("UPDATE car_log SET status_code = 50, current_step = 'validated', form_data = ? WHERE id = ?", [JSON.stringify(fd), r.id]);
    console.log(`[DB] car_log #${r.id}: status 45 → 50 (ประเด็นเข้าที่ประชุม)`);
  }
  // Migrate existing records to status_code
  db.run(`UPDATE car_log SET status_code = CASE current_step
    WHEN 'issued' THEN 10 WHEN 'responded' THEN 20 WHEN 'approved' THEN 30
    WHEN 'validated' THEN 50 WHEN 'closed' THEN 60 ELSE 10 END
    WHERE status_code IS NULL OR status_code = 0`);

  // car_whitelist — UNIQUE on (name, group_code) so one person can be in multiple groups
  db.run(`
    CREATE TABLE IF NOT EXISTS car_whitelist (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      group_code TEXT NOT NULL,
      shift      INTEGER,
      dept_label TEXT,
      is_admin   INTEGER DEFAULT 0,
      synced_at  TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(name, group_code)
    )
  `);
  // Migrate old UNIQUE(name) table → rebuild with UNIQUE(name, group_code) if needed
  try {
    const idxList = db.all("PRAGMA index_list(car_whitelist)");
    const hasOldUnique = idxList.some(i => i.unique && !i.name.includes('name_group'));
    if (hasOldUnique) {
      db.run('ALTER TABLE car_whitelist RENAME TO car_whitelist_old');
      db.run(`CREATE TABLE car_whitelist (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, group_code TEXT NOT NULL,
        shift INTEGER, dept_label TEXT, is_admin INTEGER DEFAULT 0,
        synced_at TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(name, group_code)
      )`);
      db.run(`INSERT OR IGNORE INTO car_whitelist SELECT * FROM car_whitelist_old`);
      db.run('DROP TABLE car_whitelist_old');
    }
  } catch {}

  // ChemHistory — chemical intake records from operator Top form
  db.run(`
    CREATE TABLE IF NOT EXISTS chem_history (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      truck             TEXT NOT NULL,
      delivery_book     TEXT,
      delivery_no       TEXT,
      sg                REAL,
      temperature       REAL,
      tank_a_before     REAL,
      tank_a_after      REAL,
      tank_b_before     REAL,
      tank_b_after      REAL,
      tank_c_before     REAL,
      tank_c_after      REAL,
      tank_d_before     REAL,
      tank_d_after      REAL,
      operator          TEXT,
      shift             TEXT,
      created_at        TEXT DEFAULT (datetime('now','localtime')),
      bottle_found      INTEGER,
      bottle_claimed_by TEXT,
      bottle_claimed_at TEXT
    )
  `);

  // Migration: add position_label to car_whitelist
  const wlCols = db.all('PRAGMA table_info(car_whitelist)').map(c => c.name);
  if (!wlCols.includes('position_label')) {
    db.run('ALTER TABLE car_whitelist ADD COLUMN position_label TEXT');
  }
  // Migration: รหัสผู้ใช้งาน AquaDAT (user_name) ของผู้ปฏิบัติงานที่ sync จาก AquaDAT
  if (!wlCols.includes('user_code')) {
    db.run('ALTER TABLE car_whitelist ADD COLUMN user_code TEXT');
  }

  // Migration: add chemical_type + stage columns to chem_history
  const chemCols = db.all('PRAGMA table_info(chem_history)').map(c => c.name);
  if (!chemCols.includes('chemical_type')) {
    db.run(`ALTER TABLE chem_history ADD COLUMN chemical_type TEXT`);
  }
  if (!chemCols.includes('record_date')) {
    db.run(`ALTER TABLE chem_history ADD COLUMN record_date TEXT`);
  }
  if (!chemCols.includes('is_completed')) {
    db.run(`ALTER TABLE chem_history ADD COLUMN is_completed INTEGER DEFAULT 0`);
  }
  if (!chemCols.includes('completed_at')) {
    db.run(`ALTER TABLE chem_history ADD COLUMN completed_at TEXT`);
  }
  // Backfill record_date from created_at for existing records
  db.run(`UPDATE chem_history SET record_date = date(created_at) WHERE record_date IS NULL`);
  // Records from before today are treated as completed (stage concept didn't exist)
  db.run(`UPDATE chem_history SET is_completed = 1, completed_at = created_at
    WHERE is_completed = 0 AND record_date < date('now','localtime')`);


  // Slot recorders — who submitted each shift on each date
  db.run(`
    CREATE TABLE IF NOT EXISTS slot_recorders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      trans_dtm      TEXT NOT NULL,
      shift_range    TEXT NOT NULL,
      recorder_name  TEXT NOT NULL,
      position_label TEXT,
      recorded_at    TEXT,
      UNIQUE(trans_dtm, shift_range)
    )
  `);

  // AquaDAT write failure queue — insert on fail, update status in-place, never delete
  db.run(`
    CREATE TABLE IF NOT EXISTS aquadat_queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at   TEXT NOT NULL,
      trans_dtm    TEXT NOT NULL,
      payload      TEXT NOT NULL,
      attempts     INTEGER DEFAULT 0,
      last_attempt TEXT,
      last_error   TEXT,
      status       TEXT DEFAULT 'pending'
    )
  `);

  // Excel write failure queue — mirrors aquadat_queue; payload is JSON array of node records
  db.run(`
    CREATE TABLE IF NOT EXISTS excel_queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at   TEXT NOT NULL,
      trans_dtm    TEXT NOT NULL,
      payload      TEXT NOT NULL,
      attempts     INTEGER DEFAULT 0,
      last_attempt TEXT,
      last_error   TEXT,
      status       TEXT DEFAULT 'pending'
    )
  `);

  // Operator widget placements — persists dashboard layout per user+station
  db.run(`
    CREATE TABLE IF NOT EXISTS op_widget_placements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      login_id   TEXT NOT NULL,
      station_id TEXT NOT NULL,
      widget_type TEXT NOT NULL,
      x          INTEGER DEFAULT 0,
      y          INTEGER DEFAULT 0,
      w          INTEGER DEFAULT 2,
      h          INTEGER DEFAULT 2,
      config     TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Algae species master list
  db.run(`
    CREATE TABLE IF NOT EXISTS algae_species (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      division     TEXT,
      species_name TEXT NOT NULL UNIQUE,
      category     TEXT,
      is_active    INTEGER DEFAULT 1,
      created_at   TEXT DEFAULT (datetime('now'))
    )
  `);

  // Weekly per-species algae recording
  db.run(`
    CREATE TABLE IF NOT EXISTS algae_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      record_date TEXT NOT NULL,
      station     TEXT NOT NULL,
      species_id  INTEGER NOT NULL REFERENCES algae_species(id),
      count       REAL,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(record_date, station, species_id)
    )
  `);

  // Seed algae species from JSON if table is empty
  const algaeCount = db.get('SELECT COUNT(*) as n FROM algae_species');
  if (algaeCount.n === 0) {
    const seedPath = path.join(__dirname, '..', 'config', 'algae_species_seed.json');
    if (fs.existsSync(seedPath)) {
      const seeds = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      for (const s of seeds) {
        db.run(
          'INSERT OR IGNORE INTO algae_species (division, species_name, category) VALUES (?, ?, ?)',
          [s.division || null, s.species_name, s.category || null]
        );
      }
      console.log(`Seeded ${seeds.length} algae species`);
    }
  }

  // Enforce permanent superadmin — always is_admin=1, cannot be stripped
  const SUPERADMIN = process.env.SUPERADMIN_NAME || 'นายพีรพัฒน์ สุขขารมย์';
  db.run(`UPDATE car_whitelist SET is_admin = 1 WHERE name = ?`, [SUPERADMIN]);

  // Seed scenarios — insert only if a row with this name does not already exist
  const allScenarios = [
    { name: 'ปกติ',                                   description: 'เกณฑ์มาตรฐานการผลิตน้ำปกติ',                           file: 'scenario_normal.json',       active: 1 },
    { name: 'น้ำดิบความขุ่นสูง',                      description: 'แผนฉุกเฉินกรณีน้ำดิบความขุ่นสูง — ท่าม่วง >150 NTU, TW ≤1 NTU', file: 'scenario_flood.json',        active: 0 },
    { name: 'น้ำด้อยคุณภาพระดับเฝ้าระวัง',           description: 'น้ำดิบด้อยคุณภาพ เฝ้าระวัง — CW Turbid ≤ 3 NTU',     file: 'scenario_flood_watch.json',  active: 0 },
    { name: 'น้ำด้อยคุณภาพระดับวิกฤติ',               description: 'น้ำดิบด้อยคุณภาพ วิกฤติ — CW Turbid ≤ 2 NTU',        file: 'scenario_flood_crisis.json', active: 0 },
    { name: 'สาหร่ายอุดตันบ่อกรองระดับเฝ้าระวัง',   description: 'สาหร่ายอุดตันบ่อกรอง เฝ้าระวัง — CW Turbid ≤ 3 NTU',  file: 'scenario_algae_watch.json',  active: 0 },
    { name: 'สาหร่ายอุดตันบ่อกรองระดับวิกฤติ',       description: 'สาหร่ายอุดตันบ่อกรอง วิกฤติ — CW Turbid ≤ 2 NTU',     file: 'scenario_algae_crisis.json', active: 0 },
  ];
  // ตามแผน SD-MS-HACCP-สกล-09: "น้ำขุ่น" → "น้ำดิบความขุ่นสูง" (คง id เดิม)
  db.run(`UPDATE scenarios SET name = 'น้ำดิบความขุ่นสูง', description = ? WHERE name = 'น้ำขุ่น' AND threshold_file = 'scenario_flood.json'`,
    [allScenarios[1].description]);
  // "สาหร่ายสูง" ซ้ำกับระดับเฝ้าระวัง — ลบเฉพาะเมื่อไม่ active และไม่มี CAR/Event Class อ้างถึง
  const dupAlgae = db.get(`SELECT id FROM scenarios WHERE name = 'สาหร่ายสูง' AND threshold_file = 'scenario_algae.json' AND active = 0`);
  if (dupAlgae) {
    let refs = db.get('SELECT COUNT(*) n FROM car_log WHERE scenario_id = ?', [dupAlgae.id]).n;
    try { refs += db.get('SELECT COUNT(*) n FROM event_classes WHERE scenario_id = ?', [dupAlgae.id]).n; } catch {}
    if (!refs) db.run('DELETE FROM scenarios WHERE id = ?', [dupAlgae.id]);
  }
  // Remove duplicate rows (same name) keeping the lowest id, then upsert missing ones
  db.run(`
    DELETE FROM scenarios WHERE id NOT IN (
      SELECT MIN(id) FROM scenarios GROUP BY name
    )
  `);
  for (const s of allScenarios) {
    const exists = db.get('SELECT id FROM scenarios WHERE name = ?', [s.name]);
    if (!exists) {
      db.run(
        'INSERT INTO scenarios (name, description, threshold_file, active) VALUES (?, ?, ?, ?)',
        [s.name, s.description, s.file, s.active]
      );
    }
  }

  // ── Daily Report tables (mirrors MH_report.db schema) ──────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS summary_table (
      DateKey TEXT NOT NULL,
      Shift INTEGER NOT NULL,
      DataDateTime TEXT NOT NULL,
      RWS_TotalF INTEGER,
      DPS_TotalF INTEGER,
      TPS INTEGER,
      CWT_Lvl24 REAL,
      CWT_minLvl REAL,
      CWT_maxLvl REAL,
      Cl_Total_tonuse REAL,
      Alum_Total_tonuse REAL,
      Pacl_Total_tonuse REAL,
      Polymer_Total_tonuse REAL,
      Cl_stock REAL,
      Alum_stock REAL,
      Pacl_stock REAL,
      Polymer_stock REAL,
      Cl_income REAL,
      Alum_income REAL,
      Pacl_income REAL,
      Polymer_income REAL,
      FRT_Avg REAL,
      PercentageFilterUse REAL,
      Chem_cost REAL,
      Energy_cost REAL,
      Sludge_disposal_cost REAL,
      Total_cost REAL,
      Sludge_drain_Total INTEGER,
      Wash_water_Total INTEGER,
      Service_water_F INTEGER,
      Water_loss REAL,
      Plant_Energy_USEtotal REAL,
      GeneratedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (DateKey, Shift)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS detail_table (
      DateKey TEXT NOT NULL PRIMARY KEY,
      ON_P1 INTEGER, ON_P2 INTEGER, ON_P3 INTEGER, ON_P4 INTEGER,
      STANDBY_P1 INTEGER, STANDBY_P2 INTEGER, STANDBY_P3 INTEGER, STANDBY_P4 INTEGER,
      REPAIR_P1 INTEGER, REPAIR_P2 INTEGER, REPAIR_P3 INTEGER, REPAIR_P4 INTEGER,
      WASHCOUNT_P1 INTEGER, WASHCOUNT_P2 INTEGER, WASHCOUNT_P3 INTEGER, WASHCOUNT_P4 INTEGER,
      RWS1_P1F INTEGER, RWS1_P2F INTEGER, RWS2_P3F INTEGER, RWS2_P4F INTEGER,
      RWS_maxLvl REAL, RWS_minLvl REAL,
      DPS_AF INTEGER, DPS_BF INTEGER,
      DPS_maxPresure REAL, DPS_minPresure REAL,
      TPS_maxPressure REAL, TPS_minPressure REAL,
      FRT_P1 REAL, FRT_P2 REAL, FRT_P3 REAL, FRT_P4 REAL,
      Wash_water_P1 INTEGER, Wash_water_P2 INTEGER, Wash_water_P3 INTEGER, Wash_water_P4 INTEGER,
      Sludge_drain_P1 INTEGER, Sludge_drain_P2 INTEGER, Sludge_drain_P3 INTEGER, Sludge_drain_P4 INTEGER,
      Energy_SS1A REAL, Energy_SS1B REAL, Energy_SS2A REAL, Energy_SS2B REAL,
      Energy_SS3A REAL, Energy_SS3B REAL, Energy_SS3 REAL, Energy_total REAL,
      alum_baht REAL, pacl_baht REAL, chlorine_baht REAL, polymer_baht REAL,
      alum_ton REAL, pacl_ton REAL, chlorine_ton REAL, polymer_ton REAL,
      Cl_P12_stock REAL, Cl_P34_stock REAL,
      Alum_P12_stock REAL, Alum_P34_stock REAL,
      PACl_P12_stock REAL, PACl_P34_stock REAL,
      PreCl_P1tonuse REAL, PreCl_P2tonuse REAL, PreCl_P3tonuse REAL, PreCl_P4tonuse REAL,
      PosCl_P1tonuse REAL, PosCl_P2tonuse REAL, PosCl_P3tonuse REAL, PosCl_P4tonuse REAL,
      Alum_P1tonuse REAL, Alum_P2tonuse REAL, Alum_P3tonuse REAL, Alum_P4tonuse REAL,
      Pacl_P1tonuse REAL, Pacl_P2tonuse REAL, Pacl_P3tonuse REAL, Pacl_P4tonuse REAL,
      PreCl_P1targer_dose REAL, PreCl_P2targer_dose REAL, PreCl_P3targer_dose REAL, PreCl_P4targer_dose REAL,
      PosCl_P1targer_dose REAL, PosCl_P2targer_dose REAL, PosCl_P3targer_dose REAL, PosCl_P4targer_dose REAL,
      Pacl_P1targer_dose REAL, Pacl_P2targer_dose REAL, Pacl_P3targer_dose REAL, Pacl_P4targer_dose REAL,
      Alum_P1targer_dose REAL, Alum_P2targer_dose REAL, Alum_P3targer_dose REAL, Alum_P4targer_dose REAL,
      PreCl_P1actual_dose REAL, PreCl_P2actual_dose REAL, PreCl_P3actual_dose REAL, PreCl_P4actual_dose REAL,
      PosCl_P1actual_dose REAL, PosCl_P2actual_dose REAL, PosCl_P3actual_dose REAL, PosCl_P4actual_dose REAL,
      Pacl_P1actual_dose REAL, Pacl_P2actual_dose REAL, Pacl_P3actual_dose REAL, Pacl_P4actual_dose REAL,
      Alum_P1actual_dose REAL, Alum_P2actual_dose REAL, Alum_P3actual_dose REAL, Alum_P4actual_dose REAL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS param_meta (
      param_key  TEXT NOT NULL PRIMARY KEY,
      param_name TEXT NOT NULL,
      unit       TEXT
    )
  `);

  // Event Class — alarm authoring (Re-plan Overview §3.1). Uroboros pulls GET /api/eventclass?enabled=true.
  // JSON columns: source_metric (string | {kind,configparam_id}), rule, message_template (array), ui
  db.run(`
    CREATE TABLE IF NOT EXISTS event_classes (
      event_class_id   TEXT PRIMARY KEY,
      title            TEXT,
      category         TEXT,
      severity         TEXT NOT NULL DEFAULT 'warning',
      source_metric    TEXT NOT NULL,
      rule             TEXT NOT NULL,
      audio_mode       TEXT NOT NULL DEFAULT 'B',
      message_template TEXT NOT NULL DEFAULT '[]',
      fallback_text    TEXT,
      ui               TEXT NOT NULL DEFAULT '{"type":"value"}',
      zone             TEXT,
      enabled          INTEGER NOT NULL DEFAULT 1,
      scenario_id      INTEGER,
      created_at       TEXT,
      updated_at       TEXT,
      updated_by       TEXT
    )
  `);
  // P3: what to do with CAR when the class fires — none | suggest (person issues from a draft) | auto
  const ecCols = db.all('PRAGMA table_info(event_classes)').map(c => c.name);
  if (!ecCols.includes('car_policy')) db.run("ALTER TABLE event_classes ADD COLUMN car_policy TEXT NOT NULL DEFAULT 'suggest'");
  if (!ecCols.includes('car_prefix')) db.run("ALTER TABLE event_classes ADD COLUMN car_prefix TEXT NOT NULL DEFAULT 'CQ'");
  // alarm แบบอ้างอิงเกณฑ์ควบคุม (rule.ref) — พารามิเตอร์ใน scenario_*.json ที่ใช้หาค่า UCL/LCL
  if (!ecCols.includes('param_key')) db.run('ALTER TABLE event_classes ADD COLUMN param_key TEXT');

  // One row per alarm episode seen on Uroboros /api/alarm/state (services/alarmWatcher.js).
  // An episode stays open while Uroboros reports it active; car_status tracks the CAR follow-up.
  db.run(`
    CREATE TABLE IF NOT EXISTS event_occurrences (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      event_class_id TEXT NOT NULL,
      alarm_id       TEXT NOT NULL,
      since          TEXT,
      first_seen_at  TEXT NOT NULL,
      last_seen_at   TEXT NOT NULL,
      cleared_at     TEXT,
      severity       TEXT,
      value_first    REAL,
      value_last     REAL,
      value_worst    REAL,
      unit           TEXT,
      car_status     TEXT NOT NULL DEFAULT 'none',
      car_key        TEXT,
      car_note       TEXT,
      car_by         TEXT,
      car_at         TEXT
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS ix_event_occ_open ON event_occurrences (alarm_id, cleared_at)');
  // สถานการณ์ + เกณฑ์ ณ ตอนเกิด (CAR ต้องใช้ค่านี้ ไม่ใช่สถานการณ์ตอนออก CAR) และเหตุที่ปิด episode
  //   clear_reason: recovered | scenario_change | class_disabled | vanished
  const occCols = db.all('PRAGMA table_info(event_occurrences)').map(c => c.name);
  for (const [col, def] of [['scenario_id', 'INTEGER'], ['threshold_value', 'REAL'],
    ['scenario_changed', 'INTEGER NOT NULL DEFAULT 0'], ['clear_reason', 'TEXT'],
    ['is_test', 'INTEGER NOT NULL DEFAULT 0']]) {   // is_test: alarm จากค่าปลอมของ test mode (Uroboros item.test)
    if (!occCols.includes(col)) db.run(`ALTER TABLE event_occurrences ADD COLUMN ${col} ${def}`);
  }

  // ประวัติการเปลี่ยนสถานการณ์ (ประกาศ/ยกเลิกภาวะฉุกเฉิน) — routes/scenarios.js PUT /:id/activate
  db.run(`
    CREATE TABLE IF NOT EXISTS scenario_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id     INTEGER,
      to_id       INTEGER NOT NULL,
      actor       TEXT,
      note        TEXT,
      sync_result TEXT,
      at          TEXT NOT NULL
    )
  `);
  // is_test: เปลี่ยนจาก test mode ของหน้า /config (super admin) — ใช้หา "สถานการณ์ก่อนทดสอบ" เพื่อคืนค่า
  if (!db.all('PRAGMA table_info(scenario_log)').some(c => c.name === 'is_test')) {
    db.run('ALTER TABLE scenario_log ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0');
  }

  // ประวัติเกณฑ์แบบมีโครงสร้าง (แทน scenario_log ที่เลิกเขียนแล้ว — services/scenarioHistory.js)
  // scenario_periods: ช่วงเวลาที่สถานการณ์ + rev ของเกณฑ์ + โหมดโรคระบาด มีผล (ended_at NULL = ช่วงปัจจุบัน)
  // scenario_period_thresholds: เกณฑ์ของสถานการณ์ต่อ rev (scenario_id 0 = ชุดเกณฑ์โหมดโรคระบาด) — rev ไม่ถูกแก้ทับ
  db.run(`
    CREATE TABLE IF NOT EXISTS scenario_periods (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id  INTEGER NOT NULL,
      rev          INTEGER NOT NULL,
      epidemic     INTEGER NOT NULL DEFAULT 0,
      epidemic_rev INTEGER,
      started_at   TEXT NOT NULL,
      ended_at     TEXT,
      reason       TEXT NOT NULL,
      actor        TEXT,
      note         TEXT,
      is_test      INTEGER NOT NULL DEFAULT 0,
      sync_result  TEXT,
      source       TEXT NOT NULL DEFAULT 'live'
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_scenario_periods_start ON scenario_periods(started_at)');
  db.run(`
    CREATE TABLE IF NOT EXISTS scenario_period_thresholds (
      scenario_id INTEGER NOT NULL,
      rev         INTEGER NOT NULL,
      param_key   TEXT NOT NULL,
      lcl         REAL,
      ucl         REAL,
      created_at  TEXT NOT NULL,
      actor       TEXT,
      PRIMARY KEY (scenario_id, rev, param_key)
    )
  `);

  // Project management (หน้าแผนงาน, services/pm.js). Tasks store a recurrence RULE; the Gantt cells are
  // expanded from it. pm_occurrences is sparse: only rows with an exception (status / moved month / actual).
  db.run(`
    CREATE TABLE IF NOT EXISTS pm_plans (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT UNIQUE,
      title          TEXT NOT NULL,
      org_unit       TEXT,
      fy_start_month INTEGER NOT NULL DEFAULT 10,
      forecast_years INTEGER NOT NULL DEFAULT 4,
      archived       INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT,
      updated_at     TEXT,
      updated_by     TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS pm_tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id     INTEGER NOT NULL,
      parent_id   INTEGER,
      wbs         TEXT,
      title       TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('group','task')),
      sort_order  REAL NOT NULL DEFAULT 0,
      recurrence  TEXT,
      qty         INTEGER,
      unit        TEXT,
      owner       TEXT,
      note        TEXT,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT,
      updated_at  TEXT,
      updated_by  TEXT
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS ix_pm_tasks_plan ON pm_tasks (plan_id, parent_id, sort_order)');
  db.run(`
    CREATE TABLE IF NOT EXISTS pm_occurrences (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id       INTEGER NOT NULL,
      due_month     TEXT NOT NULL,
      planned_month TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'planned',
      actual_start  TEXT,
      actual_end    TEXT,
      done_by       TEXT,
      remark        TEXT,
      created_at    TEXT,
      updated_at    TEXT,
      updated_by    TEXT,
      UNIQUE (task_id, due_month)
    )
  `);
  // Evidence files (server/data/pm_files/<task_id>/<stored_name>). due_month NULL = task-level (reserved).
  db.run(`
    CREATE TABLE IF NOT EXISTS pm_attachments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL,
      due_month   TEXT,
      file_name   TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime        TEXT,
      size        INTEGER,
      uploaded_by TEXT,
      uploaded_at TEXT,
      deleted_at  TEXT,
      deleted_by  TEXT
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS ix_pm_attach_occ ON pm_attachments (task_id, due_month)');
  db.run(`
    CREATE TABLE IF NOT EXISTS pm_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity      TEXT NOT NULL,
      entity_id   INTEGER,
      action      TEXT NOT NULL,
      before_json TEXT,
      after_json  TEXT,
      actor       TEXT,
      at          TEXT
    )
  `);

  db.run('CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT)');
  const tables = listTables(db);
  const created = tables.filter(t => !before.has(t) && t !== 'db_meta');
  // event_classes เพิ่งถูกสร้าง = ตารางว่าง (ไฟล์ DB เก่า/ถูกวางทับ) → ห้ามส่งรายการว่างให้ Uroboros
  // ไม่งั้น cache Event Class ใน Uroboros ถูกล้างเป็น 0 และ alarm แลปหยุด — ดู eventClassesRecreatedAt()
  if (created.includes('event_classes'))
    db.run("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('event_classes_recreated_at', ?)", [nowTH()]);
  lastInit = { at: nowTH(), path: DB_PATH, tables, created };
  console.log(`[DB] ${DB_PATH} — ${tables.length} tables`);
  if (before.size && created.length)
    console.warn(`[DB] ไฟล์ DB ไม่มีตาราง ${created.join(', ')} — สร้างใหม่เป็นตารางว่างแล้ว (ไฟล์อาจเป็นรุ่นเก่าหรือถูกวางทับ)`);

  return db;
}

function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

// ตารางที่ initDb รอบล่าสุดมี เทียบกับไฟล์ตอนนี้ — missing ไม่ว่าง = ไฟล์ถูกเปลี่ยน/วางทับหลัง server เปิด
function dbStatus() {
  const expected = lastInit?.tables || [];
  let present = [];
  let error = null;
  try { present = listTables(getDb()); } catch (e) { error = e.message; }
  const missing = expected.filter(t => !present.includes(t));
  return { ok: !error && missing.length === 0, path: DB_PATH, table_count: present.length, missing, error, last_init: lastInit };
}

// เวลาที่ event_classes ถูกสร้างใหม่เป็นตารางว่าง (null = ปกติ). ปลดเองเมื่อมี class อย่างน้อย 1 แถว (เปิดหรือปิดก็ได้)
function eventClassesRecreatedAt() {
  try {
    const at = db.get("SELECT value FROM db_meta WHERE key = 'event_classes_recreated_at'")?.value;
    if (!at) return null;
    if (db.get('SELECT COUNT(*) AS n FROM event_classes').n > 0) {
      db.run("DELETE FROM db_meta WHERE key = 'event_classes_recreated_at'");
      return null;
    }
    return at;
  } catch { return null; }
}

// node-sqlite3-wasm writes directly to file — no manual persist needed
function persist() {}

// Current time as ISO 8601 in GMT+7 (e.g. "2026-07-01T13:44:08.935+07:00")
function nowTH() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace('Z', '+07:00');
}

module.exports = { initDb, getDb, persist, nowTH, dbStatus, eventClassesRecreatedAt };
