import { useState, useEffect, useMemo, useRef } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import { useAuth } from '../store/auth'
import Icons from '../components/Icon'
import KPICard from '../components/KPICard'
import { MiniCombo } from '../components/MiniChart'
import ShiftSheet from '../components/ShiftSheet'
import { fmt, fmtDate, shiftTypeLabel, parsePias } from '../lib/format'
import { calcShiftClosing, calcFawry } from '../../core/engine'
import { APP_VERSION } from '../version'
import type { Shift, Transaction, EmployeeFinancials, ShiftFawry, MainCategory, SubCategory } from '../../core/types'

type Tab = 'journal' | 'monthly_close' | 'annual_close' | 'sales' | 'purchases' | 'expenses' | 'costs' | 'equity' | 'employees' | 'financial'

const TABS: { id: Tab; label: string; icon: React.ReactNode; color: string; match: RegExp }[] = [
  { id: 'journal',       label: 'سجل اليوميات',           icon: <Icons.Journal size={15} />,     color: '#3b82f6', match: /.*/ },
  { id: 'monthly_close', label: 'تقارير التقفيل الشهري',  icon: <Icons.Lock size={15} />,        color: '#8b5cf6', match: /.*/ },
  { id: 'annual_close',  label: 'تقارير التقفيل السنوي',  icon: <Icons.Lock size={15} />,        color: '#ec4899', match: /.*/ },
  { id: 'sales',         label: 'تقارير المبيعات',        icon: <Icons.ArrowRight size={15} />,  color: '#2ea043', match: /مبيع|إيراد|تحصيل|فيزا/ },
  { id: 'purchases',     label: 'تقارير المشتريات',       icon: <Icons.Records size={15} />,     color: '#388bfd', match: /مشتر/ },
  { id: 'expenses',      label: 'تقارير المصروفات',       icon: <Icons.Fund size={15} />,        color: '#f85149', match: /مصروف|جزاء|أجور|كهرب|إيجار/ },
  // v2.33.0 — تبويبان جديدان بعد إضافة تصنيفي "التكاليف"/"حقوق الملكية" الرئيسيين
  { id: 'costs',         label: 'تقارير التكاليف',        icon: <Icons.Records size={15} />,     color: '#0ea5e9', match: /تكاليف/ },
  { id: 'equity',        label: 'تقارير حقوق الملكية',    icon: <Icons.Fund size={15} />,        color: '#64748b', match: /حقوق الملكية/ },
  { id: 'financial',     label: 'التقارير المالية',       icon: <Icons.Reports size={15} />,     color: '#8957e5', match: /.*/ },
  { id: 'employees',     label: 'تقارير الموظفين',        icon: <Icons.Employees size={15} />,   color: '#d4a017', match: /.*/ },
]

interface FinancialData {
  revenues: number; purchases: number; expenses: number; netProfit: number
  cashIn: number; cashOut: number; receivables: number
}

// v2.34.0 — تنسيق جدول مكثّف شبيه بشيت الإكسيل (خطوط شبكة على كل خلية + صفوف متناوبة) — لتقريري المبيعات/المشتريات وبقية التبويبات المشتركة
const xlsTh: React.CSSProperties = { border: '1px solid var(--inner-border)', padding: '5px 10px' }
const xlsTd: React.CSSProperties = { border: '1px solid var(--inner-border)', padding: '4px 10px' }
// صف مضغوط (بيان/قيمة) — لجداول صغيرة الحجم مثل "مؤشرات الربحية"
const compactTd: React.CSSProperties = { padding: '3px 8px', fontSize: 11, border: '1px solid var(--inner-border)' }
const compactTh: React.CSSProperties = { padding: '4px 8px', fontSize: 10.5, border: '1px solid var(--inner-border)' }
function xlsRow(i: number): React.CSSProperties {
  return { background: i % 2 ? 'var(--inner-bg)' : 'transparent' }
}

// تجميع التقارير الفرعية للقائمة المنسدلة
const GROUPS: { title: string; ids: Tab[] }[] = [
  { title: 'أساسية',      ids: ['journal'] },
  { title: 'تقفيل دوري',  ids: ['monthly_close', 'annual_close'] },
  { title: 'تحليلية',     ids: ['sales', 'purchases', 'expenses', 'costs', 'equity', 'financial', 'employees'] },
]

