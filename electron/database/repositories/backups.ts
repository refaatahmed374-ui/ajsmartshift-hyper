import { existsSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { gzip, gunzip } from 'zlib'
import { promisify } from 'util'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { backupsDir, dbPath } from '../../paths'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

// مسار ملف قاعدة البيانات (المصدر) — من وحدة المسارات وليس من كائن db
function srcDbPath(db: Database.Database): string {
  return (db as unknown as { name?: string }).name || dbPath()
}

export interface BackupFile {
  name:      string
  path:      string
  size:      number      // bytes
  createdAt: string      // ISO date
  type:      'auto' | 'manual' | 'exit' | 'import'
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
          name.startsWith('auto-')   ? 'auto' :
          name.startsWith('exit-')   ? 'exit' :
          name.startsWith('import-') ? 'import' : 'manual'
        return { name, path: filePath, size: stat.size, createdAt: stat.birthtime.toISOString(), type }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

// إنشاء نسخة مضغوطة (gzip) — prefix يحدد النوع: '' يدوي، 'auto-'، 'exit-'
// غير متزامن عمداً (v2.38.2): كانت readFileSync/gzipSync تحجب Main Process بالكامل أثناء ضغط قاعدة
// بيانات كبيرة (تشمل أي عملية IPC، مثل فتح شيفت جديد) لثوانٍ — تحدث فوراً عند إقلاع البرنامج وكل 24 ساعة.
export async function createBackup(db: Database.Database, prefix = ''): Promise<string> {
  const src = srcDbPath(db)
  const dir = getBackupDir()
  const dest = join(dir, `${prefix}backup-${nowStamp()}.db.gz`)
  const raw  = await readFile(src)
  await writeFile(dest, await gzipAsync(raw, { level: 9 }))
  return dest
}

export function deleteBackup(filePath: string): void {
  if (existsSync(filePath)) unlinkSync(filePath)
}

export async function restoreBackup(db: Database.Database, backupPath: string): Promise<void> {
  if (!existsSync(backupPath)) throw new Error('ملف النسخة غير موجود')
  const dest = srcDbPath(db)

  // نسخة أمان من الوضع الحالي قبل الاستعادة (مضغوطة)
  await writeFile(join(getBackupDir(), `before-restore-${nowStamp()}.db.gz`), await gzipAsync(await readFile(dest), { level: 9 }))

  // فكّ الضغط إن كانت مضغوطة
  const data = await readFile(backupPath)
  const restored = backupPath.endsWith('.gz') ? await gunzipAsync(data) : data
  await writeFile(dest, restored)
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

// تنظيف النسخ القديمة — بطلب العميل (v2.38.6): سقف إجمالي واحد لكل النسخ غير اليدوية مجتمعة
// (يومية + عند الخروج + قبل استيراد إكسيل)، يُبقي الأحدث فقط ويحذف الباقي. النسخ اليدوية مُستثناة دائماً.
export function pruneBackups(keep = 5): void {
  const nonManual = listBackups().filter(b => b.type !== 'manual')   // مُرتَّبة الأحدث أولاً بالفعل (listBackups)
  nonManual.slice(keep).forEach(b => { try { unlinkSync(b.path) } catch { /* ignore */ } })
}
