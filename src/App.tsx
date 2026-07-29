import { useState, useEffect } from 'react'
import { useAuth } from './store/auth'
import { useShift } from './store/shift'
import { useTheme } from './store/theme'
import { useLicense } from './store/license'
import { usePageAccess } from './store/pageAccess'
import LicenseGate from './components/LicenseGate'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Daily from './pages/Daily'
import Reports from './pages/Reports'
import ImportExcel from './pages/ImportExcel'
import Employees from './pages/Employees'
import Settings from './pages/Settings'
import Users from './pages/Users'
import Treasury from './pages/Treasury'
import FawrySystem from './pages/FawrySystem'
import Categories from './pages/Categories'
import Parties from './pages/Parties'
import About from './pages/About'
import DraftAccounts from './pages/DraftAccounts'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import PageTabsBar from './components/PageTabsBar'
import ToastContainer from './components/Toast'
import FloatingWindowsHost from './components/FloatingWindowsHost'
import Taskbar from './components/Taskbar'
import UpdateManager from './components/UpdateManager'

export type Page =
  | 'dashboard' | 'daily'    | 'reports'  | 'employees'
  | 'settings'  | 'users'    | 'treasury'
  | 'fawry'     | 'categories' | 'about'
  | 'customers' | 'suppliers' | 'importExcel'
  | 'draftAccounts'

// v2.33.0 — تبويبات على مستوى كل الصفحات: أسماء العرض لكل صفحة (تُستخدم في شريط التبويبات)
const PAGE_LABELS: Record<Page, string> = {
  dashboard: 'لوحة المعلومات', daily: 'العمليات اليومية', reports: 'التقارير', employees: 'إدارة الموظفين',
  settings: 'إعدادات النظام', users: 'صلاحيات المستخدمين', treasury: 'حسابات الصندوق', fawry: 'ماكينة فوري',
  categories: 'إدارة التصنيفات', about: 'حول البرنامج', customers: 'العملاء', suppliers: 'الموردون',
  importExcel: 'استيراد اليومية', draftAccounts: 'مسودة حسابات',
}

export default function App() {
  const { user }                          = useAuth()
  const { loadActiveShift, loadCategories } = useShift()
  const { load: loadLicense, readOnly }   = useLicense()
  const { load: loadPageAccess }          = usePageAccess()
  useTheme()
  // v2.33.0 — تبويبات على مستوى كل الصفحات: أكتر من صفحة مفتوحة في نفس الوقت (زي المتصفح)،
  // كل صفحة مفتوحة تبقى مركّبة دائمًا (لا تُفكّ) حتى لو غير نشطة — تحافظ على أي حالة فورم غير محفوظة
  // (مثل بنود يومية في ShiftSheet) عند التنقّل بين التبويبات والعودة.
  const [openTabs, setOpenTabs] = useState<{ page: Page; label: string }[]>([{ page: 'dashboard', label: PAGE_LABELS.dashboard }])
  const [page, setPage] = useState<Page>('dashboard')

  function openPageTab(p: Page) {
    setOpenTabs(prev => prev.some(t => t.page === p) ? prev : [...prev, { page: p, label: PAGE_LABELS[p] }])
    setPage(p)
  }
  function closePageTab(p: Page) {
    setOpenTabs(prev => {
      const next = prev.filter(t => t.page !== p)
      if (!next.length) return prev // امنع إغلاق آخر تبويب مفتوح
      setPage(cur => cur === p ? next[next.length - 1].page : cur)
      return next
    })
  }

  useEffect(() => { loadLicense() }, [])

  // ADR-012 v2 — تنقّل من مكوّنات عميقة (زر «إغلاق الصفحة» في الورقة الموحّدة)
  useEffect(() => {
    const hNav = (e: Event) => openPageTab((e as CustomEvent).detail as Page)
    // زر «إغلاق الصفحة» في الورقة الموحّدة يغلق التبويب الحالي فعلياً (كزر ✕ في شريط التبويبات) بدل مجرد التنقّل للوحة المعلومات
    const hClose = () => closePageTab(page)
    window.addEventListener('app:navigate', hNav)
    window.addEventListener('app:closeCurrentTab', hClose)
    return () => {
      window.removeEventListener('app:navigate', hNav)
      window.removeEventListener('app:closeCurrentTab', hClose)
    }
  }, [page])

  useEffect(() => {
    if (user) { loadActiveShift(); loadCategories(); loadPageAccess(user.id) }
  }, [user])

  // تجميد كامل: عند انتهاء التجربة/الاشتراك لا يظهر سوى شاشة التفعيل
  if (readOnly()) return (
    <>
      <LicenseGate />
      <UpdateManager />
      <ToastContainer />
    </>
  )

  if (!user) return (
    <>
      <Login />
      <UpdateManager />
      <ToastContainer />
    </>
  )

  const pages: Record<Page, React.ReactNode> = {
    dashboard:     <Dashboard />,
    daily:         <Daily />,
    reports:       <Reports />,
    employees:     <Employees />,
    settings:      <Settings />,
    users:         <Users />,
    treasury:      <Treasury />,
    fawry:         <FawrySystem />,
    categories:    <Categories />,
    about:         <About />,
    customers:     <Parties type="customer" />,
    suppliers:     <Parties type="supplier" />,
    importExcel:   <ImportExcel />,
    draftAccounts: <DraftAccounts />,
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar page={page} />
      <PageTabsBar tabs={openTabs} active={page} onSelect={setPage} onClose={closePageTab} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar current={page} onChange={openPageTab} />
        <main className="flex-1 flex flex-col overflow-hidden bg-surface-900 relative">
          {/* كل تبويب مفتوح يبقى مركّبًا دائمًا (إخفاء بصري فقط بـ display:none) — يحافظ على حالته الداخلية */}
          {openTabs.map(t => (
            <div key={t.page} className="flex-1 flex flex-col overflow-hidden min-h-0"
              style={{ display: page === t.page ? 'flex' : 'none' }}>
              {pages[t.page]}
            </div>
          ))}
        </main>
      </div>
      <ToastContainer />
      <FloatingWindowsHost />
      <Taskbar current={page} onNavigate={(p) => openPageTab(p as Page)} />
      <UpdateManager />
    </div>
  )
}
