import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
import { join, basename } from 'path'
import ExcelJS from 'exceljs'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { getDb, closeDb, wipeData } from './database/index'
import * as UserRepo   from './database/repositories/users'
import * as ShiftRepo  from './database/repositories/shifts'
import * as TxRepo     from './database/repositories/transactions'
import * as EmpRepo    from './database/repositories/employees'
import * as AuditRepo  from './database/repositories/audit'
import * as NotifRepo  from './database/repositories/notifications'
import * as PermRepo   from './database/repositories/permissions'
import * as LicenseRepo from './database/repositories/license'
import * as TreasuryRepo from './database/repositories/treasury'
import * as StatsRepo    from './database/repositories/stats'
import * as PartyRepo    from './database/repositories/parties'
import * as BackupRepo from './database/repositories/backups'
import { backupsDir } from './paths'
import { analyze as excelAnalyze, runImport as excelRunImport } from './services/excelImport/pipeline'
import type { ImportOptions, ImportErrorRecord } from './services/excelImport/pipeline'
import type { IpcResult } from '../core/types'

// ===== النافذة الرئيسية =====
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width:  1400,
    height: 900,
    minWidth:  1100,
    minHeight: 700,
    frame: false,           // إطار مخصص (تحكم كامل)
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    show: false,
    titleBarStyle: 'hidden',
    // v2.27.0 (15-Jun) — أيقونة AJ الرسمية (نفس أيقونة سطح المكتب وشريط المهام)
    icon: join(__dirname, '../../resources/icon.ico'),
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' }) // وضع التطوير — لإظهار أخطاء الواجهة فوراً
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // أي خطأ يمنع تحميل الصفحة (شاشة بيضاء) يُطبع في الطرفية بدل الفشل الصامت
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[did-fail-load] ${code} ${desc} — ${url}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details)
  })

  mainWindow.once('ready-to-show', () => mainWindow!.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  // ⭐ يربط النافذة بأيقونة الاختصار المثبَّت في شريط مهام ويندوز (يمنع ظهور أيقونة Electron الافتراضية)
  app.setAppUserModelId('com.aj.smartshift')
  // تأكد من وجود مجلد البيانات
  const userData = app.getPath('userData')
  if (!existsSync(userData)) mkdirSync(userData, { recursive: true })

  createWindow()
  setupJumpList()
  scheduleAutoBackup()

  // فحص التحديثات تلقائياً (في النسخة المثبّتة فقط)
  if (app.isPackaged) {
    setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 5000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // نسخة احتياطية عند الخروج (مضغوطة)
  try { BackupRepo.createBackup(getDb(), 'exit-') } catch (e) { console.error('Exit backup failed:', e) }
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})

// ===== مساعد الـ IPC =====
function ok<T>(data: T): IpcResult<T> { return { ok: true, data } }
function err(error: string): IpcResult { return { ok: false, error } }

function handle<T>(
  channel: string,
  fn: (db: ReturnType<typeof getDb>, ...args: unknown[]) => T
): void {
  ipcMain.handle(channel, (_event, ...args) => {
    try {
      const db = getDb()
      const result = fn(db, ...args)
      return ok(result)
    } catch (e) {
      console.error(`[IPC] ${channel} error:`, e)
      return err((e as Error).message)
    }
  })
}

// ===== نافذة — تحكم =====
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ===== تكامل شريط مهام ويندوز (Taskbar) =====
// شريط تقدّم على أيقونة البرنامج (0..1، أو -1 للإخفاء)
ipcMain.on('taskbar:progress', (_e, fraction) => {
  const f = typeof fraction === 'number' ? fraction : -1
  try { mainWindow?.setProgressBar(f) } catch { /* */ }
})
// وميض الأيقونة عند حدث مهم والبرنامج غير مركّز عليه
ipcMain.on('taskbar:flash', () => {
  try { if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true) } catch { /* */ }
})
ipcMain.on('taskbar:stopFlash', () => { try { mainWindow?.flashFrame(false) } catch { /* */ } })

// Jump List — مهام سريعة عند كليك يمين على أيقونة البرنامج في ويندوز
function setupJumpList() {
  if (process.platform !== 'win32') return
  try {
    app.setUserTasks([
      { program: process.execPath, arguments: '', iconPath: process.execPath, iconIndex: 0,
        title: 'فتح AJ Smart Shift', description: 'فتح برنامج إدارة الشيفتات' },
    ])
  } catch { /* */ }
}

