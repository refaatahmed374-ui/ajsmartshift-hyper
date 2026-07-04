import type Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import type { User } from '../../../core/types'

function row2user(r: Record<string, unknown>): User {
  return {
    id:          r.id as number,
    username:    r.username as string,
    displayName: r.display_name as string,
    role:        r.role as User['role'],
    color:       r.color as string,
    active:      (r.active as number) === 1,
    createdAt:   r.created_at as string,
  }
}

export function verifyUser(
  db: Database.Database,
  username: string,
  password: string
): User | null {
  const row = db
    .prepare(`SELECT * FROM users WHERE username = ? AND active = 1`)
    .get(username) as Record<string, unknown> | undefined

  if (!row) return null
  if (!bcrypt.compareSync(password, row.password_hash as string)) return null
  return row2user(row)
}

export function getAllUsers(db: Database.Database): User[] {
  return (db.prepare(`SELECT * FROM users ORDER BY role, display_name`).all() as Record<string, unknown>[])
    .map(row2user)
}

export function getUserById(db: Database.Database, id: number): User | null {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  return row ? row2user(row) : null
}

export function createUser(
  db: Database.Database,
  data: { username: string; displayName: string; password: string; role: User['role']; color: string }
): number {
  const hash = bcrypt.hashSync(data.password, 10)
  const res = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, color) VALUES (?, ?, ?, ?, ?)`
  ).run(data.username, data.displayName, hash, data.role, data.color)
  return res.lastInsertRowid as number
}

export function updateUserPassword(
  db: Database.Database,
  userId: number,
  newPassword: string
): void {
  const hash = bcrypt.hashSync(newPassword, 10)
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, userId)
}

export function toggleUserActive(db: Database.Database, userId: number): void {
  db.prepare(`UPDATE users SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id = ?`).run(userId)
}

export function updateUser(
  db: Database.Database,
  userId: number,
  data: { displayName?: string; role?: string; color?: string }
): void {
  const sets: string[] = []
  const params: unknown[] = []
  if (data.displayName) { sets.push('display_name = ?'); params.push(data.displayName) }
  if (data.role)        { sets.push('role = ?');         params.push(data.role) }
  if (data.color)       { sets.push('color = ?');        params.push(data.color) }
  if (sets.length === 0) return
  params.push(userId)
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}
