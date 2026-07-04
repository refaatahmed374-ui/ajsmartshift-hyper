import type Database from 'better-sqlite3'
import type { Notification } from '../../../core/types'

function row2notif(r: Record<string, unknown>): Notification {
  return {
    id:        r.id        as number,
    type:      r.type      as Notification['type'],
    title:     r.title     as string,
    message:   r.message   as string,
    shiftId:   r.shift_id  as number | null,
    isRead:    r.is_read   as number,
    createdAt: r.created_at as string,
  }
}

export function createNotification(
  db: Database.Database,
  data: { type: Notification['type']; title: string; message: string; shiftId?: number }
): number {
  const res = db.prepare(
    `INSERT INTO notifications (type, title, message, shift_id) VALUES (?, ?, ?, ?)`
  ).run(data.type, data.title, data.message, data.shiftId ?? null)
  return res.lastInsertRowid as number
}

export function getNotifications(
  db: Database.Database,
  opts: { unreadOnly?: boolean; limit?: number } = {}
): Notification[] {
  let q = `SELECT * FROM notifications WHERE 1=1`
  const params: unknown[] = []
  if (opts.unreadOnly) { q += ` AND is_read = 0` }
  q += ` ORDER BY created_at DESC`
  if (opts.limit) { q += ` LIMIT ?`; params.push(opts.limit) }
  return (db.prepare(q).all(...params) as Record<string, unknown>[]).map(row2notif)
}

export function markNotificationRead(db: Database.Database, id: number): void {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ?`).run(id)
}

export function markAllRead(db: Database.Database): void {
  db.prepare(`UPDATE notifications SET is_read = 1`).run()
}

export function deleteNotification(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM notifications WHERE id = ?`).run(id)
}

export function getUnreadCount(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM notifications WHERE is_read = 0`).get() as { cnt: number }
  return row.cnt
}
