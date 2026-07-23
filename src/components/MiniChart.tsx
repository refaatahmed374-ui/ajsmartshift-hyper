/**
 * MiniChart — رسوم بيانية مصغرة باستخدام Recharts
 */
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  ComposedChart, Line,
} from 'recharts'

// تلميح مخصص بالعربية
function ArabicTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface-700 border border-surface-500 rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-surface-400 mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color }} className="font-bold tabular-nums">
          {formatter ? formatter(p.value) : p.value}
        </div>
      ))}
    </div>
  )
}

// ===== رسم أعمدة صغير =====
interface BarProps {
  data:      { label: string; value: number; color?: string }[]
  height?:   number
  color?:    string
  formatter?: (v: number) => string
}

export function MiniBar({ data, height = 120, color = '#388bfd', formatter }: BarProps) {
  const mapped = data.map(d => ({ name: d.label, value: d.value }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={mapped} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6e7681' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: '#6e7681' }} axisLine={false} tickLine={false} />
        <Tooltip content={<ArabicTooltip formatter={formatter} />} cursor={{ fill: '#30363d55' }} />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={40}
          style={{ filter: `drop-shadow(0 2px 4px ${color}44)` }} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ===== رسم منطقة (trend) =====
interface AreaProps {
  data:      { label: string; value: number }[]
  height?:   number
  color?:    string
  formatter?: (v: number) => string
}

export function MiniArea({ data, height = 100, color = '#388bfd', formatter }: AreaProps) {
  const mapped = data.map(d => ({ name: d.label, value: d.value }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={mapped} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6e7681' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: '#6e7681' }} axisLine={false} tickLine={false} />
        <Tooltip content={<ArabicTooltip formatter={formatter} />} />
        <Area type="monotone" dataKey="value"
          stroke={color} strokeWidth={2}
          fill="url(#areaGrad)"
          dot={{ fill: color, r: 3 }}
          activeDot={{ r: 5, fill: color, style: { filter: `drop-shadow(0 0 4px ${color})` } }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ===== رسم دائري (Donut) =====
interface DonutSlice { label: string; value: number; color: string }
interface DonutProps {
  data:       DonutSlice[]
  height?:    number
  centerLabel?: string
  centerValue?: string
  centerValueSize?: number
  formatter?: (v: number) => string
}

export function MiniDonut({ data, height = 200, centerLabel, centerValue, centerValueSize = 18, formatter }: DonutProps) {
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label"
            cx="50%" cy="50%" innerRadius="62%" outerRadius="88%"
            paddingAngle={2} stroke="none">
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip content={<ArabicTooltip formatter={formatter} />} />
        </PieChart>
      </ResponsiveContainer>
      {/* النص الأوسط */}
      {(centerLabel || centerValue) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-3">
          {centerValue && <div className="font-extrabold tabular-nums text-center" style={{ fontSize: centerValueSize, color: 'var(--txt-1)', lineHeight: 1.15 }}>{centerValue}</div>}
          {centerLabel && <div className="text-2xs" style={{ color: 'var(--txt-3)' }}>{centerLabel}</div>}
        </div>
      )}
    </div>
  )
}

// ===== رسم مختلط (أعمدة + خط) =====
interface ComboPoint { label: string; in: number; out: number; net: number }
interface ComboProps {
  data:       ComboPoint[]
  height?:    number
  formatter?: (v: number) => string
}

export function MiniCombo({ data, height = 240, formatter }: ComboProps) {
  const mapped = data.map(d => ({ name: d.label, ...d }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={mapped} margin={{ top: 8, right: 4, bottom: 0, left: -15 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6e7681' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: '#6e7681' }} axisLine={false} tickLine={false} />
        <Tooltip content={<ArabicTooltip formatter={formatter} />} cursor={{ fill: '#30363d33' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="in"  name="إيرادات" fill="#2ea043" radius={[3,3,0,0]} maxBarSize={22} />
        <Bar dataKey="out" name="مصروفات" fill="#f85149" radius={[3,3,0,0]} maxBarSize={22} />
        <Line type="monotone" dataKey="net" name="صافي" stroke="#d4a017" strokeWidth={2.5}
          dot={{ fill: '#d4a017', r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
