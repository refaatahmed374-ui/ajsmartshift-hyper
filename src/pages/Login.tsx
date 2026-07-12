import { useState, useEffect, FormEvent } from 'react'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import { useLicense } from '../store/license'
import { useTheme } from '../store/theme'
import { useLang, loginText } from '../store/lang'
import { api, call } from '../lib/api'
import Icons from '../components/Icon'
import type { User } from '../../core/types'

const GOLD = '#e3b341'
const NAVY = '#1e1b4b'

const SunIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)
const MoonIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)

export default function Login() {
  const { login } = useAuth()
  const { show }  = useToast()
  const { status, load } = useLicense()
  const { theme, toggle: toggleTheme } = useTheme()
  const { lang, toggle: toggleLang } = useLang()

  const t   = loginText[lang]
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [focusedField, setFocusedField] = useState<'user' | 'pass' | null>(null)

  useEffect(() => { load() }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username || !password) { show(t.warnFields, 'warning'); return }
    setLoading(true)
    try {
      const user = await call<User | null>(api.users.verify(username, password))
      if (!user) { show(t.errLogin, 'error'); return }
      login(user)
    } catch (e) { show((e as Error).message, 'error') }
    finally { setLoading(false) }
  }

  return (
    <div dir={dir} className="h-screen w-screen flex overflow-hidden relative"
      style={{ fontFamily: lang === 'en' ? "'IBM Plex Sans', sans-serif" : undefined }}>

      {/* ===== شريط علوي: أزرار النافذة + التبديل ===== */}
      <div className="absolute top-0 inset-x-0 h-10 flex items-center justify-between px-3 z-50 titlebar-drag">
        <div className="flex items-center gap-1 titlebar-no-drag">
          <button onClick={() => window.api.window.close()}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/70 hover:bg-danger hover:text-white transition-colors">
            <Icons.Close size={13} />
          </button>
          <button onClick={() => window.api.window.maximize()}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/70 hover:bg-white/15 hover:text-white transition-colors">
            <Icons.Maximize size={12} />
          </button>
          <button onClick={() => window.api.window.minimize()}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/70 hover:bg-white/15 hover:text-white transition-colors">
            <Icons.Minimize size={13} />
          </button>
        </div>
        <div className="flex items-center gap-2 titlebar-no-drag">
          <button onClick={toggleTheme} title={theme === 'dark' ? 'Light' : 'Dark'}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: 'rgba(0,0,0,0.06)', color: '#475569' }}>
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button onClick={toggleLang}
            className="h-8 px-3 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: 'rgba(0,0,0,0.06)', color: '#475569', fontSize: '13px', fontWeight: 700 }}>
            {lang === 'ar' ? 'EN' : 'ع'}
          </button>
        </div>
      </div>

      {/* ===== اللوحة اليمنى (كحلية) — المعلومات — أولاً في الـ DOM لتظهر على اليمين في RTL ===== */}
      <div className="hidden lg:flex lg:w-[420px] flex-col p-9 relative overflow-hidden"
        style={{ background: `linear-gradient(150deg, #1e1b4b 0%, #312e81 55%, #1e1b4b 100%)` }}>

        {/* دوائر ديكورية */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.06), transparent 70%)' }} />
          <div className="absolute top-1/3 -right-20 w-64 h-64 rounded-full border"
            style={{ borderColor: 'rgba(255,255,255,0.04)' }} />
          <div className="absolute -bottom-32 left-1/4 w-80 h-80 rounded-full"
            style={{ background: `radial-gradient(circle, ${GOLD}0f, transparent 70%)` }} />
        </div>

        <div className="relative z-10 flex flex-col h-full pt-6">
          {/* الشعار */}
          <div className="flex items-center gap-3 mb-6">
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 rounded-2xl blur-lg opacity-60" style={{ background: GOLD }} />
              <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ fontSize: '18px', fontWeight: 700, color: '#fff', background: `linear-gradient(135deg, ${GOLD}, #bd8a10)` }}>AJ</div>
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, lineHeight: '24px' }}>
                <span style={{ color: '#fff' }}>AJ </span>
                <span style={{ color: GOLD }}>Smart</span>
                <span style={{ color: '#fff' }}> Shift</span>
              </div>
              <div style={{ fontSize: '12px', fontWeight: 500, marginTop: '2px', color: '#c7d2fe' }}>{t.tagline}</div>
            </div>
          </div>
          <div className="mb-6" style={{ fontSize: '13px', fontWeight: 500, color: '#a5b4fc' }}>{t.tagline2}</div>

          {/* معلومات النظام */}
          <div className="rounded-2xl p-4 mb-3" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="mb-3" style={{ fontSize: '12px', fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.03em' }}>{t.systemInfo}</div>
            {[
              [t.version,  'v2.26.3',     GOLD],
              [t.database, 'SQLite 3.45', '#7dd3fc'],
              [t.env,      'Electron 29', '#ffffff'],
            ].map(([k, v, c], i) => (
              <div key={i} className="flex items-center justify-between py-1.5">
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#cbd5e1' }}>{k}</span>
                <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: "'IBM Plex Sans', monospace", color: c as string }}>{v}</span>
              </div>
            ))}
          </div>

          {/* بيانات الاشتراك */}
          <div className="rounded-2xl p-4 mb-4" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="mb-3" style={{ fontSize: '12px', fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.03em' }}>{t.subInfo}</div>
            {[
              [t.client,    t.devName,                  '#34d399'],
              [t.subStart,  status?.trialStart ?? '—',  '#ffffff'],
              [t.subEnd,    status?.trialEnd ?? '—',     '#ffffff'],
              [t.deviceCode, status?.deviceCode ?? '—', GOLD],
            ].map(([k, v, c], i) => (
              <div key={i} className="flex items-center justify-between py-1.5">
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#cbd5e1' }}>{k}</span>
                <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: i > 0 ? "'IBM Plex Sans', monospace" : undefined, color: c as string }}>{v}</span>
              </div>
            ))}
          </div>

          {/* حالة الترخيص */}
          {status?.state === 'active' && (
            <div className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(52,211,153,0.2)', color: '#34d399' }}>
                <Icons.Check size={16} />
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#34d399' }}>{t.activeFullTitle}</div>
                <div style={{ fontSize: '12px', fontWeight: 500, color: '#cbd5e1' }}>{t.activeFullDesc}</div>
              </div>
            </div>
          )}

          {status?.state === 'trial' && (
            <div className="rounded-2xl p-4" style={{ background: `${GOLD}14`, border: `1px solid ${GOLD}33` }}>
              <div className="flex items-center justify-between mb-2.5">
                <span style={{ fontSize: '14px', fontWeight: 700, color: GOLD }}>⏳ {t.trialLabel}</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                  {t.dayOf(status.daysUsed, status.trialDays)}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${(status.daysUsed / status.trialDays) * 100}%`, background: GOLD }} />
              </div>
              <div className="mt-2" style={{ fontSize: '12px', fontWeight: 500, color: '#cbd5e1' }}>{t.endsOn} {status.trialEnd}</div>
            </div>
          )}

          {status?.state === 'expired' && (
            <div className="rounded-2xl p-4" style={{ background: 'rgba(248,81,73,0.12)', border: '1px solid rgba(248,81,73,0.3)' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#f85149' }}>{t.expiredTitle}</div>
              <div className="mt-1" style={{ fontSize: '12px', fontWeight: 500, color: '#cbd5e1' }}>{t.expiredDesc}</div>
            </div>
          )}

          {/* نظام نقاط البيع — قريباً */}
          <div className="rounded-2xl p-4 mt-3 flex items-center gap-3" style={{ background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.25)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(96,165,250,0.18)', color: '#60a5fa' }}>
              <Icons.Retail size={17} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#93c5fd' }}>نظام نقاط البيع — قريبًا</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="relative flex w-1.5 h-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ background: '#60a5fa' }} />
                  <span className="relative inline-flex rounded-full w-1.5 h-1.5" style={{ background: '#60a5fa' }} />
                </span>
                <span style={{ fontSize: '12px', fontWeight: 500, color: '#cbd5e1' }}>جاري التطوير</span>
              </div>
            </div>
          </div>

          <div className="flex-1" />

          {/* التذييل */}
          <div className="text-center pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#cbd5e1' }}>
              {t.credit} <span className="font-bold" style={{ color: GOLD }}>{t.devName}</span>
            </div>
            <div className="mt-0.5" style={{ fontSize: '11px', fontWeight: 400, color: '#94a3b8' }}>© 2026 · All rights reserved</div>
          </div>
        </div>
      </div>

      {/* ===== اللوحة اليسرى (فاتحة) — الفورم — ثانياً في الـ DOM لتظهر على اليسار في RTL ===== */}
      <div className="flex-1 flex items-center justify-center p-8"
        style={{ background: '#ffffff' }}>
        <div className="w-full max-w-md fade-in">
          {/* العنوان */}
          <h1 style={{ fontSize: '28px', fontWeight: 700, lineHeight: '36px', color: '#1e1b4b' }}>
            {t.title}
          </h1>
          <p className="mt-1.5" style={{ fontSize: '15px', fontWeight: 400, color: '#64748b' }}>
            {t.subtitle}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4 mt-8 slide-up">
            <div>
              <label className="block mb-2" style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
                {t.username}
              </label>
              <div className="relative">
                <span className="absolute top-1/2 -translate-y-1/2 transition-colors pointer-events-none"
                  style={{ [dir === 'rtl' ? 'right' : 'left']: '14px', color: focusedField === 'user' ? NAVY : '#94a3b8' }}>
                  <Icons.User size={16} />
                </span>
                <input
                  className="w-full py-3 rounded-xl outline-none transition-all duration-200"
                  style={{
                    fontSize: '15px', fontWeight: 500, color: '#1e1b4b',
                    paddingRight: dir === 'rtl' ? '42px' : '16px',
                    paddingLeft: dir === 'rtl' ? '16px' : '42px',
                    background: focusedField === 'user' ? '#fff' : '#f8fafc',
                    border: `1.5px solid ${focusedField === 'user' ? NAVY : '#e2e8f0'}`,
                    boxShadow: focusedField === 'user' ? `0 0 0 4px ${NAVY}14` : 'none',
                  }}
                  placeholder={t.userPlaceholder}
                  value={username} onChange={e => setUsername(e.target.value)}
                  onFocus={() => setFocusedField('user')} onBlur={() => setFocusedField(null)}
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="block mb-2" style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
                {t.password}
              </label>
              <div className="relative">
                <span className="absolute top-1/2 -translate-y-1/2 transition-colors pointer-events-none"
                  style={{ [dir === 'rtl' ? 'right' : 'left']: '14px', color: focusedField === 'pass' ? NAVY : '#94a3b8' }}>
                  <Icons.Lock size={16} />
                </span>
                <input
                  className="w-full py-3 rounded-xl outline-none transition-all duration-200"
                  style={{
                    fontSize: '15px', fontWeight: 500, color: '#1e1b4b',
                    paddingRight: dir === 'rtl' ? '42px' : '42px',
                    paddingLeft: dir === 'rtl' ? '42px' : '42px',
                    background: focusedField === 'pass' ? '#fff' : '#f8fafc',
                    border: `1.5px solid ${focusedField === 'pass' ? NAVY : '#e2e8f0'}`,
                    boxShadow: focusedField === 'pass' ? `0 0 0 4px ${NAVY}14` : 'none',
                  }}
                  type={showPass ? 'text' : 'password'} placeholder="••••••"
                  value={password} onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('pass')} onBlur={() => setFocusedField(null)}
                  autoComplete="current-password"
                />
                <button type="button"
                  className="absolute top-1/2 -translate-y-1/2 transition-colors hover:opacity-70"
                  style={{ [dir === 'rtl' ? 'left' : 'right']: '14px', color: '#94a3b8' }}
                  onClick={() => setShowPass(v => !v)}>
                  <Icons.Eye size={16} />
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-xl transition-all duration-200 mt-2 hover:brightness-125 hover:-translate-y-0.5 active:translate-y-0
                disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0"
              style={{
                fontSize: '16px', fontWeight: 600, color: '#fff',
                background: NAVY,
                boxShadow: `0 6px 20px ${NAVY}44`,
              }}>
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 rounded-full animate-spin"
                    style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} />
                  <span>{t.verifying}</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <span>{t.login}</span>
                  <Icons.ArrowRight size={16} className={dir === 'rtl' ? 'rotate-180' : ''} />
                </div>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
