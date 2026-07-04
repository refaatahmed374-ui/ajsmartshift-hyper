import type Database from 'better-sqlite3'
import type { Permission, Role } from '../../../core/types'
import { DEFAULT_PERMISSIONS } from '../../../core/types'

/** تهيئة صلاحيات مستخدم جديد حسب دوره */
export function initDefaultPermissions(
  db: Database.Database,
  userId: number,
  role: Role
): void {
  const defaults = DEFAULT_PERMISSIONS[role]
  const insert   = db.prepare(
    `INSERT OR IGNORE INTO user_permissions (user_id, permission, granted) VALUES (?, ?, ?)`
  )
  const insertAll = db.transaction(() => {
    for (const perm of defaults) insert.run(userId, perm, 1)
  })
  insertAll()
}

/** جلب كل صلاحيات مستخدم */
export function getUserPermissions(
  db: Database.Database,
  userId: number
): Permission[] {
  const rows = db.prepare(
    `SELECT permission FROM user_permissions WHERE user_id=? AND granted=1`
  ).all(userId) as { permission: string }[]
  return rows.map(r => r.permission as Permission)
}

/** جلب مصفوفة الصلاحيات لجميع المستخدمين (للإعدادات) */
export function getAllUsersPermissions(
  db: Database.Database
): { userId: number; permission: Permission; granted: number }[] {
  return db.prepare(
    `SELECT user_id AS userId, permission, granted FROM user_permissions ORDER BY user_id`
  ).all() as { userId: number; permission: Permission; granted: number }[]
}

/** تعيين صلاحية محددة لمستخدم */
export function setPermission(
  db: Database.Database,
  userId: number,
  permission: Permission,
  granted: boolean
): void {
  db.prepare(`
    INSERT INTO user_permissions (user_id, permission, granted)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, permission) DO UPDATE SET granted=excluded.granted
  `).run(userId, permission, granted ? 1 : 0)
}

/** التحقق إذا كان المستخدم يملك صلاحية معينة */
export function hasPermission(
  db: Database.Database,
  userId: number,
  permission: Permission
): boolean {
  const row = db.prepare(
    `SELECT granted FROM user_permissions WHERE user_id=? AND permission=?`
  ).get(userId, permission) as { granted: number } | undefined
  return row?.granted === 1
}
