import { useState, useEffect } from 'react'
import Icons from './Icon'
import { useAuth } from '../store/auth'
import { useShift } from '../store/shift'
import { useLicense } from '../store/license'
import { usePageAccess } from '../store/pageAccess'
import { api, call } from '../lib/api'
import type { Page } from '../App'

interface NavItem {
  id:    Page
  label: string
  icon:  React.ReactNode
  roles: string[]
}

// خريطة ألوان الأيقونات
const ICON_CLASS: Record<string, string> = {
  dashboard: 'aj-icon-dashboard',
  daily: 'aj-icon-daily',
  reports: 'aj-icon-reports',
  employees: 'aj-icon-employees',
  notifications: 'aj-icon-notifications',
  customers: 'aj-icon-customers',
  suppliers: 'aj-icon-suppliers',
  users: 'aj-icon-users',
  backup: 'aj-icon-backup',
  settings: 'aj-icon-settings',
  categories: 'aj-icon-categories',
  about: 'aj-icon-about',
}

const NAV: NavItem[] = [
  // v2.27.0 (14-Jun) — قائمة مسطّحة بترتيب ومسميات محدّثة
  { id: 'dashboard',     label: 'لوحة المعلومات',     icon: <Icons.Dashboard  size={17}/>, roles: ['manager','supervisor','cashier'] },
  { id: 'daily',         label: 'العمليات اليومية',   icon: <Icons.Journal    size={17}/>, roles: ['manager','supervisor','cashier'] },
  { id: 'customers',     label: 'العملاء',            icon: <Icons.Employees  size={17}/>, roles: ['manager','supervisor'] },
  { id: 'suppliers',     label: 'الموردون',           icon: <Icons.Fund       size={17}/>, roles: ['manager','supervisor'] },
  { id: 'employees',     label: 'إدارة الموظفين',     icon: <Icons.Employees  size={17}/>, roles: ['manager','supervisor'] },
  { id: 'users',         label: 'صلاحيات المستخدمين', icon: <Icons.User       size={17}/>, roles: ['manager'] },
  { id: 'reports',       label: 'التقارير',           icon: <Icons.Reports    size={17}/>, roles: ['manager','supervisor'] },
  { id: 'treasury',      label: 'حسابات الصندوق',     icon: <Icons.Fund       size={17}/>, roles: ['manager','supervisor'] },
  { id: 'importExcel',   label: 'استيراد اليومية',    icon: <Icons.Download   size={17}/>, roles: ['manager'] },
  { id: 'categories',    label: 'إدارة التصنيفات',    icon: <Icons.Plus       size={17}/>, roles: ['manager'] },
  { id: 'settings',      label: 'إعدادات النظام',     icon: <Icons.Settings   size={17}/>, roles: ['manager'] },
  { id: 'about',         label: 'حول البرنامج',       icon: <Icons.Info       size={17}/>, roles: ['manager','supervisor','cashier'] },
]

interface Props {
  current:  Page
  onChange: (p: Page) => void
}

const ChevronLeft  = () => <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
const ChevronRight = () => <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>

