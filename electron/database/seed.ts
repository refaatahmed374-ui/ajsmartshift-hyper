import type Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { initDefaultPermissions } from './repositories/permissions'
import { normalizeValue } from '../../core/normalize'
import { CANONICAL_CATEGORIES } from './canonicalCategories'

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
  // accountingType: النوع المحاسبي (يقود حسابات قائمة الدخل تلقائيًا — انظر MonthlyCloseReport) — null يعني يُحدَّد على مستوى الفرعي
  // المرجع: قالب إكسل «حسابات حورس» (الفئات الفعلية المستخدمة في اليوميات)
  // v2.33.0 — إعادة هيكلة: "أجور"/"خصومات" دُمجا داخل "مصروفات" (تصنيفات فرعية)، وأُضيف "التكاليف"/"حقوق الملكية"
  // v2.34.4 — أُضيف "النوع المحاسبي" + تصنيفان رئيسيان جديدان: "الاهلاكات"/"الخسائر"
  const mainCats: { name: string; color: string; order: number; kind: string; accountingType: string | null }[] = [
    { name: 'مبيعات',           color: '#2ea043', order: 1,  kind: 'income',     accountingType: 'إيراد' },
    { name: 'تحصيل',            color: '#22d3ee', order: 2,  kind: 'collection', accountingType: 'تسوية_ذمم' },
    { name: 'مرتجعات',          color: '#388bfd', order: 3,  kind: 'return',     accountingType: null }, // يُحدَّد على مستوى الفرعي
    { name: 'مشتريات',          color: '#d29922', order: 5,  kind: 'purchase',   accountingType: 'مخزون' },
    { name: 'مصروفات',          color: '#f85149', order: 7,  kind: 'expense',    accountingType: 'مصروف_تشغيلي' },
    { name: 'استبدالات',        color: '#f97316', order: 8,  kind: 'expense',    accountingType: 'حركة_مخزون_فقط' },
    { name: 'التكاليف',         color: '#0ea5e9', order: 9,  kind: 'expense',    accountingType: 'تكلفة_مبيعات' },
    { name: 'حقوق الملكية',     color: '#64748b', order: 10, kind: 'misc',       accountingType: 'حقوق_ملكية' },
    { name: 'الاهلاكات',        color: '#94a3b8', order: 11, kind: 'expense',    accountingType: 'مصروف_غير_نقدي' },
    { name: 'الخسائر',          color: '#dc2626', order: 12, kind: 'expense',    accountingType: 'خسائر' },
  ]
  const insertMain = db.prepare(
    `INSERT INTO main_categories (name, color, sort_order, kind, accounting_type) VALUES (?, ?, ?, ?, ?)`
  )
  for (const c of mainCats) insertMain.run(c.name, c.color, c.order, c.kind, c.accountingType)

  // ===== التصنيفات الفرعية ===== (v2.34.26 — من المرجع القانوني المعتمد المشترك، انظر canonicalCategories.ts)
  const subCats = CANONICAL_CATEGORIES
  const getMainId = db.prepare(`SELECT id FROM main_categories WHERE name = ?`)
  const insertSub  = db.prepare(
    `INSERT INTO sub_categories (main_category_id, name, sort_order) VALUES (?, ?, ?)`
  )
  for (const g of subCats) {
    const main = getMainId.get(g.main) as { id: number }
    g.subs.forEach((s, i) => insertSub.run(main.id, s, i + 1))
  }

  // النوع المحاسبي على مستوى الفرعي — "مرتجعات" الرئيسي يبقى بلا نوع (يُحدَّد هنا فقط، اتجاهان مختلفان)
  db.prepare(`UPDATE sub_categories SET accounting_type='تصحيح_إيراد' WHERE name='مرتجع مبيعات'`).run()
  db.prepare(`UPDATE sub_categories SET accounting_type='تصحيح_مخزون' WHERE name='مرتجع مشتريات'`).run()

  // ===== قواعد تعيين استيراد Excel الافتراضية (مفردات قالب حورس ← التصنيفات الجديدة) =====
  // تجعل استيرادات اليومية تُطابَق تلقائياً بلا مراجعة يدوية.
  const importRules: [string, string][] = [ // [قيمة الإكسل, اسم التصنيف الفرعي]
    ['فيزا', 'مبيعات فيزا'], ['اجل', 'مبيعات آجل'], ['اجور', 'رواتب موظفين'],
    ['خصومات البيع', 'خصومات العملاء'], ['مرتجع مبيعات', 'مرتجع مبيعات'],
    ['انتاج جبن', 'إنتاج جبن'], ['ادوات تغليف', 'أدوات تغليف'], ['ادوات نظافه', 'أدوات تنظيف'],
    ['ادوات مكتبيه', 'أدوات مكتبية'], ['تليفون وانترنت', 'تليفون وإنترنت'],
    ['صيانه', 'صيانة'], ['كهرباء', 'كهرباء'], ['مصاريف حكوميه', 'مصاريف حكومية'],
    ['كيمو استبدال', 'كيمو استبدال'], ['اسكويز استبدال', 'اسكويز استبدال'],
    // v2.31.5 — قواعد تعيين مفقودة للتصنيفات الفرعية الجديدة (شيت التقفيل الشهري)
    ['مبيعات توصيل', 'مبيعات توصيل'], ['مبيعات لحوم', 'مبيعات لحوم'],
    ['مشتريات اللحوم', 'مشتريات اللحوم'], ['مشتريات فراخ', 'مشتريات فراخ'],
    ['شحن ونقل', 'شحن ونقل'], ['هوالك منتجات', 'هوالك منتجات'],
    ['انتاج فراخ', 'إنتاج فراخ'], ['انتاج لحوم', 'إنتاج لحوم'],
    ['مرتجع مشتريات', 'مرتجع مشتريات'],
    ['ايجار', 'إيجار'], ['اهلاك اصول', 'اهلاك أصول'], ['مياه', 'مياه'], ['تامينات', 'تأمينات'], ['مرافق', 'مرافق'],
    // v2.34.9 — لو الفئة في الإكسيل كتبت "مشتريات" فقط (بلا تصنيف فرعي محدَّد)، تُصنَّف "مشتريات عامة" تلقائيًا بدل ما تبقى بلا تصنيف فرعي
    ['مشتريات', 'مشتريات عامة'],
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
