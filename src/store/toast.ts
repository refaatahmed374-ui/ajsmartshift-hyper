import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id:      number
  message: string
  type:    ToastType
}

interface ToastState {
  toasts: Toast[]
  show:   (message: string, type?: ToastType) => void
  remove: (id: number) => void
}

let _nextId = 1

export const useToast = create<ToastState>((set) => ({
  toasts: [],

  show: (message, type = 'info') => {
    const id = _nextId++
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3500)
  },

  remove: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))
