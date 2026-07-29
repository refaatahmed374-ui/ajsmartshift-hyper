import { useState, useEffect, useMemo } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import Icons from '../components/Icon'
import { MiniArea, MiniCombo } from '../components/MiniChart'
import { fmt, fmtDate } from '../lib/format'

interface Movement {
  kind: 'shift' | 'adjustment'
  id: number; shiftNum: number | null; date: string; label: string
  cashIn: number; mgmtOut: number; net: number; running: number; status: string
}
interface TreasuryData {
  opening: number
  prevBalance: number; shiftsCount: number; monthIn: number; monthOut: number
  movements: Movement[]
  firstShiftDate: string | null
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  open:     { label: 'مفتوح',  color: '#3b82f6' },
  review:   { label: 'مراجعة', color: '#f59e0b' },
  approved: { label: 'معتمد',  color: '#10b981' },
  salary_payout: { label: 'رواتب', color: '#8b5cf6' },
}

export default function Treasury() {
  const { show } = useToast()
  const [month, setMonth]   = useState(() => new Date().toISOString().slice(0, 7))
  // بطلب العميل — وضعان: "شهر محدد" (افتراضي، الفلتر فعّال) أو "الكل" (كل حركات الصندوق من أول شيفت في البرنامج)
  const [viewMode, setViewMode] = useState<'month' | 'all'>('month')
  const [data,  setData]    = useState<TreasuryData | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try { setData(await call(api.treasury.data(viewMode === 'all' ? 'all' : month)) as TreasuryData) }
    catch (e) { show((e as Error).message, 'error') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [month, viewMode])

  // رسم الرصيد المتراكم
  const balanceTrend = useMemo(() =>
    (data?.movements ?? []).map((m, i) => ({ label: m.shiftNum ? `#${m.shiftNum}` : `ت${i + 1}`, value: m.running })),
    [data]
  )
  // رسم وارد مقابل منصرف
  const comboData = useMemo(() =>
    (data?.movements ?? []).map((m, i) => ({
      label: m.shiftNum ? `#${m.shiftNum}` : `ت${i + 1}`, in: m.cashIn, out: m.mgmtOut, net: m.net,
    })),
    [data]
  )

  // آخر رصيد متراكم في حركات الفترة المعروضة (شهر محدد أو "الكل") — يتماشى تلقائياً مع viewMode لأن الخادم
  // يُرجع data.movements/prevBalance بنفس النطاق المطلوب أصلاً (month='all' أو month='YYYY-MM').
  const closingBalance = data ? (data.movements.length ? data.movements[data.movements.length - 1].running : data.prevBalance) : 0
  const balance = closingBalance
  const balanceColor = balance >= 0 ? '#10b981' : '#ef4444'

  // بطلب العميل — آخر حركة خاصة بكل بطاقة (آخر إضافة / آخر صرف / آخر حركة على الرصيد عمومًا)
  // data.movements مرتّبة تصاعديًا بالتاريخ من الخادم، فآخر عنصر = الأحدث
  const lastAdded = useMemo(() => {
    const rows = (data?.movements ?? []).filter(m => m.cashIn > 0)
    return rows.length ? rows[rows.length - 1] : null
  }, [data])
  const lastSpent = useMemo(() => {
    const rows = (data?.movements ?? []).filter(m => m.mgmtOut > 0)
    return rows.length ? rows[rows.length - 1] : null
  }, [data])
  const lastAny = useMemo(() => {
    const rows = data?.movements ?? []
    return rows.length ? rows[rows.length - 1] : null
  }, [data])
  const movementWho = (m: Movement) => m.kind === 'adjustment' ? m.label : `شيفت #${m.shiftNum}`
  const periodWord = viewMode === 'all' ? 'في كل الفترة' : 'هذا الشهر'
  const describeAdded = lastAdded ? `آخر حركة: ${movementWho(lastAdded)} · ${fmtDate(lastAdded.date)} · +${fmt(lastAdded.cashIn)} ج` : `لا توجد حركة إضافة ${periodWord}`
  const describeSpent = lastSpent ? `آخر حركة: ${movementWho(lastSpent)} · ${fmtDate(lastSpent.date)} · −${fmt(lastSpent.mgmtOut)} ج` : `لا توجد حركة صرف ${periodWord}`
  const describeAny   = lastAny   ? `آخر حركة: ${movementWho(lastAny)} · ${fmtDate(lastAny.date)}` : `لا توجد حركات ${periodWord}`

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">

      {/* ═══════════ الرأس ═══════════ */}
      <div className="flex items-center justify-between flex-shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.20), rgba(30,58,138,0.10))',
              border: '1px solid rgba(59,130,246,0.35)',
              color: 'var(--accent)',
            }}>
            <Icons.Fund size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--txt-1)', lineHeight: 1.2 }}>
              حسابات الصندوق
            </h1>
            <div style={{ fontSize: 12, color: 'var(--txt-3)' }}>
              {data?.shiftsCount ?? 0} حركة {viewMode === 'all' ? '(كل الفترات)' : 'في هذا الشهر'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>الفترة:</span>
          <input className="field text-xs" type="month" value={month}
            onChange={e => { setMonth(e.target.value); setViewMode('month') }}
            disabled={viewMode === 'all'}
            style={{ width: 150, opacity: viewMode === 'all' ? 0.5 : 1 }} />
          {/* بطلب العميل — زر "الكل" لعرض كل حركات الصندوق من أول شيفت في البرنامج، بدل الاقتصار على شهر محدد */}
          <button onClick={() => setViewMode(v => v === 'all' ? 'month' : 'all')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={viewMode === 'all'
              ? { background: 'var(--accent)', color: '#fff' }
              : { background: 'var(--inner-bg)', color: 'var(--txt-2)', border: '1px solid var(--inner-border)' }}>
            الكل
          </button>
        </div>
      </div>

      {/* ═══════════ شريط KPIs الاحترافي (4 بطاقات) — بطلب العميل: بالترتيب رصيد أول ← مضاف ← منصرف ← رصيد آخر ═══════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">

        {/* 1) رصيد أول الصندوق — محسوب تلقائياً من تقارير اليوميات دائماً (بلا أي تعديل يدوي — أُغلقت هذه الخاصية نهائياً) */}
        <div className="rounded-2xl p-4 relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #06b6d410, #06b6d404)', border: '1px solid #06b6d445' }}>
          <div className="flex items-start justify-between mb-2">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)' }}>رصيد أول الصندوق</span>
          </div>
          {/* رصيد أول الفترة المعروضة — في وضع "الكل" هذا رصيد الصندوق قبل أول شيفت في البرنامج على الإطلاق */}
          <div className="tabular-nums" style={{ fontSize: 22, fontWeight: 800, color: '#06b6d4', lineHeight: 1.15 }}>
            {fmt(data?.prevBalance ?? 0)} <span style={{ fontSize: 11 }}>ج</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginTop: 2 }}>
            {viewMode === 'all'
              ? `بتاريخ أول شيفت في البرنامج: ${data?.firstShiftDate ? fmtDate(data.firstShiftDate) : '—'}`
              : `رصيد مرحّل من قبل ${month}`}
          </div>
        </div>

        {/* 2) المضاف للصندوق — لفترة العرض المختارة (شهر محدد أو "الكل" من أول شيفت في البرنامج) */}
        <KpiCard
          label="مضاف للصندوق"
          value={data?.monthIn ?? 0}
          icon={<Icons.ArrowRight size={14} />}
          color="#22c55e"
          movementLabel={describeAdded}
        />

        {/* 3) المنصرف من الصندوق — لفترة العرض المختارة (مصروفات الشيفتات "إدارة" + التسويات اليدوية) */}
        <KpiCard
          label="منصرف من الصندوق"
          value={data?.monthOut ?? 0}
          icon={<Icons.ArrowRight size={14} className="rotate-180" />}
          color="#ef4444"
          movementLabel={describeSpent}
        />

        {/* 4) رصيد آخر الصندوق — بطاقة بارزة (الأهم) */}
        <div className="rounded-2xl p-4 relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${balanceColor}18, ${balanceColor}08)`,
            border: `1.5px solid ${balanceColor}60`,
            boxShadow: `0 4px 18px ${balanceColor}25`,
          }}>
          {/* glow background */}
          <div style={{
            position: 'absolute', top: -30, right: -30, width: 100, height: 100,
            borderRadius: '50%', background: balanceColor, opacity: 0.12, filter: 'blur(28px)',
          }} />
          <div className="flex items-start justify-between mb-2 relative">
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt-2)' }}>
              رصيد آخر الصندوق
            </span>
            <div className="p-1.5 rounded-lg" style={{
              background: balanceColor + '25', color: balanceColor,
            }}>
              <Icons.Fund size={14} />
            </div>
          </div>
          <div className="relative">
            <div className="tabular-nums" style={{
              fontSize: 26, fontWeight: 900, color: balanceColor, lineHeight: 1.1,
            }}>
              {fmt(balance)}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginTop: 2 }}>
              ج · = رصيد أول + مضاف − منصرف
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginTop: 2 }}>
              {describeAny}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ الجدول الرئيسي بعرض كامل ═══════════ */}
      <div className="card p-0 overflow-hidden flex flex-col" style={{ minHeight: 240 }}>
        <div className="px-4 py-2.5 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: '1px solid var(--inner-border)' }}>
          <div className="flex items-center gap-2">
            <Icons.Records size={15} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt-1)' }}>
              حركات الخزينة
            </span>
            <span className="text-2xs px-2 py-0.5 rounded-md" style={{
              background: 'var(--inner-bg)', color: 'var(--txt-2)',
              border: '1px solid var(--inner-border)',
            }}>
              {data?.shiftsCount ?? 0} حركة
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="tabular-nums" style={{ color: '#22c55e' }}>
              + {fmt(data?.monthIn ?? 0)} ج
            </span>
            <span className="tabular-nums" style={{ color: '#ef4444' }}>
              − {fmt(data?.monthOut ?? 0)} ج
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-10" style={{ color: 'var(--txt-3)' }}>
            <Icons.Refresh size={20} className="animate-spin mr-2" />
            جاري التحميل...
          </div>
        ) : !data || data.movements.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10" style={{ color: 'var(--txt-3)' }}>
            <Icons.Fund size={40} className="opacity-20" />
            <span className="text-sm">لا توجد حركات {periodWord}</span>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">#</th>
                  <th className="th">التاريخ</th>
                  <th className="th">البيان</th>
                  <th className="th" style={{ color: '#22c55e' }}>وارد (نقدية)</th>
                  <th className="th" style={{ color: '#ef4444' }}>منصرف (إدارة)</th>
                  <th className="th">صافي</th>
                  <th className="th" style={{ color: 'var(--accent)' }}>الرصيد المتراكم</th>
                  <th className="th text-center">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {/* صف الرصيد السابق */}
                <tr className="tr" style={{ background: 'rgba(6,182,212,0.06)' }}>
                  <td className="td" colSpan={6}
                    style={{ color: '#06b6d4', fontWeight: 700, fontStyle: 'italic' }}>
                    📥 {viewMode === 'all' ? 'رصيد قبل أول شيفت في البرنامج' : `رصيد مرحّل من قبل ${month}`}
                  </td>
                  <td className="td tabular-nums font-bold" style={{ color: '#06b6d4', fontSize: 13 }}>
                    {fmt(data.prevBalance)}
                  </td>
                  <td className="td"></td>
                </tr>
                {data.movements.map(m => {
                  const isAdj = m.kind === 'adjustment'
                  const cfg = STATUS_CFG[m.status] ?? (isAdj ? { label: 'سحب', color: '#8b5cf6' } : STATUS_CFG.open)
                  return (
                    <tr key={m.kind + '-' + m.id} className="tr" style={isAdj ? { background: 'rgba(139,92,246,0.05)' } : undefined}>
                      <td className="td font-bold" style={{ color: isAdj ? '#8b5cf6' : 'var(--accent)' }}>
                        {isAdj ? '⬇' : '#' + m.shiftNum}
                      </td>
                      <td className="td" style={{ color: 'var(--txt-2)' }}>{fmtDate(m.date)}</td>
                      <td className="td" style={{ color: 'var(--txt-1)', fontWeight: 600 }}>
                        {isAdj && <span className="ml-1 text-2xs px-1.5 py-0.5 rounded" style={{ background: '#8b5cf620', color: '#8b5cf6' }}>تسوية</span>} {m.label}
                      </td>
                      <td className="td tabular-nums font-bold" style={{ color: '#22c55e' }}>
                        {m.cashIn > 0 ? '+' + fmt(m.cashIn) : '—'}
                      </td>
                      <td className="td tabular-nums font-bold"
                        style={{ color: m.mgmtOut < 0 ? '#22c55e' : '#ef4444' }}>
                        {m.mgmtOut > 0 ? '−' + fmt(m.mgmtOut) : m.mgmtOut < 0 ? '↩ +' + fmt(-m.mgmtOut) : '—'}
                      </td>
                      <td className="td tabular-nums font-bold"
                        style={{ color: m.net >= 0 ? '#22c55e' : '#ef4444' }}>
                        {m.net >= 0 ? '+' : ''}{fmt(m.net)}
                      </td>
                      <td className="td tabular-nums font-bold" style={{ color: 'var(--accent)', fontSize: 13 }}>
                        {fmt(m.running)}
                      </td>
                      <td className="td text-center">
                        <span className="inline-block px-2.5 py-1 rounded-full text-2xs font-bold"
                          style={{ background: cfg.color + '22', color: cfg.color }}>
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
                  <td className="td" colSpan={3}
                    style={{ fontWeight: 700, color: 'var(--txt-1)' }}>
                    {viewMode === 'all' ? 'الإجمالي الكلي' : 'إجمالي الشهر'}
                  </td>
                  <td className="td tabular-nums font-bold" style={{ color: '#22c55e' }}>
                    +{fmt(data.monthIn)}
                  </td>
                  <td className="td tabular-nums font-bold" style={{ color: '#ef4444' }}>
                    −{fmt(data.monthOut)}
                  </td>
                  <td className="td tabular-nums font-bold"
                    style={{ color: (data.monthIn - data.monthOut) >= 0 ? '#22c55e' : '#ef4444' }}>
                    {fmt(data.monthIn - data.monthOut)}
                  </td>
                  <td className="td tabular-nums font-bold" style={{ color: 'var(--accent)', fontSize: 13 }}>
                    {fmt(closingBalance)}
                  </td>
                  <td className="td"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ═══════════ صف الرسوم البيانية (جنباً إلى جنب) ═══════════ */}
      {data && data.movements.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-shrink-0">
          {/* الرصيد المتراكم */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg" style={{
                background: 'rgba(59,130,246,0.15)', color: 'var(--accent)',
              }}>
                <Icons.Reports size={13} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>
                تطور الرصيد المتراكم
              </span>
            </div>
            {balanceTrend.length > 1 ? (
              <MiniArea data={balanceTrend} color="#3b82f6"
                formatter={v => fmt(v) + ' ج'} height={150} />
            ) : (
              <div className="text-center py-8 text-xs" style={{ color: 'var(--txt-3)' }}>
                يحتاج شيفتين على الأقل للرسم
              </div>
            )}
          </div>

          {/* وارد vs منصرف */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg" style={{
                background: 'rgba(34,197,94,0.15)', color: '#22c55e',
              }}>
                <Icons.Reports size={13} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>
                وارد مقابل منصرف
              </span>
            </div>
            <MiniCombo data={comboData} formatter={v => fmt(v) + ' ج'} height={150} />
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════ بطاقة KPI احترافية ═══════════
function KpiCard({ label, value, icon, color, movementLabel }: {
  label: string; value: number; icon: React.ReactNode; color: string; movementLabel?: string;
}) {
  return (
    <div className="rounded-2xl p-4 relative overflow-hidden transition-all hover:scale-[1.01]"
      style={{
        background: `linear-gradient(135deg, ${color}10, ${color}04)`,
        border: `1px solid ${color}45`,
      }}>
      <div className="flex items-start justify-between mb-2">
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)' }}>{label}</span>
        <div className="p-1.5 rounded-lg" style={{ background: color + '20', color }}>
          {icon}
        </div>
      </div>
      <div className="tabular-nums" style={{
        fontSize: 22, fontWeight: 800, color, lineHeight: 1.15,
      }}>
        {fmt(value)} <span style={{ fontSize: 11 }}>ج</span>
      </div>
      {/* بطلب العميل — آخر حركة خاصة بهذه البطاقة */}
      {movementLabel && (
        <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginTop: 2 }}>
          {movementLabel}
        </div>
      )}
    </div>
  )
}
