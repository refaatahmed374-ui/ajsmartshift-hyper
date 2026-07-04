import type Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { initDefaultPermissions } from './repositories/permissions'

export function seedDatabase(db: Database.Database): void {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
  if (userCount > 0) return // already seeded

  // ===== فرع افتراضي =====
  db.prepare(`INSERT INTO branches (name, address) VALUES (?, ?)`).run('الفرع الرئيسي', '')

  // ===== مستخدمون =====
  const users = [
    { username: 'mgr',    displayName: 'المدير',        role: 'manager',    pass: '1234', color: '#f85149' },
    { username: 'sup',    displayName: 'المشرف',        role: 'supervisor', pass: '4321', color: '#d29922' },
    { username: 'c1',     displayName: 'كاشير 1',       role: 'cashier',    pass: '111',  color: '#388bfd' },
    { username: 'c2',     displayName: 'كاشير 2',       role: 'cashier',    pass: '222',  color: '#2ea043' },
    { username: 'c3',     displayName: 'كاشير 3',       role: 'cashier',    pass: '333',  color: '#8957e5' },
    { username: 'c4',     displayName: 'كاشير 4',       role: 'cashier',    pass: '444',  color: '#e3b341' },
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
  const mainCats = [
    { name: 'إيرادات',          color: '#2ea043', order: 1 },
    { name: 'مصروفات',          color: '#f85149', order: 2 },
    { name: 'أجور',             color: '#8957e5', order: 3 },
    { name: 'مشتريات',          color: '#d29922', order: 4 },
    { name: 'مرتجعات',          color: '#388bfd', order: 5 },
    { name: 'تحصيل',            color: '#2ea043', order: 6 },
    { name: 'متنوع',            color: '#6e7681', order: 7 },
  ]
  const insertMain = db.prepare(
    `INSERT INTO main_categories (name, color, sort_order) VALUES (?, ?, ?)`
  )
  for (const c of mainCats) insertMain.run(c.name, c.color, c.order)

  // ===== التصنيفات الفرعية =====
  const subCats: { main: string; subs: string[] }[] = [
    { main: 'إيرادات', subs: ['مبيعات نقدي', 'مبيعات فيزا', 'مبيعات آجل', 'مبيعات فوري'] },
    { main: 'مصروفات', subs: ['أدوات نظافة', 'مصاريف تشغيل', 'صيانة', 'استهلاكات', 'إيجار', 'مرافق'] },
    { main: 'أجور',    subs: ['راتب شهري', 'سلفة', 'مكافأة', 'خصم'] },
    { main: 'مشتريات', subs: ['مشتريات عامة', 'مواد خام', 'أدوات'] },
    { main: 'مرتجعات', subs: ['مرتجع مشتريات', 'مرتجع مبيعات'] },
    { main: 'تحصيل',   subs: ['تحصيل آجل', 'خصم مبيعات'] },
    { main: 'متنوع',   subs: ['بند متنوع'] },
  ]
  const getMainId = db.prepare(`SELECT id FROM main_categories WHERE name = ?`)
  const insertSub  = db.prepare(
    `INSERT INTO sub_categories (main_category_id, name, sort_order) VALUES (?, ?, ?)`
  )
  for (const g of subCats) {
    const main = getMainId.get(g.main) as { id: number }
    g.subs.forEach((s, i) => insertSub.run(main.id, s, i + 1))
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