// ===== المستخدمون =====
handle('users:verify',          (db, u, p) => UserRepo.verifyUser(db, u as string, p as string))
handle('users:getAll',          (db)       => UserRepo.getAllUsers(db))
handle('users:create',          (db, data) => UserRepo.createUser(db, data as Parameters<typeof UserRepo.createUser>[1]))
handle('users:update',          (db, id, data) => UserRepo.updateUser(db, id as number, data as Parameters<typeof UserRepo.updateUser>[2]))
handle('users:toggleActive',    (db, id)   => UserRepo.toggleUserActive(db, id as number))
handle('users:updatePassword',  (db, id, p) => UserRepo.updateUserPassword(db, id as number, p as string))

// ===== الشيفتات =====
handle('shifts:create',         (db, data) => ShiftRepo.createShift(db, data as Parameters<typeof ShiftRepo.createShift>[1]))
handle('shifts:getById',        (db, id)   => ShiftRepo.getShiftById(db, id as number))
handle('shifts:getAll',         (db, opts) => ShiftRepo.getShifts(db, opts as Parameters<typeof ShiftRepo.getShifts>[1]))
handle('shifts:getActive',      (db)       => ShiftRepo.getActiveShift(db))
handle('shifts:updateStatus',   (db, id, s, uid) => ShiftRepo.updateShiftStatus(db, id as number, s as 'open'|'review'|'approved', uid as number))
handle('shifts:updateNote',     (db, id, note)   => ShiftRepo.updateShiftNote(db, id as number, note as string))
handle('shifts:updateOpening',  (db, id, bal)    => ShiftRepo.updateShiftOpeningBalance(db, id as number, bal as number))
handle('shifts:updateCloseInputs', (db, id, data) => ShiftRepo.updateShiftCloseInputs(db, id as number, data as Parameters<typeof ShiftRepo.updateShiftCloseInputs>[2]))
handle('shifts:updateMeta',     (db, id, data) => ShiftRepo.updateShiftMeta(db, id as number, data as Parameters<typeof ShiftRepo.updateShiftMeta>[2]))
handle('shifts:delete',         (db, id)         => ShiftRepo.deleteShift(db, id as number))
handle('shifts:close',          (db, id, cash, posSales, cashierRemaining) => {
  // v2.31.3 — إصلاح: تم تمرير `expectedCash` بدلاً من `cashierRemaining` كـ `actualCash`.
  // الآن `cash` هو `cashierRemaining` الفعلي.
  // تم حذف منطق التنبيهات القديم من هنا، حيث لا يُستخدم.
  return ShiftRepo.closeShift(db, id as number, cash as number, (posSales as number) ?? 0, (cashierRemaining as number) ?? 0)
})

// ===== فوري =====
handle('fawry:get',             (db, sid)  => ShiftRepo.getFawry(db, sid as number))
handle('fawry:closingMonth',    (db, month) => ShiftRepo.getFawryClosingMonth(db, month as string))
handle('fawry:allClosing',      (db)        => ShiftRepo.getAllFawryClosing(db))
handle('fawry:update',          (db, sid, data) => ShiftRepo.updateFawry(db, sid as number, data as Parameters<typeof ShiftRepo.updateFawry>[2]))

// ===== العهدة =====
handle('custody:get',           (db, sid)  => ShiftRepo.getCustody(db, sid as number))
handle('custody:getByShiftIds', (db, sids) => ShiftRepo.getCustodyByShiftIds(db, sids as number[]))
handle('custody:update',        (db, sid, data) => ShiftRepo.updateCustody(db, sid as number, data as Parameters<typeof ShiftRepo.updateCustody>[2]))

// ===== اليومية =====
handle('journal:getByShift',    (db, sid)  => ShiftRepo.getJournalByShift(db, sid as number))

// ===== البنود =====
handle('tx:getByShift',         (db, sid)  => TxRepo.getTransactionsByShift(db, sid as number))
handle('tx:getByShiftIds',      (db, sids) => TxRepo.getTransactionsByShiftIds(db, sids as number[]))
handle('tx:add',                (db, data) => TxRepo.addTransaction(db, data as Parameters<typeof TxRepo.addTransaction>[1]))
handle('tx:addBatch',           (db, items) => TxRepo.addTransactionsBatch(db, items as Parameters<typeof TxRepo.addTransactionsBatch>[1]))
handle('tx:update',             (db, id, data) => TxRepo.updateTransaction(db, id as number, data as Parameters<typeof TxRepo.updateTransaction>[2]))
handle('tx:delete',             (db, id)   => TxRepo.deleteTransaction(db, id as number))
handle('tx:suggest',            (db, desc) => TxRepo.suggestCategory(db, desc as string))

