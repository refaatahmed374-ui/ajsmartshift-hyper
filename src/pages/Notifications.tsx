import { useState, useEffect } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import Icons from '../components/Icon'
import type { Notification } from '../../core/types'

// v2.27.0 (15-Jun)
const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  deficit: { label: 'عجز',  color: '#ef4444' },
  surplus: { label: 'أوفر', color: '#f59e0b' },
  info:    { label: 'معلومة', color: '#10b981' },
}

const WEBSITE = 'https://ajsmartshift.store'

// إحصائيات البرنامج (محسوبة من حجم المشروع الفعلي)
const CODE_STATS = {
  totalLines: 13566,
  srcLines:   10320,
  files:      60,
  components:  30,
  devHours:   270,
}

// إمكانيات النسخة الحالية (تقنية)
const CURRENT_FEATURES = [
  { icon: '📋', label: 'نظام يومية متسلسل (5 مراحل)', color: '#3b82f6' },
  { icon: '📡', label: 'تقفيل ماكينة فوري الكامل', color: '#8b5cf6' },
  { icon: '💰', label: 'حسابات الصندوق', color: '#f59e0b' },
  { icon: '👥', label: 'إدارة الموظفين + الرواتب', color: '#06b6d4' },
  { icon: '🧾', label: 'العملاء والموردون + كشف الحساب', color: '#10b981' },
  { icon: '📊', label: '9 أنواع تقارير + PDF', color: '#ef4444' },
  { icon: '🔐', label: 'صلاحيات مرنة لكل مستخدم', color: '#ec4899' },
  { icon: '🔄', label: 'تحديث تلقائي + نسخ احتياطي', color: '#14b8a6' },
]

// خطة التطوير القادمة
const ROADMAP = [
  { phase: 'قريباً', label: 'تكامل مع أجهزة الباركود والميزان', status: 'planned', color: '#3b82f6' },
  { phase: 'قريباً', label: 'تطبيق جوال للمتابعة عن بُعد', status: 'planned', color: '#8b5cf6' },
  { phase: 'مستقبلاً', label: 'الذكاء الاصطناعي للتنبؤ بالمبيعات', status: 'future', color: '#f59e0b' },
  { phase: 'مستقبلاً', label: 'ربط فروع متعددة (Multi-Branch)', status: 'future', color: '#10b981' },
]

const TOOLS = [
  { name: 'Electron 29',      desc: 'بيئة تشغيل سطح المكتب',     icon: '⚛️',  color: '#3b82f6', ver: '29.1.4' },
  { name: 'SQLite 3',         desc: 'قاعدة بيانات محلية سريعة',  icon: '🗄️', color: '#10b981', ver: '3.45' },
  { name: 'React 18 + Vite',  desc: 'واجهة مستخدم تفاعلية',     icon: '⚡', color: '#06b6d4', ver: '18.3' },
  { name: 'electron-updater', desc: 'التحديث التلقائي',          icon: '🔄', color: '#8b5cf6', ver: '6.8' },
  { name: 'jsPDF',            desc: 'توليد تقارير PDF',          icon: '📄', color: '#ef4444', ver: '2.5' },
  { name: 'better-sqlite3',   desc: 'محرّك قاعدة البيانات',      icon: '💾', color: '#f59e0b', ver: '9.4' },
  { name: 'TypeScript',       desc: 'لغة آمنة الأنواع',          icon: '🔷', color: '#2563eb', ver: '5.4' },
  { name: 'Tailwind CSS',     desc: 'تصميم احترافي',            icon: '🎨', color: '#14b8a6', ver: '3.4' },
]

interface StorageInfo {
  dbSize: number; backupsSize: number; backupsCount: number
  oldBackups: number; oldBackupsSize: number; totalSize: number
}
interface SysInfo { version: string; electron: string; chrome: string; node: string; platform: string; arch: string }

function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB'
  return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

type Section = 'alerts' | 'updates' | 'tools' | 'memory'

