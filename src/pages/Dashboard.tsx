import { useState, useEffect, useMemo } from 'react'
import { api, call } from '../lib/api'
import Icons from '../components/Icon'
import { fmt, fmtDate, shiftTypeLabel } from '../lib/format'
import type { Shift, Transaction } from '../../core/types'

// ═══════════════════════════════════════════════════════════
// v2.27.0 (15-Jun) — لوحة التحكم التراكمية
// البيانات تُعرض تراكمياً دائماً (كل الشيفتات) مع فلتر اختياري
// (الكل / سنة / شهر / يوم محدد)
// ═══════════════════════════════════════════════════════════

const PAY_LABELS: Record<string, string> = {
  cashier: 'كاش', management: 'خزينة الإدارة', credit: 'آجل', visa: 'فيزا',
}
const PAY_COLORS: Record<string, string> = {
  cashier: '#3b82f6', management: '#f59e0b', credit: '#8b5cf6', visa: '#10b981',
}

type FilterMode = 'all' | 'year' | 'month' | 'day'

function CardTitle({ icon, title, color = '#3b82f6' }: { icon: React.ReactNode; title: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2" style={{ borderBottom: '1px solid var(--inner-border)' }}>
      <span style={{ color }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt-1)' }}>{title}</span>
    </div>
  )
}

function shiftResultOf(s: Shift): { result: number; kind: 'surplus' | 'deficit' | 'balanced' } {
  const result = (s.shiftExpenses ?? 0) + (s.cashierRemaining ?? 0) - (s.posSales ?? 0) - (s.cashierCollections ?? 0)
  const kind = result > 0 ? 'surplus' : result < 0 ? 'deficit' : 'balanced'
  return { result, kind: kind as 'surplus' | 'deficit' | 'balanced' }
}

