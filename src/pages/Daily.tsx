import { useState, useEffect, useRef, useMemo } from 'react'
import { useShift } from '../store/shift'
import ShiftSheet from '../components/ShiftSheet'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import { usePermissions } from '../store/permissions'
import { api, call } from '../lib/api'
import Modal from '../components/Modal'
import Icons from '../components/Icon'
import { fmt, parsePias, todayISO, nowTime, shiftTypeLabel, statusLabel, fmtDate } from '../lib/format'
import { calcFawry, calcCustody, calcShiftAnalysis, calcCashierTotal, detectShiftType } from '../../core/engine'
import type { Transaction, Employee, User } from '../../core/types'

type PayMethod = 'cashier' | 'management'

const PAY_LABELS: Record<PayMethod, string> = {
  cashier: 'كاشير', management: 'خزينة الإدارة',
}

// ═══════════════════════════════════════════════════════════
//  v2.27.0 — نظام المسودة: تجميع البنود ثم حفظ موحد
// ═══════════════════════════════════════════════════════════
interface DraftTx {
  localId:          string   // معرّف مؤقت (للجدول)
  description:      string
  mainCategoryId:   number | null
  mainCategoryName: string
  subCategoryId:    number | null
  subCategoryName:  string
  amountIn:         number   // بالقروش (pias)
  amountOut:        number
  payMethod:        PayMethod
  employeeId:       number | null
  customerId:       number | null  // v2.27.0 — مرتبط بعميل (للآجل + التحصيل)
  note:             string
  time:             string   // HH:MM
}

const DRAFT_KEY      = (shiftId: number) => `aj:daily-draft:${shiftId}`
const DEFAULT_ROWS   = 10

