import type Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { initDefaultPermissions } from './repositories/permissions'
import { normalizeValue } from '../services/excelImport/normalize'

export function seedDatabase(db: Database.Database): void {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
  if (userCount > 0) return // already seeded

  // ===== فرع افتراضي =====
  db.prepare(`INSERT INTO branches (name, address) VALUES (?, ?)`).run('الفرع الرئيسي', '')

  // ===== مستخدمون =====
  // الوضع الافتراضي: حساب المدير فقط — العميل يضيف/يحذف مستخدمين بنفسه من إدارة المستخدمين
  const users = [
    { username: 'mgr',    displayName: 'المدير',        role: 'manager',    pass: '1234', color: '#f85149' },
  ]
  const insertUser = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, color) VALUES (?, ?, ?, ?, ?)`
  )
  for (const u of users) {
    const hash = bcrypt.hashSync(u.pass, 10)
    const res  = insertUser.run(u.username, u.displayName, hash, u.role, u.color)
    initDefaultPermissions(db, res.lastInsertRowid as number, u.role as 'manager'|'supervisor'|'cashier')
  }

  // ===== التصنيفات الرئيسية =====
  // kind: يحدّد اتجاه المعاملة في استيراد Excel (income/collection=وارد، الباقي=منصرف)
  // المرجع: قالب إكسل «حسابات حورس» (الفئات الفعلية المستخدمة في اليوميات)
  const mainCats = [
    { name: 'مبيعات',           color: '#2ea043', order: 1, kind: 'income'     },
    { name: 'تحصيل',            color: '#22d3ee', order: 2, kind: 'collection' },
    { name: 'مرتجعات',          color: '#388bfd', order: 3, kind: 'return'     },
    { name: 'خصومات',           color: '#ec4899', order: 4, kind: 'expense'    },
    { name: 'مشتريات',          color: '#d29922', order: 5, kind: 'purchase'   },
    { name: 'أجور',             color: '#8957e5', order: 6, kind: 'expense'    },
    { name: 'مصروفات',          color: '#f85149', order: 7, kind: 'expense'    },
    { name: 'استبدالات',        color: '#f97316', order: 8, kind: 'expense'    },
  ]
  const insertMain = db.prepare(
    `INSERT INTO main_categories (name, color, sort_order, kind) VALUES (?, ?, ?, ?)`
  )
  for (const c of mainCats) insertMain.run(c.name, c.color, c.order, c.kind)

  // ===== التصنيفات الفرعية =====
  const subCats: { main: string; subs: string[] }[] = [
    { main: 'مبيعات',    subs: ['مبيعات فيزا', 'مبيعات آجل', 'مبيعات توصيل', 'مبيعات لحوم'] },
    { main: 'تحصيل',     subs: ['تحصيل مبيعات آجلة', 'تحصيل مرتجع مشتريات'] },
    { main: 'مرتجعات',   subs: ['مرتجع مبيعات', 'مرتجع مشتريات'] },
    { main: 'خصومات',    subs: ['خصومات البيع'] },
    { main: 'مشتريات',   subs: [
        'مشتريات عامة', 'مشتريات اللحوم', 'مشتريات فراخ', 'شحن ونقل', 'هوالك منتجات',
        'إنتاج جبن', 'إنتاج فراخ', 'إنتاج لحوم', 'أدوات تغليف', 'أدوات نظافة', 'أدوات مكتبية',
      ] },
    { main: 'أجور',      subs: ['راتب موظف', 'سلفة موظف'] },
    { main: 'مصروفات',   subs: ['صيانة', 'كهرباء', 'تليفون وإنترنت', 'مصاريف حكومية', 'إيجار', 'اهلاك أصول', 'مياة', 'تأمينات', 'مرافق'] },
    { main: 'استبدالات', subs: ['كيمو استبدال', 'اسكويز استبدال'] },
  ]
  const getMainId = db.prepare(`SELECT id FROM main_categories WHERE name = ?`)
  const insertSub  = db.prepare(
    `INSERT INTO sub_categories (main_category_id, name, sort_order) VALUES (?, ?, ?)`
  )
  for (const g of subCats) {
    const main = getMainId.get(g.main) as { id: number }
    g.subs.forEach((s, i) => insertSub.run(main.id, s, i + 1))
  }

  // ===== قواعد تعيين استيراد Excel الافتراضية (مفردات قالب حورس ← التصنيفات الجديدة) =====
  // تجعل استيرادات اليومية تُطابَق تلقائياً بلا مراجعة يدوية.
  const importRules: [string, string][] = [ // [قيمة الإكسل, اسم التصنيف الفرعي]
    ['فيزا', 'مبيعات فيزا'], ['اجل', 'مبيعات آجل'], ['اجور', 'راتب موظف'],
    ['خصومات البيع', 'خصومات البيع'], ['مرتجع مبيعات', 'مرتجع مبيعات'],
    ['انتاج جبن', 'إنتاج جبن'], ['ادوات تغليف', 'أدوات تغليف'], ['ادوات نظافه', 'أدوات نظافة'],
    ['ادوات مكتبيه', 'أدوات مكتبية'], ['تليفون وانترنت', 'تليفون وإنترنت'],
    ['صيانه', 'صيانة'], ['كهرباء', 'كهرباء'], ['مصاريف حكوميه', 'مصاريف حكومية'],
    ['كيمو استبدال', 'كيمو استبدال'], ['اسكويز استبدال', 'اسكويز استبدال'],
    // v2.31.5 — قواعد تعيين مفقودة للتصنيفات الفرعية الجديدة (شيت التقفيل الشهري)
    ['مبيعات توصيل', 'مبيعات توصيل'], ['مبيعات لحوم', 'مبيعات لحوم'],
    ['مشتريات اللحوم', 'مشتريات اللحوم'], ['مشتريات فراخ', 'مشتريات فراخ'],
    ['شحن ونقل', 'شحن ونقل'], ['هوالك منتجات', 'هوالك منتجات'],
    ['انتاج فراخ', 'إنتاج فراخ'], ['انتاج لحوم', 'إنتاج لحوم'],
    ['مرتجع مشتريات', 'مرتجع مشتريات'],
    ['ايجار', 'إيجار'], ['اهلاك اصول', 'اهلاك أصول'], ['مياه', 'مياة'], ['تامينات', 'تأمينات'], ['مرافق', 'مرافق'],
  ]
  const getSub = db.prepare(`SELECT id, main_category_id AS mid FROM sub_categories WHERE name = ?`)
  const insertMap = db.prepare(`INSERT OR IGNORE INTO import_category_map (excel_value, main_category_id, sub_category_id) VALUES (?, ?, ?)`)
  for (const [ex, subName] of importRules) {
    const sub = getSub.get(subName) as { id: number; mid: number } | undefined
    if (sub) insertMap.run(normalizeValue(ex), sub.mid, sub.id)
  }

  // ===== إعدادات افتراضية =====
  const defaultSettings: [string, string][] = [
    ['alert_threshold', '50000'],   // عتبة التنبيه = 500 جنيه (بالقروش)
    ['backup_enabled', '1'],
    ['backup_path', ''],
    ['print_copies', '1'],
    ['app_name', 'AJ Smart Shift'],
  ]
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`)
  for (const [k, v] of defaultSettings) insertSetting.run(k, v)
}
