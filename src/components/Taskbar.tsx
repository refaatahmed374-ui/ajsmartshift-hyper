/**
 * Taskbar — شريط مهام داخلي احترافي (يستبدل StatusBar)
 * اختصارات صفحات · إجراءات شيفت · مؤشرات حية · تنبيهات/اشتراك/نسخ · ساعة/مستخدم
 * + تكامل شريط مهام ويندوز (وميض عند تنبيه جديد)
 */
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../store/auth'
import { useShift } from '../store/shift'
import { useLicense } from '../store/license'
import { api, call } from '../lib/api'
import { fmt } from '../lib/format'
import Icons from './Icon'
import { APP_VERSION } from '../version'

const DAY = 86400000

export default function Taskbar({ current, onNavigate }: { current: string; onNavigate: (p: string) => void }) {
  const { user } = useAuth()
  const { activeShift, transactions } = useShift()
  const { status: license } = useLicense()
  const [time, setTime] = useState(new Date().toLocaleTimeString('ar-EG'))
  const [unread, setUnread] = useState(0)
  const [backups, setBackups] = useState<number | null>(null)
  const prevUnread = useRef(0)

  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString('ar-EG')), 1000)
    return () => clearInterval(id)
  }, [])

  // تحديث التنبيهات + النسخ كل 30 ثانية
  useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const n = await call(api.notif.unreadCount()) as number
        if (alive) {
          setUnread(n)
          if (n > prevUnread.current) { try { window.api.taskbar.flash() } catch { /* */ } }
          prevUnread.current = n
        }
      } catch { /* */ }
      try { const s = await call(api.system.storageInfo()) as { backupsCount: number }; if (alive) setBackups(s.backupsCount) } catch { /* */ }
    }
    poll()
    const id = setInterval(poll, 30000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // مؤشرات حية
  const txCount = transactions.length
  const totalIn  = transactions.reduce((s, t) => s + t.amountIn, 0)
  const totalOut = transactions.reduce((s, t) => s + t.amountOut, 0)
  const net = totalIn - totalOut

  // أيام الاشتراك المتبقية
  let subDays: number | null = null, subColor = '#2ea043'
  if (license?.mode === 'subscription' && license.subExpireDate) {
    subDays = Math.max(0, Math.ceil((new Date(license.subExpireDate).getTime() - Date.now()) / DAY))
  } else if (license?.state === 'trial') {
    subDays = license.daysLeft
  }

  if (subDays !== null) {
    if (subDays <= 0) subColor = '#f85149'
    else if (subDays <= 7) subColor = '#f59e0b'
  }

  // اختصارات الصفحات
  const SHORTCUTS: { id: string; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'اللوحة',   icon: <Icons.Dashboard size={15} /> },
    { id: 'daily',     label: 'اليومية',  icon: <Icons.Journal   size={15} /> },
    { id: 'fawry',     label: 'فوري',     icon: <Icons.Fund      size={15} /> },
    { id: 'reports',   label: 'التقارير', icon: <Icons.Reports   size={15} /> },
    { id: 'employees', label: 'الموظفون', icon: <Icons.Employees size={15} /> },
  ]

  const sep = <span style={{ opacity: .35, color: 'var(--statusbar-text)' }}>|</span>
  const chip = (color: string) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 8, background: color + '1a', border: `1px solid ${color}33`, color, fontWeight: 700, fontSize: 11.5 } as const)

  return (
    <div className="aj-statusbar flex items-center gap-2 px-3 flex-shrink-0 select-none overflow-x-auto"
      style={{ height: 44, fontSize: 12, fontWeight: 500, borderTop: '1px solid var(--statusbar-border)' }}>

      {/* اختصارات الصفحات */}
      <div className="flex items-center gap-1">
        {SHORTCUTS.map(s => (
          <button key={s.id} onClick={() => onNavigate(s.id)} title={s.label}
            className="flex items-center gap-1.5 rounded-lg transition-all"
            style={{
              padding: '5px 10px', fontSize: 12, fontWeight: current === s.id ? 800 : 600,
              color: current === s.id ? 'var(--accent)' : 'var(--statusbar-text)',
              background: current === s.id ? 'rgba(59,130,246,0.14)' : 'transparent',
            }}>
            {s.icon}<span className="hidden md:inline">{s.label}</span>
          </button>
        ))}
      </div>

      {sep}

      {/* إجراءات الشيفت */}
      <div className="flex items-center gap-1.5">
        <button onClick={() => onNavigate('daily')} className="aj-tb-action" title="بند سريع"
          style={chip('#3b82f6')}><Icons.Plus size={13} />بند سريع</button>
        <button onClick={() => onNavigate('daily')} className="aj-tb-action" title="إغلاق الشيفت"
          style={chip('#f59e0b')}><Icons.Lock size={13} />إغلاق الشيفت</button>
        <button onClick={() => onNavigate('reports')} className="aj-tb-action" title="تقرير اليوم"
          style={chip('#8b5cf6')}><Icons.Reports size={13} />تقرير اليوم</button>
      </div>

      {sep}

      {/* مؤشرات حية */}
      {activeShift ? (
        <div className="flex items-center gap-2">
          <span style={chip('#06b6d4')}><Icons.Journal size={12} />{txCount} بند</span>
          <span style={chip(net >= 0 ? '#2ea043' : '#f85149')}>
            صافي البنود: {fmt(Math.abs(net))} {net >= 0 ? '▲' : '▼'}
          </span>
        </div>
      ) : (
        <span style={chip('#6e7681')}>لا يوجد شيفت مفتوح</span>
      )}

      <div className="flex-1 min-w-[8px]" />

      {/* التنبيهات */}
      <button onClick={() => { onNavigate('settings'); try { window.api.taskbar.stopFlash() } catch { /* */ } }}
        title="التنبيهات" className="relative flex items-center" style={{ padding: '4px 6px', color: 'var(--statusbar-text)' }}>
        <Icons.Bell size={16} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -2, insetInlineStart: -2, minWidth: 15, height: 15, padding: '0 3px',
            background: '#ef4444', color: '#fff', borderRadius: 999, fontSize: 9, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(239,68,68,.6)' }}>{unread}</span>
        )}
      </button>

      {/* الاشتراك */}
      {subDays !== null && (
        <span style={chip(subColor)} title="أيام الاشتراك المتبقية"><Icons.Lock size={12} />{subDays} يوم</span>
      )}

      {/* النسخ الاحتياطية */}
      {backups !== null && (
        <span className="hidden lg:inline-flex items-center gap-1" style={{ color: 'var(--statusbar-text)', fontSize: 11, opacity: 0.8 }} title="عدد النسخ الاحتياطية">
          <Icons.Backup size={12} />{backups}
        </span>
      )}

      {sep}

      {/* المستخدم */}
      {user && (
        <span className="flex items-center gap-1" style={{ color: 'var(--statusbar-text)' }}>
          <Icons.User size={12} />{user.displayName}
        </span>
      )}

      {sep}

      {/* الساعة */}
      <span className="flex items-center gap-1 tabular-nums" style={{ color: 'var(--statusbar-text)' }}>
        <Icons.Clock size={12} />{time}
      </span>

      {sep}
      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>v{APP_VERSION}</span>
    </div>
  )
}
