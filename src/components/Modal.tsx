import { ReactNode, useEffect } from 'react'
import Icons from './Icon'

interface Props {
  open:     boolean
  title:    string
  onClose:  () => void
  children: ReactNode
  size?:    'sm' | 'md' | 'lg' | 'xl'
  footer?:  ReactNode
}

const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' }

export default function Modal({ open, title, onClose, children, size = 'md', footer }: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className={`relative w-full ${sizes[size]} mx-4 bg-surface-700 border border-surface-500
        rounded-2xl shadow-2xl fade-in flex flex-col max-h-[90vh]`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-500">
          <h2 className="text-base font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-surface-400 hover:text-white transition-colors">
            <Icons.X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 flex-1">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-5 py-4 border-t border-surface-500 flex gap-2 justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
