import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { createHash } from 'crypto'
import os from 'os'
import { licenseDir, legacyLicenseFile } from '../../paths'

// ===== الإعدادات الثابتة =====
const TRIAL_DAYS = 35
// سر داخلي لتوليد المفاتيح — لا يُكشف للعميل
const SECRET = 'AJ-SmartShift-2026-#Galal#-SecretSalt-v2'

// ===== إعدادات الاشتراك الأونلاين (Firebase Spark — مجاني) =====
// مفتاح الويب عام بطبيعته (تحميه قواعد Firestore) — ليس سراً.
const FB_PROJECT = 'ajsmartshift'
const FB_API_KEY = 'AIzaSyCm5Q0vOqb6KPzq5BUEkBZQroQk3fKvmDY'
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`
const GRACE_DAYS = 7        // فترة سماح offline قبل طلب الاتصال
const TRANSITION_DAYS = 30  // فترة انتقالية للعملاء الحاليين (مفاتيح دائمة)
const ONLINE_TIMEOUT_MS = 6000

// ===== أنواع التراخيص =====
export type LicenseTier = 'trial' | 'free' | 'basic' | 'professional' | 'multibranch'
const PAID_TIERS: LicenseTier[] = ['free', 'basic', 'professional', 'multibranch']

export const TIER_LABELS: Record<LicenseTier, string> = {
  trial:        'تجريبي',
  free:         'مجاني',
  basic:        'أساسي',
  professional: 'احترافي',
  multibranch:  'متعدد الفروع',
}

interface LicenseFile {
  deviceId:      string
  trialStart:    string   // ISO date
  activated:     boolean  // فُعّل بمفتاح دائم (offline) — للتوافق
  activationKey: string
  tier:          LicenseTier
  // ── ذاكرة الاشتراك الأونلاين (cache) ──
  subExists?:       boolean         // يوجد ترخيص أونلاين لهذا الجهاز
  subActive?:       boolean         // آخر حالة معروفة: نشط؟
  subExpire?:       string | null   // تاريخ الانتهاء ISO (null = دائم)
  subPlan?:         LicenseTier      // باقة الاشتراك
  lastOnline?:      string          // آخر تحقق أونلاين ناجح ISO
  transitionStart?: string | null   // بداية الفترة الانتقالية (لمفاتيح دائمة)
}

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
  // ── حقول الاشتراك الأونلاين ──
  mode:           LicenseMode
  reason:         LicenseReason
  online:         boolean         // آخر تحقق ناجح ضمن فترة السماح
  subExpireDate:  string | null   // تاريخ انتهاء الاشتراك
  transitionDaysLeft: number      // أيام متبقية في الفترة الانتقالية
}

// ===== بصمة الجهاز =====
function computeDeviceId(): string {
  const cpu = os.cpus()[0]?.model ?? 'cpu'
  const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${cpu}`
  return createHash('sha256').update(raw).digest('hex')
}

function deviceCodeFromId(deviceId: string): string {
  const short = deviceId.slice(0, 8).toUpperCase()
  return `AJ-${short.slice(0, 4)}-${short.slice(4, 8)}`
}

// مفتاح التفعيل المتوقّع لجهاز ونوع معيّن
export function expectedKeyFor(deviceId: string, tier: LicenseTier = 'professional'): string {
  const hash = createHash('sha256').update(deviceId + SECRET + '|' + tier).digest('hex').toUpperCase()
  const k = hash.slice(0, 16)
  return `${k.slice(0,4)}-${k.slice(4,8)}-${k.slice(8,12)}-${k.slice(12,16)}`
}

// مفتاح قديم (بدون نوع) — للتوافق → "احترافي"
function legacyExpectedKey(deviceId: string): string {
  const hash = createHash('sha256').update(deviceId + SECRET).digest('hex').toUpperCase()
  const k = hash.slice(0, 16)
  return `${k.slice(0,4)}-${k.slice(4,8)}-${k.slice(8,12)}-${k.slice(12,16)}`
}

// ===== مسار ملف الترخيص =====
function licensePath(): string {
  return join(licenseDir(), 'aj.lic')
}

function readLicense(): LicenseFile {
  const path = licensePath()
  if (!existsSync(path)) {
    try {
      const old = legacyLicenseFile()
      if (existsSync(old)) copyFileSync(old, path)
    } catch { /* ignore */ }
  }
  const deviceId = computeDeviceId()
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LicenseFile>
      if (data.deviceId === deviceId) {
        return {
          deviceId,
          trialStart:    data.trialStart    ?? new Date().toISOString(),
          activated:     data.activated      ?? false,
          activationKey: data.activationKey  ?? '',
          tier:          data.tier           ?? (data.activated ? 'professional' : 'trial'),
          subExists:        data.subExists,
          subActive:        data.subActive,
          subExpire:        data.subExpire,
          subPlan:          data.subPlan,
          lastOnline:       data.lastOnline,
          transitionStart:  data.transitionStart,
        }
      }
    } catch { /* تالف */ }
  }
  const fresh: LicenseFile = {
    deviceId,
    trialStart:    new Date().toISOString(),
    activated:     false,
    activationKey: '',
    tier:          'trial',
  }
  writeFileSync(path, JSON.stringify(fresh), 'utf-8')
  return fresh
}

