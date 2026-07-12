import { create } from 'zustand'
import { api, call } from '../lib/api'

export type LicenseTier = 'trial' | 'free' | 'basic' | 'professional' | 'multibranch'

export type LicenseMode = 'trial' | 'subscription' | 'transition'
export type LicenseReason = 'ok' | 'expired' | 'deactivated' | 'needsOnline' | 'transitionEnded' | 'trialEnded'

export interface LicenseStatus {
  deviceCode:  string
  deviceId:    string
  activated:   boolean
  tier:        LicenseTier
  tierLabel:   string
  trialStart:  string
  trialEnd:    string
  daysLeft:    number
  daysUsed:    number
  trialDays:   number
  expired:     boolean
  state:       'active' | 'trial' | 'expired'
  // ── الاشتراك الأونلاين ──
  mode:               LicenseMode
  reason:             LicenseReason
  online:             boolean
  subExpireDate:      string | null
  transitionDaysLeft: number
}

// رتبة كل نوع (التجربة = وصول كامل للاختبار)
const TIER_RANK: Record<LicenseTier, number> = {
  trial: 99, free: 1, basic: 2, professional: 3, multibranch: 4,
}
// أقل رتبة مطلوبة لكل ميزة
export type Feature = 'reports' | 'crm' | 'multibranch'
const FEATURE_MIN: Record<Feature, number> = {
  reports: 2,       // أساسي فأعلى
  crm: 3,           // احترافي فأعلى
  multibranch: 4,   // متعدد الفروع
}

interface LicenseState {
  status:   LicenseStatus | null
  loading:  boolean
  load:     () => Promise<void>
  /** تحقق أونلاين من الاشتراك (يحدّث الذاكرة + الحالة) */
  refresh:  () => Promise<void>
  activate: (key: string) => Promise<{ ok: boolean; reason?: string }>
  /** إرسال طلب تفعيل/ترحيل للوحة التحكم */
  requestActivation: (opts?: { customerName?: string; phone?: string; plan?: string }) => Promise<{ ok: boolean; reason?: string }>
  /** هل البرنامج في وضع قراءة فقط (انتهت التجربة/الاشتراك) */
  readOnly: () => boolean
  /** هل النوع الحالي يسمح بالميزة */
  hasFeature: (f: Feature) => boolean
}

export const useLicense = create<LicenseState>((set, get) => ({
  status:  null,
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const s = await call(api.license.status()) as LicenseStatus
      set({ status: s })
    } catch (err) {
      console.error('Failed to load license status:', err)
    }
    finally { set({ loading: false }) }
    // تحقق أونلاين في الخلفية (لا يعطّل الفتح)
    get().refresh()
  },

  refresh: async () => {
    try {
      const s = await call(api.license.refresh()) as LicenseStatus
      if (s) set({ status: s })
    } catch (err) {
      console.error('Failed to refresh license status (maybe offline):', err)
    }
  },

  activate: async (key) => {
    const res = await call(api.license.activate(key)) as { ok: boolean; reason?: string }
    if (res.ok) await get().load()
    return res
  },

  requestActivation: async (opts) => {
    return await call(api.license.requestActivation(opts ?? {})) as { ok: boolean; reason?: string }
  },

  readOnly: () => {
    const s = get().status
    return !!s && s.state === 'expired'
  },

  hasFeature: (f) => {
    const s = get().status
    if (!s) return true                       // قبل التحميل: لا نخفي شيئاً
    const rank = TIER_RANK[s.tier] ?? 0
    return rank >= (FEATURE_MIN[f] ?? 0)
  },
}))