export default function Dashboard({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [allShifts, setAllShifts] = useState<Shift[]>([])
  const [allTxs,    setAllTxs]    = useState<Transaction[]>([])
  const [loading,   setLoading]   = useState(true)
  const [activeShift, setActiveShift] = useState<Shift | null>(null)

  // الفلتر
  const now = new Date()
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [filterYear,  setFilterYear]  = useState(now.getFullYear())
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1)
  const [filterDay,   setFilterDay]   = useState(now.toISOString().slice(0, 10))

  async function loadAll() {
    setLoading(true)
    try {
      const shifts = await call(api.shifts.getAll({})) as Shift[]
      setAllShifts(shifts)
      const active = await call(api.shifts.getActive()).catch(() => null) as Shift | null
      setActiveShift(active)
      // جلب كل البنود
      const txArrays = await Promise.all(shifts.map(s => call(api.tx.getByShift(s.id)).catch(() => [])))
      setAllTxs((txArrays.flat() as Transaction[]))
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }
  useEffect(() => { loadAll() }, [])

  // ── تطبيق الفلتر على الشيفتات والبنود ──
  const matchDate = (date: string): boolean => {
    if (filterMode === 'all') return true
    if (filterMode === 'year')  return date.slice(0, 4) === String(filterYear)
    if (filterMode === 'month') return date.slice(0, 7) === `${filterYear}-${String(filterMonth).padStart(2, '0')}`
    if (filterMode === 'day')   return date.slice(0, 10) === filterDay
    return true
  }
  const shiftIdsInRange = useMemo(() =>
    new Set(allShifts.filter(s => matchDate(s.date)).map(s => s.id)),
    [allShifts, filterMode, filterYear, filterMonth, filterDay]
  )
  const shifts = useMemo(() => allShifts.filter(s => shiftIdsInRange.has(s.id)), [allShifts, shiftIdsInRange])
  const txs    = useMemo(() => allTxs.filter(t => shiftIdsInRange.has(t.shiftId)), [allTxs, shiftIdsInRange])

  // ── المؤشرات التراكمية ──
  const m = useMemo(() => {
    const totalIn  = txs.reduce((s, t) => s + t.amountIn,  0)
    const totalOut = txs.reduce((s, t) => s + t.amountOut, 0)
    const cashIn   = txs.filter(t => t.payMethod === 'cashier').reduce((s, t) => s + t.amountIn, 0)
    const visaIn   = txs.filter(t => t.payMethod === 'visa').reduce((s, t) => s + t.amountIn, 0)
    const collections = txs.filter(t => t.mainCategoryName === 'تحصيل').reduce((s, t) => s + t.amountIn, 0)
    const posSales = shifts.reduce((s, sh) => s + (sh.posSales ?? 0), 0)
    const cashierRemain = shifts.reduce((s, sh) => s + (sh.cashierRemaining ?? 0), 0)
    const mgmtOut  = txs.filter(t => t.payMethod === 'management').reduce((s, t) => s + t.amountOut, 0)

    let surplus = 0, deficit = 0, balanced = 0, netResult = 0
    shifts.forEach(sh => {
      const { result, kind } = shiftResultOf(sh)
      netResult += result
      if (kind === 'surplus') surplus++
      else if (kind === 'deficit') deficit++
      else balanced++
    })

    // توزيع طرق الدفع
    const payDist = (['cashier', 'management', 'credit', 'visa'] as const).map(pm => {
      const list = txs.filter(t => t.payMethod === pm)
      return { method: pm, in: list.reduce((s, t) => s + t.amountIn, 0), out: list.reduce((s, t) => s + t.amountOut, 0), count: list.length }
    })

    return {
      totalIn, totalOut, net: totalIn - totalOut, cashIn, visaIn, collections,
      posSales, cashierRemain, mgmtOut, netResult,
      shiftsCount: shifts.length, itemsCount: txs.length,
      surplus, deficit, balanced, payDist,
      profit: posSales - mgmtOut,  // تقريبي
    }
  }, [txs, shifts])

  const periodLabel = filterMode === 'all' ? 'كل الفترات'
    : filterMode === 'year' ? `سنة ${filterYear}`
    : filterMode === 'month' ? `${filterMonth}/${filterYear}`
    : `يوم ${fmtDate(filterDay)}`

  const years: number[] = []
  for (let y = now.getFullYear() + 1; y >= 2024; y--) years.push(y)
  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">

      {/* ═══ الرأس + شريط الفلتر ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(59,130,246,0.18)', color: 'var(--accent)' }}>
            <Icons.Dashboard size={20} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--txt-1)' }}>لوحة المعلومات</div>
            <div style={{ fontSize: 11.5, color: 'var(--txt-3)' }}>
              عرض تراكمي · {periodLabel} · {m.shiftsCount} شيفت
              {activeShift && <span style={{ color: '#22c55e' }}> · شيفت #{activeShift.monthlyShiftNum} نشط الآن</span>}
            </div>
          </div>
        </div>

        {/* الفلتر */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--inner-border)' }}>
            {([['all','الكل'],['year','سنة'],['month','شهر'],['day','يوم']] as [FilterMode, string][]).map(([mode, label]) => (
              <button key={mode} onClick={() => setFilterMode(mode)}
                className="px-3 py-1.5 transition-all"
                style={{
                  fontSize: 12, fontWeight: filterMode === mode ? 700 : 500,
                  background: filterMode === mode ? 'var(--accent)' : 'transparent',
                  color: filterMode === mode ? '#fff' : 'var(--txt-2)',
                }}>{label}</button>
            ))}
          </div>
          {filterMode === 'year' && (
            <select className="field text-xs" value={filterYear} onChange={e => setFilterYear(+e.target.value)} style={{ width: 90 }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {filterMode === 'month' && (
            <>
              <select className="field text-xs" value={filterMonth} onChange={e => setFilterMonth(+e.target.value)} style={{ width: 110 }}>
                {MONTHS.map((mo, i) => <option key={mo} value={i + 1}>{mo}</option>)}
              </select>
              <select className="field text-xs" value={filterYear} onChange={e => setFilterYear(+e.target.value)} style={{ width: 80 }}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          )}
          {filterMode === 'day' && (
            <input className="field text-xs" type="date" value={filterDay} onChange={e => setFilterDay(e.target.value)} style={{ width: 150 }} />
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16" style={{ color: 'var(--txt-3)' }}>
          <Icons.Refresh size={24} className="animate-spin mx-auto mb-2" /> جاري تحميل البيانات...
        </div>
      ) : (
        <>
          {/* لافتة شيفت نشط / بدء شيفت */}
          {!activeShift && (
            <div className="card flex items-center gap-4 p-4"
              style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(30,58,138,0.06))', border: '1px solid rgba(59,130,246,0.30)' }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(59,130,246,0.18)', color: 'var(--accent)' }}>
                <Icons.Journal size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--txt-1)' }}>لا يوجد شيفت نشط حالياً</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)' }}>البيانات أعلاه تراكمية لكل الشيفتات السابقة. ابدأ شيفت جديد للتسجيل.</div>
              </div>
              <button onClick={() => onNavigate('daily')} className="btn-success-pro flex-shrink-0" style={{ fontSize: 13, padding: '9px 18px' }}>
                🚀 ابدأ شيفت جديد
              </button>
            </div>
          )}

          {/* ═══ بطاقات KPI التراكمية ═══ */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'إجمالي الوارد', value: m.totalIn,  color: '#22c55e', icon: '⬇' },
              { label: 'إجمالي المنصرف', value: m.totalOut, color: '#ef4444', icon: '⬆' },
              { label: 'الصافي', value: m.net, color: '#3b82f6', icon: '💰' },
              { label: 'مبيعات POS', value: m.posSales, color: '#06b6d4', icon: '📟' },
              { label: 'مبيعات فيزا', value: m.visaIn, color: '#f59e0b', icon: '💳' },
              { label: 'التحصيلات', value: m.collections, color: '#8b5cf6', icon: '🧾' },
            ].map(k => (
              <div key={k.label} className="rounded-2xl p-3.5"
                style={{ background: `linear-gradient(135deg, ${k.color}12, ${k.color}04)`, border: `1px solid ${k.color}38` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span style={{ fontSize: 13 }}>{k.icon}</span>
                  <span className="text-2xs font-bold" style={{ color: k.color }}>{k.label}</span>
                </div>
                <div className="tabular-nums font-bold" style={{ fontSize: 18, color: k.color, lineHeight: 1.1 }}>
                  {fmt(k.value)} <span style={{ fontSize: 10 }}>ج</span>
                </div>
              </div>
            ))}
          </div>

          {/* ═══ الصف الأوسط: حالة الشيفتات + توزيع الدفع ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* حالة الشيفتات */}
            <div className="card p-4">
              <CardTitle icon={<Icons.Warning size={15} />} title="حالة الشيفتات" color="#f59e0b" />
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { label: 'أوفر', value: m.surplus, color: '#10b981' },
                  { label: 'متزن', value: m.balanced, color: '#f59e0b' },
                  { label: 'عجز', value: m.deficit, color: '#ef4444' },
                ].map(c => (
                  <div key={c.label} className="rounded-xl p-2.5 text-center" style={{ background: c.color + '12', border: `1px solid ${c.color}35` }}>
                    <div className="tabular-nums font-bold" style={{ fontSize: 22, color: c.color }}>{c.value}</div>
                    <div className="text-2xs" style={{ color: 'var(--txt-3)' }}>{c.label}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: 'var(--inner-bg)' }}>
                <span className="text-xs" style={{ color: 'var(--txt-2)' }}>صافي النتيجة التراكمية</span>
                <span className="tabular-nums font-bold" style={{ fontSize: 15, color: m.netResult > 0 ? '#10b981' : m.netResult < 0 ? '#ef4444' : '#f59e0b' }}>
                  {m.netResult > 0 ? '+' : ''}{fmt(m.netResult)} ج
                </span>
              </div>
            </div>

            {/* توزيع طرق الدفع */}
            <div className="card p-4 lg:col-span-2">
              <CardTitle icon={<Icons.Reports size={15} />} title="توزيع طرق الدفع" color="#06b6d4" />
              <div className="space-y-2.5">
                {m.payDist.map(d => {
                  const total = m.payDist.reduce((s, x) => s + x.in + x.out, 0)
                  const val = d.in + d.out
                  const pct = total > 0 ? (val / total * 100) : 0
                  return (
                    <div key={d.method}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: PAY_COLORS[d.method] }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-1)' }}>{PAY_LABELS[d.method]}</span>
                          <span className="text-2xs px-1.5 rounded" style={{ background: PAY_COLORS[d.method] + '20', color: PAY_COLORS[d.method] }}>{d.count}</span>
                        </div>
                        <span className="tabular-nums font-bold" style={{ fontSize: 12.5, color: PAY_COLORS[d.method] }}>{fmt(val)} ج ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--inner-bg)' }}>
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: PAY_COLORS[d.method] }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ═══ جدول الشيفتات في الفترة ═══ */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
              <div className="flex items-center gap-2">
                <Icons.Records size={15} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>الشيفتات ({m.shiftsCount})</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="tabular-nums" style={{ color: '#22c55e' }}>+{fmt(m.totalIn)}</span>
                <span className="tabular-nums" style={{ color: '#ef4444' }}>−{fmt(m.totalOut)}</span>
              </div>
            </div>
            <div className="overflow-auto" style={{ maxHeight: 320 }}>
              {shifts.length === 0 ? (
                <div className="text-center py-8 text-xs" style={{ color: 'var(--txt-3)' }}>لا توجد شيفتات في هذه الفترة</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="th">#</th><th className="th">التاريخ</th><th className="th">النوع</th>
                      <th className="th">الكاشير</th>
                      <th className="th" style={{ color: '#06b6d4' }}>POS</th>
                      <th className="th">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...shifts].reverse().map(s => {
                      const { result, kind } = shiftResultOf(s)
                      const col = kind === 'surplus' ? '#10b981' : kind === 'deficit' ? '#ef4444' : '#f59e0b'
                      const lbl = kind === 'surplus' ? 'أوفر' : kind === 'deficit' ? 'عجز' : 'متزن'
                      return (
                        <tr key={s.id} className="tr">
                          <td className="td font-bold" style={{ color: 'var(--accent)' }}>#{s.monthlyShiftNum}</td>
                          <td className="td tabular-nums">{fmtDate(s.date)}</td>
                          <td className="td">{shiftTypeLabel(s.type)}</td>
                          <td className="td">{s.cashierName}</td>
                          <td className="td tabular-nums" style={{ color: '#06b6d4' }}>{fmt(s.posSales ?? 0)}</td>
                          <td className="td">
                            <span className="text-2xs px-2 py-0.5 rounded-full font-bold" style={{ background: col + '22', color: col }}>
                              {lbl} {result !== 0 && `(${fmt(Math.abs(result))})`}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