export default function Sidebar({ current, onChange }: Props) {
  const { user }        = useAuth()
  const { activeShift } = useShift()
  const { hasFeature }  = useLicense()
  const [collapsed,     setCollapsed]     = useState(false)
  const [unreadCount,   setUnreadCount]   = useState(0)

  useEffect(() => {
    const tick = () => call(api.notif.unreadCount()).then(n => setUnreadCount(n as number)).catch(() => {})
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  const featureOf: Partial<Record<Page, 'reports' | 'crm'>> = {
    reports: 'reports', customers: 'crm', suppliers: 'crm',
  }

  const { isHidden } = usePageAccess()

  const items  = NAV.filter(n => {
    if (!user) return false
    // v2.27.0 (14-Jun) — إخفاء الأقسام حسب صلاحيات المستخدم (يحددها المدير)
    if (isHidden(n.id)) return false
    const feat = featureOf[n.id]
    if (feat && !hasFeature(feat)) return false
    if (user.role === 'manager' || user.role === 'branch_manager') return true
    const r = user.role === 'accountant' ? 'supervisor' : user.role
    return n.roles.includes(r)
  })

  const roleLabel: Record<string, string> = {
    manager: 'مدير', supervisor: 'مشرف', cashier: 'كاشير',
    branch_manager: 'مدير فرع', accountant: 'محاسب',
  }

  return (
    <div
      className="aj-sidebar relative flex flex-col flex-shrink-0 overflow-hidden sidebar-transition"
      style={{ width: collapsed ? 64 : 230 }}>

      {/* ═══ زر الطي ═══ */}
      <button onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'توسيع' : 'طي'}
        className="absolute top-2.5 left-2.5 w-6 h-6 flex items-center justify-center
          rounded-md transition-all duration-200 z-10"
        style={{
          background: 'var(--sidebar-hover)',
          color: 'var(--sidebar-text)',
          border: '1px solid var(--sidebar-border)',
        }}>
        {collapsed ? <ChevronLeft /> : <ChevronRight />}
      </button>

      <div className="h-9 flex-shrink-0" />

      {/* ═══ شيفت نشط ═══ */}
      {activeShift && !collapsed && (
        <div className="mx-2.5 mb-3 rounded-xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.08))',
            border: '1px solid rgba(34,197,94,0.40)',
            boxShadow: '0 2px 10px rgba(34,197,94,0.15)',
          }}>
          <div className="px-3 py-2">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
                  style={{ background: '#22c55e' }} />
                <span className="relative inline-flex rounded-full w-2 h-2"
                  style={{ background: '#22c55e' }} />
              </span>
              <span className="font-bold uppercase tracking-wider"
                style={{ fontSize: 9.5, color: '#22c55e' }}>
                شيفت نشط
              </span>
            </div>
            <div className="font-bold tabular-nums" style={{ fontSize: 15, color: 'var(--sidebar-text-active)' }}>
              #{activeShift.monthlyShiftNum}
            </div>
            <div className="truncate" style={{ fontSize: 10.5, color: 'var(--sidebar-text)' }}>
              {activeShift.cashierName}
            </div>
          </div>
        </div>
      )}
      {activeShift && collapsed && (
        <div className="flex justify-center mb-3">
          <span className="relative flex w-2.5 h-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
              style={{ background: '#22c55e' }} />
            <span className="relative inline-flex rounded-full w-2.5 h-2.5"
              style={{ background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
          </span>
        </div>
      )}

      {/* ═══ القائمة المسطّحة (v2.27.0 14-Jun) ═══ */}
      <div className="flex-1 overflow-y-auto px-0 py-1">
        <div className={collapsed ? 'flex flex-col gap-1' : 'flex flex-col gap-1'}>
          {items.map(item => {
            const active    = current === item.id
            const isNotif   = item.id === 'notifications'
            const badge     = isNotif && unreadCount > 0 ? unreadCount : 0
            const iconClass = ICON_CLASS[item.id] ?? ''
            return (
              <button key={item.id}
                onClick={() => onChange(item.id)}
                title={collapsed ? item.label : undefined}
                className={`aj-nav-item flex items-center gap-2.5 py-2 mx-2 rounded-xl relative
                  ${active ? 'aj-nav-item-active t-nav-active' : 't-nav'}
                  ${collapsed ? 'justify-center px-1.5' : 'px-2.5 text-right'}`}
                style={collapsed ? {} : { paddingInlineStart: 10, paddingInlineEnd: 10 }}>

                {/* شريط جانبي عند النشط */}
                {active && !collapsed && (
                  <span className="aj-active-stripe absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-l-full" />
                )}

                {/* الأيقونة + badge */}
                <span className={`${iconClass} flex-shrink-0 relative transition-transform duration-200
                  ${active ? 'scale-110' : ''}`}>
                  {item.icon}
                  {badge > 0 && collapsed && (
                    <span className="absolute -top-1.5 -left-1.5 min-w-[16px] h-4 rounded-full
                      text-white flex items-center justify-center font-bold leading-none"
                      style={{
                        background: '#ef4444', fontSize: 9, padding: '0 4px',
                        boxShadow: '0 2px 6px rgba(239,68,68,0.5)',
                      }}>
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </span>
                {!collapsed && (
                  <span className="truncate flex-1"
                    style={{ fontSize: 14.5, fontWeight: active ? 700 : 600 }}>
                    {item.label}
                  </span>
                )}
                {/* badge في الجانب المفتوح */}
                {!collapsed && badge > 0 && (
                  <span className="text-2xs rounded-full font-bold leading-none flex items-center justify-center"
                    style={{
                      background: '#ef4444', color: 'white',
                      minWidth: 18, height: 18, padding: '0 5px',
                      fontSize: 10,
                      boxShadow: '0 2px 6px rgba(239,68,68,0.45)',
                    }}>
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ═══ معلومات المستخدم (الأسفل) ═══ */}
      {user && !collapsed && (
        <div className="mx-2.5 mb-2.5 mt-2 rounded-xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(30,58,138,0.04))',
            border: '1px solid var(--sidebar-border)',
          }}>
          <div className="px-3 py-2 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold flex-shrink-0"
              style={{
                background: user.color,
                fontSize: 13,
                boxShadow: `0 2px 8px ${user.color}55`,
              }}>
              {user.displayName[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold" style={{
                fontSize: 12, color: 'var(--sidebar-text-active)',
              }}>
                {user.displayName}
              </div>
              <div className="uppercase tracking-wide" style={{
                fontSize: 9.5, fontWeight: 700, color: 'var(--sidebar-group)',
              }}>
                {roleLabel[user.role] ?? user.role}
              </div>
            </div>
          </div>
        </div>
      )}
      {user && collapsed && (
        <div className="flex justify-center mb-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold"
            style={{
              background: user.color, fontSize: 13,
              boxShadow: `0 2px 8px ${user.color}55`,
            }}>
            {user.displayName[0]}
          </div>
        </div>
      )}
    </div>
  )
}