// ===== التصنيفات =====
handle('cats:getMain',          (db)       => TxRepo.getMainCategories(db))
handle('cats:getSub',           (db, mid)  => TxRepo.getSubCategories(db, mid as number | undefined))
handle('cats:getLabels',        (db)       => TxRepo.getSmartLabels(db))
handle('cats:createMain',       (db, data) => TxRepo.createMainCategory(db, data as { name: string; color: string }))
handle('cats:updateMain',       (db, id, data) => TxRepo.updateMainCategory(db, id as number, data as { name?: string; color?: string }))
handle('cats:deleteMain',       (db, id)   => TxRepo.deleteMainCategory(db, id as number))
handle('cats:createSub',        (db, data) => TxRepo.createSubCategory(db, data as { mainCategoryId: number; name: string }))
handle('cats:updateSub',        (db, id, name) => TxRepo.updateSubCategory(db, id as number, name as string))
handle('cats:deleteSub',        (db, id)   => TxRepo.deleteSubCategory(db, id as number))

// ===== الموظفون =====
handle('emp:getAll',            (db)       => EmpRepo.getAllEmployees(db))
handle('emp:getActive',         (db)       => EmpRepo.getActiveEmployees(db))
handle('emp:create',            (db, data) => EmpRepo.createEmployee(db, data as Parameters<typeof EmpRepo.createEmployee>[1]))
handle('emp:update',            (db, id, data) => EmpRepo.updateEmployee(db, id as number, data as Parameters<typeof EmpRepo.updateEmployee>[2]))
handle('emp:setAttendance',     (db, data) => EmpRepo.setAttendance(db, data as Parameters<typeof EmpRepo.setAttendance>[1]))
handle('emp:setPenalty',        (db, empId, date, penaltyDays) => EmpRepo.setAttendancePenalty(db, empId as number, date as string, penaltyDays as number))
handle('emp:deleteAttendance',  (db, id)   => EmpRepo.deleteAttendance(db, id as number))
handle('emp:getAttendanceMonth',(db, eid, month) => EmpRepo.getAttendanceMonth(db, eid as number, month as string))
handle('emp:financials',        (db, month) => EmpRepo.getMonthlyFinancials(db, month as string))

// ===== سجل التعديلات =====
handle('audit:log',             (db, entry) => AuditRepo.logAudit(db, entry as Parameters<typeof AuditRepo.logAudit>[1]))
handle('audit:get',             (db, opts)  => AuditRepo.getAuditLog(db, opts as Parameters<typeof AuditRepo.getAuditLog>[1]))
handle('audit:count',           (db, opts)  => AuditRepo.getAuditCount(db, opts as Parameters<typeof AuditRepo.getAuditCount>[1]))

// ===== التحديثات التلقائية =====
autoUpdater.autoDownload = false   // لا ننزّل تلقائياً — ننتظر موافقة المستخدم
let updateInfo: { version: string } | null = null

function sendToRenderer(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, payload))
}
autoUpdater.on('update-available', (info) => { updateInfo = { version: info.version }; sendToRenderer('update:available', { version: info.version }) })
autoUpdater.on('update-not-available', () => sendToRenderer('update:none', {}))
autoUpdater.on('error', (e) => sendToRenderer('update:error', { message: String(e) }))
autoUpdater.on('download-progress', (p) => sendToRenderer('update:progress', { percent: Math.round(p.percent) }))
autoUpdater.on('update-downloaded', () => sendToRenderer('update:downloaded', updateInfo))

ipcMain.handle('update:check',    async () => { try { const r = await autoUpdater.checkForUpdates(); return ok({ version: r?.updateInfo?.version ?? null }) } catch (e) { return err((e as Error).message) } })
ipcMain.handle('update:download', async () => { try { await autoUpdater.downloadUpdate(); return ok(true) } catch (e) { return err((e as Error).message) } })
ipcMain.handle('update:install',  () => { autoUpdater.quitAndInstall(); return ok(true) })
ipcMain.handle('update:current',  () => ok({ version: app.getVersion() }))

