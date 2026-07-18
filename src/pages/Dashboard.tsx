import { useState, useEffect, useMemo } from 'react'
import { api, call } from '../lib/api'
import Icons from '../components/Icon'
import { MiniCombo, MiniDonut } from '../components/MiniChart'
import { fmt, fmtDate, shiftTypeLabel } from '../lib/format'
import { calcFawryWithCommission, calcShiftClosing } from '../../core/engine'
import type { Shift, Transaction, ShiftCustody, Setting } from '../../core/types'

// ═══════════════════════════════════════════════════════════
// لوحة المعلومات — تخطيط ERP بثلاثة أعمدة ثابتة (يسار 25% / وسط 50% / يمين 25%)
// كل الحسابات والمنطق البرمجي كما هي بلا أي تغيير — إعادة توزيع بصري فقط.
// حالة الشيفت من المعادلة الرسمية الموحّدة (core/engine).
// ═══════════════════════════════════════════════════════════

type FilterMode = 'all' | 'year' | 'month' | 'day'
type FawryClose = { programSales: number; commissionPct: number }
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const PANEL_H = 460 // ارتفاع موحّد (بكسل) لتحليل المبيعات + اتجاه آخر 12 شهر + جدول الشيفتات — تمرير داخلي عند تجاوز المحتوى له
const ROW2_H = 220 // ارتفاع موحّد (بكسل) لعداد الأوفر/العجز + الرسم البياني + مؤشر المبيعات (الصف الثاني)

