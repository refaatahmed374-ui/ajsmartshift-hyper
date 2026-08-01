// v2.38.7 — حوار تأكيد داخل التطبيق بديل confirm() الأصلي (حوار نظام حاجز). كان يعطّل تركيز نافذة
// Electron بشكل يخلّي أول عنصر واجهة أصلية بعده (مثل خانة تاريخ <input type="date">) غير مستجيب لثوانٍ.
interface Props {
  open:    boolean
  title:   string
  message: string
  danger?: boolean
  onConfirm: () => void
  onCancel:  () => void
}

export default function ConfirmDialog({ open, title, message, danger, onConfirm, onCancel }: Props) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={onCancel}>
      <div className="card p-6 max-w-sm text-center" onClick={e => e.stopPropagation()} style={{ border: `1px solid ${danger ? 'rgba(248,113,113,0.4)' : 'var(--inner-border)'}` }}>
        <div className="text-3xl mb-2">{danger ? '⚠️' : '❓'}</div>
        <div className="font-black text-base mb-1" style={{ color: 'var(--txt-1)' }}>{title}</div>
        <div className="text-xs mb-4 whitespace-pre-line" style={{ color: 'var(--txt-2)' }}>{message}</div>
        <div className="flex items-center gap-2 justify-center flex-wrap">
          <button onClick={onConfirm} className="text-sm font-bold px-4 py-2 rounded-lg text-white"
            style={{ background: danger ? 'linear-gradient(90deg,#ef4444,#dc2626)' : 'linear-gradient(90deg,#16a34a,#22c55e)' }}>
            تأكيد
          </button>
          <button onClick={onCancel} className="text-sm px-3 py-2 rounded-lg" style={{ color: 'var(--txt-2)', border: '1px solid var(--inner-border)' }}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}
