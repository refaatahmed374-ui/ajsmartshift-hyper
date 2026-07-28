import { join } from 'path'
import { LicensingClient, type LicenseClientStatus } from 'ajpos-pro-licensing-client'
import { licenseDir } from '../../paths'

// ============================================================
//  نظام الترخيص — يفوّض بالكامل لخدمة AJPOS PRO Licensing الموحّدة عبر
//  مكتبة ajpos-pro-licensing-client المشتركة (نفس المكتبة التي يستخدمها
//  Shared Services وباقي الإصدارات). لا SECRET محلي، لا مفاتيح offline
//  يولّدها المطوّر بنفسه بعد الآن — كل قرار (النوع/الوحدات/المدة) من الخادم فقط.
//  أداتا tools/generate-license.cjs وtools/license-gui.cjs أُلغيَتا لهذا السبب.
// ============================================================

// نفس المفتاح العام المُولَّد بـ genkeys في AJPOS PRO Licensing Service — ليس سرّياً.
// ⚠️ عند نشر الخدمة فعلياً لأول مرة، تأكد أن هذا يطابق حرفياً functions/.keys/public.pem
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArO1ukh63YdNwIsCKmPH3
ygY7JQY4s+mpP79dJXc0snHuTj8c0Arkm/qaGmuMs+K73Agln2D9ixFVRk8RO5HC
W6ADOi4pfrC44uoc8Ypto58qAttwJqNdSMw6QwDyIq7tENm857Z7oc9vhWSYN74H
8T4qKRHKexx5Vskyh+lK7jtgwIkYsOMEgSFGm/vGCQkvQGs3sxdIUqiEY/1w7427
ZgVdszJOm0K2ZmvcVhJ64f9zjAolWYdfhZUsn2L7gXuSXRrO5KvUkJc1wfb64Mzi
wsv17wj+VW4n+g1N++w7nHuAoQ0X+1SegQpioU7jYP8F90Tt8Y6cq4oEWj+5Mlg2
2wIDAQAB
-----END PUBLIC KEY-----`

// محلياً (قبل أي نشر فعلي) يمكن تجاوز هذا بمتغيّر بيئة يشير لمحاكي Firebase، مثال:
//   AJ_LICENSE_API_URL=http://127.0.0.1:5001/ajsmartshift/us-central1/api
const API_BASE_URL = process.env.AJ_LICENSE_API_URL || 'https://ajsmartshift.web.app/api'

const client = new LicensingClient({
  edition: 'hyper-accounts',
  apiBaseUrl: API_BASE_URL,
  publicKeyPem: PUBLIC_KEY_PEM,
  cacheFilePath: join(licenseDir(), 'ajpos-license.json'),
})

// ===== أنواع التراخيص (نفس التسميات القديمة — للتوافق مع الواجهة الحالية) =====
export type LicenseTier = 'trial' | 'free' | 'basic' | 'professional' | 'multibranch'

export const TIER_LABELS: Record<LicenseTier, string> = {
  trial:        'تجريبي',
  free:         'مجاني',
  basic:        'أساسي',
  professional: 'احترافي',
  multibranch:  'متعدد الفروع',
}

export type LicenseMode = 'trial' | 'subscription'
export type LicenseReason = 'ok' | 'expired' | 'deactivated' | 'needsOnline' | 'trialEnded'

export interface LicenseStatus {
  deviceCode:  string
  deviceId:    string
  activated:   boolean
  tier:        LicenseTier
  tierLabel:   string
  trialEnd:    string
  daysLeft:    number
  daysUsed:    number
  trialDays:   number
  expired:     boolean
  state:       'active' | 'trial' | 'expired'
  mode:           LicenseMode
  reason:         LicenseReason
  online:         boolean
  subExpireDate:  string | null
}

// ترجمة الشكل الموحّد الجديد إلى شكل الواجهة القديم — تسمية حقول فقط، لا قرار هنا.
function toLegacyShape(s: LicenseClientStatus): LicenseStatus {
  const STATE = { trial: 'trial', active: 'active', suspended: 'expired', expired: 'expired', transferred: 'expired' } as const
  const REASON = { ok: 'ok', needsOnline: 'needsOnline', suspended: 'deactivated', expired: 'expired', trialEnded: 'trialEnded', offlineNew: 'ok' } as const
  const trialDays = s.trialDays ?? 0
  const daysUsed = trialDays ? Math.min(trialDays, Math.max(1, trialDays - s.daysLeft + 1)) : 0
  const state = STATE[s.status] ?? 'expired'
  return {
    deviceCode: s.deviceCode,
    deviceId: s.deviceId,
    activated: state === 'active',
    tier: (s.tier as LicenseTier) in TIER_LABELS ? (s.tier as LicenseTier) : 'trial',
    tierLabel: TIER_LABELS[(s.tier as LicenseTier) in TIER_LABELS ? (s.tier as LicenseTier) : 'trial'],
    trialEnd: (s.trialEnd ?? '').slice(0, 10),
    daysLeft: s.daysLeft,
    daysUsed,
    trialDays,
    expired: state === 'expired',
    state,
    mode: s.tier === 'trial' ? 'trial' : 'subscription',
    reason: REASON[s.reason] ?? 'ok',
    online: s.online,
    subExpireDate: s.subExpire,
  }
}

export function getLicenseStatus(): LicenseStatus {
  return toLegacyShape(client.getStatus())
}

export async function refreshLicenseOnline(): Promise<LicenseStatus> {
  return toLegacyShape(await client.refresh())
}

export async function submitActivationRequest(
  opts: { customerName?: string; phone?: string; plan?: LicenseTier; note?: string } = {}
): Promise<{ ok: boolean; reason?: string }> {
  return client.requestActivation({
    customerName: opts.customerName,
    phone: opts.phone,
    plan: opts.plan,
    note: opts.note,
  })
}
