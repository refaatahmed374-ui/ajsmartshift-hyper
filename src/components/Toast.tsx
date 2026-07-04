import { useToast } from '../store/toast'
import Icons from './Icon'

const colors: Record<string, string> = {
  success: 'bg-success/20 border-success/40 text-success',
  error:   'bg-danger/20  border-danger/40  text-danger',
  warning: 'bg-warning/20 border-warning/40 text-warning',
  info:    'bg-info/20    border-info/40    text-info',
}

export default function ToastContainer() {
  const { toasts, remove } = useToast()
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-80">
      {toasts.map(t => (
        <div key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold
            shadow-lg backdrop-blur-sm slide-up ${colors[t.type]}`}>
          <span className="flex-1">{t.message}</span>
          <button onClick={() => remove(t.id)} className="opacity-60 hover:opacity-100">
            <Icons.X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
