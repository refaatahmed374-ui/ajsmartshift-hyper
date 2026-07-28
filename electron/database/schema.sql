PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ===== المستخدمون =====
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('manager','supervisor','cashier')),
  color         TEXT NOT NULL DEFAULT '#388bfd',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== الفروع =====
CREATE TABLE IF NOT EXISTS branches (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  active  INTEGER NOT NULL DEFAULT 1
);

-- ===== الموظفون =====
CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  national_id TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  hourly_rate INTEGER NOT NULL DEFAULT 0,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive'))
);

-- ===== الشيفتات =====
CREATE TABLE IF NOT EXISTS shifts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id           INTEGER NOT NULL DEFAULT 1 REFERENCES branches(id),
  monthly_shift_num   INTEGER NOT NULL,
  date                TEXT NOT NULL,
  type                TEXT NOT NULL CHECK(type IN ('morning','evening','between')),
  cashier_user_id     INTEGER NOT NULL REFERENCES users(id),
  cashier_name        TEXT NOT NULL,
  start_time          TEXT NOT NULL,
  end_time            TEXT,
  status              TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','review','approved')),
  opening_balance     INTEGER NOT NULL DEFAULT 0,
  closing_balance     INTEGER,
  note                TEXT NOT NULL DEFAULT '',
  created_by          INTEGER NOT NULL REFERENCES users(id),
  approved_by         INTEGER REFERENCES users(id),
  approved_at         TEXT
);

-- ===== اليوميات =====
CREATE TABLE IF NOT EXISTS journals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id        INTEGER NOT NULL UNIQUE REFERENCES shifts(id),
  journal_num     TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','review','approved')),
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TEXT,
  attachment_path TEXT
);

-- ===== بنود اليومية =====
CREATE TABLE IF NOT EXISTS transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id         INTEGER NOT NULL REFERENCES shifts(id),
  journal_id       INTEGER NOT NULL REFERENCES journals(id),
  time             TEXT NOT NULL DEFAULT (time('now')),
  description      TEXT NOT NULL,
  main_category_id INTEGER REFERENCES main_categories(id),
  sub_category_id  INTEGER REFERENCES sub_categories(id),
  amount_in        INTEGER NOT NULL DEFAULT 0,
  amount_out       INTEGER NOT NULL DEFAULT 0,
  pay_method       TEXT NOT NULL DEFAULT 'cashier' CHECK(pay_method IN ('cashier','management','credit','visa')),
  employee_id      INTEGER REFERENCES employees(id),
  note             TEXT NOT NULL DEFAULT '',
  created_by       INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== التصنيفات الرئيسية =====
CREATE TABLE IF NOT EXISTS main_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#388bfd',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ===== التصنيفات الفرعية =====
CREATE TABLE IF NOT EXISTS sub_categories (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  main_category_id INTEGER NOT NULL REFERENCES main_categories(id),
  name             TEXT NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(main_category_id, name)
);

-- ===== التسميات الذكية =====
CREATE TABLE IF NOT EXISTS smart_labels (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern          TEXT NOT NULL UNIQUE,
  main_category_id INTEGER NOT NULL REFERENCES main_categories(id),
  sub_category_id  INTEGER REFERENCES sub_categories(id),
  usage_count      INTEGER NOT NULL DEFAULT 1,
  last_used        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== البنود غير المعروفة =====
CREATE TABLE IF NOT EXISTS unknown_labels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern     TEXT NOT NULL UNIQUE,
  seen_count  INTEGER NOT NULL DEFAULT 1,
  last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved    INTEGER NOT NULL DEFAULT 0
);

-- ===== بيانات فوري لكل شيفت =====
CREATE TABLE IF NOT EXISTS shift_fawry (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id          INTEGER NOT NULL UNIQUE REFERENCES shifts(id),
  basic_receive     INTEGER NOT NULL DEFAULT 0,
  basic_deliver     INTEGER NOT NULL DEFAULT 0,
  air_receive       INTEGER NOT NULL DEFAULT 0,
  air_deliver       INTEGER NOT NULL DEFAULT 0,
  cashout_receive   INTEGER NOT NULL DEFAULT 0,
  cashout_deliver   INTEGER NOT NULL DEFAULT 0,
  fawry_to_basic    INTEGER NOT NULL DEFAULT 0,
  fawry_to_air      INTEGER NOT NULL DEFAULT 0,
  cashout_to_basic  INTEGER NOT NULL DEFAULT 0,
  cashout_to_air    INTEGER NOT NULL DEFAULT 0,
  program_sales     INTEGER NOT NULL DEFAULT 0,
  first_voucher     INTEGER NOT NULL DEFAULT 0,
  last_voucher      INTEGER NOT NULL DEFAULT 0,
  fawry_total_manual INTEGER NOT NULL DEFAULT 0
);

-- ===== العهدة لكل شيفت =====
CREATE TABLE IF NOT EXISTS shift_custody (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id         INTEGER NOT NULL UNIQUE REFERENCES shifts(id),
  add_from_fund    INTEGER NOT NULL DEFAULT 0,
  management_paid  INTEGER NOT NULL DEFAULT 0
);

-- ===== حضور الموظفين =====
CREATE TABLE IF NOT EXISTS employee_attendance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id),
  shift_id     INTEGER NOT NULL REFERENCES shifts(id),
  check_in     TEXT NOT NULL,
  check_out    TEXT,
  hours_worked INTEGER NOT NULL DEFAULT 0,
  UNIQUE(employee_id, shift_id)
);

-- ===== طابور المزامنة =====
CREATE TABLE IF NOT EXISTS sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  operation   TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','failed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== الإعدادات =====
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ===== الفهارس =====
CREATE INDEX IF NOT EXISTS idx_transactions_shift    ON transactions(shift_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created  ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_shifts_date           ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_status         ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_smart_labels_pattern  ON smart_labels(pattern);
CREATE INDEX IF NOT EXISTS idx_attendance_employee   ON employee_attendance(employee_id);
