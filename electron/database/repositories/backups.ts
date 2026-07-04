import { existsSync, readdirSync, statSync, copyFileSync, unlinkSync, readFileSync, writeFileSync } from 'fs'
import { gzipSync, gunzipSync } from 'zlib'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { backupsDir, dbPath } from '../../paths'

// مسار ملف قاعدة البيانات (المصدر) — من وحدة المسارات وليس من كائن db
function srcDbPath(db: Database.Database): string {
  return (db as unknown as { name?: string }).name || dbPath()
}

export interface BackupFile {
  name:      string
  path:      string
  size:      number      // bytes
  createdAt: string      // ISO date
  type:      'auto' | 'manual' | 'exit'
}

export function getBackupDir(): string {
  return backupsDir()   // C:\ProgramData\AJ Smart Shift\backups
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export function listBackups(): BackupFile[] {
  const dir = getBackupDir()
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.db') || f.endsWith('.db.gz'))
      .map(name => {
        const filePath = join(dir, name)
        const stat = statSync(filePath)
        const type: BackupFile['type'] =
          name.startsWith('auto-') ? 'auto' :
          name.startsWith('exit-') ? 'exit' : 'manual'
        return { name, path: filePath, size: stat.size, createdAt: stat.birthtime.toISOString(), type }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

// إنشاء نسخة مضغوطة (gzip) — prefix يحدد النوع: '' يدوي، 'auto-'، 'exit-'
export function createBackup(db: Database.Database, prefix = ''): string {
  const src = srcDbPath(db)
  const dir = getBackupDir()
  const dest = join(dir, `${prefix}backup-${nowStamp()}.db.gz`)
  const raw  = readFileSync(src)
  writeFileSync(dest, gzipSync(raw, { level: 9 }))
  return dest
}

export function deleteBackup(filePath: string): void {
  if (existsSync(filePath)) unlinkSync(filePath)
}

export function restoreBackup(db: Database.Database, backupPath: string): void {
  if (!existsSync(backupPath)) throw new Error('ملف النسخة غير موجود')
  const dest = srcDbPath(db)

  // نسخة أمان من الوضع الحالي قبل الاستعادة (مضغوطة)
  writeFileSync(join(getBackupDir(), `before-restore-${nowStamp()}.db.gz`), gzipSync(readFileSync(dest), { level: 9 }))

  // فكّ الضغط إن كانت مضغوطة
  const data = readFileSync(backupPath)
  const restored = backupPath.endsWith('.gz') ? gunzipSync(data) : data
  writeFileSync(dest, restored)
}

// ═══ v2.27.0 (14-Jun) — معلومات الذاكرة/التخزين ═══
export interface StorageInfo {
  dbSize:        number   // bytes
  backupsSize:   number   // bytes
  backupsCount:  number
  oldBackups:    number   // نسخ أقدم من 5 أيام
  oldBackupsSize: number  // bytes للنسخ القديمة
  totalSize:     number   // bytes
}

export function getStorageInfo(db: Database.Database): StorageInfo {
  let dbSize = 0
  try { dbSize = statSync(srcDbPath(db)).size } catch { /* ignore */ }

  const backups = listBackups()
  const backupsSize = backups.reduce((s, b) => s + b.size, 0)

  const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000
  const old = backups.filter(b => new Date(b.createdAt).getTime() < fiveDaysAgo)
  const oldBackupsSize = old.reduce((s, b) => s + b.size, 0)

  return {
    dbSize,
    backupsSize,
    backupsCount: backups.length,
    oldBackups: old.length,
    oldBackupsSize,
    totalSize: dbSize + backupsSize,
  }
}

// تنظيف النسخ الأقدم من 5 أيام (لا يمس قاعدة البيانات ولا بيانات العميل)
export function cleanOldBackups(daysOld = 5): { deleted: number; freedBytes: number } {
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000
  const backups = listBackups()
  let deleted = 0, freedBytes = 0
  for (const b of backups) {
    if (new Date(b.createdAt).getTime() < cutoff) {
      try { unlinkSync(b.path); deleted++; freedBytes += b.size } catch { /* ignore */ }
    }
  }
  return { deleted, freedBytes }
}

// تنظيف النسخ القديمة — إبقاء آخر N من كل نوع تلقائي/خروج
export function pruneBackups(keepAuto = 14, keepExit = 7): void {
  const all = listBackups()
  const prune = (type: BackupFile['type'], keep: number) => {
    const list = all.filter(b => b.type === type)
    list.slice(keep).forEach(b => { try { unlinkSync(b.path) } catch { /* ignore */ } })
  }
  prune('auto', keepAuto)
  prune('exit', keepExit)
}
