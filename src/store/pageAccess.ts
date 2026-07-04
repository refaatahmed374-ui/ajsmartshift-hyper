import { create } from 'zustand'
import { api, call } from '../lib/api'

// ═══════════════════════════════════════════════════════════
// v2.27.0 (14-Jun) — التحكم في رؤية الأقسام لكل مستخدم
// يُخزّن كـ JSON في settings تحت المفتاح: user.hidden_pages.<userId>
// ═══════════════════════════════════════════════════════════

const KEY = (userId: number) => `user.hidden_pages.${userId}`

interface PageAccessState {
  hidden:  string[]                       // الأقسام المخفية للمستخدم الحالي
  load:    (userId: number) => Promise<void>
  isHidden:(pageId: string) => boolean
  clear:   () => void
}

export const usePageAccess = create<PageAccessState>((set, get) => ({
  hidden: [],

  load: async (userId) => {
    try {
      const raw = await call(api.settings.get(KEY(userId))) as string | null
      set({ hidden: raw ? JSON.parse(raw) : [] })
    } catch { set({ hidden: [] }) }
  },

  isHidden: (pageId) => get().hidden.includes(pageId),

  clear: () => set({ hidden: [] }),
}))

// مساعدات للمدير (قراءة/حفظ أقسام مستخدم آخر)
export async function getHiddenPages(userId: number): Promise<string[]> {
  try {
    const raw = await call(api.settings.get(KEY(userId))) as string | null
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export async function setHiddenPages(userId: number, hidden: string[]): Promise<void> {
  await call(api.settings.set(KEY(userId), JSON.stringify(hidden)))
}