// ===== الترخيص =====
ipcMain.handle('license:status',   () => { try { return ok(LicenseRepo.getLicenseStatus()) } catch (e) { return err((e as Error).message) } })
ipcMain.handle('license:activate', (_e, key) => { try { return ok(LicenseRepo.activateLicense(key as string)) } catch (e) { return err((e as Error).message) } })
ipcMain.handle('license:refresh',  async () => { try { return ok(await LicenseRepo.refreshLicenseOnline()) } catch (e) { return err((e as Error).message) } })
ipcMain.handle('license:requestActivation', async (_e, opts) => { try { return ok(await LicenseRepo.submitActivationRequest(opts ?? {})) } catch (e) { return err((e as Error).message) } })

// ===== الصلاحيات =====
handle('perms:getUser',    (db, uid)         => PermRepo.getUserPermissions(db, uid as number))
handle('perms:getAll',     (db)              => PermRepo.getAllUsersPermissions(db))
handle('perms:set',        (db, uid, perm, granted) => PermRepo.setPermission(db, uid as number, perm as import('../core/types').Permission, granted as boolean))
handle('perms:init',       (db, uid, role)   => PermRepo.initDefaultPermissions(db, uid as number, role as import('../core/types').Role))

// ===== التنبيهات =====
handle('notif:create',     (db, data)  => NotifRepo.createNotification(db, data as Parameters<typeof NotifRepo.createNotification>[1]))
handle('notif:getAll',     (db, opts)  => NotifRepo.getNotifications(db, opts as Parameters<typeof NotifRepo.getNotifications>[1]))
handle('notif:markRead',   (db, id)    => NotifRepo.markNotificationRead(db, id as number))
handle('notif:markAllRead',(db)        => NotifRepo.markAllRead(db))
handle('notif:delete',     (db, id)    => NotifRepo.deleteNotification(db, id as number))
handle('notif:unreadCount',(db)        => NotifRepo.getUnreadCount(db))

// ===== الخزينة =====
handle('treasury:data', (db, month) => TreasuryRepo.getTreasuryData(db, month as string))
// v2.27.0 (14-Jun) — تسويات الخزينة + الرواتب + التقفيل الشهري
handle('treasury:addAdjustment', (db, data) => TreasuryRepo.addTreasuryAdjustment(db, data as Parameters<typeof TreasuryRepo.addTreasuryAdjustment>[1]))
handle('payroll:save',          (db, data) => TreasuryRepo.savePayrollReport(db, data as Parameters<typeof TreasuryRepo.savePayrollReport>[1]))
handle('payroll:list',          (db)       => TreasuryRepo.listPayrollReports(db))
handle('payroll:delete',        (db, id)   => TreasuryRepo.deletePayrollReport(db, id as number))
handle('monthlyClose:save',     (db, month, dataJson) => TreasuryRepo.saveMonthlyClose(db, month as string, dataJson as string))
handle('monthlyClose:list',     (db)       => TreasuryRepo.listMonthlyCloses(db))
handle('monthlyClose:get',      (db, month) => TreasuryRepo.getMonthlyClose(db, month as string))

// ===== الإحصائيات (داشبورد + مالية) =====
handle('stats:overview',   (db, month) => StatsRepo.getOverview(db, month as string))
handle('stats:financials', (db, month) => StatsRepo.getFinancials(db, month as string))

// ===== CRM: العملاء والموردون =====
handle('party:list',      (db, t)        => PartyRepo.getParties(db, t as PartyRepo.PartyType))
handle('party:create',    (db, t, data)  => PartyRepo.createParty(db, t as PartyRepo.PartyType, data as Parameters<typeof PartyRepo.createParty>[2]))
handle('party:update',    (db, t, id, d) => PartyRepo.updateParty(db, t as PartyRepo.PartyType, id as number, d as Parameters<typeof PartyRepo.updateParty>[3]))
handle('party:delete',    (db, t, id)    => PartyRepo.deleteParty(db, t as PartyRepo.PartyType, id as number))
handle('party:ledger',    (db, t, id)    => PartyRepo.getLedger(db, t as PartyRepo.PartyType, id as number))
handle('party:addEntry',  (db, data)     => PartyRepo.addLedgerEntry(db, data as Parameters<typeof PartyRepo.addLedgerEntry>[1]))
handle('party:delEntry',  (db, id)       => PartyRepo.deleteLedgerEntry(db, id as number))
handle('party:addPoints', (db, id, pts)  => PartyRepo.addLoyaltyPoints(db, id as number, pts as number))

