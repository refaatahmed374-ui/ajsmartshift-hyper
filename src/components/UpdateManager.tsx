/**
 * UpdateManager — تجربة تحديث تلقائية كاملة من داخل البرنامج
 * إشعار تلقائي ← "تحديث الآن" ← تجميد + تقدّم ← إغلاق وإعادة فتح ← "ما الجديد"
 */
import { useEffect, useState } from 'react'
import { api, call } from '../lib/api'

// أبرز ما في الإصدار الحالي — يظهر بعد اكتمال التحديث
const WHATS_NEW = [
  '🧩 شريط مهام احترافي بالأسفل (اختصارات + إجراءات + مؤشرات حية)',
  '🪟 تكامل مع شريط مهام ويندوز (شريط تقدّم + وميض الأيقونة)',
  '🔄 تحديث تلقائي كامل من داخل البرنامج (بلا تحميل يدوي)',
  '💰 تقارير تقفيل شهري وسنوي + حساب إدارة دقيق',
  '🔐 نظام اشتراكات أونلاين + خطط جديدة + تجربة 35 يوماً',
]

type Phase = 'idle' | 'available' | 'downloading' | 'installing' | 'error' | 'whatsnew'

export default function UpdateManager() {
  const [phase, setPhase]     = useState<Phase>('idle')
  const [version, setVersion] = useState('')
  const [curVer, setCurVer]   = useState('')
  const [percent, setPercent] = useState(0)
  const [errMsg, setErrMsg]   = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const cur = await call(api.update.current()) as { version: string }
        setCurVer(cur.version)
        const seen = localStorage.getItem('aj_seen_version')
        if (seen && seen !== cur.version) setPhase('whatsnew')
        localStorage.setItem('aj_seen_version', cur.version)
      } catch (err) {
        console.error('Failed to get current version:', err)
      }
    })()

    const offs = [
      window.api.update.on('available',  (d: any) => setPhase(p => (p === 'downloading' || p === 'installing') ? p : (setVersion(d?.version || ''), 'available'))),
      window.api.update.on('progress',   (d: any) => { setPercent(Math.round(d?.percent || 0)); setPhase('downloading') }),
      window.api.update.on('downloaded', (d: any) => { if (d?.version) setVersion(d.version); setPhase('installing'); setTimeout(() => { try { window.api.update.install() } catch { /* */ } }, 1800) }),
      window.api.update.on('error',      (d: any) => { setErrMsg(d?.message || 'خطأ غير معروف'); setPhase('error') }),
    ]
    return () => offs.forEach(o => o && o())
  }, [])

  // معاينة في وضع التطوير فقط: Ctrl+Shift+U لإظهار تدفّق التحديث
  const DEV = !!(import.meta as any).env?.DEV
  useEffect(() => {
    if (!DEV) return
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'U' || e.key === 'u')) { setVersion('2.30.0'); setPhase('available') }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [DEV])

  async function startUpdate() {
    setPhase('downloading'); setPercent(0)
    if (DEV) {
      // محاكاة التدفّق للمعاينة (بدون تحديث حقيقي)
      let p = 0
      const t = setInterval(() => {
        p = Math.min(p + 8, 100); setPercent(p)
        if (p >= 100) { clearInterval(t); setPhase('installing'); setTimeout(() => setPhase('whatsnew'), 2200) }
      }, 180)
      return
    }
    try { await call(api.update.download()) }
    catch (e) { setErrMsg((e as Error).message); setPhase('error') }
  }

  if (phase === 'idle') return null

  const overlayBg = { position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'linear-gradient(135deg,rgba(11,18,32,.97),rgba(30,41,59,.97))', backdropFilter: 'blur(3px)' } as const
  const cardStyle = { width: '100%', maxWidth: 460, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: 28, textAlign: 'center', boxShadow: '0 24px 70px rgba(0,0,0,.55)' } as const
  const logo = (
    <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 900, color: '#fff', background: 'linear-gradient(135deg,#3b82f6,#1e3a8a)' }}>AJ</div>
  )

  if (phase === 'available') return (
    <div style={overlayBg}>
      <div style={cardStyle}>
        {logo}
        <div style={{ fontSize: 19, fontWeight: 800, color: '#fff', marginBottom: 6 }}>🔄 تحديث جديد متاح</div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>الإصدار {version ? 'v' + version : 'الجديد'} جاهز للتثبيت تلقائياً من داخل البرنامج</div>
        <button onClick={startUpdate} style={{ width: '100%', padding: '13px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg,#3b82f6,#1e3a8a)' }}>⬇ تحديث الآن</button>
        <button onClick={() => setPhase('idle')} style={{ marginTop: 10, padding: '9px', width: '100%', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#cbd5e1', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.15)' }}>لاحقاً</button>
      </div>
    </div>
  )

  if (phase === 'downloading' || phase === 'installing') return (
    <div style={overlayBg}>
      <div style={cardStyle}>
        {logo}
        <div style={{ fontSize: 19, fontWeight: 800, color: '#fff', marginBottom: 6 }}>
          {phase === 'downloading' ? '⏳ جاري تثبيت التحديث الجديد...' : '✓ اكتمل — جاري إعادة تشغيل البرنامج'}
        </div>
        <div style={{ fontSize: 13, color: '#fca5a5', marginBottom: 18 }}>الرجاء عدم إغلاق البرنامج حتى انتهاء التحديث</div>
        {phase === 'downloading' && (
          <>
            <div style={{ height: 10, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,.1)' }}>
              <div style={{ height: '100%', width: percent + '%', borderRadius: 999, background: 'linear-gradient(90deg,#3b82f6,#10b981)', transition: 'width .3s' }} />
            </div>
            <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 10, fontWeight: 700 }}>{percent}%</div>
          </>
        )}
        {phase === 'installing' && (
          <div style={{ fontSize: 13, color: '#6ee7b7', marginTop: 8 }}>سيُغلق البرنامج ويُعاد فتحه تلقائياً خلال لحظات...</div>
        )}
      </div>
    </div>
  )

  if (phase === 'error') return (
    <div style={overlayBg}>
      <div style={cardStyle}>
        {logo}
        <div style={{ fontSize: 18, fontWeight: 800, color: '#f85149', marginBottom: 8 }}>⛔ تعذّر التحديث</div>
        <div style={{ fontSize: 12.5, color: '#fca5a5', marginBottom: 18 }}>{errMsg}</div>
        <button onClick={startUpdate} style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg,#3b82f6,#1e3a8a)' }}>🔄 إعادة المحاولة</button>
        <button onClick={() => setPhase('idle')} style={{ marginTop: 10, padding: '9px', width: '100%', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#cbd5e1', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.15)' }}>إغلاق</button>
      </div>
    </div>
  )

  if (phase === 'whatsnew') return (
    <div style={overlayBg}>
      <div style={{ ...cardStyle, textAlign: 'right', maxWidth: 500 }}>
        <div style={{ textAlign: 'center' }}>{logo}</div>
        <div style={{ fontSize: 19, fontWeight: 800, color: '#fff', textAlign: 'center', marginBottom: 4 }}>🎉 تم تحديث البرنامج بنجاح</div>
        <div style={{ fontSize: 13, color: '#60a5fa', textAlign: 'center', marginBottom: 18, fontWeight: 700 }}>الإصدار {curVer ? 'v' + curVer : 'الأحدث'} — ما الجديد:</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {WHATS_NEW.map((t, i) => (
            <li key={i} style={{ fontSize: 13.5, color: '#e2e8f0', padding: '8px 0', borderBottom: i < WHATS_NEW.length - 1 ? '1px solid rgba(255,255,255,.07)' : 'none', lineHeight: 1.7 }}>{t}</li>
          ))}
        </ul>
        <button onClick={() => setPhase('idle')} style={{ marginTop: 20, width: '100%', padding: '12px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg,#10b981,#059669)' }}>👍 رائع، لنبدأ</button>
      </div>
    </div>
  )

  return null
}
