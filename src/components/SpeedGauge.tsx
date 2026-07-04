/**
 * SpeedGauge — عدّاد سرعة نصف دائري متحرك لحالة الشيفت
 * أحمر (عجز) → أصفر (متزن) → أخضر (أوفر) مع إبرة متحركة
 */
interface Props {
  /** نسبة الموضع 0..1 (0 = أقصى يسار/عجز، 0.5 = منتصف/متزن، 1 = أقصى يمين/أوفر) */
  ratio:    number
  status:   'surplus' | 'balanced' | 'deficit' | null
  valueFmt: string     // النص المعروض (المبلغ)
  label?:   string     // الحالة بالكلمات
  size?:    number
}

export default function SpeedGauge({ ratio, status, valueFmt, label, size = 220 }: Props) {
  const r       = size / 2 - 18
  const cx      = size / 2
  const cy      = size / 2 + 6
  const strokeW = 16

  // قوس نصف دائري من 180° (يسار) إلى 0° (يمين)
  const polar = (deg: number, radius = r) => {
    const rad = (deg * Math.PI) / 180
    return { x: cx + radius * Math.cos(rad), y: cy - radius * Math.sin(rad) }
  }

  // قوس من زاوية لأخرى
  const arc = (startDeg: number, endDeg: number) => {
    const s = polar(startDeg)
    const e = polar(endDeg)
    const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
    // sweep=0 لأن الزوايا تتناقص (من 180 لـ 0) مع عكس y
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
  }

  // ثلاث مناطق ملوّنة (يسار→يمين): أحمر 180-120، أصفر 120-60، أخضر 60-0
  const clamped = Math.max(0, Math.min(1, ratio))
  const needleDeg = 180 - clamped * 180   // 180° (يسار) إلى 0° (يمين)
  const needle = polar(needleDeg, r - 6)

  const statusColor = status === 'surplus' ? '#2ea043'
    : status === 'deficit' ? '#f85149'
    : status === 'balanced' ? '#d29922' : '#8b949e'

  return (
    <div className="relative flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size / 2 + 30}>
        {/* المناطق الملوّنة */}
        <path d={arc(180, 120)} fill="none" stroke="#f85149" strokeWidth={strokeW} strokeLinecap="butt" opacity={0.85} />
        <path d={arc(120, 60)}  fill="none" stroke="#d29922" strokeWidth={strokeW} strokeLinecap="butt" opacity={0.85} />
        <path d={arc(60, 0)}    fill="none" stroke="#2ea043" strokeWidth={strokeW} strokeLinecap="butt" opacity={0.85} />

        {/* علامات تدريج صغيرة */}
        {[180, 135, 90, 45, 0].map(deg => {
          const p1 = polar(deg, r + strokeW / 2)
          const p2 = polar(deg, r + strokeW / 2 + 5)
          return <line key={deg} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
            stroke="rgba(255,255,255,0.3)" strokeWidth={2} />
        })}

        {/* الإبرة */}
        <line x1={cx} y1={cy} x2={needle.x} y2={needle.y}
          stroke={statusColor} strokeWidth={4} strokeLinecap="round"
          style={{ transition: 'all 0.8s cubic-bezier(0.34,1.56,0.64,1)', filter: `drop-shadow(0 0 4px ${statusColor})` }} />
        {/* مركز الإبرة */}
        <circle cx={cx} cy={cy} r={9} fill={statusColor}
          style={{ filter: `drop-shadow(0 0 6px ${statusColor})`, transition: 'fill 0.5s' }} />
        <circle cx={cx} cy={cy} r={4} fill="#0a0e1a" />
      </svg>

      {/* القيمة والحالة */}
      <div className="text-center -mt-2">
        <div className="tabular-nums" style={{ fontSize: '26px', fontWeight: 700, color: statusColor, lineHeight: '32px' }}>
          {valueFmt}
        </div>
        {label && (
          <div style={{ fontSize: '15px', fontWeight: 700, color: statusColor, marginTop: '2px' }}>{label}</div>
        )}
      </div>
    </div>
  )
}
