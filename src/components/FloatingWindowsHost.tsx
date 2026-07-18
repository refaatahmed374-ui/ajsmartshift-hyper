import type { ReactNode } from 'react'
import { useFloatingWindows, type FloatablePage } from '../store/floatingWindows'
import Icons from './Icon'
import Categories from '../pages/Categories'

// خريطة الصفحات القابلة للفتح كنافذة طافية — وسّعها بإضافة مفتاح جديد فقط
const FLOATABLE_PAGES: Record<FloatablePage, ReactNode> = {
  categories: <Categories />,
}

export default function FloatingWindowsHost() {
  const { windows, close, minimize, restore } = useFloatingWindows()
  const minimizedWindows = windows.filter(w => w.minimized)

  return (
    <>
      {windows.map(w => (
        // تبقى في الشجرة دائماً (حتى لو مصغّرة) — التصغير إخفاء بصري فقط، لا يفكّها من الذاكرة
        <div key={w.id} className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ display: w.minimized ? 'none' : 'flex' }}>
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} />
          <div className="relative flex flex-col fade-in"
            style={{
              width: '92vw', height: '88vh', maxWidth: 1400,
              background: 'var(--app-bg-solid)', border: '1px solid var(--inner-border)',
              borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
            }}>
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
              <span className="font-bold text-sm" style={{ color: 'var(--txt-1)' }}>{w.title}</span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => minimize(w.id)} title="تصغير"
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
                  style={{ color: 'var(--txt-2)' }}>
                  <Icons.Minimize size={14} />
                </button>
                <button onClick={() => close(w.id)} title="إغلاق"
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
                  style={{ color: 'var(--txt-2)' }}>
                  <Icons.Close size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {FLOATABLE_PAGES[w.page]}
            </div>
          </div>
        </div>
      ))}

      {/* شريط النوافذ المصغّرة — يظهر فقط لو فيه نافذة مصغّرة على الأقل */}
      {minimizedWindows.length > 0 && (
        <div className="flex items-center gap-2 px-3 flex-shrink-0 overflow-x-auto"
          style={{ height: 38, background: 'var(--inner-bg)', borderTop: '1px solid var(--inner-border)' }}>
          {minimizedWindows.map(w => (
            <div key={w.id} onClick={() => restore(w.id)}
              className="flex items-center gap-2 px-3 py-1 rounded-lg cursor-pointer transition-colors hover:bg-white/5"
              style={{ background: 'var(--app-bg-solid)', border: '1px solid var(--inner-border)' }}>
              <span className="text-2xs font-bold" style={{ color: 'var(--txt-2)' }}>{w.title}</span>
              <button onClick={e => { e.stopPropagation(); close(w.id) }}
                className="rounded-full w-4 h-4 flex items-center justify-center text-2xs hover:bg-white/10"
                style={{ color: 'var(--txt-3)' }} title="إغلاق">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
