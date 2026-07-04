/**
 * StatusBar — شريط الحالة السفلي
 * يعرض: حالة الاتصال، قاعدة البيانات، آخر حفظ، الإصدار، المستخدم
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../store/auth'
import { useShift } from '../store/shift'
import Icons from './Icon'

function Dot({ color }: { color: string }) {
  return (
    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
  )
}

export default function StatusBar() {
  const { user } = useAuth()
  const { activeShift, transactions } = useShift()
  const [time, setTime] = useState(new Date().toLocaleTimeString('ar-EG'))
  const [dbStatus] = useState<'connected' | 'error'>('connected')

  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString('ar-EG')), 1000)
    return () => clearInterval(id)
  }, [])

  const txCount = transactions.length

  return (
    <div className="aj-statusbar h-7 flex items-center
      px-3 gap-4 flex-shrink-0 select-none"
      style={{ fontSize: '12px', fontWeight: 500 }}>

      {/* الاتصال */}
      <div className="flex items-center gap-1">
        <Dot color="#2ea043" />
        <span>متصل</span>
      </div>

      <span className="opacity-40">|</span>

      {/* قاعدة البيانات */}
      <div className="flex items-center gap-1">
        <Icons.Records size={10} />
        <span>SQLite</span>
        <Dot color={dbStatus === 'connected' ? '#2ea043' : '#f85149'} />
      </div>

      <span className="opacity-40">|</span>

      {/* بنود الشيفت الحالي */}
      {activeShift && (
        <>
          <div className="flex items-center gap-1">
            <Icons.Journal size={10} />
            <span>{txCount} بند</span>
          </div>
          <span className="opacity-40">|</span>
        </>
      )}

      {/* الشيفت */}
      {activeShift ? (
        <div className="flex items-center gap-1 text-success" style={{ color: '#2ea043' }}>
          <Dot color="#2ea043" />
          <span>شيفت #{activeShift.monthlyShiftNum} مفتوح</span>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Dot color="#6e7681" />
          <span>لا يوجد شيفت</span>
        </div>
      )}

      <div className="flex-1" />

      {/* المستخدم */}
      {user && (
        <div className="flex items-center gap-1">
          <Icons.User size={10} />
          <span>{user.displayName}</span>
        </div>
      )}

      <span className="opacity-40">|</span>

      {/* الوقت */}
      <div className="flex items-center gap-1 tabular-nums">
        <Icons.Clock size={10} />
        <span>{time}</span>
      </div>

      <span className="opacity-40">|</span>

      {/* الإصدار + المطوّر */}
      <span className="font-semibold" style={{ color: 'var(--accent)' }}>v2.31.0</span>
      <span className="opacity-40">|</span>
      <span>
        تطوير <span className="font-bold" style={{ color: 'var(--accent)' }}>أحمد جلال</span>
      </span>
    </div>
  )
}
