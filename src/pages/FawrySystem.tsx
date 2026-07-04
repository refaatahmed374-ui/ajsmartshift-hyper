import { useState, useEffect, useMemo } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import Icons from '../components/Icon'
import KPICard from '../components/KPICard'
import { MiniBar } from '../components/MiniChart'
import { fmt, fmtDate } from '../lib/format'
import { calcFawry } from '../../core/engine'
import type { Shift, ShiftFawry, FawryResult } from '../../core/types'

interface ShiftFawryRow {
  shift: Shift
  fawry: ShiftFawry | null
  result: FawryResult | null
}

export default function FawrySystem() {
  const { show } = useToast()
  const [month,   setMonth]   = useState(() => new Date().toISOString().slice(0, 7))
  const [rows,    setRows]    = useState<ShiftFawryRow[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const shifts = await call(api.shifts.getAll({ month })) as Shift[]
      const fawryList = await Promise.all(
        shifts.map(s =>
          call(api.fawry.get(s.id)).then(f => f as ShiftFawry | null).catch(() => null)
        )
      )
      setRows(shifts.map((s, i) => ({
        shift:  s,
        fawry:  fawryList[i],
        result: fawryList[i] ? calcFawry(fawryList[i]!) : null,
      })))
    } catch (e) { show((e as Error).message, 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [month])

  // إجماليات الشهر
  const totals = useMemo(() => {
    const base = { basic: 0, air: 0, cashout: 0, total: 0, profit: 0, ops: 0 }
    for (const r of rows) {
      if (!r.result) continue
      base.basic   += r.result.basicSales
      base.air     += r.result.airSales
      base.cashout += r.result.cashoutSales
      base.total   += r.result.totalFawrySales
      base.profit  += r.result.profitability
      base.ops     += r.result.operationsCount
    }
    return base
  }, [rows])

  const chartData = useMemo(() =>
    rows.filter(r => r.result).map(r => ({
      label: `#${r.shift.monthlyShiftNum}`,
      value: r.result!.totalFawrySales,
    })),
    [rows]
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
      {/* رأس */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-600/20 border border-brand-600/30
            flex items-center justify-center text-brand-400">
            <Icons.Fawry size={18} />
          </div>
          <div>
            <h1 className="t-display text-white">نظام فوري</h1>
            <p className="text-2xs text-surface-400">تحليل مبيعات فوري الشهري</p>
          </div>
        </div>
        <input className="field text-xs w-36" type="month" value={month}
          onChange={e => setMonth(e.target.value)} />
      </div>

      {/* KPI إجماليات الشهر */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 flex-shrink-0">
        <KPICard label="مبيعات فوري الكلي" value={fmt(totals.total) + ' ج'}
          color="#8957e5" icon={<Icons.Fawry size={14} />} />
        <KPICard label="مبيعات أساسي"  value={fmt(totals.basic) + ' ج'}
          color="#388bfd" icon={<Icons.Reports size={14} />} />
        <KPICard label="إجمالي الربحية" value={fmt(totals.profit) + ' ج'}
          color={totals.profit >= 0 ? '#2ea043' : '#f85149'}
          icon={<Icons.ArrowRight size={14} />} />
        <KPICard label="إجمالي العمليات" value={String(totals.ops)}
          color="#d29922" icon={<Icons.Clock size={14} />} />
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4">
        {/* جدول الشيفتات — العرض الكامل */}
        <div className="card flex flex-col overflow-hidden p-0" style={{ minHeight: 360 }}>
          <div className="px-4 py-3 border-b border-surface-600 flex-shrink-0">
            <span className="font-bold text-white text-sm">
              فوري لكل شيفت ({rows.filter(r => r.fawry).length} من {rows.length})
            </span>
          </div>
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-surface-400">جاري التحميل...</div>
          ) : rows.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-surface-400">
              <Icons.Fawry size={36} className="opacity-20" />
              <span className="text-sm">لا توجد شيفتات هذا الشهر</span>
            </div>
          ) : (
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="th">شيفت</th>
                    <th className="th">التاريخ</th>
                    <th className="th">أساسي</th>
                    <th className="th">إير تايم</th>
                    <th className="th">كاش أوت</th>
                    <th className="th">إجمالي فوري</th>
                    <th className="th">الربحية</th>
                    <th className="th">عمليات</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ shift: s, fawry: f, result: r }) => (
                    <tr key={s.id} className="tr">
                      <td className="td font-bold text-brand-400">#{s.monthlyShiftNum}</td>
                      <td className="td text-surface-400">{fmtDate(s.date)}</td>
                      {r ? (
                        <>
                          <td className="td tabular-nums">{fmt(r.basicSales)}</td>
                          <td className="td tabular-nums">{fmt(r.airSales)}</td>
                          <td className="td tabular-nums">{fmt(r.cashoutSales)}</td>
                          <td className="td tabular-nums font-bold text-brand-400">{fmt(r.totalFawrySales)}</td>
                          <td className={`td tabular-nums font-bold ${r.profitability >= 0 ? 'text-success' : 'text-danger'}`}>
                            {fmt(r.profitability)}
                          </td>
                          <td className="td tabular-nums text-surface-400">{r.operationsCount}</td>
                        </>
                      ) : (
                        <td colSpan={6} className="td text-center text-surface-600 italic">لا توجد بيانات</td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-surface-500 bg-surface-800">
                    <td colSpan={2} className="td font-semibold text-surface-400">الإجمالي</td>
                    <td className="td tabular-nums font-bold">{fmt(totals.basic)}</td>
                    <td className="td tabular-nums font-bold">{fmt(totals.air)}</td>
                    <td className="td tabular-nums font-bold">{fmt(totals.cashout)}</td>
                    <td className="td tabular-nums font-bold text-brand-400">{fmt(totals.total)}</td>
                    <td className={`td tabular-nums font-bold ${totals.profit >= 0 ? 'text-success' : 'text-danger'}`}>
                      {fmt(totals.profit)}
                    </td>
                    <td className="td tabular-nums">{totals.ops}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* تحليل مرئي — صف سفلي بـ 2 أعمدة */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* توزيع المبيعات */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Icons.Fawry size={14} className="text-brand-400" />
              <span className="font-bold text-white text-sm">توزيع المبيعات</span>
            </div>
            {totals.total > 0 ? (
              <div className="space-y-2 text-xs">
                {[
                  { label: 'أساسي',    value: totals.basic,   color: '#388bfd' },
                  { label: 'إير تايم', value: totals.air,     color: '#8957e5' },
                  { label: 'كاش أوت',  value: totals.cashout, color: '#d29922' },
                ].map(item => (
                  <div key={item.label}>
                    <div className="flex justify-between mb-1">
                      <span className="text-surface-400">{item.label}</span>
                      <span className="tabular-nums font-bold" style={{ color: item.color }}>
                        {fmt(item.value)} ج
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{
                          width: `${totals.total > 0 ? (item.value / totals.total * 100) : 0}%`,
                          background: item.color,
                        }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-surface-400 text-xs py-4">لا توجد بيانات</div>
            )}
          </div>

          {/* رسم بياني */}
          {chartData.length > 1 && (
            <div className="card flex-1">
              <div className="flex items-center gap-2 mb-3">
                <Icons.Reports size={14} className="text-brand-400" />
                <span className="font-bold text-white text-sm">مبيعات فوري / شيفت</span>
              </div>
              <MiniBar data={chartData} color="#8957e5"
                formatter={v => fmt(v) + ' ج'} height={140} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
