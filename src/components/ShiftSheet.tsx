import { useEffect, useMemo, useRef, useState } from 'react'
import { api, call } from '../lib/api'
import { fmt, parsePias } from '../lib/format'
import { useToast } from '../store/toast'
import { useAuth } from '../store/auth'
import { useFloatingWindows } from '../store/floatingWindows'
import { calcFawry, calcCustody, calcShiftClosing } from '../../core/engine'
import { generateShiftReportPDF } from '../lib/shiftReport'
import type {
  Shift, Journal, Transaction, ShiftFawry, ShiftCustody,
  MainCategory, SubCategory, PayMethod, Employee,
} from '../../core/types'

/**
 * ShiftSheet — مساحة العمل اليومية الموحّدة (ADR-012 v2).
 * يومية كبيرة (Excel-like) + فوري بترتيب القالب المرجعي + ملخّص إغلاق (6 بطاقات) + شريط أدوات موحّد.
 * لا تعرف حيّ أم تاريخي — تحمّل بـ shiftId. كل معادلات محرّك الهايبر (core/engine) بلا أي تغيير.
 * الحقول الجديدة (كاش أوت: إضافة/خصم) خام يدوية فقط — لا تُغذّي أي معادلة في المحرّك.
 */

const fmt0 = (pias: number) => (pias / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
// طرق الدفع — نوعان فقط (كاشير/إدارة). آجل/فيزا يُتتبَّعان بالتصنيف الفرعي.
const PAY: Record<PayMethod, string> = { cashier: 'كاشير', management: 'إدارة' }
const PAY_OPTIONS: PayMethod[] = ['cashier', 'management']
const DEFAULT_ROWS = 14

interface Props { shiftId: number; onClose?: () => void; onDeleted?: () => void; onChanged?: () => void; embedded?: boolean }

// v2.34.18 — payMethod يقبل '' (لا شيء) شكليًا فقط في المسودة — نفس مبدأ "—" في التصنيف الرئيسي/الفرعي، بلا حفظ فعلي بلا اختيار
interface TxDraft { description: string; amount: string; mainCategoryId: number; subCategoryId: number; payMethod: PayMethod | ''; direction: 'in' | 'out'; employeeId: number }
const emptyDraft: TxDraft = { description: '', amount: '', mainCategoryId: 0, subCategoryId: 0, payMethod: '', direction: 'out', employeeId: 0 }
const G = { edit: '#22c55e', fawry: '#a78bfa', sum: '#fbbf24', warn: '#f87171' }
const rows = (n: number) => Array.from({ length: Math.max(0, n) }, () => ({ ...emptyDraft }))
// v2.34.14 — عدّاد فلوس مصري + آلة حاسبة (أداة مساعدة منقولة من مسودة حسابات)
const MONEY_DENOMS = [200, 100, 50, 20, 10, 5]
const CALC_KEYS = [['7', '8', '9', '/'], ['4', '5', '6', '*'], ['1', '2', '3', '-'], ['0', '.', '⌫', '+']]

export default function ShiftSheet({ shiftId, onClose, onDeleted, onChanged, embedded }: Props) {
  const toast = useToast()
  const { user } = useAuth()
  const { open: openWindow } = useFloatingWindows()
  const [shift, setShift] = useState<Shift | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [journal, setJournal] = useState<Journal | null>(null)
  const [txs, setTxs] = useState<Transaction[]>([])
  const [fawry, setFawry] = useState<ShiftFawry | null>(null)
  const [custody, setCustody] = useState<ShiftCustody | null>(null)
  const [mains, setMains] = useState<MainCategory[]>([])
  const [subs, setSubs] = useState<SubCategory[]>([])
  const [employees, setEmployees] = useState<Employee[]>([]) // v2.34.11 — الموظفون النشطون فقط، لربط بنود "سلفة موظف" بموظف محدَّد
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState<TxDraft>(emptyDraft)
  const [drafts, setDrafts] = useState<TxDraft[]>([])
  const [fundPos, setFundPos] = useState<{ before: number; cashIn: number; mgmtOut: number; after: number } | null>(null)
  const [closeDlg, setCloseDlg] = useState(false)
  // بطلب العميل — منع اعتماد الشيفت لو فيه بيانات ناقصة، بدل السماح بالتجاوز
  const [missingItems, setMissingItems] = useState<string[] | null>(null)
  // v2.34.10 — فصل بصري فقط: تبويب فرعي (ماكينة فوري + ملخّص الشيفت) منفصل عن العمليات اليومية لإتاحة مساحة أوسع لتسجيل القيود
  // لا علاقة له بأي منطق حساب أو استيراد — مجرد إخفاء/إظهار عمودين من الشبكة الحالية بنفس المقاسات
  const [subView, setSubView] = useState<'daily' | 'fawry'>('daily')
  // v2.34.14 — عدّاد فلوس مصري + آلة حاسبة (منقولان من صفحة "مسودة حسابات") — أداة مساعدة، لا علاقة لها بأي حساب أو حفظ رسمي
  const [moneyDenoms, setMoneyDenoms] = useState<Record<number, string>>(() => {
    try { return JSON.parse(localStorage.getItem('aj.shiftMoneyCounter.v1') || '{}') } catch { return {} }
  })
  useEffect(() => { try { localStorage.setItem('aj.shiftMoneyCounter.v1', JSON.stringify(moneyDenoms)) } catch { /* */ } }, [moneyDenoms])
  // إخفاء العدّاد/الآلة الحاسبة وعرض شرح استخدام الشاشة بدلاً منهما — تفضيل شخصي محفوظ محلياً
  const [showMoneyTools, setShowMoneyTools] = useState(() => {
    try { return localStorage.getItem('aj.shiftMoneyTools.visible') !== '0' } catch { return true }
  })
  useEffect(() => { try { localStorage.setItem('aj.shiftMoneyTools.visible', showMoneyTools ? '1' : '0') } catch { /* */ } }, [showMoneyTools])
  const [calcExpr, setCalcExpr] = useState('')
  const [calcResult, setCalcResult] = useState<string | null>(null)
  const draftsInitRef = useRef<number | null>(null) // ADR-012 v2 — يمنع تكرار ملء الصفوف الافتراضية عند كل تحميل

  async function load() {
    const [sh, jr, t, f, c, m, s, emp] = await Promise.all([
      call<Shift | null>(api.shifts.getById(shiftId)),
      call<Journal | null>(api.journal.getByShift(shiftId)),
      call<Transaction[]>(api.tx.getByShift(shiftId)),
      call<ShiftFawry | null>(api.fawry.get(shiftId)),
      call<ShiftCustody | null>(api.custody.get(shiftId)),
      call<MainCategory[]>(api.cats.getMain()),
      call<SubCategory[]>(api.cats.getSub()),
      call<Employee[]>(api.emp.getActive()),
    ])
    setShift(sh); setJournal(jr); setTxs(t); setFawry(f); setCustody(c); setMains(m); setSubs(s); setEmployees(emp)
    // ADR-012 v2 — الصفوف الافتراضية (14) تُملأ بالمستورَد/المحفوظ؛ لا تُنشأ صفوف زائدة تلقائياً
    if (draftsInitRef.current !== shiftId) {
      setDrafts(rows(DEFAULT_ROWS - t.length))
      draftsInitRef.current = shiftId
    }
    // v2.33.0 — موضع الشيفت على خط رصيد الصندوق (نقاط الارتكاز) — للتحقّق، غير قابل للتعديل يدوياً
    call<typeof fundPos>(api.treasury.shiftPosition(shiftId)).then(setFundPos).catch(() => setFundPos(null))
  }
  useEffect(() => { load().catch(e => toast.show((e as Error).message, 'error')) }, [shiftId])

  // v2.33.0 — تحديث قوائم التصنيفات تلقائياً بعد إضافة/تعديل من نافذة "إدارة التصنيفات" الطافية
  useEffect(() => {
    const h = () => {
      Promise.all([call<MainCategory[]>(api.cats.getMain()), call<SubCategory[]>(api.cats.getSub())])
        .then(([m, s]) => { setMains(m); setSubs(s) })
        .catch(() => {})
    }
    window.addEventListener('categories:changed', h)
    return () => window.removeEventListener('categories:changed', h)
  }, [])

  const fawryRes = useMemo(() => fawry ? calcFawry(fawry) : null, [fawry])
  // بطلب العميل: "عهدة منصرفة" تُحسب تلقائيًا (تجميع كل بنود الشيفت بخلية الدفع "إدارة") — نفس القيمة تُستخدم أيضًا في "مصروفات الصندوق" و"عهدة متبقية" فتبقى الثلاثة متطابقة دومًا
  // ملاحظة: هذا الحساب مكرَّر عمداً هنا (بدل استخدام dSum/filledDrafts المعرَّفتين أسفل بعد حارس "if (!shift) return") —
  // useMemo/useEffect يجب أن يُستدعَيا قبل أي return شرطي مهما كان الأمر (قاعدة الـHooks)، فلا يصح نقلهما لأسفل
  const mgmtOut = txs.filter(t => t.payMethod === 'management').reduce((s, t) => s + t.amountOut, 0)
    + drafts.filter(d => d.description.trim() && d.amount && d.payMethod === 'management').reduce((s, d) => s + parsePias(d.amount), 0) // شامل المسودة، للعرض الفوري
  // نُخزّن فقط إجمالي البنود المحفوظة فعليًا (بلا المسودة) في shift_custody.management_paid — لتقارير خارج هذه الشاشة (لوحة التحكم/PDF)، بلا كتابة على كل ضغطة مفتاح في مسودة لسه غير محفوظة
  const mgmtOutSaved = txs.filter(t => t.payMethod === 'management').reduce((s, t) => s + t.amountOut, 0)
  const custodyRes = useMemo(() => custody ? calcCustody({ ...custody, managementPaid: mgmtOut }) : null, [custody, mgmtOut])
  useEffect(() => {
    if (custody && custody.managementPaid !== mgmtOutSaved) saveCustody('managementPaid', String(mgmtOutSaved / 100))
  }, [mgmtOutSaved, custody?.managementPaid])

  async function saveFawry(field: keyof ShiftFawry, egp: string) {
    if (!fawry) return
    const val = parsePias(egp)
    try {
      await call(api.fawry.update(shiftId, { [field]: val }))
      setFawry({ ...fawry, [field]: val })
      onChanged?.()
    }
    catch (e) { toast.show((e as Error).message, 'error') }
  }
  // v2.34.17 — أول/آخر بون أرقام عمليات صحيحة (مش مبالغ) — بلا أي ضرب/قسمة ×100 خلافًا لباقي حقول فوري
  async function saveVoucher(field: 'firstVoucher' | 'lastVoucher', raw: string) {
    if (!fawry) return
    const val = parseInt(raw, 10) || 0
    try {
      await call(api.fawry.update(shiftId, { [field]: val }))
      setFawry({ ...fawry, [field]: val })
      onChanged?.()
    }
    catch (e) { toast.show((e as Error).message, 'error') }
  }
  async function saveCustody(field: 'addFromFund' | 'managementPaid', egp: string) {
    if (!custody) return
    const val = parsePias(egp)
    try { await call(api.custody.update(shiftId, { [field]: val })); setCustody({ ...custody, [field]: val }); onChanged?.() }
    catch (e) { toast.show((e as Error).message, 'error') }
  }
  async function saveClose(field: 'posSales' | 'cashierRemaining', egp: string) {
    if (!shift) return
    const val = parsePias(egp)
    const posSales = field === 'posSales' ? val : shift.posSales
    const cashierRemaining = field === 'cashierRemaining' ? val : shift.cashierRemaining
    try { await call(api.shifts.updateCloseInputs(shiftId, { posSales, cashierRemaining })); await load(); onChanged?.() }
    catch (e) { toast.show((e as Error).message, 'error') }
  }
  async function saveMeta(data: { date?: string; type?: 'morning' | 'evening' | 'between'; cashierName?: string }) {
    try { await call(api.shifts.updateMeta(shiftId, data)); await load(); onChanged?.() }
    catch (e) { toast.show((e as Error).message, 'error') }
  }
  async function saveNote(note: string) {
    try { await call(api.shifts.updateNote(shiftId, note)); onChanged?.() }
    catch (e) { toast.show((e as Error).message, 'error') }
  }
  // بطلب العميل — فحص اكتمال البيانات قبل الاعتماد: بنود اليومية + ماكينة فوري + ملخّص الشيفت
  function checkMissingItems(): string[] {
    const missing: string[] = []

    // بنود اليومية
    const hasAnyItem = txs.length > 0 || filledDrafts.length > 0
    if (!hasAnyItem) missing.push('بنود اليومية — لم يُسجَّل أي بند بعد (تبويب البنود اليومية)')
    const partial = drafts.find(d =>
      (d.description.trim() || d.amount) &&
      !(d.description.trim() && d.amount && d.mainCategoryId && d.payMethod)
    )
    if (partial) missing.push(`بند غير مكتمل في اليومية: "${partial.description || '—'}" — أكمِل البيان/المبلغ/التصنيف/طريقة الدفع أو امسحه (تبويب البنود اليومية)`)

    // ماكينة فوري
    const fawryBaseFilled = (fawry?.basicReceive ?? 0) > 0 || (fawry?.basicDeliver ?? 0) > 0
      || (fawry?.airReceive ?? 0) > 0 || (fawry?.airDeliver ?? 0) > 0
      || (fawry?.cashoutReceive ?? 0) > 0 || (fawry?.cashoutDeliver ?? 0) > 0
    if (!fawryBaseFilled) missing.push('بيانات ماكينة فوري — لم تُدخَل أي قراءة استلام/تسليم بعد (تبويب ماكينة فوري)')
    else if (basicAirSum > 0 && fawryWithCommission === 0) missing.push('"مبيعات فوري + الربحية" لم تُدخَل بعد (تبويب ماكينة فوري)')

    // ملخّص الشيفت
    if ((shift?.posSales ?? 0) === 0) missing.push('"مبيعات POS" لم تُدخَل بعد (ملخّص الشيفت)')
    if ((shift?.cashierRemaining ?? 0) === 0) missing.push('"نقدية الكاشير" المتبقية لم تُدخَل بعد (ملخّص الشيفت)')
    // بطلب العميل — "عهدة مستلمة" هي المبلغ المُسلَّم لمسؤول المشتريات أثناء الشيفت، ولازم تُسجَّل دائمًا
    // لمطابقتها لاحقًا مع "عهدة منصرفة" (بنود الدفع "إدارة") فتُعرف "عهدة متبقية" معه بدقة
    if ((custody?.addFromFund ?? 0) === 0) missing.push('"عهدة مستلمة" لم تُدخَل بعد — المبلغ المُسلَّم لمسؤول المشتريات (جزء العهدة)')

    return missing
  }

  async function approveShift() {
    if (!user) return
    const missing = checkMissingItems()
    if (missing.length > 0) { setMissingItems(missing); return }
    if (!confirm('اعتماد وإغلاق الشيفت؟ (البيانات محفوظة بالفعل)')) return
    try { await call(api.shifts.updateStatus(shiftId, 'approved', user.id)); await load(); onChanged?.(); toast.show('تم اعتماد الشيفت', 'success') }
    catch (e) { toast.show((e as Error).message, 'error') }
  }

  async function delTx(id: number) {
    try { await call(api.tx.delete(id)); setTxs(t => t.filter(x => x.id !== id)); onChanged?.() }
    catch (e) { toast.show((e as Error).message, 'error') }
  }
  function startEdit(t: Transaction) {
    setEditId(t.id)
    setDraft({ description: t.description, amount: String((t.amountIn || t.amountOut) / 100), mainCategoryId: t.mainCategoryId ?? 0, subCategoryId: t.subCategoryId ?? 0, payMethod: t.payMethod, direction: t.amountIn > 0 ? 'in' : 'out', employeeId: t.employeeId ?? 0 })
  }
  async function saveEdit() {
    if (editId == null) return
    if (!draft.payMethod) { toast.show('برجاء اختيار طريقة الدفع', 'error'); return }
    const amt = parsePias(draft.amount)
    try {
      const eIn = (draft.mainCategoryId === (mains.find(m => m.name === 'تحصيل')?.id ?? -1))
      const employeeId = isAdvanceRow(draft.mainCategoryId, draft.subCategoryId) ? (draft.employeeId || null) : null
      await call(api.tx.update(editId, { description: draft.description, mainCategoryId: draft.mainCategoryId || null, subCategoryId: draft.subCategoryId || null, payMethod: draft.payMethod, employeeId, amountIn: eIn ? amt : 0, amountOut: eIn ? 0 : amt }))
      setEditId(null); await load(); onChanged?.()
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  function setDraftRow(i: number, patch: Partial<TxDraft>) { setDrafts(ds => ds.map((d, idx) => idx === i ? { ...d, ...patch } : d)) }

  // v2.34.16 — لصق عمود كامل من إكسيل: تحديد أول خلية فقط (بيان أو قيمة) ولصق (Ctrl+V) يوزّع الأسطر تلقائيًا لتحت في الصفوف التالية
  // بيوسّع صفوف المسودة تلقائيًا لو عدد الأسطر الملصوقة أكبر من الصفوف المتاحة — بلا أي تأثير على شكل القسم أو استيراد الإكسيل الرسمي
  function handleColumnPaste(i: number, field: 'amount' | 'description', e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text')
    const lines = text.split(/\r\n|\r|\n/)
    while (lines.length && lines[lines.length - 1] === '') lines.pop() // آخر سطر فاضي شائع عند نسخ عمود من إكسيل
    if (lines.length <= 1) return // لصق عادي لخلية واحدة — نسيبه للسلوك الافتراضي
    e.preventDefault()
    setDrafts(ds => {
      const next = [...ds]
      while (next.length < i + lines.length) next.push({ ...emptyDraft })
      lines.forEach((line, idx) => {
        const val = field === 'amount' ? line.replace(/[,\s]/g, '') : line.trim()
        next[i + idx] = { ...next[i + idx], [field]: val }
      })
      return next
    })
  }

  // v2.34.3 — تخمين تلقائي للتصنيف بناءً على بيانات مُدخلة سابقاً (يتعلّم من كل بند يُحفظ عبر smart_labels)
  const suggestTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => () => { suggestTimers.current.forEach(t => clearTimeout(t)) }, [])
  function handleDescInput(i: number, val: string) {
    setDraftRow(i, { description: val })
    const existing = suggestTimers.current.get(i)
    if (existing) clearTimeout(existing)
    // v2.34.11 — تخمين اسم الموظف من البيان (مثلاً "سلفة أحمد محمد") — مطابقة نصية على الموظفين النشطين، بلا أي نداء خادم
    // لو مطابقة واحدة بالضبط يتحدَّد الموظف تلقائيًا؛ أكتر من مطابقة أو صفر مطابقة تُترَك للمستخدم يختار يدويًا
    const nameMatches = employees.filter(e => val.includes(e.name))
    if (nameMatches.length === 1) {
      setDrafts(ds => ds.map((d, idx) => idx === i ? { ...d, employeeId: nameMatches[0].id } : d))
    }
    if (val.trim().length < 2) return
    suggestTimers.current.set(i, setTimeout(async () => {
      try {
        const s = await call(api.tx.suggest(val)) as { mainCategoryId: number; subCategoryId: number | null } | null
        if (!s) return
        let applied = false
        setDrafts(ds => ds.map((d, idx) => {
          if (idx !== i || d.mainCategoryId || d.description !== val) return d
          applied = true
          return { ...d, mainCategoryId: s.mainCategoryId, subCategoryId: s.subCategoryId ?? 0 }
        }))
        if (applied) toast.show('✨ تم اقتراح التصنيف تلقائياً بناءً على بيانات سابقة', 'info')
      } catch { /* silent */ }
    }, 450))
  }

  async function commitDrafts() {
    if (!journal) return
    // v2.34.18 — بند بدون طريقة دفع مُختارة يُعامَل كغير مكتمل (لا يُحفظ) تمامًا كبند بدون بيان/قيمة
    const filled = drafts.filter(d => d.description.trim() && d.amount && d.payMethod)
    const missingPay = drafts.filter(d => d.description.trim() && d.amount && !d.payMethod)
    if (!filled.length) {
      toast.show(missingPay.length ? 'برجاء اختيار طريقة الدفع للبنود قبل الحفظ' : 'لا توجد بنود مملوءة للحفظ', missingPay.length ? 'error' : 'info')
      return
    }
    try {
      const collectId = mains.find(m => m.name === 'تحصيل')?.id ?? -1
      await call(api.tx.addBatch(filled.map(d => ({
        shiftId, journalId: journal.id, description: d.description,
        mainCategoryId: d.mainCategoryId || null, subCategoryId: d.subCategoryId || null,
        amountIn: d.mainCategoryId === collectId ? parsePias(d.amount) : 0, amountOut: d.mainCategoryId === collectId ? 0 : parsePias(d.amount),
        payMethod: d.payMethod, employeeId: isAdvanceRow(d.mainCategoryId, d.subCategoryId) ? (d.employeeId || null) : null, customerId: null, note: '', createdBy: user?.id ?? 1,
      }))))
      // ADR-012 v2 — بعد الحفظ: أعِد صفوفاً فارغة فقط حتى إجمالي 14 (لا تُنشئ صفوفاً إضافية تلقائياً)
      const newTotal = txs.length + filled.length
      setDrafts(rows(DEFAULT_ROWS - newTotal))
      await load(); onChanged?.()
      toast.show(missingPay.length ? `حُفظ ${filled.length} بند — و${missingPay.length} بند لم يُحفظ لعدم اختيار طريقة الدفع` : `حُفظ ${filled.length} بند`, missingPay.length ? 'info' : 'success')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  function dupLast() {
    const last = txs[txs.length - 1]; if (!last) { toast.show('لا يوجد بند لتكراره', 'info'); return }
    const nd: TxDraft = { description: last.description, amount: String((last.amountIn || last.amountOut) / 100), mainCategoryId: last.mainCategoryId ?? 0, subCategoryId: last.subCategoryId ?? 0, payMethod: last.payMethod, direction: last.amountIn > 0 ? 'in' : 'out', employeeId: last.employeeId ?? 0 }
    setDrafts(ds => { const idx = ds.findIndex(d => !d.description && !d.amount); if (idx >= 0) { const c = [...ds]; c[idx] = nd; return c } return [...ds, nd] })
  }
  // v2.34.29 — "تصدير" كان مجرد نص "قريباً" بلا وظيفة فعلية؛ ربطه بمولّد تقرير PDF الفعلي (صفحتان: بنود + ملخّص)
  async function exportPDF() {
    if (!shift || pdfBusy) return
    setPdfBusy(true)
    try { await generateShiftReportPDF(shift) }
    catch (e) { toast.show((e as Error).message, 'error') }
    finally { setPdfBusy(false) }
  }
  async function delShift() {
    if (!confirm('حذف الشيفت وكل بياناته نهائياً؟')) return
    try { await call(api.shifts.delete(shiftId)); toast.show('حُذف الشيفت', 'success'); onDeleted?.(); onClose?.() }
    catch (e) { toast.show((e as Error).message, 'error') }
  }

  // آلة حاسبة (تقييم آمن — أرقام وعمليات حسابية فقط) — أداة مساعدة، لا علاقة لها بأي حساب رسمي
  function pressCalc(key: string) {
    if (key === 'C') { setCalcExpr(''); setCalcResult(null); return }
    if (key === '⌫') { setCalcExpr(e => e.slice(0, -1)); return }
    if (key === '=') {
      if (!/^[0-9+\-*/.() ]+$/.test(calcExpr) || !calcExpr.trim()) { setCalcResult('خطأ'); return }
      try {
        // eslint-disable-next-line no-new-func
        const r = Function(`"use strict"; return (${calcExpr})`)()
        setCalcResult(Number.isFinite(r) ? String(Math.round(r * 100) / 100) : 'خطأ')
      } catch { setCalcResult('خطأ') }
      return
    }
    setCalcResult(null)
    setCalcExpr(e => e + key)
  }

  function exitPage() {
    if (onClose) onClose()
    else window.dispatchEvent(new CustomEvent('app:navigate', { detail: 'dashboard' }))
  }
  function requestClose() {
    const hasData = drafts.some(d => d.description.trim() || d.amount)
    if (hasData) setCloseDlg(true)
    else exitPage()
  }
  async function closeWithSave() { await commitDrafts(); setCloseDlg(false); exitPage() }
  function closeNoSave() { setDrafts(rows(DEFAULT_ROWS - txs.length)); setCloseDlg(false); exitPage() }

  function onCellKey(e: React.KeyboardEvent, r: number, c: number) {
    const goCell = (nr: number, nc: number) => {
      const el = document.querySelector<HTMLElement>(`[data-cell="${nr}-${nc}"]`)
      if (el) { e.preventDefault(); el.focus(); if (el instanceof HTMLInputElement) el.select() }
    }
    const LAST_COL = 4 // 0=المبلغ 1=البيان 2=التصنيف الرئيسي 3=التصنيف الفرعي 4=طريقة الدفع
    const isSelect = e.currentTarget instanceof HTMLSelectElement
    if (e.key === 'Enter') goCell(r + 1, c)
    // الأسهم في القوائم المنسدلة (select) تُترك لسلوك المتصفح الافتراضي لتغيير القيمة المختارة
    else if (!isSelect && e.key === 'ArrowDown') goCell(r + 1, c)
    else if (!isSelect && e.key === 'ArrowUp') goCell(r - 1, c)
    else if (e.key === 'Tab') {
      if (e.shiftKey) { if (c > 0) goCell(r, c - 1); else goCell(r - 1, LAST_COL) }
      else { if (c < LAST_COL) goCell(r, c + 1); else goCell(r + 1, 0) }
    }
  }

  if (!shift) return <div className="p-8 text-center" style={{ color: 'var(--txt-3)' }}>جارٍ التحميل…</div>

  const dayName = (() => { try { return new Date(shift.date + 'T00:00:00').toLocaleDateString('ar-EG', { weekday: 'long' }) } catch { return '' } })()
  const statusTxt = shift.status === 'approved' ? '🔒 معتمد' : shift.status === 'review' ? '⏳ مراجعة' : '🟢 مفتوح'
  // إجماليات حيّة — محفوظ + قيد الكتابة. النوع: منصرف للكل إلا التصنيف الرئيسي «تحصيل» → وارد
  const filledDrafts = drafts.filter(d => d.description.trim() && d.amount)
  const dSum = (pred: (d: TxDraft) => boolean) => filledDrafts.filter(pred).reduce((s, d) => s + parsePias(d.amount), 0)
  const collectMainId = mains.find(m => m.name === 'تحصيل')?.id ?? -1
  const dirOf = (mainCatId: number): 'in' | 'out' => (mainCatId === collectMainId ? 'in' : 'out')
  // v2.34.11 — خلية "الموظف" تُفعَّل فقط لبند مصروفات ← سلفة موظف (لربط السلفة بموظف مُحدَّد لخصمها من مرتبه)
  const advanceMainId = mains.find(m => m.name === 'مصروفات')?.id ?? -1
  const advanceSubId  = subs.find(s => s.name === 'سلفة موظف')?.id ?? -1
  const isAdvanceRow = (mainCatId: number, subCatId: number) => mainCatId === advanceMainId && subCatId === advanceSubId
  // v2.34.17 — عدد عمليات البيع = فرق رقمي البون (إحصائي فقط، لا يدخل في أي حساب)
  // إصلاح: كانت +1 بالخطأ — "أول بون" قراءة العدّاد قبل أول عملية (كالعدّاد الميكانيكي) وليست رقم أول عملية نفسها
  const saleOpsCount = (fawry?.firstVoucher ?? 0) > 0 && (fawry?.lastVoucher ?? 0) > 0
    ? Math.max(0, fawry!.lastVoucher - fawry!.firstVoucher) : 0
  // عدد عمليات التوصيل = عدد بنود اليومية (محفوظ + قيد الكتابة) بتصنيف فرعي "مبيعات توصيل" — إحصائي فقط
  const deliverySubId = subs.find(s => s.name === 'مبيعات توصيل')?.id ?? -1
  const deliveryOpsCount = txs.filter(t => t.subCategoryId === deliverySubId).length
    + drafts.filter(d => d.subCategoryId === deliverySubId && d.description.trim() && d.amount).length
  const amt = (t: Transaction) => t.amountIn + t.amountOut
  // مبيعات فيزا/آجل — من التصنيف الفرعي (لا من الدفع)
  const visaSubId = subs.find(s => s.name === 'مبيعات فيزا')?.id ?? -1
  const creditSubId = subs.find(s => s.name === 'مبيعات آجل')?.id ?? -1
  const creditTx = txs.filter(t => t.subCategoryName === 'مبيعات آجل').reduce((s, t) => s + amt(t), 0) + dSum(d => d.subCategoryId === creditSubId)
  const visaTx = txs.filter(t => t.subCategoryName === 'مبيعات فيزا').reduce((s, t) => s + amt(t), 0) + dSum(d => d.subCategoryId === visaSubId) // v2.31.3: New
  // v2.34.20 — مبيعات توصيل: خلية إرشادية فقط (تصنيف رئيسي «مبيعات» ← فرعي «مبيعات توصيل») — لا تدخل في totalSales ولا معادلة التقفيل
  const deliverySales = txs.filter(t => t.subCategoryId === deliverySubId).reduce((s, t) => s + amt(t), 0) + dSum(d => d.subCategoryId === deliverySubId)
  // v2.34.19 — عدد عمليات فيزا/آجل (إحصائي فقط، لنفس منطق عدد عمليات التوصيل — محفوظ + قيد الكتابة)
  const visaOpsCount = txs.filter(t => t.subCategoryId === visaSubId).length
    + drafts.filter(d => d.subCategoryId === visaSubId && d.description.trim() && d.amount).length
  const creditOpsCount = txs.filter(t => t.subCategoryId === creditSubId).length
    + drafts.filter(d => d.subCategoryId === creditSubId && d.description.trim() && d.amount).length
  // كاش أوت — تسليم > استلام ⇒ إضافة (مبيعات فيزا عبر الماكينة) · استلام > تسليم ⇒ خصم (تحويل رصيد لأساسي/إير تايم)
  const cashoutDiff = fawryRes?.cashoutSales ?? 0
  // v2.34.5 — معادلة "عمولة فوري (كاش أوت)" مؤكَّدة من الشيت المرجعي الأصلي (قالب فادي حورس):
  // عمولة فوري = مبيعات فيزا − إضافة كاش أوت (وليس مبيعات فيزا − cashoutDiff كما كانت سابقًا — كانت تُنتج قيمًا خاطئة تمامًا عند العجز)
  // "إضافة كاش أوت": لو تسليم>استلام = الفرق مباشرة؛ لو استلام>تسليم (عجز) = ما تم ترحيله فعليًا من كاش أوت
  // للأساسي/الإير تايم مخصومًا منه الخصم — نستخدم الحقلين المُسمَّيين مباشرة بدل مرجع صف ثابت في الشيت الأصلي
  // (المرجع الثابت هناك يخطئ لو اختلف عدد بنود الشيفتات، فالحقول المُسمّاة أضمن مهما كان عدد البنود).
  const cashoutDiscountAmt = cashoutDiff < 0 ? -cashoutDiff : 0
  const cashoutAddAmt = cashoutDiff >= 0
    ? cashoutDiff
    : ((fawry?.cashoutToBasic ?? 0) + (fawry?.cashoutToAir ?? 0)) - cashoutDiscountAmt
  const cashoutFawryCommission = visaTx - cashoutAddAmt
  const cashoutCommissionPct = visaTx > 0 ? (cashoutFawryCommission / visaTx) * 100 : 0
  const cashoutAccent = cashoutDiff < 0 ? '#ef4444' : '#22c55e'
  const basicAirSum = (fawryRes?.basicSales ?? 0) + (fawryRes?.airSales ?? 0)
  // بطلب العميل: "مبيعات فوري + الربحية" أصبحت خلية يدوية يدخلها العميل نفسه بدل حسابها تلقائيًا من النسبة%
  const fawryWithCommission = fawry?.fawryTotalManual ?? 0
  // بطلب العميل (تصحيح) — النسبة المئوية لفوري = القيمة اليدوية المُدخَلة (مبيعات فوري+الربحية) ÷ مبيعات أساسي+إيرتايم × 100
  const fawryPct = basicAirSum > 0 ? (fawryWithCommission / basicAirSum) * 100 : 0
  // v2.31.3 — معادلات جديدة من العميل
  const collections = txs.filter(t => t.mainCategoryName === 'تحصيل').reduce((s, t) => s + amt(t), 0)
    + dSum(d => d.mainCategoryId === collectMainId)                                                    // التحصيل (وارد)
  const cashierExpenses = txs.filter(t => t.payMethod === 'cashier' && dirOf(t.mainCategoryId ?? 0) === 'out').reduce((s, t) => s + amt(t), 0)
    + dSum(d => d.payMethod === 'cashier' && dirOf(d.mainCategoryId) === 'out')
  const totalSales = shift.posSales + fawryWithCommission
  const totalExpenses = creditTx + visaTx + cashierExpenses
  const { result: netCash } = calcShiftClosing({ posSales: shift.posSales, cashierRemaining: shift.cashierRemaining, cashierExpenses, collections })

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--txt-1)' }}>

      {/* شريط معلومات الشيفت (مضغوط — التاريخ/النوع/الكاشير قابلة للتحرير) */}
      <div className="flex items-center gap-x-3 gap-y-1 px-4 py-2 flex-wrap flex-shrink-0 text-sm" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
        <span className="flex items-center gap-1">📅
          <input type="date" value={shift.date} onChange={e => e.target.value && saveMeta({ date: e.target.value })}
            className="tabular-nums font-bold" style={{ ...inp, width: 130, colorScheme: 'dark' }} />
        </span>
        <Sep /><span>{dayName}</span>
        <Sep />
        <select value={shift.type} onChange={e => saveMeta({ type: e.target.value as 'morning' | 'evening' | 'between' })} style={{ ...inp, fontWeight: 700 }}>
          <option value="morning">🌅 صباحي</option>
          <option value="evening">🌙 مسائي</option>
          <option value="between">🌇 بيني</option>
        </select>
        <Sep /><span className="flex items-center gap-1">👤
          <CashierName name={shift.cashierName} onSave={n => saveMeta({ cashierName: n })} />
        </span>
        <Sep /><span>#{shift.monthlyShiftNum}</span>
        <Sep /><span style={{ color: shift.status === 'open' ? G.edit : 'var(--txt-2)' }}>{statusTxt}</span>
        {!embedded && onClose && <button onClick={onClose} className="mr-auto p-1.5 rounded-lg hover:bg-white/10" style={{ color: 'var(--txt-2)' }}>✕</button>}
      </div>

      {/* المساحة الرئيسية: يومية · فوري · ملخّص — تبويب فرعي يخفي/يظهر أعمدة منها
          v2.34.11 — في تبويب العمليات اليومية: الجدول أعرض بنسبة 40% (كان 2.3fr من 4.22fr ≈ 54.5%، بقى 76%) ومُتمركز في نص الشاشة
          v2.34.13 — في التبويب الفرعي: 4 أعمدة متساوية — فوري وملخّص الشيفت ياخدوا نصف العرض اليمين (نفس مقاسهم السابق بالحرف)
          v2.34.14 — والنصف الشمال (عمودان) بقى فيه عدّاد الفلوس المصري + الآلة الحاسبة (منقولان من مسودة حسابات) */}
      <div className="flex-1 min-h-0 grid gap-2.5 p-3" style={
        subView === 'daily' ? { gridTemplateColumns: '76%', justifyContent: 'center' }
        : { gridTemplateColumns: '1fr 1fr 1fr 1fr' }
      }>

        {/* العمليات اليومية */}
        {subView === 'daily' && (
        <div className="flex flex-col rounded-xl overflow-hidden min-h-0" style={{ border: `1px solid ${G.edit}33` }}>
          <div className="px-4 py-2 font-bold text-sm flex justify-between items-center flex-shrink-0" style={{ background: 'rgba(34,197,94,0.10)', color: G.edit }}>
            <span>📋 العمليات اليومية</span><span className="text-2xs font-medium" style={{ color: 'var(--txt-3)' }}>Enter/الأسهم للتنقّل · TAB بين الخلايا</span>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            <table className="w-full" style={{ tableLayout: 'fixed', fontSize: 13 }}>
              <colgroup>
                {/* v2.34.21 — البيان أُنقِص عرضه 10% (من عرضه الحر السابق) وأُضيف نفس المقدار لعرض تصنيف فرعي — إجمالي عرض الجدول ثابت 100% كما كان */}
                <col style={{ width: 30 }} /><col style={{ width: 92 }} /><col style={{ width: 'calc((100% - 692px) * 0.9)' }} /><col style={{ width: 108 }} />
                {/* v2.34.24 — تصنيف فرعي أُنقِص 5% (من عرضه الحالي) وأُضيف نفس المقدار لعرض الموظف */}
                <col style={{ width: 'calc((116px + (100% - 692px) * 0.1) * 0.95)' }} />
                {/* v2.34.25 — الدفع اتّسع 2% إضافية (ناحية اليسار، على حساب عرض الموظف المجاور) */}
                <col style={{ width: 92.31 }} /><col style={{ width: 'calc(113.69px + (116px + (100% - 692px) * 0.1) * 0.05)' }} /><col style={{ width: 96 }} /><col style={{ width: 44 }} />
              </colgroup>
              <thead className="sticky top-0 z-10"><tr style={{ background: 'var(--app-bg-solid)', color: 'var(--txt-3)' }}>
                <th className="th">#</th><th className="th">القيمة</th><th className="th">البيان</th><th className="th">الفئة</th><th className="th">تصنيف فرعي</th>
                <th className="th" style={{ background: 'rgba(20,184,166,0.16)', color: PAY_COL }}>الدفع</th><th className="th">الموظف</th><th className="th text-center">النوع</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {txs.map((t, i) => editId === t.id ? (
                  <tr key={t.id} style={{ background: 'rgba(59,130,246,0.06)' }}>
                    <td className="td-lg" style={{ color: 'var(--txt-3)' }}>{i + 1}</td>
                    <td className="td-lg"><AmountCell value={draft.amount} onValueChange={v => setDraft({ ...draft, amount: v })} className="w-full tabular-nums" style={inp} /></td>
                    <td className="td-lg"><input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className="w-full" style={inp} /></td>
                    <td className="td-lg"><select value={draft.mainCategoryId} onChange={e => setDraft({ ...draft, mainCategoryId: Number(e.target.value), subCategoryId: 0 })} className="w-full" style={inp}><option value={0}>—</option>{mains.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></td>
                    <td className="td-lg"><select value={draft.subCategoryId} onChange={e => setDraft({ ...draft, subCategoryId: Number(e.target.value) })} className="w-full" style={inp}><option value={0}>—</option>{subs.filter(s => s.mainCategoryId === draft.mainCategoryId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td className="td-lg"><select value={draft.payMethod} onChange={e => setDraft({ ...draft, payMethod: e.target.value as PayMethod | '' })} className="w-full" style={payInp}><option value="">لا شيء</option>{PAY_OPTIONS.map(k => <option key={k} value={k}>{PAY[k]}</option>)}</select></td>
                    <td className="td-lg">
                      {isAdvanceRow(draft.mainCategoryId, draft.subCategoryId)
                        ? <select value={draft.employeeId} onChange={e => setDraft({ ...draft, employeeId: Number(e.target.value) })} className="w-full" style={inp}><option value={0}>—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
                        : <span style={{ color: 'var(--txt-3)' }}>—</span>}
                    </td>
                    <td className="td-lg text-center"><span className="text-2xs font-bold px-1.5 py-0.5 rounded-full" style={dirOf(draft.mainCategoryId) === 'in' ? { background: 'rgba(34,197,94,0.13)', color: G.edit } : { background: 'rgba(248,113,113,0.13)', color: G.warn }}>{dirOf(draft.mainCategoryId) === 'in' ? 'وارد' : 'منصرف'}</span></td>
                    <td className="td-lg whitespace-nowrap"><button onClick={saveEdit} className="text-green-400">✔</button><button onClick={() => setEditId(null)} className="text-red-400 mr-1">✕</button></td>
                  </tr>
                ) : (
                  <tr key={t.id} style={{ background: i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent' }} className="group">
                    <td className="td-lg" style={{ color: 'var(--txt-3)' }}>{i + 1}</td>
                    <td className="td-lg tabular-nums font-bold" style={{ fontSize: 14 }}>{fmt(t.amountIn || t.amountOut)}</td>
                    <td className="td-lg font-medium truncate">{t.description}</td>
                    <td className="td-lg text-2xs truncate" style={{ color: 'var(--txt-2)' }}>{t.mainCategoryName}</td>
                    <td className="td-lg text-2xs truncate" style={{ color: 'var(--txt-2)' }}>{t.subCategoryName || '—'}</td>
                    <td className="td-lg truncate" style={{ color: PAY_COL, fontWeight: 700 }}>{PAY[t.payMethod]}</td>
                    <td className="td-lg truncate" style={{ color: 'var(--txt-2)' }}>
                      {isAdvanceRow(t.mainCategoryId ?? 0, t.subCategoryId ?? 0)
                        ? (employees.find(e => e.id === t.employeeId)?.name ?? '—')
                        : '—'}
                    </td>
                    <td className="td-lg text-center"><span className="text-2xs font-bold px-1.5 py-0.5 rounded-full" style={dirOf(t.mainCategoryId ?? 0) === 'in' ? { background: 'rgba(34,197,94,0.13)', color: G.edit } : { background: 'rgba(248,113,113,0.13)', color: G.warn }}>{dirOf(t.mainCategoryId ?? 0) === 'in' ? 'وارد' : 'منصرف'}</span></td>
                    <td className="td-lg whitespace-nowrap opacity-40 group-hover:opacity-100" style={{ color: 'var(--txt-3)' }}><button onClick={() => startEdit(t)} className="hover:text-blue-400">✎</button><button onClick={() => delTx(t.id)} className="hover:text-red-400 mr-1">🗑</button></td>
                  </tr>
                ))}
                {drafts.map((d, i) => (
                  <tr key={'d' + i} style={{ background: 'rgba(34,197,94,0.025)' }}>
                    <td className="td-lg" style={{ color: 'var(--txt-3)' }}>{txs.length + i + 1}</td>
                    <td className="td-lg"><AmountCell data-cell={`${i}-0`} onKeyDown={e => onCellKey(e, i, 0)} onPaste={e => handleColumnPaste(i, 'amount', e)} value={d.amount} onValueChange={v => setDraftRow(i, { amount: v })} className="w-full tabular-nums sheet-cell" style={inp} /></td>
                    <td className="td-lg"><input data-cell={`${i}-1`} onKeyDown={e => onCellKey(e, i, 1)} onPaste={e => handleColumnPaste(i, 'description', e)} value={d.description} onChange={e => handleDescInput(i, e.target.value)} className="w-full sheet-cell" style={inp} /></td>
                    <td className="td-lg"><select data-cell={`${i}-2`} onKeyDown={e => onCellKey(e, i, 2)} value={d.mainCategoryId} onChange={e => setDraftRow(i, { mainCategoryId: Number(e.target.value), subCategoryId: 0 })} className="w-full sheet-cell" style={inp}><option value={0}>—</option>{mains.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></td>
                    <td className="td-lg"><select data-cell={`${i}-3`} onKeyDown={e => onCellKey(e, i, 3)} value={d.subCategoryId} onChange={e => setDraftRow(i, { subCategoryId: Number(e.target.value) })} className="w-full sheet-cell" style={inp}><option value={0}>—</option>{subs.filter(s => s.mainCategoryId === d.mainCategoryId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td className="td-lg"><select data-cell={`${i}-4`} onKeyDown={e => onCellKey(e, i, 4)} value={d.payMethod} onChange={e => setDraftRow(i, { payMethod: e.target.value as PayMethod | '' })} className="w-full sheet-cell" style={payInp}><option value="">لا شيء</option>{PAY_OPTIONS.map(k => <option key={k} value={k}>{PAY[k]}</option>)}</select></td>
                    <td className="td-lg">
                      {isAdvanceRow(d.mainCategoryId, d.subCategoryId)
                        ? <select value={d.employeeId} onChange={e => setDraftRow(i, { employeeId: Number(e.target.value) })} className="w-full sheet-cell" style={inp}><option value={0}>—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
                        : <span style={{ color: 'var(--txt-3)' }}>—</span>}
                    </td>
                    <td className="td-lg text-center"><span className="text-2xs font-bold px-1.5 py-0.5 rounded-full" style={dirOf(d.mainCategoryId) === 'in' ? { background: 'rgba(34,197,94,0.13)', color: G.edit } : { background: 'rgba(248,113,113,0.13)', color: G.warn }}>{dirOf(d.mainCategoryId) === 'in' ? 'وارد' : 'منصرف'}</span></td>
                    <td className="td-lg"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* فوري — بترتيب القالب المرجعي (20 حقلاً) — عرض مصغَّر فقط (50%)، الارتفاع كما كان بلا أي تغيير */}
        {subView === 'fawry' && (
        <>
        <div className="flex flex-col rounded-xl overflow-hidden min-h-0" style={{ border: `1px solid ${G.fawry}33` }}>
          <div className="px-3 py-2.5 font-extrabold text-sm flex-shrink-0" style={{ background: 'rgba(167,139,250,0.16)', color: '#c4b5fd' }}>📱 ماكينة فوري</div>
          <div className="flex-1 overflow-auto min-h-0">
            <table className="w-full text-xs"><tbody>
              <FIn label="استلام أساسي" value={fawry?.basicReceive ?? 0} onSave={v => saveFawry('basicReceive', v)} />
              <FIn label="تسليم أساسي" value={fawry?.basicDeliver ?? 0} onSave={v => saveFawry('basicDeliver', v)} />
              <FCalc label="مبيعات أساسي" value={fawryRes?.basicSales ?? 0} box />
              <FIn label="استلام إير تايم" value={fawry?.airReceive ?? 0} onSave={v => saveFawry('airReceive', v)} />
              <FIn label="تسليم إير تايم" value={fawry?.airDeliver ?? 0} onSave={v => saveFawry('airDeliver', v)} />
              <FCalc label="مبيعات إير تايم" value={fawryRes?.airSales ?? 0} box />
              <FIn label="استلام كاش أوت" value={fawry?.cashoutReceive ?? 0} onSave={v => saveFawry('cashoutReceive', v)} />
              <FIn label="تسليم كاش أوت" value={fawry?.cashoutDeliver ?? 0} onSave={v => saveFawry('cashoutDeliver', v)} />
              {/* v2.34.6 — خليتان منفصلتان (مطابقة لشيت حورس الأصلي) بدل خلية واحدة كانت تتبدّل بالاسم حسب الإشارة */}
              <FCalc label="إضافة كاش أوت" value={cashoutAddAmt} accent="#22c55e" box />
              <FCalc label="خصم كاش أوت" value={cashoutDiscountAmt} accent="#ef4444" box />
              <FIn label="من كاش أوت للأساسي" value={fawry?.cashoutToBasic ?? 0} onSave={v => saveFawry('cashoutToBasic', v)} />
              <FIn label="من كاش أوت للإير تايم" value={fawry?.cashoutToAir ?? 0} onSave={v => saveFawry('cashoutToAir', v)} />
              <FIn label="من فوري للأساسي" value={fawry?.fawryToBasic ?? 0} onSave={v => saveFawry('fawryToBasic', v)} />
              <FIn label="من فوري للإير تايم" value={fawry?.fawryToAir ?? 0} onSave={v => saveFawry('fawryToAir', v)} />
              {/* خلية المبيعات — مميّزة دائمًا بالأزرق (تمييز احترافي مقصود، بخلاف باقي الأرقام المحايدة) */}
              <FCalc label="مبيعات أساسي + إير تايم" value={basicAirSum} accent="#3b82f6" box />
              <FIn label="مبيعات فوري + الربحية" value={fawryWithCommission} onSave={v => saveFawry('fawryTotalManual', v)} />
              {/* بطلب العميل — محسوبة تلقائيًا: مبيعات أساسي+إيرتايم ÷ مبيعات فوري+الربحية × 100، وليست إدخالاً يدويًا */}
              <tr style={{ background: '#3b82f61a', borderBottom: '1px solid var(--inner-border)' }}>
                <td className="px-3 py-1.5" style={{ color: '#3b82f6', fontWeight: 700, fontSize: 13 }}>النسبة المئوية لفوري <span style={{ fontSize: 9 }}>🔒</span></td>
                <td className="px-2.5 py-1.5 text-left">
                  <span className="inline-block w-28 text-left tabular-nums font-bold" style={{
                    background: '#3b82f612', border: '1px solid #3b82f655', borderRadius: 6,
                    padding: '3px 7px', color: '#3b82f6', fontSize: 13,
                  }}>{fawryPct.toFixed(2)}%</span>
                </td>
              </tr>
              {/* بطلب العميل — حُذفت خلية "النسبة المئوية لعمولة فوري" لتكرارها ظاهريًا مع "النسبة المئوية لفوري" أعلاها؛
                  نسبة عمولة الكاش أوت لا تزال محسوبة (cashoutCommissionPct) ومعروضة في عدّاد FawryCommissionGauge أسفل الجدول */}
              <FCalc label="قيمة عمولة فوري (كاش أوت)" value={cashoutFawryCommission} accent={cashoutAccent} box />
            </tbody></table>
          </div>
          {/* عدّاد عمولة فوري + عدّاد عدد عمليات التوصيل — جنبًا إلى جنب، بمحاذاة عمود ملخّص الشيفت المجاور */}
          <div className="px-2 pb-2 pt-1 flex-shrink-0 flex items-center gap-1.5">
            <div style={{ flex: 1, minWidth: 0 }}><FawryCommissionGauge pct={cashoutCommissionPct} isDiscount={cashoutDiff < 0} small /></div>
            <div style={{ flex: 1, minWidth: 0 }}><CountGauge title="عدد عمليات التوصيل" count={deliveryOpsCount} color="#38bdf8" small /></div>
          </div>
        </div>

        {/* ملخّص الشيفت — نفس بنية عمود فوري تماماً (ترويسة ثابتة + محتوى قابل للتمرير داخلياً + عدّاد ثابت أسفل) — عرض مصغَّر فقط، الارتفاع كما كان */}
        <div className="flex flex-col rounded-xl overflow-hidden min-h-0" style={{ border: '1px solid rgba(251,191,36,0.22)' }}>
          <div className="px-3 py-2.5 font-extrabold text-sm flex-shrink-0" style={{ background: 'rgba(251,191,36,0.16)', color: '#fcd34d' }}>🧾 ملخّص الشيفت</div>
          <div className="flex-1 overflow-auto min-h-0 flex flex-col gap-2 p-2">
            {/* v2.34.8 — الأرقام محايدة (أسود/أبيض) افتراضيًا؛ التمييز اللوني فقط للإجماليات النهائية */}
            <SummaryGroup title="💵 جزء المبيعات" color="#22c55e">
              <CCardIn label="مبيعات (POS)" value={shift.posSales} onSave={v => saveClose('posSales', v)} />
              <CCard label="م فوري + الربحية" value={fmt(fawryWithCommission)} />
              <CCard label="مبيعات آجل" value={fmt(creditTx)} />
              <CCard label="مبيعات فيزا" value={fmt(visaTx)} />
              {/* v2.34.20 — إرشادية فقط، غير داخلة في اجمالي المبيعات أدناه ولا في معادلة التقفيل */}
              <CCard label="مبيعات توصيل" value={fmt(deliverySales)} accent="#38bdf8" />
              <CCard label="اجمالي المبيعات" value={fmt(totalSales)} accent="#d4a017" />
            </SummaryGroup>

            <SummaryGroup title="🧾 جزء الكاشير" color="#3b82f6">
              <CCardIn label="نقدية الكاشير" value={shift.cashierRemaining} onSave={v => saveClose('cashierRemaining', v)} accent="#f87171" />
              <CCard label="مصروفات الكاشير" value={fmt(cashierExpenses)} />
              {/* v2.35.1 — أُعيدت تسميتها (كانت "إجمالي المصروفات" — تشابه مع رقم مختلف بنفس الاسم في لوحة التحكم والتقارير) لتصف تكوينها الفعلي: آجل+فيزا (لم تدخل كاش) + مصروفات الكاشير النقدية */}
              <CCard label="آجل + فيزا + مصروفات الكاشير" value={fmt(totalExpenses)} accent="#f87171" />
              <CCard label="تحصيل" value={fmt(collections)} />
            </SummaryGroup>

            <SummaryGroup title="🤝 جزء العهدة" color="#a78bfa">
              <FundRow label="✎ عهدة مستلمة" value={custody?.addFromFund ?? 0} onSave={v => saveCustody('addFromFund', v)} editable />
              {/* بطلب العميل: تُحسب تلقائيًا (تجميع بنود الشيفت بخلية الدفع "إدارة") بدل الإدخال اليدوي — القيمة نفسها المستخدَمة في "عهدة متبقية" أدناه فتبقى متطابقة دومًا */}
              <FundRow label="عهدة منصرفة" value={mgmtOut} />
              <FundRow label="عهدة متبقية" value={custodyRes?.remaining ?? 0} accent={G.sum} />
            </SummaryGroup>

            <SummaryGroup title="🏦 جزء الصندوق" color="#fbbf24">
              <FundRow label="رصيد أول الصندوق" value={fundPos?.before ?? 0} />
              <FundRow label="مصروفات الصندوق" value={mgmtOut} />
              <FundRow label="وارد إلى الصندوق" value={shift.cashierRemaining} />
              <FundRow label="رصيد آخر الصندوق" value={fundPos ? fundPos.before + shift.cashierRemaining - mgmtOut : 0} accent={G.sum} bold />
            </SummaryGroup>

            {/* v2.34.17/19 — أول/آخر بون (يدوي) + إحصائيات عدد عمليات البيع (فيزا/آجل/توصيل) — إحصائي فقط، لا يدخل في أي حساب */}
            <SummaryGroup title="📊 إحصائيات عمليات البيع" color="#38bdf8">
              <StatRow label="✎ أول بون" value={fawry?.firstVoucher ?? 0} onSave={v => saveVoucher('firstVoucher', v)} editable />
              <StatRow label="✎ آخر بون" value={fawry?.lastVoucher ?? 0} onSave={v => saveVoucher('lastVoucher', v)} editable />
              <StatRow label="عدد عمليات البيع" value={saleOpsCount} />
              <StatRow label="عدد عمليات فيزا" value={visaOpsCount} />
              <StatRow label="عدد عمليات البيع الآجل" value={creditOpsCount} />
              <StatRow label="عدد عمليات التوصيل" value={deliveryOpsCount} />
            </SummaryGroup>
          </div>
          {/* عدّاد حالة الشيفت + عدّاد عدد عمليات البيع — جنبًا إلى جنب، مصغّرين ليتسعا معًا بلا أي تغيير في أبعاد العمود الخارجي */}
          <div className="px-2 pb-2 pt-1 flex-shrink-0 flex items-center gap-1.5">
            <div style={{ flex: 1, minWidth: 0 }}><ShiftGauge result={netCash} small /></div>
            <div style={{ flex: 1, minWidth: 0 }}><CountGauge title="عدد عمليات البيع" count={saleOpsCount} color="#38bdf8" small /></div>
          </div>
        </div>

        {/* عدّاد فلوس مصري + آلة حاسبة — منقولان من مسودة حسابات إلى الفراغ يسار ملخّص الشيفت (فوق: العدّاد، تحته: الآلة الحاسبة) */}
        <div className="flex flex-col gap-2.5 min-h-0 overflow-auto" style={{ gridColumn: 'span 2' }}>
          {/* بطلب العميل — زر لإخفاء العدّاد/الآلة الحاسبة واستبدالهما بشرح استخدام الشاشة */}
          <div className="flex items-center justify-end flex-shrink-0">
            <button onClick={() => setShowMoneyTools(v => !v)}
              className="text-2xs px-2.5 py-1 rounded-md flex items-center gap-1"
              style={{ background: 'var(--app-bg-solid, rgba(255,255,255,0.05))', color: 'var(--txt-3)', border: '1px solid var(--inner-border)' }}>
              {showMoneyTools ? <>🙈 إخفاء العدّاد والآلة الحاسبة</> : <>👁 إظهار العدّاد والآلة الحاسبة</>}
            </button>
          </div>

          {showMoneyTools ? (
          <>
          <div className="rounded-2xl p-3 flex-shrink-0" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
            <div className="flex items-center justify-between mb-2 pb-1.5" style={{ borderBottom: '1px solid var(--inner-border)' }}>
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 14 }}>💵</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--txt-1)' }}>عدّاد فلوس مصري</span>
              </div>
              <button onClick={() => setMoneyDenoms({})} className="text-2xs px-2 py-1 rounded-md" style={{ background: 'var(--app-bg-solid, rgba(255,255,255,0.05))', color: 'var(--txt-3)' }}>
                ✕ تصفير
              </button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {MONEY_DENOMS.map(d => {
                const count = parseInt(moneyDenoms[d] || '0', 10) || 0
                const value = d * count
                return (
                  <div key={d} className="rounded-xl p-2 text-center" style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.25)' }}>
                    <div className="font-extrabold tabular-nums" style={{ fontSize: 15, color: '#14b8a6' }}>{d}</div>
                    <div className="text-2xs mb-1" style={{ color: 'var(--txt-3)' }}>جنيه</div>
                    <input
                      type="number" min={0} value={moneyDenoms[d] ?? ''}
                      onChange={e => setMoneyDenoms(prev => ({ ...prev, [d]: e.target.value }))}
                      placeholder="0"
                      className="w-full text-center tabular-nums font-bold rounded-lg mb-1"
                      style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--inner-border)', color: 'var(--txt-1)', padding: '4px 2px', fontSize: 13 }}
                    />
                    <div className="tabular-nums font-bold" style={{ fontSize: 12, color: value > 0 ? 'var(--txt-1)' : 'var(--txt-3)' }}>{fmt(value * 100)} ج</div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: '1px solid var(--inner-border)' }}>
              <span className="font-bold" style={{ fontSize: 12.5, color: 'var(--txt-2)' }}>الإجمالي</span>
              <span className="tabular-nums font-extrabold" style={{ fontSize: 18, color: '#14b8a6' }}>
                {fmt(MONEY_DENOMS.reduce((s, d) => s + d * (parseInt(moneyDenoms[d] || '0', 10) || 0), 0) * 100)} ج
              </span>
            </div>
          </div>

          <div className="rounded-2xl p-3 flex-shrink-0" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
            <div className="flex items-center gap-1.5 mb-2 pb-1.5" style={{ borderBottom: '1px solid var(--inner-border)' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--txt-1)' }}>🖩 آلة حاسبة</span>
            </div>
            <div dir="ltr" className="rounded-xl px-3 py-3 mb-2 text-left" style={{ background: 'rgba(0,0,0,0.18)', minHeight: 60 }}>
              <div className="tabular-nums truncate" style={{ fontSize: 13, color: 'var(--txt-3)', minHeight: 16 }}>{calcExpr || '0'}</div>
              <div className="tabular-nums font-extrabold truncate" style={{ fontSize: 22, color: calcResult === 'خطأ' ? '#ef4444' : 'var(--txt-1)' }}>{calcResult ?? ''}</div>
            </div>
            {/* v2.34.27 — dir="ltr" ثابت لمنع انعكاس الشبكة داخل التطبيق العربي (RTL)؛ "C" نُقل لصف مستقل بدل إقحامه أول الصف الأول (كان يزيح كل صف خانة واحدة فيخلط الأرقام بالعمليات) */}
            <div dir="ltr" className="grid grid-cols-4 gap-1.5">
              {CALC_KEYS[0].map(k => <button key={k} onClick={() => pressCalc(k)} className="calc-btn">{k}</button>)}
              {CALC_KEYS[1].map(k => <button key={k} onClick={() => pressCalc(k)} className="calc-btn">{k}</button>)}
              {CALC_KEYS[2].map(k => <button key={k} onClick={() => pressCalc(k)} className="calc-btn">{k}</button>)}
              {CALC_KEYS[3].map(k => <button key={k} onClick={() => pressCalc(k)} className="calc-btn">{k}</button>)}
              <button onClick={() => pressCalc('C')} className="calc-btn col-span-4" style={{ color: '#ef4444' }}>C</button>
              <button onClick={() => pressCalc('=')} className="calc-btn col-span-4" style={{ background: '#14b8a6', color: '#fff' }}>=</button>
            </div>
            <style>{`
              .calc-btn { padding: 8px 0; border-radius: 10px; font-weight: 700; font-size: 13px;
                background: var(--app-bg-solid, rgba(255,255,255,0.04)); border: 1px solid var(--inner-border);
                color: var(--txt-1); transition: filter .15s; }
              .calc-btn:hover { filter: brightness(1.15); }
            `}</style>
          </div>
          </>
          ) : (
            <ShiftHelpPanel />
          )}

          {/* نوتة ملاحظات — يسجّل فيها العميل ملاحظاته، مرتبطة فعليًا بالشيفت (shift.note) */}
          <ShiftNoteBox note={shift.note} onSave={saveNote} />
        </div>
        </>
        )}
      </div>

      {/* شريط الأدوات الموحّد */}
      <div className="flex items-center gap-1.5 px-3 py-2 flex-shrink-0 flex-wrap" style={{ borderTop: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
        <TBtn onClick={commitDrafts} icon="💾" label="حفظ" primary />
        <TBtn onClick={() => setDrafts(ds => [...ds, { ...emptyDraft }])} icon="➕" label="إضافة صف" />
        <TBtn onClick={() => setDrafts(ds => ds.length > 1 ? ds.slice(0, -1) : ds)} icon="🗑" label="حذف صف" />
        <TBtn onClick={dupLast} icon="📋" label="تكرار" />
        <div className="w-px h-6 mx-1" style={{ background: 'var(--inner-border)' }} />
        <TBtn onClick={() => toast.show('من القائمة: استيراد اليومية', 'info')} icon="📥" label="استيراد" />
        <TBtn onClick={exportPDF} disabled={pdfBusy} icon="📤" label={pdfBusy ? 'جاري التصدير...' : 'تصدير PDF'} />
        <TBtn onClick={() => window.print()} icon="🖨" label="طباعة" />
        {user?.role === 'manager' && (
          <TBtn onClick={() => openWindow('categories', 'إدارة التصنيفات')} icon="🏷" label="إدارة التصنيفات" />
        )}
        {/* زر تبديل التبويب الفرعي (ماكينة فوري + ملخّص الشيفت) — أيقونة سهم فقط، مميَّز بلون لافت عشان العميل يلاحظه بسهولة */}
        <button onClick={() => setSubView(v => v === 'daily' ? 'fawry' : 'daily')}
          title={subView === 'daily' ? 'فوري وملخّص الشيفت' : 'العمليات اليومية'}
          className="text-base font-black px-3 py-1.5 rounded-lg flex items-center justify-center"
          style={{
            color: '#fff', background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
            boxShadow: '0 2px 10px rgba(139,92,246,0.55)', border: '1px solid rgba(255,255,255,0.25)',
          }}>
          {subView === 'daily' ? '→' : '←'}
        </button>
        <div className="mr-auto flex items-center gap-1.5">
          {shift.status !== 'approved' && <TBtn onClick={approveShift} icon="🔒" label="اعتماد الشيفت" success />}
          <TBtn onClick={requestClose} icon="✖" label="إغلاق الصفحة" />
          <TBtn onClick={delShift} icon="❌" label="حذف الشيفت" danger />
        </div>
      </div>

      {/* بطلب العميل — منع اعتماد الشيفت لو فيه بيانات ناقصة */}
      {missingItems && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={() => setMissingItems(null)}>
          <div className="card p-5" style={{ width: '100%', maxWidth: 480, border: '1.5px solid #f59e0b' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(245,158,11,0.18)', color: '#f59e0b' }}>⚠️</div>
              <div>
                <div className="font-black text-sm" style={{ color: '#f59e0b' }}>لا يمكن اعتماد الشيفت — بيانات ناقصة</div>
                <div className="text-2xs" style={{ color: 'var(--txt-3)' }}>أكمِل البيانات التالية أولاً ثم أعد المحاولة</div>
              </div>
            </div>
            <ul className="space-y-1.5 mb-4">
              {missingItems.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-xs rounded-lg p-2" style={{ background: 'rgba(245,158,11,0.08)', color: 'var(--txt-1)' }}>
                  <span style={{ color: '#f59e0b', flexShrink: 0 }}>●</span>{m}
                </li>
              ))}
            </ul>
            <button onClick={() => setMissingItems(null)} className="w-full text-sm font-bold px-4 py-2 rounded-lg text-white" style={{ background: '#f59e0b' }}>
              حسنًا، سأكمل البيانات
            </button>
          </div>
        </div>
      )}

      {/* حوار إغلاق الصفحة */}
      {closeDlg && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={() => setCloseDlg(false)}>
          <div className="card p-6 max-w-sm text-center" onClick={e => e.stopPropagation()} style={{ border: '1px solid var(--inner-border)' }}>
            <div className="text-3xl mb-2">💾</div>
            <div className="font-black text-base mb-1" style={{ color: 'var(--txt-1)' }}>توجد بيانات غير محفوظة</div>
            <div className="text-xs mb-4" style={{ color: 'var(--txt-2)' }}>هل تريد حفظ البنود المُدخلة قبل إغلاق الصفحة؟</div>
            <div className="flex items-center gap-2 justify-center flex-wrap">
              <button onClick={closeWithSave} className="text-sm font-bold px-4 py-2 rounded-lg text-white" style={{ background: 'linear-gradient(90deg,#16a34a,#22c55e)' }}>💾 حفظ وإغلاق</button>
              <button onClick={closeNoSave} className="text-sm font-bold px-4 py-2 rounded-lg" style={{ color: '#f87171', border: '1px solid rgba(248,113,113,0.4)' }}>إغلاق بدون حفظ</button>
              <button onClick={() => setCloseDlg(false)} className="text-sm px-3 py-2 rounded-lg" style={{ color: 'var(--txt-2)', border: '1px solid var(--inner-border)' }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// خلايا الإدخال — خلفية خضراء خفيفة وحدّ أخضر (دلالة «قابل للتحرير») تعمل في الوضعين
const inp: React.CSSProperties = { background: 'rgba(34,197,94,0.07)', color: 'var(--txt-1)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 6, fontSize: 13, padding: '3px 5px', outline: 'none' }
// v2.34.25 — لون تركواز مميّز لعمود "الدفع" بالكامل (ترويسة + خلايا) لتمييزه عن باقي أعمدة الجدول
const PAY_COL = '#14b8a6'
const payInp: React.CSSProperties = { ...inp, background: 'rgba(20,184,166,0.10)', border: `1px solid ${PAY_COL}66`, color: PAY_COL }

// v2.34.23 — تنسيق فاصلة الآلاف لعرض خلية "القيمة" أثناء عدم التركيز؛ الرقم الخام (بلا فواصل) يظهر فقط أثناء التحرير المباشر
function formatAmountDisplay(raw: string): string {
  if (!raw.trim()) return raw
  const n = parseFloat(raw.replace(/,/g, ''))
  return isNaN(n) ? raw : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function AmountCell({ value, onValueChange, onFocus, onBlur, ...rest }: {
  value: string; onValueChange: (v: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [focused, setFocused] = useState(false)
  return <input {...rest} value={focused ? value : formatAmountDisplay(value)}
    onFocus={e => { setFocused(true); onFocus?.(e) }}
    onBlur={e => { setFocused(false); onBlur?.(e) }}
    onChange={e => onValueChange(e.target.value)} />
}

/** عدّاد نصف دائري مشترك — خمس شرائح لونية وإبرة تتحرك حسب النسبة؛ يُستخدم لعدّاد الشيفت وعدّاد عمولة فوري بنفس التصميم */
function Gauge({ title, angle, color, statusText, valueText, segColors, small }: {
  title: string; angle: number; color: string; statusText: string; valueText: string; segColors: [string, string, string, string, string]; small?: boolean
}) {
  const segPaths = [
    'M 22 100 A 78 78 0 0 1 35.3 56.4',
    'M 36.9 54.1 A 78 78 0 0 1 73.3 26.7',
    'M 75.9 25.8 A 78 78 0 0 1 121.5 25.0',
    'M 124.1 25.8 A 78 78 0 0 1 161.5 52.0',
    'M 163.1 54.1 A 78 78 0 0 1 178.0 97.3',
  ]
  return (
    <div className="rounded-xl px-2.5 pt-2 pb-1.5 flex-shrink-0 flex flex-col items-center justify-center" style={{ minHeight: small ? 92 : 108, background: 'var(--surface-2, rgba(255,255,255,0.04))', border: '1px solid var(--inner-border)' }}>
      <div className="text-2xs font-bold mb-0.5 self-start" style={{ color: 'var(--txt-2)' }}>{title}</div>
      <svg viewBox="0 0 200 118" style={{ width: '100%', maxWidth: small ? 100 : 150 }}>
        {segPaths.map((d, i) => <path key={i} d={d} fill="none" stroke={segColors[i]} strokeWidth={11} strokeLinecap="round" opacity={0.92} />)}
        <g transform={`rotate(${angle} 100 100)`} style={{ transition: 'transform 0.6s cubic-bezier(0.34,1.56,0.64,1)' }}>
          <line x1="100" y1="100" x2="100" y2="38" stroke="var(--txt-1)" strokeWidth="3" strokeLinecap="round" />
        </g>
        <circle cx="100" cy="100" r="6" fill="var(--txt-1)" />
        <circle cx="100" cy="100" r="2.5" fill={color} />
      </svg>
      <div className="font-black" style={{ fontSize: small ? 11 : 12.5, color, marginTop: -3 }}>{statusText}</div>
      <div className="font-extrabold tabular-nums" style={{ fontSize: small ? 12.5 : 14.5, color: 'var(--txt-1)' }}>{valueText}</div>
    </div>
  )
}

/** عدّاد حالة الشيفت — عجز/أوفر (أحمر→أخضر) */
function ShiftGauge({ result, small }: { result: number; small?: boolean }) {
  const scale = Math.max(Math.abs(result) * 1.25, 100000)
  const ratio = Math.max(-1, Math.min(1, result / scale)) // -1 to 1
  const angle = ratio * 80 // -80deg to 80deg
  const label = result > 0 ? 'أوفر' : result < 0 ? 'عجز' : 'متزن'
  const color = result > 0 ? '#22c55e' : result < 0 ? '#f87171' : '#fbbf24'
  return <Gauge title="حالة الشيفت 🔒" angle={angle} color={color} statusText={label} valueText={fmt(Math.abs(result))}
    segColors={['#ef4444', '#f97316', '#fbbf24', '#84cc16', '#22c55e']} small={small} />
}

/** عدّاد نسبة عمولة فوري المخصومة من رصيد الكاش أوت — بنفس تصميم عدّاد الشيفت وبلون مميّز مختلف (أحمر→وردي→بنفسجي→أزرق→أخضر) */
function FawryCommissionGauge({ pct, isDiscount, small }: { pct: number; isDiscount: boolean; small?: boolean }) {
  const scale = Math.max(Math.abs(pct) * 1.25, 3)
  const ratio = Math.max(-1, Math.min(1, pct / scale))
  const angle = ratio * 80
  const color = isDiscount ? '#f87171' : '#22c55e'
  const label = isDiscount ? 'خصم' : 'إضافة'
  return <Gauge title="عمولة فوري (كاش أوت) 🔒" angle={angle} color={color} statusText={label} valueText={`${pct.toFixed(1)}%`}
    segColors={['#ef4444', '#ec4899', '#a855f7', '#3b82f6', '#22c55e']} small={small} />
}

/** عدّاد إحصائي محايد لعرض عدد عمليات (بيع/توصيل) — لا يدخل في أي حساب، مجرّد عرض بصري لعدد صحيح */
function CountGauge({ title, count, color, small }: { title: string; count: number; color: string; small?: boolean }) {
  const scale = Math.max(count * 1.25, 10)
  const ratio = Math.max(0, Math.min(1, count / scale))
  const angle = ratio * 160 - 80
  return <Gauge title={title} angle={angle} color={color} statusText="عملية" valueText={count.toLocaleString('en-US')}
    segColors={['#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7']} small={small} />
}

const Sep = () => <span style={{ color: 'var(--txt-3)', opacity: 0.5 }}>|</span>
function CashierName({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(name)
  useEffect(() => { setV(name) }, [name])
  return <input value={v} onChange={e => setV(e.target.value)} onBlur={() => { if (v.trim() && v !== name) onSave(v.trim()) }}
    placeholder="اسم الكاشير" className="font-bold" style={{ ...inp, width: 110 }} />
}
// v2.34.15 — ملاحظات الشيفت (مرتبطة فعليًا بالشيفت في قاعدة البيانات — shift.note — وليست حفظاً محلياً مؤقتاً)
// بطلب العميل — تظهر بدل العدّاد/الآلة الحاسبة عند إخفائهما: شرح استخدام الشاشة وتحذيرات ومنطق معادلة الإغلاق
function ShiftHelpPanel() {
  const Section = ({ icon, title, color, children }: { icon: string; title: string; color: string; children: React.ReactNode }) => (
    <div className="rounded-2xl p-3" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
      <div className="flex items-center gap-1.5 mb-2 pb-1.5" style={{ borderBottom: '1px solid var(--inner-border)' }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color }}>{title}</span>
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.9, color: 'var(--txt-2)' }}>{children}</div>
    </div>
  )
  return (
    <div className="flex flex-col gap-2.5">
      <Section icon="🧮" title="معادلة إغلاق الشيفت" color="#38bdf8">
        <div className="rounded-lg p-2 mb-2 text-center font-bold tabular-nums" style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)', color: 'var(--txt-1)', fontSize: 12 }}>
          النتيجة = (نقدية الكاشير + مصروفات الكاشير − التحصيل) − مبيعات POS
        </div>
        <div>🟢 <b style={{ color: '#22c55e' }}>موجب (أوفر)</b> — الكاشير سلّم نقدية أكثر من المتوقع.</div>
        <div>🔴 <b style={{ color: '#ef4444' }}>سالب (عجز)</b> — ناقص من نقدية الكاشير عن المتوقع.</div>
        <div>⚪ <b>صفر (مطابق)</b> — الحسابات متوازنة تمامًا.</div>
      </Section>

      <Section icon="⚠️" title="تحذيرات مهمة قبل الإغلاق" color="#f59e0b">
        <div>• لا تُقفل الشيفت قبل عدّ النقدية الفعلية في الدرج جيدًا — أي رقم تقديري يظهر كعجز أو أوفر وهمي.</div>
        <div>• أي خطأ في خانتَي "نقدية الكاشير" أو "مبيعات POS" ينعكس فورًا ومباشرة على نتيجة الشيفت.</div>
        <div>• بيانات ماكينة فوري (استلام/تسليم) تدخل في حساب إجمالي المبيعات — راجعها من شاشة الماكينة نفسها قبل الحفظ.</div>
        <div>• "عهدة منصرفة" تُحسب تلقائيًا من بنود اليومية التي خلية الدفع فيها "إدارة" — تأكد من اختيار طريقة الدفع الصحيحة لكل بند وإلا اختل رقم العهدة.</div>
      </Section>

      <Section icon="🧭" title="الأجزاء المعقّدة — باختصار" color="#a78bfa">
        <div><b style={{ color: '#a78bfa' }}>📱 ماكينة فوري:</b> استلام/تسليم = حركة الرصيد داخل الماكينة، وليست مبيعات مباشرة. المبيعات الفعلية = الفرق بينهما بعد إضافة التحويلات.</div>
        <div className="mt-1.5"><b style={{ color: '#fbbf24' }}>🤝 العهدة:</b> "مستلمة" = ما أضيف من صندوق سابق، "منصرفة" = ما صُرف عبر "إدارة"، "متبقية" = الفرق بينهما تلقائيًا.</div>
        <div className="mt-1.5"><b style={{ color: '#fbbf24' }}>🏦 الصندوق:</b> رصيد آخر الصندوق = رصيد أوله + الوارد إليه − المصروف منه، ويُستخدم كنقطة بداية للشيفت التالي.</div>
      </Section>
    </div>
  )
}

function ShiftNoteBox({ note, onSave }: { note: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(note)
  useEffect(() => { setV(note) }, [note])
  return (
    <div className="rounded-2xl p-3" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
      <div className="flex items-center gap-1.5 mb-2 pb-1.5" style={{ borderBottom: '1px solid var(--inner-border)' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--txt-1)' }}>📝 ملاحظات الشيفت</span>
      </div>
      <textarea value={v} onChange={e => setV(e.target.value)} onBlur={() => { if (v !== note) onSave(v) }}
        placeholder="اكتب ملاحظاتك هنا..." rows={4} className="w-full text-sm rounded-lg"
        style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--inner-border)', color: 'var(--txt-1)', padding: '8px 10px', resize: 'vertical', outline: 'none' }} />
    </div>
  )
}
// حجم وخلفية موحّدان لإطارات كل خلايا القيم في عمود "ملخّص الشيفت" (CCard/CCardIn/FundRow) — الخلفية أخضر ثابت، والنص بلون كل خلية
const SUMMARY_BOX_W = 84
const SUMMARY_BOX_BG = 'rgba(74,222,128,0.10)'
const SUMMARY_BOX_BORDER = '1px solid rgba(74,222,128,0.35)'

function SummaryGroup({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-2 flex flex-col gap-1.5 flex-shrink-0" style={{ background: `${color}0d`, border: `1px solid ${color}33` }}>
      <div className="text-2xs font-extrabold px-1" style={{ color }}>{title}</div>
      {children}
    </div>
  )
}

function FundRow({ label, value, onSave, editable, accent, bold }: { label: string; value: number; onSave?: (v: string) => void; editable?: boolean; accent?: string; bold?: boolean }) {
  const [v, setV] = useState('')
  useEffect(() => { if (editable) setV(String(value / 100)) }, [value, editable])
  const c = accent ?? (editable ? '#4ade80' : 'var(--txt-1)')
  return <div className="flex items-center justify-between py-1" style={{ fontSize: 12 }}>
    <span className="font-medium" style={{ color: editable ? '#4ade80' : 'var(--txt-2)' }}>{label}</span>
    {editable && onSave
      ? <input value={v} onChange={e => setV(e.target.value)} onBlur={() => onSave(v)} className="text-left tabular-nums font-bold" style={{ ...inp, fontSize: 12, padding: '2px 5px', width: SUMMARY_BOX_W }} />
      : <span className="inline-block text-left tabular-nums" style={{
          fontWeight: bold ? 800 : 700, fontSize: 12.5, color: c,
          background: SUMMARY_BOX_BG, border: SUMMARY_BOX_BORDER,
          borderRadius: 6, padding: '3px 7px', width: SUMMARY_BOX_W,
        }}>{fmt0(value)}</span>}
  </div>
}
// v2.34.17 — نسخة بلا أي ضرب/قسمة ×100 من FundRow، لأرقام صحيحة إحصائية (أرقام بون، عدد عمليات) وليست مبالغ مالية
function StatRow({ label, value, onSave, editable, accent }: { label: string; value: number; onSave?: (v: string) => void; editable?: boolean; accent?: string }) {
  const [v, setV] = useState('')
  useEffect(() => { if (editable) setV(value ? String(value) : '') }, [value, editable])
  const c = accent ?? (editable ? '#4ade80' : 'var(--txt-1)')
  return <div className="flex items-center justify-between py-1" style={{ fontSize: 12 }}>
    <span className="font-medium" style={{ color: editable ? '#4ade80' : 'var(--txt-2)' }}>{label}</span>
    {editable && onSave
      ? <input value={v} onChange={e => setV(e.target.value)} onBlur={() => onSave(v)} className="text-left tabular-nums font-bold" style={{ ...inp, fontSize: 12, padding: '2px 5px', width: SUMMARY_BOX_W }} />
      : <span className="inline-block text-left tabular-nums" style={{
          fontWeight: 700, fontSize: 12.5, color: c,
          background: SUMMARY_BOX_BG, border: SUMMARY_BOX_BORDER,
          borderRadius: 6, padding: '3px 7px', width: SUMMARY_BOX_W,
        }}>{value.toLocaleString('en-US')}</span>}
  </div>
}
function FIn({ label, value, onSave, raw, suffix }: { label: string; value: number; onSave: (v: string) => void; raw?: boolean; suffix?: string }) {
  const [v, setV] = useState('')
  useEffect(() => { setV(raw ? String(value) : String(value / 100)) }, [value, raw])
  return <tr style={{ borderBottom: '1px solid var(--inner-border)' }}>
    <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--txt-1)', fontSize: 13 }}>{label}</td>
    <td className="px-2.5 py-1.5 text-left">
      <span className="inline-flex items-center w-28" style={{ ...inp, fontSize: 13, padding: '4px 7px' }}>
        <input value={v} onChange={e => setV(e.target.value)} onBlur={() => onSave(raw ? String((parseFloat(v) || 0) / 100) : v)}
          className="flex-1 min-w-0 text-left tabular-nums font-bold" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'inherit', padding: 0, fontSize: 13, width: '100%' }} />
        {suffix && <span style={{ marginInlineStart: 2, flexShrink: 0 }}>{suffix}</span>}
      </span>
    </td>
  </tr>
}
function FCalc({ label, value, total, raw, accent, box }: { label: string; value: number; total?: boolean; raw?: boolean; accent?: string; box?: boolean }) {
  // v2.34.8 — توحيد الأرقام باللون المحايد (أسود/أبيض حسب الوضع) افتراضيًا؛ التمييز اللوني فقط للخلايا المُمرَّر لها accent صراحةً
  const labelColor = accent ?? (total ? '#c4b5fd' : 'var(--txt-2)')
  const valueColor = accent ?? (total ? '#c4b5fd' : 'var(--txt-1)')
  const displayValue = raw ? value : (value / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
  const boxColor = accent ?? 'var(--txt-1)'
  return <tr style={{ background: box ? 'transparent' : accent ? `${accent}1a` : total ? 'rgba(167,139,250,0.14)' : 'rgba(255,255,255,0.025)', borderBottom: '1px solid var(--inner-border)' }}>
    <td className="px-3 py-1.5" style={{ color: labelColor, fontWeight: total ? 800 : 700, fontSize: 13 }}>{label} <span style={{ fontSize: 9 }}>🔒</span></td>
    {box ? (
      <td className="px-2.5 py-1.5 text-left">
        <span className="inline-block w-28 text-left tabular-nums font-bold" style={{
          background: accent ? `${accent}12` : 'var(--inner-bg)', border: accent ? `1px solid ${accent}55` : '1px solid var(--inner-border)', borderRadius: 6,
          padding: '3px 7px', color: boxColor, fontSize: 13,
        }}>{displayValue}</span>
      </td>
    ) : (
      <td className="px-2.5 py-1.5 text-left tabular-nums" style={{ color: valueColor, fontWeight: total ? 800 : 700, fontSize: 13.5 }}>{displayValue}</td>
    )}
  </tr>
}
function CCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  // v2.34.8 — أسود/أبيض محايد افتراضيًا؛ لون مميّز فقط للخلايا المقصودة صراحةً بـ accent
  const c = accent ?? 'var(--txt-1)'
  return <div className="relative overflow-hidden rounded-lg pr-3.5 pl-3 py-2 flex-shrink-0 flex items-center justify-between gap-2" style={{ background: 'var(--surface-2, rgba(255,255,255,0.04))', border: '1px solid var(--inner-border)' }}>
    <div className="absolute top-1.5 bottom-1.5 right-0 rounded-l-full" style={{ width: 3, background: c }} />
    <span className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--txt-2)' }}>{label} 🔒</span>
    <span className="inline-block font-extrabold tabular-nums text-left" style={{
      fontSize: 13, color: c, background: SUMMARY_BOX_BG, border: SUMMARY_BOX_BORDER, borderRadius: 6, padding: '3px 7px', width: SUMMARY_BOX_W,
    }}>{value}</span>
  </div>
}
function CCardIn({ label, value, onSave, accent }: { label: string; value: number; onSave: (v: string) => void; accent?: string }) {
  const [v, setV] = useState('')
  const [focused, setFocused] = useState(false)
  useEffect(() => { setV(String(value / 100)) }, [value])
  const c = accent ?? '#4ade80'
  return <div className="rounded-lg px-3 py-2 flex-shrink-0 flex items-center justify-between gap-2" style={{ background: `${c}14`, border: `1px solid ${c}59` }}>
    <span className="text-xs font-bold whitespace-nowrap" style={{ color: c }}>✎ {label}</span>
    {/* الفاصل بين الأرقام العشرية (,) أثناء العرض فقط، مطابقةً لبقية الخلايا — يتحول لرقم خام قابل للتحرير عند التركيز */}
    <input value={focused ? v : fmt(value)} onFocus={() => setFocused(true)} onChange={e => setV(e.target.value)}
      onBlur={() => { setFocused(false); onSave(v) }} className="tabular-nums font-extrabold text-left" style={{ ...inp, fontSize: 13, fontWeight: 800, padding: '3px 7px', width: SUMMARY_BOX_W }} />
  </div>
}
function TBtn({ onClick, icon, label, primary, success, danger, disabled }: { onClick: () => void; icon: string; label: string; primary?: boolean; success?: boolean; danger?: boolean; disabled?: boolean }) {
  const st: React.CSSProperties = primary ? { background: 'rgba(34,197,94,0.16)', color: '#22c55e' }
    : success ? { background: 'linear-gradient(90deg,#16a34a,#22c55e)', color: '#fff' }
    : danger ? { color: '#f87171', border: '1px solid rgba(248,113,113,0.35)' }
    : { color: 'var(--txt-1)', border: '1px solid var(--inner-border)' }
  return <button onClick={onClick} disabled={disabled} className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5" style={{ ...st, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'default' : 'pointer' }}><span>{icon}</span>{label}</button>
}