export default function Dashboard() {
  const [allShifts, setAllShifts] = useState<Shift[]>([])
  const [allTxs, setAllTxs] = useState<Transaction[]>([])
  const [fawryMap, setFawryMap] = useState<Record<number, FawryClose>>({})
  const [custodyMap, setCustodyMap] = useState<Record<number, ShiftCustody>>({})
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({})
  const [partyCounts, setPartyCounts] = useState({ customers: 0, suppliers: 0 })
  const [loading, setLoading] = useState(true)
  const [activeShift, setActiveShift] = useState<Shift | null>(null)
  const [pendingUpdate, setPendingUpdate] = useState<{ version: string } | null>(null)

  useEffect(() => {
    call(api.update.pending()).then(setPendingUpdate as (d: unknown) => void).catch(() => {})
    const off = window.api.update.on('available', (d: unknown) => setPendingUpdate({ version: (d as { version?: string })?.version || '' }))
    return () => { off && off() }
  }, [])

  const now = new Date()
  const [filterMode, setFilterMode] = useState<FilterMode>('month')
  const [filterYear, setFilterYear] = useState(now.getFullYear())
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1)
  const [filterDay, setFilterDay] = useState(now.toISOString().slice(0, 10))

  // v2.33.0 — رصيد الصندوق الحقيقي (نقاط الارتكاز) لمدى الفترة المعروضة — بديل حساب "fund.prev" القديم المعطَّل
  const [treasuryPos, setTreasuryPos] = useState({ opening: 0, incoming: 0, outgoing: 0, closing: 0 })
  useEffect(() => {
    let from: string, toExclusive: string
    if (filterMode === 'all') { from = '0000-01-01'; toExclusive = '9999-12-31' }
    else if (filterMode === 'year') { from = `${filterYear}-01-01`; toExclusive = `${filterYear + 1}-01-01` }
    else if (filterMode === 'month') { from = `${filterYear}-${String(filterMonth).padStart(2, '0')}-01`; toExclusive = new Date(filterYear, filterMonth, 1).toISOString().slice(0, 10) }
    else { from = filterDay; const d = new Date(filterDay); d.setDate(d.getDate() + 1); toExclusive = d.toISOString().slice(0, 10) }
    call(api.treasury.position(from, toExclusive)).then(setTreasuryPos as (d: unknown) => void).catch(() => {})
  }, [filterMode, filterYear, filterMonth, filterDay])

  async function loadAll() {
    setLoading(true)
    try {
      const shifts = await call(api.shifts.getAll({})) as Shift[]
      setAllShifts(shifts)
      setActiveShift(await call(api.shifts.getActive()).catch(() => null) as Shift | null)
      const ids = shifts.map(s => s.id)
      const [allTxs, fawryRows, custodyRows, settingsRows, customers, suppliers] = await Promise.all([
        call(api.tx.getByShiftIds(ids)).catch(() => []),
        call<{ shiftId: number; programSales: number; commissionPct: number }[]>(api.fawry.allClosing()).catch(() => []),
        call<ShiftCustody[]>(api.custody.getByShiftIds(ids)).catch(() => []),
        call<Setting[]>(api.settings.getAll()).catch(() => []),
        call<unknown[]>(api.party.list('customer')).catch(() => []),
        call<unknown[]>(api.party.list('supplier')).catch(() => []),
      ])
      setAllTxs(allTxs as Transaction[])
      const fm: Record<number, FawryClose> = {}
      for (const r of fawryRows) fm[r.shiftId] = { programSales: r.programSales, commissionPct: r.commissionPct }
      setFawryMap(fm)
      const cm: Record<number, ShiftCustody> = {}
      for (const c of custodyRows) cm[c.shiftId] = c
      setCustodyMap(cm)
      const sm: Record<string, string> = {}
      for (const row of settingsRows) sm[row.key] = row.value
      setSettingsMap(sm)
      setPartyCounts({ customers: customers.length, suppliers: suppliers.length })
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }
  useEffect(() => { loadAll() }, [])

  // ── تطابق فترة (الحالية والسابقة) ──
  const monthKey = `${filterYear}-${String(filterMonth).padStart(2, '0')}`
  const prevMonthKey = (() => { const d = new Date(filterYear, filterMonth - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()
  const prevDay = (() => { const d = new Date(filterDay); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) })()
  function inCur(date: string) {
    if (filterMode === 'all') return true
    if (filterMode === 'year') return date.slice(0, 4) === String(filterYear)
    if (filterMode === 'month') return date.slice(0, 7) === monthKey
    return date.slice(0, 10) === filterDay
  }
  function inPrev(date: string) {
    if (filterMode === 'year') return date.slice(0, 4) === String(filterYear - 1)
    if (filterMode === 'month') return date.slice(0, 7) === prevMonthKey
    if (filterMode === 'day') return date.slice(0, 10) === prevDay
    return false // الكل: لا مقارنة
  }

  const fawryWith = (s: Shift) => { const f = fawryMap[s.id]; return f ? calcFawryWithCommission(f.programSales, f.commissionPct) : 0 }

  const txByShift = useMemo(() => {
    const m: Record<number, Transaction[]> = {}
    for (const t of allTxs) (m[t.shiftId] ||= []).push(t)
    return m
  }, [allTxs])

  // نتيجة شيفت — المعادلة الرسمية الموحّدة
  function resultOf(s: Shift) {
    const tx = txByShift[s.id] ?? []
    const collections = tx.filter(t => t.mainCategoryName === 'تحصيل').reduce((a, t) => a + t.amountIn + t.amountOut, 0)
    const cashierExpenses = tx.filter(t => t.payMethod === 'cashier' && t.mainCategoryName !== 'تحصيل').reduce((a, t) => a + t.amountIn + t.amountOut, 0)
    return calcShiftClosing({ posSales: s.posSales ?? 0, cashierRemaining: s.cashierRemaining ?? 0, cashierExpenses, collections })
  }
  const saleOf = (s: Shift) => (s.posSales ?? 0) + fawryWith(s)

  // ── تجميع الفترة الحالية ──
  const M = useMemo(() => {
    const cur = allShifts.filter(s => inCur(s.date))
    const curIds = new Set(cur.map(s => s.id))
    const tx = allTxs.filter(t => curIds.has(t.shiftId))
    const outByMain = (name: string) => tx.filter(t => t.mainCategoryName === name).reduce((a, t) => a + t.amountOut, 0)
    const outByMainSub = (main: string, sub: string) => tx.filter(t => t.mainCategoryName === main && t.subCategoryName === sub).reduce((a, t) => a + t.amountOut, 0)
    const inBySub = (name: string) => tx.filter(t => t.subCategoryName === name).reduce((a, t) => a + t.amountIn + t.amountOut, 0)
    const countBySub = (name: string) => tx.filter(t => t.subCategoryName === name).length

    const posOnly = cur.reduce((a, s) => a + (s.posSales ?? 0), 0)
    const fawryOnly = cur.reduce((a, s) => a + fawryWith(s), 0)
    const sales = posOnly + fawryOnly
    const prevSales = allShifts.filter(s => inPrev(s.date)).reduce((a, s) => a + saleOf(s), 0)
    const purchases = outByMain('مشتريات')
    const meatPurchases = outByMainSub('مشتريات', 'مشتريات اللحوم')
    // v2.33.0 — "أجور" دُمجت داخل "مصروفات" (رواتب موظفين/سلفة موظف كتصنيفات فرعية)؛ تُستبعَد من
    // إجمالي "مصروفات" العام وتُحسب منفردة هنا لتفادي احتسابها مرتين في totalExpensesAll تحت
    const expenses = tx.filter(t => t.mainCategoryName === 'مصروفات' && t.subCategoryName !== 'رواتب موظفين' && t.subCategoryName !== 'سلفة موظف').reduce((a, t) => a + t.amountOut, 0)
    const wages = outByMainSub('مصروفات', 'رواتب موظفين') + outByMainSub('مصروفات', 'سلفة موظف')
    const collections = tx.filter(t => t.mainCategoryName === 'تحصيل').reduce((a, t) => a + t.amountIn, 0)
    const visa = inBySub('مبيعات فيزا')
    const credit = inBySub('مبيعات آجل')
    const delivery = inBySub('مبيعات توصيل')
    const deliveryCount = countBySub('مبيعات توصيل')
    const meatSales = inBySub('مبيعات لحوم')
    const fawryCommissionProfit = cur.reduce((a, s) => { const f = fawryMap[s.id]; return a + (f ? Math.round(f.programSales * f.commissionPct / 10000) : 0) }, 0)
    const cashierCash = cur.reduce((a, s) => a + (s.cashierRemaining ?? 0), 0)

    let surplus = 0, deficit = 0, balanced = 0, net = 0
    let best: { s: Shift; sale: number } | null = null
    let worst: { s: Shift; sale: number } | null = null
    for (const s of cur) {
      const { result, status } = resultOf(s); net += result
      if (status === 'surplus') surplus++; else if (status === 'deficit') deficit++; else balanced++
      const sale = saleOf(s)
      if (!best || sale > best.sale) best = { s, sale }
      if (!worst || sale < worst.sale) worst = { s, sale }
    }

    const payDist = (['cashier', 'management'] as const).map(pm => {
      const list = tx.filter(t => t.payMethod === pm)
      return { method: pm, val: list.reduce((a, t) => a + t.amountIn + t.amountOut, 0), count: list.length }
    })

    // حساب العهدة (تجميع الفترة)
    const custodyAdd  = cur.reduce((a, s) => a + (custodyMap[s.id]?.addFromFund ?? 0), 0)
    const custodyPaid = cur.reduce((a, s) => a + (custodyMap[s.id]?.managementPaid ?? 0), 0)

    // حساب الكاشير (تجميع الفترة)
    const cashierPayVal = payDist.find(d => d.method === 'cashier')?.val ?? 0
    const cashierNet = cashierPayVal - custodyPaid

    // حسابات المشتريات (فواتير)
    const purchaseTx = tx.filter(t => t.mainCategoryName === 'مشتريات')
    const purchaseInvoiceCount = purchaseTx.length
    const avgInvoice = purchaseInvoiceCount ? purchases / purchaseInvoiceCount : 0
    const maxInvoice = purchaseTx.reduce((mx, t) => Math.max(mx, t.amountOut), 0)

    // مؤشرات مباشرة (ربحية)
    const totalRevenue = sales
    const totalExpensesAll = purchases + expenses + wages
    const netProfit = totalRevenue - totalExpensesAll
    const profitMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

    // مؤشرات إضافية
    const avgTxValue = tx.length ? tx.reduce((a, t) => a + t.amountIn + t.amountOut, 0) / tx.length : 0
    const avgCashPerShift = cur.length ? cashierCash / cur.length : 0

    return {
      cur, sales, posOnly, fawryOnly, prevSales, purchases, meatPurchases, expenses, wages,
      collections, visa, credit, delivery, deliveryCount, meatSales, fawryCommissionProfit, cashierCash,
      surplus, deficit, balanced, net, best, worst, payDist, itemsCount: tx.length,
      custodyAdd, custodyPaid, cashierPayVal, cashierNet,
      purchaseInvoiceCount, avgInvoice, maxInvoice,
      totalRevenue, totalExpensesAll, netProfit, profitMarginPct,
      avgTxValue, avgCashPerShift,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allShifts, allTxs, fawryMap, custodyMap, settingsMap, filterMode, filterYear, filterMonth, filterDay, txByShift])

  const periodLabel = filterMode === 'all' ? 'كل الفترات' : filterMode === 'year' ? `سنة ${filterYear}` : filterMode === 'month' ? `${filterMonth}/${filterYear}` : `يوم ${fmtDate(filterDay)}`
  const salesDelta = M.sales - M.prevSales
  const growthPct = M.prevSales !== 0 ? (salesDelta / Math.abs(M.prevSales)) * 100 : (M.sales > 0 ? 100 : 0)

  const years: number[] = []; for (let y = now.getFullYear() + 1; y >= 2024; y--) years.push(y)

  // ═══ جدول اتجاه 12 شهر — يناير ← ديسمبر لسنة الفلتر أعلى الصفحة (بلا تكرار السنة في كل صف) ═══
  const twelveMonths = useMemo(() => {
    const months: { key: string; label: string }[] = []
    for (let mo = 1; mo <= 12; mo++) {
      months.push({ key: `${filterYear}-${String(mo).padStart(2, '0')}`, label: MONTHS[mo - 1] })
    }
    return months.map(m => {
      const shiftsInMonth = allShifts.filter(s => s.date.slice(0, 7) === m.key)
      const ids = new Set(shiftsInMonth.map(s => s.id))
      const tx = allTxs.filter(t => ids.has(t.shiftId))
      const salesVal = shiftsInMonth.reduce((a, s) => a + saleOf(s), 0)
      const purchasesVal = tx.filter(t => t.mainCategoryName === 'مشتريات').reduce((a, t) => a + t.amountOut, 0)
      const expensesVal = tx.filter(t => t.mainCategoryName === 'مصروفات').reduce((a, t) => a + t.amountOut, 0)
      let cashVal = 0
      for (const s of shiftsInMonth) cashVal += resultOf(s).result
      const invKey = `inventory.${m.key}`
      const inventoryVal = settingsMap[invKey] ? Number(settingsMap[invKey]) : 0
      const monthNum = Number(m.key.slice(5, 7))
      const prevD = new Date(filterYear, monthNum - 2, 1)
      const prevMonthKey = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`
      const prevInvKey = `inventory.${prevMonthKey}`
      const prevInventoryVal = settingsMap[prevInvKey] ? Number(settingsMap[prevInvKey]) : 0
      const inventoryChangePct = prevInventoryVal > 0 ? ((inventoryVal - prevInventoryVal) / prevInventoryVal) * 100 : (inventoryVal > 0 ? 100 : 0)
      const prevSalesVal = allShifts.filter(s => s.date.slice(0, 7) === prevMonthKey).reduce((a, s) => a + saleOf(s), 0)
      const salesChangePct = prevSalesVal > 0 ? ((salesVal - prevSalesVal) / prevSalesVal) * 100 : (salesVal > 0 ? 100 : 0)
      const profitVal = salesVal - purchasesVal - expensesVal
      const marginVal = salesVal > 0 ? (profitVal / salesVal) * 100 : 0
      return { ...m, sales: salesVal, purchases: purchasesVal, cash: cashVal, inventory: inventoryVal, inventoryChangePct, salesChangePct, expenses: expensesVal, profit: profitVal, margin: marginVal, txCount: tx.length, shiftsCount: shiftsInMonth.length }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allShifts, allTxs, fawryMap, settingsMap, filterYear])

  // مؤشرات عامة — مبنية على نفس نافذة الـ12 شهر (لا فلتر الصفحة أعلاه)
  const generalStats = useMemo(() => {
    const withData = twelveMonths.filter(m => m.shiftsCount > 0)
    const avgMonthlySales = withData.length ? withData.reduce((a, m) => a + m.sales, 0) / withData.length : 0
    const avgMonthlyProfit = withData.length ? withData.reduce((a, m) => a + m.profit, 0) / withData.length : 0
    const itemsInWindow = twelveMonths.reduce((a, m) => a + m.txCount, 0)
    const windowKeys = new Set(twelveMonths.map(m => m.key))
    const shiftsInWindow = allShifts.filter(s => windowKeys.has(s.date.slice(0, 7)))
    let best: { s: Shift; sale: number } | null = null
    let worst: { s: Shift; sale: number } | null = null
    for (const s of shiftsInWindow) {
      const sale = saleOf(s)
      if (!best || sale > best.sale) best = { s, sale }
      if (!worst || sale < worst.sale) worst = { s, sale }
    }
    let bestMonth = withData[0] ?? null
    let worstMonth = withData[0] ?? null
    for (const m of withData) {
      if (!bestMonth || m.sales > bestMonth.sales) bestMonth = m
      if (!worstMonth || m.sales < worstMonth.sales) worstMonth = m
    }
    return { avgMonthlySales, avgMonthlyProfit, itemsInWindow, shiftsCount: shiftsInWindow.length, best, worst, bestMonth, worstMonth }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twelveMonths, allShifts, fawryMap])

  async function saveInventory(mKey: string, egp: string) {
    const val = Math.round((parseFloat(egp) || 0) * 100)
    try {
      await call(api.settings.set(`inventory.${mKey}`, String(val)))
      setSettingsMap(sm => ({ ...sm, [`inventory.${mKey}`]: String(val) }))
    } catch (e) { console.error(e) }
  }

  const chartData = twelveMonths.map(m => ({ label: m.label.split(' ')[0].slice(0, 3), in: m.sales, out: m.purchases + m.expenses, net: m.profit }))

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-2">

      {/* ═══ الرأس + الفلتر ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(59,130,246,0.18)', color: 'var(--accent)' }}>
            <Icons.Dashboard size={16} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt-1)' }}>لوحة المعلومات</div>
            <div style={{ fontSize: 10.5, color: 'var(--txt-3)' }}>
              {periodLabel} · {M.cur.length} شيفت · {M.itemsCount} بند
              {activeShift && <span style={{ color: '#22c55e' }}> · شيفت #{activeShift.monthlyShiftNum} نشط الآن</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--inner-border)' }}>
            {([['all', 'الكل'], ['year', 'سنة'], ['month', 'شهر'], ['day', 'يوم']] as [FilterMode, string][]).map(([mode, label]) => (
              <button key={mode} onClick={() => setFilterMode(mode)} className="px-2.5 py-1 transition-all"
                style={{ fontSize: 11, fontWeight: filterMode === mode ? 700 : 500, background: filterMode === mode ? 'var(--accent)' : 'transparent', color: filterMode === mode ? '#fff' : 'var(--txt-2)' }}>{label}</button>
            ))}
          </div>
          {filterMode === 'year' && <select className="field text-2xs" value={filterYear} onChange={e => setFilterYear(+e.target.value)} style={{ width: 80, padding: '4px 8px' }}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>}
          {filterMode === 'month' && <>
            <select className="field text-2xs" value={filterMonth} onChange={e => setFilterMonth(+e.target.value)} style={{ width: 95, padding: '4px 8px' }}>{MONTHS.map((mo, i) => <option key={mo} value={i + 1}>{mo}</option>)}</select>
            <select className="field text-2xs" value={filterYear} onChange={e => setFilterYear(+e.target.value)} style={{ width: 70, padding: '4px 8px' }}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
          </>}
          {filterMode === 'day' && <input className="field text-2xs" type="date" value={filterDay} onChange={e => setFilterDay(e.target.value)} style={{ width: 135, padding: '4px 8px' }} />}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16" style={{ color: 'var(--txt-3)' }}><Icons.Refresh size={24} className="animate-spin mx-auto mb-2" /> جاري تحميل البيانات...</div>
      ) : (
        <>
          {pendingUpdate ? (
            <div className="card p-0 overflow-hidden" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)' }}>
              <div className="flex items-center gap-2 px-3 py-2">
                <Icons.Refresh size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
                <div className="flex-1 min-w-0 overflow-hidden">
                  <span className="marquee-track" style={{ fontSize: 12, fontWeight: 800, color: '#ef4444' }}>
                    🔴 يتوفر إصدار جديد {pendingUpdate.version ? `v${pendingUpdate.version}` : ''} من البرنامج — يمكنك الترقية الآن للحصول على أحدث الإصلاحات والتحسينات
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="card flex items-center gap-3 p-2.5" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(30,58,138,0.06))', border: '1px solid rgba(59,130,246,0.30)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(59,130,246,0.18)', color: 'var(--accent)' }}><Icons.Dashboard size={16} /></div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--txt-1)' }}>{settingsMap['biz.name'] || 'AJ Smart Shift'}</div>
                <div style={{ fontSize: 10.5, color: 'var(--txt-2)' }}>تابع لوحة المعلومات باستمرار لمراقبة أداء نشاطك واكتشاف أي تغيّر في المبيعات أو المصروفات أو المخزون مبكراً.</div>
              </div>
            </div>
          )}

          {/* ═══ الصف الأول — 8 بطاقات مصغّرة ═══ */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <TopAccountCard title="حساب العهدة" icon={<Icons.Fund size={12} />} color="#f59e0b">
              <Stat label="الإضافات" value={`${fmt(M.custodyAdd)} ج`} color="var(--txt-1)" />
              <Stat label="المصروفات" value={`${fmt(M.custodyPaid)} ج`} color="#ef4444" />
              <Stat label="المتبقي" value={`${fmt(M.custodyAdd - M.custodyPaid)} ج`} color="#f59e0b" />
            </TopAccountCard>

            <TopAccountCard title="حساب الكاشير" icon={<Icons.User size={12} />} color="#3b82f6">
              <Stat label="نقدي" value={`${fmt(M.cashierPayVal)} ج`} color="var(--txt-1)" />
              <Stat label="فيزا" value={`${fmt(M.visa)} ج`} color="#10b981" />
              <Stat label="فوري" value={`${fmt(M.fawryOnly)} ج`} color="#a78bfa" />
              <Stat label="الصافي" value={`${fmt(M.cashierNet)} ج`} color="#3b82f6" />
            </TopAccountCard>

            <TopAccountCard title="حساب الصندوق" icon={<Icons.Backup size={12} />} color="#22c55e">
              <Stat label="رصيد البداية" value={`${fmt(treasuryPos.opening)} ج`} color="var(--txt-1)" />
              <Stat label="الوارد" value={`${fmt(treasuryPos.incoming)} ج`} color="#22c55e" />
              <Stat label="المنصرف" value={`${fmt(treasuryPos.outgoing)} ج`} color="#ef4444" />
              <Stat label="الرصيد الحالي" value={`${fmt(treasuryPos.closing)} ج`} color="#22c55e" />
            </TopAccountCard>

            <TopAccountCard title="مؤشرات عامة" icon={<Icons.Records size={12} />} color="#a78bfa" cols={3}>
              <Stat label="أعلى شهر" value={generalStats.bestMonth ? `${fmt(generalStats.bestMonth.sales)} ج` : '—'} color="#22c55e" />
              <Stat label="أقل شهر" value={generalStats.worstMonth ? `${fmt(generalStats.worstMonth.sales)} ج` : '—'} color="#ef4444" />
              <Stat label="متوسط المبيعات" value={`${fmt(generalStats.avgMonthlySales)} ج`} color="#3b82f6" />
              <Stat label="متوسط الأرباح" value={`${fmt(generalStats.avgMonthlyProfit)} ج`} color="#8b5cf6" />
              <Stat label="عدد العمليات" value={String(generalStats.itemsInWindow)} color="var(--txt-1)" />
              <Stat label="نسبة النمو" value={`${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}%`} color={growthPct >= 0 ? '#22c55e' : '#ef4444'} />
            </TopAccountCard>

            <TopAccountCard title="مؤشرات مباشرة" icon={<Icons.Reports size={12} />} color="#8b5cf6">
              <Stat label="إجمالي الإيرادات" value={`${fmt(M.totalRevenue)} ج`} color="#22c55e" />
              <Stat label="إجمالي المصروفات" value={`${fmt(M.totalExpensesAll)} ج`} color="#ef4444" />
              <Stat label="صافي الربح" value={`${fmt(M.netProfit)} ج`} color={M.netProfit >= 0 ? '#22c55e' : '#ef4444'} />
              <Stat label="نسبة الربحية" value={`${M.profitMarginPct.toFixed(1)}%`} color="#8b5cf6" />
            </TopAccountCard>

            <TopAccountCard title="مؤشرات إضافية" icon={<Icons.Employees size={12} />} color="#06b6d4">
              <Stat label="عدد العملاء" value={String(partyCounts.customers)} color="var(--txt-1)" />
              <Stat label="عدد الموردين" value={String(partyCounts.suppliers)} color="var(--txt-1)" />
              <Stat label="عدد العمليات" value={String(M.itemsCount)} color="var(--txt-1)" />
              <Stat label="متوسط العملية" value={`${fmt(M.avgTxValue)} ج`} color="#06b6d4" />
            </TopAccountCard>

            <TopAccountCard title="أفضل وأسوأ فترة" icon={<Icons.Records size={12} />} color="#d4a017">
              <Stat label="أفضل شهر" value={generalStats.bestMonth ? generalStats.bestMonth.label : '—'} color="#22c55e" />
              <Stat label="أسوأ شهر" value={generalStats.worstMonth ? generalStats.worstMonth.label : '—'} color="#ef4444" />
              <Stat label="أعلى مبيعات (شيفت)" value={`${fmt(M.best?.sale ?? 0)} ج`} color="#22c55e" />
              <Stat label="أقل مبيعات (شيفت)" value={`${fmt(M.worst?.sale ?? 0)} ج`} color="#ef4444" />
            </TopAccountCard>

            <TopAccountCard title="حسابات المشتريات" icon={<Icons.Download size={12} />} color="#f59e0b">
              <Stat label="إجمالي المشتريات" value={`${fmt(M.purchases)} ج`} color="#f59e0b" />
              <Stat label="عدد الفواتير" value={String(M.purchaseInvoiceCount)} color="var(--txt-1)" />
              <Stat label="متوسط الفاتورة" value={`${fmt(M.avgInvoice)} ج`} color="var(--txt-1)" />
              <Stat label="أعلى فاتورة" value={`${fmt(M.maxInvoice)} ج`} color="#f59e0b" />
            </TopAccountCard>
          </div>

          {/* ═══ ثلاثة أعمدة ثابتة: يسار · وسط · يمين — الأجزاء الثلاثة بنفس الارتفاع الموحّد PANEL_H مع تمرير داخلي عند الحاجة ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr_1.7fr] gap-2 items-start">

            {/* ═══ العمود الأيسر (أقصى يمين الشاشة) — تحليل المبيعات ═══ */}
            <div className="space-y-1.5">
              <SalesAnalysis M={M} />
              <SalesDonut M={M} />
            </div>

            {/* ═══ المنطقة الوسطى — أهم منطقة بصرية (بلا تمرير داخلي — تمرير الصفحة فقط) ═══ */}
            <div className="space-y-1.5">
              <div className="card p-0 overflow-hidden flex flex-col" style={{ height: PANEL_H }}>
                <div className="px-3 py-1.5 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
                  <div className="flex items-center gap-1.5"><Icons.Reports size={12} style={{ color: 'var(--accent)' }} /><span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt-1)' }}>اتجاه آخر 12 شهر</span></div>
                  <span className="text-2xs" style={{ color: 'var(--txt-3)' }}>المخزون يُدخل يدوياً لكل شهر</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-2xs dash-compact-table">
                    <thead className="sticky top-0 z-10"><tr>
                      <th className="th">الشهر</th>
                      <th className="th" style={{ color: '#22c55e' }}>مبيعات</th>
                      <th className="th" style={{ color: '#3b82f6' }}>% مقارنة بالشهر السابق</th>
                      <th className="th" style={{ color: '#ef4444' }}>مصروفات</th>
                      <th className="th" style={{ color: '#f59e0b' }}>مشتريات</th>
                      <th className="th" style={{ color: '#a78bfa' }}>مخزون</th>
                      <th className="th" style={{ color: '#8b5cf6' }}>% حركة المخزون</th>
                    </tr></thead>
                    <tbody>
                      {twelveMonths.map(m => (
                        <tr key={m.key} className="tr">
                          <td className="td font-bold">{m.label}</td>
                          <td className="td tabular-nums" style={{ color: '#22c55e' }}>{fmt(m.sales)}</td>
                          <td className="td tabular-nums" style={{ color: m.salesChangePct >= 0 ? '#22c55e' : '#ef4444' }}>{m.salesChangePct >= 0 ? '+' : ''}{m.salesChangePct.toFixed(1)}%</td>
                          <td className="td tabular-nums" style={{ color: '#ef4444' }}>{fmt(m.expenses)}</td>
                          <td className="td tabular-nums" style={{ color: '#f59e0b' }}>{fmt(m.purchases)}</td>
                          <td className="td"><InventoryCell value={m.inventory} onSave={v => saveInventory(m.key, v)} /></td>
                          <td className="td tabular-nums" style={{ color: m.inventoryChangePct >= 0 ? '#22c55e' : '#ef4444' }}>{m.inventoryChangePct >= 0 ? '+' : ''}{m.inventoryChangePct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card p-2 flex flex-col" style={{ height: ROW2_H }}>
                <CardTitle icon={<Icons.Reports size={13} />} title="المبيعات والمصروفات والأرباح — آخر 12 شهر" color="#3b82f6" />
                <div className="flex-1 flex flex-col justify-center">
                  <MiniCombo data={chartData} height={140} formatter={v => `${fmt(v)} ج`} />
                </div>
              </div>
            </div>

            {/* ═══ العمود الأيمن (أقصى يسار الشاشة) — جدول الشيفتات ═══ */}
            <div className="space-y-1.5">
              <div className="card p-0 overflow-hidden flex flex-col" style={{ height: PANEL_H }}>
                <div className="px-3 py-1.5 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
                  <div className="flex items-center gap-1.5"><Icons.Records size={12} style={{ color: 'var(--accent)' }} /><span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt-1)' }}>الشيفتات ({M.cur.length})</span></div>
                  <span className="tabular-nums text-2xs" style={{ color: '#22c55e' }}>مبيعات {fmt(M.sales)} ج</span>
                </div>
                {M.cur.length === 0 ? (
                  <div className="text-center py-6 text-2xs" style={{ color: 'var(--txt-3)' }}>لا توجد شيفتات في هذه الفترة</div>
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-2xs dash-compact-table">
                      <thead className="sticky top-0 z-10"><tr>
                        <th className="th">#</th><th className="th">التاريخ</th><th className="th">النوع</th><th className="th">الكاشير</th>
                        <th className="th" style={{ color: '#22c55e' }}>المبيعات</th><th className="th">الحالة</th>
                      </tr></thead>
                      <tbody>
                        {[...M.cur].reverse().map(s => {
                          const { result, status } = resultOf(s)
                          const col = status === 'surplus' ? '#10b981' : status === 'deficit' ? '#ef4444' : '#f59e0b'
                          const lbl = status === 'surplus' ? 'أوفر' : status === 'deficit' ? 'عجز' : 'مطابق'
                          return (
                            <tr key={s.id} className="tr">
                              <td className="td font-bold" style={{ color: 'var(--accent)' }}>#{s.monthlyShiftNum}</td>
                              <td className="td tabular-nums">{fmtDate(s.date)}</td>
                              <td className="td">{shiftTypeLabel(s.type)}</td>
                              <td className="td">{s.cashierName}</td>
                              <td className="td tabular-nums" style={{ color: '#22c55e' }}>{fmt(saleOf(s))}</td>
                              <td className="td"><span className="text-2xs px-2 py-0.5 rounded-full font-bold" style={{ background: col + '22', color: col }}>{lbl} {result !== 0 && `(${fmt(Math.abs(result))})`}</span></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <NetGauge value={M.net} surplus={M.surplus} deficit={M.deficit} balanced={M.balanced} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ═══ مكوّنات مشتركة ═══

function CardTitle({ icon, title, color = '#3b82f6' }: { icon: React.ReactNode; title: string; color?: string }) {
  return <div className="flex items-center gap-1.5 mb-2 pb-1.5" style={{ borderBottom: '1px solid var(--inner-border)' }}><span style={{ color }}>{icon}</span><span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--txt-1)' }}>{title}</span></div>
}

/** بطاقة حساب مصغّرة للصف الأول — عنوان + شبكة صغيرة من القيم (نفس الارتفاع للأربعة) */
function TopAccountCard({ title, icon, color, cols = 2, children }: { title: string; icon: React.ReactNode; color: string; cols?: 2 | 3; children: React.ReactNode }) {
  return (
    <div className="card p-2" style={{ borderTop: `2px solid ${color}` }}>
      <CardTitle icon={icon} title={title} color={color} />
      <div className={cols === 3 ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>{children}</div>
    </div>
  )
}

/** عدّاد نصف دائري صغير للأوفر/العجز الإجمالي — أعلى العمود الأيمن */
function NetGauge({ value, surplus, deficit, balanced }: { value: number; surplus: number; deficit: number; balanced: number }) {
  const scale = Math.max(Math.abs(value) * 1.25, 100000)
  const ratio = Math.max(-1, Math.min(1, value / scale))
  const angle = ratio * 80
  const label = value > 0 ? 'أوفر' : value < 0 ? 'عجز' : 'مطابق'
  const color = value > 0 ? '#22c55e' : value < 0 ? '#ef4444' : '#f59e0b'
  const segs = ['#ef4444', '#f97316', '#fbbf24', '#84cc16', '#22c55e']
  const segPaths = [
    'M 22 100 A 78 78 0 0 1 35.3 56.4',
    'M 36.9 54.1 A 78 78 0 0 1 73.3 26.7',
    'M 75.9 25.8 A 78 78 0 0 1 121.5 25.0',
    'M 124.1 25.8 A 78 78 0 0 1 161.5 52.0',
    'M 163.1 54.1 A 78 78 0 0 1 178.0 97.3',
  ]
  return (
    <div className="card p-2 flex flex-col items-center" style={{ height: ROW2_H }}>
      <div className="w-full flex items-center justify-between mb-0.5">
        <span className="text-2xs font-bold" style={{ color: 'var(--txt-2)' }}>حالة الأوفر/العجز</span>
        <span className="text-2xs font-black" style={{ color }}>{label}</span>
      </div>
      <div className="flex-1 flex items-center gap-3 w-full">
        <svg viewBox="0 0 200 118" style={{ width: 70, flexShrink: 0 }}>
          {segPaths.map((d, i) => <path key={i} d={d} fill="none" stroke={segs[i]} strokeWidth={13} strokeLinecap="round" opacity={0.92} />)}
          <g transform={`rotate(${angle} 100 100)`} style={{ transition: 'transform 0.6s cubic-bezier(0.34,1.56,0.64,1)' }}>
            <line x1="100" y1="100" x2="100" y2="34" stroke="var(--txt-1)" strokeWidth="4" strokeLinecap="round" />
          </g>
          <circle cx="100" cy="100" r="7" fill="var(--txt-1)" />
          <circle cx="100" cy="100" r="3" fill={color} />
        </svg>
        <div className="tabular-nums font-black flex-shrink-0" style={{ fontSize: 15, color }}>{fmt(Math.abs(value))} <span style={{ fontSize: 9.5 }}>ج</span></div>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--inner-border)' }} />
        <div className="flex-1 flex items-center justify-around">
          <MiniCount label="شيفتات أوفر" value={surplus} color="#22c55e" />
          <MiniCount label="شيفتات عجز" value={deficit} color="#ef4444" />
          <MiniCount label="شيفتات مطابقة" value={balanced} color="#f59e0b" />
        </div>
      </div>
    </div>
  )
}

/** تسمية + قيمة مصغّرة — تُستخدم داخل بطاقات TopAccountCard */
function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-2xs mb-0.5" style={{ color: 'var(--txt-3)' }}>{label}</div>
      <div className="tabular-nums font-bold truncate" style={{ fontSize: 12.5, color }}>{value}</div>
    </div>
  )
}

/** شريحة عدّاد مصغّرة رأسية (قيمة كبيرة + تسمية أسفلها) — تُستخدم داخل NetGauge */
function MiniCount({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="tabular-nums font-black" style={{ fontSize: 15, color }}>{value}</div>
      <div className="text-2xs" style={{ color: 'var(--txt-3)' }}>{label}</div>
    </div>
  )
}

/** بطاقة تحليل المبيعات — دونات + جدول احترافي بدل البطاقات المتفرقة (العمود الأيمن) */
function SalesAnalysis({ M }: { M: {
  posOnly: number; fawryOnly: number; sales: number; visa: number
  meatSales: number; delivery: number; fawryCommissionProfit: number; itemsCount: number
} }) {
  const total = M.sales || 0
  const rows: { label: string; value: number; color: string; icon: string; pct: number | null }[] = [
    { label: 'مبيعات POS',    value: M.posOnly,              color: '#22c55e', icon: '🖥️', pct: total > 0 ? (M.posOnly / total) * 100 : 0 },
    { label: 'مبيعات فوري',   value: M.fawryOnly,             color: '#a78bfa', icon: '📱', pct: total > 0 ? (M.fawryOnly / total) * 100 : 0 },
    { label: 'مبيعات فيزا',   value: M.visa,                  color: '#10b981', icon: '💳', pct: total > 0 ? (M.visa / total) * 100 : 0 },
    { label: 'مبيعات لحوم',   value: M.meatSales,             color: '#ef4444', icon: '🥩', pct: total > 0 ? (M.meatSales / total) * 100 : 0 },
    { label: 'مبيعات دليفري', value: M.delivery,              color: '#f97316', icon: '🛵', pct: total > 0 ? (M.delivery / total) * 100 : 0 },
    { label: 'ربحية فوري (عمولة كاش اوت)', value: M.fawryCommissionProfit, color: '#8b5cf6', icon: '💰', pct: null },
  ]
  return (
    <div className="card p-2 flex flex-col" style={{ height: PANEL_H }}>
      <CardTitle icon={<Icons.Reports size={13} />} title="تحليل المبيعات" color="#3b82f6" />
      <div className="flex-1 overflow-y-auto flex flex-col dash-compact-table">
        <div className="flex tr">
          <div className="th" style={{ flex: 2 }}>البند</div>
          <div className="th" style={{ flex: 1.2 }}>القيمة</div>
          <div className="th" style={{ flex: 0.8 }}>%</div>
        </div>
        <div className="flex-1 flex flex-col justify-between">
          {rows.map(r => (
            <div key={r.label} className="flex tr">
              <div className="td font-bold" style={{ flex: 2 }}>{r.icon} {r.label}</div>
              <div className="td tabular-nums" style={{ flex: 1.2, color: r.color }}>{fmt(r.value)} ج</div>
              <div className="td tabular-nums" style={{ flex: 0.8, color: 'var(--txt-3)' }}>{r.pct !== null ? `${r.pct.toFixed(1)}%` : '—'}</div>
            </div>
          ))}
          <div className="flex tr">
            <div className="td font-bold" style={{ flex: 2 }}>🧾 عدد عمليات</div>
            <div className="td tabular-nums" style={{ flex: 1.2, color: '#06b6d4' }}>{M.itemsCount}</div>
            <div className="td tabular-nums" style={{ flex: 0.8, color: 'var(--txt-3)' }}>—</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** مؤشر المبيعات — دونات POS/فوري + نسب مئوية جانبية، بطاقة مستقلة أسفل جدول تحليل المبيعات (أقصى يمين الصفحة) */
function SalesDonut({ M }: { M: { posOnly: number; fawryOnly: number; sales: number } }) {
  const total = M.posOnly + M.fawryOnly
  const posPct = total > 0 ? (M.posOnly / total) * 100 : 0
  const fawryPct = total > 0 ? 100 - posPct : 0
  return (
    <div className="card p-2 flex flex-col" style={{ height: ROW2_H }}>
      <CardTitle icon={<Icons.Reports size={13} />} title="مؤشر المبيعات" color="#3b82f6" />
      <div className="flex-1 flex items-center gap-3">
        <div className="flex-1 flex flex-col items-center">
          <span className="text-2xs" style={{ color: 'var(--txt-3)' }}>POS</span>
          <span className="tabular-nums font-black" style={{ fontSize: 16, color: '#22c55e' }}>{posPct.toFixed(1)}%</span>
        </div>
        <div style={{ width: 150, flexShrink: 0 }}>
          <MiniDonut
            data={[
              { label: 'POS',  value: M.posOnly,  color: '#22c55e' },
              { label: 'فوري', value: M.fawryOnly, color: '#a78bfa' },
            ]}
            height={150}
            centerLabel="إجمالي المبيعات"
            centerValue={fmt(M.sales || 0)}
            centerValueSize={13}
            formatter={v => `${fmt(v)} ج`}
          />
        </div>
        <div className="flex-1 flex flex-col items-center">
          <span className="text-2xs" style={{ color: 'var(--txt-3)' }}>فوري</span>
          <span className="tabular-nums font-black" style={{ fontSize: 16, color: '#a78bfa' }}>{fawryPct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  )
}

/** خلية مخزون قابلة للتحرير — تُدخَل يدوياً لكل شهر وتُحفظ في settings (لا يوجد نظام مخزون كامل بعد) */
function InventoryCell({ value, onSave }: { value: number; onSave: (v: string) => void }) {
  const [v, setV] = useState(String(value / 100))
  useEffect(() => { setV(String(value / 100)) }, [value])
  return <input value={v} onChange={e => setV(e.target.value)} onBlur={() => onSave(v)}
    className="tabular-nums font-bold text-left w-20" style={{
      background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)',
      borderRadius: 5, padding: '2px 5px', color: '#a78bfa', fontSize: 10.5, outline: 'none',
    }} />
}
