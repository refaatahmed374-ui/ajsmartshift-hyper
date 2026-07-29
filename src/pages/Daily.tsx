import { useState, useEffect } from 'react'
import { useShift } from '../store/shift'
import ShiftSheet from '../components/ShiftSheet'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import { api, call } from '../lib/api'
import Modal from '../components/Modal'
import Icons from '../components/Icon'
import { parsePias, todayISO, nowTime, shiftTypeLabel } from '../lib/format'
import { detectShiftType } from '../../core/engine'
import type { User } from '../../core/types'

export default function Daily() {
  const { user } = useAuth()
  const { show } = useToast()
  const { activeShift, loadActiveShift, refreshAll } = useShift()

  // ===== مودال فتح شيفت =====
  const [openShiftModal, setOpenShiftModal] = useState(false)
  const [shiftForm, setShiftForm] = useState({
    date: todayISO(), startTime: nowTime(), openingBalance: '', note: '',
    cashierUserId: 0,   // 0 = المستخدم الحالي
    type: detectShiftType(nowTime()) as 'morning' | 'evening' | 'between',   // يُشتق من الوقت مبدئياً
  })
  const [shiftUsers,    setShiftUsers]    = useState<User[]>([])   // للكاشير المنسدل
  const [creatingShift, setCreatingShift] = useState(false)

  useEffect(() => {
    loadActiveShift()
    // تحميل المستخدمين النشطين لاختيار الكاشير
    call(api.users.getAll())
      .then(us => setShiftUsers((us as User[]).filter(u => u.active)))
      .catch(() => {})
  }, [])

  async function handleOpenShift() {
    if (!user) return
    setCreatingShift(true)
    try {
      const cashierId = shiftForm.cashierUserId || user.id
      const cashier   = shiftUsers.find(u => u.id === cashierId)
      await call(api.shifts.create({
        cashierUserId:  cashierId,
        cashierName:    cashier?.displayName ?? user.displayName,
        date:           shiftForm.date,
        startTime:      shiftForm.startTime,
        type:           shiftForm.type,
        openingBalance: parsePias(shiftForm.openingBalance),
        createdBy:      user.id,
        note:           shiftForm.note,
      }))
      show('تم فتح الشيفت بنجاح', 'success')
      setOpenShiftModal(false)
      await loadActiveShift()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setCreatingShift(false) }
  }

  // ===== لا يوجد شيفت =====
  if (!activeShift) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
      <Icons.Journal size={56} className="text-surface-600 mx-auto" />
      <div className="text-center">
        <h2 className="text-xl font-bold text-white mb-2">لا يوجد شيفت مفتوح</h2>
        <p className="text-surface-400 text-sm mb-6">افتح شيفت جديد لبدء تسجيل البنود</p>
        {user && (user.role === 'manager' || user.role === 'cashier') && (
          <button onClick={() => setOpenShiftModal(true)} className="btn-primary">
            <Icons.Plus size={16} /> فتح شيفت جديد
          </button>
        )}
      </div>

      <Modal open={openShiftModal} title="فتح شيفت جديد" onClose={() => setOpenShiftModal(false)}
        footer={<>
          <button onClick={() => setOpenShiftModal(false)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleOpenShift} disabled={creatingShift} className="btn-success btn-sm">
            {creatingShift ? 'جاري الفتح...' : 'فتح الشيفت'}
          </button>
        </>}>
        <div className="space-y-3">
          {/* اسم الكاشير + نوع الشيفت — أعلى النافذة */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-surface-400 mb-1">اسم الكاشير</label>
              <select className="field" value={shiftForm.cashierUserId || user?.id || ''}
                onChange={e => setShiftForm(f => ({ ...f, cashierUserId: Number(e.target.value) }))}>
                {shiftUsers.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-surface-400 mb-1">نوع الشيفت</label>
              <div className="grid grid-cols-3 gap-1">
                {(['morning', 'evening', 'between'] as const).map(t => {
                  const active = shiftForm.type === t
                  return (
                    <button key={t} type="button" onClick={() => setShiftForm(f => ({ ...f, type: t }))}
                      className="py-2 rounded-lg text-2xs font-bold transition-all border"
                      style={active
                        ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
                        : { background: 'var(--inner-bg)', borderColor: 'var(--inner-border)', color: 'var(--txt-1)' }}>
                      {shiftTypeLabel(t)}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-surface-400 mb-1">التاريخ</label>
              <input className="field" type="date" value={shiftForm.date}
                onChange={e => setShiftForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-surface-400 mb-1">وقت البداية</label>
              <input className="field" type="time" value={shiftForm.startTime}
                onChange={e => setShiftForm(f => ({ ...f, startTime: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-surface-400 mb-1">رصيد البداية (جنيه)</label>
            <input className="field" type="number" placeholder="0.00" value={shiftForm.openingBalance}
              onChange={e => setShiftForm(f => ({ ...f, openingBalance: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-surface-400 mb-1">ملاحظة</label>
            <input className="field" placeholder="اختياري" value={shiftForm.note}
              onChange={e => setShiftForm(f => ({ ...f, note: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </div>
  )

  // ===== الشيفت مفتوح =====
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        {/* onDeleted مطلوب صراحة هنا — "حذف الشيفت" ما كان بيستدعي onChanged (فقط onDeleted/onClose)، فكانت الشاشة
            تفضل عارضة الشيفت المحذوف بلا أي تحديث. loadActiveShift يعيد تحميل الشيفت النشط الحقيقي من القاعدة. */}
        <ShiftSheet shiftId={activeShift.id} embedded
          onChanged={() => refreshAll(activeShift.id)} onDeleted={loadActiveShift} />
      </div>
    </div>
  )
}
