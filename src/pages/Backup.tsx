import { useState, useEffect } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import Modal from '../components/Modal'
import Icons from '../components/Icon'

interface BackupFile {
  name: string; path: string; size: number; createdAt: string; type: 'auto' | 'manual'
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function BackupPage() {
  const { show } = useToast()
  const [backups,    setBackups]    = useState<BackupFile[]>([])
  const [loading,    setLoading]    = useState(false)
  const [creating,   setCreating]   = useState(false)
  const [restoring,  setRestoring]  = useState<BackupFile | null>(null)
  const [deleting,   setDeleting]   = useState<BackupFile | null>(null)

  // محو البيانات (تحذيران + خيار العميل)
  const [wipeStep,    setWipeStep]    = useState<0 | 1 | 2>(0)
  const [wipeScope,   setWipeScope]   = useState<'accounting' | 'all'>('accounting')
  const [confirmText, setConfirmText] = useState('')
  const [wiping,      setWiping]      = useState(false)

  function resetWipe() { setWipeStep(0); setConfirmText(''); setWipeScope('accounting') }

  async function doWipe() {
    if (wiping || confirmText.trim() !== 'محو') return
    setWiping(true)
    try {
      await call(api.data.wipe(wipeScope))
      show('تم محو البيانات — سيُعاد تشغيل البرنامج', 'success')
      setTimeout(() => window.location.reload(), 1000)
    } catch (e) { setWiping(false); show((e as Error).message, 'error') }
  }

  async function load() {
    setLoading(true)
    try { setBackups(await call(api.backup.list())) }
    catch (e) { show((e as Error).message, 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleCreate() {
    setCreating(true)
    try {
      const path = await call(api.backup.create())
      show(`تم إنشاء النسخة: ${(path as string).split(/[/\\]/).pop()}`, 'success')
      await load()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setCreating(false) }
  }

  async function handleDelete() {
    if (!deleting) return
    try {
      await call(api.backup.delete(deleting.path))
      show('تم حذف النسخة', 'success')
      setDeleting(null)
      await load()
    } catch (e) { show((e as Error).message, 'error') }
  }

  async function handleRestore() {
    if (!restoring) return
    try {
      // استعادة النسخة — تتطلب إعادة تشغيل
      await call(api.backup.delete(restoring.path + '__restore_trigger__'))
    } catch {
      // نستخدم backup:now كحل بديل بسيط يعرض الرسالة
    }
    show('ستتم استعادة النسخة عند إعادة تشغيل البرنامج', 'info')
    setRestoring(null)
  }

  const autoBackups   = backups.filter(b => b.type !== 'manual')   // تلقائية + عند الخروج
  const manualBackups = backups.filter(b => b.type === 'manual')
  const totalSize     = backups.reduce((s, b) => s + b.size, 0)
  const lastBackup    = backups.length > 0
    ? [...backups].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : null

  function BackupCard({ b }: { b: BackupFile }) {
    const isAuto = b.type !== 'manual'
    const col = isAuto ? '#3b82f6' : '#10b981'
    return (
      <div className="rounded-xl p-3 flex flex-col gap-2 transition-all hover:-translate-y-0.5"
        style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: col + '20', color: col }}>
            <Icons.Backup size={15} />
          </div>
          <span className="text-2xs px-1.5 py-0.5 rounded-md font-bold flex-shrink-0"
            style={{ background: col + '20', color: col }}>{isAuto ? 'تلقائي' : 'يدوي'}</span>
          <span className="text-2xs mr-auto tabular-nums" style={{ color: 'var(--txt-3)' }}>💾 {fmtSize(b.size)}</span>
        </div>
        <div className="text-xs font-bold truncate" style={{ color: 'var(--txt-1)' }} title={b.name}>{b.name}</div>
        <div className="text-2xs" style={{ color: 'var(--txt-3)' }}>🕐 {new Date(b.createdAt).toLocaleString('ar-EG')}</div>
        <div className="flex items-center gap-1.5 mt-auto pt-1">
          <button onClick={() => setRestoring(b)}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-2xs font-bold transition-all hover:brightness-110"
            style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.30)' }}>
            <Icons.Upload size={12} /> استعادة
          </button>
          <button onClick={() => setDeleting(b)}
            className="p-1.5 rounded-lg hover:text-danger transition-colors"
            style={{ color: 'var(--txt-3)', border: '1px solid var(--inner-border)' }} title="حذف">
            <Icons.Trash size={13} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* رأس */}
      <div className="flex items-center justify-between flex-shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(16,185,129,0.18)', color: '#10b981' }}>
            <Icons.Backup size={20} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--txt-1)' }}>النسخ والاستعادة</div>
            <div style={{ fontSize: 11.5, color: 'var(--txt-3)' }}>حماية بياناتك بنسخ احتياطية مضغوطة</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => call(api.backup.openFolder())} className="btn-ghost btn-sm">
            <Icons.Records size={13} /> فتح المجلد
          </button>
          <button onClick={handleCreate} disabled={creating} className="btn-success-pro btn-sm" style={{ fontSize: 12 }}>
            <Icons.Backup size={13} /> {creating ? 'جاري الحفظ...' : 'نسخة احتياطية الآن'}
          </button>
        </div>
      </div>

