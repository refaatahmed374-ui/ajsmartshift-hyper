interface Props {
  label:    string
  value:    string
  sub?:     string
  color?:   string
  icon?:    React.ReactNode
  trend?:   'up' | 'down' | 'neutral'
  small?:   boolean
}

// أيقونة سهم اتجاه صغيرة
const TrendArrow = ({ dir }: { dir: 'up' | 'down' }) => (
  <svg width={10} height={10} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    {dir === 'up'
      ? <path d="M7 14l5-5 5 5" />
      : <path d="M7 10l5 5 5-5" />}
  </svg>
)

export default function KPICard({ label, value, sub, color = '#388bfd', icon, trend, small }: Props) {
  const trendColor = trend === 'up' ? '#2ea043' : trend === 'down' ? '#f85149' : '#6e7681'

  return (
    <div
      className="kpi-card group"
      style={{ '--kpi-color': color } as React.CSSProperties}>
      <div className="flex items-start justify-between mb-2.5">
        <span className="t-title text-surface-400">{label}</span>
        {icon && (
          <span className="p-2 rounded-xl flex-shrink-0 transition-transform group-hover:scale-110"
            style={{
              background: color + '1a',
              color,
              boxShadow: `0 2px 8px ${color}22`,
            }}>
            {icon}
          </span>
        )}
      </div>
      <div className={small ? 't-num-md' : 't-num-lg'} style={{ color }}>
        {value}
      </div>
      {sub && (
        <div className="flex items-center gap-1 t-caption mt-1.5"
          style={{ color: trendColor, fontWeight: 600 }}>
          {trend === 'up'   && <TrendArrow dir="up" />}
          {trend === 'down' && <TrendArrow dir="down" />}
          <span>{sub}</span>
        </div>
      )}
    </div>
  )
}
