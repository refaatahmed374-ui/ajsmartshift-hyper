import { create } from 'zustand'
import type { User } from '../../core/types'
import { usePermissions } from './permissions'

interface AuthState {
  user:   User | null
  login:  (user: User) => void
  logout: () => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,

  login: (user) => {
    set({ user })
    // تحميل صلاحيات المستخدم فور تسجيل الدخول
    usePermissions.getState().load(user.id)
  },

  logout: () => {
    set({ user: null })
    usePermissions.getState().clear()
  },
}))
