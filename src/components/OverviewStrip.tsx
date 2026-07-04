import { useState, useEffect } from 'react'
import { api, call } from '../lib/api'
import { fmt } from '../lib/format'
import Icons from './Icon'

interface Trend { value: number; isPositive: boolean }
interface Overview {
  monthRevenues: number; monthExpenses: number; monthProfit: number
  todayRevenues: number; invoicesCount: number
  bestEmployee:   { name: string; days: number } | null
  topDescription: { text: string; count: number } | null
  topPayMethod:   { method: string; count: number } | null
  revenuesTrend:  Trend | null
  profitTrend:    Trend | null
}

// بادج اتجاه (▲/▼ + نسبة)
function TrendBadge({ trend }: { trend: Trend | null }) {
  if (!trend) return null
  const color = trend.isPositive ? '#22c55e' : '#ef4444'
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md"
      style={{ fontSize: '11px', fontWeight: 700, color, background: color + '1a' }}>
      <span>{trend.isPositive ? '▲' : '▼'}</span>{trend.value}%
    </span>
  )
}

const PAY_LABEL: Record<string, string> = { cashier: 'كاشير', management: 'خزينة الإدارة', credit: 'آجل', visa: 'فيزا' }

const MONTH_NAMES = [
  'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
]

export default function OverviewStrip() {
  const [data, setData] = useState<Overview | null>(null)
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(false)

  const monthStr = `${year}-${String(month).padStart(2, '0')}`

  useEffect(() => {
    setLoading(true)
    call(api.stats.overview(monthStr))
      .then(d => setData(d as Overview))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [monthStr])

  // سنوات متاحة (من 2024 حتى السنة الحالية + 1)
  const years: number[] = []
  for (let y = now.getFullYear() + 1; y >= 2024; y--) years.push(y)

  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1

  const kpis = data ? [
    { label: isCurrent ? 'مبيعات اليوم' : 'مبيعات (آخر يوم)', value: fmt(data.todayRevenues) + ' ج', color: '#22c55e', icon: <Icons.ArrowRight size={15} />, trend: null as Trend | null },
    { label: 'مبيعات الشهر',  value: fmt(data.monthRevenues) + ' ج', color: '#3b82f6', icon: <Icons.Reports size={15} />, trend: data.revenuesTrend },
    { label: 'الربح',         value: fmt(data.monthProfit) + ' ج',   color: data.monthProfit >= 0 ? '#f59e0b' : '#ef4444', icon: <Icons.Fund size={15} />, trend: data.profitTrend },
    { label: 'عدد الفواتير',  value: String(data.invoicesCount),     color: '#8b5cf6', icon: <Icons.Journal size={15} />, trend: null as Trend | null },
  ] : []

  const insights = data ? [
    { label: 'أفضل موظف',       value: data.bestEmployee ? `${data.bestEmployee.name} (${data.bestEmployee.days} يوم)` : '—', color: '#06b6d4', icon: <Icons.Employees size={14} /> },
    { label: 'أكثر بيان متكرر', value: data.topDescription ? `${data.topDescription.text} (${data.topDescription.count})` : '—', color: '#f59e0b', icon: <Icons.Records size={14} /> },
    { label: 'أكثر دفع استخداماً', value: data.topPayMethod ? `${PAY_LABEL[data.topPayMethod.method] ?? data.topPayMethod.method} (${data.topPayMethod.count})` : '—', color: '#3b82f6', icon: <Icons.User size={14} /> },
  ] : []

  return (
    <div className="flex-shrink-0 space-y-3 mb-3">
      {/* === رأس البطاقة: العنوان + الفلاتر === */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt-2)' }}>
            نظرة عامة:
          </span>
          <span className="px-2.5 py-1 rounded-lg" style={{
            fontSize: 13, fontWeight: 800,
            background: 'rgba(59,130,246,0.12)', color: 'var(--accent)',
            border: '1px solid rgba(59,130,246,0.25)',
          }}>
            {MONTH_NAMES[month - 1]} {year}
          </span>
          {loading && <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>... تحميل</span>}
        </div>

        <div className="flex items-center gap-2">
          {/* فلتر الشهر */}
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className="field"
            style={{ width: 'auto', minWidth: 110, paddingTop: 4, paddingBottom: 4, fontSize: 12 }}
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>

          {/* فلتر السنة */}
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="field"
            style={{ width: 'auto', minWidth: 80, paddingTop: 4, paddingBottom: 4, fontSize: 12 }}
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* زر العودة للحالي */}
          {!isCurrent && (
            <button
              onClick={() => {
                setYear(now.getFullYear())
                setMonth(now.getMonth() + 1)
              }}
              className="btn-ghost btn-sm"
              style={{ paddingTop: 4, paddingBottom: 4 }}
            >
              الشهر الحالي
            </button>
          )}
        </div>
      </div>

      {/* === KPIs الشهر === */}
      {data && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {kpis.map(k => (
            <div key={k.label} className="kpi-card" style={{ '--kpi-color': k.color } as React.CSSProperties}>
              <div className="flex items-start justify-between mb-2">
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--txt-2)' }}>{k.label}</span>
                <span className="p-2 rounded-xl" style={{ background: k.color + '1a', color: k.color }}>{k.icon}</span>
              </div>
              <div className="flex items-end justify-between gap-2">
                <div className="t-num-lg" style={{ color: k.color }}>{k.value}</div>
                <TrendBadge trend={k.trend} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* === رؤى سريعة === */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {insights.map(it => (
            <div key={it.label} className="card flex items-center gap-3 py-3">
              <span className="p-2 rounded-xl flex-shrink-0" style={{ background: it.color + '1a', color: it.color }}>{it.icon}</span>
              <div className="min-w-0">
                <div style={{ fontSize: '12px', color: 'var(--txt-3)' }}>{it.label}</div>
                <div className="truncate" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--txt-1)' }}>{it.value}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
