import { useState, useEffect } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import Modal from '../components/Modal'
import Icons from '../components/Icon'
import KPICard from '../components/KPICard'
import { fmt, parsePias, todayISO } from '../lib/format'

type PartyType = 'customer' | 'supplier'

interface Party {
  id: number; name: string; phone: string; address: string; notes: string
  openingBalance: number; loyaltyPoints?: number; active: number; balance: number
}
interface LedgerEntry {
  id: number; date: string; description: string; debit: number; credit: number; balance?: number
}

export default function Parties({ type }: { type: PartyType }) {
  const { show } = useToast()
  const isCustomer = type === 'customer'
  const T = {
    title:    isCustomer ? 'العملاء' : 'الموردون',
    one:      isCustomer ? 'عميل' : 'مورّد',
    balLabel: isCustomer ? 'له علينا / علينا له' : 'المستحق له',
    debit:    isCustomer ? 'مدين (له علينا)' : 'مدين (دفعنا له)',
    credit:   isCustomer ? 'دائن (سدّد)' : 'دائن (علينا له)',
  }

  const [parties,  setParties]  = useState<Party[]>([])
  const [selected, setSelected] = useState<Party | null>(null)
  const [ledger,   setLedger]   = useState<LedgerEntry[]>([])
  const [search,   setSearch]   = useState('')

  // مودال إضافة/تعديل طرف
  const [formModal, setFormModal] = useState(false)
  const [editing,   setEditing]   = useState<Party | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', address: '', notes: '', openingBalance: '' })

  // مودال حركة كشف حساب
  const [entryModal, setEntryModal] = useState(false)
  const [entry, setEntry] = useState({ date: todayISO(), description: '', amount: '', kind: 'debit' as 'debit' | 'credit' })

  // نقاط الولاء
  const [pointsModal, setPointsModal] = useState(false)
  const [points, setPoints] = useState('')

  async function loadParties() {
    const list = await call(api.party.list(type)) as Party[]
    setParties(list)
    if (selected) {
      const updated = list.find(p => p.id === selected.id)
      setSelected(updated ?? null)
    }
  }
  async function loadLedger(p: Party) {
    setLedger(await call(api.party.ledger(type, p.id)) as LedgerEntry[])
  }
  useEffect(() => { loadParties(); setSelected(null); setLedger([]) }, [type])

  async function selectParty(p: Party) { setSelected(p); await loadLedger(p) }

  function openAdd() {
    setEditing(null)
    setForm({ name: '', phone: '', address: '', notes: '', openingBalance: '' })
    setFormModal(true)
  }
  function openEdit(p: Party) {
    setEditing(p)
    setForm({ name: p.name, phone: p.phone, address: p.address, notes: p.notes, openingBalance: String(p.openingBalance / 100) })
    setFormModal(true)
  }
  async function handleSave() {
    if (!form.name.trim()) { show('أدخل الاسم', 'warning'); return }
    try {
      const data = { name: form.name, phone: form.phone, address: form.address, notes: form.notes, openingBalance: parsePias(form.openingBalance || '0') }
      if (editing) { await call(api.party.update(type, editing.id, data)); show('تم التحديث ✓', 'success') }
      else         { await call(api.party.create(type, data)); show(`تم إضافة ${T.one} ✓`, 'success') }
      setFormModal(false); await loadParties()
    } catch (e) { show((e as Error).message, 'error') }
  }
  async function handleDelete(p: Party) {
    try {
      const res = await call(api.party.delete(type, p.id)) as { ok: boolean; reason?: string }
      if (!res.ok) { show(res.reason ?? 'تعذّر الحذف', 'error'); return }
      show('تم الحذف', 'success')
      if (selected?.id === p.id) { setSelected(null); setLedger([]) }
      await loadParties()
    } catch (e) { show((e as Error).message, 'error') }
  }

  async function handleAddEntry() {
    if (!selected) return
    const amt = parsePias(entry.amount || '0')
    if (amt <= 0) { show('أدخل مبلغاً صحيحاً', 'warning'); return }
    try {
      await call(api.party.addEntry({
        partyType: type, partyId: selected.id, date: entry.date, description: entry.description,
        debit:  entry.kind === 'debit'  ? amt : 0,
        credit: entry.kind === 'credit' ? amt : 0,
      }))
      show('تم تسجيل الحركة ✓', 'success')
      setEntryModal(false); setEntry({ date: todayISO(), description: '', amount: '', kind: 'debit' })
      await loadLedger(selected); await loadParties()
    } catch (e) { show((e as Error).message, 'error') }
  }
  async function handleDelEntry(id: number) {
    if (!selected) return
    try { await call(api.party.delEntry(id)); await loadLedger(selected); await loadParties() }
    catch (e) { show((e as Error).message, 'error') }
  }
  async function handleAddPoints() {
    if (!selected) return
    try {
      await call(api.party.addPoints(selected.id, parseInt(points) || 0))
      show('تم تحديث النقاط ✓', 'success')
      setPointsModal(false); setPoints(''); await loadParties()
    } catch (e) { show((e as Error).message, 'error') }
  }

  const filtered = parties.filter(p => p.name.includes(search) || p.phone.includes(search))
  const totalBalance = parties.reduce((s, p) => s + p.balance, 0)
  const indebted = parties.filter(p => p.balance > 0).length

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
      {/* رأس + KPIs */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-600/20 border border-brand-600/30 flex items-center justify-center text-brand-400">
            <Icons.Employees size={18} />
          </div>
          <div>
            <h1 className="t-display text-white">{T.title}</h1>
            <p className="text-2xs" style={{ color: 'var(--txt-3)' }}>{parties.length} {T.one}</p>
          </div>
        </div>
        <button onClick={openAdd} className="btn-primary btn-sm"><Icons.Plus size={14} /> {T.one} جديد</button>
      </div>

      <div className="grid grid-cols-3 gap-3 flex-shrink-0">
        <KPICard label={`عدد ${T.title}`} value={String(parties.length)} color="#388bfd" icon={<Icons.Employees size={14}/>} />
        <KPICard label={isCustomer ? 'إجمالي الذمم المدينة' : 'إجمالي المستحق'} value={fmt(totalBalance) + ' ج'} color={totalBalance >= 0 ? '#d4a017' : '#2ea043'} icon={<Icons.Fund size={14}/>} />
        <KPICard label="عليهم مديونية" value={String(indebted)} color="#f85149" icon={<Icons.Warning size={14}/>} />
      </div>

      <div className="flex-1 flex overflow-hidden gap-4">
        {/* قائمة الأطراف */}
        <div className="w-64 flex flex-col card p-0 overflow-hidden flex-shrink-0">
          <div className="p-2 border-b border-surface-600">
            <input className="field text-xs" placeholder="بحث بالاسم/الهاتف..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.map(p => (
              <button key={p.id} onClick={() => selectParty(p)}
                className={`w-full text-right px-3 py-2.5 border-b border-surface-600 transition-colors
                  ${selected?.id === p.id ? 'bg-brand-600/20 border-r-2 border-r-brand-500' : 'hover:bg-surface-700'}`}>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--txt-1)' }}>{p.name}</span>
                  <span className="tabular-nums" style={{ fontSize: '12px', fontWeight: 700, color: p.balance > 0 ? '#d4a017' : p.balance < 0 ? '#2ea043' : 'var(--txt-3)' }}>
                    {fmt(p.balance)}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--txt-3)' }}>{p.phone || '—'}</div>
              </button>
            ))}
            {filtered.length === 0 && <div className="text-center py-6" style={{ color: 'var(--txt-3)', fontSize: '13px' }}>لا نتائج</div>}
          </div>
        </div>

        {/* التفاصيل + كشف الحساب */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--txt-3)' }}>
              <Icons.Records size={40} className="opacity-20" />
              <span>اختر {T.one} لعرض كشف حسابه</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* بطاقة الطرف */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="t-display text-white" style={{ fontSize: '20px' }}>{selected.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--txt-3)' }}>
                      {selected.phone || '—'} {selected.address && `· ${selected.address}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {isCustomer && (
                      <button onClick={() => { setPoints(''); setPointsModal(true) }} className="btn-ghost btn-sm" title="نقاط الولاء">
                        <Icons.Check size={13} /> نقاط ({selected.loyaltyPoints ?? 0})
                      </button>
                    )}
                    <button onClick={() => openEdit(selected)} className="btn-ghost btn-sm"><Icons.Edit size={13} /> تعديل</button>
                    <button onClick={() => handleDelete(selected)} className="btn-danger btn-sm"><Icons.Trash size={13} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg p-2.5 text-center" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--txt-3)' }}>رصيد افتتاحي</div>
                    <div className="tabular-nums font-bold" style={{ color: 'var(--txt-1)' }}>{fmt(selected.openingBalance)} ج</div>
                  </div>
                  <div className="rounded-lg p-2.5 text-center" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--txt-3)' }}>عدد الحركات</div>
                    <div className="tabular-nums font-bold" style={{ color: 'var(--txt-1)' }}>{ledger.length}</div>
                  </div>
                  <div className="rounded-lg p-2.5 text-center" style={{ background: (selected.balance >= 0 ? '#d4a017' : '#2ea043') + '14', border: `1px solid ${(selected.balance >= 0 ? '#d4a017' : '#2ea043')}44` }}>
                    <div style={{ fontSize: '11px', color: 'var(--txt-3)' }}>الرصيد الحالي</div>
                    <div className="tabular-nums font-bold" style={{ fontSize: '16px', color: selected.balance >= 0 ? '#d4a017' : '#2ea043' }}>{fmt(selected.balance)} ج</div>
                  </div>
                </div>
              </div>

              {/* كشف الحساب */}
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-600 flex items-center justify-between">
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--txt-1)' }}>كشف الحساب</span>
                  <button onClick={() => setEntryModal(true)} className="btn-primary btn-sm"><Icons.Plus size={13} /> حركة جديدة</button>
                </div>
                <table className="w-full text-xs">
                  <thead><tr>
                    <th className="th">التاريخ</th><th className="th">البيان</th>
                    <th className="th">{T.debit}</th><th className="th">{T.credit}</th>
                    <th className="th">الرصيد</th><th className="th"></th>
                  </tr></thead>
                  <tbody>
                    {ledger.map(l => (
                      <tr key={l.id} className="tr">
                        <td className="td tabular-nums">{l.date}</td>
                        <td className="td">{l.description || '—'}</td>
                        <td className="td tabular-nums text-warning">{l.debit > 0 ? fmt(l.debit) : '—'}</td>
                        <td className="td tabular-nums text-success">{l.credit > 0 ? fmt(l.credit) : '—'}</td>
                        <td className="td tabular-nums font-bold" style={{ color: 'var(--txt-1)' }}>{fmt(l.balance ?? 0)}</td>
                        <td className="td">
                          <button onClick={() => handleDelEntry(l.id)} className="p-1 rounded hover:bg-surface-600 text-surface-400 hover:text-danger">
                            <Icons.Trash size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ledger.length === 0 && <div className="text-center py-6" style={{ color: 'var(--txt-3)' }}>لا توجد حركات</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* مودال إضافة/تعديل طرف */}
      <Modal open={formModal} title={editing ? `تعديل ${T.one}` : `${T.one} جديد`} onClose={() => setFormModal(false)}
        footer={<>
          <button onClick={() => setFormModal(false)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSave} className="btn-primary btn-sm"><Icons.Save size={14} /> حفظ</button>
        </>}>
        <div className="space-y-3">
          <div><label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>الاسم *</label>
            <input className="field" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>الهاتف</label>
              <input className="field" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>رصيد افتتاحي (ج)</label>
              <input className="field" type="number" value={form.openingBalance} onChange={e => setForm(f => ({ ...f, openingBalance: e.target.value }))} /></div>
          </div>
          <div><label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>العنوان</label>
            <input className="field" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
          <div><label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>ملاحظات</label>
            <input className="field" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
        </div>
      </Modal>

      {/* مودال حركة كشف حساب */}
      <Modal open={entryModal} title="حركة جديدة" onClose={() => setEntryModal(false)}
        footer={<>
          <button onClick={() => setEntryModal(false)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleAddEntry} className="btn-primary btn-sm"><Icons.Save size={14} /> تسجيل</button>
        </>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>التاريخ</label>
              <input className="field" type="date" value={entry.date} onChange={e => setEntry(s => ({ ...s, date: e.target.value }))} /></div>
            <div><label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>المبلغ (ج)</label>
              <input className="field" type="number" value={entry.amount} onChange={e => setEntry(s => ({ ...s, amount: e.target.value }))} /></div>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>نوع الحركة</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setEntry(s => ({ ...s, kind: 'debit' }))}
                className="py-2 rounded-lg text-xs font-bold border"
                style={entry.kind === 'debit' ? { background: '#d2992222', borderColor: '#d29922', color: '#d29922' } : { background: 'var(--inner-bg)', borderColor: 'var(--inner-border)', color: 'var(--txt-2)' }}>
                {T.debit}
              </button>
              <button type="button" onClick={() => setEntry(s => ({ ...s, kind: 'credit' }))}
                className="py-2 rounded-lg text-xs font-bold border"
                style={entry.kind === 'credit' ? { background: '#2ea04322', borderColor: '#2ea043', color: '#2ea043' } : { background: 'var(--inner-bg)', borderColor: 'var(--inner-border)', color: 'var(--txt-2)' }}>
                {T.credit}
              </button>
            </div>
          </div>
          <div><label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>البيان</label>
            <input className="field" value={entry.description} onChange={e => setEntry(s => ({ ...s, description: e.target.value }))} /></div>
        </div>
      </Modal>

      {/* مودال نقاط الولاء */}
      <Modal open={pointsModal} title="نقاط الولاء" onClose={() => setPointsModal(false)} size="sm"
        footer={<>
          <button onClick={() => setPointsModal(false)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleAddPoints} className="btn-primary btn-sm"><Icons.Save size={14} /> حفظ</button>
        </>}>
        <div className="space-y-2">
          <div className="text-xs" style={{ color: 'var(--txt-2)' }}>الرصيد الحالي: <b>{selected?.loyaltyPoints ?? 0}</b> نقطة</div>
          <label className="block text-xs mb-1" style={{ color: 'var(--txt-2)' }}>إضافة/خصم نقاط (سالب للخصم)</label>
          <input className="field" type="number" value={points} onChange={e => setPoints(e.target.value)} placeholder="مثال: 50 أو -20" />
        </div>
      </Modal>
    </div>
  )
}
