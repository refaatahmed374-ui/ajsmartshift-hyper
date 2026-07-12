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
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import ToastContainer from './components/Toast'
import Taskbar from './components/Taskbar'
import UpdateManager from './components/UpdateManager'

type Page =
  | 'dashboard' | 'daily'    | 'reports'  | 'employees'
  | 'settings'  | 'users'    | 'treasury'
  | 'fawry'     | 'categories' | 'about'
  | 'customers' | 'suppliers' | 'importExcel'

export default function App() {
  const { user }                          = useAuth()
  const { loadActiveShift, loadCategories } = useShift()
  const { load: loadLicense, readOnly }   = useLicense()
  const { load: loadPageAccess }          = usePageAccess()
  useTheme()
  const [page, setPage] = useState<Page>('dashboard')

  useEffect(() => { loadLicense() }, [])

  // ADR-012 v2 — تنقّل من مكوّنات عميقة (زر «إغلاق الصفحة» في الورقة الموحّدة)
  useEffect(() => {
    const h = (e: Event) => setPage((e as CustomEvent).detail as Page)
    window.addEventListener('app:navigate', h)
    return () => window.removeEventListener('app:navigate', h)
  }, [])

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
    dashboard:     <Dashboard onNavigate={setPage as (p: string) => void} />,
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
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar page={page} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar current={page} onChange={setPage} />
        <main className="flex-1 flex flex-col overflow-hidden bg-surface-900">
          {pages[page]}
        </main>
      </div>
      <ToastContainer />
      <Taskbar current={page} onNavigate={(p) => setPage(p as Page)} />
      <UpdateManager />
    </div>
  )
}