export default function Reports() {
  const { show } = useToast()
  const [tab,    setTab]    = useState<Tab>('journal')
  // v2.33.0 — تبويبات مفتوحة في نفس الوقت (زي المتصفح) — tab هو التبويب النشط المعروض حالياً
  const [openTabs, setOpenTabs] = useState<Tab[]>(['journal'])
  function openReport(id: Tab) {
    setOpenTabs(prev => prev.includes(id) ? prev : [...prev, id])
    setTab(id)
  }
  function closeReport(id: Tab) {
    setOpenTabs(prev => {
      const next = prev.filter(x => x !== id)
      if (!next.length) return prev // لا تُغلق آخر تبويب مفتوح
      if (tab === id) setTab(next[next.length - 1])
      return next
    })
  }
  const [pickerOpen, setPickerOpen] = useState(false)
  const [month,  setMonth]  = useState(() => new Date().toISOString().slice(0, 7))
  // v2.33.0 — فلتر فترة إضافي: شهر كامل (افتراضي) أو يوم محدد داخل نفس الشهر
  const [periodMode, setPeriodMode] = useState<'month' | 'day'>('month')
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10))
  const [shifts, setShifts] = useState<Shift[]>([])
  const [allTxs, setAllTxs] = useState<Transaction[]>([])
  const [empFin, setEmpFin] = useState<EmployeeFinancials[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [bizName, setBizName] = useState('')
  const [finData, setFinData] = useState<FinancialData | null>(null)
  // v2.33.0 — فلتر تصنيف فرعي خاص بكل قسم (مبيعات/مشتريات/مصروفات) + بحث اسم الموظف
  const [subFilter, setSubFilter] = useState('')
  const [empSearch, setEmpSearch] = useState('')

  const printRef = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    try {
      const shiftList = await call(api.shifts.getAll({ month })) as Shift[]
      setShifts(shiftList)
      // v2.31.3 — تحسين الأداء: جلب كل البنود باستعلام واحد بدلاً من N+1
      const shiftIds = shiftList.map(s => s.id)
      const allTransactions = await call(api.tx.getByShiftIds(shiftIds)) as Transaction[]
      setAllTxs(allTransactions)
      setEmpFin(await call(api.emp.financials(month)) as EmployeeFinancials[])
      setBizName((await call(api.settings.get('biz.name')) as string) || '')
      setFinData(await call(api.stats.financials(month)) as FinancialData)
    } catch (e) { show((e as Error).message, 'error') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [month])

  const cfg = TABS.find(t => t.id === tab)!

  // إعادة ضبط فلتر التصنيف الفرعي عند تغيير التبويب (كل قسم له تصنيفاته الخاصة)
  useEffect(() => { setSubFilter('') }, [tab])

  // شيفتات الفترة الفعلية المعروضة (الشهر كاملاً، أو يوم واحد محدد داخله)
  const periodShifts = useMemo(
    () => periodMode === 'day' ? shifts.filter(s => s.date === day) : shifts,
    [shifts, periodMode, day]
  )

  // بنود التبويب الحالي (للتبويبات الثلاثة: مبيعات/مشتريات/مصروفات) — مقيّدة بالفترة + فلتر التصنيف الفرعي
  const txRows = useMemo(() => {
    if (tab === 'employees') return []
    const shiftMap = new Map(periodShifts.map(s => [s.id, s]))
    return allTxs
      .filter(t => shiftMap.has(t.shiftId))
      .filter(t => cfg.match.test(t.mainCategoryName || ''))
      .filter(t => !subFilter || t.subCategoryName === subFilter)
      .map(t => ({ ...t, shift: shiftMap.get(t.shiftId) }))
  }, [allTxs, periodShifts, tab, cfg, subFilter])

  // التصنيفات الفرعية المتاحة لهذا القسم (بمعزل عن فلتر التصنيف نفسه، حتى تظهر كل الخيارات دائماً)
  const subOptions = useMemo(() => {
    const shiftMap = new Map(periodShifts.map(s => [s.id, s]))
    const matched = allTxs.filter(t => shiftMap.has(t.shiftId) && cfg.match.test(t.mainCategoryName || ''))
    return Array.from(new Set(matched.map(t => t.subCategoryName).filter(Boolean))).sort()
  }, [allTxs, periodShifts, cfg])

  // KPIs للتبويبات الثلاثة
  const kpis = useMemo(() => {
    const total = txRows.reduce((s, t) => s + t.amountIn + t.amountOut, 0)
    const count = txRows.length
    const avg   = count > 0 ? Math.round(total / count) : 0
    const max   = txRows.reduce((m, t) => Math.max(m, t.amountIn + t.amountOut), 0)
    return { total, count, avg, max }
  }, [txRows])

  // تجميع بنود التبويب حسب التصنيف الفرعي — لعرض جدول تجميعي بدل القائمة المسطّحة فقط
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>()
    for (const t of txRows) {
      const key = t.subCategoryName || 'بدون تصنيف فرعي'
      const cur = map.get(key) ?? { count: 0, total: 0 }
      cur.count++; cur.total += t.amountIn + t.amountOut
      map.set(key, cur)
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total)
  }, [txRows])

  // فلترة قائمة الموظفين بالاسم
  const filteredEmpFin = useMemo(
    () => empFin.filter(f => f.name.toLowerCase().includes(empSearch.trim().toLowerCase())),
    [empFin, empSearch]
  )

  // ===== تصدير PDF عبر html2canvas (عربية مثالية) =====
  async function exportPDF() {
    if (!printRef.current) return
    setExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const { default: jsPDF } = await import('jspdf')
      const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = 210, pageH = 297, margin = 8
      const imgW = pageW - margin * 2
      const imgH = (canvas.height * imgW) / canvas.width
      let heightLeft = imgH
      let position = margin
      const img = canvas.toDataURL('image/png')
      pdf.addImage(img, 'PNG', margin, position, imgW, imgH)
      heightLeft -= (pageH - margin * 2)
      while (heightLeft > 0) {
        position = margin - (imgH - heightLeft)
        pdf.addPage()
        pdf.addImage(img, 'PNG', margin, position, imgW, imgH)
        heightLeft -= (pageH - margin * 2)
      }
      pdf.save(`AJ-${tab}-${month}.pdf`)
      show('تم تصدير PDF', 'success')
    } catch (e) { show((e as Error).message, 'error') }
    finally { setExporting(false) }
  }

  const payLabel: Record<string, string> = { cashier: 'كاشير', management: 'الصندوق', credit: 'آجل', visa: 'فيزا' }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* رأس التقارير — تبويبات مفتوحة (زي المتصفح) + زر فتح تقرير جديد */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-600 flex-shrink-0 bg-surface-800 flex-wrap">
        <span className="text-2xs font-bold hidden md:block" style={{ color: 'var(--txt-3)', letterSpacing: 1 }}>التقرير:</span>

        {/* شرائح التبويبات المفتوحة حالياً */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {openTabs.map(id => {
            const t = TABS.find(x => x.id === id)!
            const active = tab === id
            return (
              <div key={id} onClick={() => setTab(id)} role="button"
                className="flex items-center gap-1.5 pr-1.5 pl-2 py-1.5 rounded-lg cursor-pointer transition-all"
                style={{ background: active ? t.color + '20' : 'var(--inner-bg)', border: `1px solid ${active ? t.color + '55' : 'var(--inner-border)'}` }}>
                <span style={{ color: t.color, display: 'flex' }}>{t.icon}</span>
                <span className="text-xs" style={{ color: active ? 'var(--txt-1)' : 'var(--txt-2)', fontWeight: active ? 700 : 500 }}>{t.label}</span>
                {openTabs.length > 1 && (
                  <button onClick={e => { e.stopPropagation(); closeReport(id) }}
                    className="rounded-full w-4 h-4 flex items-center justify-center text-2xs hover:bg-white/10"
                    style={{ color: 'var(--txt-3)' }} title="إغلاق">
                    ✕
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* زر فتح تقرير جديد */}
        <div className="relative">
          <button onClick={() => setPickerOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all"
            style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)', color: 'var(--txt-2)' }}>
            <Icons.Plus size={13} /> فتح تقرير
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
              <div className="absolute z-50 mt-2 right-0 rounded-xl overflow-hidden shadow-2xl"
                style={{ background: 'var(--app-bg-solid)', border: '1px solid var(--inner-border)', width: 290, maxHeight: 440, overflowY: 'auto' }}>
                {GROUPS.map(g => (
                  <div key={g.title}>
                    <div className="px-4 pt-2.5 pb-1 text-2xs font-bold sticky top-0"
                      style={{ color: 'var(--txt-3)', letterSpacing: 1, background: 'var(--app-bg-solid)' }}>{g.title}</div>
                    {g.ids.map(id => {
                      const t = TABS.find(x => x.id === id)!
                      const isOpen = openTabs.includes(id)
                      return (
                        <button key={id} onClick={() => { openReport(id); setPickerOpen(false) }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-right hover:bg-white/5"
                          style={{ background: isOpen ? t.color + '18' : 'transparent', borderRight: isOpen ? `3px solid ${t.color}` : '3px solid transparent' }}>
                          <span style={{ color: t.color, display: 'flex' }}>{t.icon}</span>
                          <span className="text-sm flex-1" style={{ color: 'var(--txt-1)', fontWeight: isOpen ? 700 : 500 }}>{t.label}</span>
                          {isOpen && <Icons.Check size={14} style={{ color: t.color }} />}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex-1" />
        {/* v2.33.0 — فلتر الفترة: شهر كامل أو يوم محدد */}
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
          <button onClick={() => setPeriodMode('month')} className="px-2.5 py-1 rounded-md text-2xs font-bold transition-colors"
            style={{ background: periodMode === 'month' ? 'var(--accent)' : 'transparent', color: periodMode === 'month' ? '#fff' : 'var(--txt-2)' }}>
            شهر
          </button>
          <button onClick={() => setPeriodMode('day')} className="px-2.5 py-1 rounded-md text-2xs font-bold transition-colors"
            style={{ background: periodMode === 'day' ? 'var(--accent)' : 'transparent', color: periodMode === 'day' ? '#fff' : 'var(--txt-2)' }}>
            يوم محدد
          </button>
        </div>
        {periodMode === 'month' ? (
          <input className="field text-xs w-36" type="month" value={month}
            onChange={e => setMonth(e.target.value)} />
        ) : (
          <input className="field text-xs w-36" type="date" value={day}
            onChange={e => { setDay(e.target.value); setMonth(e.target.value.slice(0, 7)) }} />
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* أزرار التصدير */}
        <div className="flex items-center justify-between">
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--txt-1)' }}>
            {cfg.label} — {month}
          </h2>
          {/* تنظيف: تبويبا "التقفيل الشهري" و"التقفيل السنوي" لهما زر "تصدير PDF" مخصَّص خاص بهما
              (داخل MonthlyCloseReport/AnnualCloseReport) — هذا الزر العام كان يظهر بجوارهما بنفس
              الاسم بالضبط رغم أنه لا يُصدِّر محتوى ذا معنى لهذين التبويبين، فأُخفي عليهما لمنع التكرار */}
          {tab !== 'monthly_close' && tab !== 'annual_close' && (
            <button onClick={exportPDF} disabled={exporting} className="btn-primary btn-sm">
              <Icons.Download size={14} /> {exporting ? 'جاري التصدير...' : 'تصدير PDF'}
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center py-10" style={{ color: 'var(--txt-3)' }}>جاري التحميل...</div>
        ) : tab === 'journal' ? (
          <JournalReport shifts={shifts} allTxs={allTxs} month={month} bizName={bizName} onReload={load} />
        ) : tab === 'monthly_close' ? (
          <MonthlyCloseReport month={month} shifts={shifts} allTxs={allTxs} empFin={empFin} finData={finData} onReload={load} />
        ) : tab === 'annual_close' ? (
          <AnnualCloseReport year={month.slice(0, 4)} />
        ) : tab === 'financial' ? (
          <>
            {/* قائمة الأرباح والخسائر */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <KPICard label="الإيرادات" value={fmt(finData?.revenues ?? 0) + ' ج'} color="#2ea043" icon={<Icons.ArrowRight size={14}/>} />
              <KPICard label="المشتريات" value={fmt(finData?.purchases ?? 0) + ' ج'} color="#388bfd" icon={<Icons.Records size={14}/>} />
              <KPICard label="المصروفات التشغيلية" value={fmt(finData?.expenses ?? 0) + ' ج'} color="#f85149" icon={<Icons.Fund size={14}/>} />
              <KPICard label="صافي الربح" value={fmt(finData?.netProfit ?? 0) + ' ج'} color={(finData?.netProfit ?? 0) >= 0 ? '#d4a017' : '#f85149'} icon={<Icons.Reports size={14}/>} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* قائمة الأرباح والخسائر — جدول تجميعي */}
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--inner-border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>قائمة الأرباح والخسائر (P&L)</div>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {[
                      ['الإيرادات',                finData?.revenues ?? 0, '#2ea043'],
                      ['(−) المشتريات',            finData?.purchases ?? 0, '#f85149'],
                      ['(−) المصروفات التشغيلية',  finData?.expenses ?? 0, '#f85149'],
                    ].map(([l, v, c]) => (
                      <tr key={l as string} className="tr">
                        <td className="td font-bold" style={{ color: 'var(--txt-2)' }}>{l as string}</td>
                        <td className="td tabular-nums font-bold" style={{ color: c as string }}>{fmt(v as number)} ج</td>
                      </tr>
                    ))}
                    <tr className="tr" style={{ borderTop: '2px solid var(--inner-border)' }}>
                      <td className="td font-bold" style={{ color: 'var(--txt-1)' }}>صافي الربح</td>
                      <td className="td tabular-nums font-bold" style={{ color: (finData?.netProfit ?? 0) >= 0 ? '#d4a017' : '#f85149', fontSize: 14 }}>
                        {fmt(finData?.netProfit ?? 0)} ج
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* التدفق النقدي + الذمم — جدول تجميعي */}
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--inner-border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>التدفق النقدي والذمم</div>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    <tr className="tr">
                      <td className="td font-bold" style={{ color: 'var(--txt-2)' }}>تدفق نقدي داخل (كاشير)</td>
                      <td className="td tabular-nums font-bold" style={{ color: '#2ea043' }}>{fmt(finData?.cashIn ?? 0)} ج</td>
                    </tr>
                    <tr className="tr">
                      <td className="td font-bold" style={{ color: 'var(--txt-2)' }}>تدفق نقدي خارج (كاشير)</td>
                      <td className="td tabular-nums font-bold" style={{ color: '#f85149' }}>{fmt(finData?.cashOut ?? 0)} ج</td>
                    </tr>
                    <tr className="tr" style={{ borderTop: '2px solid var(--inner-border)' }}>
                      <td className="td font-bold" style={{ color: 'var(--txt-1)' }}>صافي التدفق النقدي</td>
                      <td className="td tabular-nums font-bold" style={{ color: 'var(--txt-1)', fontSize: 14 }}>{fmt((finData?.cashIn ?? 0) - (finData?.cashOut ?? 0))} ج</td>
                    </tr>
                    <tr className="tr" style={{ borderTop: '2px solid var(--inner-border)' }}>
                      <td className="td font-bold" style={{ color: '#d29922' }}>الذمم المدينة (آجل)</td>
                      <td className="td tabular-nums font-bold" style={{ color: '#d29922' }}>{fmt(finData?.receivables ?? 0)} ج</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="text-xs" style={{ color: 'var(--txt-3)' }}>
              * صافي الربح = الإيرادات − (المشتريات + المصروفات التشغيلية) | الذمم المدينة = صافي بنود الدفع الآجل
            </div>
          </>
        ) : tab === 'employees' ? (
          <>
            {/* v2.27.0 (14-Jun) — تقارير الرواتب المحفوظة */}
            <PayrollReportsList />

            {/* بحث باسم الموظف */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold" style={{ color: 'var(--txt-3)' }}>بحث:</span>
              <input className="field text-xs" style={{ width: 220 }} placeholder="ابحث باسم الموظف..."
                value={empSearch} onChange={e => setEmpSearch(e.target.value)} />
              {empSearch && (
                <button onClick={() => setEmpSearch('')} className="text-2xs px-2 py-1 rounded-md" style={{ background: 'var(--inner-bg)', color: 'var(--txt-3)' }}>
                  ✕ إلغاء
                </button>
              )}
            </div>

            {/* KPIs الموظفين (تعكس نتيجة البحث) */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <KPICard label="عدد الموظفين" value={String(filteredEmpFin.length)} color="#d4a017" icon={<Icons.Employees size={14}/>} />
              <KPICard label="إجمالي الأجر باليوم" value={fmt(filteredEmpFin.reduce((s,f)=>s+f.wageByDays,0)) + ' ج'} color="#2ea043" icon={<Icons.Fund size={14}/>} />
              <KPICard label="إجمالي السلف" value={fmt(filteredEmpFin.reduce((s,f)=>s+f.advances,0)) + ' ج'} color="#f85149" icon={<Icons.ArrowRight size={14}/>} />
              <KPICard label="إجمالي المستحق" value={fmt(filteredEmpFin.reduce((s,f)=>s+f.dueSalary,0)) + ' ج'} color="#388bfd" icon={<Icons.Reports size={14}/>} />
            </div>
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr>
                  <th className="th">الموظف</th><th className="th">أيام الحضور</th><th className="th text-danger">أيام الغياب</th>
                  <th className="th">أجر بالساعة</th><th className="th">أجر باليوم</th>
                  <th className="th text-danger">السلف</th><th className="th text-danger">الجزاءات</th>
                  <th className="th" style={{color:'#d4a017'}}>المستحق</th>
                </tr></thead>
                <tbody>
                  {filteredEmpFin.map(f => (
                    <tr key={f.employeeId} className="tr">
                      <td className="td font-bold">{f.name}</td>
                      <td className="td tabular-nums text-success">{f.presentDays}</td>
                      <td className="td tabular-nums text-danger">{f.absentDays}</td>
                      <td className="td tabular-nums">{fmt(f.wageByHours)}</td>
                      <td className="td tabular-nums">{fmt(f.wageByDays)}</td>
                      <td className="td tabular-nums text-danger">{fmt(f.advances)}</td>
                      <td className="td tabular-nums text-danger">{fmt(f.penalties)}</td>
                      <td className="td tabular-nums font-bold" style={{color:'#d4a017'}}>{fmt(f.dueSalary)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-surface-500">
                  <td className="td font-bold">الإجمالي ({filteredEmpFin.length} موظف)</td>
                  <td className="td tabular-nums font-bold text-success">{filteredEmpFin.reduce((s,f)=>s+f.presentDays,0)}</td>
                  <td className="td tabular-nums font-bold text-danger">{filteredEmpFin.reduce((s,f)=>s+f.absentDays,0)}</td>
                  <td className="td"></td>
                  <td className="td tabular-nums font-bold">{fmt(filteredEmpFin.reduce((s,f)=>s+f.wageByDays,0))}</td>
                  <td className="td tabular-nums font-bold text-danger">{fmt(filteredEmpFin.reduce((s,f)=>s+f.advances,0))}</td>
                  <td className="td tabular-nums font-bold text-danger">{fmt(filteredEmpFin.reduce((s,f)=>s+f.penalties,0))}</td>
                  <td className="td tabular-nums font-bold" style={{color:'#d4a017'}}>{fmt(filteredEmpFin.reduce((s,f)=>s+f.dueSalary,0))}</td>
                </tr></tfoot>
              </table>
              {filteredEmpFin.length === 0 && <div className="text-center py-6" style={{color:'var(--txt-3)'}}>{empSearch ? 'لا يوجد موظف بهذا الاسم' : 'لا يوجد موظفون'}</div>}
            </div>
          </>
        ) : (
          <>
            {/* فلتر التصنيف الفرعي الخاص بهذا القسم */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold" style={{ color: 'var(--txt-3)' }}>تصنيف فرعي:</span>
              <select className="field text-xs" style={{ width: 200 }} value={subFilter} onChange={e => setSubFilter(e.target.value)}>
                <option value="">الكل ({subOptions.length} تصنيف)</option>
                {subOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {subFilter && (
                <button onClick={() => setSubFilter('')} className="text-2xs px-2 py-1 rounded-md" style={{ background: 'var(--inner-bg)', color: 'var(--txt-3)' }}>
                  ✕ إلغاء الفلتر
                </button>
              )}
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <KPICard label="الإجمالي" value={fmt(kpis.total) + ' ج'} color={cfg.color} icon={cfg.icon} />
              <KPICard label="عدد العمليات" value={String(kpis.count)} color="#5aaeff" icon={<Icons.Records size={14}/>} />
              <KPICard label="متوسط العملية" value={fmt(kpis.avg) + ' ج'} color="#8957e5" icon={<Icons.Reports size={14}/>} />
              <KPICard label="أعلى عملية" value={fmt(kpis.max) + ' ج'} color="#d29922" icon={<Icons.ArrowRight size={14}/>} />
            </div>

            {/* جدول تجميعي حسب التصنيف الفرعي — تنسيق مكثّف شبيه بشيت الإكسيل (خطوط شبكة على كل خلية) */}
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--inner-border)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>التوزيع حسب التصنيف الفرعي</div>
              </div>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th className="th" style={xlsTh}>التصنيف الفرعي</th><th className="th" style={xlsTh}>عدد البنود</th><th className="th" style={xlsTh}>الإجمالي</th>
                </tr></thead>
                <tbody>
                  {grouped.map((g, i) => (
                    <tr key={g.name} style={xlsRow(i)}>
                      <td className="font-bold" style={xlsTd}>{g.name}</td>
                      <td className="tabular-nums" style={xlsTd}>{g.count}</td>
                      <td className="tabular-nums font-bold" style={{ ...xlsTd, color: cfg.color }}>{fmt(g.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{ borderTop: '2px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
                  <td className="font-bold" style={xlsTd}>الإجمالي</td>
                  <td className="tabular-nums font-bold" style={xlsTd}>{kpis.count}</td>
                  <td className="tabular-nums font-bold" style={{ ...xlsTd, color: cfg.color }}>{fmt(kpis.total)}</td>
                </tr></tfoot>
              </table>
              {grouped.length === 0 && <div className="text-center py-6" style={{color:'var(--txt-3)'}}>لا توجد بيانات لهذه الفترة</div>}
            </div>

            {/* جدول تفصيلي لكل البنود — تنسيق مكثّف شبيه بشيت الإكسيل */}
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th className="th" style={xlsTh}>التاريخ</th><th className="th" style={xlsTh}>شيفت</th><th className="th" style={xlsTh}>البيان</th>
                  <th className="th" style={xlsTh}>التصنيف</th><th className="th" style={xlsTh}>الفرعي</th><th className="th" style={xlsTh}>الدفع</th><th className="th" style={xlsTh}>المبلغ</th>
                </tr></thead>
                <tbody>
                  {txRows.map((t, i) => (
                    <tr key={t.id} style={xlsRow(i)}>
                      <td style={{...xlsTd,color:'var(--txt-2)'}}>{t.shift ? fmtDate(t.shift.date) : '—'}</td>
                      <td className="text-brand-400" style={xlsTd}>#{t.shift?.monthlyShiftNum ?? '—'}</td>
                      <td className="font-medium truncate max-w-[160px]" style={xlsTd}>{t.description}</td>
                      <td style={{...xlsTd,color:'var(--txt-2)'}}>{t.mainCategoryName}</td>
                      <td style={{...xlsTd,color:'var(--txt-3)'}}>{t.subCategoryName || '—'}</td>
                      <td style={{...xlsTd,color:'var(--txt-3)'}}>{payLabel[t.payMethod]}</td>
                      <td className="tabular-nums font-bold" style={{...xlsTd,color:cfg.color}}>{fmt(t.amountIn + t.amountOut)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{ borderTop: '2px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
                  <td className="font-bold" colSpan={6} style={xlsTd}>الإجمالي ({kpis.count} عملية)</td>
                  <td className="tabular-nums font-bold" style={{...xlsTd,color:cfg.color}}>{fmt(kpis.total)}</td>
                </tr></tfoot>
              </table>
              {txRows.length === 0 && <div className="text-center py-6" style={{color:'var(--txt-3)'}}>لا توجد بيانات لهذا التصنيف</div>}
            </div>
          </>
        )}
      </div>

      {/* ===== تخطيط الطباعة المخفي (أبيض/أسود — عربية مثالية للـ PDF) ===== */}
      <div style={{ position: 'fixed', left: '-9999px', top: 0, width: '760px' }}>
        <div ref={printRef} dir="rtl"
          style={{ background: '#fff', color: '#1a1a1a', padding: '28px', fontFamily: "'Noto Kufi Arabic','Cairo',sans-serif", width: '760px' }}>
          {/* ترويسة */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'3px solid #d4a017', paddingBottom:'14px', marginBottom:'18px' }}>
            <div>
              <div style={{ fontSize:'22px', fontWeight:800, color:'#1a1a1a' }}>{cfg.label}</div>
              <div style={{ fontSize:'13px', color:'#666', marginTop:'4px' }}>عن شهر: {month}</div>
            </div>
            <div style={{ textAlign:'left' }}>
              <div style={{ fontSize:'18px', fontWeight:800, color:'#d4a017' }}>{bizName || 'AJ Smart Shift'}</div>
              <div style={{ fontSize:'11px', color:'#888' }}>AJ Smart Shift — يومية أحمد جلال</div>
            </div>
          </div>

          {tab === 'employees' ? (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'12px' }}>
              <thead><tr style={{ background:'#f3f4f6' }}>
                {['الموظف','حضور','غياب','أجر/ساعة','أجر/يوم','السلف','الجزاءات','المستحق'].map(h=>(
                  <th key={h} style={{ border:'1px solid #ddd', padding:'7px', fontWeight:700 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {empFin.map(f=>(
                  <tr key={f.employeeId}>
                    <td style={{ border:'1px solid #ddd', padding:'6px', fontWeight:700 }}>{f.name}</td>
                    <td style={{ border:'1px solid #ddd', padding:'6px', textAlign:'center' }}>{f.presentDays}</td>
                    <td style={{ border:'1px solid #ddd', padding:'6px', textAlign:'center' }}>{f.absentDays}</td>
                    <td style={{ border:'1px solid #ddd', padding:'6px', textAlign:'center' }}>{fmt(f.wageByHours)}</td>
                    <td style={{ border:'1px solid #ddd', padding:'6px', textAlign:'center' }}>{fmt(f.wageByDays)}</td>
                    <td style={{ border:'1px solid #ddd', padding:'6px', textAlign:'center', color:'#c00' }}>{fmt(f.advances)}</td>
                    <td style={{ border:'1px solid #ddd', padding:'6px', textAlign:'center', color:'#c00' }}>{fmt(f.penalties)}</td>
                    <td style={{ border:'1px solid #ddd', padding:'6px', textAlign:'center', fontWeight:800, color:'#a67c00' }}>{fmt(f.dueSalary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <div style={{ display:'flex', gap:'10px', marginBottom:'16px' }}>
                {[['الإجمالي',fmt(kpis.total)],['العمليات',String(kpis.count)],['المتوسط',fmt(kpis.avg)],['أعلى',fmt(kpis.max)]].map(([l,v])=>(
                  <div key={l} style={{ flex:1, border:'1px solid #e5e7eb', borderRadius:'8px', padding:'10px', textAlign:'center' }}>
                    <div style={{ fontSize:'11px', color:'#777' }}>{l}</div>
                    <div style={{ fontSize:'16px', fontWeight:800, color:'#1a1a1a' }}>{v}</div>
                  </div>
                ))}
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'11px' }}>
                <thead><tr style={{ background:'#f3f4f6' }}>
                  {['التاريخ','شيفت','البيان','التصنيف','الدفع','المبلغ'].map(h=>(
                    <th key={h} style={{ border:'1px solid #ddd', padding:'6px', fontWeight:700 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {txRows.map(t=>(
                    <tr key={t.id}>
                      <td style={{ border:'1px solid #ddd', padding:'5px', textAlign:'center' }}>{t.shift?fmtDate(t.shift.date):'—'}</td>
                      <td style={{ border:'1px solid #ddd', padding:'5px', textAlign:'center' }}>#{t.shift?.monthlyShiftNum??'—'}</td>
                      <td style={{ border:'1px solid #ddd', padding:'5px' }}>{t.description}</td>
                      <td style={{ border:'1px solid #ddd', padding:'5px' }}>{t.mainCategoryName}</td>
                      <td style={{ border:'1px solid #ddd', padding:'5px', textAlign:'center' }}>{payLabel[t.payMethod]}</td>
                      <td style={{ border:'1px solid #ddd', padding:'5px', textAlign:'center', fontWeight:700 }}>{fmt(t.amountIn+t.amountOut)}</td>
                    </tr>
                  ))}
                  <tr style={{ background:'#faf6ea' }}>
                    <td colSpan={5} style={{ border:'1px solid #ddd', padding:'7px', fontWeight:800 }}>الإجمالي</td>
                    <td style={{ border:'1px solid #ddd', padding:'7px', textAlign:'center', fontWeight:800, color:'#a67c00' }}>{fmt(kpis.total)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
          <div style={{ marginTop:'20px', textAlign:'center', fontSize:'10px', color:'#999', borderTop:'1px solid #eee', paddingTop:'10px' }}>
            تم إنشاء التقرير بواسطة AJ Smart Shift · تطوير أحمد جلال · {new Date().toLocaleDateString('en-GB')}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// v2.27.0 — مكون سجل اليوميات: استعراض مكثف لكل البنود
// ═══════════════════════════════════════════════════════════
function JournalReport({ shifts, allTxs, month, bizName: _bizName, onReload }: {
  shifts: Shift[]; allTxs: Transaction[]; month: string; bizName: string; onReload: () => void;
}) {
  // ── نتيجة كل شيفت — المعادلة الرسمية الموحّدة (ADR-012 v2) ──
  // الإغلاق = (نقدية الكاشير + مصروفات الكاشير + التحصيل) − مبيعات POS
  type Kind = 'surplus' | 'deficit' | 'balanced'
  function shiftResult(s: Shift): { result: number; kind: Kind } {
    const txs             = allTxs.filter(t => t.shiftId === s.id)
    const collections     = txs.filter(t => t.mainCategoryName === 'تحصيل').reduce((sm, t) => sm + t.amountIn, 0)
    const cashierExpenses = txs.filter(t => t.payMethod === 'cashier' && t.mainCategoryName !== 'تحصيل').reduce((sm, t) => sm + t.amountIn + t.amountOut, 0)
    const { result, status } = calcShiftClosing({ posSales: s.posSales ?? 0, cashierRemaining: s.cashierRemaining ?? 0, cashierExpenses, collections })
    return { result, kind: status }
  }
  const KIND_STYLE: Record<Kind, { bg: string; border: string; text: string; label: string; glow: string }> = {
    surplus:  { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.45)', text: '#10b981', label: 'أوفر',  glow: 'rgba(16,185,129,0.25)' },
    deficit:  { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.45)',  text: '#ef4444', label: 'عجز',   glow: 'rgba(239,68,68,0.25)' },
    balanced: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.45)', text: '#f59e0b', label: 'مطابق', glow: 'rgba(245,158,11,0.25)' },
  }

  // v2.27.0 (15-Jun) — حذف يومية
  const [deleteShift, setDeleteShift] = useState<Shift | null>(null)
  const [deleting,    setDeleting]    = useState(false)
  // ADR-012 — الشاشة الموحّدة (تحلّ محل المودال القديم)
  const [sheetId,     setSheetId]     = useState<number | null>(null)

  async function confirmDelete() {
    if (!deleteShift) return
    setDeleting(true)
    try {
      const res = await call(api.shifts.delete(deleteShift.id)) as { ok: boolean; reason?: string }
      if (!res.ok) { alert(res.reason ?? 'تعذّر الحذف'); setDeleteShift(null); return }
      setDeleteShift(null)
      onReload() // تحديث القائمة من الأب
    } catch (e) { console.error(e) }
    finally { setDeleting(false) }
  }

  return (
    <div className="space-y-4">
      {/* الرأس */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(59,130,246,0.18)', color: '#3b82f6' }}>
          <Icons.Journal size={18} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--txt-1)' }}>سجل اليوميات</div>
          <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
            دبل كليك على أي شيفت لعرض تفاصيله الكاملة وتعديلها
          </div>
        </div>
      </div>

      {/* مفتاح الألوان */}
      <div className="flex items-center gap-3 text-xs flex-wrap">
        <span style={{ color: 'var(--txt-3)' }}>دلالة الألوان:</span>
        {(['surplus', 'balanced', 'deficit'] as Kind[]).map(k => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full"
              style={{ background: KIND_STYLE[k].text, boxShadow: `0 0 8px ${KIND_STYLE[k].text}88` }} />
            <span style={{ color: 'var(--txt-2)' }}>{KIND_STYLE[k].label}</span>
          </span>
        ))}
        <span className="mr-auto" style={{ color: 'var(--txt-3)' }}>{shifts.length} شيفت في {month}</span>
      </div>

      {/* شبكة البطاقات */}
      {shifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3" style={{ color: 'var(--txt-3)' }}>
          <Icons.Journal size={48} className="opacity-20" />
          <span className="text-sm">لا توجد شيفتات في هذا الشهر</span>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          {shifts.map(s => {
            const { result, kind } = shiftResult(s)
            const st = KIND_STYLE[kind]
            return (
              <div key={s.id}
                onDoubleClick={() => setSheetId(s.id)}
                className="text-right p-3 rounded-2xl transition-all hover:scale-[1.03] hover:shadow-lg cursor-pointer relative group"
                style={{ background: st.bg, border: `1.5px solid ${st.border}`, boxShadow: `0 2px 12px ${st.glow}` }}>
                {/* زر حذف اليومية */}
                <button onClick={e => { e.stopPropagation(); setDeleteShift(s) }}
                  className="absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                  style={{ background: '#ef4444', color: 'white', boxShadow: '0 2px 8px rgba(239,68,68,0.5)' }}
                  title="حذف اليومية">
                  <Icons.Trash size={12} />
                </button>
                <div className="flex items-center justify-between mb-2" onClick={() => setSheetId(s.id)}>
                  <span className="text-2xs" style={{ color: 'var(--txt-3)' }}>{fmtDate(s.date)}</span>
                  <span className="font-black text-base" style={{ color: st.text }}>#{s.monthlyShiftNum}</span>
                </div>
                <div className="text-xs truncate mb-2" style={{ color: 'var(--txt-2)' }} onClick={() => setSheetId(s.id)}>
                  {shiftTypeLabel(s.type)} · {s.cashierName}
                </div>
                <div className="flex items-center justify-between" onClick={() => setSheetId(s.id)}>
                  <span className="text-2xs px-2 py-0.5 rounded-full font-bold"
                    style={{ background: st.text + '22', color: st.text }}>{st.label}</span>
                  <span className="text-2xs tabular-nums font-bold" style={{ color: st.text }}>
                    {result > 0 ? '+' : result < 0 ? '−' : ''}{fmt(Math.abs(result))}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ الشاشة الموحّدة (ADR-012) — تحلّ محل المودال القديم ═══ */}
      {sheetId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
          onClick={() => setSheetId(null)}>
          <div className="card" style={{ width: '96vw', maxWidth: 1440, height: '92vh', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <ShiftSheet shiftId={sheetId} onClose={() => setSheetId(null)} onDeleted={() => { setSheetId(null); onReload() }} />
          </div>
        </div>
      )}

      {/* ═══ تأكيد حذف اليومية ═══ */}
      {deleteShift && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
          onClick={() => setDeleteShift(null)}>
          <div className="card p-6 max-w-sm text-center" onClick={e => e.stopPropagation()}
            style={{ border: '2px solid #ef4444' }}>
            <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-3"
              style={{ background: 'rgba(239,68,68,0.15)', fontSize: 32 }}>🗑️</div>
            <div className="font-black text-lg mb-2" style={{ color: '#ef4444' }}>حذف اليومية؟</div>
            <div className="text-sm mb-4" style={{ color: 'var(--txt-2)' }}>
              شيفت <b>#{deleteShift.monthlyShiftNum}</b> — {fmtDate(deleteShift.date)}
              <br />
              <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                سيُحذف الشيفت وكل بنوده وبيانات فوري والعهدة نهائياً
              </span>
            </div>
            <div className="flex items-center gap-2 justify-center">
              <button onClick={() => setDeleteShift(null)} className="btn-ghost btn-sm">إلغاء</button>
              <button onClick={confirmDelete} disabled={deleting} className="btn-danger-pro" style={{ fontSize: 13, padding: '8px 20px' }}>
                {deleting ? <><Icons.Refresh size={13} className="animate-spin" /> جاري...</> : <><Icons.Trash size={14} /> حذف نهائي</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
// v2.27.0 (14-Jun) — قائمة تقارير الرواتب المحفوظة
// ═══════════════════════════════════════════════════════════
interface PayrollRow {
  id: number; month: string; total_amount: number; payment_method: string;
  employee_count: number; details_json: string; created_at: string;
}
function PayrollReportsList() {
  const { show } = useToast()
  const [reports, setReports] = useState<PayrollRow[]>([])
  const [openId,  setOpenId]  = useState<number | null>(null)

  function reload() {
    call(api.payroll.list()).then(r => setReports(r as PayrollRow[])).catch(() => {})
  }
  useEffect(() => { reload() }, [])

  async function handleDelete(r: PayrollRow) {
    if (!confirm(`حذف تقرير رواتب شهر ${r.month} (${fmt(r.total_amount)} ج)؟\nسيُعاد المبلغ إلى الصندوق (عكس الخصم).`)) return
    try {
      await call(api.payroll.delete(r.id))
      show('تم حذف التقرير وإعادة المبلغ للخزينة ✓', 'success')
      reload()
    } catch (e) { show((e as Error).message, 'error') }
  }

  if (reports.length === 0) return null

  async function exportPayrollPDF(r: PayrollRow) {
    try {
      const details = JSON.parse(r.details_json) as { name: string; mode: string; amount: number }[]
      const html = `
        <div id="payroll-pdf" style="font-family:'IBM Plex Sans Arabic',Arial,sans-serif;direction:rtl;padding:28px 32px;width:794px;background:#fff;color:#0f172a;">
          <div style="background:linear-gradient(135deg,#1e3a8a,#1e293b);color:#fff;padding:18px 22px;border-radius:10px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;">
            <div><div style="font-size:20px;font-weight:900;">تقرير رواتب الموظفين</div><div style="font-size:12px;opacity:.85;margin-top:3px;">شهر ${r.month} · ${r.employee_count} موظف</div></div>
            <div style="font-size:11px;opacity:.85;">${new Date(r.created_at).toLocaleDateString('ar-EG')}</div>
          </div>
          <table style="width:100%;font-size:12px;border-collapse:collapse;border:1px solid #cbd5e1;">
            <thead><tr style="background:#1e3a8a;color:#fff;">
              <th style="padding:8px;border:1px solid #1e3a8a;">#</th>
              <th style="padding:8px;border:1px solid #1e3a8a;">الموظف</th>
              <th style="padding:8px;border:1px solid #1e3a8a;">طريقة الاحتساب</th>
              <th style="padding:8px;border:1px solid #1e3a8a;">الراتب المستحق</th>
            </tr></thead>
            <tbody>
              ${details.map((d, i) => `<tr style="background:${i%2===0?'#f8fafc':'#fff'};">
                <td style="padding:6px 8px;text-align:center;border:1px solid #e2e8f0;color:#64748b;">${i+1}</td>
                <td style="padding:6px 8px;border:1px solid #e2e8f0;font-weight:600;">${d.name}</td>
                <td style="padding:6px 8px;text-align:center;border:1px solid #e2e8f0;">${d.mode==='hours'?'بالساعة':'باليوم'}</td>
                <td style="padding:6px 8px;text-align:center;border:1px solid #e2e8f0;font-weight:700;color:#10b981;">${fmt(d.amount)} ج</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr style="background:#1e293b;color:#fff;font-weight:800;">
              <td colspan="3" style="padding:9px;text-align:right;border:1px solid #1e293b;">الإجمالي · طريقة الدفع: الصندوق</td>
              <td style="padding:9px;text-align:center;border:1px solid #1e293b;color:#10b981;">${fmt(r.total_amount)} ج</td>
            </tr></tfoot>
          </table>
          <div style="margin-top:14px;font-size:10px;color:#64748b;display:flex;justify-content:space-between;">
            <span>AJ Smart Shift Hyper v${APP_VERSION}</span><span>تطوير: أحمد جلال #1637</span>
          </div>
        </div>`
      const container = document.createElement('div')
      container.style.position = 'fixed'; container.style.left = '-9999px'; container.style.top = '0'
      container.innerHTML = html
      document.body.appendChild(container)
      const html2canvas = (await import('html2canvas')).default
      const { default: jsPDF } = await import('jspdf')
      const canvas = await html2canvas(container.querySelector('#payroll-pdf') as HTMLElement, { scale: 2, backgroundColor: '#fff' })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const imgW = 194, imgH = (canvas.height * imgW) / canvas.width
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 8, 8, imgW, imgH)
      pdf.save(`رواتب-${r.month}.pdf`)
      document.body.removeChild(container)
    } catch (e) { console.error(e) }
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
        <span style={{ fontSize: 14 }}>💰</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>تقارير الرواتب المحفوظة ({reports.length})</span>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--inner-border)' }}>
        {reports.map(r => {
          const details = (() => { try { return JSON.parse(r.details_json) as { name: string; mode: string; amount: number }[] } catch { return [] } })()
          const isOpen = openId === r.id
          return (
            <div key={r.id}>
              <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/5" onClick={() => setOpenId(isOpen ? null : r.id)}>
                <span className="text-2xs px-2 py-0.5 rounded-md font-bold" style={{ background: 'rgba(59,130,246,0.15)', color: 'var(--accent)' }}>{r.month}</span>
                <span className="text-xs" style={{ color: 'var(--txt-2)' }}>{r.employee_count} موظف</span>
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>· الصندوق</span>
                <span className="tabular-nums font-bold mr-auto" style={{ fontSize: 14, color: '#10b981' }}>{fmt(r.total_amount)} ج</span>
                <button onClick={e => { e.stopPropagation(); exportPayrollPDF(r) }} className="btn-next btn-sm" style={{ fontSize: 10, padding: '3px 10px' }}>📄 PDF</button>
                <button onClick={e => { e.stopPropagation(); handleDelete(r) }} className="btn-sm" style={{ fontSize: 10, padding: '3px 10px', background: 'rgba(248,81,73,0.12)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 8 }}>🗑 حذف</button>
              </div>
              {isOpen && (
                <div className="px-6 pb-3" style={{ background: 'var(--inner-bg)' }}>
                  <table className="w-full text-xs">
                    <tbody>
                      {details.map((d, i) => (
                        <tr key={i} className="tr">
                          <td className="td">{d.name}</td>
                          <td className="td text-2xs" style={{ color: 'var(--txt-3)' }}>{d.mode === 'hours' ? 'بالساعة' : 'باليوم'}</td>
                          <td className="td tabular-nums font-bold" style={{ color: '#10b981' }}>{fmt(d.amount)} ج</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// v2.31.2 — تقرير التقفيل السنوي (تجميع تلقائي للأشهر المقفلة)
// ═══════════════════════════════════════════════════════════
function AnnualCloseReport({ year }: { year: string }) {
  const { show } = useToast()
  const [rows, setRows] = useState<{ month: string; d: any }[]>([])
  const [logo, setLogo] = useState(''); const [companyName, setCompanyName] = useState('')
  const [invStart, setInvStart] = useState(''); const [invEnd, setInvEnd] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const all = await call(api.monthlyClose.list()) as { month: string; data_json: string }[]
        const yr = all.filter(r => r.month.startsWith(year))
          .map(r => { try { return { month: r.month, d: JSON.parse(r.data_json) } } catch { return { month: r.month, d: {} } } })
          .sort((a, b) => a.month.localeCompare(b.month))
        if (alive) setRows(yr)
      } catch (e) { console.error(e) }
      try {
        const st = await call(api.settings.getAll()) as { key: string; value: string }[]
        if (alive) { setLogo(st.find(x => x.key === 'biz.logo')?.value ?? ''); setCompanyName(st.find(x => x.key === 'biz.name')?.value ?? '') }
      } catch { /* */ }
    })()
    return () => { alive = false }
  }, [year])

  const sum = useMemo(() => {
    const add = (k: string) => rows.reduce((s, r) => s + (r.d[k] ?? 0), 0)
    const first = rows[0]?.d ?? {}, last = rows[rows.length - 1]?.d ?? {}
    const invStartP = parsePias(invStart || '0'), invEndP = parsePias(invEnd || '0')
    return {
      months: rows.length,
      shiftsCount: add('shiftsCount'), itemsCount: add('itemsCount'),
      totalIn: add('totalIn'), totalOut: add('totalOut'),
      posSales: add('posSales'), fawrySales: add('fawrySales'), visaSales: add('visaSales'),
      cashierAdded: add('cashierAdded'), mgmtSpent: add('mgmtSpent'),
      cashOpening: first.cashOpening ?? 0, cashClosing: last.cashClosing ?? 0,
      invStart: invStartP, invEnd: invEndP, invDiff: invEndP - invStartP,
    }
  }, [rows, invStart, invEnd])

  // v2.34.0 — أهم 5 تصنيفات لكل شهر مقفل: المبيعات/المشتريات/المصروفات/صافي الربح/الرصيد الختامي
  // v2.34.4 — يقرأ الشكل الجديد (totalPurchases/totalExpenses/netProfit قد تكون Metric = رقم أو {missing}) مع توافق خلفي للسجلات القديمة
  function monthMetrics(d: any) {
    const num = (v: unknown): number => typeof v === 'number' ? v : 0
    const totalSales = d.totalSales ?? d.posSales ?? 0
    const totalPurchases = num(d.totalPurchases) || ((d.purchasesGeneral ?? 0) + (d.shipping ?? 0) + (d.meatPurchases ?? 0) + (d.poultryPurchases ?? 0) + (d.productWaste ?? 0))
    const totalExpenses = num(d.totalExpenses) || ((d.wages ?? 0) + (d.rent ?? 0) + (d.assetDepreciation ?? 0) + (d.water ?? 0) + (d.electricity ?? 0)
      + (d.insurance ?? 0) + (d.facilities ?? 0) + (d.govFees ?? 0) + (d.phoneInternet ?? 0) + (d.maintenance ?? 0)
      + (d.officeSupplies ?? 0) + (d.cleaningExpenses ?? 0) + (d.packagingTools ?? 0))
    const netProfit = num(d.netProfit)
    const fundClosing = d.fundClosing ?? d.cashClosing ?? 0
    return { totalSales, totalPurchases, totalExpenses, netProfit, fundClosing }
  }
  const monthRows = useMemo(() => rows.map(r => ({ month: r.month, m: monthMetrics(r.d) })), [rows])
  const yearTotals = useMemo(() => ({
    totalSales: monthRows.reduce((s, r) => s + r.m.totalSales, 0),
    totalPurchases: monthRows.reduce((s, r) => s + r.m.totalPurchases, 0),
    totalExpenses: monthRows.reduce((s, r) => s + r.m.totalExpenses, 0),
    netProfit: monthRows.reduce((s, r) => s + r.m.netProfit, 0),
  }), [monthRows])
  const trendData = useMemo(() => monthRows.map(r => ({ label: r.month.slice(5), in: r.m.totalSales, out: r.m.totalPurchases + r.m.totalExpenses, net: r.m.netProfit })), [monthRows])

  async function exportPDF() {
    try {
      const rowsPdf: [string, string][] = [
        ['عدد الأشهر المقفلة', String(sum.months)],
        ['عدد الشيفتات', String(sum.shiftsCount)],
        ['عدد البنود', String(sum.itemsCount)],
        ['إجمالي الوارد', fmt(sum.totalIn) + ' ج'],
        ['إجمالي المنصرف', fmt(sum.totalOut) + ' ج'],
        ['مبيعات POS', fmt(sum.posSales) + ' ج'],
        ['مبيعات فوري', fmt(sum.fawrySales) + ' ج'],
        ['مبيعات الفيزا', fmt(sum.visaSales) + ' ج'],
        ['— حركة الصندوق —', ''],
        ['رصيد الصندوق أول السنة', fmt(sum.cashOpening) + ' ج'],
        ['المضاف من نقدية الكاشير', fmt(sum.cashierAdded) + ' ج'],
        ['المنصرف من الإدارة', fmt(sum.mgmtSpent) + ' ج'],
        ['الرصيد الختامي للصندوق', fmt(sum.cashClosing) + ' ج'],
        ['— المخزون (بضاعة) —', ''],
        ['قيمة المخزون أول السنة', fmt(sum.invStart) + ' ج'],
        ['قيمة المخزون نهاية السنة', fmt(sum.invEnd) + ' ج'],
        ['الفرق (± المخزون)', (sum.invDiff >= 0 ? '+' : '−') + fmt(Math.abs(sum.invDiff)) + ' ج'],
      ]
      const logoHtml = logo
        ? '<div style="width:48px;height:48px;background:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;"><img src="' + logo + '" style="max-width:100%;max-height:100%;object-fit:contain;"/></div>'
        : ''
      const html = '<div id="ac-pdf" style="font-family:\'IBM Plex Sans Arabic\',Arial,sans-serif;direction:rtl;padding:28px 32px;width:794px;background:#fff;color:#0f172a;">'
        + '<div style="background:linear-gradient(135deg,#ec4899,#be185d);color:#fff;padding:20px 24px;border-radius:12px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">'
        + '<div style="display:flex;align-items:center;gap:12px;">' + logoHtml + '<div><div style="font-size:22px;font-weight:900;">تقرير التقفيل السنوي</div><div style="font-size:13px;opacity:.9;margin-top:4px;">' + (companyName || 'AJ Smart Shift Hyper') + ' · سنة ' + year + '</div></div></div>'
        + '<div style="font-size:11px;opacity:.85;">' + new Date().toLocaleDateString('ar-EG') + '</div></div>'
        + '<table style="width:100%;font-size:13px;border-collapse:collapse;border:1px solid #cbd5e1;"><tbody>'
        + rowsPdf.map((r, i) => r[1] === ''
          ? '<tr style="background:#fce7f3;"><td colspan="2" style="padding:7px 12px;border:1px solid #e2e8f0;color:#be185d;font-weight:800;text-align:center;">' + r[0] + '</td></tr>'
          : '<tr style="background:' + (i % 2 === 0 ? '#f8fafc' : '#fff') + ';">'
          + '<td style="padding:9px 12px;border:1px solid #e2e8f0;color:#475569;font-weight:600;width:55%;">' + r[0] + '</td>'
          + '<td style="padding:9px 12px;border:1px solid #e2e8f0;font-weight:800;color:#1e3a8a;">' + r[1] + '</td></tr>').join('')
        + '</tbody></table>'
        + '<div style="margin-top:14px;font-size:10px;color:#64748b;display:flex;justify-content:space-between;"><span>AJ Smart Shift Hyper v${APP_VERSION}</span><span>تطوير: أحمد جلال #1637</span></div></div>'
      const container = document.createElement('div')
      container.style.position = 'fixed'; container.style.left = '-9999px'; container.style.top = '0'
      container.innerHTML = html
      document.body.appendChild(container)
      const html2canvas = (await import('html2canvas')).default
      const { default: jsPDF } = await import('jspdf')
      const canvas = await html2canvas(container.querySelector('#ac-pdf') as HTMLElement, { scale: 1.5, backgroundColor: '#fff' })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
      const imgW = 194, imgH = (canvas.height * imgW) / canvas.width
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 8, 8, imgW, imgH)
      pdf.save('تقفيل-سنوي-' + year + '.pdf')
      document.body.removeChild(container)
    } catch (e) { show((e as Error).message, 'error') }
  }

  const cards = [
    { label: 'الأشهر المقفلة', value: String(sum.months), color: '#ec4899' },
    { label: 'مبيعات POS', value: fmt(sum.posSales) + ' ج', color: '#3b82f6' },
    { label: 'مبيعات فوري', value: fmt(sum.fawrySales) + ' ج', color: '#8b5cf6' },
    { label: 'مبيعات الفيزا', value: fmt(sum.visaSales) + ' ج', color: '#06b6d4' },
    { label: 'الرصيد الختامي', value: fmt(sum.cashClosing) + ' ج', color: '#22c55e' },
    { label: 'فرق المخزون', value: (sum.invDiff >= 0 ? '+' : '−') + fmt(Math.abs(sum.invDiff)) + ' ج', color: '#f59e0b' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(236,72,153,0.18)', color: '#ec4899' }}>
          <Icons.Lock size={18} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--txt-1)' }}>تقرير التقفيل السنوي — {year}</div>
          <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>تجميع تلقائي للأشهر المقفلة في السنة</div>
        </div>
        <button onClick={exportPDF} disabled={sum.months === 0} className="btn-primary mr-auto" style={{ fontSize: 12, padding: '8px 18px' }}>
          <Icons.Download size={13} /> تصدير PDF
        </button>
      </div>

      {sum.months === 0 ? (
        <div className="card text-center py-8 text-xs" style={{ color: 'var(--txt-3)' }}>
          لا توجد أشهر مقفلة في سنة {year}. أقفِل الأشهر من تبويب "التقفيل الشهري" أولاً ليُجمّعها هذا التقرير.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {cards.map(c => (
              <div key={c.label} className="rounded-2xl p-4" style={{ background: c.color + '12', border: '1px solid ' + c.color + '40' }}>
                <div className="text-2xs mb-1 font-bold" style={{ color: c.color }}>{c.label}</div>
                <div className="tabular-nums font-bold" style={{ fontSize: 17, color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <span style={{ fontSize: 15 }}>📦</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>قيمة المخزون السنوي (بضاعة)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>قيمة المخزون أول السنة</label>
                <input className="field tabular-nums" type="number" min={0} value={invStart} onChange={e => setInvStart(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>قيمة المخزون نهاية السنة</label>
                <input className="field tabular-nums" type="number" min={0} value={invEnd} onChange={e => setInvEnd(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>الفرق</label>
                <div className="field tabular-nums flex items-center font-bold" style={{ color: sum.invDiff >= 0 ? '#22c55e' : '#ef4444' }}>
                  {(sum.invDiff >= 0 ? '+' : '−') + fmt(Math.abs(sum.invDiff))} ج
                </div>
              </div>
            </div>
          </div>

          {/* v2.34.0 — رسم بياني اتجاهي: مبيعات/مشتريات+مصروفات/صافي ربح عبر أشهر السنة */}
          {monthRows.length > 1 && (
            <div className="card p-3">
              <div className="text-xs font-bold mb-2" style={{ color: 'var(--txt-1)' }}>📈 اتجاه المبيعات والمصروفات والأرباح عبر الشهور</div>
              <MiniCombo data={trendData} height={180} formatter={v => fmt(v) + ' ج'} />
            </div>
          )}

          {/* v2.34.0 — جدول عمودي: كل شهر مقفل صف مستقل، بأهم 5 تصنيفات كأعمدة */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
              <span style={{ fontSize: 14 }}>🗓️</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>الأشهر المُجمّعة ({rows.length})</span>
            </div>
            <table className="w-full text-xs">
              <thead><tr>
                <th className="th">الشهر</th>
                <th className="th" style={{ color: '#3b82f6' }}>إجمالي المبيعات</th>
                <th className="th" style={{ color: '#d29922' }}>إجمالي المشتريات</th>
                <th className="th" style={{ color: '#f85149' }}>إجمالي المصروفات</th>
                <th className="th" style={{ color: '#22c55e' }}>صافي الربح</th>
                <th className="th" style={{ color: '#8b5cf6' }}>الرصيد الختامي</th>
              </tr></thead>
              <tbody>
                {monthRows.map(r => (
                  <tr key={r.month} className="tr">
                    <td className="td font-bold" style={{ color: 'var(--txt-1)' }}>
                      <span className="text-2xs px-2 py-0.5 rounded-md font-bold" style={{ background: 'rgba(236,72,153,0.15)', color: '#ec4899' }}>{r.month}</span>
                    </td>
                    <td className="td tabular-nums font-bold" style={{ color: '#3b82f6' }}>{fmt(r.m.totalSales)}</td>
                    <td className="td tabular-nums" style={{ color: '#d29922' }}>{fmt(r.m.totalPurchases)}</td>
                    <td className="td tabular-nums" style={{ color: '#f85149' }}>{fmt(r.m.totalExpenses)}</td>
                    <td className="td tabular-nums font-bold" style={{ color: r.m.netProfit >= 0 ? '#22c55e' : '#ef4444' }}>{fmt(r.m.netProfit)}</td>
                    <td className="td tabular-nums font-bold" style={{ color: '#8b5cf6' }}>{fmt(r.m.fundClosing)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ borderTop: '2px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
                <td className="td font-bold" style={{ color: 'var(--txt-1)' }}>الإجمالي</td>
                <td className="td tabular-nums font-bold" style={{ color: '#3b82f6' }}>{fmt(yearTotals.totalSales)}</td>
                <td className="td tabular-nums font-bold" style={{ color: '#d29922' }}>{fmt(yearTotals.totalPurchases)}</td>
                <td className="td tabular-nums font-bold" style={{ color: '#f85149' }}>{fmt(yearTotals.totalExpenses)}</td>
                <td className="td tabular-nums font-bold" style={{ color: yearTotals.netProfit >= 0 ? '#22c55e' : '#ef4444' }}>{fmt(yearTotals.netProfit)}</td>
                <td className="td tabular-nums font-bold" style={{ color: '#8b5cf6' }}>{fmt(sum.cashClosing)}</td>
              </tr></tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// v2.31.5 — تقارير التقفيل الشهري (بتنسيق شيت حورس المرجعي بالكامل)
// أقسام: إيرادات، مصاريف مشتريات، مصاريف مبيعات، مصاريف إدارية، ماكينة فوري،
//        حساب الكاش أوت، الصندوق، المخزون (أرصدة) — نفس ترتيب وتسمية الشيت.
// ═══════════════════════════════════════════════════════════
// v2.34.4 — status/approved_by/approved_at/unapproved_at لقفل الشهر بعد الاعتماد
interface MonthCloseRow { id: number; month: string; data_json: string; created_at: string; status?: string; approved_by?: number | null; approved_at?: string | null; unapproved_at?: string | null }

function prevMonthKeyOf(month: string): string {
  const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ═══════════════════════════════════════════════════════════
// v2.34.4 — تقرير التقفيل الشهري: إعادة بناء محاسبي كامل
// شيفتات معتمدة فقط + تجميع ديناميكي بالنوع المحاسبي + COGS حقيقي + تشخيص + قفل بعد الاعتماد + مقارنة شهر سابق
// ═══════════════════════════════════════════════════════════
type Metric = number | { missing: string }
function isMissing(m: Metric): m is { missing: string } { return typeof m === 'object' && m !== null }
function metricNum(m: Metric): number { return typeof m === 'number' ? m : 0 }

// صندوق عرض موحّد لكل قيمة رقمية في التقرير — نفس شكل حقول الإدخال ذات الإطار الأزرق (للقراءة فقط، لكن نفس الشكل البصري)
// مقاس واحد ثابت للصندوق في كل التقرير (بناءً على أكبر قيمة مكتوبة، مثل "2,737,863.00") — لا فرق بين صندوق وصندوق
// اللون الداخلي يفضل يحمل معناه المحاسبي (أحمر/أخضر/ذهبي) والصندوق نفسه (حدود/خلفية/راديوس/عرض) موحّد دايمًا
const VALUE_BOX_W = 108
// fit=true: يُستخدم فقط في الجداول الضيقة متعددة الأعمدة (زي "الأرصدة (المخزون)") حتى ما يفيضش عرض الكارت — ياخد عرض خليته بالظبط بدل المقاس الموحّد
function ValueBox({ children, color, fit }: { children: React.ReactNode; color?: string; fit?: boolean }) {
  return (
    <span className="tabular-nums font-bold" style={{
      display: 'inline-block', textAlign: 'right', boxSizing: 'border-box',
      width: fit ? '100%' : VALUE_BOX_W,
      background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.35)',
      borderRadius: 5, padding: fit ? '2px 4px' : '2px 7px', fontSize: 10.5, lineHeight: 1.5,
      color: color ?? '#3b82f6',
    }}>{children}</span>
  )
}

function MetricText({ m, accent, suffix }: { m: Metric; accent?: string; suffix?: string }) {
  if (isMissing(m)) return <span className="text-2xs font-bold" style={{ color: '#f59e0b' }}>⚠ {m.missing}</span>
  return <ValueBox color={accent}>{fmt(m)}{suffix ?? ' ج'}</ValueBox>
}

// أيقونة إخبارية صغيرة — تعرض شرحًا مطولًا كـ tooltip بدل كتابته في الخلية
function InfoIcon({ title }: { title: string }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13,
      borderRadius: '50%', background: 'var(--inner-bg)', border: '1px solid var(--inner-border)',
      fontSize: 9, fontWeight: 700, color: 'var(--txt-3)', cursor: 'help', marginInlineStart: 4, flexShrink: 0,
    }}>i</span>
  )
}

// نسخة مضغوطة من MetricText — عند نقص البيانات تعرض أيقونة تحذير صغيرة بدل النص المطوّل (يظهر كـ tooltip عند المرور)
function MetricCell({ m, accent, suffix }: { m: Metric; accent?: string; suffix?: string }) {
  if (isMissing(m)) return <span title={m.missing} style={{ cursor: 'help', color: '#f59e0b', fontWeight: 700 }}>⚠</span>
  return <ValueBox color={accent}>{fmt(m)}{suffix ?? ' ج'}</ValueBox>
}

function ChangeBadge({ cur, prev }: { cur: number; prev: number | null | undefined }) {
  if (prev === null || prev === undefined)
    return <span className="text-2xs" style={{ color: 'var(--txt-3)' }}>الشهر السابق غير مُقفل</span>
  const diff = cur - prev
  const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : (cur !== 0 ? 100 : 0)
  const positive = diff >= 0
  return (
    <span className="text-2xs font-bold" style={{ color: positive ? '#22c55e' : '#ef4444' }}>
      {positive ? '▲' : '▼'} {fmt(Math.abs(diff))} ج ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
    </span>
  )
}

interface DiagnosticItem { text: string; blocking: boolean }

function MonthlyCloseReport({ month, shifts, allTxs, empFin, onReload }: {
  month: string; shifts: Shift[]; allTxs: Transaction[];
  empFin: EmployeeFinancials[]; finData: FinancialData | null; onReload: () => Promise<void>;
}) {
  const { user } = useAuth()
  const { show } = useToast()
  const [saved, setSaved] = useState<MonthCloseRow[]>([])
  const [busy,  setBusy]  = useState(false)
  const [fawryMap, setFawryMap] = useState<Record<number, ShiftFawry>>({})
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({})
  const [prevData, setPrevData] = useState<{ totalSales?: number; totalPurchases?: number; totalExpenses?: number; grossProfit?: number; netProfit?: number } | null>(null)
  const [logo, setLogo] = useState(''); const [companyName, setCompanyName] = useState('')
  const [mains, setMains] = useState<MainCategory[]>([])
  const [subs, setSubsList] = useState<SubCategory[]>([])
  const [notes, setNotes] = useState('')

  const [treasury, setTreasury] = useState<{ prevBalance: number; movements: { running: number }[] } | null>(null)
  useEffect(() => {
    call(api.treasury.data(month)).then(setTreasury as (d: unknown) => void).catch(() => setTreasury(null))
  }, [month])

  async function reload() {
    try { setSaved(await call(api.monthlyClose.list()) as MonthCloseRow[]) } catch (e) { console.error(e) }
  }
  useEffect(() => { reload() }, [])

  async function loadAuxData() {
    try {
      const records = await Promise.all(shifts.map(sh => call<ShiftFawry | null>(api.fawry.get(sh.id)).catch(() => null)))
      const fm: Record<number, ShiftFawry> = {}
      shifts.forEach((sh, i) => { const r = records[i]; if (r) fm[sh.id] = r })
      setFawryMap(fm)
    } catch { /* */ }
    try {
      const st = await call(api.settings.getAll()) as { key: string; value: string }[]
      const sm: Record<string, string> = {}
      for (const row of st) sm[row.key] = row.value
      setSettingsMap(sm)
      setLogo(sm['biz.logo'] ?? ''); setCompanyName(sm['biz.name'] ?? '')
    } catch { /* */ }
    try {
      const prev = await call(api.monthlyClose.get(prevMonthKeyOf(month))) as MonthCloseRow | null
      if (prev) { try { setPrevData(JSON.parse(prev.data_json)) } catch { setPrevData(null) } }
      else setPrevData(null)
    } catch { setPrevData(null) }
    try {
      const [m, s] = await Promise.all([call<MainCategory[]>(api.cats.getMain()), call<SubCategory[]>(api.cats.getSub())])
      setMains(m); setSubsList(s)
    } catch { /* */ }
  }
  useEffect(() => {
    loadAuxData().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, shifts])

  // قيم يدوية محفوظة لكل شهر عبر settings (مخزون بضاعة/لحوم + أرصدة فوري الافتتاحية)
  function manualPias(key: string): number { return Number(settingsMap[`${key}.${month}`] ?? 0) }
  function manualEntered(key: string): boolean { return settingsMap[`${key}.${month}`] !== undefined }
  async function saveManual(key: string, egp: string) {
    const val = Math.round((parseFloat(egp) || 0) * 100)
    const fullKey = `${key}.${month}`
    try { await call(api.settings.set(fullKey, String(val))); setSettingsMap(sm => ({ ...sm, [fullKey]: String(val) })) }
    catch (e) { show((e as Error).message, 'error') }
  }

  useEffect(() => { setNotes(settingsMap[`mc.notes.${month}`] ?? '') }, [settingsMap, month])
  async function saveNotes(val: string) {
    setNotes(val)
    try { await call(api.settings.set(`mc.notes.${month}`, val)); setSettingsMap(sm => ({ ...sm, [`mc.notes.${month}`]: val })) }
    catch (e) { show((e as Error).message, 'error') }
  }

  // أول/آخر يوم في الشهر — عرض الفترة فقط (المصدر الحقيقي: شهر الشيفتات المعتمدة)
  const periodStart = `${month}-01`
  const periodEnd = (() => { const d = new Date(`${month}-01T00:00:00`); d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toISOString().slice(0, 10) })()
  const lastApprovedShiftDate = shifts.filter(s => s.status === 'approved').map(s => s.date).sort().slice(-1)[0]

  // ═══ الشهر مُقفَل (مُعتمَد)؟ ═══
  const thisMonthRow = saved.find(r => r.month === month) as (MonthCloseRow & { status?: string }) | undefined
  const isLocked = thisMonthRow?.status === 'approved'

  const D = useMemo(() => {
    const approvedShifts = shifts.filter(s => s.status === 'approved')
    const approvedShiftIds = new Set(approvedShifts.map(s => s.id))
    // قاعدة 1 — الشيفتات المعتمدة فقط تدخل في التجميع
    const tx = allTxs.filter(t => approvedShiftIds.has(t.shiftId))

    const mainByName = (name: string) => mains.find(m => m.name === name)
    const mainById = new Map(mains.map(m => [m.id, m]))
    const subById  = new Map(subs.map(s => [s.id, s]))
    // النوع المحاسبي لبند: الفرعي يطغى على الرئيسي لو محدَّد (قاعدة 2)
    function accType(t: Transaction): string | null {
      if (t.subCategoryId) { const s = subById.get(t.subCategoryId); if (s?.accountingType) return s.accountingType }
      if (t.mainCategoryId) { const m = mainById.get(t.mainCategoryId); if (m?.accountingType) return m.accountingType }
      return null
    }
    function sumByType(type: string, mode: 'out' | 'inout' = 'out'): number {
      return tx.filter(t => accType(t) === type).reduce((a, t) => a + (mode === 'inout' ? t.amountIn + t.amountOut : t.amountOut), 0)
    }
    // عمود ديناميكي: كل التصنيفات الفرعية تحت رئيسي معيّن، مُستبعَدًا الأصفار (قاعدة 2)
    function columnRows(mainName: string, mode: 'out' | 'inout' = 'out'): { label: string; value: number }[] {
      const main = mainByName(mainName)
      if (!main) return []
      return subs.filter(s => s.mainCategoryId === main.id)
        .map(s => ({ label: s.name, value: tx.filter(t => t.subCategoryId === s.id).reduce((a, t) => a + (mode === 'inout' ? t.amountIn + t.amountOut : t.amountOut), 0) }))
        .filter(r => r.value !== 0)
    }

    // ═══ المبيعات — "مبيعات منتجات POS" هو إجمالي المبيعات فعليًا (يشمل الفيزا/الآجل/النقدي/فوري/التوصيل/اللحوم
    // ضمنيًا كما تُقفَل به درج الكاشير) — هذه البنود تُعرض للتفصيل فقط ولا تُضاف فوق POS لتفادي الازدواج.
    // البنود الإضافية الحقيقية غير الداخلة في POS: تطبيقات التوصيل الخارجية، أرباح بيع أصول، إيرادات متنوعة.
    const INFO_ONLY_SALES_SUBS = ['مبيعات فيزا', 'مبيعات آجل', 'مبيعات نقدي', 'مبيعات رصيد فوري', 'مبيعات توصيل', 'مبيعات لحوم']
    const posSales = approvedShifts.reduce((a, s) => a + (s.posSales ?? 0), 0)
    let basicSales = 0, airSales = 0, cashoutAddTotal = 0, cashoutDiscountTotal = 0, fawryCommission = 0
    for (const s of approvedShifts) {
      const f = fawryMap[s.id]
      if (!f) continue
      const r = calcFawry(f)
      basicSales += r.basicSales; airSales += r.airSales
      // معادلة مطابقة لِـ ShiftSheet.tsx (v2.34.5) — الصيغة القديمة (visaSales − cashoutDiff مباشرة)
      // كانت تُنتج قيمًا خاطئة تمامًا عند عجز كاش أوت؛ الصواب: عند العجز تُخصَم "إضافة كاش أوت" الفعلية
      // المرحَّلة فعليًا للأساسي/الإير تايم (لا الفرق الخام)
      const cashoutDiff = r.cashoutSales
      const cashoutDiscountAmt = cashoutDiff < 0 ? -cashoutDiff : 0
      const cashoutAddAmt = cashoutDiff >= 0
        ? cashoutDiff
        : ((f.cashoutToBasic ?? 0) + (f.cashoutToAir ?? 0)) - cashoutDiscountAmt
      cashoutAddTotal += cashoutAddAmt
      cashoutDiscountTotal += cashoutDiscountAmt
      const visaThisShift = tx.filter(t => t.shiftId === s.id && t.subCategoryName === 'مبيعات فيزا').reduce((a, t) => a + t.amountIn + t.amountOut, 0)
      fawryCommission += visaThisShift - cashoutAddAmt
    }
    const fawrySales = basicSales + airSales // ماكينة فوري — تفصيل ضمن POS، لا تُضاف للإجمالي
    const journalSales = sumByType('إيراد', 'inout')
    const infoOnlySalesSum = tx.filter(t => t.subCategoryName && INFO_ONLY_SALES_SUBS.includes(t.subCategoryName))
      .reduce((a, t) => a + t.amountIn + t.amountOut, 0)
    const additionalSales = journalSales - infoOnlySalesSum // تطبيقات/أرباح بيع أصول/إيرادات متنوعة فقط
    const totalSales = posSales + additionalSales
    const visaSales = tx.filter(t => t.subCategoryName === 'مبيعات فيزا').reduce((a, t) => a + t.amountIn + t.amountOut, 0)
    const commissionRatio = visaSales > 0 ? (fawryCommission / visaSales) * 100 : 0

    const salesColumnRows = [
      { label: 'مبيعات منتجات (POS)', value: posSales },
      { label: 'مبيعات فوري (ماكينة) — ضمن POS', value: fawrySales },
      ...columnRows('مبيعات', 'inout').map(r => INFO_ONLY_SALES_SUBS.includes(r.label) ? { ...r, label: `${r.label} — ضمن POS` } : r),
    ].filter(r => r.value !== 0)

    // ═══ المشتريات (مخزون) ═══
    const totalPurchases = sumByType('مخزون')
    const purchasesColumnRows = columnRows('مشتريات')

    // ═══ المصروفات (تشغيلي) ═══
    const totalExpenses = sumByType('مصروف_تشغيلي')
    const expensesColumnRows = columnRows('مصروفات')

    // ═══ المرتجعات (تصحيح إيراد / تصحيح مخزون — على مستوى الفرعي) ═══
    const salesReturnsTotal = sumByType('تصحيح_إيراد')
    const purchaseReturnsTotal = sumByType('تصحيح_مخزون')
    const returnsColumnRows = [...columnRows('مرتجعات')]

    // ═══ الإهلاكات والخسائر ═══
    const totalDepreciation = sumByType('مصروف_غير_نقدي')
    const depreciationRows = columnRows('الاهلاكات')
    const totalLosses = sumByType('خسائر')
    const lossesRows = columnRows('الخسائر')
    const inventoryDiscrepancy = tx.filter(t => t.subCategoryName === 'فروق جرد').reduce((a, t) => a + t.amountOut, 0)

    // ═══ التحصيل — معلوماتي فقط، خارج سلسلة الربح تمامًا (قاعدة 5) ═══
    const totalCollection = sumByType('تسوية_ذمم', 'inout')
    const collectionColumnRows = columnRows('تحصيل', 'inout')

    // ═══ الاستبدالات — مراجعة فقط، صفر أثر مالي (قاعدة 4) ═══
    const exchangesRows = columnRows('استبدالات', 'inout')
    const exchangesTotal = exchangesRows.reduce((a, r) => a + r.value, 0)

    // ═══ تكلفة البضاعة المباعة = أول المدة (يدوي) + المشتريات (تلقائي) − مرتجع مشتريات − آخر المدة (يدوي) — قاعدة 3 و12 ═══
    const invStartEntered = manualEntered('mc.inv.start'), invEndEntered = manualEntered('mc.inv.end')
    const invStart = manualPias('mc.inv.start'), invEnd = manualPias('mc.inv.end')
    const cogs: Metric = (!invStartEntered || !invEndEntered)
      ? { missing: 'أدخل رصيد أول وآخر المدة (بند "الأرصدة" أسفل) لحساب تكلفة البضاعة المباعة' }
      : invStart + totalPurchases - purchaseReturnsTotal - invEnd

    // ═══ مؤشرات الربحية (قاعدة 5) ═══
    const netSales = totalSales - salesReturnsTotal
    const grossProfit: Metric = isMissing(cogs) ? cogs : netSales - metricNum(cogs)
    const grossMarginPct: Metric = isMissing(grossProfit) ? grossProfit : (netSales > 0 ? (metricNum(grossProfit) / netSales) * 100 : 0)
    const netProfit: Metric = isMissing(grossProfit) ? grossProfit : metricNum(grossProfit) - totalExpenses - totalDepreciation - totalLosses
    const netMarginPct: Metric = isMissing(netProfit) ? netProfit : (netSales > 0 ? (metricNum(netProfit) / netSales) * 100 : 0)

    // ═══ الصندوق ═══
    const fundOpening = treasury?.prevBalance ?? 0
    const fundCashIn = approvedShifts.reduce((a, s) => a + (s.cashierRemaining ?? 0), 0)
    const fundExpenses = tx.filter(t => t.payMethod === 'management').reduce((a, t) => a + t.amountIn + t.amountOut, 0)
    const fundClosing = treasury?.movements.length ? treasury.movements[treasury.movements.length - 1].running : fundOpening

    // ═══ المخزون (فوري) ═══
    const basicBalOpen = manualPias('mc.fawryBal.basic'), basicBalClose = basicBalOpen + basicSales
    const airBalOpen = manualPias('mc.fawryBal.air'), airBalClose = airBalOpen + airSales
    const cashoutBalOpen = manualPias('mc.fawryBal.cashout'), cashoutBalClose = cashoutBalOpen + (cashoutAddTotal - cashoutDiscountTotal)
    const meatInvStart = manualPias('mc.meatInv.start'), meatInvEnd = manualPias('mc.meatInv.end')
    const poultryInvStart = manualPias('mc.poultryInv.start'), poultryInvEnd = manualPias('mc.poultryInv.end')
    const cigInvStart = manualPias('mc.cigInv.start'), cigInvEnd = manualPias('mc.cigInv.end')
    const inventoryTable = [
      { label: 'منتجات', start: invStart, end: invEnd, startKey: 'mc.inv.start', endKey: 'mc.inv.end' },
      { label: 'لحوم',   start: meatInvStart, end: meatInvEnd, startKey: 'mc.meatInv.start', endKey: 'mc.meatInv.end' },
      { label: 'دواجن',  start: poultryInvStart, end: poultryInvEnd, startKey: 'mc.poultryInv.start', endKey: 'mc.poultryInv.end' },
      { label: 'سجاير',  start: cigInvStart, end: cigInvEnd, startKey: 'mc.cigInv.start', endKey: 'mc.cigInv.end' },
    ]

    // ═══ تشخيص الشهر (قاعدة 7/8) — 6 بنود دائمة الظهور بحالة ✓/⚠/⛔ ═══
    const uncategorizedCount = tx.filter(t => !t.mainCategoryId).length
    const unapprovedShiftsCount = shifts.length - approvedShifts.length
    const negativeAggregates = totalSales < 0 || totalPurchases < 0 || totalExpenses < 0
    const balancesMissing = !invStartEntered || !invEndEntered
    const diagnostics: DiagnosticItem[] = []
    if (unapprovedShiftsCount > 0) diagnostics.push({ text: `يوجد ${unapprovedShiftsCount} شيفت غير معتمد في هذا الشهر — مُستبعَد من كل الأرقام`, blocking: true })
    if (balancesMissing) diagnostics.push({ text: 'رصيد أول أو آخر المدة غير مُدخَل — لا يمكن حساب تكلفة البضاعة المباعة', blocking: true })
    if (uncategorizedCount > 0) diagnostics.push({ text: `يوجد ${uncategorizedCount} قيد بدون تصنيف`, blocking: true })
    if (inventoryDiscrepancy !== 0) diagnostics.push({ text: `يوجد فروق جرد بقيمة ${fmt(inventoryDiscrepancy)} ج — للمراجعة`, blocking: false })
    if (negativeAggregates) diagnostics.push({ text: 'قيم سالبة غير منطقية في مجاميع أساسية', blocking: false })
    if (approvedShifts.length === 0) diagnostics.push({ text: 'لا توجد شيفتات معتمدة في هذا الشهر بعد', blocking: true })
    // بطاقات التشخيص الست الثابتة (تُعرَض دائمًا بحالتها، مانعة أو تنبيه فقط)
    const diagCards = [
      { key: 'critical',      label: 'الأخطاء الحرجة',        ok: !diagnostics.some(d => d.blocking), detail: diagnostics.find(d => d.blocking)?.text ?? 'لا يوجد', blocking: true },
      { key: 'negatives',     label: 'قيم سالبة غير منطقية',  ok: !negativeAggregates, detail: negativeAggregates ? 'يوجد قيم سالبة' : 'لا يوجد', blocking: false },
      { key: 'inventoryDiff', label: 'فروقات جرد',            ok: inventoryDiscrepancy === 0, detail: inventoryDiscrepancy === 0 ? 'لا يوجد فروق' : `${fmt(inventoryDiscrepancy)} ج`, blocking: false },
      { key: 'balances',      label: 'رصيد أول / آخر المدة',   ok: !balancesMissing, detail: balancesMissing ? 'غير مكتمل' : 'مكتمل', blocking: true },
      { key: 'uncategorized', label: 'قيود بدون تصنيف',       ok: uncategorizedCount === 0, detail: uncategorizedCount === 0 ? 'لا يوجد' : `${uncategorizedCount} قيود`, blocking: true },
      { key: 'unapproved',    label: 'شيفتات غير معتمدة',     ok: unapprovedShiftsCount === 0, detail: unapprovedShiftsCount === 0 ? 'لا يوجد' : `${unapprovedShiftsCount} شيفت`, blocking: true },
    ]

    return {
      shiftsCount: approvedShifts.length, itemsCount: tx.length,
      posSales, fawrySales, journalSales, totalSales, visaSales, commissionRatio,
      salesColumnRows, purchasesColumnRows, expensesColumnRows, returnsColumnRows, collectionColumnRows,
      totalPurchases, totalExpenses, salesReturnsTotal, purchaseReturnsTotal,
      totalDepreciation, depreciationRows, totalLosses, lossesRows, inventoryDiscrepancy,
      totalCollection, exchangesRows, exchangesTotal,
      invStart, invEnd, invStartEntered, invEndEntered, cogs, inventoryTable,
      netSales, grossProfit, grossMarginPct, netProfit, netMarginPct,
      fundOpening, fundExpenses, fundClosing, fundCashIn,
      basicBalOpen, basicBalClose, airBalOpen, airBalClose, cashoutBalOpen, cashoutBalClose,
      meatInvStart, meatInvEnd, cashoutAddTotal, cashoutDiscountTotal, fawryCommission,
      employees: empFin.length, dueSalaries: empFin.reduce((a, f) => a + (f.dueSalary ?? 0), 0),
      diagnostics, diagCards, uncategorizedCount, unapprovedShiftsCount,
      // توافق خلفي بسيط للتقرير السنوي (يقرأ posSales/cashClosing/netProfit)
      cashOpening: fundOpening, cashClosing: fundClosing,
    }
  }, [shifts, allTxs, empFin, fawryMap, settingsMap, month, treasury, mains, subs])

  const canApprove = !D.diagnostics.some(d => d.blocking)
  // عرض الأرقام المجمَّدة (Snapshot) لو الشهر مُعتمَد، وإلا الحساب الحيّ
  const view: typeof D = isLocked && thisMonthRow ? (() => { try { return JSON.parse(thisMonthRow.data_json) } catch { return D } })() : D

  async function approveMonth() {
    if (!user) return
    if (!canApprove) { show('لا يمكن اعتماد الشهر — يوجد أخطاء مانعة في لوحة التشخيص', 'error'); return }
    setBusy(true)
    try {
      await call(api.monthlyClose.approve(month, JSON.stringify(D), user.id))
      show('تم اعتماد تقفيل شهر ' + month + ' — الأرقام مُجمَّدة الآن', 'success')
      await reload()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setBusy(false) }
  }
  async function unapproveMonth() {
    if (!user) return
    setBusy(true)
    try {
      await call(api.monthlyClose.unapprove(month, user.id))
      show('تم فك اعتماد الشهر — يمكن الآن تعديل القيود وإعادة الاحتساب', 'success')
      await reload()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setBusy(false) }
  }
  async function recalculate() {
    await loadAuxData()
    show('تم إعادة الاحتساب', 'success')
  }

  // اعتماد جماعي لكل الشيفتات غير المعتمدة بالشهر (مثلاً بعد استيراد إكسل) — تدخل الشيفتات المستوردة بحالة "مراجعة"
  // ولا تظهر في أرقام التقرير إلا بعد الاعتماد (قاعدة 1)، فبدل اعتماد كل شيفت يدويًا نوفّر زرًا جماعيًا هنا
  async function approvePendingShifts() {
    if (!user) return
    const pending = shifts.filter(s => s.status !== 'approved')
    if (!pending.length) return
    if (!confirm(`اعتماد ${pending.length} شيفت غير معتمد في هذا الشهر؟`)) return
    setBusy(true)
    try {
      for (const s of pending) await call(api.shifts.updateStatus(s.id, 'approved', user.id))
      show(`تم اعتماد ${pending.length} شيفت`, 'success')
      await onReload()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setBusy(false) }
  }

  async function exportExcel() {
    try {
      const rows: [string, string][] = [
        ['— المبيعات —', ''],
        ...view.salesColumnRows.map((r: { label: string; value: number }): [string, string] => [r.label, fmt(r.value) + ' ج']),
        ['إجمالي المبيعات', fmt(view.totalSales) + ' ج'],
        ['— المشتريات —', ''],
        ...view.purchasesColumnRows.map((r: { label: string; value: number }): [string, string] => [r.label, fmt(r.value) + ' ج']),
        ['إجمالي المشتريات', fmt(view.totalPurchases) + ' ج'],
        ['— المصروفات —', ''],
        ...view.expensesColumnRows.map((r: { label: string; value: number }): [string, string] => [r.label, fmt(r.value) + ' ج']),
        ['إجمالي المصروفات', fmt(view.totalExpenses) + ' ج'],
        ['— المرتجعات —', ''],
        ...view.returnsColumnRows.map((r: { label: string; value: number }): [string, string] => [r.label, fmt(r.value) + ' ج']),
        ['إجمالي المرتجعات', fmt(view.salesReturnsTotal + view.purchaseReturnsTotal) + ' ج'],
        ['— التحصيل (معلوماتي) —', ''],
        ...view.collectionColumnRows.map((r: { label: string; value: number }): [string, string] => [r.label, fmt(r.value) + ' ج']),
        ['إجمالي التحصيل', fmt(view.totalCollection) + ' ج'],
        ['— تكلفة البضاعة المباعة —', ''],
        ['رصيد أول المدة', view.invStartEntered ? fmt(view.invStart) + ' ج' : 'غير مُدخَل'],
        ['+ إجمالي المشتريات', fmt(view.totalPurchases) + ' ج'],
        ['− مرتجع مشتريات', fmt(view.purchaseReturnsTotal) + ' ج'],
        ['− رصيد آخر المدة', view.invEndEntered ? fmt(view.invEnd) + ' ج' : 'غير مُدخَل'],
        ['= تكلفة البضاعة المباعة', isMissing(view.cogs) ? 'بيانات ناقصة' : fmt(metricNum(view.cogs)) + ' ج'],
        ['— مؤشرات الربحية —', ''],
        ['صافي المبيعات', fmt(view.netSales) + ' ج'],
        ['مجمل الربح', isMissing(view.grossProfit) ? 'بيانات ناقصة' : fmt(metricNum(view.grossProfit)) + ' ج'],
        ['هامش الربح الإجمالي', isMissing(view.grossMarginPct) ? '—' : metricNum(view.grossMarginPct).toFixed(2) + '%'],
        ['صافي الربح', isMissing(view.netProfit) ? 'بيانات ناقصة' : fmt(metricNum(view.netProfit)) + ' ج'],
        ['صافي هامش الربح', isMissing(view.netMarginPct) ? '—' : metricNum(view.netMarginPct).toFixed(2) + '%'],
        ['— الإهلاكات —', ''],
        ...view.depreciationRows.map((r: { label: string; value: number }): [string, string] => [r.label, fmt(r.value) + ' ج']),
        ['إجمالي الإهلاكات', fmt(view.totalDepreciation) + ' ج'],
        ['— الخسائر —', ''],
        ...view.lossesRows.map((r: { label: string; value: number }): [string, string] => [r.label, fmt(r.value) + ' ج']),
        ['إجمالي الخسائر', fmt(view.totalLosses) + ' ج'],
        ['— الاستبدالات (للمراجعة فقط) —', ''],
        ...view.exchangesRows.map((r: { label: string; value: number }): [string, string] => [r.label, fmt(r.value) + ' ج']),
        ['إجمالي الاستبدالات', fmt(view.exchangesTotal) + ' ج'],
        ['— الصندوق —', ''],
        ['رصيد أول الفترة', fmt(view.fundOpening) + ' ج'], ['إجمالي الوارد', fmt(view.fundCashIn) + ' ج'],
        ['إجمالي المنصرف', fmt(view.fundExpenses) + ' ج'], ['رصيد آخر الفترة', fmt(view.fundClosing) + ' ج'],
        ['— الأرصدة (المخزون) —', ''],
        ...view.inventoryTable.flatMap((r: { label: string; start: number; end: number }): [string, string][] => [
          [`${r.label} — أول المدة`, fmt(r.start) + ' ج'], [`${r.label} — آخر المدة`, fmt(r.end) + ' ج'], [`${r.label} — الفرق`, fmt(r.end - r.start) + ' ج'],
        ]),
      ]
      const r = await call<{ canceled: boolean; path?: string }>(api.excel.exportMonthlyClose(month, rows))
      if (!r.canceled) show('تم تصدير التقرير إلى Excel', 'success')
    } catch (e) { show((e as Error).message, 'error') }
  }

  async function exportClosePDF(monthStr: string, data: typeof D) {
    try {
      const rows: [string, string][] = [
        ['— الإجماليات —', ''],
        ['إجمالي المبيعات', fmt(data.totalSales) + ' ج'], ['إجمالي المشتريات', fmt(data.totalPurchases) + ' ج'],
        ['تكلفة البضاعة المباعة', isMissing(data.cogs) ? 'بيانات ناقصة' : fmt(metricNum(data.cogs)) + ' ج'],
        ['مجمل الربح', isMissing(data.grossProfit) ? 'بيانات ناقصة' : fmt(metricNum(data.grossProfit)) + ' ج'],
        ['إجمالي المصروفات', fmt(data.totalExpenses) + ' ج'],
        ['صافي الربح', isMissing(data.netProfit) ? 'بيانات ناقصة' : fmt(metricNum(data.netProfit)) + ' ج'],
        ['إجمالي التحصيل', fmt(data.totalCollection) + ' ج'], ['إجمالي المرتجعات', fmt(data.salesReturnsTotal + data.purchaseReturnsTotal) + ' ج'],
        ['إجمالي الإهلاكات', fmt(data.totalDepreciation) + ' ج'], ['إجمالي الخسائر', fmt(data.totalLosses) + ' ج'],
        ['— الصندوق —', ''],
        ['رصيد سابق', fmt(data.fundOpening) + ' ج'], ['مصروفات', fmt(data.fundExpenses) + ' ج'], ['رصيد اخر', fmt(data.fundClosing) + ' ج'],
      ]
      const logoHtml = logo
        ? '<div style="width:48px;height:48px;background:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;"><img src="' + logo + '" style="max-width:100%;max-height:100%;object-fit:contain;"/></div>'
        : ''
      const html = '<div id="mc-pdf" style="font-family:\'IBM Plex Sans Arabic\',Arial,sans-serif;direction:rtl;padding:28px 32px;width:794px;background:#fff;color:#0f172a;">'
        + '<div style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;padding:20px 24px;border-radius:12px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">'
        + '<div style="display:flex;align-items:center;gap:12px;">' + logoHtml + '<div><div style="font-size:22px;font-weight:900;">تقرير التقفيل الشهري</div><div style="font-size:13px;opacity:.9;margin-top:4px;">' + (companyName || 'AJ Smart Shift Hyper') + ' · شهر ' + monthStr + '</div></div></div>'
        + '<div style="font-size:11px;opacity:.85;">' + new Date().toLocaleDateString('ar-EG') + '</div></div>'
        + '<table style="width:100%;font-size:13px;border-collapse:collapse;border:1px solid #cbd5e1;"><tbody>'
        + rows.map((r, i) => r[1] === ''
          ? '<tr style="background:#fef9c3;"><td colspan="2" style="padding:7px 12px;border:1px solid #e2e8f0;color:#854d0e;font-weight:800;text-align:center;">' + r[0] + '</td></tr>'
          : '<tr style="background:' + (i % 2 === 0 ? '#f8fafc' : '#fff') + ';">'
          + '<td style="padding:9px 12px;border:1px solid #e2e8f0;color:#475569;font-weight:600;width:55%;">' + r[0] + '</td>'
          + '<td style="padding:9px 12px;border:1px solid #e2e8f0;font-weight:800;color:#1e3a8a;">' + r[1] + '</td></tr>').join('')
        + '</tbody></table>'
        + '<div style="margin-top:14px;font-size:10px;color:#64748b;display:flex;justify-content:space-between;"><span>AJ Smart Shift Hyper v${APP_VERSION}</span><span>تطوير: أحمد جلال #1637</span></div></div>'
      const container = document.createElement('div')
      container.style.position = 'fixed'; container.style.left = '-9999px'; container.style.top = '0'
      container.innerHTML = html
      document.body.appendChild(container)
      const html2canvas = (await import('html2canvas')).default
      const { default: jsPDF } = await import('jspdf')
      const canvas = await html2canvas(container.querySelector('#mc-pdf') as HTMLElement, { scale: 1.5, backgroundColor: '#fff' })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
      const imgW = 194, imgH = (canvas.height * imgW) / canvas.width
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 8, 8, imgW, imgH)
      pdf.save('تقفيل-شهري-' + monthStr + '.pdf')
      document.body.removeChild(container)
    } catch (e) { console.error(e) }
  }

  function InvCell({ settingKey, value, disabled, onSave }: { settingKey: string; value: number; disabled?: boolean; onSave: (key: string, egp: string) => void }) {
    const [v, setV] = useState(String(value / 100))
    useEffect(() => { setV(String(value / 100)) }, [value])
    return (
      <input value={v} onChange={e => setV(e.target.value)} onBlur={() => onSave(settingKey, v)} disabled={disabled}
        className="tabular-nums font-bold text-left w-full" style={{
          background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.35)', minWidth: 0, boxSizing: 'border-box',
          borderRadius: 5, padding: '2px 4px', color: '#3b82f6', fontSize: 10.5, outline: 'none', opacity: disabled ? 0.5 : 1,
        }} />
    )
  }
  function EditableLine({ label, settingKey }: { label: string; settingKey: string }) {
    const val = manualPias(settingKey)
    const [v, setV] = useState(String(val / 100))
    useEffect(() => { setV(String(val / 100)) }, [val])
    return (
      <tr className="tr">
        <td className="td" style={{ ...compactTd, color: '#3b82f6' }}>✎ {label}</td>
        <td className="td text-left" style={compactTd}>
          <input value={v} onChange={e => setV(e.target.value)} onBlur={() => saveManual(settingKey, v)} disabled={isLocked}
            className="tabular-nums font-bold text-left w-24" style={{
              background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.35)',
              borderRadius: 6, padding: '2px 6px', color: '#3b82f6', fontSize: 11, outline: 'none', opacity: isLocked ? 0.5 : 1,
            }} />
        </td>
      </tr>
    )
  }

  // توحيد ألوان التقفيل الشهري: أزرق أساسي (#3b82f6) لكل العناوين/الحدود/الخلفيات، وذهبي (#d4a017) لتمييز الأرقام/الإجماليات المهمة
  // — باستثناء الأخضر/الأحمر المحاسبي القياسي (موجب/سالب، زيادة/نقصان، حالات التشخيص) اللي يفضل كما هو
  const PRIMARY = '#3b82f6'
  const ACCENT = '#d4a017'
  const CARD_ROW_H = 96 // ارتفاع موحّد لصفّي بطاقات التشخيص ومؤشرات KPI
  const CARD5_H = 399 // ارتفاع موحّد (300 الأساسي + 3 زيادات 10%) — كل الأقسام أسفل بطاقات KPI تاخذ نفس القيمة بالحرف
  // رأس قسم موحّد لكل بطاقات/أعمدة التقرير — نفس الخلفية والحدود والأيقونة المنفصلة في كل مكان
  function SectionHeader({ icon, title }: { icon: string; title: string }) {
    return (
      <div className="px-3 py-2 flex items-center gap-1.5" style={{ background: PRIMARY + '12', borderBottom: '1px solid var(--inner-border)' }}>
        <span>{icon}</span><span className="font-bold text-xs" style={{ color: PRIMARY }}>{title}</span>
      </div>
    )
  }
  const TOOLBAR_BTN: React.CSSProperties = {
    fontSize: 12, padding: '8px 14px',
    background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
    boxShadow: '0 2px 10px rgba(20,184,166,0.28)',
  }
  const cards = [
    { label: 'إجمالي المبيعات', value: fmt(view.totalSales) + ' ج', color: PRIMARY, valueColor: ACCENT, cmp: <ChangeBadge cur={view.totalSales} prev={prevData?.totalSales} /> },
    { label: 'إجمالي المشتريات', value: fmt(view.totalPurchases) + ' ج', color: PRIMARY, valueColor: ACCENT, cmp: <ChangeBadge cur={view.totalPurchases} prev={prevData?.totalPurchases} /> },
    { label: 'إجمالي المصروفات', value: fmt(view.totalExpenses) + ' ج', color: PRIMARY, valueColor: ACCENT, cmp: <ChangeBadge cur={view.totalExpenses} prev={prevData?.totalExpenses} /> },
    { label: 'مجمل الربح', value: isMissing(view.grossProfit) ? '—' : fmt(metricNum(view.grossProfit)) + ' ج', color: PRIMARY, valueColor: ACCENT, cmp: isMissing(view.grossProfit) ? undefined : <ChangeBadge cur={metricNum(view.grossProfit)} prev={prevData?.grossProfit} /> },
    { label: 'صافي الربح', value: isMissing(view.netProfit) ? '—' : fmt(metricNum(view.netProfit)) + ' ج', color: PRIMARY, valueColor: metricNum(isMissing(view.netProfit) ? 0 : view.netProfit) >= 0 ? '#22c55e' : '#ef4444', cmp: isMissing(view.netProfit) ? undefined : <ChangeBadge cur={metricNum(view.netProfit)} prev={prevData?.netProfit} /> },
    { label: 'هامش الربح', value: isMissing(view.netMarginPct) ? '—' : metricNum(view.netMarginPct).toFixed(2) + '%', color: PRIMARY, valueColor: ACCENT, sub: 'من صافي المبيعات' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => exportClosePDF(month, view)} className="btn-next" style={TOOLBAR_BTN}>
            <Icons.Download size={13} /> تصدير PDF
          </button>
          <button onClick={exportExcel} className="btn-next" style={TOOLBAR_BTN}>
            <Icons.Download size={13} /> تصدير Excel
          </button>
          <button onClick={() => window.print()} className="btn-next" style={TOOLBAR_BTN}>
            <Icons.Records size={13} /> طباعة
          </button>
          {!isLocked && (
            <button onClick={recalculate} className="btn-next" style={TOOLBAR_BTN}>
              <Icons.Refresh size={13} /> إعادة احتساب
            </button>
          )}
        </div>
        <div className="text-left">
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--txt-1)' }}>تقرير التقفيل الشهري {month.split('-')[1]}-{month.split('-')[0]}</div>
          <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>تقارير شهرية • البيانات من الشيفتات المعتمدة فقط</div>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap text-xs" style={{ color: 'var(--txt-2)' }}>
        <div>
          <div style={{ color: 'var(--txt-3)', fontSize: 10.5 }}>آخر شيفت معتمد</div>
          <div className="font-bold" style={{ color: 'var(--txt-1)' }}>{lastApprovedShiftDate ? fmtDate(lastApprovedShiftDate) : '—'}</div>
        </div>
        <div>
          <div style={{ color: 'var(--txt-3)', fontSize: 10.5 }}>حالة التقفيل</div>
          <span className="text-2xs px-2 py-0.5 rounded-md font-bold" style={{ background: isLocked ? 'rgba(34,197,94,0.15)' : canApprove ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: isLocked ? '#22c55e' : canApprove ? '#22c55e' : '#ef4444' }}>
            {isLocked ? '🔒 معتمد' : canApprove ? '✓ جاهز للاعتماد' : '✕ يوجد أخطاء مانعة'}
          </span>
        </div>
        <div>
          <div style={{ color: 'var(--txt-3)', fontSize: 10.5 }}>الفترة</div>
          <div className="font-bold tabular-nums" style={{ color: 'var(--txt-1)' }}>{fmtDate(periodStart)} إلى {fmtDate(periodEnd)}</div>
        </div>
      </div>

      {/* لوحة تشخيص الشهر — 6 بطاقات ثابتة الظهور (قاعدة 7/8) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {D.diagCards.map(c => (
          <div key={c.key} className="rounded-xl p-2.5" style={{ background: c.ok ? 'rgba(34,197,94,0.08)' : c.blocking ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)', border: `1px solid ${c.ok ? 'rgba(34,197,94,0.3)' : c.blocking ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`, minHeight: CARD_ROW_H, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="text-2xs font-bold mb-1" style={{ color: 'var(--txt-2)' }}>{c.label}</div>
            <div className="flex items-center gap-1 text-xs font-bold" style={{ color: c.ok ? '#22c55e' : c.blocking ? '#ef4444' : '#f59e0b' }}>
              <span>{c.ok ? '✓' : c.blocking ? '⛔' : '⚠'}</span><span>{c.detail}</span>
            </div>
          </div>
        ))}
      </div>

      {!isLocked && D.unapprovedShiftsCount > 0 && (
        <div className="rounded-xl p-3 flex items-center justify-between gap-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <div className="text-xs" style={{ color: 'var(--txt-2)' }}>
            يوجد <b>{D.unapprovedShiftsCount}</b> شيفت غير معتمد في هذا الشهر (غالبًا مستورَد من إكسل بحالة "مراجعة") — لن يدخل في أي رقم بالتقرير حتى يُعتمَد.
          </div>
          <button onClick={approvePendingShifts} disabled={busy} className="btn-danger-pro" style={{ fontSize: 12, padding: '8px 16px', whiteSpace: 'nowrap' }}>
            {busy ? 'جارٍ الاعتماد...' : `🔒 اعتماد كل الشيفتات المعلّقة (${D.unapprovedShiftsCount})`}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(c => (
          <div key={c.label} className="rounded-2xl p-4" style={{ background: c.color + '12', border: '1px solid ' + c.color + '40', minHeight: CARD_ROW_H, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="text-2xs mb-1 font-bold" style={{ color: c.color }}>{c.label}</div>
            <div className="tabular-nums font-bold" style={{ fontSize: 17, color: c.valueColor }}>{c.value}</div>
            {c.sub && <div className="text-2xs" style={{ color: 'var(--txt-3)' }}>{c.sub}</div>}
            {c.cmp && <div className="mt-1">{c.cmp}</div>}
          </div>
        ))}
      </div>

      {/* أعمدة المبيعات/المشتريات/المصروفات/مؤشرات الربحية/التحصيل — تجميع ديناميكي حسب التصنيفات (قاعدة 2)
          مؤشرات الربحية اتنقلت هنا مكان المرتجعات (بناءً على طلب تبديل الأماكن) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          { title: 'المبيعات', icon: '🛒', rows: view.salesColumnRows, total: view.totalSales },
          { title: 'المشتريات', icon: '📦', rows: view.purchasesColumnRows, total: view.totalPurchases },
          { title: 'المصروفات', icon: '📄', rows: view.expensesColumnRows, total: view.totalExpenses },
        ].map(col => (
          <div key={col.title} className="card p-0 overflow-hidden">
            <SectionHeader icon={col.icon} title={col.title} />
            <table className="w-full text-2xs">
              <tbody>
                {col.rows.length === 0 && <tr><td className="td text-center" style={{ color: 'var(--txt-3)', border: '1px solid var(--inner-border)' }} colSpan={2}>لا توجد بنود</td></tr>}
                {col.rows.map(r => (
                  <tr key={r.label} className="tr">
                    <td className="td" style={compactTd}>{r.label}</td>
                    <td className="td text-left" style={compactTd}><ValueBox>{fmt(r.value)}</ValueBox></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ borderTop: `2px solid ${ACCENT}40`, background: ACCENT + '0d' }}>
                <td className="td font-bold" style={{ ...compactTd, color: ACCENT }}>الإجمالي</td>
                <td className="td text-left" style={compactTd}><ValueBox color={ACCENT}>{fmt(col.total)}</ValueBox></td>
              </tr></tfoot>
            </table>
          </div>
        ))}

        {/* التحصيل — انتقل هنا مكان مؤشرات الربحية */}
        {(() => { const col = { title: 'التحصيل', icon: '💳', rows: view.collectionColumnRows, total: view.totalCollection }; return (
          <div key={col.title} className="card p-0 overflow-hidden" style={{ height: CARD5_H, display: 'flex', flexDirection: 'column' }}>
            <SectionHeader icon={col.icon} title={col.title} />
            <div style={{ flex: 1, overflowY: 'auto' }}>
            <table className="w-full text-2xs">
              <tbody>
                {col.rows.length === 0 && <tr><td className="td text-center" style={{ color: 'var(--txt-3)', border: '1px solid var(--inner-border)' }} colSpan={2}>لا توجد بنود</td></tr>}
                {col.rows.map(r => (
                  <tr key={r.label} className="tr">
                    <td className="td" style={compactTd}>{r.label}</td>
                    <td className="td text-left" style={compactTd}><ValueBox>{fmt(r.value)}</ValueBox></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ borderTop: `2px solid ${ACCENT}40`, background: ACCENT + '0d' }}>
                <td className="td font-bold" style={{ ...compactTd, color: ACCENT }}>الإجمالي</td>
                <td className="td text-left" style={compactTd}><ValueBox color={ACCENT}>{fmt(col.total)}</ValueBox></td>
              </tr></tfoot>
            </table>
            </div>
          </div>
        ) })()}

        {/* المرتجعات — انتقلت هنا يسار التحصيل */}
        {(() => { const col = { title: 'المرتجعات', icon: '↩️', rows: view.returnsColumnRows, total: view.salesReturnsTotal + view.purchaseReturnsTotal }; return (
          <div className="card p-0 overflow-hidden" style={{ height: CARD5_H, display: 'flex', flexDirection: 'column' }}>
            <SectionHeader icon={col.icon} title={col.title} />
            <div style={{ flex: 1, overflowY: 'auto' }}>
            <table className="w-full text-2xs">
              <tbody>
                {col.rows.length === 0 && <tr><td className="td text-center" style={{ color: 'var(--txt-3)', border: '1px solid var(--inner-border)' }} colSpan={2}>لا توجد بنود</td></tr>}
                {col.rows.map(r => (
                  <tr key={r.label} className="tr">
                    <td className="td" style={compactTd}>{r.label}</td>
                    <td className="td text-left" style={compactTd}><ValueBox>{fmt(r.value)}</ValueBox></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ borderTop: `2px solid ${ACCENT}40`, background: ACCENT + '0d' }}>
                <td className="td font-bold" style={{ ...compactTd, color: ACCENT }}>الإجمالي</td>
                <td className="td text-left" style={compactTd}><ValueBox color={ACCENT}>{fmt(col.total)}</ValueBox></td>
              </tr></tfoot>
            </table>
            </div>
          </div>
        ) })()}
      </div>

      {/* الإهلاكات، ثم الصندوق — المرتجعات اتنقلت لصف المبيعات فوق، فمكانها هنا فاضي */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        <div className="card p-0 overflow-hidden" style={{ height: CARD5_H, display: 'flex', flexDirection: 'column' }}>
          <SectionHeader icon="📉" title="الإهلاكات" />
          <div style={{ flex: 1, overflowY: 'auto' }}>
          <table className="w-full"><tbody>
            {view.depreciationRows.length === 0 && <tr><td className="td text-center" style={{ color: 'var(--txt-3)', border: '1px solid var(--inner-border)' }} colSpan={2}>لا توجد بنود</td></tr>}
            {view.depreciationRows.map((r: { label: string; value: number }) => (
              <tr key={r.label} className="tr"><td className="td" style={compactTd}>{r.label}</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(r.value)}</ValueBox></td></tr>
            ))}
          </tbody><tfoot><tr style={{ borderTop: `2px solid ${ACCENT}40`, background: ACCENT + '0d' }}><td className="td font-bold" style={{ ...compactTd, color: ACCENT }}>الإجمالي</td><td className="td text-left" style={compactTd}><ValueBox color={ACCENT}>{fmt(view.totalDepreciation)}</ValueBox></td></tr></tfoot></table>
          </div>
        </div>

        {/* الصندوق */}
        <div className="card p-0 overflow-hidden" style={{ height: CARD5_H, display: 'flex', flexDirection: 'column' }}>
          <SectionHeader icon="💰" title="الصندوق" />
          <div style={{ flex: 1, overflowY: 'auto' }}>
          <table className="w-full"><tbody>
            <tr className="tr"><td className="td" style={compactTd}>رصيد أول الفترة</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(view.fundOpening)} ج</ValueBox></td></tr>
            <tr className="tr"><td className="td" style={compactTd}>إجمالي الوارد</td><td className="td text-left" style={compactTd}><ValueBox color="#22c55e">{fmt(view.fundCashIn)} ج</ValueBox></td></tr>
            <tr className="tr"><td className="td" style={compactTd}>إجمالي المنصرف</td><td className="td text-left" style={compactTd}><ValueBox color="#ef4444">{fmt(view.fundExpenses)} ج</ValueBox></td></tr>
            <tr className="tr" style={{ borderTop: '1px solid var(--inner-border)' }}><td className="td font-bold" style={compactTd}>رصيد آخر الفترة</td><td className="td text-left" style={compactTd}><ValueBox color="#22c55e">{fmt(view.fundClosing)} ج</ValueBox></td></tr>
          </tbody></table>
          </div>
        </div>

        {/* أرصدة فوري — انتقلت هنا لتملأ الفراغ في نفس الصف، وتاخد تلقائيًا نفس ارتفاع الصندوق (grid stretch) */}
        <div className="card p-0 overflow-hidden" style={{ height: CARD5_H, display: 'flex', flexDirection: 'column' }}>
          <SectionHeader icon="📱" title="أرصدة فوري" />
          <div style={{ flex: 1, overflowY: 'auto' }}>
          <table className="w-full"><tbody>
            <EditableLine label="رصيد اول اساسي" settingKey="mc.fawryBal.basic" />
            <tr className="tr"><td className="td" style={compactTd}>رصيد اخر اساسي</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(view.basicBalClose)} ج</ValueBox></td></tr>
            <EditableLine label="رصيد اول ايرتايم" settingKey="mc.fawryBal.air" />
            <tr className="tr"><td className="td" style={compactTd}>رصيد اخر ايرتايم</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(view.airBalClose)} ج</ValueBox></td></tr>
            <EditableLine label="رصيد اول كاش اوت" settingKey="mc.fawryBal.cashout" />
            <tr className="tr"><td className="td" style={compactTd}>رصيد اخر كاش اوت</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(view.cashoutBalClose)} ج</ValueBox></td></tr>
          </tbody></table>
          </div>
        </div>

        {/* الأرصدة (المخزون) — نفس الفكرة، انتقلت هنا وتاخد نفس ارتفاع الصندوق تلقائيًا */}
        <div className="card p-0 overflow-hidden" style={{ height: CARD5_H, display: 'flex', flexDirection: 'column' }}>
          <SectionHeader icon="📊" title="الأرصدة (المخزون)" />
          <div style={{ flex: 1, overflowY: 'auto' }}>
          <table className="w-full" style={{ tableLayout: 'fixed' }}>
            <thead><tr><th className="th" style={compactTh}>الصنف</th><th className="th text-left" style={compactTh}>أول</th><th className="th text-left" style={compactTh}>آخر</th><th className="th text-left" style={compactTh}>الفرق</th></tr></thead>
            <tbody>
              {view.inventoryTable.map((row: { label: string; start: number; end: number; startKey: string; endKey: string }) => {
                const diff = row.end - row.start
                return (
                  <tr key={row.label} className="tr">
                    <td className="td font-bold" style={compactTd}>{row.label}</td>
                    <td className="td text-left" style={compactTd}><InvCell settingKey={row.startKey} value={row.start} disabled={isLocked} onSave={saveManual} /></td>
                    <td className="td text-left" style={compactTd}><InvCell settingKey={row.endKey} value={row.end} disabled={isLocked} onSave={saveManual} /></td>
                    <td className="td text-left" style={compactTd}><ValueBox fit color={diff >= 0 ? '#22c55e' : '#ef4444'}>{diff >= 0 ? '+' : ''}{fmt(diff)}</ValueBox></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot><tr style={{ borderTop: '2px solid var(--inner-border)' }}>
              <td className="td font-bold" style={compactTd}>الإجمالي</td>
              <td className="td text-left" style={compactTd}><ValueBox fit color={ACCENT}>{fmt(view.inventoryTable.reduce((a: number, r: { start: number }) => a + r.start, 0))}</ValueBox></td>
              <td className="td text-left" style={compactTd}><ValueBox fit color={ACCENT}>{fmt(view.inventoryTable.reduce((a: number, r: { end: number }) => a + r.end, 0))}</ValueBox></td>
              <td className="td text-left" style={compactTd}><ValueBox fit color={ACCENT}>{fmt(view.inventoryTable.reduce((a: number, r: { start: number; end: number }) => a + (r.end - r.start), 0))}</ValueBox></td>
            </tr></tfoot>
          </table>
          </div>
        </div>

        {/* تكلفة البضاعة المباعة — انتقلت هنا يسار الأرصدة (المخزون) */}
        <div className="card p-0 overflow-hidden" style={{ height: CARD5_H, display: 'flex', flexDirection: 'column' }}>
          <SectionHeader icon="📦" title="تكلفة البضاعة المباعة" />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table className="w-full"><tbody>
              <tr className="tr"><td className="td" style={compactTd}>رصيد أول المدة (يدوي)</td><td className="td text-left" style={compactTd}><ValueBox>{view.invStartEntered ? fmt(view.invStart) : '—'}</ValueBox></td></tr>
              <tr className="tr"><td className="td" style={compactTd}>+ إجمالي المشتريات (تلقائي)</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(view.totalPurchases)}</ValueBox></td></tr>
              <tr className="tr"><td className="td" style={compactTd}>− مرتجع مشتريات</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(view.purchaseReturnsTotal)}</ValueBox></td></tr>
              <tr className="tr"><td className="td" style={compactTd}>− رصيد آخر المدة (يدوي)</td><td className="td text-left" style={compactTd}><ValueBox>{view.invEndEntered ? fmt(view.invEnd) : '—'}</ValueBox></td></tr>
            </tbody></table>
          </div>
          <div className="px-3 pb-2 pt-2 flex items-center gap-2" style={{ borderTop: '1px solid var(--inner-border)' }}>
            <span className="font-bold text-2xs" style={{ color: 'var(--txt-1)' }}>= تكلفة البضاعة:</span>
            <MetricText m={view.cogs} accent={ACCENT} />
          </div>
        </div>
      </div>

      {/* الاستبدالات/الخسائر/مقارنة الشهر السابق/مؤشرات الربحية — تكلفة البضاعة اتنقلت لصف الأرصدة، فمكانها هنا فاضي */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {/* الاستبدالات — مراجعة فقط، صفر أثر على المبيعات/الربح/الهامش (قاعدة 4) */}
        <div className="card p-0 overflow-hidden" style={{ height: CARD5_H, display: 'flex', flexDirection: 'column' }}>
          <SectionHeader icon="🎟️" title="الاستبدالات — للمراجعة فقط" />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table className="w-full">
              <tbody>
                {view.exchangesRows.length === 0 && <tr><td className="td text-center" style={{ color: 'var(--txt-3)', border: '1px solid var(--inner-border)' }} colSpan={2}>لا توجد بنود</td></tr>}
                {view.exchangesRows.map((r: { label: string; value: number }) => (
                  <tr key={r.label} className="tr"><td className="td" style={compactTd}>{r.label}</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(r.value)}</ValueBox></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* الخسائر */}
        <div className="card p-0 overflow-hidden" style={{ height: CARD5_H, display: 'flex', flexDirection: 'column' }}>
          <SectionHeader icon="📛" title="الخسائر" />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table className="w-full"><tbody>
              {view.lossesRows.length === 0 && <tr><td className="td text-center" style={{ color: 'var(--txt-3)', border: '1px solid var(--inner-border)' }} colSpan={2}>لا توجد بنود</td></tr>}
              {view.lossesRows.map((r: { label: string; value: number }) => (
                <tr key={r.label} className="tr"><td className="td" style={compactTd}>{r.label}</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(r.value)}</ValueBox></td></tr>
              ))}
            </tbody></table>
          </div>
          <div style={{ borderTop: `2px solid ${ACCENT}40`, background: ACCENT + '0d', display: 'flex', justifyContent: 'space-between', ...compactTd }}>
            <span className="font-bold" style={{ color: ACCENT }}>الإجمالي</span>
            <ValueBox color={ACCENT}>{fmt(view.totalLosses)}</ValueBox>
          </div>
        </div>


        {/* مؤشرات الربحية — انتقلت يمين مقارنة الشهر السابق */}
        <div className="card p-0 overflow-hidden" style={{ height: CARD5_H, display: 'flex', flexDirection: 'column' }}>
          <SectionHeader icon="📈" title="مؤشرات الربحية" />
          <div style={{ flex: 1, overflowY: 'auto' }}>
          <table className="w-full" style={{ fontSize: 10.5, tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: '64%' }} /><col style={{ width: '36%' }} /></colgroup>
            <tbody>
              <tr className="tr"><td className="td" style={compactTd}>إجمالي المبيعات</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(view.totalSales)} ج</ValueBox></td></tr>
              <tr className="tr"><td className="td" style={compactTd}>− إجمالي المرتجعات (مبيعات)</td><td className="td text-left" style={compactTd}><ValueBox color="#ef4444">{fmt(view.salesReturnsTotal)} ج</ValueBox></td></tr>
              <tr className="tr" style={{ borderTop: '1px solid var(--inner-border)' }}><td className="td font-bold" style={compactTd}>= صافي المبيعات</td><td className="td text-left" style={compactTd}><ValueBox>{fmt(view.netSales)} ج</ValueBox></td></tr>
              <tr className="tr"><td className="td" style={compactTd}>− تكلفة البضاعة المباعة <InfoIcon title="يحتاج إدخال رصيد أول وآخر المدة (بند «الأرصدة» أسفل) لحساب تكلفة البضاعة المباعة" /></td><td className="td text-left" style={compactTd}><MetricCell m={typeof view.cogs === 'number' ? -view.cogs : view.cogs} accent="#ef4444" /></td></tr>
              <tr className="tr" style={{ borderTop: '1px solid var(--inner-border)' }}><td className="td font-bold" style={compactTd}>= مجمل الربح</td><td className="td text-left" style={compactTd}><MetricCell m={view.grossProfit} accent={ACCENT} /></td></tr>
              <tr className="tr"><td className="td" style={compactTd}>هامش الربح الإجمالي</td><td className="td text-left" style={compactTd}><MetricCell m={view.grossMarginPct} suffix="%" /></td></tr>
              <tr className="tr"><td className="td" style={compactTd}>− إجمالي المصروفات</td><td className="td text-left" style={compactTd}><ValueBox color="#ef4444">{fmt(view.totalExpenses)} ج</ValueBox></td></tr>
              <tr className="tr"><td className="td" style={compactTd}>− إجمالي الإهلاكات</td><td className="td text-left" style={compactTd}><ValueBox color="#ef4444">{fmt(view.totalDepreciation)} ج</ValueBox></td></tr>
              <tr className="tr"><td className="td" style={compactTd}>− إجمالي الخسائر</td><td className="td text-left" style={compactTd}><ValueBox color="#ef4444">{fmt(view.totalLosses)} ج</ValueBox></td></tr>
              <tr className="tr" style={{ borderTop: '2px solid var(--inner-border)' }}><td className="td font-extrabold" style={compactTd}>= صافي الربح</td><td className="td text-left" style={compactTd}><MetricCell m={view.netProfit} accent={metricNum(isMissing(view.netProfit) ? 0 : view.netProfit) >= 0 ? '#22c55e' : '#ef4444'} /></td></tr>
              <tr className="tr"><td className="td" style={compactTd}>صافي هامش الربح</td><td className="td text-left" style={compactTd}><MetricCell m={view.netMarginPct} suffix="%" /></td></tr>
              <tr className="tr" style={{ borderTop: '1px solid var(--inner-border)' }}><td className="td" style={{ ...compactTd, color: 'var(--txt-3)' }}>إجمالي التحصيل <InfoIcon title="معلوماتي فقط — تسوية ذمم، لا يدخل في حساب الربح" /></td><td className="td text-left" style={compactTd}><ValueBox color="var(--txt-3)">{fmt(view.totalCollection)} ج</ValueBox></td></tr>
            </tbody>
          </table>
          </div>
        </div>

        {/* مقارنة مع الشهر السابق — قاعدة 11 — انتقلت يسار مؤشرات الربحية — عرضها +50% بدون تحريك مكانها (تمتد على الفراغ يسارها) */}
        <div className="card p-0 overflow-hidden" style={{ height: CARD5_H, width: '150%', display: 'flex', flexDirection: 'column' }}>
        <SectionHeader icon="📊" title="مقارنة مع الشهر السابق" />
        <div style={{ flex: 1, overflowY: 'auto' }}>
        <table className="w-full" style={{ tableLayout: 'fixed' }}>
          <thead><tr><th className="th" style={compactTh}>المؤشر</th><th className="th text-left" style={compactTh}>هذا الشهر</th><th className="th text-left" style={compactTh}>السابق</th><th className="th text-left" style={compactTh}>الفرق</th><th className="th text-left" style={compactTh}>%</th></tr></thead>
          <tbody>
            {[
              { label: 'صافي المبيعات', cur: view.netSales, prev: prevData?.totalSales },
              { label: 'مجمل الربح', cur: isMissing(view.grossProfit) ? null : metricNum(view.grossProfit), prev: prevData?.grossProfit },
              { label: 'صافي الربح', cur: isMissing(view.netProfit) ? null : metricNum(view.netProfit), prev: prevData?.netProfit },
            ].map(r => {
              if (r.cur === null) return (
                <tr key={r.label} className="tr"><td className="td font-bold" style={compactTd}>{r.label}</td><td className="td text-left" style={compactTd} colSpan={4}><span title="بيانات ناقصة" style={{ cursor: 'help', color: '#f59e0b', fontWeight: 700 }}>⚠</span></td></tr>
              )
              const hasPrev = r.prev !== null && r.prev !== undefined
              const diff = hasPrev ? r.cur - (r.prev as number) : 0
              const pct = hasPrev && r.prev !== 0 ? (diff / Math.abs(r.prev as number)) * 100 : 0
              return (
                <tr key={r.label} className="tr">
                  <td className="td font-bold" style={compactTd}>{r.label}</td>
                  <td className="td text-left" style={compactTd}><ValueBox>{fmt(r.cur)} ج</ValueBox></td>
                  <td className="td text-left" style={compactTd}>{hasPrev ? <ValueBox color="var(--txt-2)">{fmt(r.prev as number)} ج</ValueBox> : '—'}</td>
                  <td className="td text-left" style={compactTd}>{hasPrev ? <ValueBox color={diff >= 0 ? '#22c55e' : '#ef4444'}>{(diff >= 0 ? '+' : '') + fmt(diff)}</ValueBox> : '—'}</td>
                  <td className="td text-left" style={compactTd}>{hasPrev ? <ValueBox color={diff >= 0 ? '#22c55e' : '#ef4444'}>{(diff >= 0 ? '▲' : '▼') + ' ' + Math.abs(pct).toFixed(1) + '%'}</ValueBox> : <span title="الشهر السابق غير مُقفل" style={{ cursor: 'help' }}>—ⓘ</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
          <span style={{ fontSize: 14 }}>📦</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>سجل الأشهر المقفلة ({saved.length})</span>
        </div>
        {saved.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: 'var(--txt-3)' }}>لا توجد أشهر مقفلة بعد — اضغط "اعتماد الشهر" لحفظ أول تقرير</div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--inner-border)' }}>
            {saved.map(r => {
              const d = (() => { try { return JSON.parse(r.data_json) } catch { return D } })()
              return (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                  <span className="text-2xs px-2 py-0.5 rounded-md font-bold" style={{ background: PRIMARY + '15', color: PRIMARY }}>{r.month}</span>
                  <span className="text-xs" style={{ color: 'var(--txt-2)' }}>{d.shiftsCount} شيفت · {d.itemsCount} بند</span>
                  <span className="text-xs mr-auto" style={{ color: 'var(--txt-2)' }}>مبيعات <ValueBox color={ACCENT}>{fmt(d.totalSales ?? d.posSales ?? 0)}</ValueBox></span>
                  <span className="text-xs" style={{ color: 'var(--txt-2)' }}>
                    صافي {isMissing(d.netProfit) ? '—' : <ValueBox color={(d.netProfit ?? 0) >= 0 ? '#22c55e' : '#ef4444'}>{fmt(metricNum(d.netProfit ?? 0))}</ValueBox>}
                  </span>
                  {/* تنظيف: للشهر المعروض حاليًا فوق (لو معتمَد) زر "تصدير PDF" بنفس البيانات بالضبط في الشريط العلوي — إخفاؤه هنا يمنع زرين متطابقين */}
                  {r.month !== month && (
                    <button onClick={() => exportClosePDF(r.month, d)} className="btn-next btn-sm" style={{ fontSize: 10, padding: '3px 10px' }}>📄 PDF</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* شريط الاعتماد السفلي: إلغاء/اعتماد التقفيل + رسالة توضيحية عن التجميد + ملاحظات التقرير */}
      <div className="card p-3 grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] gap-3 items-start">
        <div className="flex items-center gap-2">
          {isLocked ? (
            <button onClick={unapproveMonth} disabled={busy} className="btn-danger-pro" style={{ fontSize: 12, padding: '10px 20px' }}>
              {busy ? <><Icons.Refresh size={13} className="animate-spin" /> جاري...</> : <>🔓 إلغاء التقفيل</>}
            </button>
          ) : (
            <button onClick={approveMonth} disabled={busy || !canApprove} title={!canApprove ? D.diagnostics.find(d => d.blocking)?.text : undefined}
              className="btn-success-pro" style={{ fontSize: 12, padding: '10px 20px', opacity: canApprove ? 1 : 0.5 }}>
              {busy ? <><Icons.Refresh size={13} className="animate-spin" /> جاري...</> : <><Icons.Check size={13} /> اعتماد التقفيل الشهري</>}
            </button>
          )}
        </div>
        <div className="flex items-start gap-2 text-2xs" style={{ color: 'var(--txt-3)' }}>
          <span style={{ fontSize: 16 }}>🛡️</span>
          <span>بمجرد اعتماد التقفيل سيتم حفظ نسخة نهائية من التقرير، ولا يمكن التعديل على القيود الخاصة بالشهر إلا بعد إلغاء الاعتماد.</span>
        </div>
        <div style={{ minWidth: 260 }}>
          <label className="text-2xs font-bold flex items-center gap-1 mb-1" style={{ color: 'var(--txt-2)' }}>📝 ملاحظات التقرير</label>
          <textarea value={notes} onChange={e => saveNotes(e.target.value)} disabled={isLocked} placeholder="اكتب ملاحظاتك هنا..."
            className="w-full text-xs rounded-lg p-2" rows={2}
            style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)', color: 'var(--txt-1)', resize: 'vertical', opacity: isLocked ? 0.6 : 1 }} />
        </div>
      </div>
    </div>
  )
}
