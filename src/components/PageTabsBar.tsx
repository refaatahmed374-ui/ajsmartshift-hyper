import type { Page } from '../App'

interface OpenTab { page: Page; label: string }

interface Props {
  tabs:     OpenTab[]
  active:   Page
  onSelect: (p: Page) => void
  onClose:  (p: Page) => void
}

// v2.33.0 — شريط تبويبات الصفحات المفتوحة (زي المتصفح) — بديل الاستبدال الكامل للصفحة عند التنقّل
export default function PageTabsBar({ tabs, active, onSelect, onClose }: Props) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0 flex-wrap overflow-x-auto"
      style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
      {tabs.map(t => {
        const isActive = active === t.page
        return (
          <div key={t.page} onClick={() => onSelect(t.page)} role="button"
            className="flex items-center gap-1.5 pr-1.5 pl-2 py-1 rounded-lg cursor-pointer transition-all"
            style={{
              background: isActive ? 'rgba(59,130,246,0.15)' : 'var(--app-bg-solid)',
              border: `1px solid ${isActive ? 'rgba(59,130,246,0.45)' : 'var(--inner-border)'}`,
            }}>
            <span className="text-xs" style={{ color: isActive ? 'var(--accent)' : 'var(--txt-2)', fontWeight: isActive ? 700 : 500 }}>
              {t.label}
            </span>
            {tabs.length > 1 && (
              <button onClick={e => { e.stopPropagation(); onClose(t.page) }}
                className="rounded-full w-4 h-4 flex items-center justify-center text-2xs hover:bg-white/10"
                style={{ color: 'var(--txt-3)' }} title="إغلاق">
                ✕
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
