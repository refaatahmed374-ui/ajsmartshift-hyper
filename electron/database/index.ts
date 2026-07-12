import Database from 'better-sqlite3'
import { existsSync, copyFileSync } from 'fs'
import { seedDatabase } from './seed'
import { initDefaultPermissions } from './repositories/permissions'
import { dbPath as dataDbPath, legacyDbPath } from '../paths'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#388bfd',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branches (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  active  INTEGER NOT NULL DEFAULT 1
);

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

CREATE TABLE IF NOT EXISTS journals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id        INTEGER NOT NULL UNIQUE REFERENCES shifts(id),
  journal_num     TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','review','approved')),
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TEXT,
  attachment_path TEXT
);

CREATE TABLE IF NOT EXISTS main_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#388bfd',
  sort_order INTEGER NOT NULL DEFAULT 0,
  kind       TEXT NOT NULL DEFAULT 'misc'
);

CREATE TABLE IF NOT EXISTS sub_categories (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  main_category_id INTEGER NOT NULL REFERENCES main_categories(id),
  name             TEXT NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(main_category_id, name)
);

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
  pay_method       TEXT NOT NULL DEFAULT 'cashier' CHECK(pay_method IN ('cashier','management')),
  employee_id      INTEGER REFERENCES employees(id),
  note             TEXT NOT NULL DEFAULT '',
  created_by       INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS smart_labels (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern          TEXT NOT NULL UNIQUE,
  main_category_id INTEGER NOT NULL REFERENCES main_categories(id),
  sub_category_id  INTEGER REFERENCES sub_categories(id),
  usage_count      INTEGER NOT NULL DEFAULT 1,
  last_used        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS unknown_labels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern     TEXT NOT NULL UNIQUE,
  seen_count  INTEGER NOT NULL DEFAULT 1,
  last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved    INTEGER NOT NULL DEFAULT 0
);

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
  last_voucher      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shift_custody (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id         INTEGER NOT NULL UNIQUE REFERENCES shifts(id),
  add_from_fund    INTEGER NOT NULL DEFAULT 0,
  management_paid  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employee_attendance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id),
  shift_id     INTEGER NOT NULL REFERENCES shifts(id),
  check_in     TEXT NOT NULL,
  check_out    TEXT,
  hours_worked INTEGER NOT NULL DEFAULT 0,
  UNIQUE(employee_id, shift_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  user_name    TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    INTEGER NOT NULL,
  operation    TEXT NOT NULL,
  value_before TEXT NOT NULL DEFAULT '',
  value_after  TEXT NOT NULL DEFAULT '',
  reason       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  operation   TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','failed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT    NOT NULL,
  granted    INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions ON user_permissions(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL CHECK(type IN ('deficit','surplus','approval_pending','info')),
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  shift_id   INTEGER REFERENCES shifts(id),
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_shift   ON transactions(shift_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_shifts_date          ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_status        ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_smart_labels_pattern ON smart_labels(pattern);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity     ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_attendance_employee  ON employee_attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read   ON notifications(is_read);

-- ===== CRM: العملاء والموردون =====
CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  opening_balance INTEGER NOT NULL DEFAULT 0,   -- رصيد افتتاحي (قروش، موجب=له علينا)
  loyalty_points  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  opening_balance INTEGER NOT NULL DEFAULT 0,   -- رصيد افتتاحي (قروش، موجب=علينا له)
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- حركات الحساب (كشف حساب) للطرفين
CREATE TABLE IF NOT EXISTS party_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type  TEXT NOT NULL CHECK(party_type IN ('customer','supplier')),
  party_id    INTEGER NOT NULL,
  date        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  debit       INTEGER NOT NULL DEFAULT 0,   -- مدين (قروش)
  credit      INTEGER NOT NULL DEFAULT 0,   -- دائن (قروش)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_party_ledger ON party_ledger(party_type, party_id, date);

-- ═══ محرّك استيراد Excel ═══
-- قواعد تعيين قيمة «الفئة» (المطبَّعة) → فئة النظام. تُبنى تدريجياً وتُعاد للاستيرادات القادمة.
CREATE TABLE IF NOT EXISTS import_category_map (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  excel_value      TEXT NOT NULL UNIQUE,   -- القيمة بعد التطبيع
  main_category_id INTEGER REFERENCES main_categories(id),
  sub_category_id  INTEGER REFERENCES sub_categories(id),
  active           INTEGER NOT NULL DEFAULT 1,
  created_by       INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
-- تعيين اسم الكاشير (المطبَّع) → مستخدم النظام (يحفظ دقّة التقارير التاريخية).
CREATE TABLE IF NOT EXISTS import_cashier_map (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  excel_name  TEXT NOT NULL UNIQUE,        -- الاسم بعد التطبيع
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- سجل عمليات الاستيراد (تدقيق + منع إعادة الاستيراد).
CREATE TABLE IF NOT EXISTS import_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  user_name   TEXT NOT NULL DEFAULT '',
  file_name   TEXT NOT NULL DEFAULT '',
  sheets      INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 0,
  imported    INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  duplicates  INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`

// ===== Migrations — أعمدة جديدة تُضاف للجداول الموجودة =====
const MIGRATIONS = [
  `ALTER TABLE shifts ADD COLUMN pos_sales           INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE shifts ADD COLUMN cashier_remaining   INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE shifts ADD COLUMN cashier_collections INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE shifts ADD COLUMN shift_expenses      INTEGER NOT NULL DEFAULT 0`,
  // رواتب الموظفين: الراتب الشهري (قروش) + ساعات العمل اليومية القياسية (×100 لدعم الكسور)
  `ALTER TABLE employees ADD COLUMN monthly_salary INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE employees ADD COLUMN work_hours     INTEGER NOT NULL DEFAULT 800`,
  // جدول الحضور بالتاريخ
  `CREATE TABLE IF NOT EXISTS attendance (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
     date         TEXT NOT NULL,
     status       TEXT NOT NULL DEFAULT 'present' CHECK(status IN ('present','absent','leave')),
     check_in     TEXT,
     check_out    TEXT,
     hours_worked INTEGER NOT NULL DEFAULT 0,
     UNIQUE(employee_id, date)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date)`,
  // v2.27.0 — الجزاء يُسجّل مع الحضور (بالأيام: 0.5 / 1 / 3 كحد أقصى)
  `ALTER TABLE attendance ADD COLUMN penalty_days REAL NOT NULL DEFAULT 0`,
  // v2.27.0 — ربط بنود اليومية بالعميل (للدفع الآجل + التحصيلات)
  `ALTER TABLE transactions ADD COLUMN customer_id INTEGER REFERENCES customers(id)`,
  // v2.32 — نوع الفئة (لاشتقاق اتجاه المعاملة في استيراد Excel). الشرط kind='misc' يجعله لا يدهس تعديلات الأدمن.
  `ALTER TABLE main_categories ADD COLUMN kind TEXT NOT NULL DEFAULT 'misc'`,
  `UPDATE main_categories SET kind='income'     WHERE name='إيرادات' AND kind='misc'`,
  `UPDATE main_categories SET kind='expense'    WHERE name='مصروفات' AND kind='misc'`,
  `UPDATE main_categories SET kind='expense'    WHERE name='أجور'    AND kind='misc'`,
  `UPDATE main_categories SET kind='purchase'   WHERE name='مشتريات' AND kind='misc'`,
  `UPDATE main_categories SET kind='return'     WHERE name='مرتجعات' AND kind='misc'`,
  `UPDATE main_categories SET kind='collection' WHERE name='تحصيل'   AND kind='misc'`,
  // ADR-012 v2 — حقول كاش أوت يدوية (تطابق قالب الإكسل) — لا تُغذّي أي معادلة في محرّك الحساب
  `ALTER TABLE shift_fawry ADD COLUMN cashout_add       INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE shift_fawry ADD COLUMN cashout_discount  INTEGER NOT NULL DEFAULT 0`,
  // ADR-012 v2 — نسبة عمولة فوري اليدوية (×100) — تدخل في معادلة الإغلاق الرسمية
  `ALTER TABLE shift_fawry ADD COLUMN commission_pct    INTEGER NOT NULL DEFAULT 0`,
  // ADR-012 v2 — إعادة تسمية الفئات لمطابقة قالب الإكسل المرجعي (تحديث بالاسم، بلا فقدان بيانات)
  `UPDATE main_categories SET name='مبيعات' WHERE name='إيرادات'`,
  `UPDATE sub_categories SET name='تحصيل مبيعات آجلة' WHERE name='تحصيل آجل'`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'تحصيل مرتجع مشتريات', 2 FROM main_categories
     WHERE name='تحصيل' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='تحصيل مرتجع مشتريات'
     )`,
  `UPDATE sub_categories SET name='راتب موظف'
     WHERE name='أجور' AND main_category_id = (SELECT id FROM main_categories WHERE name='أجور')`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'سلفة موظف', 2 FROM main_categories
     WHERE name='أجور' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='سلفة موظف'
     )`,
  // v2.27.0 (14-Jun) — تسويات خزينة الإدارة (دفع رواتب، سحوبات يدوية...)
  `CREATE TABLE IF NOT EXISTS treasury_adjustments (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     date        TEXT NOT NULL,
     type        TEXT NOT NULL DEFAULT 'salary_payout',
     description TEXT NOT NULL DEFAULT '',
     amount      INTEGER NOT NULL DEFAULT 0,
     created_at  TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  // v2.27.0 (14-Jun) — تقارير الرواتب الشهرية
  `CREATE TABLE IF NOT EXISTS payroll_reports (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     month          TEXT NOT NULL,
     total_amount   INTEGER NOT NULL DEFAULT 0,
     payment_method TEXT NOT NULL DEFAULT 'management',
     employee_count INTEGER NOT NULL DEFAULT 0,
     details_json   TEXT NOT NULL DEFAULT '[]',
     created_at     TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  // v2.27.0 (14-Jun) — تقارير التقفيل الشهري
  `CREATE TABLE IF NOT EXISTS monthly_close_reports (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     month         TEXT NOT NULL UNIQUE,
     data_json     TEXT NOT NULL DEFAULT '{}',
     created_at    TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  // ADR-012 v2 — قصر طرق الدفع على نوعين: تحويل الصفوف القديمة (آجل/فيزا) → كاشير.
  // الآجل/الفيزا يُتتبَّعان بالتصنيف الفرعي «مبيعات آجل/مبيعات فيزا» لا بطريقة الدفع.
  `UPDATE transactions SET pay_method='cashier' WHERE pay_method IN ('credit','visa')`,
  // ADR-012 v2 — توحيد الاتجاه المخزَّن مع القاعدة الرسمية: كل البنود منصرف إلا فئة «تحصيل».
  // يصحّح بنوداً قديمة (مثل مبيعات فيزا/آجل) خُزّنت وارداً فأسقطها حساب مصروفات الكاشير.
  `UPDATE transactions SET amount_out = amount_in, amount_in = 0
     WHERE amount_in > 0
       AND (main_category_id IS NULL
            OR main_category_id NOT IN (SELECT id FROM main_categories WHERE name = 'تحصيل'))`,
  // v2.31.4 — تصنيفان فرعيان جديدان لدعم لوحة المعلومات (مبيعات التوصيل ومشتريات اللحوم)
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'مبيعات توصيل', 3 FROM main_categories
     WHERE name='مبيعات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='مبيعات توصيل'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'مشتريات اللحوم', 6 FROM main_categories
     WHERE name='مشتريات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='مشتريات اللحوم'
     )`,
  // v2.31.5 — تصنيفات فرعية جديدة لمطابقة تقرير التقفيل الشهري (شيت حورس)
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'مبيعات لحوم', 4 FROM main_categories
     WHERE name='مبيعات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='مبيعات لحوم'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'مرتجع مشتريات', 2 FROM main_categories
     WHERE name='مرتجعات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='مرتجع مشتريات'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'مشتريات فراخ', 7 FROM main_categories
     WHERE name='مشتريات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='مشتريات فراخ'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'شحن ونقل', 8 FROM main_categories
     WHERE name='مشتريات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='شحن ونقل'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'هوالك منتجات', 9 FROM main_categories
     WHERE name='مشتريات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='هوالك منتجات'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'إنتاج فراخ', 10 FROM main_categories
     WHERE name='مشتريات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='إنتاج فراخ'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'إنتاج لحوم', 11 FROM main_categories
     WHERE name='مشتريات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='إنتاج لحوم'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'إيجار', 5 FROM main_categories
     WHERE name='مصروفات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='إيجار'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'اهلاك أصول', 6 FROM main_categories
     WHERE name='مصروفات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='اهلاك أصول'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'مياة', 7 FROM main_categories
     WHERE name='مصروفات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='مياة'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'تأمينات', 8 FROM main_categories
     WHERE name='مصروفات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='تأمينات'
     )`,
  `INSERT INTO sub_categories (main_category_id, name, sort_order)
     SELECT id, 'مرافق', 9 FROM main_categories
     WHERE name='مصروفات' AND NOT EXISTS (
       SELECT 1 FROM sub_categories WHERE main_category_id = main_categories.id AND name='مرافق'
     )`,
  // v2.31.5 — قواعد تعيين استيراد Excel مفقودة للتصنيفات الفرعية الجديدة أعلاه (كانت تُصنَّف "مجهول" عند الاستيراد)
  ...[
    ['شحن ونقل', 'شحن ونقل'], ['مبيعات لحوم', 'مبيعات لحوم'], ['مشتريات فراخ', 'مشتريات فراخ'],
    ['هوالك منتجات', 'هوالك منتجات'], ['انتاج فراخ', 'إنتاج فراخ'], ['انتاج لحوم', 'إنتاج لحوم'],
    ['مرتجع مشتريات', 'مرتجع مشتريات'], ['ايجار', 'إيجار'], ['اهلاك اصول', 'اهلاك أصول'],
    ['مياه', 'مياة'], ['تامينات', 'تأمينات'], ['مرافق', 'مرافق'],
  ].map(([excelValue, subName]) => `
    INSERT OR IGNORE INTO import_category_map (excel_value, main_category_id, sub_category_id)
    SELECT '${excelValue}', sc.main_category_id, sc.id FROM sub_categories sc WHERE sc.name = '${subName}'
  `),
]

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  const newPath = dataDbPath()   // C:\ProgramData\AJ Smart Shift\database.sqlite

  // ترحيل تلقائي مرة واحدة: نسخ قاعدة البيانات القديمة من userData إن وُجدت ولم تُنقل بعد
  if (!existsSync(newPath)) {
    try {
      const oldPath = legacyDbPath()
      if (existsSync(oldPath)) copyFileSync(oldPath, newPath)
    } catch (e) { console.error('DB migration error:', e) }
  }

  _db = new Database(newPath)
  // أداء: WAL + synchronous=NORMAL (آمن مع WAL وأسرع بكثير في الكتابة)
  _db.pragma('journal_mode = WAL')
  _db.pragma('synchronous = NORMAL')
  _db.exec(SCHEMA)

  // تطبيق الـ migrations مرة واحدة فقط لكل قاعدة بيانات — user_version يُسجّل عدد المُطبَّق منها.
  // بدون هذا الحارس كانت بعض الـ UPDATEs (مثل توحيد اتجاه المبلغ) تُعاد على كل تشغيل للبرنامج،
  // وقد تُعيد كتابة بيانات حديثة تُطابق نفس شرط WHERE عن طريق الخطأ.
  const appliedVersion = _db.pragma('user_version', { simple: true }) as number
  for (let i = appliedVersion; i < MIGRATIONS.length; i++) {
    try { _db.exec(MIGRATIONS[i]) } catch (e) { console.error(`Migration #${i} failed:`, e) }
  }
  _db.pragma(`user_version = ${MIGRATIONS.length}`)

  // ترحيل: إزالة قيد CHECK القديم على users.role (للأدوار الجديدة)
  try {
    const usersSql = (_db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get() as { sql: string } | undefined)?.sql ?? ''
    if (usersSql.includes('CHECK') && !usersSql.includes('accountant')) {
      _db.pragma('foreign_keys = OFF')
      _db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#388bfd', active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users_new SELECT id, username, display_name, password_hash, role, color, active, created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `)
      _db.pragma('foreign_keys = ON')
      console.log('Migrated users table (removed role CHECK)')
    }
  } catch (e) { console.error('users role migration error:', e) }

  seedDatabase(_db)

  // تهيئة صلاحيات المستخدمين الموجودين إذا لم تكن لديهم صلاحيات بعد
  try {
    const users = _db.prepare(`SELECT id, role FROM users WHERE active=1`).all() as { id: number; role: string }[]
    for (const u of users) {
      const count = (_db.prepare(`SELECT COUNT(*) as c FROM user_permissions WHERE user_id=?`).get(u.id) as { c: number }).c
      if (count === 0) initDefaultPermissions(_db, u.id, u.role as 'manager'|'supervisor'|'cashier')
    }
  } catch (e) { console.error('Permission init error:', e) }

  // v2.27.0 — حذف الإشعارات القديمة من نوع approval_pending (نظام المراجعة محذوف)
  try {
    _db.prepare(`DELETE FROM notifications WHERE type = 'approval_pending'`).run()
  } catch (e) { console.error('Cleanup approval_pending error:', e) }

  // v2.31.1 — إصلاح ذاتي: ضمان وجود الفرع id=1 دائماً (createShift يثبّت branch_id=1).
  // يُصلح قواعد البيانات التي محت بيانات «كل شيء» في v2.31.0 (عاد الفرع بـ id≠1 فتعذّر فتح الشيفت).
  try {
    _db.prepare(`INSERT OR IGNORE INTO branches (id, name, address) VALUES (1, 'الفرع الرئيسي', '')`).run()
  } catch (e) { console.error('Branch#1 self-heal error:', e) }

  return _db
}

export function closeDb(): void {
  _db?.close()
  _db = null
}

// ═══ محو البيانات ═══
// جداول البيانات التشغيلية/المحاسبية (تُمحى في كل الأوضاع)
const BUSINESS_TABLES = [
  'transactions', 'journals', 'shift_fawry', 'shift_custody', 'shifts',
  'employee_attendance', 'attendance', 'treasury_adjustments',
  'payroll_reports', 'monthly_close_reports', 'audit_log', 'sync_queue',
  'notifications', 'party_ledger', 'customers', 'suppliers', 'employees',
  'smart_labels', 'unknown_labels', 'import_history',
]
// جداول الهوية/الإعداد (تُمحى فقط في "إعادة الضبط الكاملة")
// ملاحظة: قواعد تعيين الاستيراد تُمسح مع الفئات/المستخدمين لأنها تشير إليها بالمعرّف.
const IDENTITY_TABLES = ['import_category_map', 'import_cashier_map', 'user_permissions', 'users', 'sub_categories', 'main_categories', 'branches']

/**
 * محو البيانات:
 *  - 'accounting': يمحو البيانات المحاسبية فقط، ويُبقي المستخدمين والإعدادات والتصنيفات.
 *  - 'all': إعادة ضبط كاملة — يمحو كل شيء + بيانات المنشأة (biz.*)، يُبقي إعدادات الترخيص،
 *           ثم يُعيد بذر المدير الافتراضي (mgr/1234) والتصنيفات الافتراضية.
 */
export function wipeData(scope: 'accounting' | 'all'): void {
  const db = getDb()
  const prevFk = db.pragma('foreign_keys', { simple: true })
  db.pragma('foreign_keys = OFF')
  try {
    const run = db.transaction(() => {
      for (const t of BUSINESS_TABLES) db.prepare(`DELETE FROM ${t}`).run()
      if (scope === 'all') {
        for (const t of IDENTITY_TABLES) db.prepare(`DELETE FROM ${t}`).run()
        // يمحو بيانات المنشأة فقط ويُبقي إعدادات الترخيص وباقي الإعدادات
        db.prepare(`DELETE FROM settings WHERE key LIKE 'biz.%'`).run()
        // ⭐ تصفير عدّادات AUTOINCREMENT حتى يعود البذر بنفس معرّفات التثبيت الجديد
        //    (بدونها يعود الفرع بـ id=2 ويفشل createShift الذي يثبّت branch_id=1 → خطأ FK)
        try { db.prepare(`DELETE FROM sqlite_sequence`).run() } catch { /* الجدول قد لا يوجد إن لم تُستخدم AUTOINCREMENT */ }
        // إعادة بذر المدير الافتراضي + التصنيفات + الإعدادات الافتراضية
        seedDatabase(db)
      }
    })
    run()
  } finally {
    db.pragma(`foreign_keys = ${prevFk ? 'ON' : 'OFF'}`)
  }
}
