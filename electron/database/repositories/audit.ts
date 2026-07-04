import type Database from 'better-sqlite3'
import type { AuditLog } from '../../../core/types'

export function logAudit(
  db: Database.Database,
  entry: Omit<AuditLog, 'id' | 'createdAt'>
): void {
  db.prepare(`
    INSERT INTO audit_log (user_id, user_name, entity_type, entity_id, operation, value_before, value_after, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.userId, entry.userName, entry.entityType, entry.entityId,
    entry.operation, entry.valueBefore, entry.valueAfter, entry.reason
  )
}

export function getAuditLog(
  db: Database.Database,
  opts: {
    entityType?: string
    entityId?: number
    userId?: number
    operation?: string
    dateFrom?: string
    dateTo?: string
    limit?: number
    offset?: number
  } = {}
): AuditLog[] {
  let q = `SELECT * FROM audit_log WHERE 1=1`
  const params: unknown[] = []
  if (opts.entityType) { q += ` AND entity_type=?`;         params.push(opts.entityType) }
  if (opts.entityId)   { q += ` AND entity_id=?`;           params.push(opts.entityId) }
  if (opts.userId)     { q += ` AND user_id=?`;             params.push(opts.userId) }
  if (opts.operation)  { q += ` AND operation=?`;           params.push(opts.operation) }
  if (opts.dateFrom)   { q += ` AND date(created_at)>=?`;   params.push(opts.dateFrom) }
  if (opts.dateTo)     { q += ` AND date(created_at)<=?`;   params.push(opts.dateTo) }
  q += ` ORDER BY created_at DESC`
  if (opts.limit)      { q += ` LIMIT ?`;  params.push(opts.limit) }
  if (opts.offset)     { q += ` OFFSET ?`; params.push(opts.offset) }
  return db.prepare(q).all(...params) as AuditLog[]
}

export function getAuditCount(
  db: Database.Database,
  opts: { entityType?: string; userId?: number; dateFrom?: string; dateTo?: string } = {}
): number {
  let q = `SELECT COUNT(*) as cnt FROM audit_log WHERE 1=1`
  const params: unknown[] = []
  if (opts.entityType) { q += ` AND entity_type=?`;       params.push(opts.entityType) }
  if (opts.userId)     { q += ` AND user_id=?`;           params.push(opts.userId) }
  if (opts.dateFrom)   { q += ` AND date(created_at)>=?`; params.push(opts.dateFrom) }
  if (opts.dateTo)     { q += ` AND date(created_at)<=?`; params.push(opts.dateTo) }
  const row = db.prepare(q).get(...params) as { cnt: number }
  return row.cnt
}
