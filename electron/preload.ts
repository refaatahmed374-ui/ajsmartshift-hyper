import { contextBridge, ipcRenderer } from 'electron'

// API المعرّض للواجهة الأمامية عبر contextBridge
const api = {
  // نافذة
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
  },

  // مستخدمون
  users: {
    verify:         (u: string, p: string)            => ipcRenderer.invoke('users:verify', u, p),
    getAll:         ()                                => ipcRenderer.invoke('users:getAll'),
    create:         (data: unknown)                   => ipcRenderer.invoke('users:create', data),
    update:         (id: number, data: unknown)       => ipcRenderer.invoke('users:update', id, data),
    toggleActive:   (id: number)                      => ipcRenderer.invoke('users:toggleActive', id),
    updatePassword: (id: number, p: string)           => ipcRenderer.invoke('users:updatePassword', id, p),
  },

  // شيفتات
  shifts: {
    create:       (data: unknown)                         => ipcRenderer.invoke('shifts:create', data),
    getById:      (id: number)                            => ipcRenderer.invoke('shifts:getById', id),
    getAll:       (opts?: unknown)                        => ipcRenderer.invoke('shifts:getAll', opts),
    getActive:    ()                                      => ipcRenderer.invoke('shifts:getActive'),
    updateStatus:  (id: number, s: string, uid: number)  => ipcRenderer.invoke('shifts:updateStatus', id, s, uid),
    updateNote:    (id: number, note: string)            => ipcRenderer.invoke('shifts:updateNote', id, note),
    updateOpening: (id: number, bal: number)             => ipcRenderer.invoke('shifts:updateOpening', id, bal),
    updateCloseInputs: (id: number, data: unknown)       => ipcRenderer.invoke('shifts:updateCloseInputs', id, data),
    updateMeta:        (id: number, data: unknown)       => ipcRenderer.invoke('shifts:updateMeta', id, data),
    delete:        (id: number)                          => ipcRenderer.invoke('shifts:delete', id),
    close:        (id: number, cash: number, posSales: number, cashierRemaining: number) => ipcRenderer.invoke('shifts:close', id, cash, posSales, cashierRemaining),
  },

  // فوري
  fawry: {
    get:    (shiftId: number)          => ipcRenderer.invoke('fawry:get', shiftId),
    closingMonth: (month: string)      => ipcRenderer.invoke('fawry:closingMonth', month),
    allClosing:   ()                   => ipcRenderer.invoke('fawry:allClosing'),
    update: (shiftId: number, data: unknown) => ipcRenderer.invoke('fawry:update', shiftId, data),
  },

  // عهدة
  custody: {
    get:    (shiftId: number)          => ipcRenderer.invoke('custody:get', shiftId),
    getByShiftIds: (shiftIds: number[]) => ipcRenderer.invoke('custody:getByShiftIds', shiftIds),
    update: (shiftId: number, data: unknown) => ipcRenderer.invoke('custody:update', shiftId, data),
  },

  // يومية
  journal: {
    getByShift: (shiftId: number)      => ipcRenderer.invoke('journal:getByShift', shiftId),
  },

  // بنود
  tx: {
    getByShift: (shiftId: number)      => ipcRenderer.invoke('tx:getByShift', shiftId),
    getByShiftIds: (shiftIds: number[]) => ipcRenderer.invoke('tx:getByShiftIds', shiftIds),
    add:        (data: unknown)        => ipcRenderer.invoke('tx:add', data),
    addBatch:   (items: unknown[])     => ipcRenderer.invoke('tx:addBatch', items),
    update:     (id: number, data: unknown) => ipcRenderer.invoke('tx:update', id, data),
    delete:     (id: number)           => ipcRenderer.invoke('tx:delete', id),
    suggest:    (desc: string)         => ipcRenderer.invoke('tx:suggest', desc),
  },

  // تصنيفات
  cats: {
    getMain:    ()                                  => ipcRenderer.invoke('cats:getMain'),
    getSub:     (mid?: number)                      => ipcRenderer.invoke('cats:getSub', mid),
    getLabels:  ()                                  => ipcRenderer.invoke('cats:getLabels'),
    createMain: (data: unknown)                     => ipcRenderer.invoke('cats:createMain', data),
    updateMain: (id: number, data: unknown)         => ipcRenderer.invoke('cats:updateMain', id, data),
    deleteMain: (id: number)                        => ipcRenderer.invoke('cats:deleteMain', id),
    createSub:  (data: unknown)                     => ipcRenderer.invoke('cats:createSub', data),
    updateSub:  (id: number, name: string)          => ipcRenderer.invoke('cats:updateSub', id, name),
    deleteSub:  (id: number)                        => ipcRenderer.invoke('cats:deleteSub', id),
  },

  // استيراد اليومية من Excel
  excel: {
    analyze:      ()                                  => ipcRenderer.invoke('excel:analyze'),
    import:       (filePath: string, options: unknown) => ipcRenderer.invoke('excel:import', filePath, options),
    exportErrors: (errors: unknown[])                 => ipcRenderer.invoke('excel:exportErrors', errors),
  },

  // موظفون
  emp: {
    getAll:             ()                              => ipcRenderer.invoke('emp:getAll'),
    getActive:          ()                              => ipcRenderer.invoke('emp:getActive'),
    create:             (data: unknown)                 => ipcRenderer.invoke('emp:create', data),
    update:             (id: number, data: unknown)     => ipcRenderer.invoke('emp:update', id, data),
    setAttendance:      (data: unknown)                 => ipcRenderer.invoke('emp:setAttendance', data),
    setPenalty:         (empId: number, date: string, penaltyDays: number) => ipcRenderer.invoke('emp:setPenalty', empId, date, penaltyDays),
    deleteAttendance:   (id: number)                    => ipcRenderer.invoke('emp:deleteAttendance', id),
    getAttendanceMonth: (eid: number, month: string)    => ipcRenderer.invoke('emp:getAttendanceMonth', eid, month),
    financials:         (month: string)                 => ipcRenderer.invoke('emp:financials', month),
  },

  // الترخيص
  license: {
    status:   ()             => ipcRenderer.invoke('license:status'),
    activate: (key: string)  => ipcRenderer.invoke('license:activate', key),
    refresh:  ()             => ipcRenderer.invoke('license:refresh'),
    requestActivation: (opts: { customerName?: string; phone?: string; plan?: string; note?: string }) =>
                               ipcRenderer.invoke('license:requestActivation', opts),
  },

  // الصلاحيات
  perms: {
    getUser: (userId: number)                              => ipcRenderer.invoke('perms:getUser', userId),
    getAll:  ()                                            => ipcRenderer.invoke('perms:getAll'),
    set:     (uid: number, perm: string, granted: boolean) => ipcRenderer.invoke('perms:set', uid, perm, granted),
    init:    (uid: number, role: string)                   => ipcRenderer.invoke('perms:init', uid, role),
  },

  // سجل التعديلات
  audit: {
    log:   (entry: unknown)  => ipcRenderer.invoke('audit:log', entry),
    get:   (opts?: unknown)  => ipcRenderer.invoke('audit:get', opts),
    count: (opts?: unknown)  => ipcRenderer.invoke('audit:count', opts),
  },

  // التنبيهات
  notif: {
    create:      (data: unknown)   => ipcRenderer.invoke('notif:create', data),
    getAll:      (opts?: unknown)  => ipcRenderer.invoke('notif:getAll', opts),
    markRead:    (id: number)      => ipcRenderer.invoke('notif:markRead', id),
    markAllRead: ()                => ipcRenderer.invoke('notif:markAllRead'),
    delete:      (id: number)      => ipcRenderer.invoke('notif:delete', id),
    unreadCount: ()                => ipcRenderer.invoke('notif:unreadCount'),
  },

  // الخزينة
  treasury: {
    data: (month: string) => ipcRenderer.invoke('treasury:data', month),
    addAdjustment: (data: unknown) => ipcRenderer.invoke('treasury:addAdjustment', data),
  },

  // v2.27.0 (14-Jun) — الرواتب والتقفيل الشهري
  payroll: {
    save: (data: unknown) => ipcRenderer.invoke('payroll:save', data),
    list: () => ipcRenderer.invoke('payroll:list'),
    delete: (id: number) => ipcRenderer.invoke('payroll:delete', id),
  },
  monthlyClose: {
    save: (month: string, dataJson: string) => ipcRenderer.invoke('monthlyClose:save', month, dataJson),
    list: () => ipcRenderer.invoke('monthlyClose:list'),
    get:  (month: string) => ipcRenderer.invoke('monthlyClose:get', month),
  },

  // الإحصائيات
  stats: {
    overview:   (month: string) => ipcRenderer.invoke('stats:overview', month),
    financials: (month: string) => ipcRenderer.invoke('stats:financials', month),
  },

  // التحديثات التلقائية
  update: {
    check:    () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install:  () => ipcRenderer.invoke('update:install'),
    current:  () => ipcRenderer.invoke('update:current'),
    on: (event: string, cb: (data: unknown) => void) => {
      const ch = `update:${event}`
      const listener = (_e: unknown, data: unknown) => cb(data)
      ipcRenderer.on(ch, listener)
      return () => ipcRenderer.removeListener(ch, listener)
    },
  },

  // v2.27.0 (14-Jun) — فحص الذاكرة + معلومات النظام + فتح روابط
  taskbar: {
    progress:  (fraction: number) => ipcRenderer.send('taskbar:progress', fraction),
    flash:     () => ipcRenderer.send('taskbar:flash'),
    stopFlash: () => ipcRenderer.send('taskbar:stopFlash'),
  },

  system: {
    storageInfo: () => ipcRenderer.invoke('system:storageInfo'),
    cleanOld:    () => ipcRenderer.invoke('system:cleanOld'),
    info:        () => ipcRenderer.invoke('system:info'),
    openExternal:(url: string) => ipcRenderer.invoke('system:openExternal', url),
  },

  // CRM: العملاء والموردون
  party: {
    list:      (t: string)                       => ipcRenderer.invoke('party:list', t),
    create:    (t: string, data: unknown)        => ipcRenderer.invoke('party:create', t, data),
    update:    (t: string, id: number, d: unknown) => ipcRenderer.invoke('party:update', t, id, d),
    delete:    (t: string, id: number)           => ipcRenderer.invoke('party:delete', t, id),
    ledger:    (t: string, id: number)           => ipcRenderer.invoke('party:ledger', t, id),
    addEntry:  (data: unknown)                   => ipcRenderer.invoke('party:addEntry', data),
    delEntry:  (id: number)                      => ipcRenderer.invoke('party:delEntry', id),
    addPoints: (id: number, pts: number)         => ipcRenderer.invoke('party:addPoints', id, pts),
  },

  // إعدادات
  settings: {
    get:    (key: string)                => ipcRenderer.invoke('settings:get', key),
    set:    (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    getAll: ()                           => ipcRenderer.invoke('settings:getAll'),
  },

  // نسخ احتياطي
  backup: {
    now:        () => ipcRenderer.invoke('backup:now'),
    openFolder: () => ipcRenderer.invoke('backup:openFolder'),
    list:       () => ipcRenderer.invoke('backup:list'),
    create:     () => ipcRenderer.invoke('backup:create'),
    delete:     (path: string) => ipcRenderer.invoke('backup:delete', path),
    restore:    (path: string) => ipcRenderer.invoke('backup:restore', path),
  },

  // محو البيانات
  data: {
    wipe: (scope: 'accounting' | 'all') => ipcRenderer.invoke('data:wipe', scope),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