function writeLicense(lic: LicenseFile): void {
  writeFileSync(licensePath(), JSON.stringify(lic), 'utf-8')
}

// ===== بناء الحالة من الذاكرة (متزامن — سريع، لا شبكة) =====
const DAY = 24 * 60 * 60 * 1000

function buildStatus(lic: LicenseFile): LicenseStatus {
  const now = Date.now()
  const deviceCode = deviceCodeFromId(lic.deviceId)
  const trialStartD = new Date(lic.trialStart)
  const trialEndD = new Date(trialStartD.getTime() + TRIAL_DAYS * DAY)

  const base = {
    deviceCode,
    deviceId:   lic.deviceId,
    trialStart: lic.trialStart.slice(0, 10),
    trialEnd:   trialEndD.toISOString().slice(0, 10),
    trialDays:  TRIAL_DAYS,
  }

  // ── (1) يوجد اشتراك أونلاين معروف ──
  if (lic.subExists) {
    const plan = lic.subPlan ?? 'professional'
    const expISO = lic.subExpire ?? null
    const expMs = expISO ? new Date(expISO).getTime() : null
    const notExpired = expMs == null || now < expMs
    const lastOnlineMs = lic.lastOnline ? new Date(lic.lastOnline).getTime() : 0
    const withinGrace = (now - lastOnlineMs) <= GRACE_DAYS * DAY
    const daysLeft = expMs ? Math.max(0, Math.ceil((expMs - now) / DAY)) : 9999

    if (lic.subActive && notExpired) {
      if (!withinGrace) {
        // الذاكرة قديمة جداً — نطلب الاتصال للتحقق (مفتاح القتل عن بُعد)
        return { ...base, activated: true, tier: plan, tierLabel: TIER_LABELS[plan], daysLeft: 0,
          daysUsed: TRIAL_DAYS, expired: true, state: 'expired',
          mode: 'subscription', reason: 'needsOnline', online: false, subExpireDate: expISO, transitionDaysLeft: 0 }
      }
      return { ...base, activated: true, tier: plan, tierLabel: TIER_LABELS[plan], daysLeft,
        daysUsed: TRIAL_DAYS, expired: false, state: 'active',
        mode: 'subscription', reason: 'ok', online: true, subExpireDate: expISO, transitionDaysLeft: 0 }
    }
    // موقوف أو منتهٍ
    return { ...base, activated: false, tier: plan, tierLabel: TIER_LABELS[plan], daysLeft: 0,
      daysUsed: TRIAL_DAYS, expired: true, state: 'expired',
      mode: 'subscription', reason: notExpired ? 'deactivated' : 'expired',
      online: withinGrace, subExpireDate: expISO, transitionDaysLeft: 0 }
  }

  // ── (2) لا اشتراك أونلاين، لكن مفعّل بمفتاح دائم → فترة انتقالية ──
  if (lic.activated) {
    const tStart = lic.transitionStart ? new Date(lic.transitionStart).getTime() : now
    const tEnd = tStart + TRANSITION_DAYS * DAY
    const daysLeft = Math.max(0, Math.ceil((tEnd - now) / DAY))
    if (now < tEnd) {
      return { ...base, activated: true, tier: lic.tier, tierLabel: TIER_LABELS[lic.tier], daysLeft,
        daysUsed: TRIAL_DAYS, expired: false, state: 'active',
        mode: 'transition', reason: 'ok', online: false, subExpireDate: null, transitionDaysLeft: daysLeft }
    }
    return { ...base, activated: false, tier: lic.tier, tierLabel: TIER_LABELS[lic.tier], daysLeft: 0,
      daysUsed: TRIAL_DAYS, expired: true, state: 'expired',
      mode: 'transition', reason: 'transitionEnded', online: false, subExpireDate: null, transitionDaysLeft: 0 }
  }

  // ── (3) تجربة ──
  const msLeft = trialEndD.getTime() - now
  const daysLeft = Math.max(0, Math.ceil(msLeft / DAY))
  const daysUsed = Math.min(TRIAL_DAYS, Math.max(1, TRIAL_DAYS - daysLeft + 1))
  const expired = msLeft <= 0
  return { ...base, activated: false, tier: 'trial', tierLabel: TIER_LABELS.trial, daysLeft, daysUsed,
    expired, state: expired ? 'expired' : 'trial',
    mode: 'trial', reason: expired ? 'trialEnded' : 'ok', online: false, subExpireDate: null, transitionDaysLeft: 0 }
}

