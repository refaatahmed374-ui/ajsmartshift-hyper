import { create } from 'zustand'
import type { Permission } from '../../core/types'
import { api, call } from '../lib/api'

interface PermState {
  perms:   Permission[]
  loading: boolean
  load:    (userId: number) => Promise<void>
  has:     (p: Permission) => boolean
  clear:   () => void
}

export const usePermissions = create<PermState>((set, get) => ({
  perms:   [],
  loading: false,

  load: async (userId) => {
    set({ loading: true })
    try {
      const list = await call(api.perms.getUser(userId)) as Permission[]
      set({ perms: list })
    } catch { set({ perms: [] }) }
    finally { set({ loading: false }) }
  },

  has: (p) => get().perms.includes(p),

  clear: () => set({ perms: [] }),
}))
