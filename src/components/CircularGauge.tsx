/**
 * CircularGauge — مقياس دائري متحرك لحالة الشيفت
 * الألوان: أخضر=فائض، أصفر=متزن، أحمر=عجز
 */
interface Props {
  value:     number   // المبلغ المعروض (فرق الرصيد)
  max:       number   // أقصى مرجع
  status:    'surplus' | 'balanced' | 'deficit' | null
  valueFmt?: string   // نص القيمة المنسقة
  sublabel?: string   // نص ثانوي
  size?:     number
}

const COLOR_MAP = {
  surplus:  '#2ea043',
  balanced: '#d29922',
  deficit:  '#f85149',
  null:     '#30363d',
}

const STATUS_LABEL = {
  surplus:  'فائض',
  balanced: 'متزن',
  deficit:  'عجز',
  null:     '—',
}

export default function CircularGauge({ value, max, status, valueFmt, sublabel, size = 160 }: Props) {
  const strokeW = 10
  const r       = (size - strokeW * 2) / 2
  const cx      = size / 2
  const cy      = size / 2
  const circ    = 2 * Math.PI * r

  const ratio = max > 0 ? Math.min(Math.abs(value) / Math.max(max, 1), 1) : 0
  const dash  = ratio * circ * 0.75   // نستخدم 75% من المحيط (270°)
  const total = circ * 0.75

  const color     = COLOR_MAP[status ?? 'null']
  const statusLbl = STATUS_LABEL[status ?? 'null']

  // نبدأ من أسفل اليسار (225°) وندور لأعلى
  const startAngle = 225
  const sweepAngle = 270
  const startRad = (startAngle * Math.PI) / 180
  const endRad   = ((startAngle + sweepAngle * ratio) * Math.PI) / 180

  // بناء قوس SVG
  function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
    const s = (startDeg * Math.PI) / 180
    const e = (endDeg   * Math.PI) / 180
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s)
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e)
    const largeArc = (endDeg - startDeg > 180) ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
  }

  const bgPath  = describeArc(cx, cy, r, 225, 225 + 270)
  const fillDeg = 225 + 270 * ratio
  const fgPath  = ratio > 0 ? describeArc(cx, cy, r, 225, fillDeg) : ''

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0">
        {/* track */}
        <path d={bgPath} fill="none" stroke="#21262d" strokeWidth={strokeW} strokeLinecap="round" />
        {/* progress */}
        {fgPath && (
          <path d={fgPath} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round"
            style={{
              filter: `drop-shadow(0 0 4px ${color}88)`,
              transition: 'all 0.8s cubic-bezier(0.4,0,0.2,1)'
            }} />
        )}
        {/* dot نهاية */}
        {ratio > 0 && (
          <circle
            cx={cx + r * Math.cos((fillDeg * Math.PI) / 180)}
            cy={cy + r * Math.sin((fillDeg * Math.PI) / 180)}
            r="5" fill={color}
            style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'all 0.8s' }} />
        )}
      </svg>

      {/* المحتوى الداخلي */}
      <div className="flex flex-col items-center gap-0.5 text-center z-10">
        <div className="text-lg font-bold tabular-nums leading-none" style={{ color }}>
          {valueFmt ?? '—'}
        </div>
        <div className="text-xs font-semibold" style={{ color }}>
          {statusLbl}
        </div>
        {sublabel && (
          <div className="text-2xs text-surface-400 mt-0.5">{sublabel}</div>
        )}
      </div>
    </div>
  )
}