export default function NotificationsPage({ embedded = false, forcedSection }: { embedded?: boolean; forcedSection?: Section } = {}) {
  const { show } = useToast()
  const [localSection, setSection] = useState<Section>('alerts')
  const section = forcedSection ?? localSection

  const [notifs, setNotifs] = useState<Notification[]>([])
  const [unreadOnly, setUnreadOnly] = useState(false)

  const [sysInfo,    setSysInfo]    = useState<SysInfo | null>(null)
  const [checking,   setChecking]   = useState(false)
  const [updateVer,  setUpdateVer]  = useState<string | null>(null)
  const [updateMsg,  setUpdateMsg]  = useState('')
  const [didUpdate,  setDidUpdate]  = useState(false)

  const [storage,    setStorage]    = useState<StorageInfo | null>(null)
  const [cleaning,   setCleaning]   = useState(false)
  const [cleanResult, setCleanResult] = useState<{ deleted: number; freedBytes: number } | null>(null)
  const [cleanProgress, setCleanProgress] = useState(0)

  async function loadNotifs() {
    try {
      const all = await call(api.notif.getAll({ unreadOnly })) as Notification[]
      setNotifs(all.filter(n => n.type !== 'approval_pending'))
    } catch (e) { show((e as Error).message, 'error') }
  }  
  async function loadSysInfo() { try { setSysInfo(await call(api.system.info()) as SysInfo) } catch (e) { console.error('Failed to load system info:', e) } }
  async function loadStorage() { try { setStorage(await call(api.system.storageInfo()) as StorageInfo) } catch (e) { console.error('Failed to load storage info:', e) } }

  useEffect(() => { loadNotifs() }, [unreadOnly])
  useEffect(() => { loadSysInfo(); loadStorage() }, [])

  async function markRead(id: number) { try { await call(api.notif.markRead(id)); await loadNotifs() } catch {} }
  async function markAll() { try { await call(api.notif.markAllRead()); show('تم تحديد الكل كمقروء', 'success'); await loadNotifs() } catch {} }
  async function deleteNotif(id: number) { try { await call(api.notif.delete(id)); await loadNotifs() } catch {} }

  async function checkUpdate() {
    setChecking(true); setUpdateMsg('')
    try {
      const r = await call(api.update.check()) as { version: string | null }
      if (r.version && sysInfo && r.version !== sysInfo.version) {
        setUpdateVer(r.version); setUpdateMsg(`يتوفر تحديث جديد: v${r.version}`)
      } else { setUpdateVer(null); setUpdateMsg('أنت تستخدم آخر إصدار ✓') }
    } catch { setUpdateMsg('تعذّر الفحص — افتح الموقع يدوياً') }
    finally { setChecking(false) }
  }
  function openWebsite() {
    call(api.system.openExternal(WEBSITE)).catch(() => {})
    setDidUpdate(true) // محاكاة: بعد فتح الموقع نعرض إمكانيات النسخة المحدّثة
  }

  // تنظيف الذاكرة مع شريط تحميل احترافي + تجميد
  async function cleanMemory() {
    setCleaning(true); setCleanResult(null); setCleanProgress(0)
    // محاكاة تقدّم احترافي + شريط تقدّم على أيقونة ويندوز
    const timer = setInterval(() => setCleanProgress(p => {
      const n = Math.min(p + 7, 92)
      try { window.api.taskbar.progress(n / 100) } catch { /* */ }
      return n
    }), 80)
    try {
      const r = await call(api.system.cleanOld()) as { deleted: number; freedBytes: number }
      clearInterval(timer)
      setCleanProgress(100)
      try { window.api.taskbar.progress(1) } catch { /* */ }
      await new Promise(res => setTimeout(res, 350))
      setCleanResult(r)
      await loadStorage()
    } catch (e) { clearInterval(timer); show((e as Error).message, 'error') }
    finally { setCleaning(false); try { window.api.taskbar.progress(-1) } catch { /* */ } }
  }

  const unreadCount = notifs.filter(n => !n.isRead).length

  const sections: { id: Section; label: string; icon: string; badge?: number }[] = [
    { id: 'alerts',  label: 'التنبيهات',       icon: '🔔', badge: unreadCount },
    { id: 'updates', label: 'تحديثات البرنامج', icon: '🔄' },
    { id: 'tools',   label: 'الأدوات المساعدة', icon: '🧩' },
    { id: 'memory',  label: 'إدارة الذاكرة',    icon: '💾' },
  ]

  return (
    <div className={embedded ? '' : 'flex-1 flex flex-col overflow-hidden'}>
      {/* شريط الأقسام — يُخفى في الوضع المُضمّن (داخل الإعدادات) */}
      {!embedded && (
      <div className="flex items-center gap-1 px-4 pt-3 flex-shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
        {sections.map(s => {
          const active = section === s.id
          return (
            <button key={s.id} onClick={() => setSection(s.id)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg transition-all"
              style={{
                fontSize: 14, fontWeight: active ? 700 : 500,
                color: active ? 'var(--accent)' : 'var(--txt-2)',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                background: active ? 'rgba(59,130,246,0.08)' : 'transparent',
              }}>
              <span>{s.icon}</span>{s.label}
              {s.badge ? <span className="text-2xs rounded-full px-1.5 font-bold" style={{ background: '#ef4444', color: 'white' }}>{s.badge}</span> : null}
            </button>
          )
        })}
      </div>
      )}

      <div className={embedded ? '' : 'flex-1 overflow-y-auto p-4'}>
        {/* ═══ التنبيهات ═══ */}
        {section === 'alerts' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>التنبيهات ({notifs.length})</span>
              <label className="flex items-center gap-1.5 text-xs mr-auto" style={{ color: 'var(--txt-2)' }}>
                <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} /> غير المقروءة فقط
              </label>
              <button onClick={markAll} className="btn-ghost btn-sm" style={{ fontSize: 11 }}>تحديد الكل مقروء</button>
            </div>
            {notifs.length === 0 ? (
              <div className="flex flex-col items-center py-12 gap-2" style={{ color: 'var(--txt-3)' }}>
                <Icons.Bell size={40} className="opacity-20" /><span className="text-sm">لا توجد تنبيهات</span>
              </div>
            ) : notifs.map(n => {
              const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info
              return (
                <div key={n.id} className="card flex items-center gap-3 p-3" style={{ borderRight: `3px solid ${cfg.color}`, opacity: n.isRead ? 0.7 : 1 }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-2xs px-1.5 py-0.5 rounded font-bold" style={{ background: cfg.color + '22', color: cfg.color }}>{cfg.label}</span>
                      <span className="font-bold text-sm truncate" style={{ color: 'var(--txt-1)' }}>{n.title}</span>
                    </div>
                    <div className="text-xs" style={{ color: 'var(--txt-2)' }}>{n.message}</div>
                  </div>
                  {!n.isRead && <button onClick={() => markRead(n.id)} className="p-1.5 rounded hover:bg-white/10" style={{ color: 'var(--accent)' }}><Icons.Check size={14} /></button>}
                  <button onClick={() => deleteNotif(n.id)} className="p-1.5 rounded hover:bg-white/10 hover:text-danger" style={{ color: 'var(--txt-3)' }}><Icons.Trash size={13} /></button>
                </div>
              )
            })}
          </div>
        )}

        {/* ═══ تحديثات البرنامج — full page احترافي ═══ */}
        {section === 'updates' && (
          <div className="space-y-4">
            {/* Hero */}
            <div className="rounded-2xl p-6 relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #1e3a8a, #1e293b)', color: 'white' }}>
              <div style={{ position: 'absolute', top: -40, left: -40, width: 180, height: 180, borderRadius: '50%', background: '#3b82f6', opacity: 0.2, filter: 'blur(40px)' }} />
              <div className="relative flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl"
                    style={{ background: 'linear-gradient(135deg, #3b82f6, #1e3a8a)', boxShadow: '0 6px 20px rgba(59,130,246,0.5)' }}>AJ</div>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>AJ Smart Shift Hyper</div>
                    <div style={{ fontSize: 13, opacity: 0.85 }}>الإصدار الحالي: <b>v{sysInfo?.version ?? '—'}</b></div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={checkUpdate} disabled={checking} className="btn-primary" style={{ fontSize: 13, padding: '10px 18px' }}>
                    {checking ? <><Icons.Refresh size={14} className="animate-spin" /> فحص...</> : <><Icons.Refresh size={14} /> فحص التحديثات</>}
                  </button>
                  <button onClick={openWebsite} className="btn-success-pro" style={{ fontSize: 13, padding: '10px 18px' }}>⬇ تحديث البرنامج</button>
                </div>
              </div>
              {updateMsg && (
                <div className="relative mt-4 inline-block px-4 py-2 rounded-lg text-sm font-bold"
                  style={{ background: updateVer ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.25)', color: updateVer ? '#fbbf24' : '#34d399' }}>
                  {updateMsg}
                </div>
              )}
            </div>

            {/* إحصائيات الكود — رسوم بيانية احترافية */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'سطر برمجي', value: CODE_STATS.totalLines.toLocaleString(), color: '#3b82f6', icon: '📝' },
                { label: 'ملف', value: CODE_STATS.files, color: '#8b5cf6', icon: '📁' },
                { label: 'مكوّن', value: CODE_STATS.components, color: '#06b6d4', icon: '🧩' },
                { label: 'ساعة تطوير', value: CODE_STATS.devHours, color: '#f59e0b', icon: '⏱️' },
                { label: 'أسطر الواجهة', value: CODE_STATS.srcLines.toLocaleString(), color: '#10b981', icon: '🎨' },
              ].map(c => (
                <div key={c.label} className="rounded-2xl p-4 text-center" style={{ background: c.color + '12', border: `1px solid ${c.color}38` }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{c.icon}</div>
                  <div className="tabular-nums font-black" style={{ fontSize: 20, color: c.color }}>{c.value}</div>
                  <div className="text-2xs" style={{ color: 'var(--txt-3)' }}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* إمكانيات النسخة الحالية */}
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span style={{ fontSize: 16 }}>✨</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt-1)' }}>إمكانيات النسخة الحالية</span>
                <span className="text-2xs px-2 py-0.5 rounded-md mr-auto" style={{ background: 'rgba(59,130,246,0.15)', color: 'var(--accent)' }}>v{sysInfo?.version ?? '2.27.0'}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {CURRENT_FEATURES.map(f => (
                  <div key={f.label} className="flex items-center gap-2.5 p-2.5 rounded-xl" style={{ background: f.color + '0e', border: `1px solid ${f.color}30` }}>
                    <span style={{ fontSize: 18 }}>{f.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-1)' }}>{f.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* إمكانيات النسخة المحدّثة (تظهر بعد الضغط على تحديث) */}
            {didUpdate && (
              <div className="card p-4 slide-up" style={{ border: '1.5px solid rgba(16,185,129,0.40)', background: 'rgba(16,185,129,0.04)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <span style={{ fontSize: 16 }}>🚀</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#10b981' }}>إمكانيات بعد التحديث</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {ROADMAP.map(r => (
                    <div key={r.label} className="flex items-center gap-2.5 p-2.5 rounded-xl" style={{ background: r.color + '0e', border: `1px solid ${r.color}30` }}>
                      <span className="text-2xs px-2 py-0.5 rounded-md font-bold" style={{ background: r.color + '22', color: r.color }}>{r.phase}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-1)' }}>{r.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* خطة التطوير — Timeline */}
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-4">
                <span style={{ fontSize: 16 }}>🗺️</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt-1)' }}>خطة التطوير القادمة</span>
              </div>
              <div className="space-y-3">
                {ROADMAP.map((r, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 rounded-full" style={{ background: r.color, boxShadow: `0 0 8px ${r.color}88` }} />
                      {i < ROADMAP.length - 1 && <div className="w-0.5 h-6" style={{ background: 'var(--inner-border)' }} />}
                    </div>
                    <div className="flex-1 flex items-center gap-2 p-2.5 rounded-xl" style={{ background: 'var(--inner-bg)' }}>
                      <span className="text-2xs px-2 py-0.5 rounded-md font-bold" style={{ background: r.color + '20', color: r.color }}>{r.phase}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--txt-1)' }}>{r.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ الأدوات المساعدة ═══ */}
        {section === 'tools' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 16 }}>🧩</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt-1)' }}>الأدوات والمكتبات المتكاملة</span>
              <span className="text-2xs px-2 py-0.5 rounded-md mr-auto" style={{ background: 'var(--inner-bg)', color: 'var(--txt-3)' }}>{TOOLS.length} أداة</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {TOOLS.map(t => (
                <div key={t.name} className="rounded-2xl p-4 relative overflow-hidden" style={{ background: t.color + '0e', border: `1px solid ${t.color}35` }}>
                  <div style={{ position: 'absolute', top: -20, left: -20, width: 70, height: 70, borderRadius: '50%', background: t.color, opacity: 0.08, filter: 'blur(18px)' }} />
                  <div className="relative flex items-center gap-3 mb-2">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: t.color + '20', fontSize: 22 }}>{t.icon}</div>
                    <div>
                      <div className="font-bold text-sm" style={{ color: 'var(--txt-1)' }}>{t.name}</div>
                      <div className="text-2xs px-1.5 rounded inline-block mt-0.5" style={{ background: t.color + '20', color: t.color }}>v{t.ver}</div>
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--txt-2)' }}>{t.desc}</div>
                </div>
              ))}
            </div>
            {sysInfo && (
              <div className="card p-4">
                <div className="font-bold text-sm mb-3" style={{ color: 'var(--txt-1)' }}>⚙️ معلومات بيئة التشغيل</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                  {[['الإصدار','v'+sysInfo.version],['Electron',sysInfo.electron],['Chrome',sysInfo.chrome],['Node',sysInfo.node],['النظام',sysInfo.platform],['المعمارية',sysInfo.arch]].map(([k,v]) => (
                    <div key={k} className="flex flex-col p-2.5 rounded-lg" style={{ background: 'var(--inner-bg)' }}>
                      <span className="text-2xs" style={{ color: 'var(--txt-3)' }}>{k}</span>
                      <span className="font-bold tabular-nums" style={{ color: 'var(--txt-1)' }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ إدارة الذاكرة — أفقي full page ═══ */}
        {section === 'memory' && (
          <div className="space-y-4">
            {/* بطاقات الذاكرة أفقياً */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'قاعدة البيانات', value: fmtBytes(storage?.dbSize ?? 0), color: '#10b981', icon: '🗄️' },
                { label: 'النسخ الاحتياطية', value: fmtBytes(storage?.backupsSize ?? 0), color: '#3b82f6', icon: '💾' },
                { label: 'عدد النسخ', value: String(storage?.backupsCount ?? 0), color: '#8b5cf6', icon: '📦' },
                { label: 'الحجم الإجمالي', value: fmtBytes(storage?.totalSize ?? 0), color: '#f59e0b', icon: '📊' },
              ].map(c => (
                <div key={c.label} className="rounded-2xl p-4 relative overflow-hidden" style={{ background: c.color + '12', border: `1px solid ${c.color}40` }}>
                  <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: c.color, opacity: 0.1, filter: 'blur(20px)' }} />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span style={{ fontSize: 18 }}>{c.icon}</span>
                      <span className="text-2xs font-bold" style={{ color: c.color }}>{c.label}</span>
                    </div>
                    <div className="tabular-nums font-black" style={{ fontSize: 22, color: c.color }}>{c.value}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* قسم التنظيف — أفقي */}
            <div className="card p-5" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))', border: '1px solid rgba(245,158,11,0.35)' }}>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(245,158,11,0.18)', fontSize: 28 }}>🧹</div>
                <div className="flex-1 min-w-[200px]">
                  <div className="font-bold text-base" style={{ color: 'var(--txt-1)' }}>تنظيف الذاكرة القديمة</div>
                  <div className="text-xs" style={{ color: 'var(--txt-2)' }}>يحذف النسخ الأقدم من 5 أيام فقط — لا يمس قاعدة البيانات ولا بيانات العميل</div>
                  {storage && storage.oldBackups > 0 && (
                    <div className="text-xs mt-1" style={{ color: '#f59e0b' }}>
                      📦 {storage.oldBackups} نسخة قديمة ({fmtBytes(storage.oldBackupsSize)}) جاهزة للحذف
                    </div>
                  )}
                </div>
                <button onClick={cleanMemory} disabled={cleaning || !storage || storage.oldBackups === 0}
                  className="btn-primary flex-shrink-0" style={{ fontSize: 13, padding: '10px 22px' }}>
                  {cleaning ? <><Icons.Refresh size={14} className="animate-spin" /> جاري التنظيف...</> : <><Icons.Trash size={14} /> تنظيف الآن</>}
                </button>
              </div>

              {/* شريط التحميل أثناء التنظيف (تجميد) */}
              {cleaning && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs mb-1.5" style={{ color: 'var(--txt-2)' }}>
                    <span>جاري تنظيف الذاكرة... الرجاء الانتظار</span>
                    <span className="tabular-nums font-bold" style={{ color: '#f59e0b' }}>{cleanProgress}%</span>
                  </div>
                  <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--inner-bg)' }}>
                    <div className="h-full rounded-full transition-all duration-100"
                      style={{ width: `${cleanProgress}%`, background: 'linear-gradient(90deg, #f59e0b, #d97706)' }} />
                  </div>
                </div>
              )}
            </div>

            {/* رسالة النجاح بعد التنظيف */}
            {cleanResult && !cleaning && (
              <div className="card p-6 text-center slide-up" style={{ border: '2px solid #10b981', background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(16,185,129,0.03))' }}>
                <div style={{ fontSize: 56 }}>😄</div>
                <div className="font-black text-xl mb-2" style={{ color: '#10b981' }}>تم التنظيف بنجاح!</div>
                <div className="text-sm" style={{ color: 'var(--txt-2)' }}>
                  حُذفت <b style={{ color: '#10b981' }}>{cleanResult.deleted}</b> نسخة قديمة
                  {' · '}تم تحرير <b style={{ color: '#10b981' }}>{fmtBytes(cleanResult.freedBytes)}</b> من الذاكرة
                </div>
                <div className="text-xs mt-2" style={{ color: 'var(--txt-3)' }}>بيانات العميل وقاعدة البيانات سليمة تماماً ✓</div>
                <button onClick={() => setCleanResult(null)} className="btn-success-pro mt-4" style={{ fontSize: 13, padding: '8px 24px' }}>تمام 👍</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