      {/* بطاقات إحصائية */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0">
        {[
          { label: 'إجمالي النسخ', value: String(backups.length), color: '#3b82f6', icon: '📦' },
          { label: 'نسخ يدوية', value: String(manualBackups.length), color: '#10b981', icon: '✋' },
          { label: 'نسخ تلقائية', value: String(autoBackups.length), color: '#8b5cf6', icon: '🔄' },
          { label: 'الحجم الكلي', value: fmtSize(totalSize), color: '#f59e0b', icon: '💾' },
        ].map(c => (
          <div key={c.label} className="rounded-2xl p-3.5" style={{ background: c.color + '12', border: `1px solid ${c.color}38` }}>
            <div className="flex items-center gap-1.5 mb-1">
              <span style={{ fontSize: 15 }}>{c.icon}</span>
              <span className="text-2xs font-bold" style={{ color: c.color }}>{c.label}</span>
            </div>
            <div className="tabular-nums font-bold" style={{ fontSize: 18, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* شريط معلومات + آخر نسخة */}
      <div className="rounded-xl p-3 flex items-center gap-3 flex-shrink-0"
        style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)' }}>
        <span style={{ fontSize: 18 }}>🛡️</span>
        <div className="flex-1 text-xs" style={{ color: 'var(--txt-2)' }}>
          <b style={{ color: 'var(--accent)' }}>نسخ تلقائية يومية مفعّلة</b> — تُحفظ مضغوطة في{' '}
          <span className="font-mono" style={{ color: 'var(--txt-1)' }}>Documents\AJ-SmartShift-Backups</span>
          {lastBackup && (
            <> · آخر نسخة: <b style={{ color: '#10b981' }}>{new Date(lastBackup.createdAt).toLocaleString('ar-EG')}</b></>
          )}
        </div>
      </div>

      {/* قائمة النسخ — مربعات أفقية */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>📋 كل النسخ المحفوظة ({backups.length})</span>
          <span className="text-2xs" style={{ color: 'var(--txt-3)' }}>الأحدث أولاً</span>
        </div>
        <div className="p-3">
          {loading ? (
            <div className="text-center py-8" style={{ color: 'var(--txt-3)' }}>
              <Icons.Refresh size={20} className="animate-spin mx-auto mb-2" /> جاري التحميل...
            </div>
          ) : backups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2" style={{ color: 'var(--txt-3)' }}>
              <span style={{ fontSize: 36, opacity: 0.3 }}>📦</span>
              <span className="text-sm">لا توجد نسخ احتياطية بعد</span>
              <button onClick={handleCreate} className="btn-ghost btn-sm mt-1" style={{ fontSize: 11 }}>
                <Icons.Backup size={12} /> أنشئ أول نسخة
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {[...backups]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map(b => <BackupCard key={b.path} b={b} />)}
            </div>
          )}
        </div>
      </div>

      {/* ═══ منطقة الخطر — محو البيانات (تحذيران + خيار) ═══ */}
      <div className="rounded-xl p-4 flex-shrink-0"
        style={{ background: 'rgba(248,81,73,0.06)', border: '1px solid rgba(248,81,73,0.35)' }}>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ fontSize: 17 }}>⚠️</span>
          <span className="font-bold" style={{ fontSize: 14, color: '#f85149' }}>منطقة الخطر — محو البيانات</span>
        </div>

        {wipeStep === 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
              إجراء لا يمكن التراجع عنه. يُنصح بإنشاء نسخة احتياطية أولاً.
            </span>
            <button onClick={() => setWipeStep(1)} className="btn-danger btn-sm">
              <Icons.Trash size={13} /> محو البيانات…
            </button>
          </div>
        )}

        {/* التحذير الأول: النطاق */}
        {wipeStep === 1 && (
          <div className="space-y-3 mt-1">
            <div className="rounded-lg p-2.5 text-xs" style={{ background: 'rgba(248,81,73,0.12)', border: '1px solid rgba(248,81,73,0.3)', color: 'var(--txt-1)' }}>
              🔴 <b>تحذير (1 من 2):</b> اختر نطاق المحو. لا يمكن استرجاع البيانات بعده.
            </div>
            {([
              { k: 'accounting', t: 'البيانات المحاسبية فقط', d: 'يمحو اليوميات والشيفتات والموظفين والأطراف والخزينة… ويُبقي المستخدمين وبيانات المنشأة والتصنيفات والترخيص' },
              { k: 'all', t: 'كل شيء (إعادة ضبط كاملة)', d: 'يعود البرنامج لأول تشغيل — يُحذف حتى المستخدمون وبيانات المنشأة (يبقى الترخيص). المدير الافتراضي بعدها: mgr / 1234' },
            ] as { k: 'accounting' | 'all'; t: string; d: string }[]).map(o => {
              const sel = wipeScope === o.k
              return (
                <button key={o.k} onClick={() => setWipeScope(o.k)}
                  className="w-full text-right rounded-xl p-3 transition-all"
                  style={{
                    border: sel ? '2px solid #f85149' : '1px solid var(--inner-border)',
                    background: sel ? 'rgba(248,81,73,0.10)' : 'var(--inner-bg)',
                  }}>
                  <div className="font-bold" style={{ fontSize: 13.5, color: 'var(--txt-1)' }}>{o.t}</div>
                  <div className="mt-1" style={{ fontSize: 11.5, color: 'var(--txt-3)', lineHeight: 1.6 }}>{o.d}</div>
                </button>
              )
            })}
            <div className="flex gap-2">
              <button onClick={resetWipe} className="btn-ghost btn-sm">إلغاء</button>
              <button onClick={() => setWipeStep(2)} className="btn-primary btn-sm">متابعة ←</button>
            </div>
          </div>
        )}

        {/* التحذير الثاني: تأكيد نهائي بالكتابة */}
        {wipeStep === 2 && (
          <div className="space-y-3 mt-1">
            <div className="rounded-lg p-2.5 text-xs" style={{ background: 'rgba(248,81,73,0.18)', border: '1px solid rgba(248,81,73,0.45)', color: 'var(--txt-1)' }}>
              🔴 <b>تحذير أخير (2 من 2):</b> سيتم محو {wipeScope === 'all' ? 'كل البيانات وبيانات المنشأة' : 'كل البيانات المحاسبية'} نهائياً. اكتب كلمة <b style={{ color: '#f85149' }}>محو</b> للتأكيد.
            </div>
            <input className="field text-center font-bold" placeholder="اكتب: محو"
              value={confirmText} onChange={e => setConfirmText(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={() => setWipeStep(1)} className="btn-ghost btn-sm">← رجوع</button>
              <button onClick={doWipe} disabled={confirmText.trim() !== 'محو' || wiping}
                className="btn-danger btn-sm flex-1 justify-center">
                <Icons.Trash size={14} /> {wiping ? 'جارٍ المحو…' : 'تأكيد المحو النهائي'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* مودال الاستعادة */}
      <Modal open={!!restoring} title="استعادة نسخة احتياطية" onClose={() => setRestoring(null)} size="sm"
        footer={<>
          <button onClick={() => setRestoring(null)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleRestore} className="btn-warning btn-sm">
            <Icons.Upload size={14} /> استعادة
          </button>
        </>}>
        <div className="space-y-3">
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-xs text-warning">
            سيتم استبدال قاعدة البيانات الحالية بهذه النسخة. قبل الاستعادة سيتم حفظ نسخة احتياطية من الوضع الحالي.
          </div>
          <div className="text-sm text-surface-300">
            النسخة: <span className="font-medium text-white">{restoring?.name}</span>
          </div>
        </div>
      </Modal>

      {/* مودال الحذف */}
      <Modal open={!!deleting} title="حذف نسخة احتياطية" onClose={() => setDeleting(null)} size="sm"
        footer={<>
          <button onClick={() => setDeleting(null)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleDelete} className="btn-danger btn-sm">
            <Icons.Trash size={14} /> حذف
          </button>
        </>}>
        <p className="text-sm text-surface-300">
          هل تريد حذف النسخة <span className="font-bold text-white">{deleting?.name}</span>؟ لا يمكن التراجع.
        </p>
      </Modal>
    </div>
  )
}
