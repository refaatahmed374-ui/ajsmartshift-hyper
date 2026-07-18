import { useEffect, useMemo, useRef, useState } from 'react'
import { api, call } from '../lib/api'
import { fmt, parsePias } from '../lib/format'
import { useToast } from '../store/toast'
import { useAuth } from '../store/auth'
import { useFloatingWindows } from '../store/floatingWindows'
import { calcFawry, calcCustody, calcFawryWithCommission, calcShiftClosing } from '../../core/engine'
import type {
  Shift, Journal, Transaction, ShiftFawry, ShiftCustody,
  MainCategory, SubCategory, PayMethod,
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
const SHIFT_TYPE: Record<string, string> = { morning: '🌅 صباحي', evening: '🌙 مسائي', between: '🌇 بيني' }
const DEFAULT_ROWS = 14

interface Props { shiftId: number; onClose?: () => void; onDeleted?: () => void; onChanged?: () => void; embedded?: boolean }

interface TxDraft { description: string; amount: string; mainCategoryId: number; subCategoryId: number; payMethod: PayMethod; direction: 'in' | 'out' }
const emptyDraft: TxDraft = { description: '', amount: '', mainCategoryId: 0, subCategoryId: 0, payMethod: 'cashier', direction: 'out' }
const G = { edit: '#22c55e', fawry: '#a78bfa', sum: '#fbbf24', warn: '#f87171' }
const rows = (n: number) => Array.from({ length: Math.max(0, n) }, () => ({ ...emptyDraft }))

export default function ShiftSheet({ shiftId, onClose, onDeleted, onChanged, embedded }: Props) {
  const toast = useToast()
  const { user } = useAuth()
  const { open: openWindow } = useFloatingWindows()
  const [shift, setShift] = useState<Shift | null>(null)
  const [journal, setJournal] = useState<Journal | null>(null)
  const [txs, setTxs] = useState<Transaction[]>([])
  const [fawry, setFawry] = useState<ShiftFawry | null>(null)
  const [custody, setCustody] = useState<ShiftCustody | null>(null)
  const [mains, setMains] = useState<MainCategory[]>([])
  const [subs, setSubs] = useState<SubCategory[]>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState<TxDraft>(emptyDraft)
  const [drafts, setDrafts] = useState<TxDraft[]>([])
  const [fundPos, setFundPos] = useState<{ before: number; cashIn: number; mgmtOut: number; after: number } | null>(null)
  const [closeDlg, setCloseDlg] = useState(false)
  const draftsInitRef = useRef<number | null>(null) // ADR-012 v2 — يمنع تكرار ملء الصفوف الافتراضية عند كل تحميل

  async function load() {
    const [sh, jr, t, f, c, m, s] = await Promise.all([
      call<Shift | null>(api.shifts.getById(shiftId)),
      call<Journal | null>(api.journal.getByShift(shiftId)),
      call<Transaction[]>(api.tx.getByShift(shiftId)),
      call<ShiftFawry | null>(api.fawry.get(shiftId)),
      call<ShiftCustody | null>(api.custody.get(shiftId)),
      call<MainCategory[]>(api.cats.getMain()),
      call<SubCategory[]>(api.cats.getSub()),
    ])
    setShift(sh); setJournal(jr); setTxs(t); setFawry(f); setCustody(c); setMains(m); setSubs(s)
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
  const custodyRes = useMemo(() => custody ? calcCustody(custody) : null, [custody])

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
  async function saveOpening(egp: string) {
    try { await call(api.shifts.updateOpening(shiftId, parsePias(egp))); await load(); onChanged?.() }
    catch (e) { toast.show((e as Error).message, 'error') }
  }
  async function saveMeta(data: { date?: string; type?: 'morning' | 'evening' | 'between'; cashierName?: string }) {
    try { await call(api.shifts.updateMeta(shiftId, data)); await load(); onChanged?.() }
    catch (e) { toast.show((e as Error).message, 'error') }
  }
  async function approveShift() {
    if (!user) return
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
    setDraft({ description: t.description, amount: String((t.amountIn || t.amountOut) / 100), mainCategoryId: t.mainCategoryId ?? 0, subCategoryId: t.subCategoryId ?? 0, payMethod: t.payMethod, direction: t.amountIn > 0 ? 'in' : 'out' })
  }
  async function saveEdit() {
    if (editId == null) return
    const amt = parsePias(draft.amount)
    try {
      const eIn = (draft.mainCategoryId === (mains.find(m => m.name === 'تحصيل')?.id ?? -1))
      await call(api.tx.update(editId, { description: draft.description, mainCategoryId: draft.mainCategoryId || null, subCategoryId: draft.subCategoryId || null, payMethod: draft.payMethod, amountIn: eIn ? amt : 0, amountOut: eIn ? 0 : amt }))
      setEditId(null); await load(); onChanged?.()
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  function setDraftRow(i: number, patch: Partial<TxDraft>) { setDrafts(ds => ds.map((d, idx) => idx === i ? { ...d, ...patch } : d)) }
  async function commitDrafts() {
    if (!journal) return
    const filled = drafts.filter(d => d.description.trim() && d.amount)
    if (!filled.length) { toast.show('لا توجد بنود مملوءة للحفظ', 'info'); return }
    try {
      const collectId = mains.find(m => m.name === 'تحصيل')?.id ?? -1
      await call(api.tx.addBatch(filled.map(d => ({
        shiftId, journalId: journal.id, description: d.description,
        mainCategoryId: d.mainCategoryId || null, subCategoryId: d.subCategoryId || null,
        amountIn: d.mainCategoryId === collectId ? parsePias(d.amount) : 0, amountOut: d.mainCategoryId === collectId ? 0 : parsePias(d.amount),
        payMethod: d.payMethod, employeeId: null, customerId: null, note: '', createdBy: user?.id ?? 1,
      }))))
      // ADR-012 v2 — بعد الحفظ: أعِد صفوفاً فارغة فقط حتى إجمالي 14 (لا تُنشئ صفوفاً إضافية تلقائياً)
      const newTotal = txs.length + filled.length
      setDrafts(rows(DEFAULT_ROWS - newTotal))
      await load(); onChanged?.(); toast.show(`حُفظ ${filled.length} بند`, 'success')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  function dupLast() {
    const last = txs[txs.length - 1]; if (!last) { toast.show('لا يوجد بند لتكراره', 'info'); return }
    const nd: TxDraft = { description: last.description, amount: String((last.amountIn || last.amountOut) / 100), mainCategoryId: last.mainCategoryId ?? 0, subCategoryId: last.subCategoryId ?? 0, payMethod: last.payMethod, direction: last.amountIn > 0 ? 'in' : 'out' }
    setDrafts(ds => { const idx = ds.findIndex(d => !d.description && !d.amount); if (idx >= 0) { const c = [...ds]; c[idx] = nd; return c } return [...ds, nd] })
  }
  async function delShift() {
    if (!confirm('حذف الشيفت وكل بياناته نهائياً؟')) return
    try { await call(api.shifts.delete(shiftId)); toast.show('حُذف الشيفت', 'success'); onDeleted?.(); onClose?.() }
    catch (e) { toast.show((e as Error).message, 'error') }
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
  const amt = (t: Transaction) => t.amountIn + t.amountOut
  const mgmtOut = txs.filter(t => t.payMethod === 'management').reduce((s, t) => s + t.amountOut, 0)
    + dSum(d => d.payMethod === 'management')                                                          // مصروفات الصندوق
  // مبيعات فيزا/آجل — من التصنيف الفرعي (لا من الدفع)
  const visaSubId = subs.find(s => s.name === 'مبيعات فيزا')?.id ?? -1
  const creditSubId = subs.find(s => s.name === 'مبيعات آجل')?.id ?? -1
  const creditTx = txs.filter(t => t.subCategoryName === 'مبيعات آجل').reduce((s, t) => s + amt(t), 0) + dSum(d => d.subCategoryId === creditSubId)
  const visaTx = txs.filter(t => t.subCategoryName === 'مبيعات فيزا').reduce((s, t) => s + amt(t), 0) + dSum(d => d.subCategoryId === visaSubId) // v2.31.3: New
  // كاش أوت — تسليم > استلام ⇒ إضافة (مبيعات فيزا عبر الماكينة) · استلام > تسليم ⇒ خصم (تحويل رصيد لأساسي/إير تايم)
  const cashoutDiff = fawryRes?.cashoutSales ?? 0
  const cashoutLabel = cashoutDiff < 0 ? 'خصم كاش أوت' : 'إضافة كاش أوت'
  // عمولة فوري على الكاش أوت = مبيعات فيزا المسجلة في اليومية (كاملة) − صافي حركة الكاش أوت (بعد خصم العمولة)
  const cashoutFawryCommission = visaTx - cashoutDiff
  const cashoutCommissionPct = visaTx > 0 ? (cashoutFawryCommission / visaTx) * 100 : 0
  const cashoutAccent = cashoutDiff < 0 ? '#ef4444' : '#22c55e'
  const basicAirSum = (fawryRes?.basicSales ?? 0) + (fawryRes?.airSales ?? 0)
  const fawryWithCommission = calcFawryWithCommission(fawry?.programSales ?? 0, fawry?.commissionPct ?? 0)
  // v2.31.3 — معادلات جديدة من العميل
  const collections = txs.filter(t => t.mainCategoryName === 'تحصيل').reduce((s, t) => s + amt(t), 0)
    + dSum(d => d.mainCategoryId === collectMainId)                                                    // التحصيل (وارد)
  const cashierExpenses = txs.filter(t => t.payMethod === 'cashier' && dirOf(t.mainCategoryId ?? 0) === 'out').reduce((s, t) => s + amt(t), 0)
    + dSum(d => d.payMethod === 'cashier' && dirOf(d.mainCategoryId) === 'out')
  const totalSales = shift.posSales + fawryWithCommission
  const totalExpenses = creditTx + visaTx + cashierExpenses
  const { result: netCash } = calcShiftClosing({ posSales: shift.posSales, cashierRemaining: shift.cashierRemaining, cashierExpenses, collections })
  const statusLabel = netCash > 0 ? 'أوفر' : netCash < 0 ? 'عجز' : 'مطابق'
  const statusColor = netCash > 0 ? G.edit : netCash < 0 ? G.warn : 'var(--txt-2)'

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

      {/* المساحة الرئيسية: يومية · فوري · ملخّص */}
      <div className="flex-1 min-h-0 grid gap-2.5 p-3" style={{ gridTemplateColumns: '2.3fr 1fr 0.92fr' }}>

        {/* العمليات اليومية */}
        <div className="flex flex-col rounded-xl overflow-hidden min-h-0" style={{ border: `1px solid ${G.edit}33` }}>
          <div className="px-4 py-2 font-bold text-sm flex justify-between items-center flex-shrink-0" style={{ background: 'rgba(34,197,94,0.10)', color: G.edit }}>
            <span>📋 العمليات اليومية</span><span className="text-2xs font-medium" style={{ color: 'var(--txt-3)' }}>Enter/الأسهم للتنقّل · TAB بين الخلايا</span>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            <table className="w-full" style={{ tableLayout: 'fixed', fontSize: 13 }}>
              <colgroup>
                <col style={{ width: 30 }} /><col style={{ width: 92 }} /><col /><col style={{ width: 108 }} /><col style={{ width: 116 }} />
                <col style={{ width: 96 }} /><col style={{ width: 96 }} /><col style={{ width: 44 }} />
              </colgroup>
              <thead className="sticky top-0 z-10"><tr style={{ background: 'var(--app-bg-solid)', color: 'var(--txt-3)' }}>
                <th className="th">#</th><th className="th">القيمة</th><th className="th">البيان</th><th className="th">الفئة</th><th className="th">تصنيف فرعي</th>
                <th className="th">الدفع</th><th className="th text-center">النوع</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {txs.map((t, i) => editId === t.id ? (
                  <tr key={t.id} style={{ background: 'rgba(59,130,246,0.06)' }}>
                    <td className="td-lg" style={{ color: 'var(--txt-3)' }}>{i + 1}</td>
                    <td className="td-lg"><input value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} className="w-full tabular-nums" style={inp} /></td>
                    <td className="td-lg"><input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className="w-full" style={inp} /></td>
                    <td className="td-lg"><select value={draft.mainCategoryId} onChange={e => setDraft({ ...draft, mainCategoryId: Number(e.target.value), subCategoryId: 0 })} className="w-full" style={inp}><option value={0}>—</option>{mains.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></td>
                    <td className="td-lg"><select value={draft.subCategoryId} onChange={e => setDraft({ ...draft, subCategoryId: Number(e.target.value) })} className="w-full" style={inp}><option value={0}>—</option>{subs.filter(s => s.mainCategoryId === draft.mainCategoryId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td className="td-lg"><select value={draft.payMethod} onChange={e => setDraft({ ...draft, payMethod: e.target.value as PayMethod })} className="w-full" style={inp}>{PAY_OPTIONS.map(k => <option key={k} value={k}>{PAY[k]}</option>)}</select></td>
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
                    <td className="td-lg truncate" style={{ color: 'var(--txt-2)' }}>{PAY[t.payMethod]}</td>
                    <td className="td-lg text-center"><span className="text-2xs font-bold px-1.5 py-0.5 rounded-full" style={dirOf(t.mainCategoryId ?? 0) === 'in' ? { background: 'rgba(34,197,94,0.13)', color: G.edit } : { background: 'rgba(248,113,113,0.13)', color: G.warn }}>{dirOf(t.mainCategoryId ?? 0) === 'in' ? 'وارد' : 'منصرف'}</span></td>
                    <td className="td-lg whitespace-nowrap opacity-40 group-hover:opacity-100" style={{ color: 'var(--txt-3)' }}><button onClick={() => startEdit(t)} className="hover:text-blue-400">✎</button><button onClick={() => delTx(t.id)} className="hover:text-red-400 mr-1">🗑</button></td>
                  </tr>
                ))}
                {drafts.map((d, i) => (
                  <tr key={'d' + i} style={{ background: 'rgba(34,197,94,0.025)' }}>
                    <td className="td-lg" style={{ color: 'var(--txt-3)' }}>{txs.length + i + 1}</td>
                    <td className="td-lg"><input data-cell={`${i}-0`} onKeyDown={e => onCellKey(e, i, 0)} value={d.amount} onChange={e => setDraftRow(i, { amount: e.target.value })} className="w-full tabular-nums sheet-cell" style={inp} /></td>
                    <td className="td-lg"><input data-cell={`${i}-1`} onKeyDown={e => onCellKey(e, i, 1)} value={d.description} onChange={e => setDraftRow(i, { description: e.target.value })} className="w-full sheet-cell" style={inp} /></td>
                    <td className="td-lg"><select data-cell={`${i}-2`} onKeyDown={e => onCellKey(e, i, 2)} value={d.mainCategoryId} onChange={e => setDraftRow(i, { mainCategoryId: Number(e.target.value), subCategoryId: 0 })} className="w-full sheet-cell" style={inp}><option value={0}>—</option>{mains.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></td>
                    <td className="td-lg"><select data-cell={`${i}-3`} onKeyDown={e => onCellKey(e, i, 3)} value={d.subCategoryId} onChange={e => setDraftRow(i, { subCategoryId: Number(e.target.value) })} className="w-full sheet-cell" style={inp}><option value={0}>—</option>{subs.filter(s => s.mainCategoryId === d.mainCategoryId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td className="td-lg"><select data-cell={`${i}-4`} onKeyDown={e => onCellKey(e, i, 4)} value={d.payMethod} onChange={e => setDraftRow(i, { payMethod: e.target.value as PayMethod })} className="w-full sheet-cell" style={inp}>{PAY_OPTIONS.map(k => <option key={k} value={k}>{PAY[k]}</option>)}</select></td>
                    <td className="td-lg text-center"><span className="text-2xs font-bold px-1.5 py-0.5 rounded-full" style={dirOf(d.mainCategoryId) === 'in' ? { background: 'rgba(34,197,94,0.13)', color: G.edit } : { background: 'rgba(248,113,113,0.13)', color: G.warn }}>{dirOf(d.mainCategoryId) === 'in' ? 'وارد' : 'منصرف'}</span></td>
                    <td className="td-lg"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* فوري — بترتيب القالب المرجعي (20 حقلاً) */}
        <div className="flex flex-col rounded-xl overflow-hidden min-h-0" style={{ border: `1px solid ${G.fawry}33` }}>
          <div className="px-3 py-2.5 font-extrabold text-sm flex-shrink-0" style={{ background: 'rgba(167,139,250,0.16)', color: '#c4b5fd' }}>📱 ماكينة فوري</div>
          <div className="flex-1 overflow-auto min-h-0">
            <table className="w-full text-xs"><tbody>
              <FIn label="استلام أساسي" value={fawry?.basicReceive ?? 0} onSave={v => saveFawry('basicReceive', v)} />
              <FIn label="تسليم أساسي" value={fawry?.basicDeliver ?? 0} onSave={v => saveFawry('basicDeliver', v)} />
              <FCalc label="مبيعات أساسي" value={fawryRes?.basicSales ?? 0} />
              <FIn label="استلام إير تايم" value={fawry?.airReceive ?? 0} onSave={v => saveFawry('airReceive', v)} />
              <FIn label="تسليم إير تايم" value={fawry?.airDeliver ?? 0} onSave={v => saveFawry('airDeliver', v)} />
              <FCalc label="مبيعات إير تايم" value={fawryRes?.airSales ?? 0} />
              <FIn label="استلام كاش أوت" value={fawry?.cashoutReceive ?? 0} onSave={v => saveFawry('cashoutReceive', v)} />
              <FIn label="تسليم كاش أوت" value={fawry?.cashoutDeliver ?? 0} onSave={v => saveFawry('cashoutDeliver', v)} />
              <FCalc label={cashoutLabel} value={Math.abs(cashoutDiff)} accent={cashoutAccent} />
              <FCalc label="عمولة فوري" value={cashoutFawryCommission} />
              <FCalc label="مبيعات أساسي + إير تايم" value={basicAirSum} />
              <FIn label="مبيعات فوري قبل العمولة" value={fawry?.programSales ?? 0} onSave={v => saveFawry('programSales', v)} />
              <FIn label="نسبة عمولة فوري %" value={fawry?.commissionPct ?? 0} onSave={v => saveFawry('commissionPct', v)} />
              <FCalc label="مبيعات فوري مع العمولة" value={fawryWithCommission} total />
              <FCalc label="ربحية فوري" value={fawryRes?.profitability ?? 0} />
              <FIn label="من كاش أوت للأساسي" value={fawry?.cashoutToBasic ?? 0} onSave={v => saveFawry('cashoutToBasic', v)} />
              <FIn label="من كاش أوت للإير تايم" value={fawry?.cashoutToAir ?? 0} onSave={v => saveFawry('cashoutToAir', v)} />
              <FIn label="من فوري للأساسي" value={fawry?.fawryToBasic ?? 0} onSave={v => saveFawry('fawryToBasic', v)} />
              <FIn label="من فوري للإير تايم" value={fawry?.fawryToAir ?? 0} onSave={v => saveFawry('fawryToAir', v)} />
            </tbody></table>
          </div>
          {/* عدّاد عمولة فوري — أسفل جدول الماكينة، بمحاذاة عدّاد حالة الشيفت في العمود المجاور */}
          <div className="px-2 pb-2 pt-1 flex-shrink-0">
            <FawryCommissionGauge pct={cashoutCommissionPct} isDiscount={cashoutDiff < 0} />
          </div>
        </div>

        {/* ملخّص الشيفت — نفس بنية عمود فوري تماماً (ترويسة ثابتة + محتوى قابل للتمرير داخلياً + عدّاد ثابت أسفل) */}
        <div className="flex flex-col rounded-xl overflow-hidden min-h-0" style={{ border: '1px solid rgba(251,191,36,0.22)' }}>
          <div className="px-3 py-2.5 font-extrabold text-sm flex-shrink-0" style={{ background: 'rgba(251,191,36,0.16)', color: '#fcd34d' }}>🧾 ملخّص الشيفت</div>
          <div className="flex-1 overflow-auto min-h-0 flex flex-col gap-1.5 p-2">
            <CCardIn label="مبيعات (POS)" value={shift.posSales} onSave={v => saveClose('posSales', v)} />
            <CCard label="مبيعات فوري مع الربحية" value={fmt(fawryWithCommission)} accent="#4ade80" />
            <CCard label="مبيعات آجل" value={fmt(creditTx)} accent="#4ade80" />
            <CCard label="مبيعات فيزا" value={fmt(visaTx)} accent="#4ade80" />
            <CCard label="اجمالي المبيعات" value={fmt(totalSales)} accent="#d4a017" />
            <CCardIn label="نقدية الكاشير" value={shift.cashierRemaining} onSave={v => saveClose('cashierRemaining', v)} accent="#f87171" />
            <CCard label="مصروفات الكاشير" value={fmt(cashierExpenses)} accent="#f87171" />
            <CCard label="إجمالي المصروفات" value={fmt(totalExpenses)} accent="#f87171" />
            <CCard label="تحصيل" value={fmt(collections)} accent="#34d399" />
            <div className="rounded-xl px-3.5 py-2 flex-shrink-0" style={{ background: 'rgba(251,191,36,0.16)', border: '1px solid rgba(251,191,36,0.3)' }}>
              <div className="text-xs font-medium mb-1" style={{ color: 'var(--txt-2)' }}>حسابات الصندوق 🔒</div>
              <FundRow label="✎ عهدة نقدية مستلمة" value={custody?.addFromFund ?? 0} onSave={v => saveCustody('addFromFund', v)} editable />
              <FundRow label="مصروفات العهدة" value={mgmtOut} />
              <FundRow label="متبقي من العهدة" value={custodyRes?.remaining ?? 0} accent={G.sum} />
              <FundRow label="رصيد أول الصندوق" value={fundPos?.before ?? 0} />
              <FundRow label="مصروفات الصندوق" value={mgmtOut} />
              <FundRow label="وارد إلى الصندوق" value={shift.cashierRemaining} />
              <FundRow label="رصيد آخر الصندوق" value={fundPos ? fundPos.before + shift.cashierRemaining - mgmtOut : 0} accent={G.sum} bold />
            </div>
          </div>
          {/* عدّاد حالة الشيفت — ثابت أسفل العمود، بمحاذاة عدّاد عمولة فوري أسفل العمود المجاور */}
          <div className="px-2 pb-2 pt-1 flex-shrink-0">
            <ShiftGauge result={netCash} />
          </div>
        </div>
      </div>

      {/* شريط الأدوات الموحّد */}
      <div className="flex items-center gap-1.5 px-3 py-2 flex-shrink-0 flex-wrap" style={{ borderTop: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
        <TBtn onClick={commitDrafts} icon="💾" label="حفظ" primary />
        <TBtn onClick={() => setDrafts(ds => [...ds, { ...emptyDraft }])} icon="➕" label="إضافة صف" />
        <TBtn onClick={() => setDrafts(ds => ds.length > 1 ? ds.slice(0, -1) : ds)} icon="🗑" label="حذف صف" />
        <TBtn onClick={dupLast} icon="📋" label="تكرار" />
        <div className="w-px h-6 mx-1" style={{ background: 'var(--inner-border)' }} />
        <TBtn onClick={() => toast.show('من القائمة: استيراد اليومية', 'info')} icon="📥" label="استيراد" />
        <TBtn onClick={() => toast.show('التصدير قريباً', 'info')} icon="📤" label="تصدير" />
        <TBtn onClick={() => window.print()} icon="🖨" label="طباعة" />
        {user?.role === 'manager' && (
          <TBtn onClick={() => openWindow('categories', 'إدارة التصنيفات')} icon="🏷" label="إدارة التصنيفات" />
        )}
        <div className="mr-auto flex items-center gap-1.5">
          {shift.status === 'open' && <TBtn onClick={approveShift} icon="🔒" label="اعتماد الشيفت" success />}
          <TBtn onClick={requestClose} icon="✖" label="إغلاق الصفحة" />
          <TBtn onClick={delShift} icon="❌" label="حذف الشيفت" danger />
        </div>
      </div>

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

/** عدّاد نصف دائري مشترك — خمس شرائح لونية وإبرة تتحرك حسب النسبة؛ يُستخدم لعدّاد الشيفت وعدّاد عمولة فوري بنفس التصميم */
function Gauge({ title, angle, color, statusText, valueText, segColors }: {
  title: string; angle: number; color: string; statusText: string; valueText: string; segColors: [string, string, string, string, string]
}) {
  const segPaths = [
    'M 22 100 A 78 78 0 0 1 35.3 56.4',
    'M 36.9 54.1 A 78 78 0 0 1 73.3 26.7',
    'M 75.9 25.8 A 78 78 0 0 1 121.5 25.0',
    'M 124.1 25.8 A 78 78 0 0 1 161.5 52.0',
    'M 163.1 54.1 A 78 78 0 0 1 178.0 97.3',
  ]
  return (
    <div className="rounded-xl px-2.5 pt-2 pb-1.5 flex-shrink-0 flex flex-col items-center justify-center" style={{ minHeight: 108, background: 'var(--surface-2, rgba(255,255,255,0.04))', border: '1px solid var(--inner-border)' }}>
      <div className="text-2xs font-bold mb-0.5 self-start" style={{ color: 'var(--txt-2)' }}>{title}</div>
      <svg viewBox="0 0 200 118" style={{ width: '100%', maxWidth: 150 }}>
        {segPaths.map((d, i) => <path key={i} d={d} fill="none" stroke={segColors[i]} strokeWidth={11} strokeLinecap="round" opacity={0.92} />)}
        <g transform={`rotate(${angle} 100 100)`} style={{ transition: 'transform 0.6s cubic-bezier(0.34,1.56,0.64,1)' }}>
          <line x1="100" y1="100" x2="100" y2="38" stroke="var(--txt-1)" strokeWidth="3" strokeLinecap="round" />
        </g>
        <circle cx="100" cy="100" r="6" fill="var(--txt-1)" />
        <circle cx="100" cy="100" r="2.5" fill={color} />
      </svg>
      <div className="font-black" style={{ fontSize: 12.5, color, marginTop: -3 }}>{statusText}</div>
      <div className="font-extrabold tabular-nums" style={{ fontSize: 14.5, color: 'var(--txt-1)' }}>{valueText}</div>
    </div>
  )
}

/** عدّاد حالة الشيفت — عجز/أوفر (أحمر→أخضر) */
function ShiftGauge({ result }: { result: number }) {
  const scale = Math.max(Math.abs(result) * 1.25, 100000)
  const ratio = Math.max(-1, Math.min(1, result / scale)) // -1 to 1
  const angle = ratio * 80 // -80deg to 80deg
  const label = result > 0 ? 'أوفر' : result < 0 ? 'عجز' : 'متزن'
  const color = result > 0 ? '#22c55e' : result < 0 ? '#f87171' : '#fbbf24'
  return <Gauge title="حالة الشيفت 🔒" angle={angle} color={color} statusText={label} valueText={fmt(Math.abs(result))}
    segColors={['#ef4444', '#f97316', '#fbbf24', '#84cc16', '#22c55e']} />
}

/** عدّاد نسبة عمولة فوري المخصومة من رصيد الكاش أوت — بنفس تصميم عدّاد الشيفت وبلون مميّز مختلف (أحمر→وردي→بنفسجي→أزرق→أخضر) */
function FawryCommissionGauge({ pct, isDiscount }: { pct: number; isDiscount: boolean }) {
  const scale = Math.max(Math.abs(pct) * 1.25, 3)
  const ratio = Math.max(-1, Math.min(1, pct / scale))
  const angle = ratio * 80
  const color = isDiscount ? '#f87171' : '#22c55e'
  const label = isDiscount ? 'خصم' : 'إضافة'
  return <Gauge title="عمولة فوري (كاش أوت) 🔒" angle={angle} color={color} statusText={label} valueText={`${pct.toFixed(1)}%`}
    segColors={['#ef4444', '#ec4899', '#a855f7', '#3b82f6', '#22c55e']} />
}

const Sep = () => <span style={{ color: 'var(--txt-3)', opacity: 0.5 }}>|</span>
function CashierName({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(name)
  useEffect(() => { setV(name) }, [name])
  return <input value={v} onChange={e => setV(e.target.value)} onBlur={() => { if (v.trim() && v !== name) onSave(v.trim()) }}
    placeholder="اسم الكاشير" className="font-bold" style={{ ...inp, width: 110 }} />
}
function FundRow({ label, value, onSave, editable, accent, bold }: { label: string; value: number; onSave?: (v: string) => void; editable?: boolean; accent?: string; bold?: boolean }) {
  const [v, setV] = useState('')
  useEffect(() => { if (editable) setV(String(value / 100)) }, [value, editable])
  return <div className="flex items-center justify-between py-1" style={{ fontSize: 12 }}>
    <span className="font-medium" style={{ color: editable ? '#4ade80' : 'var(--txt-2)' }}>{label}</span>
    {editable && onSave
      ? <input value={v} onChange={e => setV(e.target.value)} onBlur={() => onSave(v)} className="w-20 text-left tabular-nums font-bold" style={{ ...inp, fontSize: 12, padding: '2px 5px' }} />
      : <span className="tabular-nums" style={{ fontWeight: bold ? 800 : 700, fontSize: 13, color: accent ?? 'var(--txt-1)' }}>{fmt0(value)}</span>}
  </div>
}
function FIn({ label, value, onSave, raw }: { label: string; value: number; onSave: (v: string) => void; raw?: boolean }) {
  const [v, setV] = useState('')
  useEffect(() => { setV(raw ? String(value) : String(value / 100)) }, [value, raw])
  return <tr style={{ borderBottom: '1px solid var(--inner-border)' }}>
    <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--txt-1)', fontSize: 13 }}>{label}</td>
    <td className="px-2.5 py-1.5 text-left"><input value={v} onChange={e => setV(e.target.value)} onBlur={() => onSave(raw ? String((parseFloat(v) || 0) / 100) : v)} className="w-28 text-left tabular-nums font-bold" style={{ ...inp, fontSize: 13, padding: '4px 7px' }} /></td>
  </tr>
}
function FCalc({ label, value, total, raw, accent }: { label: string; value: number; total?: boolean; raw?: boolean; accent?: string }) {
  const labelColor = accent ?? (total ? '#c4b5fd' : 'var(--txt-2)')
  const valueColor = accent ?? (total ? '#c4b5fd' : 'var(--txt-1)')
  return <tr style={{ background: accent ? `${accent}1a` : total ? 'rgba(167,139,250,0.14)' : 'rgba(255,255,255,0.025)', borderBottom: '1px solid var(--inner-border)' }}>
    <td className="px-3 py-1.5" style={{ color: labelColor, fontWeight: total ? 800 : 700, fontSize: 13 }}>{label} <span style={{ fontSize: 9 }}>🔒</span></td>
    <td className="px-2.5 py-1.5 text-left tabular-nums" style={{ color: valueColor, fontWeight: total ? 800 : 700, fontSize: 13.5 }}>{raw ? value : (value / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
  </tr>
}
function CCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const c = accent ?? '#94a3b8'
  return <div className="relative overflow-hidden rounded-lg pr-3.5 pl-3 py-2 flex-shrink-0 flex items-center justify-between gap-2" style={{ background: 'var(--surface-2, rgba(255,255,255,0.04))', border: '1px solid var(--inner-border)' }}>
    <div className="absolute top-1.5 bottom-1.5 right-0 rounded-l-full" style={{ width: 3, background: c }} />
    <span className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--txt-2)' }}>{label} 🔒</span>
    <span className="font-extrabold tabular-nums" style={{ fontSize: 14.5, color: 'var(--txt-1)' }}>{value}</span>
  </div>
}
function CCardIn({ label, value, onSave, accent }: { label: string; value: number; onSave: (v: string) => void; accent?: string }) {
  const [v, setV] = useState('')
  useEffect(() => { setV(String(value / 100)) }, [value])
  const c = accent ?? '#4ade80'
  return <div className="rounded-lg px-3 py-2 flex-shrink-0 flex items-center justify-between gap-2" style={{ background: `${c}14`, border: `1px solid ${c}59` }}>
    <span className="text-xs font-bold whitespace-nowrap" style={{ color: c }}>✎ {label}</span>
    <input value={v} onChange={e => setV(e.target.value)} onBlur={() => onSave(v)} className="tabular-nums font-extrabold text-left" style={{ ...inp, fontSize: 15, fontWeight: 800, padding: '3px 7px', width: 110 }} />
  </div>
}
function TBtn({ onClick, icon, label, primary, success, danger }: { onClick: () => void; icon: string; label: string; primary?: boolean; success?: boolean; danger?: boolean }) {
  const st: React.CSSProperties = primary ? { background: 'rgba(34,197,94,0.16)', color: '#22c55e' }
    : success ? { background: 'linear-gradient(90deg,#16a34a,#22c55e)', color: '#fff' }
    : danger ? { color: '#f87171', border: '1px solid rgba(248,113,113,0.35)' }
    : { color: 'var(--txt-1)', border: '1px solid var(--inner-border)' }
  return <button onClick={onClick} className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5" style={st}><span>{icon}</span>{label}</button>
}
