const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'labventure.db');

let db;

function initDb() {
  db = new Database(DB_PATH);

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
  };
  for (const [col, def] of Object.entries(newCarCols)) {
    if (!carCols.includes(col)) db.run(`ALTER TABLE car_log ADD COLUMN ${col} ${def}`);
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
    { name: 'น้ำขุ่น',                                description: 'ผ่อนเกณฑ์ความขุ่น เพิ่ม Alum/PACl สูง',               file: 'scenario_flood.json',        active: 0 },
    { name: 'สาหร่ายสูง',                             description: 'เฝ้าระวัง Algae — เกณฑ์คลอรีนเข้มขึ้น',               file: 'scenario_algae.json',        active: 0 },
    { name: 'น้ำด้อยคุณภาพระดับเฝ้าระวัง',           description: 'น้ำดิบด้อยคุณภาพ เฝ้าระวัง — CW Turbid ≤ 3 NTU',     file: 'scenario_flood_watch.json',  active: 0 },
    { name: 'น้ำด้อยคุณภาพระดับวิกฤติ',               description: 'น้ำดิบด้อยคุณภาพ วิกฤติ — CW Turbid ≤ 2 NTU',        file: 'scenario_flood_crisis.json', active: 0 },
    { name: 'สาหร่ายอุดตันบ่อกรองระดับเฝ้าระวัง',   description: 'สาหร่ายอุดตันบ่อกรอง เฝ้าระวัง — CW Turbid ≤ 3 NTU',  file: 'scenario_algae_watch.json',  active: 0 },
    { name: 'สาหร่ายอุดตันบ่อกรองระดับวิกฤติ',       description: 'สาหร่ายอุดตันบ่อกรอง วิกฤติ — CW Turbid ≤ 2 NTU',     file: 'scenario_algae_crisis.json', active: 0 },
  ];
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

  return db;
}

function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

// node-sqlite3-wasm writes directly to file — no manual persist needed
function persist() {}

// Current time as ISO 8601 in GMT+7 (e.g. "2026-07-01T13:44:08.935+07:00")
function nowTH() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace('Z', '+07:00');
}

module.exports = { initDb, getDb, persist, nowTH };
