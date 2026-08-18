import { useState, useEffect } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import Icons from '../components/Icon'
import NotificationsPage from './Notifications'

// إعدادات النظام — تبويبات النظام فقط.
// نُقلت (بيانات المنشأة · الترخيص · النسخ الاحتياطي · معلومات البرنامج) إلى «حول البرنامج»،
// ونُقلت مصفوفة صلاحيات الإجراءات إلى «صلاحيات المستخدمين».
type SubTab = 'alerts' | 'updates' | 'tools' | 'memory'
const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'alerts',   label: 'التنبيهات',        icon: <Icons.Bell size={14} /> },
  { id: 'updates',  label: 'تحديثات البرنامج', icon: <Icons.Refresh size={14} /> },
  { id: 'tools',    label: 'الأدوات المساعدة', icon: <Icons.Settings size={14} /> },
  { id: 'memory',   label: 'إدارة الذاكرة',    icon: <Icons.Backup size={14} /> },
]

export default function Settings() {
  const { show } = useToast()
  const [subTab, setSubTab] = useState<SubTab>('alerts')

  // عتبة تنبيه العجز/الأوفر (منقولة من تبويب الترخيص القديم)
  const [threshold, setThreshold] = useState('500')

  async function loadThreshold() {
    const v = await call(api.settings.get('alert_threshold'))
    const n = Number(v)
    if (Number.isFinite(n)) setThreshold(String(n / 100))
  }
  async function saveThreshold() {
    // إدخال فارغ/غير رقمي كان يُخزَّن حرفياً كـ'NaN' فتتعطّل قراءة العتبة بعدها
    const n = parseFloat(threshold)
    if (!Number.isFinite(n) || n < 0) { show('أدخل قيمة رقمية صحيحة للعتبة', 'error'); return }
    await call(api.settings.set('alert_threshold', String(Math.round(n * 100))))
    show('تم حفظ عتبة التنبيه', 'success')
  }

  useEffect(() => { loadThreshold() }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* رأس + تبويبات فرعية */}
      <div className="flex items-center gap-1 px-4 pt-3 flex-shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
        {SUB_TABS.map(t => {
          const active = subTab === t.id
          return (
            <button key={t.id} onClick={() => setSubTab(t.id)}
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

      <div className="flex-1 overflow-y-auto p-4">
        {/* عتبة التنبيه — تظهر أعلى تبويب التنبيهات */}
        {subTab === 'alerts' && (
          <div className="card max-w-3xl mx-auto mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Icons.Bell size={15} className="text-warning" />
              <span className="font-bold text-white text-sm">عتبة تنبيه العجز/الأوفر</span>
            </div>
            <div className="flex items-center gap-3">
              <input className="field w-40" type="number" min={0} value={threshold}
                onChange={e => setThreshold(e.target.value)} placeholder="جنيه" />
              <span className="text-xs text-surface-400">جنيه — تنبيه عند تجاوزها</span>
              <button onClick={saveThreshold} className="btn-primary btn-sm mr-auto">
                <Icons.Save size={13} /> حفظ
              </button>
            </div>
          </div>
        )}

        <NotificationsPage embedded forcedSection={subTab} />
      </div>
    </div>
  )
}