// ===== الحالة الكاملة (متزامن) =====
export function getLicenseStatus(): LicenseStatus {
  return buildStatus(readLicense())
}

// ===== قراءة الاشتراك من Firestore (REST — بلا مكتبات) =====
interface OnlineLicense { found: boolean; active?: boolean; expire?: string | null; plan?: LicenseTier }

async function fetchOnlineLicense(deviceId: string): Promise<OnlineLicense | null> {
  const url = `${FS_BASE}/licenses/${deviceId}?key=${FB_API_KEY}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ONLINE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (res.status === 404) return { found: false }
    if (!res.ok) return null               // خطأ خادم — نعتبره offline
    const data = await res.json() as { fields?: Record<string, any> }
    const f = data.fields ?? {}
    const active = f.active?.booleanValue ?? false
    const plan = (f.plan?.stringValue as LicenseTier) ?? 'professional'
    const expire = f.expireDate?.timestampValue ?? (f.expireDate?.nullValue !== undefined ? null : null)
    return { found: true, active, plan, expire }
  } catch {
    return null                            // شبكة مقطوعة
  } finally {
    clearTimeout(t)
  }
}

// ===== تحديث الاشتراك أونلاين + بدء الفترة الانتقالية (غير متزامن) =====
export async function refreshLicenseOnline(): Promise<LicenseStatus> {
  const lic = readLicense()
  const online = await fetchOnlineLicense(lic.deviceId)

  if (online == null) {
    // شبكة مقطوعة — لا نغيّر الذاكرة. لو مفعّل دائم وبلا بداية انتقالية، لا نبدؤها إلا عند الاتصال.
    return buildStatus(lic)
  }

  if (online.found) {
    lic.subExists = true
    lic.subActive = online.active
    lic.subExpire = online.expire ?? null
    lic.subPlan = online.plan
    lic.lastOnline = new Date().toISOString()
  } else {
    // لا يوجد ترخيص أونلاين لهذا الجهاز
    lic.subExists = false
    lic.lastOnline = new Date().toISOString()
    // عميل حالي بمفتاح دائم → ابدأ الفترة الانتقالية وأرسل طلب ترحيل تلقائي
    if (lic.activated && !lic.transitionStart) {
      lic.transitionStart = new Date().toISOString()
      submitActivationRequest({ plan: lic.tier, note: 'ترحيل تلقائي — عميل حالي' }).catch(() => {})
    }
  }
  writeLicense(lic)
  return buildStatus(lic)
}

// ===== إرسال طلب تفعيل/ترحيل للوحة التحكم (Firestore REST) =====
export async function submitActivationRequest(
  opts: { customerName?: string; phone?: string; plan?: LicenseTier; note?: string } = {}
): Promise<{ ok: boolean; reason?: string }> {
  const lic = readLicense()
  const deviceId = lic.deviceId
  const url = `${FS_BASE}/activationRequests?documentId=${deviceId}&key=${FB_API_KEY}`
  const body = {
    fields: {
      machineId:    { stringValue: deviceId },
      deviceCode:   { stringValue: deviceCodeFromId(deviceId) },
      customerName: { stringValue: opts.customerName ?? '' },
      phone:        { stringValue: opts.phone ?? '' },
      plan:         { stringValue: opts.plan ?? 'professional' },
      status:       { stringValue: 'pending' },
      note:         { stringValue: opts.note ?? '' },
      createdAt:    { timestampValue: new Date().toISOString() },
    },
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ONLINE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (res.ok) return { ok: true }
    if (res.status === 409) return { ok: true, reason: 'الطلب مُرسَل بالفعل' } // موجود مسبقاً
    return { ok: false, reason: 'تعذّر إرسال الطلب (' + res.status + ')' }
  } catch {
    return { ok: false, reason: 'لا يوجد اتصال بالإنترنت' }
  } finally {
    clearTimeout(t)
  }
}

// ===== التفعيل بمفتاح (offline — يبقى للتوافق وللتفعيل بلا إنترنت) =====
export function activateLicense(key: string): { ok: boolean; reason?: string; tier?: LicenseTier } {
  const lic = readLicense()
  const clean = key.trim().toUpperCase().replace(/\s/g, '')

  for (const tier of PAID_TIERS) {
    if (clean === expectedKeyFor(lic.deviceId, tier)) {
      lic.activated = true
      lic.activationKey = clean
      lic.tier = tier
      writeLicense(lic)
      return { ok: true, tier }
    }
  }
  if (clean === legacyExpectedKey(lic.deviceId)) {
    lic.activated = true
    lic.activationKey = clean
    lic.tier = 'professional'
    writeLicense(lic)
    return { ok: true, tier: 'professional' }
  }
  return { ok: false, reason: 'مفتاح التفعيل غير صحيح لهذا الجهاز' }
}
