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

  // Migration: add chemical_type to chem_history if missing
  const chemCols = db.all('PRAGMA table_info(chem_history)').map(c => c.name);
  if (!chemCols.includes('chemical_type')) {
    db.run(`ALTER TABLE chem_history ADD COLUMN chemical_type TEXT`);
  }

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

  // Seed default scenarios if none exist
  const count = db.get('SELECT COUNT(*) as n FROM scenarios');
  if (count.n === 0) {
    const defaults = [
      { name: 'ปกติ',       description: 'เกณฑ์มาตรฐานการผลิตน้ำปกติ',            file: 'scenario_normal.json', active: 1 },
      { name: 'น้ำขุ่น',    description: 'ผ่อนเกณฑ์ความขุ่น เพิ่ม Alum/PACl สูง', file: 'scenario_flood.json',  active: 0 },
      { name: 'สาหร่ายสูง', description: 'เฝ้าระวัง Algae — เกณฑ์คลอรีนเข้มขึ้น', file: 'scenario_algae.json',  active: 0 },
    ];
    for (const s of defaults) {
      db.run(
        'INSERT INTO scenarios (name, description, threshold_file, active) VALUES (?, ?, ?, ?)',
        [s.name, s.description, s.file, s.active]
      );
    }
  }

  return db;
}

function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

// node-sqlite3-wasm writes directly to file — no manual persist needed
function persist() {}

module.exports = { initDb, getDb, persist };
