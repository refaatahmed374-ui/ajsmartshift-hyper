import { useState, useEffect } from 'react'
import { api, call } from '../lib/api'
import { useLicense } from '../store/license'
import { useToast } from '../store/toast'
import Icons from '../components/Icon'
import BackupPage from './Backup'

const GOLD = '#d4a017'

type HubTab = 'info' | 'license' | 'backup' | 'business'

const TABS: { id: HubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'info',     label: 'معلومات البرنامج',   icon: <Icons.Info size={14} /> },
  { id: 'license',  label: 'الترخيص والاشتراك',  icon: <Icons.Lock size={14} /> },
  { id: 'backup',   label: 'النسخ الاحتياطي',    icon: <Icons.Backup size={14} /> },
  { id: 'business', label: 'بيانات المنشأة',      icon: <Icons.Records size={14} /> },
]

export default function About() {
  const { show } = useToast()
  const {
    status, load: loadLicense,
    activate, requestActivation, refresh: refreshLicense,
  } = useLicense()
  const [tab, setTab] = useState<HubTab>('info')
  const [appVersion, setAppVersion] = useState('')

  // ===== بيانات المنشأة =====
  const [biz, setBiz] = useState({
    name: '', address: '', phone: '', taxNumber: '', commercialReg: '', currency: 'ج', logo: '',
  })
  const [savingBiz, setSavingBiz] = useState(false)

  // ===== التفعيل =====
  const [activationKey, setActivationKey] = useState('')
  const [activating,    setActivating]    = useState(false)
  const [requesting,    setRequesting]    = useState(false)

  async function loadBiz() {
    const all = await call(api.settings.getAll()) as { key: string; value: string }[]
    const get = (k: string) => all.find(s => s.key === k)?.value ?? ''
    setBiz({
      name:          get('biz.name'),
      address:       get('biz.address'),
      phone:         get('biz.phone'),
      taxNumber:     get('biz.taxNumber'),
      commercialReg: get('biz.commercialReg'),
      currency:      get('biz.currency') || 'ج',
      logo:          get('biz.logo'),
    })
  }

  async function loadVersion() {
    try {
      const info = await call(api.system.info()) as { version: string }
      setAppVersion(info.version)
    } catch {}
  }
  useEffect(() => { loadLicense(); loadBiz(); loadVersion() }, [])

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { show('الرجاء اختيار ملف صورة', 'warning'); return }
    if (file.size > 1024 * 1024) { show('حجم الشعار يجب أن يكون أقل من 1 ميجابايت', 'warning'); return }
    const reader = new FileReader()
    reader.onload = () => setBiz(b => ({ ...b, logo: String(reader.result) }))
    reader.readAsDataURL(file)
  }

  async function handleSaveBiz() {
    setSavingBiz(true)
    try {
      await call(api.settings.set('biz.name',          biz.name))
      await call(api.settings.set('biz.address',       biz.address))
      await call(api.settings.set('biz.phone',         biz.phone))
      await call(api.settings.set('biz.taxNumber',     biz.taxNumber))
      await call(api.settings.set('biz.commercialReg', biz.commercialReg))
      await call(api.settings.set('biz.currency',      biz.currency))
      await call(api.settings.set('biz.logo',          biz.logo))
      show('تم حفظ بيانات المنشأة ✓', 'success')
    } catch (e) { show((e as Error).message, 'error') }
    finally { setSavingBiz(false) }
  }

  async function handleRequestActivation() {
    setRequesting(true)
    try {
      const res = await requestActivation({ plan: status?.tier })
      if (res.ok) show(res.reason ?? 'تم إرسال طلب التفعيل ✓ — سيُفعّل بعد المراجعة', 'success')
      else show(res.reason ?? 'تعذّر إرسال الطلب', 'error')
    } catch (e) { show((e as Error).message, 'error') }
    finally { setRequesting(false) }
  }

  async function handleActivate() {
    if (!activationKey.trim()) { show('أدخل مفتاح التفعيل', 'warning'); return }
    setActivating(true)
    try {
      const res = await activate(activationKey.trim())
      if (res.ok) show('تم تفعيل النسخة بنجاح ✓', 'success')
      else show(res.reason ?? 'فشل التفعيل', 'error')
    } catch (e) { show((e as Error).message, 'error') }
    finally { setActivating(false) }
  }

  function copyDeviceId() {
    if (status?.deviceId) {
      navigator.clipboard.writeText(status.deviceId)
      show('تم نسخ رقم الجهاز الكامل', 'success')
    }
  }

  const stateColor = status?.state === 'active' ? '#2ea043'
    : status?.state === 'expired' ? '#f85149' : GOLD
  const stateText = status?.state === 'active' ? 'مفعّل'
    : status?.state === 'expired' ? 'منتهٍ' : 'تجريبي'

  const infoRows: [string, string, string?][] = [
    ['إصدار البرنامج',      appVersion ? 'v' + appVersion : '—', GOLD],
    ['المنشأة',             biz.name || '—'],
    ['نوع الترخيص',         status?.tierLabel ?? '—', stateColor],
    ['حالة الترخيص',        stateText, stateColor],
    ['رقم الجهاز',          status?.deviceCode ?? '—'],
    ['تاريخ التفعيل/البدء', status?.trialStart ?? '—'],
    ['الأيام المتبقية',     status?.activated ? '∞ (مفعّل)' : `${status?.daysLeft ?? 0} يوم`],
    ['قاعدة البيانات',      'SQLite 3.45'],
    ['بيئة التشغيل',        'Electron 29'],
    ['مسار البيانات',       'C:\\ProgramData\\AJ Smart Shift'],
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ═══ رأس القسم ═══ */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0"
          style={{ background: biz.logo ? 'var(--inner-bg)' : `linear-gradient(135deg, ${GOLD}, #bd8a10)`, border: '1px solid var(--inner-border)' }}>
          {biz.logo
            ? <img src={biz.logo} alt="شعار" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span className="text-white font-extrabold" style={{ fontSize: 17 }}>AJ</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold truncate" style={{ fontSize: 16, color: 'var(--txt-1)' }}>حول البرنامج</div>
          <div className="truncate" style={{ fontSize: 11.5, color: 'var(--txt-3)' }}>
            {biz.name || 'AJ Smart Shift'} · {appVersion ? 'v' + appVersion : ''}
          </div>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full flex-shrink-0"
          style={{ fontSize: 12, fontWeight: 700, background: stateColor + '22', color: stateColor }}>
          {status?.tierLabel ?? '—'} · {stateText}
        </span>
      </div>

      {/* ═══ تبويبات القسم ═══ */}
      <div className="flex items-center gap-1 px-4 pt-2 flex-shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid var(--inner-border)' }}>
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg transition-all"
              style={{
                fontSize: 13.5, fontWeight: active ? 700 : 500,
                color: active ? 'var(--accent)' : 'var(--txt-2)',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                background: active ? 'rgba(59,130,246,0.08)' : 'transparent',
              }}>
              {t.icon}{t.label}
            </button>
          )
        })}
      </div>

      {/* ═══ النسخ الاحتياطي (الصفحة الكاملة) ═══ */}
      {tab === 'backup' && <div className="flex-1 overflow-hidden flex flex-col"><BackupPage /></div>}

      <div className={`flex-1 overflow-y-auto p-5 ${tab === 'backup' ? 'hidden' : ''}`}>
        <div className="max-w-2xl mx-auto space-y-4">

          {/* ═══ معلومات البرنامج ═══ */}
          {tab === 'info' && (
            <>
              <div className="card p-0 overflow-hidden">
                {infoRows.map(([label, value, color], i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom: i < infoRows.length - 1 ? '1px solid var(--inner-border)' : 'none' }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--txt-2)' }}>{label}</span>
                    <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 700, color: color ?? 'var(--txt-1)', fontFamily: 'monospace' }}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="card text-center py-5">
                <div style={{ fontSize: 13, color: 'var(--txt-3)' }}>تطوير وتصميم</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: GOLD, marginTop: 4 }}>أحمد جلال</div>
                <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 6 }}>© 2026 جميع الحقوق محفوظة للمطوّر</div>
              </div>
            </>
          )}

          {/* ═══ الترخيص والاشتراك ═══ */}
          {tab === 'license' && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <Icons.Lock size={15} className="text-brand-400" />
                <span className="font-bold text-white text-sm">الترخيص والاشتراك</span>
                {status && (
                  <span className="mr-auto badge text-2xs"
                    style={{
                      background: (status.state === 'active' ? '#2ea043' : status.state === 'expired' ? '#f85149' : '#d4a017') + '22',
                      color:       status.state === 'active' ? '#2ea043' : status.state === 'expired' ? '#f85149' : '#d4a017',
                    }}>
                    {status.state === 'active'
                      ? (status.mode === 'transition' ? `⏳ فترة انتقالية — ${status.tierLabel}` : `✓ مفعّلة — ${status.tierLabel}`)
                      : status.state === 'expired'
                        ? (status.reason === 'needsOnline' ? '⚠ يلزم اتصال' : status.reason === 'deactivated' ? '⛔ موقوفة' : '✕ منتهية')
                        : '⏳ تجريبية'}
                  </span>
                )}
              </div>

              {status && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                      { label: 'رقم الجهاز',   value: status.deviceCode },
                      { label: 'الباقة',        value: status.tierLabel },
                      { label: 'نوع الترخيص',   value: status.mode === 'subscription' ? 'اشتراك' : status.mode === 'transition' ? 'انتقالي' : 'تجريبي' },
                      { label: status.mode === 'subscription' ? 'ينتهي الاشتراك' : status.mode === 'transition' ? 'متبقٍ للترحيل' : 'الأيام المتبقية',
                        value: status.mode === 'subscription'
                          ? (status.subExpireDate ? status.subExpireDate.slice(0, 10) : 'دائم')
                          : status.mode === 'transition'
                            ? `${status.transitionDaysLeft} يوم`
                            : `${status.daysLeft} يوم` },
                    ].map(item => (
                      <div key={item.label} className="bg-surface-800 rounded-lg p-2.5 text-center">
                        <div className="text-2xs text-surface-400 mb-1">{item.label}</div>
                        <div className="text-xs font-bold text-white tabular-nums" style={{ fontFamily: 'monospace' }}>{item.value}</div>
                      </div>
                    ))}
                  </div>

                  {status.state === 'trial' && (
                    <div className="rounded-lg p-3" style={{ background: 'rgba(212,160,23,0.1)', border: '1px solid rgba(212,160,23,0.3)' }}>
                      <div className="flex justify-between text-xs mb-2">
                        <span className="font-bold" style={{ color: '#d4a017' }}>الفترة التجريبية</span>
                        <span className="text-surface-300">يوم {status.daysUsed} من {status.trialDays}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                        <div className="h-full rounded-full" style={{ width: `${(status.daysUsed / status.trialDays) * 100}%`, background: '#d4a017' }} />
                      </div>
                    </div>
                  )}

                  {status.mode === 'transition' && status.state === 'active' && (
                    <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa' }}>
                      ⏳ <span className="font-bold">فترة انتقالية</span> — تم تحويل نظام الترخيص إلى اشتراكات.
                      نسختك تعمل بالكامل لمدة <span className="font-bold">{status.transitionDaysLeft} يوم</span> أخرى.
                      أرسل طلب التفعيل ليُحوّل جهازك لاشتراك دائم.
                    </div>
                  )}

                  {status.mode === 'subscription' && status.state === 'active' && (
                    <div className="rounded-lg p-3 text-xs text-success flex items-center gap-2" style={{ background: 'rgba(46,160,67,0.1)', border: '1px solid rgba(46,160,67,0.3)' }}>
                      <Icons.Check size={14} />
                      اشتراك نشط ✓ {status.subExpireDate ? `— ينتهي ${status.subExpireDate.slice(0,10)}` : '— دائم'}
                      {!status.online && <span className="text-surface-400">(آخر تحقق محفوظ — وضع عدم الاتصال)</span>}
                    </div>
                  )}

                  {status.state === 'expired' && (
                    <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149' }}>
                      {status.reason === 'needsOnline'
                        ? '⚠ مرّت أكثر من 7 أيام دون اتصال — يلزم الاتصال بالإنترنت لتأكيد الاشتراك.'
                        : status.reason === 'deactivated'
                          ? '⛔ تم إيقاف هذا الاشتراك. تواصل مع المطوّر لإعادة التفعيل.'
                          : status.reason === 'transitionEnded'
                            ? '⏳ انتهت الفترة الانتقالية. أرسل طلب التفعيل لتحويل جهازك لاشتراك.'
                            : status.reason === 'expired'
                              ? '✕ انتهى اشتراكك. أرسل طلب تجديد أو تواصل مع المطوّر.'
                              : '✕ انتهت الفترة التجريبية. أرسل طلب التفعيل للاشتراك.'}
                    </div>
                  )}

                  <div className="border-t border-surface-600 pt-4">
                    <div className="text-xs text-surface-400 mb-3">
                      للتفعيل/التجديد: أرسل طلباً للمطوّر <span className="font-bold text-white mx-1">أحمد جلال</span>
                      (يصله فوراً)، أو انسخ رقم الجهاز وفعّل بمفتاح يدوي.
                    </div>
                    <div className="flex gap-2 mb-3 flex-wrap">
                      <button onClick={handleRequestActivation} disabled={requesting} className="btn-primary btn-sm">
                        {requesting ? 'جاري الإرسال...' : <><Icons.Upload size={13} /> إرسال طلب تفعيل / تجديد</>}
                      </button>
                      <button onClick={copyDeviceId} className="btn-ghost btn-sm">
                        <Icons.Download size={13} /> نسخ رقم الجهاز الكامل
                      </button>
                      <button onClick={() => refreshLicense()} className="btn-ghost btn-sm">
                        <Icons.Refresh size={13} /> تحديث حالة الاشتراك
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input className="field flex-1" placeholder="مفتاح يدوي: XXXX-XXXX-XXXX-XXXX"
                        style={{ fontFamily: 'monospace' }}
                        value={activationKey}
                        onChange={e => setActivationKey(e.target.value)} />
                      <button onClick={handleActivate} disabled={activating} className="btn-ghost btn-sm">
                        {activating ? 'جاري التفعيل...' : <><Icons.Check size={14} /> تفعيل يدوي</>}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ بيانات المنشأة والشعار ═══ */}
          {tab === 'business' && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Icons.Records size={15} className="text-brand-400" />
                  <span className="font-bold text-white text-sm">بيانات المنشأة</span>
                </div>
                <button onClick={handleSaveBiz} disabled={savingBiz} className="btn-primary btn-sm">
                  <Icons.Save size={14} /> {savingBiz ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {([
                  ['name',          'اسم المنشأة'],
                  ['phone',         'الهاتف'],
                  ['address',       'العنوان'],
                  ['taxNumber',     'الرقم الضريبي'],
                  ['commercialReg', 'السجل التجاري'],
                  ['currency',      'العملة'],
                ] as [keyof typeof biz, string][]).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>{label}</label>
                    <input className="field" value={biz[key]}
                      onChange={e => setBiz(b => ({ ...b, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-surface-600">
                <label className="block text-xs mb-2" style={{ color: 'var(--txt-2)' }}>شعار المنشأة (يظهر في رأس التقارير وأعلى هذا القسم)</label>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg flex items-center justify-center shrink-0"
                    style={{ width: 72, height: 72, background: 'var(--inner-bg)', border: '1px dashed var(--inner-border)', overflow: 'hidden' }}>
                    {biz.logo
                      ? <img src={biz.logo} alt="شعار" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <Icons.Records size={26} className="text-surface-500" />}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="btn-ghost btn-sm cursor-pointer">
                      <Icons.Upload size={13} /> اختيار شعار
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    </label>
                    {biz.logo && (
                      <button onClick={() => setBiz(b => ({ ...b, logo: '' }))} className="btn-ghost btn-sm" style={{ color: '#f85149' }}>
                        <Icons.Trash size={13} /> إزالة
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-2xs mt-2" style={{ color: 'var(--txt-3)' }}>PNG/JPG · أقل من 1 ميجابايت · لا تنسَ الضغط على "حفظ"</div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