function emptyRow(): DraftTx {
  return {
    localId:          `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    description:      '',
    mainCategoryId:   null,
    mainCategoryName: '',
    subCategoryId:    null,
    subCategoryName:  '',
    amountIn:         0,
    amountOut:        0,
    payMethod:        'cashier',
    employeeId:       null,
    customerId:       null,
    note:             '',
    time:             '',
  }
}
function isRowEmpty(d: DraftTx): boolean {
  return !d.description.trim() && d.amountIn === 0 && d.amountOut === 0
}
function loadDraft(shiftId: number): DraftTx[] {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(shiftId))
    const arr = raw ? JSON.parse(raw) as DraftTx[] : []
    // ضمان 10 صفوف على الأقل
    while (arr.length < DEFAULT_ROWS) arr.push(emptyRow())
    return arr
  } catch {
    return Array.from({ length: DEFAULT_ROWS }, emptyRow)
  }
}
function saveDraft(shiftId: number, drafts: DraftTx[]) {
  try { localStorage.setItem(DRAFT_KEY(shiftId), JSON.stringify(drafts)) } catch {}
}
function clearDraft(shiftId: number) {
  try { localStorage.removeItem(DRAFT_KEY(shiftId)) } catch {}
}

export default function Daily() {
  const { user } = useAuth()
  const { show } = useToast()
  const { has  } = usePermissions()
  // صلاحية رؤية تبويب الخزينة (مدير/مشرف فقط)
  const canViewTreasury = user?.role === 'manager' || user?.role === 'supervisor'
  const {
    activeShift, journal, transactions, fawry, custody,
    mainCats, subCats, loadActiveShift, loadCategories,
    addTransaction, addTransactionsBatch, updateTransaction, deleteTransaction, updateFawry, updateCustody, refreshAll,
  } = useShift()

  // ===== مودالات =====
  const [openShiftModal,  setOpenShiftModal]  = useState(false)
  // التبويبات: اليومية / ماكينة فوري / الخزينة / إغلاق الشيفت
  const [tab, setTab] = useState<'daily' | 'fawry' | 'close'>('daily')
  const [deletingId,      setDeletingId]       = useState<number | null>(null)
  const [editingTx,       setEditingTx]        = useState<Transaction | null>(null)
  const [editReason,      setEditReason]       = useState('')
  const [savingEdit,      setSavingEdit]       = useState(false)

  // ===== فتح الشيفت =====
  const [shiftForm, setShiftForm] = useState({
    date: todayISO(), startTime: nowTime(), openingBalance: '', note: '',
    cashierUserId: 0,   // 0 = المستخدم الحالي
    type: detectShiftType(nowTime()) as 'morning' | 'evening' | 'between',   // يُشتق من الوقت مبدئياً
  })
  const [shiftUsers,       setShiftUsers]       = useState<User[]>([])   // للكاشير المنسدل
  const [posSales,         setPosSales]         = useState('')
  const [cashierRemaining, setCashierRemaining] = useState('')
  const [creatingShift,    setCreatingShift]    = useState(false)

  // تحميل المستخدمين النشطين لاختيار الكاشير
  useEffect(() => {
    call(api.users.getAll())
      .then(us => setShiftUsers((us as User[]).filter(u => u.active)))
      .catch(() => {})
  }, [])

  // ===== إدخال بند =====
  const [desc,       setDesc]       = useState('')
  const [mainCat,    setMainCat]    = useState<number | null>(null)
  const [subCat,     setSubCat]     = useState<number | null>(null)
  const [amountIn,   setAmountIn]   = useState('')
  const [amountOut,  setAmountOut]  = useState('')
  const [payMethod,  setPayMethod]  = useState<PayMethod>('cashier')
  const [empId,      setEmpId]      = useState<number | null>(null)
  const [txNote,     setTxNote]     = useState('')
  const [savingTx,   setSavingTx]   = useState(false)

  // ===== اقتراح التصنيف البصري =====
  const [suggestion,    setSuggestion]    = useState<{ mainId: number; subId: number | null; mainName: string; subName: string } | null>(null)
  const [showSuggest,   setShowSuggest]   = useState(false)

  // ===== v2.27.0 — المسودة (Draft) =====
  const [drafts,        setDrafts]        = useState<DraftTx[]>([])
  const [submittingAll, setSubmittingAll] = useState(false)
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null)

  // ===== v2.27.0 (14-Jun) — تحذير البنود الناقصة قبل الإغلاق =====
  const [missingItemsWarning, setMissingItemsWarning] = useState<string[] | null>(null)

  // ===== v2.27.0 (14-Jun) — تعديل بند محفوظ (شيفت مفتوح) =====
  const [editSavedTx, setEditSavedTx] = useState<Transaction | null>(null)
  const [editSavedForm, setEditSavedForm] = useState({
    description: '', mainCategoryId: null as number | null, subCategoryId: null as number | null,
    amountIn: '', amountOut: '', payMethod: 'cashier' as PayMethod,
    employeeId: null as number | null, customerId: null as number | null,
  })
  const [savingEditSaved, setSavingEditSaved] = useState(false)
  const [deletingSavedId, setDeletingSavedId] = useState<number | null>(null)

  // ===== v2.27.0 — modal النجاح بعد إغلاق الشيفت =====
  const [closedSuccessShift, setClosedSuccessShift] = useState<{
    shift: typeof activeShift; in: number; out: number; result: number;
  } | null>(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)

  // ===== فوري =====
  const [fawryForm, setFawryForm] = useState({
    basicReceive: '0', basicDeliver: '0',
    airReceive: '0', airDeliver: '0',
    cashoutReceive: '0', cashoutDeliver: '0',
    fawryToBasic: '0', fawryToAir: '0',
    cashoutToBasic: '0', cashoutToAir: '0',
    programSales: '0', firstVoucher: '0', lastVoucher: '0',
  })

  // ===== العهدة =====
  const [custodyForm, setCustodyForm] = useState({ addFromFund: '0', managementPaid: '0' })

  // ===== موظفون =====
  const [employees, setEmployees] = useState<Employee[]>([])

  // ===== v2.27.0 — العملاء (للدفع الآجل + التحصيلات) =====
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([])

  // ===== اقتراح التصنيف =====
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const descRef      = useRef<HTMLInputElement>(null)

  const filteredSubs = useMemo(
    () => subCats.filter(s => s.mainCategoryId === mainCat),
    [subCats, mainCat]
  )

  useEffect(() => {
    loadActiveShift()
    loadCategories()
    call<Employee[]>(api.emp.getActive()).then(setEmployees).catch(() => {})
    // تحميل العملاء النشطين (للدفع الآجل + التحصيلات)
    call(api.party.list('customer'))
      .then(list => setCustomers((list as { id: number; name: string; active: number }[])
        .filter(c => c.active).map(c => ({ id: c.id, name: c.name }))))
      .catch(() => {})
  }, [])

  // تحميل المسودة من localStorage عند فتح الشيفت
  useEffect(() => {
    if (activeShift) setDrafts(loadDraft(activeShift.id))
    else             setDrafts([])
  }, [activeShift?.id])

  // حفظ تلقائي للمسودة عند أي تغيير
  useEffect(() => {
    if (activeShift) saveDraft(activeShift.id, drafts)
  }, [drafts, activeShift?.id])

  useEffect(() => {
    if (!fawry) return
    setFawryForm({
      basicReceive:   String(fawry.basicReceive   / 100),
      basicDeliver:   String(fawry.basicDeliver   / 100),
      airReceive:     String(fawry.airReceive     / 100),
      airDeliver:     String(fawry.airDeliver     / 100),
      cashoutReceive: String(fawry.cashoutReceive / 100),
      cashoutDeliver: String(fawry.cashoutDeliver / 100),
      fawryToBasic:   String(fawry.fawryToBasic   / 100),
      fawryToAir:     String(fawry.fawryToAir     / 100),
      cashoutToBasic: String(fawry.cashoutToBasic / 100),
      cashoutToAir:   String(fawry.cashoutToAir   / 100),
      programSales:   String(fawry.programSales   / 100),
      firstVoucher:   String(fawry.firstVoucher),
      lastVoucher:    String(fawry.lastVoucher),
    })
  }, [fawry])

  useEffect(() => {
    if (!custody) return
    setCustodyForm({
      addFromFund:    String(custody.addFromFund    / 100),
      managementPaid: String(custody.managementPaid / 100),
    })
  }, [custody])

  // اقتراح التصنيف الذكي (بصري)
  function handleDescChange(val: string) {
    setDesc(val)
    setShowSuggest(false)
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    if (val.length < 2) return
    suggestTimer.current = setTimeout(async () => {
      try {
        const s = await call(api.tx.suggest(val)) as { mainCategoryId: number; subCategoryId: number | null } | null
        if (s && mainCat === null) {
          const mainName = mainCats.find(c => c.id === s.mainCategoryId)?.name ?? ''
          const subName  = subCats.find(c => c.id === s.subCategoryId)?.name ?? ''
          setSuggestion({ mainId: s.mainCategoryId, subId: s.subCategoryId, mainName, subName })
          setShowSuggest(true)
        }
      } catch { /* silent */ }
    }, 400)
  }

  function applySuggestion() {
    if (!suggestion) return
    setMainCat(suggestion.mainId); setSubCat(suggestion.subId)
    setShowSuggest(false); setSuggestion(null)
  }

  // ===== تعديل بند =====
  async function handleEditTx() {
    if (!editingTx || !user) return
    if (!editReason.trim()) { show('يجب إدخال سبب التعديل', 'warning'); return }
    setSavingEdit(true)
    try {
      const before = JSON.stringify({
        description: editingTx.description,
        amountIn: editingTx.amountIn, amountOut: editingTx.amountOut,
        payMethod: editingTx.payMethod,
      })
      // نستخدم نفس البيانات القديمة (التعديل هنا فقط للسبب + audit)
      // يمكن توسيعه لاحقاً للسماح بتعديل المبالغ
      await call(api.audit.log({
        userId: user.id, userName: user.displayName,
        entityType: 'transaction', entityId: editingTx.id,
        operation: 'update', valueBefore: before, valueAfter: before,
        reason: editReason,
      }))
      show('تم تسجيل التعديل في سجل المراجعة', 'success')
      setEditingTx(null); setEditReason('')
    } catch (e) { show((e as Error).message, 'error') }
    finally { setSavingEdit(false) }
  }

  // Enter للحفظ السريع — يضيف صف جديد
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) addRow()
  }

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

  // ═══ v2.27.0 (14-Jun) — فتح تعديل بند محفوظ ═══
  function openEditSaved(tx: Transaction) {
    setEditSavedTx(tx)
    setEditSavedForm({
      description:    tx.description,
      mainCategoryId: tx.mainCategoryId,
      subCategoryId:  tx.subCategoryId,
      amountIn:       tx.amountIn  ? String(tx.amountIn  / 100) : '',
      amountOut:      tx.amountOut ? String(tx.amountOut / 100) : '',
      payMethod:      tx.payMethod as PayMethod,
      employeeId:     tx.employeeId,
      customerId:     tx.customerId,
    })
  }

  // شرط العميل في نموذج التعديل — الآجل بالتصنيف الفرعي «مبيعات آجل» (ADR-012 v2)
  const editMainName = mainCats.find(c => c.id === editSavedForm.mainCategoryId)?.name ?? ''
  const editSubName = subCats.find(s => s.id === editSavedForm.subCategoryId)?.name ?? ''
  const editCustomerEnabled = editSubName === 'مبيعات آجل' || editMainName === 'تحصيل'

  async function handleSaveEditedTx() {
    if (!editSavedTx) return
    if (!editSavedForm.description.trim()) { show('أدخل البيان', 'warning'); return }
    if (!editSavedForm.amountIn && !editSavedForm.amountOut) {
      show('أدخل مبلغ الوارد أو المنصرف', 'warning'); return
    }
    // تحقق العميل
    if (editCustomerEnabled && !editSavedForm.customerId) {
      const reason = editSubName === 'مبيعات آجل' ? 'بيع آجل' : 'تحصيل'
      show(`⚠ هذا البند (${reason}) يحتاج اختيار عميل`, 'error'); return
    }
    setSavingEditSaved(true)
    try {
      await updateTransaction(editSavedTx.id, {
        description:    editSavedForm.description.trim(),
        mainCategoryId: editSavedForm.mainCategoryId,
        subCategoryId:  editSavedForm.subCategoryId,
        amountIn:       parsePias(editSavedForm.amountIn  || '0'),
        amountOut:      parsePias(editSavedForm.amountOut || '0'),
        payMethod:      editSavedForm.payMethod,
        employeeId:     editSavedForm.employeeId,
        customerId:     editCustomerEnabled ? editSavedForm.customerId : null,
      })
      show('✓ تم تعديل البند', 'success')
      setEditSavedTx(null)
    } catch (e) { show((e as Error).message, 'error') }
    finally { setSavingEditSaved(false) }
  }

  async function handleDeleteSavedTx(id: number) {
    try {
      await deleteTransaction(id)
      show('تم حذف البند', 'success')
      setDeletingSavedId(null)
    } catch (e) { show((e as Error).message, 'error') }
  }

  // ═══ تحقق من البنود الناقصة قبل الإغلاق ═══
  function checkMissingItems(): string[] {
    const missing: string[] = []
    const posPiasVal     = parsePias(posSales || '0')
    const remainingPias  = parsePias(cashierRemaining || '0')

    if (posPiasVal <= 0)       missing.push('مبيعات POS (في تبويب حسابات إغلاق الشيفت)')
    if (remainingPias <= 0)    missing.push('نقدية متبقية مع الكاشير (في تبويب حسابات إغلاق الشيفت)')
    if (drafts.filter(d => !isRowEmpty(d)).length === 0) missing.push('بنود اليومية — لم يُسجَّل أي بند (في تبويب جدول بنود اليومية)')

    // فحص بيانات فوري (أحد الحقول > 0)
    const hasFawryData = Object.values(fawryForm).some(v => {
      const n = parseFloat(v as string)
      return !isNaN(n) && n > 0
    })
    if (!hasFawryData) missing.push('بيانات ماكينة فوري — كل الحقول صفر (في تبويب تقفيل ماكينة فوري)')

    return missing
  }

  async function handleCloseShiftClick() {
    // 1) فحص البنود الناقصة
    const missing = checkMissingItems()
    if (missing.length > 0) {
      setMissingItemsWarning(missing)
      return
    }
    // 2) لا يوجد ناقص → نفّذ مباشرة
    await handleCloseShift()
  }

  async function handleCloseShift() {
    if (!activeShift || !user) return
    setMissingItemsWarning(null) // إخفاء التحذير لو كان ظاهراً
    setSubmittingAll(true)
    try {
      // v2.27.0 (15-Jun) — أولاً: حفظ كل بنود المسودة في DB
      await commitDrafts()

      // الحسابات من liveTxs (تشمل المسودة قبل المسح)
      const managementAuto = liveTxs
        .filter(t => t.payMethod === 'management')
        .reduce((s, t) => s + t.amountOut, 0)
      await updateCustody(activeShift.id, {
        addFromFund:    parsePias(custodyForm.addFromFund),
        managementPaid: managementAuto,
      })
      const posPiasVal     = parsePias(posSales || '0')
      const remainingPias  = parsePias(cashierRemaining || '0')
      // v2.31.3 إصلاح: تم تمرير `expectedCash` بدلاً من `remainingPias`.
      // `closeShift` الآن تتوقع `cashierRemaining` في المعامل الأول.
      await call(api.shifts.close(
        activeShift.id,
        remainingPias,
        posPiasVal,
        remainingPias,
      ))
      // الانتقال للحالة المعتمدة مباشرة (لا مراجعة بعد الآن)
      await call(api.shifts.updateStatus(activeShift.id, 'approved', user.id))

      // حساب نتيجة الشيفت للملخص
      const collections = liveTxs.filter(t => t.mainCategoryName === 'تحصيل').reduce((sm, t) => sm + t.amountIn, 0)
      const shiftExpenses = totalOut - managementAuto
      const result = shiftExpenses + remainingPias - posPiasVal - collections

      // مسح المسودة بعد الحفظ
      setDrafts(Array.from({ length: DEFAULT_ROWS }, emptyRow))

      // إظهار modal النجاح
      setClosedSuccessShift({
        shift: { ...activeShift, posSales: posPiasVal, cashierRemaining: remainingPias, status: 'approved' },
        in: totalIn, out: totalOut, result,
      })
      setTab('daily')
      setPosSales(''); setCashierRemaining('')
    } catch (e) { show((e as Error).message, 'error') }
    finally { setSubmittingAll(false) }
  }

  // ═══ توليد التقرير PDF بعد الإغلاق ═══
  async function handleGenerateReport() {
    if (!closedSuccessShift?.shift) return
    setGeneratingPdf(true)
    try {
      const { generateShiftReportPDF } = await import('../lib/shiftReport')
      await generateShiftReportPDF(closedSuccessShift.shift as any)
      show('✓ تم حفظ التقرير', 'success')
    } catch (e) { show('خطأ: ' + (e as Error).message, 'error') }
    finally { setGeneratingPdf(false) }
  }

  async function handleCloseSuccessModal() {
    setClosedSuccessShift(null)
    await loadActiveShift()
  }

  // ═══ v2.27.0 — تعديل خلية في صف من الجدول ═══
  function updateRow(localId: string, patch: Partial<DraftTx>) {
    setDrafts(prev => prev.map(d => {
      if (d.localId !== localId) return d
      const updated = { ...d, ...patch }
      // تحديث أسماء التصنيفات
      if (patch.mainCategoryId !== undefined) {
        updated.mainCategoryName = mainCats.find(c => c.id === patch.mainCategoryId)?.name ?? ''
        // عند تغيير التصنيف الرئيسي، صفّر الفرعي
        if (patch.mainCategoryId !== d.mainCategoryId) {
          updated.subCategoryId   = null
          updated.subCategoryName = ''
        }
      }
      if (patch.subCategoryId !== undefined) {
        updated.subCategoryName = subCats.find(s => s.id === patch.subCategoryId)?.name ?? ''
      }
      // وقت أول إدخال — يثبت عند ملء البيان لأول مرة
      if (patch.description !== undefined && !d.time && patch.description.trim()) {
        updated.time = nowTime()
      }
      return updated
    }))
  }

  function addRow() {
    setDrafts(prev => [...prev, emptyRow()])
  }

  function removeRow(localId: string) {
    setDrafts(prev => {
      const next = prev.filter(d => d.localId !== localId)
      // ضمان الحد الأدنى 10 صفوف
      while (next.length < DEFAULT_ROWS) next.push(emptyRow())
      return next
    })
  }

  // ═══ v2.27.0 (15-Jun) — wizard: تحقق فقط والانتقال (بدون حفظ في DB) ═══
  // البنود تبقى مؤقتة في المسودة حتى "حفظ وإغلاق" النهائي — يمكن التنقل والتعديل بحرية
  function handleSaveAndNext() {
    const filled = drafts.filter(d => !isRowEmpty(d))

    // تحقق: كل بند مملوء له بيان + (وارد أو منصرف)
    const invalid = filled.find(d => !d.description.trim() || (d.amountIn === 0 && d.amountOut === 0))
    if (invalid) {
      show(`بند غير صالح: "${invalid.description || '—'}" — راجع البيانات`, 'error')
      return
    }
    // تحقق: كل بند يحتاج عميل (آجل أو تحصيل)
    const missingCustomer = filled.find(d => isCustomerEnabled(d) && !d.customerId)
    if (missingCustomer) {
      const reason = missingCustomer.subCategoryName === 'مبيعات آجل' ? 'بيع آجل' : 'تحصيل'
      show(`⚠ بند "${missingCustomer.description}" (${reason}) يحتاج اختيار عميل`, 'error')
      return
    }
    // الانتقال للتبويب التالي — البيانات محفوظة مؤقتاً (localStorage)
    setTab('fawry')
  }

  // ═══ حفظ كل بنود المسودة في DB (يُستدعى عند الإغلاق النهائي فقط) ═══
  async function commitDrafts(): Promise<boolean> {
    if (!activeShift || !journal || !user) return false
    const filled = drafts.filter(d => !isRowEmpty(d))
    if (filled.length === 0) return true
    // حفظ دفعة واحدة (transaction واحدة) — أسرع بكثير من بنداً بنداً
    await addTransactionsBatch(filled.map(d => ({
      shiftId:        activeShift.id,
      journalId:      journal.id,
      description:    d.description,
      mainCategoryId: d.mainCategoryId,
      subCategoryId:  d.subCategoryId,
      amountIn:       d.amountIn,
      amountOut:      d.amountOut,
      payMethod:      d.payMethod,
      employeeId:     d.employeeId,
      customerId:     d.customerId,
      note:           d.note,
      createdBy:      user.id,
    })))
    clearDraft(activeShift.id)
    return true
  }

  // ═══ wizard: حفظ فوري والانتقال لإغلاق الشيفت مباشرة ═══
  async function handleSaveFawryAndNext() {
    await handleSaveFawry()
    setTab('close')
  }

  // شرط: الوارد نشط فقط للتحصيل أو مرتجع مشتريات
  function isAmountInEnabled(d: DraftTx): boolean {
    return d.mainCategoryName === 'تحصيل' || d.subCategoryName === 'مرتجع مشتريات'
  }

  // ═══ v2.27.0 — شرط تنشيط خلية العميل ═══
  // 1) طريقة الدفع = آجل (دين على العميل)
  // 2) أي بند تصنيفه الرئيسي = "تحصيل" (سداد من العميل)
  function isCustomerEnabled(d: DraftTx): boolean {
    return d.subCategoryName === 'مبيعات آجل' || d.mainCategoryName === 'تحصيل'
  }

  // ═══ v2.27.0 (15-Jun) — شرط تنشيط خلية الموظف ═══
  // فقط عند التصنيف الرئيسي "أجور" أو "راتب شهري"
  function isEmployeeEnabled(d: DraftTx): boolean {
    return d.mainCategoryName === 'أجور' || d.mainCategoryName === 'راتب شهري'
  }

  async function handleDeleteTx(id: number) {
    try {
      await deleteTransaction(id)
      setDeletingId(null)
      show('تم حذف البند', 'success')
    } catch (e) { show((e as Error).message, 'error') }
  }

  async function handleSaveFawry() {
    if (!activeShift) return
    try {
      await updateFawry(activeShift.id, {
        basicReceive:   parsePias(fawryForm.basicReceive),
        basicDeliver:   parsePias(fawryForm.basicDeliver),
        airReceive:     parsePias(fawryForm.airReceive),
        airDeliver:     parsePias(fawryForm.airDeliver),
        cashoutReceive: parsePias(fawryForm.cashoutReceive),
        cashoutDeliver: parsePias(fawryForm.cashoutDeliver),
        fawryToBasic:   parsePias(fawryForm.fawryToBasic),
        fawryToAir:     parsePias(fawryForm.fawryToAir),
        cashoutToBasic: parsePias(fawryForm.cashoutToBasic),
        cashoutToAir:   parsePias(fawryForm.cashoutToAir),
        programSales:   parsePias(fawryForm.programSales),
        firstVoucher:   parseInt(fawryForm.firstVoucher)  || 0,
        lastVoucher:    parseInt(fawryForm.lastVoucher)   || 0,
      })
      show('تم حفظ بيانات فوري ✓', 'success')
    } catch (e) { show((e as Error).message, 'error') }
  }

  const fawryResult   = fawry   ? calcFawry(fawry)     : null
  const custodyResult = custody  ? calcCustody(custody) : null

  // ═══ v2.27.0 (15-Jun) — البنود الحية: المحفوظة في DB + المسودة الحالية ═══
  // المسودة لا تُحفظ في DB حتى "حفظ وإغلاق" النهائي، لذا الحسابات تستخدم liveTxs
  const draftAsTxs = useMemo<Transaction[]>(() =>
    drafts.filter(d => !isRowEmpty(d)).map((d, i) => ({
      id:               -(i + 1),
      shiftId:          activeShift?.id ?? 0,
      journalId:        journal?.id ?? 0,
      time:             d.time,
      description:      d.description,
      mainCategoryId:   d.mainCategoryId,
      subCategoryId:    d.subCategoryId,
      mainCategoryName: d.mainCategoryName,
      subCategoryName:  d.subCategoryName,
      amountIn:         d.amountIn,
      amountOut:        d.amountOut,
      payMethod:        d.payMethod,
      employeeId:       d.employeeId,
      customerId:       d.customerId,
      note:             d.note,
      createdBy:        0,
      createdAt:        '',
    } as Transaction)),
    [drafts, activeShift, journal]
  )
  // الدمج: بنود DB (شيفت مُعاد فتحه) + المسودة الحالية
  const liveTxs = transactions.length > 0 ? [...transactions, ...draftAsTxs] : draftAsTxs
  const totalIn       = liveTxs.reduce((s, t) => s + t.amountIn,  0)
  const totalOut      = liveTxs.reduce((s, t) => s + t.amountOut, 0)

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

      {/* ADR-012 v2 — الرأس وشريط التبويبات محذوفان؛ ShiftSheet يملأ المساحة من الأعلى */}

      {/* ADR-012 — الورقة الموحّدة (تحلّ محل تبويبي اليومية وفوري) */}
      {(tab === 'daily' || tab === 'fawry') && (
        <div className="flex-1 overflow-hidden">
          <ShiftSheet shiftId={activeShift.id} embedded onChanged={() => refreshAll(activeShift.id)} />
        </div>
      )}

      {/* ===== مودال إغلاق الشيفت (مدمج مع العهدة) ===== */}
      {(() => {
        // حسابات الإغلاق
        // تحصيلات الكاشير = مجموع الوارد من بنود تصنيفها الرئيسي = "تحصيل"
        const cashierCollections = liveTxs
          .filter(t => t.mainCategoryName === 'تحصيل')
          .reduce((s, t) => s + t.amountIn, 0)
        // مدفوعات الإدارة (تذهب للعهدة) — تُستبعد من مصروفات الشيفت
        const managementOut = liveTxs
          .filter(t => t.payMethod === 'management')
          .reduce((s, t) => s + t.amountOut, 0)
        // مصروفات الشيفت = إجمالي المنصرف − مدفوعات الإدارة
        const shiftExpensesTotal = totalOut - managementOut

        // حالة الشيفت = مصروفات + نقدية الكاشير − مبيعات POS − التحصيل
        const posPias        = parsePias(posSales        || '0')
        const remainingPias  = parsePias(cashierRemaining || '0')
        const shiftResult    = shiftExpensesTotal + remainingPias - posPias - cashierCollections
        const shiftStatus    = shiftResult > 0 ? 'surplus' : shiftResult < 0 ? 'deficit' : 'balanced'
        const shiftStatusLbl = shiftStatus === 'deficit' ? 'عجز' : shiftStatus === 'surplus' ? 'أوفر' : 'متزن'
        const shiftStatusColor = shiftStatus === 'deficit' ? '#f85149' : shiftStatus === 'surplus' ? '#d29922' : '#2ea043'

        if (tab !== 'close' || activeShift.status !== 'open') return null

        // معلومات إضافية
        const addFrom         = parsePias(custodyForm.addFromFund || '0')
        const custodyRemain   = addFrom - managementOut
        const completionScore = (() => {
          let score = 0
          if (liveTxs.length > 0)             score += 25
          if (posPias > 0)                    score += 25
          if (remainingPias > 0 || liveTxs.length > 5) score += 25
          if (Math.abs(shiftResult) < 1000)   score += 25  // النتيجة معقولة
          return score
        })()
        const statusEmoji = shiftStatus === 'deficit' ? '⚠️' : shiftStatus === 'surplus' ? '⚡' : '⚖️'

        return (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-6xl mx-auto space-y-4">

              {/* ═══ الرأس ═══ */}
              <div className="flex items-center gap-2 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, rgba(239,68,68,0.20), rgba(220,38,38,0.10))',
                    border: '1.5px solid rgba(239,68,68,0.40)',
                    color: '#ef4444',
                    boxShadow: '0 4px 14px rgba(239,68,68,0.20)',
                  }}>
                  <Icons.Lock size={19} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--txt-1)' }}>
                    إغلاق وتسليم الشيفت
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                    المرحلة الأخيرة — راجع البيانات ثم أرسل للمراجعة والاعتماد
                  </div>
                </div>
                <span className="text-2xs px-2 py-0.5 rounded-md mr-auto" style={{
                  background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.25)',
                }}>الخطوة 3 من 3 — أخيرة</span>
              </div>

              {/* ═══ شريط التنبيه + Progress ═══ */}
              <div className="rounded-xl p-3 flex items-center gap-3"
                style={{
                  background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(245,158,11,0.04))',
                  border: '1px solid rgba(245,158,11,0.35)',
                }}>
                <div className="text-xl">📋</div>
                <div className="flex-1">
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>
                    قائمة مراجعة قبل الإرسال
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--txt-2)', marginTop: 2 }}>
                    تأكد من إدخال جميع البيانات بدقة — بعد الإرسال يحتاج اعتماد من المدير
                  </div>
                </div>
                {/* Progress Ring */}
                <div className="flex items-center gap-2">
                  <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>اكتمال البيانات:</div>
                  <div className="relative w-12 h-12 flex items-center justify-center">
                    <svg width="48" height="48" viewBox="0 0 48 48" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
                      <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,0.10)" strokeWidth="4" fill="none" />
                      <circle cx="24" cy="24" r="20"
                        stroke={completionScore >= 75 ? '#10b981' : completionScore >= 50 ? '#f59e0b' : '#ef4444'}
                        strokeWidth="4" fill="none"
                        strokeDasharray={`${(completionScore / 100) * 125.6} 125.6`}
                        strokeLinecap="round" />
                    </svg>
                    <span className="tabular-nums" style={{
                      fontSize: 11, fontWeight: 800,
                      color: completionScore >= 75 ? '#10b981' : completionScore >= 50 ? '#f59e0b' : '#ef4444',
                    }}>
                      {completionScore}%
                    </span>
                  </div>
                </div>
              </div>

              {/* ═══ بطاقات الإدخال (4 بطاقات: 2 يدوي + 2 تلقائي) ═══ */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* مبيعات POS — يدوي */}
                <div className="rounded-2xl p-4 relative overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(30,58,138,0.04))',
                    border: posPias > 0 ? '1.5px solid rgba(59,130,246,0.45)' : '1.5px dashed rgba(59,130,246,0.30)',
                  }}>
                  <div className="flex items-center justify-between mb-2">
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                      📟 مبيعات POS
                    </div>
                    <span className="text-2xs px-1.5 py-0.5 rounded-md font-bold"
                      style={{ background: 'rgba(59,130,246,0.20)', color: 'var(--accent)' }}>
                      يدوي
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginBottom: 6 }}>
                    من شاشة برنامج الكاشير
                  </div>
                  <input className="field text-sm tabular-nums font-bold" type="number" placeholder="0.00"
                    value={posSales} onChange={e => setPosSales(e.target.value)}
                    style={{ color: 'var(--accent)' }} />
                </div>

                {/* نقدية متبقية — يدوي */}
                <div className="rounded-2xl p-4 relative overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(34,197,94,0.10), rgba(34,197,94,0.03))',
                    border: remainingPias > 0 ? '1.5px solid rgba(34,197,94,0.45)' : '1.5px dashed rgba(34,197,94,0.30)',
                  }}>
                  <div className="flex items-center justify-between mb-2">
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>
                      💰 نقدية متبقية
                    </div>
                    <span className="text-2xs px-1.5 py-0.5 rounded-md font-bold"
                      style={{ background: 'rgba(34,197,94,0.20)', color: '#22c55e' }}>
                      يدوي
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginBottom: 6 }}>
                    عدّ النقدية في صندوق الكاشير
                  </div>
                  <input className="field text-sm tabular-nums font-bold" type="number" placeholder="0.00"
                    value={cashierRemaining} onChange={e => setCashierRemaining(e.target.value)}
                    style={{ color: '#22c55e' }} />
                </div>

                {/* تحصيلات الكاشير — تلقائي */}
                <div className="rounded-2xl p-4 relative overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(6,182,212,0.10), rgba(6,182,212,0.04))',
                    border: '1px solid rgba(6,182,212,0.35)',
                  }}>
                  <div className="flex items-center justify-between mb-2">
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#06b6d4' }}>
                      🧾 تحصيلات الكاشير
                    </div>
                    <span className="text-2xs px-1.5 py-0.5 rounded-md font-bold"
                      style={{ background: 'rgba(6,182,212,0.20)', color: '#06b6d4' }}>
                      تلقائي
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginBottom: 6 }}>
                    من بنود تصنيف "تحصيل"
                  </div>
                  <div className="tabular-nums font-bold"
                    style={{ fontSize: 22, color: '#06b6d4', lineHeight: 1.1 }}>
                    {fmt(cashierCollections)} <span style={{ fontSize: 11 }}>ج</span>
                  </div>
                </div>

                {/* مصروفات الشيفت — تلقائي */}
                <div className="rounded-2xl p-4 relative overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(239,68,68,0.04))',
                    border: '1px solid rgba(239,68,68,0.35)',
                  }}>
                  <div className="flex items-center justify-between mb-2">
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>
                      💸 مصروفات الشيفت
                    </div>
                    <span className="text-2xs px-1.5 py-0.5 rounded-md font-bold"
                      style={{ background: 'rgba(239,68,68,0.20)', color: '#ef4444' }}>
                      تلقائي
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--txt-3)', marginBottom: 6 }}>
                    إجمالي المنصرف − الإدارة
                  </div>
                  <div className="tabular-nums font-bold"
                    style={{ fontSize: 22, color: '#ef4444', lineHeight: 1.1 }}>
                    {fmt(shiftExpensesTotal)} <span style={{ fontSize: 11 }}>ج</span>
                  </div>
                </div>
              </div>

              {/* ═══ قسم العهدة — بطاقة بـ gradient ذهبي ═══ */}
              <div className="card p-0 overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))',
                  border: '1.5px solid rgba(245,158,11,0.35)',
                }}>
                <div className="px-4 py-2.5 flex items-center gap-2"
                  style={{ borderBottom: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.05)' }}>
                  <span style={{ fontSize: 16 }}>🔐</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>
                      حساب العهدة (الإدارة)
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--txt-3)' }}>
                      المبالغ المخصصة لخزينة الإدارة من النقدية
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-3 gap-3">
                    {/* إضافة من صندوق سابق */}
                    <div className="rounded-xl p-3"
                      style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span style={{ fontSize: 13 }}>📥</span>
                        <label className="font-bold" style={{ fontSize: 11, color: 'var(--txt-2)' }}>
                          إضافة من صندوق سابق
                        </label>
                      </div>
                      <input className="field text-sm tabular-nums font-bold" type="number" min={0}
                        value={custodyForm.addFromFund}
                        onChange={e => setCustodyForm(f => ({ ...f, addFromFund: e.target.value }))} />
                      <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 4 }}>
                        ↳ مبلغ يأتي للعهدة من خزينة سابقة
                      </div>
                    </div>
                    {/* إدارة محسوب — تلقائي */}
                    <div className="rounded-xl p-3"
                      style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.30)' }}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span style={{ fontSize: 13 }}>⚖️</span>
                        <label className="font-bold" style={{ fontSize: 11, color: '#f59e0b' }}>
                          إدارة محسوب (تلقائي)
                        </label>
                      </div>
                      <div className="rounded-lg px-3 py-2 tabular-nums font-bold flex items-center"
                        style={{
                          background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                          fontSize: 16, border: '1px solid rgba(245,158,11,0.30)',
                        }}>
                        {fmt(managementOut)} <span style={{ fontSize: 10, marginRight: 4 }}>ج</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 4 }}>
                        ↳ من بنود "خزينة الإدارة"
                      </div>
                    </div>
                    {/* باقي العهدة */}
                    <div className="rounded-xl p-3"
                      style={{
                        background: custodyRemain >= 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                        border: custodyRemain >= 0 ? '1.5px solid rgba(34,197,94,0.40)' : '1.5px solid rgba(239,68,68,0.40)',
                      }}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span style={{ fontSize: 13 }}>{custodyRemain >= 0 ? '✅' : '⚠️'}</span>
                        <label className="font-bold" style={{
                          fontSize: 11, color: custodyRemain >= 0 ? '#22c55e' : '#ef4444',
                        }}>
                          باقي العهدة
                        </label>
                      </div>
                      <div className="rounded-lg px-3 py-2 tabular-nums font-bold flex items-center"
                        style={{
                          color: custodyRemain >= 0 ? '#22c55e' : '#ef4444',
                          background: 'var(--inner-bg)',
                          fontSize: 16, border: '1px solid var(--inner-border)',
                        }}>
                        {fmt(custodyRemain)} <span style={{ fontSize: 10, marginRight: 4 }}>ج</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 4 }}>
                        ↳ الإضافة − المحسوب
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 p-2 rounded-lg text-2xs flex items-center gap-2"
                    style={{ background: 'var(--inner-bg)', color: 'var(--txt-3)' }}>
                    💡 <span><b>المعادلة:</b> باقي العهدة = إضافة من صندوق سابق − إدارة محسوب</span>
                  </div>
                </div>
              </div>

              {/* ═══ Hero — بطاقة نتيجة الشيفت الكبيرة ═══ */}
              <div className="card p-0 overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, ${shiftStatusColor}15, ${shiftStatusColor}05)`,
                  border: `2px solid ${shiftStatusColor}`,
                  boxShadow: `0 8px 32px ${shiftStatusColor}25`,
                }}>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-0">
                  {/* اليسار: تفاصيل المعادلة (3 أعمدة) */}
                  <div className="md:col-span-3 p-4" style={{ borderLeft: '1px solid var(--inner-border)' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span style={{ fontSize: 14 }}>📊</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>
                        تفاصيل حساب حالة الشيفت
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-2.5 rounded-lg"
                        style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-6 rounded-full" style={{ background: '#ef4444' }} />
                          <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>مصروفات الشيفت</span>
                        </div>
                        <span className="tabular-nums font-bold" style={{ color: '#ef4444', fontSize: 13 }}>
                          + {fmt(shiftExpensesTotal)} ج
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-2.5 rounded-lg"
                        style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-6 rounded-full" style={{ background: '#22c55e' }} />
                          <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>نقدية متبقية مع الكاشير</span>
                        </div>
                        <span className="tabular-nums font-bold" style={{ color: '#22c55e', fontSize: 13 }}>
                          + {fmt(remainingPias)} ج
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-2.5 rounded-lg"
                        style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-6 rounded-full" style={{ background: 'var(--accent)' }} />
                          <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>مبيعات البرنامج (POS)</span>
                        </div>
                        <span className="tabular-nums font-bold" style={{ color: 'var(--accent)', fontSize: 13 }}>
                          − {fmt(posPias)} ج
                        </span>
                      </div>
                      {cashierCollections > 0 && (
                        <div className="flex items-center justify-between p-2.5 rounded-lg"
                          style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-6 rounded-full" style={{ background: '#06b6d4' }} />
                            <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>التحصيلات</span>
                          </div>
                          <span className="tabular-nums font-bold" style={{ color: '#06b6d4', fontSize: 13 }}>
                            − {fmt(cashierCollections)} ج
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* اليمين: النتيجة الكبيرة (2 عمود) */}
                  <div className="md:col-span-2 p-4 flex flex-col items-center justify-center text-center relative"
                    style={{ background: `linear-gradient(135deg, ${shiftStatusColor}20, ${shiftStatusColor}08)` }}>
                    {/* glow */}
                    <div style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)', width: 180, height: 180,
                      borderRadius: '50%', background: shiftStatusColor,
                      opacity: 0.15, filter: 'blur(40px)',
                    }} />
                    <div className="relative z-10">
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt-2)', marginBottom: 4 }}>
                        نتيجة الشيفت
                      </div>
                      <div style={{ fontSize: 36 }}>{statusEmoji}</div>
                      <div className="tabular-nums" style={{
                        fontSize: 38, fontWeight: 900, color: shiftStatusColor, lineHeight: 1, marginTop: 4,
                      }}>
                        {fmt(Math.abs(shiftResult))}
                      </div>
                      <div style={{ fontSize: 12, color: shiftStatusColor, fontWeight: 700, marginTop: 2 }}>
                        ج
                      </div>
                      <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full font-bold"
                        style={{
                          background: shiftStatusColor + '25',
                          color: shiftStatusColor,
                          border: `1.5px solid ${shiftStatusColor}55`,
                          fontSize: 13,
                        }}>
                        {shiftStatusLbl}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--txt-3)', marginTop: 8, lineHeight: 1.6 }}>
                        {shiftStatus === 'surplus' && '💡 الكاشير سلّم أكثر من المتوقع'}
                        {shiftStatus === 'deficit' && '⚠ ينقص من الكاشير ' + fmt(Math.abs(shiftResult)) + ' ج'}
                        {shiftStatus === 'balanced' && '✓ الحسابات متوازنة تماماً'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ═══ ملخص سريع نهائي (3 إحصائيات) ═══ */}
              <div className="grid grid-cols-3 gap-3">
                <div className="card p-3 text-center">
                  <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 4 }}>
                    عدد البنود
                  </div>
                  <div className="tabular-nums font-bold" style={{ fontSize: 20, color: 'var(--accent)' }}>
                    {liveTxs.length}
                  </div>
                </div>
                <div className="card p-3 text-center">
                  <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 4 }}>
                    إجمالي الوارد
                  </div>
                  <div className="tabular-nums font-bold" style={{ fontSize: 20, color: '#22c55e' }}>
                    {fmt(totalIn)}
                  </div>
                </div>
                <div className="card p-3 text-center">
                  <div style={{ fontSize: 11, color: 'var(--txt-3)', marginBottom: 4 }}>
                    إجمالي المنصرف
                  </div>
                  <div className="tabular-nums font-bold" style={{ fontSize: 20, color: '#ef4444' }}>
                    {fmt(totalOut)}
                  </div>
                </div>
              </div>

              {/* شريط wizard السفلي — زر الإغلاق النهائي + تحذيرات */}
              <div className="space-y-3 pt-4"
                style={{ borderTop: '1px solid var(--inner-border)' }}>

                {/* تحذير عند العجز الكبير */}
                {shiftStatus === 'deficit' && Math.abs(shiftResult) > 5000 && (
                  <div className="rounded-xl p-3 flex items-center gap-3 animate-pulse"
                    style={{ background: 'rgba(239,68,68,0.10)', border: '1.5px solid #ef4444', color: '#ef4444' }}>
                    <span style={{ fontSize: 22 }}>🚨</span>
                    <div className="flex-1">
                      <div style={{ fontSize: 13, fontWeight: 800 }}>تنبيه: عجز كبير في الشيفت!</div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2 }}>
                        قيمة العجز ({fmt(Math.abs(shiftResult))} ج) تتجاوز 5,000 ج — راجع البيانات جيداً قبل الإرسال
                      </div>
                    </div>
                  </div>
                )}

                {/* الأزرار */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <button onClick={() => setTab('fawry')} className="btn-ghost btn-sm">
                    ← السابق (ماكينة فوري)
                  </button>

                  {/* تذكير سريع */}
                  <div className="flex items-center gap-2 text-2xs flex-wrap" style={{ color: 'var(--txt-3)' }}>
                    <span>📋 {liveTxs.length} بند</span>
                    <span>·</span>
                    <span>{statusEmoji} {shiftStatusLbl}</span>
                    <span>·</span>
                    <span>اكتمال {completionScore}%</span>
                  </div>

                  <button onClick={handleCloseShiftClick}
                    className="btn-danger-pro"
                    style={{
                      fontSize: 14, padding: '12px 30px', fontWeight: 800,
                      boxShadow: '0 6px 22px rgba(239,68,68,0.40)',
                    }}>
                    <Icons.Lock size={16} /> حفظ وإغلاق
                  </button>
                </div>
              </div>

            </div>
          </div>
        )
      })()}

      {/* ===== مودال تعديل بند ===== */}
      <Modal open={!!editingTx} title="تعديل بند — سبب إلزامي"
        onClose={() => { setEditingTx(null); setEditReason('') }}
        footer={<>
          <button onClick={() => { setEditingTx(null); setEditReason('') }} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleEditTx} disabled={savingEdit} className="btn-warning btn-sm">
            <Icons.Edit size={14} /> {savingEdit ? 'جاري التسجيل...' : 'تأكيد التعديل'}
          </button>
        </>}>
        {editingTx && (
          <div className="space-y-3">
            <div className="bg-surface-800 rounded-lg p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-surface-400">البيان:</span>
                <span className="text-white font-medium">{editingTx.description}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">وارد:</span>
                <span className="text-success tabular-nums">{fmt(editingTx.amountIn)} ج</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-400">منصرف:</span>
                <span className="text-danger tabular-nums">{fmt(editingTx.amountOut)} ج</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-surface-400 mb-1">سبب التعديل *</label>
              <input className="field" placeholder="أدخل سبب التعديل بوضوح..." value={editReason}
                autoFocus onChange={e => setEditReason(e.target.value)} />
            </div>
            <div className="text-2xs text-warning bg-warning/10 border border-warning/20 rounded-lg p-2">
              سيتم تسجيل هذا التعديل في سجل المراجعة مع اسمك والوقت.
            </div>
          </div>
        )}
      </Modal>

      {/* ===== مودال تأكيد الحذف ===== */}
      <Modal open={deletingId !== null} title="حذف البند" onClose={() => setDeletingId(null)} size="sm"
        footer={<>
          <button onClick={() => setDeletingId(null)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={() => deletingId && handleDeleteTx(deletingId)} className="btn-danger btn-sm">
            <Icons.Trash size={14} /> حذف
          </button>
        </>}>
        <p className="text-sm text-surface-300">هل تريد حذف هذا البند؟ لا يمكن التراجع عن هذه العملية.</p>
      </Modal>

      {/* ═══════ v2.27.0 (14-Jun) — مودال تعديل بند محفوظ ═══════ */}
      <Modal open={!!editSavedTx} title="تعديل بند محفوظ" onClose={() => setEditSavedTx(null)}
        footer={<>
          <button onClick={() => setEditSavedTx(null)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSaveEditedTx} disabled={savingEditSaved} className="btn-success-pro btn-sm">
            {savingEditSaved
              ? <><Icons.Refresh size={14} className="animate-spin" /> جاري الحفظ...</>
              : <><Icons.Check size={14} /> حفظ التعديل</>
            }
          </button>
        </>}>
        {editSavedTx && (
          <div className="space-y-3">
            {/* البيان */}
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>البيان *</label>
              <input className="field" value={editSavedForm.description}
                onChange={e => setEditSavedForm(f => ({ ...f, description: e.target.value }))} autoFocus />
            </div>
            {/* التصنيف */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>التصنيف الرئيسي</label>
                <select className="field" value={editSavedForm.mainCategoryId ?? ''}
                  onChange={e => setEditSavedForm(f => ({
                    ...f, mainCategoryId: e.target.value ? +e.target.value : null, subCategoryId: null,
                  }))}>
                  <option value="">—</option>
                  {mainCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>التصنيف الفرعي</label>
                <select className="field" value={editSavedForm.subCategoryId ?? ''}
                  disabled={!editSavedForm.mainCategoryId}
                  onChange={e => setEditSavedForm(f => ({ ...f, subCategoryId: e.target.value ? +e.target.value : null }))}>
                  <option value="">—</option>
                  {subCats.filter(s => s.mainCategoryId === editSavedForm.mainCategoryId)
                    .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            {/* المبالغ */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs mb-1" style={{ color: '#22c55e' }}>وارد (ج)</label>
                <input className="field tabular-nums" type="number" min={0} value={editSavedForm.amountIn}
                  onChange={e => setEditSavedForm(f => ({ ...f, amountIn: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: '#ef4444' }}>منصرف (ج)</label>
                <input className="field tabular-nums" type="number" min={0} value={editSavedForm.amountOut}
                  onChange={e => setEditSavedForm(f => ({ ...f, amountOut: e.target.value }))} />
              </div>
            </div>
            {/* طريقة الدفع */}
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>طريقة الدفع</label>
              <div className="grid grid-cols-4 gap-1">
                {(Object.keys(PAY_LABELS) as PayMethod[]).map(pm => (
                  <button key={pm} type="button"
                    onClick={() => setEditSavedForm(f => ({ ...f, payMethod: pm }))}
                    className="py-2 rounded-lg text-2xs font-bold transition-all border"
                    style={editSavedForm.payMethod === pm
                      ? { background: 'rgba(59,130,246,0.2)', borderColor: 'var(--accent)', color: 'var(--accent)' }
                      : { background: 'var(--inner-bg)', borderColor: 'var(--inner-border)', color: 'var(--txt-2)' }}>
                    {PAY_LABELS[pm]}
                  </button>
                ))}
              </div>
            </div>
            {/* العميل (مشروط) */}
            <div>
              <label className="block text-xs mb-1" style={{ color: editCustomerEnabled ? '#06b6d4' : 'var(--txt-3)' }}>
                اسم العميل {editCustomerEnabled && <span style={{ color: '#ef4444' }}>*</span>}
              </label>
              <select className="field" value={editSavedForm.customerId ?? ''}
                disabled={!editCustomerEnabled}
                onChange={e => setEditSavedForm(f => ({ ...f, customerId: e.target.value ? +e.target.value : null }))}
                style={{ opacity: editCustomerEnabled ? 1 : 0.45 }}>
                <option value="">{editCustomerEnabled ? '— اختر —' : '🔒 (للآجل أو التحصيل فقط)'}</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {/* الموظف */}
            {employees.length > 0 && (
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>موظف (اختياري)</label>
                <select className="field" value={editSavedForm.employeeId ?? ''}
                  onChange={e => setEditSavedForm(f => ({ ...f, employeeId: e.target.value ? +e.target.value : null }))}>
                  <option value="">—</option>
                  {employees.map(em => <option key={em.id} value={em.id}>{em.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ═══════ v2.27.0 (14-Jun) — مودال حذف بند محفوظ ═══════ */}
      <Modal open={deletingSavedId !== null} title="حذف البند المحفوظ" onClose={() => setDeletingSavedId(null)} size="sm"
        footer={<>
          <button onClick={() => setDeletingSavedId(null)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={() => deletingSavedId && handleDeleteSavedTx(deletingSavedId)} className="btn-danger-pro btn-sm">
            <Icons.Trash size={14} /> حذف نهائي
          </button>
        </>}>
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          هل تريد حذف هذا البند من الشيفت؟ لا يمكن التراجع عن هذه العملية.
        </p>
      </Modal>

      {/* ═══════ v2.27.0 (14-Jun) — Modal تحذير البنود الناقصة ═══════ */}
      {missingItemsWarning && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}>
          <div className="card flex flex-col p-6"
            style={{
              maxWidth: 520, border: '2px solid #f59e0b',
              boxShadow: '0 20px 60px rgba(245,158,11,0.40)',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))',
            }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  boxShadow: '0 6px 20px rgba(245,158,11,0.45)',
                }}>
                <span style={{ fontSize: 26, color: 'white' }}>⚠️</span>
              </div>
              <div>
                <div className="font-black text-xl" style={{ color: '#f59e0b' }}>
                  بنود ناقصة في الشيفت
                </div>
                <div className="text-xs" style={{ color: 'var(--txt-3)' }}>
                  بعض البيانات لم تُعبأ — راجعها قبل الإغلاق النهائي
                </div>
              </div>
            </div>
            <div className="rounded-xl p-3 mb-4" style={{
              background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.30)',
            }}>
              <div className="font-bold text-sm mb-2" style={{ color: '#92400e' }}>
                البنود التي يجب مراجعتها:
              </div>
              <ul className="space-y-1.5">
                {missingItemsWarning.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span style={{ color: '#f59e0b' }}>●</span>
                    <span style={{ color: 'var(--txt-1)', fontWeight: 600 }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button onClick={() => setMissingItemsWarning(null)}
                className="btn-ghost btn-sm">
                ← رجوع للتعديل
              </button>
              <button
                onClick={async () => {
                  setMissingItemsWarning(null)
                  await handleCloseShift()
                }}
                className="btn-danger-pro"
                style={{ fontSize: 13, padding: '9px 22px' }}>
                <Icons.Lock size={14} /> المتابعة على أي حال
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ v2.27.0 — Modal النجاح بعد إغلاق الشيفت ═══════ */}
      {closedSuccessShift && closedSuccessShift.shift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <div className="card flex flex-col items-center text-center p-8"
            style={{
              maxWidth: 500, border: '2px solid #10b981',
              boxShadow: '0 20px 60px rgba(16,185,129,0.45)',
              background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(16,185,129,0.04))',
            }}>
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)',
                boxShadow: '0 8px 30px rgba(16,185,129,0.5)',
              }}>
              <span style={{ fontSize: 40, color: 'white' }}>✓</span>
            </div>
            <div className="font-black text-2xl mb-2" style={{ color: '#10b981' }}>
              تم حفظ وإغلاق الشيفت بنجاح
            </div>
            <div className="text-sm mb-5" style={{ color: 'var(--txt-2)' }}>
              شيفت <b>#{closedSuccessShift.shift.monthlyShiftNum}</b> أُغلق رسمياً وحُفظ في سجل اليوميات
            </div>
            {/* ملخص */}
            <div className="w-full space-y-2 mb-5 p-3 rounded-lg" style={{
              background: 'var(--inner-bg)', border: '1px solid var(--inner-border)',
            }}>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--txt-3)' }}>الشيفت:</span>
                <span className="font-bold" style={{ color: 'var(--txt-1)' }}>
                  #{closedSuccessShift.shift.monthlyShiftNum} — {closedSuccessShift.shift.cashierName}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--txt-3)' }}>إجمالي الوارد:</span>
                <span className="tabular-nums font-bold" style={{ color: '#22c55e' }}>
                  {fmt(closedSuccessShift.in)} ج
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--txt-3)' }}>إجمالي المنصرف:</span>
                <span className="tabular-nums font-bold" style={{ color: '#ef4444' }}>
                  {fmt(closedSuccessShift.out)} ج
                </span>
              </div>
              <div className="flex justify-between text-xs pt-1.5 mt-1.5"
                style={{ borderTop: '1px solid var(--inner-border)' }}>
                <span style={{ color: 'var(--txt-3)' }}>نتيجة الشيفت:</span>
                <span className="tabular-nums font-bold"
                  style={{ color: closedSuccessShift.result > 0 ? '#10b981' : closedSuccessShift.result < 0 ? '#ef4444' : '#f59e0b' }}>
                  {closedSuccessShift.result > 0 ? 'أوفر' : closedSuccessShift.result < 0 ? 'عجز' : 'متزن'}
                  {' '}({fmt(Math.abs(closedSuccessShift.result))} ج)
                </span>
              </div>
            </div>
            {/* الأزرار */}
            <div className="flex items-center gap-2 w-full justify-center flex-wrap">
              <button onClick={handleCloseSuccessModal} className="btn-success-pro"
                style={{ fontSize: 14, padding: '10px 28px' }}>
                ممتاز ✓
              </button>
              <button onClick={handleGenerateReport} disabled={generatingPdf}
                className="btn-next"
                style={{ fontSize: 14, padding: '10px 22px' }}>
                {generatingPdf
                  ? <><Icons.Refresh size={14} className="animate-spin" /> جاري التوليد...</>
                  : <>📄 إرسال تقرير اليومية</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
