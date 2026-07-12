import { useState, useEffect, useMemo, useRef } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import Icons from '../components/Icon'
import KPICard from '../components/KPICard'
import ShiftSheet from '../components/ShiftSheet'
import Treasury from './Treasury'
import { fmt, fmtDate, shiftTypeLabel, parsePias } from '../lib/format'
import { generateShiftReportPDF } from '../lib/shiftReport'
import { calcShiftClosing, calcFawry } from '../../core/engine'
import { APP_VERSION } from '../version'
import type { Shift, Transaction, EmployeeFinancials, ShiftFawry } from '../../core/types'

type Tab = 'journal' | 'cashier_rep' | 'admin_rep' | 'monthly_close' | 'annual_close' | 'sales' | 'purchases' | 'expenses' | 'employees' | 'financial'

const TABS: { id: Tab; label: string; icon: React.ReactNode; color: string; match: RegExp }[] = [
  { id: 'journal',       label: 'سجل اليوميات',           icon: <Icons.Journal size={15} />,     color: '#3b82f6', match: /.*/ },
  { id: 'cashier_rep',   label: 'تقارير حسابات الكاشير',  icon: <Icons.User size={15} />,        color: '#06b6d4', match: /.*/ },
  { id: 'admin_rep',     label: 'تقارير حسابات الإدارة',  icon: <Icons.Fund size={15} />,        color: '#f59e0b', match: /.*/ },
  { id: 'monthly_close', label: 'تقارير التقفيل الشهري',  icon: <Icons.Lock size={15} />,        color: '#8b5cf6', match: /.*/ },
  { id: 'annual_close',  label: 'تقارير التقفيل السنوي',  icon: <Icons.Lock size={15} />,        color: '#ec4899', match: /.*/ },
  { id: 'sales',         label: 'تقارير المبيعات',        icon: <Icons.ArrowRight size={15} />,  color: '#2ea043', match: /مبيع|إيراد|تحصيل|فيزا/ },
  { id: 'purchases',     label: 'تقارير المشتريات',       icon: <Icons.Records size={15} />,     color: '#388bfd', match: /مشتر/ },
  { id: 'expenses',      label: 'تقارير المصروفات',       icon: <Icons.Fund size={15} />,        color: '#f85149', match: /مصروف|جزاء|أجور|كهرب|إيجار/ },
  { id: 'financial',     label: 'التقارير المالية',       icon: <Icons.Reports size={15} />,     color: '#8957e5', match: /.*/ },
  { id: 'employees',     label: 'تقارير الموظفين',        icon: <Icons.Employees size={15} />,   color: '#d4a017', match: /.*/ },
]

interface FinancialData {
  revenues: number; purchases: number; expenses: number; netProfit: number
  cashIn: number; cashOut: number; receivables: number
}

// تجميع التقارير الفرعية للقائمة المنسدلة
const GROUPS: { title: string; ids: Tab[] }[] = [
  { title: 'أساسية',      ids: ['journal', 'cashier_rep', 'admin_rep'] },
  { title: 'تقفيل دوري',  ids: ['monthly_close', 'annual_close'] },
  { title: 'تحليلية',     ids: ['sales', 'purchases', 'expenses', 'financial', 'employees'] },
]

