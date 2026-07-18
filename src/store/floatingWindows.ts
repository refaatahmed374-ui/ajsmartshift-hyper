import { create } from 'zustand'

// v2.33.0 — نوافذ طافية عامة: فتح شاشة فوق الشاشة الحالية بدون فقدان حالتها (مثلاً فتح
// "إدارة التصنيفات" أثناء تسجيل بند يومية غير محفوظ). التصغير يُخفي النافذة بصريًا فقط
// (لا يفكّها من الشجرة) — انظر FloatingWindowsHost.tsx.
export type FloatablePage = 'categories'

export interface FloatingWindowEntry {
  id:        number
  page:      FloatablePage
  title:     string
  minimized: boolean
}

interface FloatingWindowsState {
  windows:  FloatingWindowEntry[]
  open:     (page: FloatablePage, title: string) => void
  close:    (id: number) => void
  minimize: (id: number) => void
  restore:  (id: number) => void
}

let _nextId = 1

export const useFloatingWindows = create<FloatingWindowsState>((set, get) => ({
  windows: [],

  open: (page, title) => {
    const existing = get().windows.find(w => w.page === page)
    if (existing) { set(s => ({ windows: s.windows.map(w => w.id === existing.id ? { ...w, minimized: false } : w) })); return }
    set(s => ({ windows: [...s.windows, { id: _nextId++, page, title, minimized: false }] }))
  },

  close: (id) => set(s => ({ windows: s.windows.filter(w => w.id !== id) })),

  minimize: (id) => set(s => ({ windows: s.windows.map(w => w.id === id ? { ...w, minimized: true } : w) })),

  restore: (id) => set(s => ({ windows: s.windows.map(w => w.id === id ? { ...w, minimized: false } : w) })),
}))
