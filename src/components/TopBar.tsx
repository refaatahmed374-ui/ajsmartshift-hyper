import { useAuth } from '../store/auth'
import { useTheme } from '../store/theme'
import Icons from './Icon'
import { fmt, todayISO, fmtDate } from '../lib/format'
import { useShift } from '../store/shift'
import { APP_VERSION } from '../version'
import { useEffect, useState } from 'react'

interface Props { page: string }

// أيقونة الشمس
const SunIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)

// أيقونة القمر
const MoonIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)

export default function TopBar({ page: _page }: Props) {
  const { user, logout } = useAuth()
  const { activeShift } = useShift()
  const { theme, toggle } = useTheme()
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5))

  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toTimeString().slice(0, 5)), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="aj-topbar h-12 flex items-center
      px-4 gap-4 titlebar-drag flex-shrink-0">

      {/* شعار */}
      <div className="flex items-center gap-2 titlebar-no-drag">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center
          text-white font-black text-xs"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #1e3a8a)',
                   boxShadow: '0 2px 8px rgba(59,130,246,0.4)' }}>AJ</div>
        <span className="aj-topbar-text text-xs font-bold hidden sm:block">Smart Shift</span>
        <span className="text-2xs px-1.5 py-0.5 rounded-full hidden md:block font-semibold"
          style={{ background: 'rgba(96,165,250,0.18)', color: '#60a5fa' }}>v{APP_VERSION}</span>
      </div>

      <div className="flex-1" />

      {/* معلومات الشيفت */}
      {activeShift && (
        <div className="titlebar-no-drag flex items-center gap-3 text-xs">
          <span className="aj-topbar-muted">شيفت</span>
          <span className="aj-topbar-text font-bold">#{activeShift.monthlyShiftNum}</span>
          <span className="aj-topbar-muted">{fmtDate(activeShift.date)}</span>
          <span className="font-bold" style={{ color: '#22c55e' }}>
            رصيد: {fmt(activeShift.openingBalance)} ج
          </span>
          <span className="badge-open">{activeShift.cashierName}</span>
        </div>
      )}

      {/* الوقت */}
      <div className="titlebar-no-drag aj-topbar-muted flex items-center gap-1 text-xs">
        <Icons.Clock size={12} />
        <span className="tabular-nums">{time}</span>
        <span className="mx-1 opacity-50">|</span>
        <span>{fmtDate(todayISO())}</span>
      </div>

      {/* زر تبديل الثيم */}
      <button
        onClick={toggle}
        title={theme === 'dark' ? 'تحويل للوضع الفاتح' : 'تحويل للوضع الداكن'}
        className="titlebar-no-drag aj-topbar-muted hover:text-white w-7 h-7 flex items-center justify-center rounded-lg
          hover:bg-white/10 transition-colors">
        {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
      </button>

      {/* المستخدم */}
      {user && (
        <div className="titlebar-no-drag flex items-center gap-2">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-2xs font-bold"
            style={{ background: user.color }}>
            {user.displayName[0]}
          </div>
          <span className="aj-topbar-muted text-xs hidden md:block">{user.displayName}</span>
          <button onClick={logout}
            className="aj-topbar-muted hover:text-danger transition-colors p-1"
            title="خروج">
            <Icons.LogOut size={14} />
          </button>
        </div>
      )}

      {/* أزرار النافذة */}
      <div className="titlebar-no-drag flex items-center gap-1 mr-2">
        <button onClick={() => window.api.window.minimize()}
          className="aj-topbar-muted hover:text-white w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-colors">
          <Icons.Minimize size={12} />
        </button>
        <button onClick={() => window.api.window.maximize()}
          className="aj-topbar-muted hover:text-white w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-colors">
          <Icons.Maximize size={12} />
        </button>
        <button onClick={() => window.api.window.close()}
          className="aj-topbar-muted hover:text-white w-6 h-6 flex items-center justify-center rounded hover:bg-danger transition-colors">
          <Icons.Close size={12} />
        </button>
      </div>
    </div>
  )
}