export default function Reports() {
  const { show } = useToast()
  const [tab,    setTab]    = useState<Tab>('journal')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [month,  setMonth]  = useState(() => new Date().toISOString().slice(0, 7))
  const [shifts, setShifts] = useState<Shift[]>([])
  const [allTxs, setAllTxs] = useState<Transaction[]>([])
  const [empFin, setEmpFin] = useState<EmployeeFinancials[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [bizName, setBizName] = useState('')
  const [finData, setFinData] = useState<FinancialData | null>(null)

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

  // بنود التبويب الحالي (للتبويبات الثلاثة)
  const txRows = useMemo(() => {
    if (tab === 'employees') return []
    const shiftMap = new Map(shifts.map(s => [s.id, s]))
    return allTxs
      .filter(t => cfg.match.test(t.mainCategoryName || ''))
      .map(t => ({ ...t, shift: shiftMap.get(t.shiftId) }))
  }, [allTxs, shifts, tab])

  // KPIs للتبويبات الثلاثة
  const kpis = useMemo(() => {
    const total = txRows.reduce((s, t) => s + t.amountIn + t.amountOut, 0)
    const count = txRows.length
    const avg   = count > 0 ? Math.round(total / count) : 0
    const max   = txRows.reduce((m, t) => Math.max(m, t.amountIn + t.amountOut), 0)
    return { total, count, avg, max }
  }, [txRows])

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

  const payLabel: Record<string, string> = { cashier: 'كاشير', management: 'خزينة الإدارة', credit: 'آجل', visa: 'فيزا' }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* رأس التقارير — منتقي منسدل احترافي */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-600 flex-shrink-0 bg-surface-800">
        <span className="text-2xs font-bold hidden md:block" style={{ color: 'var(--txt-3)', letterSpacing: 1 }}>التقرير:</span>
        <div className="relative">
          <button onClick={() => setPickerOpen(o => !o)}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-all"
            style={{ background: cfg.color + '14', border: `1px solid ${cfg.color}55`, minWidth: 240 }}>
            <span style={{ color: cfg.color, display: 'flex' }}>{cfg.icon}</span>
            <span className="font-bold text-sm flex-1 text-right" style={{ color: 'var(--txt-1)' }}>{cfg.label}</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: pickerOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
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
                      const active = tab === id
                      return (
                        <button key={id} onClick={() => { setTab(id); setPickerOpen(false) }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-right hover:bg-white/5"
                          style={{ background: active ? t.color + '18' : 'transparent', borderRight: active ? `3px solid ${t.color}` : '3px solid transparent' }}>
                          <span style={{ color: t.color, display: 'flex' }}>{t.icon}</span>
                          <span className="text-sm flex-1" style={{ color: 'var(--txt-1)', fontWeight: active ? 700 : 500 }}>{t.label}</span>
                          {active && <Icons.Check size={14} style={{ color: t.color }} />}
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
        <input className="field text-xs w-36" type="month" value={month}
          onChange={e => setMonth(e.target.value)} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* أزرار التصدير */}
        <div className="flex items-center justify-between">
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--txt-1)' }}>
            {cfg.label} — {month}
          </h2>
          <button onClick={exportPDF} disabled={exporting} className="btn-primary btn-sm">
            <Icons.Download size={14} /> {exporting ? 'جاري التصدير...' : 'تصدير PDF'}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-10" style={{ color: 'var(--txt-3)' }}>جاري التحميل...</div>
        ) : tab === 'journal' ? (
          <JournalReport shifts={shifts} allTxs={allTxs} month={month} bizName={bizName} onReload={load} />
        ) : tab === 'cashier_rep' ? (
          <CashierReport allTxs={allTxs} />
        ) : tab === 'admin_rep' ? (
          <AdminReport month={month} />
        ) : tab === 'monthly_close' ? (
          <MonthlyCloseReport month={month} shifts={shifts} allTxs={allTxs} empFin={empFin} finData={finData} />
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
              {/* قائمة الأرباح والخسائر */}
              <div className="card">
                <div className="font-bold text-white text-sm mb-3">قائمة الأرباح والخسائر (P&L)</div>
                <div className="space-y-2 text-sm">
                  {[
                    ['الإيرادات',            finData?.revenues ?? 0, '#2ea043', '+'],
                    ['(−) المشتريات',        finData?.purchases ?? 0, '#f85149', '−'],
                    ['(−) المصروفات التشغيلية', finData?.expenses ?? 0, '#f85149', '−'],
                  ].map(([l, v, c]) => (
                    <div key={l as string} className="flex justify-between">
                      <span style={{ color: 'var(--txt-2)' }}>{l as string}</span>
                      <span className="tabular-nums font-bold" style={{ color: c as string }}>{fmt(v as number)} ج</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-surface-600 pt-2 mt-1">
                    <span className="font-bold" style={{ color: 'var(--txt-1)' }}>صافي الربح</span>
                    <span className="tabular-nums font-bold" style={{ color: (finData?.netProfit ?? 0) >= 0 ? '#d4a017' : '#f85149', fontSize: '16px' }}>
                      {fmt(finData?.netProfit ?? 0)} ج
                    </span>
                  </div>
                </div>
              </div>
              {/* التدفق النقدي + الذمم */}
              <div className="card">
                <div className="font-bold text-white text-sm mb-3">التدفق النقدي والذمم</div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--txt-2)' }}>تدفق نقدي داخل (كاشير)</span>
                    <span className="tabular-nums font-bold text-success">{fmt(finData?.cashIn ?? 0)} ج</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--txt-2)' }}>تدفق نقدي خارج (كاشير)</span>
                    <span className="tabular-nums font-bold text-danger">{fmt(finData?.cashOut ?? 0)} ج</span>
                  </div>
                  <div className="flex justify-between border-t border-surface-600 pt-2">
                    <span style={{ color: 'var(--txt-2)' }}>صافي التدفق النقدي</span>
                    <span className="tabular-nums font-bold" style={{ color: 'var(--txt-1)' }}>{fmt((finData?.cashIn ?? 0) - (finData?.cashOut ?? 0))} ج</span>
                  </div>
                  <div className="flex justify-between border-t border-surface-600 pt-2 mt-1">
                    <span style={{ color: '#d29922' }}>الذمم المدينة (آجل)</span>
                    <span className="tabular-nums font-bold" style={{ color: '#d29922' }}>{fmt(finData?.receivables ?? 0)} ج</span>
                  </div>
                </div>
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

            {/* KPIs الموظفين */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <KPICard label="عدد الموظفين" value={String(empFin.length)} color="#d4a017" icon={<Icons.Employees size={14}/>} />
              <KPICard label="إجمالي الأجر باليوم" value={fmt(empFin.reduce((s,f)=>s+f.wageByDays,0)) + ' ج'} color="#2ea043" icon={<Icons.Fund size={14}/>} />
              <KPICard label="إجمالي السلف" value={fmt(empFin.reduce((s,f)=>s+f.advances,0)) + ' ج'} color="#f85149" icon={<Icons.ArrowRight size={14}/>} />
              <KPICard label="إجمالي المستحق" value={fmt(empFin.reduce((s,f)=>s+f.dueSalary,0)) + ' ج'} color="#388bfd" icon={<Icons.Reports size={14}/>} />
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
                  {empFin.map(f => (
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
              </table>
              {empFin.length === 0 && <div className="text-center py-6" style={{color:'var(--txt-3)'}}>لا يوجد موظفون</div>}
            </div>
          </>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <KPICard label="الإجمالي" value={fmt(kpis.total) + ' ج'} color={cfg.color} icon={cfg.icon} />
              <KPICard label="عدد العمليات" value={String(kpis.count)} color="#5aaeff" icon={<Icons.Records size={14}/>} />
              <KPICard label="متوسط العملية" value={fmt(kpis.avg) + ' ج'} color="#8957e5" icon={<Icons.Reports size={14}/>} />
              <KPICard label="أعلى عملية" value={fmt(kpis.max) + ' ج'} color="#d29922" icon={<Icons.ArrowRight size={14}/>} />
            </div>
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr>
                  <th className="th">التاريخ</th><th className="th">شيفت</th><th className="th">البيان</th>
                  <th className="th">التصنيف</th><th className="th">الفرعي</th><th className="th">الدفع</th><th className="th">المبلغ</th>
                </tr></thead>
                <tbody>
                  {txRows.map(t => (
                    <tr key={t.id} className="tr">
                      <td className="td" style={{color:'var(--txt-2)'}}>{t.shift ? fmtDate(t.shift.date) : '—'}</td>
                      <td className="td text-brand-400">#{t.shift?.monthlyShiftNum ?? '—'}</td>
                      <td className="td font-medium truncate max-w-[160px]">{t.description}</td>
                      <td className="td" style={{color:'var(--txt-2)'}}>{t.mainCategoryName}</td>
                      <td className="td" style={{color:'var(--txt-3)'}}>{t.subCategoryName || '—'}</td>
                      <td className="td" style={{color:'var(--txt-3)'}}>{payLabel[t.payMethod]}</td>
                      <td className="td tabular-nums font-bold" style={{color:cfg.color}}>{fmt(t.amountIn + t.amountOut)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-surface-500">
                  <td className="td font-bold" colSpan={6}>الإجمالي ({kpis.count} عملية)</td>
                  <td className="td tabular-nums font-bold" style={{color:cfg.color}}>{fmt(kpis.total)}</td>
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
  const PAY_LABELS: Record<string, string> = {
    cashier: 'كاشير', management: 'خزينة الإدارة', credit: 'آجل', visa: 'فيزا',
  }

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

  // ── العرض المكثّف (دبل كليك) ──
  const [viewShift,   setViewShift]   = useState<Shift | null>(null)
  const [viewTxs,     setViewTxs]     = useState<Transaction[]>([])
  const [viewFawry,   setViewFawry]   = useState<any>(null)
  const [viewCustody, setViewCustody] = useState<any>(null)
  const [saving,      setSaving]      = useState(false)
  const [pdfBusy,     setPdfBusy]     = useState(false)
  // نماذج التعديل
  const [closeForm,   setCloseForm]   = useState({ posSales: '', cashierRemaining: '' })
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

  async function openShift(s: Shift) {
    setViewShift(s)
    try {
      const [txs, f, c] = await Promise.all([
        call(api.tx.getByShift(s.id)) as Promise<Transaction[]>,
        call(api.fawry.get(s.id)).catch(() => null),
        call(api.custody.get(s.id)).catch(() => null),
      ])
      setViewTxs(txs)
      setViewFawry(f)
      setViewCustody(c)
      setCloseForm({
        posSales:         String((s.posSales ?? 0) / 100),
        cashierRemaining: String((s.cashierRemaining ?? 0) / 100),
      })
    } catch (e) { console.error(e) }
  }

  async function saveEdits() {
    if (!viewShift) return
    setSaving(true)
    try {
      // حفظ تعديلات الإغلاق — v2.31.3: المعامل الثاني الآن هو cashierRemaining الفعلي (وليس expectedCash النظري)
      const cashierRemaining = parsePias(closeForm.cashierRemaining || '0')
      await call(api.shifts.close(
        viewShift.id, cashierRemaining,
        parsePias(closeForm.posSales || '0'),
        cashierRemaining,
      ))
      setViewShift(null)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  async function exportShiftPDF(s: Shift) {
    setPdfBusy(true)
    try { await generateShiftReportPDF(s) } catch (e) { console.error(e) }
    finally { setPdfBusy(false) }
  }

  // قيم فوري المحسوبة للعرض
  const fawrySales = viewFawry ? {
    basic:   (viewFawry.basicReceive   - viewFawry.basicDeliver)   + (viewFawry.cashoutToBasic ?? 0) + (viewFawry.fawryToBasic ?? 0),
    air:     (viewFawry.airReceive     - viewFawry.airDeliver)     + (viewFawry.cashoutToAir ?? 0)   + (viewFawry.fawryToAir ?? 0),
    cashout: (viewFawry.cashoutDeliver - viewFawry.cashoutReceive),
  } : { basic: 0, air: 0, cashout: 0 }

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

      {/* ═══ Modal العرض المكثف (دبل كليك) ═══ */}
      {viewShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
          onClick={() => setViewShift(null)}>
          <div className="card flex flex-col" style={{ width: '95vw', maxWidth: 1400, height: '92vh', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            {/* رأس */}
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(59,130,246,0.18)', color: 'var(--accent)' }}>
                  <Icons.Eye size={18} />
                </div>
                <div>
                  <div className="font-bold text-base" style={{ color: 'var(--txt-1)' }}>
                    شيفت #{viewShift.monthlyShiftNum} — {viewShift.cashierName}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--txt-3)' }}>
                    {fmtDate(viewShift.date)} · {shiftTypeLabel(viewShift.type)}
                  </div>
                </div>
              </div>
              <button onClick={() => setViewShift(null)} className="p-2 rounded-lg hover:bg-white/10" style={{ color: 'var(--txt-2)' }}>
                <Icons.Close size={16} />
              </button>
            </div>

            {/* المحتوى المكثّف */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* 1) بنود اليومية */}
              <section>
                <div className="flex items-center gap-2 mb-2 pb-2" style={{ borderBottom: '2px solid #22c55e' }}>
                  <Icons.Journal size={15} style={{ color: '#22c55e' }} />
                  <span className="font-bold text-sm" style={{ color: '#22c55e' }}>جدول بنود اليومية ({viewTxs.length})</span>
                </div>
                <div className="card p-0 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="th">#</th><th className="th">الوقت</th><th className="th">البيان</th>
                        <th className="th">التصنيف</th><th className="th">الدفع</th>
                        <th className="th" style={{ color: '#22c55e' }}>وارد</th>
                        <th className="th" style={{ color: '#ef4444' }}>منصرف</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewTxs.map((tx, i) => (
                        <tr key={tx.id} className="tr">
                          <td className="td tabular-nums" style={{ color: 'var(--txt-3)' }}>{i + 1}</td>
                          <td className="td tabular-nums" style={{ color: 'var(--txt-3)' }}>{tx.time}</td>
                          <td className="td font-medium">{tx.description}</td>
                          <td className="td text-2xs" style={{ color: 'var(--txt-2)' }}>
                            {tx.mainCategoryName}{tx.subCategoryName ? ' › ' + tx.subCategoryName : ''}
                          </td>
                          <td className="td">{PAY_LABELS[tx.payMethod] ?? tx.payMethod}</td>
                          <td className="td tabular-nums font-bold" style={{ color: '#22c55e' }}>{tx.amountIn > 0 ? fmt(tx.amountIn) : ''}</td>
                          <td className="td tabular-nums font-bold" style={{ color: '#ef4444' }}>{tx.amountOut > 0 ? fmt(tx.amountOut) : ''}</td>
                        </tr>
                      ))}
                      {viewTxs.length === 0 && (
                        <tr><td colSpan={7} className="td text-center py-4" style={{ color: 'var(--txt-3)' }}>لا توجد بنود</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 2) تقفيل ماكينة فوري */}
              <section>
                <div className="flex items-center gap-2 mb-2 pb-2" style={{ borderBottom: '2px solid #8b5cf6' }}>
                  <Icons.Fawry size={15} style={{ color: '#8b5cf6' }} />
                  <span className="font-bold text-sm" style={{ color: '#8b5cf6' }}>جدول تقفيل ماكينة فوري</span>
                </div>
                {!viewFawry ? (
                  <div className="text-center py-4 text-xs" style={{ color: 'var(--txt-3)' }}>لا توجد بيانات فوري</div>
                ) : (
                  <div className="card p-0 overflow-hidden">
                    <table className="w-full text-xs text-center">
                      <thead><tr>
                        <th className="th text-right">الحركة</th>
                        <th className="th">أساسي</th><th className="th">إير تايم</th><th className="th">كاش أوت</th>
                      </tr></thead>
                      <tbody>
                        <tr className="tr">
                          <td className="td text-right font-bold" style={{ color: '#22c55e' }}>⬇ استلام</td>
                          <td className="td tabular-nums">{fmt(viewFawry.basicReceive)}</td>
                          <td className="td tabular-nums">{fmt(viewFawry.airReceive)}</td>
                          <td className="td tabular-nums">{fmt(viewFawry.cashoutReceive)}</td>
                        </tr>
                        <tr className="tr">
                          <td className="td text-right font-bold" style={{ color: '#ef4444' }}>⬆ تسليم</td>
                          <td className="td tabular-nums">{fmt(viewFawry.basicDeliver)}</td>
                          <td className="td tabular-nums">{fmt(viewFawry.airDeliver)}</td>
                          <td className="td tabular-nums">{fmt(viewFawry.cashoutDeliver)}</td>
                        </tr>
                        <tr className="tr" style={{ background: 'rgba(59,130,246,0.06)' }}>
                          <td className="td text-right font-bold" style={{ color: 'var(--accent)' }}>✨ مبيعات</td>
                          <td className="td tabular-nums font-bold" style={{ color: '#3b82f6' }}>{fmt(fawrySales.basic)}</td>
                          <td className="td tabular-nums font-bold" style={{ color: '#8b5cf6' }}>{fmt(fawrySales.air)}</td>
                          <td className="td tabular-nums font-bold" style={{ color: '#f59e0b' }}>{fmt(fawrySales.cashout)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="px-3 py-2 text-2xs" style={{ borderTop: '1px solid var(--inner-border)', color: 'var(--txt-3)' }}>
                      مبيعات البرنامج: <b style={{ color: '#22c55e' }}>{fmt(viewFawry.programSales)} ج</b>
                      &nbsp;·&nbsp; أول بون: <b>{viewFawry.firstVoucher}</b> · آخر بون: <b>{viewFawry.lastVoucher}</b>
                    </div>
                  </div>
                )}
              </section>

              {/* 3) حسابات إغلاق الشيفت (قابلة للتعديل) */}
              <section>
                <div className="flex items-center gap-2 mb-2 pb-2" style={{ borderBottom: '2px solid #f59e0b' }}>
                  <Icons.Fund size={15} style={{ color: '#f59e0b' }} />
                  <span className="font-bold text-sm" style={{ color: '#f59e0b' }}>حسابات إغلاق الشيفت</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-xl p-3" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.30)' }}>
                    <label className="block text-2xs mb-1.5" style={{ color: '#3b82f6', fontWeight: 700 }}>مبيعات POS</label>
                    <input className="field text-sm tabular-nums" type="number" min={0} value={closeForm.posSales}
                      onChange={e => setCloseForm(f => ({ ...f, posSales: e.target.value }))} style={{ color: '#3b82f6', fontWeight: 700 }} />
                  </div>
                  <div className="rounded-xl p-3" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.30)' }}>
                    <label className="block text-2xs mb-1.5" style={{ color: '#22c55e', fontWeight: 700 }}>نقدية متبقية</label>
                    <input className="field text-sm tabular-nums" type="number" min={0} value={closeForm.cashierRemaining}
                      onChange={e => setCloseForm(f => ({ ...f, cashierRemaining: e.target.value }))} style={{ color: '#22c55e', fontWeight: 700 }} />
                  </div>
                  <div className="rounded-xl p-3" style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.25)' }}>
                    <div className="text-2xs mb-1" style={{ color: 'var(--txt-3)' }}>تحصيلات (تلقائي)</div>
                    <div className="text-sm font-bold tabular-nums" style={{ color: '#06b6d4' }}>{fmt(viewShift.cashierCollections ?? 0)} ج</div>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}>
                    <div className="text-2xs mb-1" style={{ color: 'var(--txt-3)' }}>مصروفات الشيفت (تلقائي)</div>
                    <div className="text-sm font-bold tabular-nums" style={{ color: '#ef4444' }}>{fmt(viewShift.shiftExpenses ?? 0)} ج</div>
                  </div>
                  {viewCustody && (
                    <>
                      <div className="rounded-xl p-3" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                        <div className="text-2xs mb-1" style={{ color: 'var(--txt-3)' }}>إضافة من صندوق سابق</div>
                        <div className="text-sm font-bold tabular-nums" style={{ color: 'var(--txt-1)' }}>{fmt(viewCustody.addFromFund)} ج</div>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)' }}>
                        <div className="text-2xs mb-1" style={{ color: 'var(--txt-3)' }}>إدارة محسوب</div>
                        <div className="text-sm font-bold tabular-nums" style={{ color: '#f59e0b' }}>{fmt(viewCustody.managementPaid)} ج</div>
                      </div>
                    </>
                  )}
                </div>
              </section>
            </div>

            {/* فوتر */}
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
              style={{ borderTop: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
              <button onClick={() => exportShiftPDF(viewShift)} disabled={pdfBusy} className="btn-next btn-sm" style={{ fontSize: 12 }}>
                {pdfBusy ? <><Icons.Refresh size={12} className="animate-spin" /> جاري...</> : <>📄 تقرير PDF</>}
              </button>
              <div className="flex items-center gap-2">
                <button onClick={saveEdits} disabled={saving} className="btn-success-pro" style={{ fontSize: 13, padding: '8px 20px' }}>
                  {saving ? <><Icons.Refresh size={13} className="animate-spin" /> جاري الحفظ...</> : <><Icons.Save size={14} /> حفظ التعديلات</>}
                </button>
                <button onClick={() => setViewShift(null)} className="btn-ghost btn-sm">إغلاق</button>
              </div>
            </div>
          </div>
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
// v2.27.0 — تقارير حسابات الكاشير
// ═══════════════════════════════════════════════════════════
function CashierReport({ allTxs }: { allTxs: Transaction[] }) {
  const PAY_LABELS: Record<string, string> = {
    cashier: 'كاشير (نقدي)', management: 'خزينة الإدارة', credit: 'آجل (ذمم)', visa: 'فيزا',
  }
  const PAY_COLORS: Record<string, string> = {
    cashier: '#3b82f6', management: '#f59e0b', credit: '#8b5cf6', visa: '#10b981',
  }
  const PAY_DESC: Record<string, string> = {
    cashier:    'مدفوع من نقدية الكاشير',
    management: 'مدفوع من خزينة الإدارة (للعهدة)',
    credit:     'دفع مؤجّل (ذمم على العملاء)',
    visa:       'دفع ببطاقة فيزا',
  }

  const cashierTxs = allTxs.filter(t => t.payMethod === 'cashier')
  const cashierIn  = cashierTxs.reduce((s, t) => s + t.amountIn,  0)
  const cashierOut = cashierTxs.reduce((s, t) => s + t.amountOut, 0)
  const cashierNet = cashierIn - cashierOut

  // توزيع المنصرف حسب الطريقة
  const totalAllOut = allTxs.reduce((s, t) => s + t.amountOut, 0)
  const distribution = (['cashier', 'management'] as const).map(pm => {
    const list = allTxs.filter(t => t.payMethod === pm)
    const out  = list.reduce((s, t) => s + t.amountOut, 0)
    const inn  = list.reduce((s, t) => s + t.amountIn,  0)
    return { method: pm, count: list.length, in: inn, out, pct: totalAllOut > 0 ? (out / totalAllOut * 100) : 0 }
  })

  return (
    <div className="space-y-4">
      {/* رأس */}
      <div className="flex items-center gap-2 mb-1">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(6,182,212,0.18)', color: '#06b6d4' }}>
          <Icons.User size={18} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--txt-1)' }}>تقارير حسابات الكاشير</div>
          <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
            ملخص الحركات النقدية وتوزيع طرق الدفع لكل بنود الشهر
          </div>
        </div>
      </div>

      {/* 3 بطاقات */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl p-4" style={{
          background: 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(34,197,94,0.04))',
          border: '1.5px solid rgba(34,197,94,0.40)',
        }}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>⬇ الوارد عبر الكاشير</div>
              <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginTop: 2 }}>إجمالي المبالغ المحصّلة نقداً</div>
            </div>
            <div className="p-2 rounded-lg" style={{ background: 'rgba(34,197,94,0.22)', color: '#22c55e' }}>
              <Icons.ArrowRight size={14} />
            </div>
          </div>
          <div className="tabular-nums" style={{ fontSize: 24, fontWeight: 900, color: '#22c55e', lineHeight: 1.1 }}>
            +{fmt(cashierIn)} <span style={{ fontSize: 12 }}>ج</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 4 }}>
            {cashierTxs.filter(t => t.amountIn > 0).length} بند وارد
          </div>
        </div>
        <div className="rounded-2xl p-4" style={{
          background: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))',
          border: '1.5px solid rgba(239,68,68,0.40)',
        }}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>⬆ المنصرف عبر الكاشير</div>
              <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginTop: 2 }}>المصاريف المدفوعة نقداً</div>
            </div>
            <div className="p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.22)', color: '#ef4444' }}>
              <Icons.ArrowRight size={14} className="rotate-180" />
            </div>
          </div>
          <div className="tabular-nums" style={{ fontSize: 24, fontWeight: 900, color: '#ef4444', lineHeight: 1.1 }}>
            −{fmt(cashierOut)} <span style={{ fontSize: 12 }}>ج</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 4 }}>
            {cashierTxs.filter(t => t.amountOut > 0).length} بند منصرف
          </div>
        </div>
        <div className="rounded-2xl p-4" style={{
          background: cashierNet >= 0
            ? 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(30,58,138,0.06))'
            : 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))',
          border: cashierNet >= 0 ? '1.5px solid rgba(59,130,246,0.50)' : '1.5px solid rgba(239,68,68,0.50)',
        }}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: cashierNet >= 0 ? 'var(--accent)' : '#ef4444' }}>💰 صافي الكاشير</div>
              <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginTop: 2 }}>وارد − منصرف</div>
            </div>
            <div className="p-2 rounded-lg" style={{
              background: cashierNet >= 0 ? 'rgba(59,130,246,0.22)' : 'rgba(239,68,68,0.22)',
              color: cashierNet >= 0 ? 'var(--accent)' : '#ef4444',
            }}>
              <Icons.Fund size={14} />
            </div>
          </div>
          <div className="tabular-nums" style={{
            fontSize: 24, fontWeight: 900,
            color: cashierNet >= 0 ? 'var(--accent)' : '#ef4444', lineHeight: 1.1,
          }}>
            {cashierNet >= 0 ? '+' : ''}{fmt(cashierNet)} <span style={{ fontSize: 12 }}>ج</span>
          </div>
          <div style={{
            fontSize: 11, marginTop: 4, fontWeight: 600,
            color: cashierNet >= 0 ? '#22c55e' : '#ef4444',
          }}>
            {cashierNet > 0 ? '✓ نقدية متبقية' : cashierNet < 0 ? '⚠ عجز' : '○ متزن'}
          </div>
        </div>
      </div>

      {/* توزيع طرق الدفع */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <span style={{ fontSize: 14 }}>💳</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>
              توزيع المنصرف حسب طريقة الدفع
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--txt-3)' }}>
              كيف توزّع إجمالي المنصرف على طرق الدفع المختلفة
            </div>
          </div>
          <div className="mr-auto text-xs tabular-nums font-bold" style={{ color: 'var(--txt-1)' }}>
            إجمالي: <span style={{ color: '#ef4444' }}>{fmt(totalAllOut)} ج</span>
          </div>
        </div>
        <div className="space-y-3">
          {distribution.map(d => (
            <div key={d.method}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: PAY_COLORS[d.method] }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt-1)' }}>
                    {PAY_LABELS[d.method]}
                  </span>
                  <span className="text-2xs px-1.5 py-0.5 rounded-md"
                    style={{ background: PAY_COLORS[d.method] + '20', color: PAY_COLORS[d.method], fontWeight: 700 }}>
                    {d.count} بند
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums" style={{ fontSize: 13, fontWeight: 800, color: PAY_COLORS[d.method] }}>
                    {fmt(d.out)} ج
                  </span>
                  <span className="text-2xs tabular-nums" style={{
                    color: 'var(--txt-3)', minWidth: 40, textAlign: 'left',
                  }}>
                    ({d.pct.toFixed(1)}%)
                  </span>
                </div>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--inner-bg)' }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, d.pct)}%`,
                    background: `linear-gradient(90deg, ${PAY_COLORS[d.method]}, ${PAY_COLORS[d.method]}cc)`,
                  }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 3 }}>{PAY_DESC[d.method]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* جدول بنود الكاشير */}
      {cashierTxs.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--inner-border)' }}>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 14 }}>📋</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>
                  بنود الكاشير ({cashierTxs.length})
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--txt-3)' }}>
                  جميع الحركات النقدية التي مرّت عبر الكاشير
                </div>
              </div>
            </div>
          </div>
          <div className="overflow-auto" style={{ maxHeight: 400 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">الوقت</th>
                  <th className="th">البيان</th>
                  <th className="th">التصنيف</th>
                  <th className="th" style={{ color: '#22c55e' }}>وارد</th>
                  <th className="th" style={{ color: '#ef4444' }}>منصرف</th>
                </tr>
              </thead>
              <tbody>
                {cashierTxs.map(tx => (
                  <tr key={tx.id} className="tr">
                    <td className="td tabular-nums" style={{ color: 'var(--txt-3)' }}>{tx.time}</td>
                    <td className="td font-medium">{tx.description}</td>
                    <td className="td text-2xs" style={{ color: 'var(--txt-2)' }}>{tx.mainCategoryName}</td>
                    <td className="td tabular-nums font-bold" style={{ color: '#22c55e' }}>
                      {tx.amountIn > 0 ? '+' + fmt(tx.amountIn) : ''}
                    </td>
                    <td className="td tabular-nums font-bold" style={{ color: '#ef4444' }}>
                      {tx.amountOut > 0 ? '−' + fmt(tx.amountOut) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// v2.27.0 — تقارير حسابات الإدارة (إعادة استخدام Treasury)
// ═══════════════════════════════════════════════════════════
function AdminReport({ month: _month }: { month: string }) {
  return (
    <div className="-m-4" style={{ height: 'calc(100vh - 220px)' }}>
      <Treasury />
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
    if (!confirm(`حذف تقرير رواتب شهر ${r.month} (${fmt(r.total_amount)} ج)؟\nسيُعاد المبلغ إلى خزينة الإدارة (عكس الخصم).`)) return
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
              <td colspan="3" style="padding:9px;text-align:right;border:1px solid #1e293b;">الإجمالي · طريقة الدفع: خزينة الإدارة</td>
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
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>· خزينة الإدارة</span>
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

          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
              <span style={{ fontSize: 14 }}>🗓️</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>الأشهر المُجمّعة ({rows.length})</span>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--inner-border)' }}>
              {rows.map(r => (
                <div key={r.month} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                  <span className="text-2xs px-2 py-0.5 rounded-md font-bold" style={{ background: 'rgba(236,72,153,0.15)', color: '#ec4899' }}>{r.month}</span>
                  <span className="text-xs" style={{ color: 'var(--txt-2)' }}>{r.d.shiftsCount ?? 0} شيفت</span>
                  <span className="tabular-nums text-xs mr-auto" style={{ color: '#3b82f6' }}>POS {fmt(r.d.posSales ?? 0)}</span>
                  <span className="tabular-nums text-xs font-bold" style={{ color: '#22c55e' }}>ختامي {fmt(r.d.cashClosing ?? 0)}</span>
                </div>
              ))}
            </div>
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
interface MonthCloseRow { id: number; month: string; data_json: string; created_at: string }

// أسماء التصنيفات الفرعية المستثناة من سطر «مشتريات» العام لأنها مُفصَّلة كسطور مستقلة في التقرير
const PURCHASE_BREAKOUT_SUBS = [
  'مشتريات اللحوم', 'مشتريات فراخ', 'شحن ونقل', 'هوالك منتجات',
  'إنتاج جبن', 'إنتاج فراخ', 'إنتاج لحوم', 'أدوات تغليف', 'أدوات نظافة', 'أدوات مكتبية',
]

function prevMonthKeyOf(month: string): string {
  const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function MonthlyCloseReport({ month, shifts, allTxs, empFin }: {
  month: string; shifts: Shift[]; allTxs: Transaction[];
  empFin: EmployeeFinancials[]; finData: FinancialData | null;
}) {
  const [saved, setSaved] = useState<MonthCloseRow[]>([])
  const [busy,  setBusy]  = useState(false)
  const [fawryMap, setFawryMap] = useState<Record<number, ShiftFawry>>({})
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({})
  const [prevNetProfit, setPrevNetProfit] = useState<number | null>(null)
  const [logo, setLogo] = useState(''); const [companyName, setCompanyName] = useState('')
  const { show } = useToast()

  async function reload() {
    try { setSaved(await call(api.monthlyClose.list()) as MonthCloseRow[]) } catch (e) { console.error(e) }
  }
  useEffect(() => { reload() }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const records = await Promise.all(shifts.map(sh => call<ShiftFawry | null>(api.fawry.get(sh.id)).catch(() => null)))
        if (!alive) return
        const fm: Record<number, ShiftFawry> = {}
        shifts.forEach((sh, i) => { const r = records[i]; if (r) fm[sh.id] = r })
        setFawryMap(fm)
      } catch { /* */ }
      try {
        const st = await call(api.settings.getAll()) as { key: string; value: string }[]
        if (!alive) return
        const sm: Record<string, string> = {}
        for (const row of st) sm[row.key] = row.value
        setSettingsMap(sm)
        setLogo(sm['biz.logo'] ?? ''); setCompanyName(sm['biz.name'] ?? '')
      } catch { /* */ }
      try {
        const prev = await call(api.monthlyClose.get(prevMonthKeyOf(month))) as MonthCloseRow | null
        if (!alive) return
        if (prev) { try { setPrevNetProfit(JSON.parse(prev.data_json).netProfit ?? null) } catch { setPrevNetProfit(null) } }
        else setPrevNetProfit(null)
      } catch { setPrevNetProfit(null) }
    })()
    return () => { alive = false }
  }, [month, shifts])

  // قيم يدوية محفوظة لكل شهر عبر settings (مخزون بضاعة/لحوم + أرصدة فوري الافتتاحية)
  function manualPias(key: string): number { return Number(settingsMap[`${key}.${month}`] ?? 0) }
  async function saveManual(key: string, egp: string) {
    const val = Math.round((parseFloat(egp) || 0) * 100)
    const fullKey = `${key}.${month}`
    try { await call(api.settings.set(fullKey, String(val))); setSettingsMap(sm => ({ ...sm, [fullKey]: String(val) })) }
    catch (e) { show((e as Error).message, 'error') }
  }

  const D = useMemo(() => {
    const tx = allTxs // مُفلترة أصلاً على الشهر من المكوّن الأب
    const byMainSub = (main: string, sub: string) => tx.filter(t => t.mainCategoryName === main && t.subCategoryName === sub).reduce((a, t) => a + t.amountOut, 0)
    const byMainSubIn = (main: string, sub: string) => tx.filter(t => t.mainCategoryName === main && t.subCategoryName === sub).reduce((a, t) => a + t.amountIn + t.amountOut, 0)
    const byMainNoSub = (main: string, excludeSubs: string[]) => tx.filter(t => t.mainCategoryName === main && !excludeSubs.includes(t.subCategoryName)).reduce((a, t) => a + t.amountOut, 0)
    const mainTotal = (main: string) => tx.filter(t => t.mainCategoryName === main).reduce((a, t) => a + t.amountOut, 0)

    // ═══ إيرادات ═══
    const posSales = shifts.reduce((a, s) => a + (s.posSales ?? 0), 0)
    let basicSales = 0, airSales = 0, fawryProfitability = 0, fawryToBasicTotal = 0, fawryToAirTotal = 0
    let cashoutAddTotal = 0, cashoutDiscountTotal = 0, cashoutToBasicTotal = 0, cashoutToAirTotal = 0, fawryCommission = 0
    for (const s of shifts) {
      const f = fawryMap[s.id]
      if (!f) continue
      const r = calcFawry(f)
      basicSales += r.basicSales; airSales += r.airSales; fawryProfitability += r.profitability
      fawryToBasicTotal += f.fawryToBasic; fawryToAirTotal += f.fawryToAir
      cashoutToBasicTotal += f.cashoutToBasic; cashoutToAirTotal += f.cashoutToAir
      const cashoutDiff = r.cashoutSales // تسليم − استلام
      if (cashoutDiff > 0) cashoutAddTotal += cashoutDiff; else cashoutDiscountTotal += -cashoutDiff
      const visaThisShift = tx.filter(t => t.shiftId === s.id && t.subCategoryName === 'مبيعات فيزا').reduce((a, t) => a + t.amountIn + t.amountOut, 0)
      fawryCommission += visaThisShift - cashoutDiff
    }
    const fawrySales = basicSales + airSales
    const totalSales = posSales + fawrySales
    const meatSales = byMainSubIn('مبيعات', 'مبيعات لحوم')
    const deliverySales = byMainSubIn('مبيعات', 'مبيعات توصيل')

    // ═══ مصاريف مشتريات ═══
    const purchasesGeneral = byMainNoSub('مشتريات', PURCHASE_BREAKOUT_SUBS)
    const purchaseReturns = byMainSub('مرتجعات', 'مرتجع مشتريات')
    const shipping = byMainSub('مشتريات', 'شحن ونقل')
    const meatPurchases = byMainSub('مشتريات', 'مشتريات اللحوم')
    const poultryPurchases = byMainSub('مشتريات', 'مشتريات فراخ')
    const productWaste = byMainSub('مشتريات', 'هوالك منتجات')

    // ═══ مصاريف مبيعات ═══
    const salesDiscounts = byMainSub('خصومات', 'خصومات البيع')
    let surplus = 0, deficit = 0
    // نثق بالحقول المحفوظة على الشيفت نفسه (shift_expenses / cashier_collections) بدل إعادة
    // اشتقاقها من بنود اليومية — فهذه الحقول تُصالَح مع رقم الشيت المرجعي عند الاستيراد
    // (انظر overrideShiftExpenses في pipeline.ts)، وتُحدَّث بنفس المنطق عند الإدخال اليدوي.
    for (const s of shifts) {
      const { result } = calcShiftClosing({
        posSales: s.posSales ?? 0, cashierRemaining: s.cashierRemaining ?? 0,
        cashierExpenses: s.shiftExpenses ?? 0, collections: s.cashierCollections ?? 0,
      })
      if (result > 0) surplus += result; else if (result < 0) deficit += -result
    }
    const meatProduction = byMainSub('مشتريات', 'إنتاج لحوم')
    const poultryProduction = byMainSub('مشتريات', 'إنتاج فراخ')
    const cheeseProduction = byMainSub('مشتريات', 'إنتاج جبن')
    const salesReturns = byMainSub('مرتجعات', 'مرتجع مبيعات')

    // ═══ مصاريف إدارية ═══
    const wages = mainTotal('أجور')
    const rent = byMainSub('مصروفات', 'إيجار')
    const assetDepreciation = byMainSub('مصروفات', 'اهلاك أصول')
    const water = byMainSub('مصروفات', 'مياة')
    const electricity = byMainSub('مصروفات', 'كهرباء')
    const insurance = byMainSub('مصروفات', 'تأمينات')
    const facilities = byMainSub('مصروفات', 'مرافق')
    const govFees = byMainSub('مصروفات', 'مصاريف حكومية')
    const phoneInternet = byMainSub('مصروفات', 'تليفون وإنترنت')
    const maintenance = byMainSub('مصروفات', 'صيانة')
    const officeSupplies = byMainSub('مشتريات', 'أدوات مكتبية')
    const cleaningExpenses = byMainSub('مشتريات', 'أدوات نظافة')
    const packagingTools = byMainSub('مشتريات', 'أدوات تغليف')

    // ═══ حساب الكاش أوت ═══
    const visaSales = byMainSubIn('مبيعات', 'مبيعات فيزا')
    const commissionRatio = visaSales > 0 ? (fawryCommission / visaSales) * 100 : 0

    // ═══ الصندوق ═══
    const sortedShifts = [...shifts].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    const firstShift = sortedShifts[0]
    const fundOpening = firstShift ? Number(settingsMap[`fund.prev.${firstShift.id}`] ?? 0) * 100 : 0
    const fundCashIn = shifts.reduce((a, s) => a + (s.cashierRemaining ?? 0), 0)
    const fundExpenses = tx.filter(t => t.payMethod === 'management').reduce((a, t) => a + t.amountIn + t.amountOut, 0)
    const fundClosing = fundOpening + fundCashIn - fundExpenses

    // صافي الربح — نفس معادلة لوحة المعلومات (إجمالي المبيعات − مشتريات − مصروفات − أجور) للاتساق بين الشاشتين
    const netProfit = totalSales - mainTotal('مشتريات') - mainTotal('مصروفات') - wages

    // ═══ المخزون (أرصدة) — بضاعة عامة يدوية + لحوم يدوية + أرصدة فوري تراكمية (افتتاحي يدوي + ختامي محسوب) ═══
    const invStart = manualPias('mc.inv.start'), invEnd = manualPias('mc.inv.end')
    const meatInvStart = manualPias('mc.meatInv.start'), meatInvEnd = manualPias('mc.meatInv.end')
    const basicBalOpen = manualPias('mc.fawryBal.basic'), basicBalClose = basicBalOpen + basicSales
    const airBalOpen = manualPias('mc.fawryBal.air'), airBalClose = airBalOpen + airSales
    const cashoutBalOpen = manualPias('mc.fawryBal.cashout'), cashoutBalClose = cashoutBalOpen + (cashoutAddTotal - cashoutDiscountTotal)

    return {
      // توافق خلفي مع تقرير التقفيل السنوي (نفس أسماء الحقول القديمة)
      shiftsCount: shifts.length, itemsCount: tx.length,
      totalIn: tx.reduce((a, t) => a + t.amountIn, 0), totalOut: tx.reduce((a, t) => a + t.amountOut, 0),
      posSales, fawrySales, visaSales, cashierAdded: fundCashIn, mgmtSpent: fundExpenses,
      cashOpening: fundOpening, cashClosing: fundClosing,
      invStart, invEnd, invDiff: invEnd - invStart,
      employees: empFin.length, dueSalaries: empFin.reduce((a, f) => a + (f.dueSalary ?? 0), 0),
      // الأقسام التفصيلية الجديدة (شيت حورس)
      totalSales, meatSales, deliverySales,
      purchasesGeneral, purchaseReturns, shipping, meatPurchases, poultryPurchases, productWaste,
      salesDiscounts, surplus, deficit, meatProduction, poultryProduction, cheeseProduction, salesReturns,
      wages, rent, assetDepreciation, water, electricity, insurance, facilities, govFees, phoneInternet, maintenance, officeSupplies, cleaningExpenses, packagingTools,
      basicSales, airSales, fawryProfitability, fawryToBasicTotal, fawryToAirTotal,
      fawryCommission, cashoutAddTotal, cashoutDiscountTotal, commissionRatio, cashoutToBasicTotal, cashoutToAirTotal,
      fundOpening, fundExpenses, fundClosing, fundCashIn, netProfit,
      meatInvStart, meatInvEnd, basicBalOpen, basicBalClose, airBalOpen, airBalClose, cashoutBalOpen, cashoutBalClose,
    }
  }, [shifts, allTxs, empFin, fawryMap, settingsMap, month])

  async function closeMonth() {
    setBusy(true)
    try {
      await call(api.monthlyClose.save(month, JSON.stringify(D)))
      show('تم تقفيل شهر ' + month + ' وحفظه', 'success')
      await reload()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setBusy(false) }
  }

  async function exportClosePDF(monthStr: string, data: typeof D) {
    try {
      const rows: [string, string][] = [
        ['— إيرادات —', ''],
        ['اجمالي مبيعات', fmt(data.totalSales) + ' ج'], ['مبيعات منتجات', fmt(data.posSales) + ' ج'],
        ['مبيعات فوري', fmt(data.fawrySales) + ' ج'], ['مبيعات لحوم', fmt(data.meatSales) + ' ج'], ['مبيعات دليفري', fmt(data.deliverySales) + ' ج'],
        ['— مصاريف مشتريات —', ''],
        ['مشتريات', fmt(data.purchasesGeneral) + ' ج'], ['مرتجع مشتريات', fmt(data.purchaseReturns) + ' ج'],
        ['شحن ونقل', fmt(data.shipping) + ' ج'], ['مشتريات لحوم', fmt(data.meatPurchases) + ' ج'],
        ['مشتريات فراخ', fmt(data.poultryPurchases) + ' ج'], ['هوالك منتجات', fmt(data.productWaste) + ' ج'],
        ['— مصاريف مبيعات —', ''],
        ['خصومات البيع', fmt(data.salesDiscounts) + ' ج'], ['اوفر', fmt(data.surplus) + ' ج'], ['عجز', fmt(data.deficit) + ' ج'],
        ['انتاج لحوم', fmt(data.meatProduction) + ' ج'], ['انتاج فراخ', fmt(data.poultryProduction) + ' ج'],
        ['انتاج جبن', fmt(data.cheeseProduction) + ' ج'], ['مرتجع مبيعات', fmt(data.salesReturns) + ' ج'],
        ['— مصاريف إدارية —', ''],
        ['أجور', fmt(data.wages) + ' ج'], ['ايجار', fmt(data.rent) + ' ج'], ['اهلاك أصول', fmt(data.assetDepreciation) + ' ج'],
        ['مياة', fmt(data.water) + ' ج'], ['كهرباء', fmt(data.electricity) + ' ج'], ['تأمينات', fmt(data.insurance) + ' ج'],
        ['مرافق', fmt(data.facilities) + ' ج'], ['مصاريف حكومية', fmt(data.govFees) + ' ج'], ['تليفون وانترنت', fmt(data.phoneInternet) + ' ج'],
        ['صيانة', fmt(data.maintenance) + ' ج'], ['أدوات مكتبية', fmt(data.officeSupplies) + ' ج'],
        ['مصاريف نظافة', fmt(data.cleaningExpenses) + ' ج'], ['أدوات تغليف', fmt(data.packagingTools) + ' ج'],
        ['— ماكينة فوري —', ''],
        ['مبيعات اساسي', fmt(data.basicSales) + ' ج'], ['مبيعات اير تايم', fmt(data.airSales) + ' ج'], ['ربحية فوري', fmt(data.fawryProfitability) + ' ج'],
        ['من فوري للاساسي', fmt(data.fawryToBasicTotal) + ' ج'], ['من فوري للايرتايم', fmt(data.fawryToAirTotal) + ' ج'],
        ['— حساب الكاش اوت —', ''],
        ['مبيعات فيزا', fmt(data.visaSales) + ' ج'], ['عمولة فوري', fmt(data.fawryCommission) + ' ج'],
        ['اضافة كاش اوت', fmt(data.cashoutAddTotal) + ' ج'], ['خصم كاش اوت', fmt(data.cashoutDiscountTotal) + ' ج'],
        ['ميزان النسبة', data.commissionRatio.toFixed(2) + '%'],
        ['من كاش للرئيسي', fmt(data.cashoutToBasicTotal) + ' ج'], ['من كاش للايرتايم', fmt(data.cashoutToAirTotal) + ' ج'],
        ['— الصندوق —', ''],
        ['رصيد سابق', fmt(data.fundOpening) + ' ج'], ['مصروفات', fmt(data.fundExpenses) + ' ج'],
        ['رصيد اخر', fmt(data.fundClosing) + ' ج'], ['نقدية', fmt(data.fundCashIn) + ' ج'],
        ['ارباح مرحلة', prevNetProfit !== null ? fmt(prevNetProfit) + ' ج' : '—'],
      ]
      const JPEG_Q = 0.85
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
      pdf.addImage(canvas.toDataURL('image/jpeg', JPEG_Q), 'JPEG', 8, 8, imgW, imgH)
      pdf.save('تقفيل-شهري-' + monthStr + '.pdf')
      document.body.removeChild(container)
    } catch (e) { console.error(e) }
  }

  // صف عادي (البيان يمين، القيمة يسار — تناسق مع اتجاه RTL)
  function Line({ label, value, accent }: { label: string; value: number; accent?: string }) {
    return (
      <tr className="tr">
        <td className="td" style={{ color: 'var(--txt-2)' }}>{label}</td>
        <td className="td text-left tabular-nums font-bold" style={{ color: accent ?? 'var(--txt-1)' }}>
          {value === 0 ? <span style={{ color: 'var(--txt-3)' }}>—</span> : `${fmt(value)} ج`}
        </td>
      </tr>
    )
  }
  function EditableLine({ label, settingKey }: { label: string; settingKey: string }) {
    const val = manualPias(settingKey)
    const [v, setV] = useState(String(val / 100))
    useEffect(() => { setV(String(val / 100)) }, [val])
    return (
      <tr className="tr">
        <td className="td" style={{ color: '#4ade80' }}>✎ {label}</td>
        <td className="td text-left">
          <input value={v} onChange={e => setV(e.target.value)} onBlur={() => saveManual(settingKey, v)}
            className="tabular-nums font-bold text-left w-28" style={{
              background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.35)',
              borderRadius: 6, padding: '3px 8px', color: '#4ade80', fontSize: 13, outline: 'none',
            }} />
        </td>
      </tr>
    )
  }
  function SectionHeader({ label, color, bg }: { label: string; color: string; bg: string }) {
    return <tr><td colSpan={2} className="text-center font-extrabold" style={{ padding: '7px 12px', background: bg, color, fontSize: 12.5 }}>{label}</td></tr>
  }

  const cards = [
    { label: 'اجمالي مبيعات', value: fmt(D.totalSales) + ' ج', color: '#3b82f6' },
    { label: 'مبيعات فوري', value: fmt(D.fawrySales) + ' ج', color: '#8b5cf6' },
    { label: 'مبيعات فيزا', value: fmt(D.visaSales) + ' ج', color: '#06b6d4' },
    { label: 'ميزان النسبة (عمولة فوري)', value: D.commissionRatio.toFixed(2) + '%', color: '#f59e0b' },
    { label: 'رصيد اخر الصندوق', value: fmt(D.fundClosing) + ' ج', color: '#22c55e' },
    { label: 'صافي الربح', value: fmt(D.netProfit) + ' ج', color: D.netProfit >= 0 ? '#22c55e' : '#ef4444' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.18)', color: '#8b5cf6' }}>
          <Icons.Lock size={18} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--txt-1)' }}>تقارير التقفيل الشهري</div>
          <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>بنفس تنسيق وحسابات شيت التقفيل المرجعي — يُحفظ للرجوع إليه</div>
        </div>
        <button onClick={closeMonth} disabled={busy} className="btn-primary mr-auto" style={{ fontSize: 12, padding: '8px 18px' }}>
          {busy ? <><Icons.Refresh size={13} className="animate-spin" /> جاري...</> : <><Icons.Lock size={13} /> تقفيل شهر {month}</>}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(c => (
          <div key={c.label} className="rounded-2xl p-4" style={{ background: c.color + '12', border: '1px solid ' + c.color + '40' }}>
            <div className="text-2xs mb-1 font-bold" style={{ color: c.color }}>{c.label}</div>
            <div className="tabular-nums font-bold" style={{ fontSize: 17, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* الجدول الرئيسي — نفس بنية شيت حورس بالكامل: البيان | القيمة */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10"><tr>
            <th className="th">البيان</th>
            <th className="th text-left">القيمة</th>
          </tr></thead>
          <tbody>
            <SectionHeader label="إيرادات" color="#854d0e" bg="rgba(234,179,8,0.22)" />
            <Line label="اجمالي مبيعات" value={D.totalSales} accent="#3b82f6" />
            <Line label="مبيعات منتجات" value={D.posSales} />
            <Line label="مبيعات فوري" value={D.fawrySales} />
            <Line label="مبيعات لحوم" value={D.meatSales} />
            <Line label="مبيعات دليفري" value={D.deliverySales} />

            <SectionHeader label="مصاريف مشتريات" color="#854d0e" bg="rgba(234,179,8,0.22)" />
            <Line label="مشتريات" value={D.purchasesGeneral} />
            <Line label="مرتجع مشتريات" value={D.purchaseReturns} />
            <Line label="شحن ونقل" value={D.shipping} />
            <Line label="مشتريات لحوم" value={D.meatPurchases} />
            <Line label="مشتريات فراخ" value={D.poultryPurchases} />
            <Line label="هوالك منتجات" value={D.productWaste} />

            <SectionHeader label="مصاريف مبيعات" color="#334155" bg="rgba(148,163,184,0.25)" />
            <Line label="خصومات البيع" value={D.salesDiscounts} />
            <Line label="اوفر" value={D.surplus} accent="#22c55e" />
            <Line label="عجز" value={D.deficit} accent="#ef4444" />
            <Line label="انتاج لحوم" value={D.meatProduction} />
            <Line label="انتاج فراخ" value={D.poultryProduction} />
            <Line label="انتاج جبن" value={D.cheeseProduction} />
            <Line label="مرتجع مبيعات" value={D.salesReturns} />

            <SectionHeader label="مصاريف إدارية" color="#854d0e" bg="rgba(234,179,8,0.22)" />
            <Line label="أجور" value={D.wages} />
            <Line label="ايجار" value={D.rent} />
            <Line label="اهلاك أصول" value={D.assetDepreciation} />
            <Line label="مياة" value={D.water} />
            <Line label="كهرباء" value={D.electricity} />
            <Line label="تأمينات" value={D.insurance} />
            <Line label="مرافق" value={D.facilities} />
            <Line label="مصاريف حكومية" value={D.govFees} />
            <Line label="تليفون وانترنت" value={D.phoneInternet} />
            <Line label="صيانة" value={D.maintenance} />
            <Line label="أدوات مكتبية" value={D.officeSupplies} />
            <Line label="مصاريف نظافة" value={D.cleaningExpenses} />
            <Line label="أدوات تغليف" value={D.packagingTools} />

            <SectionHeader label="ماكينة فوري" color="#854d0e" bg="rgba(234,179,8,0.22)" />
            <Line label="مبيعات اساسي" value={D.basicSales} />
            <Line label="مبيعات اير تايم" value={D.airSales} />
            <Line label="ربحية فوري" value={D.fawryProfitability} />
            <Line label="من فوري للاساسي" value={D.fawryToBasicTotal} />
            <Line label="من فوري للايرتايم" value={D.fawryToAirTotal} />

            <SectionHeader label="حساب الكاش اوت" color="#854d0e" bg="rgba(234,179,8,0.22)" />
            <Line label="مبيعات فيزا" value={D.visaSales} />
            <Line label="عمولة فوري" value={D.fawryCommission} />
            <Line label="اضافة كاش اوت" value={D.cashoutAddTotal} accent="#22c55e" />
            <Line label="خصم كاش اوت" value={D.cashoutDiscountTotal} accent="#ef4444" />
            <tr className="tr">
              <td className="td" style={{ color: 'var(--txt-2)' }}>ميزان النسبة</td>
              <td className="td text-left tabular-nums font-bold" style={{ color: '#f59e0b' }}>{D.commissionRatio.toFixed(2)}%</td>
            </tr>
            <Line label="من كاش للرئيسي" value={D.cashoutToBasicTotal} />
            <Line label="من كاش للايرتايم" value={D.cashoutToAirTotal} />

            <SectionHeader label="الصندوق" color="#7c2d12" bg="rgba(249,115,22,0.22)" />
            <Line label="رصيد سابق" value={D.fundOpening} />
            <Line label="مصروفات" value={D.fundExpenses} accent="#ef4444" />
            <Line label="رصيد اخر" value={D.fundClosing} accent="#22c55e" />
            <Line label="نقدية" value={D.fundCashIn} />
            <tr className="tr">
              <td className="td" style={{ color: 'var(--txt-2)' }}>ارباح مرحلة <span className="text-2xs" style={{ color: 'var(--txt-3)' }}>(صافي ربح الشهر السابق)</span></td>
              <td className="td text-left tabular-nums font-bold" style={{ color: 'var(--txt-1)' }}>
                {prevNetProfit !== null ? `${fmt(prevNetProfit)} ج` : <span className="text-2xs" style={{ color: 'var(--txt-3)' }}>الشهر السابق غير مُقفل</span>}
              </td>
            </tr>

            <SectionHeader label="المخزون (أرصدة)" color="#854d0e" bg="rgba(234,179,8,0.22)" />
            <EditableLine label="رصيد اول منتجات" settingKey="mc.inv.start" />
            <EditableLine label="رصيد اخر منتجات" settingKey="mc.inv.end" />
            <EditableLine label="رصيد اول لحوم" settingKey="mc.meatInv.start" />
            <EditableLine label="رصيد اخر لحوم" settingKey="mc.meatInv.end" />
            <EditableLine label="رصيد اول اساسي" settingKey="mc.fawryBal.basic" />
            <Line label="رصيد اخر اساسي" value={D.basicBalClose} />
            <EditableLine label="رصيد اول ايرتايم" settingKey="mc.fawryBal.air" />
            <Line label="رصيد اخر ايرتايم" value={D.airBalClose} />
            <EditableLine label="رصيد اول كاش اوت" settingKey="mc.fawryBal.cashout" />
            <Line label="رصيد اخر كاش اوت" value={D.cashoutBalClose} />
          </tbody>
        </table>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
          <span style={{ fontSize: 14 }}>📦</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>سجل الأشهر المقفلة ({saved.length})</span>
        </div>
        {saved.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: 'var(--txt-3)' }}>لا توجد أشهر مقفلة بعد — اضغط "تقفيل شهر" لحفظ أول تقرير</div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--inner-border)' }}>
            {saved.map(r => {
              const d = (() => { try { return JSON.parse(r.data_json) } catch { return D } })()
              return (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                  <span className="text-2xs px-2 py-0.5 rounded-md font-bold" style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>{r.month}</span>
                  <span className="text-xs" style={{ color: 'var(--txt-2)' }}>{d.shiftsCount} شيفت · {d.itemsCount} بند</span>
                  <span className="tabular-nums text-xs mr-auto" style={{ color: '#22c55e' }}>مبيعات {fmt(d.totalSales ?? d.posSales ?? 0)}</span>
                  <span className="tabular-nums text-xs font-bold" style={{ color: (d.netProfit ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>صافي {fmt(d.netProfit ?? 0)}</span>
                  <button onClick={() => exportClosePDF(r.month, d)} className="btn-next btn-sm" style={{ fontSize: 10, padding: '3px 10px' }}>📄 PDF</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
