/**
 * paths.ts — المسارات المركزية للبيانات
 * ======================================
 * البيانات منفصلة عن البرنامج: C:\ProgramData\AJ Smart Shift\
 *   ├── database.sqlite
 *   ├── backups/
 *   ├── logs/
 *   └── license/aj.lic
 *
 * الفائدة: تحديث آمن للبرنامج + حماية البيانات + نسخ أسهل.
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

const APP_FOLDER = 'AJ Smart Shift'

// المجلد الجذر للبيانات
function baseDir(): string {
  if (process.platform === 'win32') {
    const pd = process.env.ProgramData || process.env.ALLUSERSPROFILE || 'C:\\ProgramData'
    return join(pd, APP_FOLDER)
  }
  // أنظمة أخرى (تطوير على غير ويندوز): داخل مجلد المستخدم
  return join(app.getPath('userData'), 'data')
}

export function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function dataDir():    string { return ensureDir(baseDir()) }
export function dbPath():     string { return join(dataDir(), 'database.sqlite') }
export function licenseDir(): string { return ensureDir(join(dataDir(), 'license')) }
export function backupsDir(): string { return ensureDir(join(dataDir(), 'backups')) }
export function logsDir():    string { return ensureDir(join(dataDir(), 'logs')) }

// ===== المسارات القديمة (للترحيل التلقائي مرة واحدة) =====
export function legacyDbPath():      string { return join(app.getPath('userData'), 'aj-smart-shift.db') }
export function legacyLicenseFile(): string { return join(app.getPath('userData'), 'license', 'aj.lic') }
export function legacyBackupsDir():  string { return join(app.getPath('documents'), 'AJ-SmartShift-Backups') }
