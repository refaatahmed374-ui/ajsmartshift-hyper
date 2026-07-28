import { useState } from 'react'
import { useLicense } from '../store/license'
import { useToast } from '../store/toast'
import Icons from './Icon'

// شاشة التجميد الكامل — تظهر عند انتهاء التجربة/الاشتراك.
// لا يوجد تفعيل بمفتاح محلي بعد الآن — الترخيص قرار خادمي حصري (Server Authoritative)؛
// الوسيلة الوحيدة هنا هي إرسال طلب تفعيل/تجديد يراجعه المطوّر عبر لوحة التحكم.
export default function LicenseGate() {
  const { status, requestActivation, refresh } = useLicense()
  const { show } = useToast()
  const [requesting, setRequesting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  if (!status) return null

  const reasonText: Record<string, string> = {
    trialEnded:  'انتهت الفترة التجريبية المجانية.',
    expired:     'انتهى اشتراكك. جدّد للاستمرار.',
    deactivated: 'تم إيقاف هذا الاشتراك. تواصل مع المطوّر.',
    needsOnline: 'مرّ أكثر من 7 أيام دون اتصال — اتصل بالإنترنت لتأكيد الاشتراك.',
  }
  const msg = reasonText[status.reason] ?? 'النسخة غير مفعّلة.'

  function copyDeviceId() {
    if (status?.deviceId) { navigator.clipboard.writeText(status.deviceId); show('تم نسخ رقم الجهاز الكامل', 'success') }
  }
  async function handleRequest() {
    setRequesting(true)
    try {
      const res = await requestActivation({ plan: status?.tier })
      show(res.ok ? (res.reason ?? 'تم إرسال طلب التفعيل ✓ — سيُفعّل بعد المراجعة') : (res.reason ?? 'تعذّر الإرسال'), res.ok ? 'success' : 'error')
    } catch (e) { show((e as Error).message, 'error') }
    finally { setRequesting(false) }
  }
  async function handleRefresh() {
    setRefreshing(true)
    try { await refresh(); show('تم تحديث حالة الاشتراك', 'info') }
    catch { show('تعذّر التحديث — تحقق من الإنترنت', 'error') }
    finally { setRefreshing(false) }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-auto"
      style={{ background: 'linear-gradient(135deg,#0b1220,#1e293b)' }}>
      <div className="w-full max-w-lg rounded-2xl p-6 md:p-8"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

        {/* الرأس */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black text-white"
            style={{ background: 'linear-gradient(135deg,#3b82f6,#1e3a8a)' }}>AJ</div>
          <div>
            <div className="text-white font-extrabold text-lg">AJ Smart Shift</div>
            <div className="text-xs" style={{ color: '#94a3b8' }}>نظام إدارة الشيفتات — أحمد جلال</div>
          </div>
        </div>

        {/* سبب التجميد */}
        <div className="rounded-xl p-4 mb-5 flex items-start gap-3"
          style={{ background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.35)' }}>
          <Icons.Lock size={20} className="shrink-0 mt-0.5" style={{ color: '#f85149' }} />
          <div>
            <div className="font-bold text-sm mb-1" style={{ color: '#f85149' }}>البرنامج مُجمّد — يلزم التفعيل</div>
            <div className="text-xs" style={{ color: '#fca5a5' }}>{msg}</div>
          </div>
        </div>

        {/* رقم الجهاز */}
        <div className="rounded-xl p-4 mb-4 text-center" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)' }}>
          <div className="text-2xs mb-1" style={{ color: '#94a3b8' }}>رقم جهازك</div>
          <div className="font-black text-xl tracking-wider" style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{status.deviceCode}</div>
        </div>

        {/* طريقة التفعيل */}
        <div className="text-xs leading-relaxed mb-4" style={{ color: '#cbd5e1' }}>
          <span className="font-bold text-white">طريقة التفعيل:</span> اضغط <span className="font-bold">"إرسال طلب تفعيل"</span> ليصل المطوّر
          <span className="font-bold text-white mx-1">أحمد جلال</span> فوراً، وسيُفعَّل اشتراكك تلقائياً بعد المراجعة — اضغط "تحديث الحالة" لاحقاً لتأكيد التفعيل.
        </div>

        {/* الأزرار */}
        <div className="grid grid-cols-1 gap-2 mb-4">
          <button onClick={handleRequest} disabled={requesting}
            className="w-full py-3 rounded-xl font-extrabold text-white text-sm flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg,#3b82f6,#1e3a8a)' }}>
            <Icons.Upload size={15} /> {requesting ? 'جاري الإرسال...' : 'إرسال طلب تفعيل / تجديد'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={copyDeviceId}
              className="py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', color: '#e2e8f0' }}>
              <Icons.Download size={13} /> نسخ رقم الجهاز
            </button>
            <button onClick={handleRefresh} disabled={refreshing}
              className="py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', color: '#e2e8f0' }}>
              <Icons.Refresh size={13} /> {refreshing ? '...' : 'تحديث الحالة'}
            </button>
          </div>
        </div>

        <div className="text-center text-2xs mt-5" style={{ color: '#64748b' }}>
          © 2026 أحمد جلال — جميع الحقوق محفوظة
        </div>
      </div>
    </div>
  )
}
