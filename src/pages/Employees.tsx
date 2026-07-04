import { useState, useEffect, useMemo } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import Modal from '../components/Modal'
import Icons from '../components/Icon'
import { fmt, parsePias, todayISO, nowTime } from '../lib/format'
import type { Employee, Attendance, AttendanceStatus, EmployeeFinancials } from '../../core/types'

type Tab = 'list' | 'attendance' | 'financial'

const STATUS_CFG: Record<AttendanceStatus, { label: string; color: string }> = {
  present: { label: 'حضور',  color: '#2ea043' },
  absent:  { label: 'غياب',  color: '#f85149' },
  leave:   { label: 'إجازة', color: '#d29922' },
}

export default function Employees() {
  const { show } = useToast()

  const [tab,        setTab]        = useState<Tab>('list')
  const [employees,  setEmployees]  = useState<Employee[]>([])
  const [selected,   setSelected]   = useState<Employee | null>(null)
  const [month,      setMonth]      = useState(() => new Date().toISOString().slice(0, 7))

  // ===== مودال إضافة/تعديل =====
  const [addModal,   setAddModal]   = useState(false)
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null)
  const [form, setForm] = useState({
    name: '', nationalId: '', phone: '',
    monthlySalary: '', workHours: '8',
    startDate: todayISO(), status: 'active' as Employee['status'],
  })

  // ===== الحضور =====
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [attForm, setAttForm] = useState({
    date: todayISO(), status: 'present' as AttendanceStatus,
    checkIn: '08:00', checkOut: nowTime(),
  })

  // ===== v2.27.0: تبويب الحضور الفرعي + بيانات الإدخال لكل موظف + بحث السجل =====
  type AttSubTab = 'record' | 'history'
  const [attSubTab, setAttSubTab] = useState<AttSubTab>('record')
  const [attDate, setAttDate]     = useState(todayISO())
  const [rowsData, setRowsData]   = useState<Record<number, { status: AttendanceStatus; checkIn: string; checkOut: string }>>({})
  const [savingRow, setSavingRow] = useState<number | null>(null)
  const [savedToday, setSavedToday] = useState<Record<number, Attendance>>({})
  const [historySearch, setHistorySearch] = useState('')
  const [historyAll, setHistoryAll] = useState<(Attendance & { employeeName: string })[]>([])

  // ===== الحسابات المالية =====
  const [financials, setFinancials] = useState<EmployeeFinancials[]>([])

  // ===== v2.27.0 — نظام احتساب الراتب: بالساعة أو باليوم (لكل موظف) =====
  const [salaryMode, setSalaryMode] = useState<Record<number, 'hours' | 'days'>>({})
  function getSalaryMode(empId: number): 'hours' | 'days' {
    return salaryMode[empId] ?? 'days'
  }
  function toggleSalaryMode(empId: number) {
    setSalaryMode(prev => ({ ...prev, [empId]: getSalaryMode(empId) === 'days' ? 'hours' : 'days' }))
  }

  // ═══ v2.27.0 (14-Jun) — نظام تسليم الرواتب ═══
  // الراتب المستحق لكل موظف حسب الوضع المختار
  function dueSalary(f: EmployeeFinancials): number {
    const mode = getSalaryMode(f.employeeId)
    return mode === 'hours' ? (f.netByHours - f.penaltyByHours) : (f.netByDays - f.penaltyByDays)
  }
  const payrollTotal = financials.reduce((s, f) => s + Math.max(0, dueSalary(f)), 0)

  const [payoutOpen,    setPayoutOpen]    = useState(false)
  const [paidEmps,      setPaidEmps]      = useState<Record<number, boolean>>({})
  const [payrollDone,   setPayrollDone]   = useState(false)
  const [confirmingPay, setConfirmingPay] = useState(false)

  function openPayout() {
    if (financials.length === 0) { show('لا يوجد موظفون', 'warning'); return }
    if (payrollTotal <= 0)       { show('لا توجد رواتب مستحقة', 'warning'); return }
    setPaidEmps({}); setPayrollDone(false); setPayoutOpen(true)
  }
  function markPaid(empId: number) {
    const next = { ...paidEmps, [empId]: true }
    setPaidEmps(next)
    const remaining = financials.filter(f => !next[f.employeeId] && dueSalary(f) > 0)
    if (remaining.length === 0) setPayrollDone(true)
  }
  async function confirmPayroll() {
    setConfirmingPay(true)
    try {
      const details = financials.filter(f => dueSalary(f) > 0).map(f => ({
        name: f.name,
        mode: getSalaryMode(f.employeeId),
        amount: dueSalary(f),
      }))
      // خصم الإجمالي من خزينة الإدارة
      await call(api.treasury.addAdjustment({
        date: todayISO(),
        type: 'salary_payout',
        description: `دفع رواتب الموظفين — ${month}`,
        amount: payrollTotal,
      }))
      // حفظ تقرير الرواتب
      await call(api.payroll.save({
        month,
        totalAmount: payrollTotal,
        paymentMethod: 'management',
        employeeCount: details.length,
        detailsJson: JSON.stringify(details),
      }))
      show('✓ تم تسليم الرواتب وحفظ التقرير', 'success')
      setPayoutOpen(false)
    } catch (e) { show((e as Error).message, 'error') }
    finally { setConfirmingPay(false) }
  }
  function redoPayroll() {
    setPaidEmps({}); setPayrollDone(false)
  }

  // ===== v2.27.0 — نظام الجزاءات الجديد (مدمج في الحضور) =====
  type PenaltyValue = 0 | 0.5 | 1 | 3
  const [penaltyDialog, setPenaltyDialog] = useState<{ emp: Employee; current: number } | null>(null)
  const [penaltyChoice, setPenaltyChoice] = useState<PenaltyValue>(0)
  const [showWarning,   setShowWarning]   = useState(false)

  async function saveEmployeePenalty(empId: number, days: PenaltyValue) {
    try {
      await call(api.emp.setPenalty(empId, attDate, days))
      show(days === 0 ? '✓ تم إلغاء الجزاء' : `✓ تم تسجيل جزاء ${days === 0.5 ? 'نصف يوم' : days === 1 ? 'يوم' : '3 أيام'}`, 'success')
      await loadSavedForDate()
      setPenaltyDialog(null)
      setShowWarning(false)
      setPenaltyChoice(0)
    } catch (e) { show((e as Error).message, 'error') }
  }

  function openPenaltyDialog(emp: Employee) {
    const current = savedToday[emp.id]?.penaltyDays ?? 0
    setPenaltyDialog({ emp, current })
    setPenaltyChoice(current as PenaltyValue)
    setShowWarning(false)
  }

  function handlePenaltySelect(value: PenaltyValue) {
    setPenaltyChoice(value)
    if (value === 3) {
      setShowWarning(true)   // تحذير عند اختيار 3 أيام
    } else {
      setShowWarning(false)
    }
  }

  async function loadEmployees() {
    setEmployees(await call(api.emp.getAll()))
  }
  async function loadAttendance(emp: Employee) {
    setAttendance(await call(api.emp.getAttendanceMonth(emp.id, month)) as Attendance[])
  }
  async function loadFinancials() {
    setFinancials(await call(api.emp.financials(month)) as EmployeeFinancials[])
  }

  useEffect(() => { loadEmployees() }, [])
  useEffect(() => {
    if (selected && tab === 'attendance') loadAttendance(selected)
    if (tab === 'financial') loadFinancials()
  }, [tab, month, selected?.id])

  function selectEmployee(emp: Employee) {
    setSelected(emp)
    if (tab === 'attendance') loadAttendance(emp)
  }

  // ===== إضافة/تعديل موظف =====
  function openAdd() {
    setEditingEmp(null)
    setForm({ name: '', nationalId: '', phone: '', monthlySalary: '', workHours: '8', startDate: todayISO(), status: 'active' })
    setAddModal(true)
  }
  function openEdit(emp: Employee) {
    setEditingEmp(emp)
    setForm({
      name: emp.name, nationalId: emp.nationalId, phone: emp.phone,
      monthlySalary: String(emp.monthlySalary / 100),
      workHours: String(emp.workHours / 100),
      startDate: emp.startDate, status: emp.status,
    })
    setAddModal(true)
  }
  async function handleSave() {
    if (!form.name.trim()) { show('أدخل الاسم', 'warning'); return }
    try {
      const data = {
        name: form.name, nationalId: form.nationalId, phone: form.phone,
        monthlySalary: parsePias(form.monthlySalary || '0'),
        workHours: Math.round(parseFloat(form.workHours || '8') * 100),
        startDate: form.startDate, endDate: null, status: form.status,
      }
      if (editingEmp) {
        await call(api.emp.update(editingEmp.id, data)); show('تم تحديث الموظف', 'success')
      } else {
        await call(api.emp.create(data)); show('تم إضافة الموظف', 'success')
      }
      setAddModal(false)
      await loadEmployees()
    } catch (e) { show((e as Error).message, 'error') }
  }

  // ===== حفظ حضور =====
  async function handleSaveAttendance() {
    if (!selected) { show('اختر موظفاً أولاً', 'warning'); return }
    try {
      await call(api.emp.setAttendance({
        employeeId: selected.id,
        date: attForm.date,
        status: attForm.status,
        checkIn:  attForm.status === 'present' ? attForm.checkIn  : null,
        checkOut: attForm.status === 'present' ? attForm.checkOut : null,
      }))
      show('تم حفظ الحضور ✓', 'success')
      await loadAttendance(selected)
    } catch (e) { show((e as Error).message, 'error') }
  }
  async function handleDeleteAtt(id: number) {
    try {
      await call(api.emp.deleteAttendance(id))
      if (selected) await loadAttendance(selected)
    } catch (e) { show((e as Error).message, 'error') }
  }

  // ===== v2.27.0 helpers — تسجيل صف موظف + جلب السجل الكامل =====
  // ═══ v2.27.0 (14-Jun) — حساب ساعات العمل تلقائياً من الحضور/الانصراف ═══
  // يرجع إجمالي الدقائق (دقيق — بدون تقريب عشري)
  function calcMinutes(checkIn: string, checkOut: string): number {
    if (!checkIn || !checkOut) return 0
    const [h1, m1] = checkIn.split(':').map(Number)
    const [h2, m2] = checkOut.split(':').map(Number)
    if (isNaN(h1) || isNaN(h2)) return 0
    let mins = (h2 * 60 + m2) - (h1 * 60 + m1)
    if (mins < 0) mins += 24 * 60 // عبر منتصف الليل
    return mins
  }
  // تنسيق دقيق: "8 س 15 د" بدل "8.3 س" المضلل
  function fmtWorkTime(totalMins: number): string {
    const h = Math.floor(totalMins / 60)
    const m = totalMins % 60
    if (m === 0) return `${h} س`
    return `${h} س ${m} د`
  }

  function getRowData(empId: number) {
    return rowsData[empId] ?? { status: 'present' as AttendanceStatus, checkIn: '08:00', checkOut: nowTime() }
  }
  function setRowData(empId: number, patch: Partial<{ status: AttendanceStatus; checkIn: string; checkOut: string }>) {
    setRowsData(prev => ({ ...prev, [empId]: { ...getRowData(empId), ...patch } }))
  }
  async function saveAttendanceForRow(emp: Employee) {
    const d = getRowData(emp.id)
    setSavingRow(emp.id)
    try {
      await call(api.emp.setAttendance({
        employeeId: emp.id,
        date:       attDate,
        status:     d.status,
        checkIn:    d.status === 'present' ? d.checkIn  : null,
        checkOut:   d.status === 'present' ? d.checkOut : null,
      }))
      show(`✓ ${emp.name} — تم الحفظ`, 'success')
      // إعادة جلب لتحديث حالة "محفوظ"
      await loadSavedForDate()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setSavingRow(null) }
  }
  async function loadSavedForDate() {
    try {
      const all = await Promise.all(
        employees.filter(e => e.status === 'active').map(async emp => {
          const list = await call(api.emp.getAttendanceMonth(emp.id, attDate.slice(0, 7))) as Attendance[]
          const rec  = list.find(a => a.date === attDate)
          return rec ? [emp.id, rec] as const : null
        })
      )
      const map: Record<number, Attendance> = {}
      for (const r of all) if (r) map[r[0]] = r[1]
      setSavedToday(map)
    } catch {}
  }
  async function loadHistoryAll() {
    try {
      const all = await Promise.all(
        employees.filter(e => e.status === 'active').map(async emp => {
          const list = await call(api.emp.getAttendanceMonth(emp.id, month)) as Attendance[]
          return list.map(a => ({ ...a, employeeName: emp.name }))
        })
      )
      setHistoryAll(all.flat().sort((a, b) => b.date.localeCompare(a.date)))
    } catch {}
  }
  useEffect(() => {
    if (tab === 'attendance' && attSubTab === 'record' && employees.length > 0) loadSavedForDate()
  }, [tab, attSubTab, attDate, employees.length])
  useEffect(() => {
    if (tab === 'attendance' && attSubTab === 'history' && employees.length > 0) loadHistoryAll()
  }, [tab, attSubTab, month, employees.length])

  // معاينة الراتب المشتق
  const previewMonthly = parsePias(form.monthlySalary || '0')
  const previewHours   = parseFloat(form.workHours || '8') || 8
  const previewDaily   = Math.round(previewMonthly / 30)
  const previewHourly  = Math.round(previewDaily / previewHours)

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'list',       label: 'بيانات الموظفين',        icon: <Icons.Employees size={15} /> },
    { id: 'attendance', label: 'الحضور والانصراف',       icon: <Icons.Clock size={15} /> },
    { id: 'financial',  label: 'الحسابات المالية',       icon: <Icons.Reports size={15} /> },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ===== شريط التبويبات ===== */}
      <div className="flex items-center gap-1 px-4 pt-3 border-b border-surface-600 flex-shrink-0 bg-surface-800">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg transition-all"
            style={{
              fontSize: '14px', fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? '#d4a017' : 'var(--txt-2)',
              borderBottom: tab === t.id ? '2px solid #d4a017' : '2px solid transparent',
              background: tab === t.id ? 'rgba(212,160,23,0.08)' : 'transparent',
            }}>
            {t.icon}{t.label}
          </button>
        ))}
        <div className="flex-1" />
        <input className="field text-xs w-36 mb-2" type="month" value={month}
          onChange={e => setMonth(e.target.value)} />
      </div>

      {/* ═══════════ تبويب 1: بيانات الموظفين ═══════════ */}
      {tab === 'list' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--txt-1)' }}>
              الموظفون ({employees.length})
            </h2>
            <button onClick={openAdd} className="btn-primary btn-sm">
              <Icons.Plus size={14} /> موظف جديد
            </button>
          </div>

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="th">الاسم</th>
                <th className="th">الهاتف</th>
                <th className="th">الراتب الشهري</th>
                <th className="th">راتب اليوم</th>
                <th className="th">ساعات العمل</th>
                <th className="th">أجر الساعة</th>
                <th className="th">الحالة</th>
                <th className="th"></th>
              </tr></thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id} className="tr">
                    <td className="td font-bold" style={{ color: 'var(--txt-1)' }}>{emp.name}</td>
                    <td className="td" style={{ color: 'var(--txt-2)' }}>{emp.phone || '—'}</td>
                    <td className="td tabular-nums">{fmt(emp.monthlySalary)} ج</td>
                    <td className="td tabular-nums">{fmt(Math.round(emp.monthlySalary / 30))} ج</td>
                    <td className="td tabular-nums">{(emp.workHours / 100).toFixed(1)} س</td>
                    <td className="td tabular-nums text-brand-400 font-bold">{fmt(emp.hourlyRate)} ج</td>
                    <td className="td">
                      <span className={`badge text-xs ${emp.status === 'active' ? 'badge-approved' : 'badge-deficit'}`}>
                        {emp.status === 'active' ? 'نشط' : 'غير نشط'}
                      </span>
                    </td>
                    <td className="td">
                      <button onClick={() => openEdit(emp)}
                        className="p-1.5 rounded-lg hover:bg-surface-600 text-surface-400 hover:text-brand-400">
                        <Icons.Edit size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {employees.length === 0 && (
              <div className="text-center py-8" style={{ color: 'var(--txt-3)' }}>لا يوجد موظفون</div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ تبويب 2: الحضور والانصراف (v2.27.0) ═══════════ */}
      {tab === 'attendance' && (
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
          {/* تبويبات فرعية */}
          <div className="flex items-center gap-2 border-b" style={{ borderColor: 'var(--inner-border)' }}>
            {[
              { id: 'record' as const,  label: 'تسجيل الحضور اليومي', icon: <Icons.Clock size={14} /> },
              { id: 'history' as const, label: 'سجل حضور الموظفين',   icon: <Icons.Records size={14} /> },
            ].map(st => (
              <button key={st.id} onClick={() => setAttSubTab(st.id)}
                className="flex items-center gap-2 px-4 py-2 rounded-t-lg transition-all"
                style={{
                  fontSize: 13, fontWeight: attSubTab === st.id ? 700 : 500,
                  color: attSubTab === st.id ? 'var(--accent)' : 'var(--txt-2)',
                  borderBottom: attSubTab === st.id ? '2px solid var(--accent)' : '2px solid transparent',
                  background: attSubTab === st.id ? 'rgba(59,130,246,0.08)' : 'transparent',
                }}>
                {st.icon}{st.label}
              </button>
            ))}
            <div className="flex-1" />
            {attSubTab === 'record' ? (
              <div className="flex items-center gap-2 mb-1">
                <label style={{ fontSize: 12, color: 'var(--txt-2)' }}>التاريخ:</label>
                <input className="field text-xs" type="date" value={attDate}
                  onChange={e => setAttDate(e.target.value)}
                  style={{ width: 150 }} />
              </div>
            ) : null}
          </div>

          {/* ===== تسجيل الحضور — كل الموظفين النشطين ===== */}
          {attSubTab === 'record' && (
            <div className="card p-0 overflow-hidden flex-1 flex flex-col">
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--inner-border)' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt-1)' }}>
                  الموظفون النشطون ({employees.filter(e => e.status === 'active').length})
                </span>
                <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>
                  أدخل البيانات لكل موظف ثم اضغط حفظ
                </span>
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="th">الموظف</th>
                      <th className="th">ساعات/يوم</th>
                      <th className="th" style={{ width: 220 }}>الحالة</th>
                      <th className="th">وقت الحضور</th>
                      <th className="th">وقت الانصراف</th>
                      <th className="th text-center" style={{ width: 90, color: 'var(--accent)' }}>ساعات العمل</th>
                      <th className="th text-center" style={{ width: 110, color: '#ef4444' }}>جزاء</th>
                      <th className="th">محفوظ؟</th>
                      <th className="th" style={{ width: 90 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.filter(e => e.status === 'active').map(emp => {
                      const d = getRowData(emp.id)
                      const saved = savedToday[emp.id]
                      return (
                        <tr key={emp.id} className="tr">
                          <td className="td font-bold" style={{ color: 'var(--txt-1)' }}>{emp.name}</td>
                          <td className="td tabular-nums" style={{ color: 'var(--txt-2)' }}>
                            {(emp.workHours / 100).toFixed(1)} س
                          </td>
                          <td className="td">
                            <div className="grid grid-cols-3 gap-1">
                              {(Object.keys(STATUS_CFG) as AttendanceStatus[]).map(st => (
                                <button key={st} type="button"
                                  onClick={() => setRowData(emp.id, { status: st })}
                                  className="py-1.5 rounded text-2xs font-bold transition-all border"
                                  style={d.status === st
                                    ? { background: STATUS_CFG[st].color + '22', borderColor: STATUS_CFG[st].color, color: STATUS_CFG[st].color }
                                    : { background: 'var(--inner-bg)', borderColor: 'var(--inner-border)', color: 'var(--txt-3)' }}>
                                  {STATUS_CFG[st].label}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="td">
                            <input className="field text-xs" type="time"
                              value={d.checkIn}
                              disabled={d.status !== 'present'}
                              onChange={e => setRowData(emp.id, { checkIn: e.target.value })} />
                          </td>
                          <td className="td">
                            <input className="field text-xs" type="time"
                              value={d.checkOut}
                              disabled={d.status !== 'present'}
                              onChange={e => setRowData(emp.id, { checkOut: e.target.value })} />
                          </td>
                          {/* ساعات العمل المحسوبة تلقائياً — v2.27.0 (14-Jun) — دقيق بالساعات والدقائق */}
                          <td className="td text-center">
                            {d.status === 'present' ? (
                              <span className="inline-block px-2 py-1 rounded-md tabular-nums font-bold whitespace-nowrap"
                                style={{ fontSize: 12, background: 'rgba(59,130,246,0.12)', color: 'var(--accent)', border: '1px solid rgba(59,130,246,0.30)' }}>
                                {fmtWorkTime(calcMinutes(d.checkIn, d.checkOut))}
                              </span>
                            ) : <span style={{ color: 'var(--txt-3)' }}>—</span>}
                          </td>
                          {/* عمود الجزاء — v2.27.0 */}
                          <td className="td text-center">
                            {(() => {
                              const penalty = saved?.penaltyDays ?? 0
                              const label   = penalty === 0    ? 'لا يوجد'
                                            : penalty === 0.5  ? 'نصف يوم'
                                            : penalty === 1    ? 'يوم'
                                            : penalty === 3    ? '3 أيام'
                                            : `${penalty} يوم`
                              const color   = penalty === 0 ? '#64748b' : penalty === 3 ? '#dc2626' : '#ef4444'
                              return (
                                <button onClick={() => openPenaltyDialog(emp)}
                                  className="px-2 py-1 rounded-md text-2xs font-bold transition-all w-full"
                                  style={{
                                    background: penalty > 0 ? color + '18' : 'var(--inner-bg)',
                                    border: `1px solid ${penalty > 0 ? color + '55' : 'var(--inner-border)'}`,
                                    color,
                                  }}
                                  title="اضغط لتسجيل جزاء">
                                  {penalty > 0 ? '⚠ ' : ''}{label}
                                </button>
                              )
                            })()}
                          </td>
                          <td className="td">
                            {saved ? (
                              <span className="badge text-2xs" style={{
                                background: STATUS_CFG[saved.status].color + '22',
                                color: STATUS_CFG[saved.status].color,
                              }}>
                                ✓ {STATUS_CFG[saved.status].label}
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>—</span>
                            )}
                          </td>
                          <td className="td">
                            <button
                              onClick={() => saveAttendanceForRow(emp)}
                              disabled={savingRow === emp.id}
                              className="btn-primary btn-sm w-full"
                              style={{ fontSize: 11, padding: '4px 8px' }}>
                              <Icons.Save size={11} /> حفظ
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {employees.filter(e => e.status === 'active').length === 0 && (
                  <div className="text-center py-8" style={{ color: 'var(--txt-3)' }}>
                    لا يوجد موظفون نشطون
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== سجل حضور الموظفين مع البحث ===== */}
          {attSubTab === 'history' && (
            <div className="card p-0 overflow-hidden flex-1 flex flex-col">
              <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--inner-border)' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt-1)' }}>
                  سجل حضور {month} ({historyAll.length} سجل)
                </span>
                <div className="flex items-center gap-2 flex-1 max-w-xs">
                  <span style={{ color: 'var(--txt-3)' }}><Icons.Eye size={14} /></span>
                  <input className="field text-xs flex-1" placeholder="بحث بالاسم..."
                    value={historySearch}
                    onChange={e => setHistorySearch(e.target.value)} />
                </div>
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="th">الموظف</th>
                      <th className="th">التاريخ</th>
                      <th className="th">الحالة</th>
                      <th className="th">حضور</th>
                      <th className="th">انصراف</th>
                      <th className="th">ساعات العمل</th>
                      <th className="th" style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyAll
                      .filter(a => !historySearch.trim() || a.employeeName.includes(historySearch.trim()))
                      .map(a => (
                        <tr key={a.id} className="tr">
                          <td className="td font-bold" style={{ color: 'var(--txt-1)' }}>{a.employeeName}</td>
                          <td className="td tabular-nums" style={{ color: 'var(--txt-2)' }}>{a.date}</td>
                          <td className="td">
                            <span className="badge text-2xs" style={{
                              background: STATUS_CFG[a.status].color + '22',
                              color: STATUS_CFG[a.status].color,
                            }}>
                              {STATUS_CFG[a.status].label}
                            </span>
                          </td>
                          <td className="td tabular-nums">{a.checkIn ?? '—'}</td>
                          <td className="td tabular-nums">{a.checkOut ?? '—'}</td>
                          <td className="td tabular-nums font-bold whitespace-nowrap" style={{ color: 'var(--accent)' }}>
                            {a.status === 'present' ? fmtWorkTime(a.hoursWorked) : '—'}
                          </td>
                          <td className="td">
                            <button onClick={() => handleDeleteAtt(a.id).then(() => loadHistoryAll())}
                              className="p-1 rounded hover:bg-white/5 text-surface-400 hover:text-danger">
                              <Icons.Trash size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {historyAll.length === 0 && (
                  <div className="text-center py-8" style={{ color: 'var(--txt-3)' }}>
                    لا يوجد حضور مسجّل لهذا الشهر
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ تبويب 3: الحسابات المالية ═══════════ */}
      {tab === 'financial' && (
        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="mb-4" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--txt-1)' }}>
            الحسابات المالية للموظفين — {month}
          </h2>
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr>
                <th className="th">الموظف</th>
                <th className="th">أيام الحضور</th>
                <th className="th text-danger">أيام الغياب</th>
                <th className="th">ساعات الحضور</th>
                <th className="th">أجر بالساعة</th>
                <th className="th">أجر باليوم</th>
                <th className="th text-danger">السلف</th>
                <th className="th text-danger">الجزاءات</th>
                <th className="th" style={{ color: '#3b82f6' }}>مستحق بالساعة</th>
                <th className="th" style={{ color: '#10b981' }}>مستحق باليوم</th>
                <th className="th" style={{ color: 'var(--accent)', minWidth: 180 }}>الراتب المعتمد</th>
              </tr></thead>
              <tbody>
                {financials.map(f => {
                  const mode    = getSalaryMode(f.employeeId)
                  // الجزاء حسب الوضع: بالأيام أو بالساعة (من الحضور)
                  const penaltyValue = mode === 'hours' ? f.penaltyByHours : f.penaltyByDays
                  // الراتب المستحق = صافي (حسب الوضع) − الجزاء (حسب الوضع)
                  const dueByHours = f.netByHours - f.penaltyByHours
                  const dueByDays  = f.netByDays  - f.penaltyByDays
                  const dueValue   = mode === 'hours' ? dueByHours : dueByDays
                  const modeColor  = mode === 'hours' ? '#3b82f6' : '#10b981'
                  return (
                    <tr key={f.employeeId} className="tr">
                      <td className="td font-bold" style={{ color: 'var(--txt-1)' }}>{f.name}</td>
                      <td className="td tabular-nums text-success">{f.presentDays}</td>
                      <td className="td tabular-nums text-danger">{f.absentDays}</td>
                      <td className="td tabular-nums">{(f.totalMinutes / 60).toFixed(1)} س</td>
                      <td className="td tabular-nums text-info">{fmt(f.wageByHours)}</td>
                      <td className="td tabular-nums">{fmt(f.wageByDays)}</td>
                      <td className="td tabular-nums text-danger">{fmt(f.advances)}</td>
                      <td className="td tabular-nums text-danger">
                        {fmt(penaltyValue)}
                        <span className="text-2xs block" style={{ color: 'var(--txt-3)' }}>
                          ({f.penaltyDays} يوم)
                        </span>
                      </td>
                      {/* الراتب المستحق بالساعة (تلقائي) */}
                      <td className="td tabular-nums font-bold" style={{ color: '#3b82f6' }}>{fmt(dueByHours)} ج</td>
                      {/* الراتب المستحق باليوم (تلقائي) */}
                      <td className="td tabular-nums font-bold" style={{ color: '#10b981' }}>{fmt(dueByDays)} ج</td>
                      {/* الراتب المعتمد (حسب الوضع المختار) + زر التبديل */}
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleSalaryMode(f.employeeId)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-2xs font-bold transition-all"
                            style={{ background: modeColor + '18', border: `1px solid ${modeColor}55`, color: modeColor, minWidth: 62 }}
                            title="اضغط لتبديل طريقة الحساب المعتمدة">
                            <Icons.Refresh size={10} />
                            {mode === 'hours' ? 'بالساعة' : 'باليوم'}
                          </button>
                          <span className="tabular-nums font-bold flex-1" style={{ fontSize: 13, color: modeColor }}>
                            {fmt(dueValue)} ج
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {/* صف الإجمالي + زر الدفع */}
              {financials.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
                    <td className="td" colSpan={10} style={{ fontWeight: 800, color: 'var(--txt-1)', textAlign: 'left' }}>
                      💰 إجمالي الرواتب المستحقة (المعتمدة)
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums font-bold" style={{ fontSize: 15, color: 'var(--accent)' }}>
                          {fmt(payrollTotal)} ج
                        </span>
                        <button onClick={openPayout} className="btn-success-pro btn-sm" style={{ fontSize: 11, padding: '5px 14px' }}>
                          <Icons.Fund size={12} /> دفع
                        </button>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
            {financials.length === 0 && (
              <div className="text-center py-8" style={{ color: 'var(--txt-3)' }}>لا يوجد موظفون نشطون</div>
            )}
          </div>
          <div className="mt-3 text-xs leading-relaxed p-3 rounded-lg" style={{
            color: 'var(--txt-2)', background: 'var(--inner-bg)', border: '1px solid var(--inner-border)',
          }}>
            <div className="mb-2 font-bold" style={{ color: 'var(--txt-1)' }}>📐 المعادلات:</div>
            <div>صافي بالساعة = أجر بالساعة − السلف &nbsp;|&nbsp; صافي باليوم = أجر باليوم − السلف</div>
            <div className="mt-1">
              <span style={{ color: '#10b981', fontWeight: 700 }}>الراتب المستحق (باليوم)</span> = صافي باليوم − (أيام الجزاء × أجر اليوم)
            </div>
            <div className="mt-1">
              <span style={{ color: '#3b82f6', fontWeight: 700 }}>الراتب المستحق (بالساعة)</span> = صافي بالساعة − (أيام الجزاء × ساعات اليوم × أجر الساعة)
            </div>
            <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--inner-border)' }}>
              📍 <b>السلف</b>: من بنود اليومية بتصنيف <b>"أجور"</b> مع تحديد الموظف
              <br />
              📍 <b>الجزاءات</b>: من <b>تبويب تسجيل الحضور</b> — اضغط زر "جزاء" بجوار الموظف (نصف يوم / يوم / 3 أيام كحد أقصى)
              <br />
              💡 <b>ملاحظة:</b> أيام الجزاء لا تُخصم من أيام الحضور — تُحسب فقط في قيمة الراتب
            </div>
          </div>
        </div>
      )}

      {/* ═══════ v2.27.0 (14-Jun) — مودال تسليم الرواتب ═══════ */}
      {payoutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}>
          <div className="card flex flex-col" style={{ width: '95vw', maxWidth: 560, maxHeight: '88vh', padding: 0, overflow: 'hidden' }}>
            {/* رأس */}
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 18 }}>💰</span>
                <div>
                  <div className="font-bold text-base" style={{ color: 'var(--txt-1)' }}>تسليم رواتب الموظفين</div>
                  <div className="text-xs" style={{ color: 'var(--txt-3)' }}>
                    {month} · الإجمالي: <b style={{ color: 'var(--accent)' }}>{fmt(payrollTotal)} ج</b> · من خزينة الإدارة
                  </div>
                </div>
              </div>
              <button onClick={() => setPayoutOpen(false)} className="p-2 rounded-lg hover:bg-white/10" style={{ color: 'var(--txt-2)' }}>
                <Icons.Close size={16} />
              </button>
            </div>

            {/* المحتوى */}
            <div className="flex-1 overflow-y-auto p-4">
              {!payrollDone ? (
                <div className="space-y-2">
                  <div className="text-xs mb-2" style={{ color: 'var(--txt-3)' }}>
                    اضغط ✓ بجوار كل موظف بعد تسليمه راتبه
                  </div>
                  {financials.filter(f => dueSalary(f) > 0 && !paidEmps[f.employeeId]).map(f => {
                    const mode = getSalaryMode(f.employeeId)
                    return (
                      <div key={f.employeeId} className="flex items-center gap-3 p-3 rounded-xl slide-up"
                        style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                        <div className="flex-1">
                          <div className="font-bold" style={{ fontSize: 13, color: 'var(--txt-1)' }}>{f.name}</div>
                          <div className="text-2xs" style={{ color: 'var(--txt-3)' }}>
                            الراتب {mode === 'hours' ? 'بالساعة' : 'باليوم'}
                          </div>
                        </div>
                        <div className="tabular-nums font-bold" style={{ fontSize: 15, color: mode === 'hours' ? '#3b82f6' : '#10b981' }}>
                          {fmt(dueSalary(f))} ج
                        </div>
                        <button onClick={() => markPaid(f.employeeId)}
                          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                          style={{ background: 'rgba(16,185,129,0.15)', border: '1.5px solid #10b981', color: '#10b981' }}
                          title="تم التسليم">
                          <Icons.Check size={16} />
                        </button>
                      </div>
                    )
                  })}
                  {/* الموظفون المدفوع لهم */}
                  {financials.filter(f => paidEmps[f.employeeId]).length > 0 && (
                    <div className="mt-3 pt-3" style={{ borderTop: '1px dashed var(--inner-border)' }}>
                      <div className="text-2xs mb-2" style={{ color: '#10b981' }}>✓ تم تسليمهم:</div>
                      {financials.filter(f => paidEmps[f.employeeId]).map(f => (
                        <div key={f.employeeId} className="flex items-center gap-2 px-2 py-1 text-2xs" style={{ color: 'var(--txt-3)' }}>
                          <Icons.Check size={11} style={{ color: '#10b981' }} />
                          <span className="line-through">{f.name}</span>
                          <span className="tabular-nums mr-auto">{fmt(dueSalary(f))} ج</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* رسالة النجاح */
                <div className="flex flex-col items-center text-center py-6">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
                    style={{ background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 8px 30px rgba(16,185,129,0.5)' }}>
                    <span style={{ fontSize: 40, color: 'white' }}>✓</span>
                  </div>
                  <div className="font-black text-xl mb-2" style={{ color: '#10b981' }}>تم تسليم الرواتب بنجاح</div>
                  <div className="text-sm mb-2" style={{ color: 'var(--txt-2)' }}>
                    إجمالي <b style={{ color: 'var(--accent)' }}>{fmt(payrollTotal)} ج</b> لـ {financials.filter(f => dueSalary(f) > 0).length} موظف
                  </div>
                  <div className="text-xs" style={{ color: 'var(--txt-3)' }}>
                    سيتم خصم المبلغ من خزينة الإدارة وحفظ تقرير في "تقارير الموظفين"
                  </div>
                </div>
              )}
            </div>

            {/* فوتر */}
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
              style={{ borderTop: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
              {payrollDone ? (
                <>
                  <button onClick={redoPayroll} className="btn-ghost btn-sm">↺ إعادة تسليم</button>
                  <button onClick={confirmPayroll} disabled={confirmingPay} className="btn-success-pro" style={{ fontSize: 13, padding: '8px 22px' }}>
                    {confirmingPay
                      ? <><Icons.Refresh size={13} className="animate-spin" /> جاري الحفظ...</>
                      : <><Icons.Check size={14} /> تأكيد وحفظ التقرير</>
                    }
                  </button>
                </>
              ) : (
                <button onClick={() => setPayoutOpen(false)} className="btn-ghost btn-sm mr-auto">إلغاء</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== مودال إضافة/تعديل موظف ===== */}
      <Modal open={addModal} title={editingEmp ? 'تعديل موظف' : 'إضافة موظف جديد'}
        onClose={() => setAddModal(false)}
        footer={<>
          <button onClick={() => setAddModal(false)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSave} className="btn-primary btn-sm"><Icons.Check size={14} /> حفظ</button>
        </>}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>الاسم *</label>
            <input className="field" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>الهاتف</label>
              <input className="field" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>رقم الهوية</label>
              <input className="field" value={form.nationalId} onChange={e => setForm(f => ({ ...f, nationalId: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>الراتب الشهري (ج)</label>
              <input className="field" type="number" min={0} value={form.monthlySalary}
                onChange={e => setForm(f => ({ ...f, monthlySalary: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>ساعات العمل اليومية</label>
              <input className="field" type="number" min={1} step="0.5" value={form.workHours}
                onChange={e => setForm(f => ({ ...f, workHours: e.target.value }))} />
            </div>
          </div>

          {/* معاينة المشتقات */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl p-3 text-center" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--txt-3)' }}>راتب اليوم (تلقائي)</div>
              <div className="tabular-nums font-bold text-success">{fmt(previewDaily)} ج</div>
            </div>
            <div className="rounded-xl p-3 text-center" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
              <div className="text-xs mb-1" style={{ color: 'var(--txt-3)' }}>أجر الساعة (تلقائي)</div>
              <div className="tabular-nums font-bold text-brand-400">{fmt(previewHourly)} ج</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>تاريخ التعيين</label>
              <input className="field" type="date" value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>الحالة</label>
              <select className="field" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as Employee['status'] }))}>
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
              </select>
            </div>
          </div>
        </div>
      </Modal>

      {/* ═══════════════ Dialog الجزاء — v2.27.0 ═══════════════ */}
      {penaltyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
          onClick={() => { setPenaltyDialog(null); setShowWarning(false); setPenaltyChoice(0) }}>
          <div className="card" style={{ width: '100%', maxWidth: 460, padding: 0 }}
            onClick={e => e.stopPropagation()}>

            {/* رأس */}
            <div className="flex items-center gap-3 px-5 py-3"
              style={{ borderBottom: '1px solid var(--inner-border)', background: 'rgba(239,68,68,0.06)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444' }}>
                ⚠
              </div>
              <div>
                <div className="font-bold" style={{ color: 'var(--txt-1)', fontSize: 15 }}>
                  تسجيل جزاء — {penaltyDialog.emp.name}
                </div>
                <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>
                  بتاريخ {attDate}
                </div>
              </div>
            </div>

            {/* محتوى — الخيارات */}
            <div className="p-5 space-y-3">
              <div style={{ fontSize: 13, color: 'var(--txt-2)' }}>
                اختر مدة الجزاء:
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { val: 0.5, label: 'نصف يوم', color: '#f59e0b' },
                  { val: 1,   label: 'يوم',     color: '#ef4444' },
                  { val: 3,   label: '3 أيام',  color: '#dc2626' },
                ] as { val: PenaltyValue; label: string; color: string }[]).map(opt => {
                  const selected = penaltyChoice === opt.val
                  return (
                    <button key={opt.val}
                      onClick={() => handlePenaltySelect(opt.val)}
                      className="py-3 rounded-xl font-bold transition-all border-2"
                      style={selected
                        ? { background: opt.color, borderColor: opt.color, color: 'white',
                            boxShadow: `0 4px 14px ${opt.color}55`, transform: 'scale(1.04)' }
                        : { background: opt.color + '12', borderColor: opt.color + '55', color: opt.color }}>
                      {opt.label}
                    </button>
                  )
                })}
              </div>

              {/* خيار إلغاء الجزاء */}
              {penaltyDialog.current > 0 && (
                <button onClick={() => handlePenaltySelect(0)}
                  className="w-full py-2 rounded-lg text-xs transition-all"
                  style={{
                    background: penaltyChoice === 0 ? '#64748b' : 'transparent',
                    color: penaltyChoice === 0 ? 'white' : 'var(--txt-3)',
                    border: '1px solid var(--inner-border)',
                  }}>
                  بدون جزاء (إلغاء)
                </button>
              )}

              {/* تحذير عند اختيار 3 أيام */}
              {showWarning && (
                <div className="rounded-lg p-3 text-xs animate-pulse"
                  style={{ background: 'rgba(220,38,38,0.10)', border: '1.5px solid #dc2626', color: '#dc2626' }}>
                  <div className="font-bold mb-1" style={{ fontSize: 13 }}>⚠ انتبه!</div>
                  <div style={{ fontWeight: 600, lineHeight: 1.7 }}>
                    لا تتجاحد على الموظف أكتر من تلت أيام — اضربه بالنار أحسن أو مشّيه 😅
                  </div>
                </div>
              )}
            </div>

            {/* الأزرار */}
            <div className="flex items-center justify-end gap-2 px-5 py-3"
              style={{ borderTop: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
              <button onClick={() => { setPenaltyDialog(null); setShowWarning(false); setPenaltyChoice(0) }}
                className="btn-ghost btn-sm">
                إلغاء
              </button>
              <button onClick={() => saveEmployeePenalty(penaltyDialog.emp.id, penaltyChoice)}
                className={showWarning ? 'btn-danger-pro' : 'btn-success-pro'}
                style={{ fontSize: 13, padding: '8px 18px' }}>
                {showWarning ? 'موافق على أي حال' : 'حفظ الجزاء'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