// ===== النسخ الاحتياطي (معزّز) =====
handle('backup:list',        (db)        => BackupRepo.listBackups())
handle('backup:create',      (db)        => BackupRepo.createBackup(db))
handle('backup:delete',      (_db, path) => BackupRepo.deleteBackup(path as string))
// استعادة نسخة احتياطية: تُكتب فوراً على ملف القاعدة الحيّ، ثم يُعاد تشغيل التطبيق ليقرأها من جديد
ipcMain.handle('backup:restore', async (_e, backupPath) => {
  try {
    const db = getDb()
    closeDb()
    BackupRepo.restoreBackup(db, backupPath as string)
    app.relaunch()
    app.exit(0)
    return ok(null)
  } catch (e) { return err((e as Error).message) }
})
// محو البيانات (محاسبية فقط / إعادة ضبط كاملة)
handle('data:wipe',          (_db, scope) => { wipeData(scope as 'accounting' | 'all'); return true })
// v2.27.0 (14-Jun) — فحص الذاكرة + تنظيف القديم + معلومات النظام
handle('system:storageInfo', (db)        => BackupRepo.getStorageInfo(db))
handle('system:cleanOld',    (_db)       => BackupRepo.cleanOldBackups(5))
handle('system:info',        ()          => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
}))
ipcMain.handle('system:openExternal', (_e, url) => { shell.openExternal(url as string); return ok(true) })

// ===== استيراد اليومية من Excel =====
// تحليل: اختيار ملف + قراءة + معاينة (بلا إدراج)
ipcMain.handle('excel:analyze', async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'اختر ملف Excel لاستيراد اليومية',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
    })
    if (res.canceled || !res.filePaths[0]) return ok({ canceled: true })
    const filePath = res.filePaths[0]
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const analysis = excelAnalyze(getDb(), wb, basename(filePath))
    return ok({ canceled: false, filePath, fileName: basename(filePath), analysis })
  } catch (e) { return err((e as Error).message) }
})
// الاستيراد الفعلي بعد تأكيد التعيينات
ipcMain.handle('excel:import', async (_e, filePath, options) => {
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath as string)
    const report = excelRunImport(getDb(), wb, options as ImportOptions)
    return ok(report)
  } catch (e) { return err((e as Error).message) }
})
// تصدير سجل الأخطاء إلى Excel
ipcMain.handle('excel:exportErrors', async (_e, errors) => {
  try {
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'حفظ سجل الأخطاء', defaultPath: 'import-errors.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    })
    if (res.canceled || !res.filePath) return ok({ canceled: true })
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('الأخطاء')
    ws.addRow(['الورقة', 'الصف', 'نوع الخطأ', 'البيانات الأصلية', 'الوصف'])
    for (const er of errors as ImportErrorRecord[]) ws.addRow([er.sheet, er.row, er.type, er.original, er.message])
    await wb.xlsx.writeFile(res.filePath)
    return ok({ canceled: false, path: res.filePath })
  } catch (e) { return err((e as Error).message) }
})

// ===== الإعدادات =====
handle('settings:get', (db, key) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key as string) as { value: string } | undefined
  return row?.value ?? null
})
handle('settings:set', (db, key, value) => {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key as string, value as string)
})
handle('settings:getAll', (db) => {
  return db.prepare(`SELECT * FROM settings`).all()
})

// ===== النسخ الاحتياطي =====
ipcMain.handle('backup:now', async () => {
  try {
    const db       = getDb()
    const src      = (db as unknown as { filename: string }).filename
    const backupDir = backupsDir()
    const date   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dest   = join(backupDir, `backup-${date}.db`)
    copyFileSync(src, dest)
    return ok(dest)
  } catch (e) {
    return err((e as Error).message)
  }
})

ipcMain.handle('backup:openFolder', async () => {
  const dir = backupsDir()
  shell.openPath(dir)
  return ok(null)
})

// ===== نسخ احتياطي تلقائي يومي =====
function scheduleAutoBackup(): void {
  const INTERVAL_MS = 24 * 60 * 60 * 1000  // 24 ساعة

  function doBackup(): void {
    try {
      const db = getDb()
      BackupRepo.createBackup(db, 'auto-')   // مضغوطة gzip
      BackupRepo.pruneBackups()               // تنظيف القديمة
    } catch (e) {
      console.error('Auto backup failed:', e)
    }
  }

  doBackup()
  setInterval(doBackup, INTERVAL_MS)
}
