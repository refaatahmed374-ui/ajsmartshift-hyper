import { useEffect, useMemo, useState } from 'react'
import Icons from '../components/Icon'
import { fmt } from '../lib/format'

// ═══════════════════════════════════════════════════════════
// v2.34.0 — مسودة حسابات لمدخل البيانات
// أداة عمل مساعدة (خارج قاعدة البيانات الرسمية) لإجراء حسابات سريعة قبل تسجيل
// البند الفعلي في العمليات اليومية: جدول مسودة + آلة حاسبة + عدّاد فئات الجنيه المصري.
// تُحفظ محلياً (localStorage) فقط حتى يمسحها المستخدم — لا تُرسَل لقاعدة البيانات.
// ═══════════════════════════════════════════════════════════

const LS_KEY = 'aj.draftAccounts.v1'

interface DraftRow { id: number; label: string; value: string }

interface PersistedState {
  rows: DraftRow[]
  nextId: number
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* */ }
  return { rows: [{ id: 1, label: '', value: '' }], nextId: 2 }
}

export default function DraftAccounts() {
  const [rows, setRows] = useState<DraftRow[]>(() => loadState().rows)
  const [nextId, setNextId] = useState(() => loadState().nextId)

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ rows, nextId })) } catch { /* */ }
  }, [rows, nextId])

  // ═══ جدول المسودة ═══
  function addRow() {
    setRows(prev => [...prev, { id: nextId, label: '', value: '' }])
    setNextId(n => n + 1)
  }
  function updateRow(id: number, patch: Partial<DraftRow>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }
  function removeRow(id: number) {
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev)
  }
  function clearTable() {
    setRows([{ id: 1, label: '', value: '' }])
    setNextId(2)
  }
  const tableTotal = useMemo(
    () => rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0),
    [rows]
  )

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{
      background: 'linear-gradient(160deg, rgba(20,184,166,0.06), rgba(59,130,246,0.05) 60%, transparent)',
    }}>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(20,184,166,0.18)', color: '#14b8a6' }}>
            <Icons.Calculator size={18} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--txt-1)' }}>مسودة حسابات</div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>مساحة عمل مساعدة لمدخل البيانات — لا تُحفظ في سجلات البرنامج الرسمية</div>
          </div>
        </div>

        {/* جدول المسودة */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
          <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: '1px solid var(--inner-border)' }}>
            <div className="flex items-center gap-1.5">
              <Icons.Journal size={14} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--txt-1)' }}>جدول مسودة</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={addRow} className="text-2xs px-2.5 py-1.5 rounded-md font-bold flex items-center gap-1" style={{ background: 'rgba(20,184,166,0.15)', color: '#14b8a6' }}>
                <Icons.Plus size={11} /> إضافة سطر
              </button>
              <button onClick={clearTable} className="text-2xs px-2.5 py-1.5 rounded-md" style={{ background: 'var(--app-bg-solid, rgba(255,255,255,0.05))', color: 'var(--txt-3)' }}>
                ✕ تصفير الجدول
              </button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead><tr>
              <th className="th" style={{ width: 40 }}>#</th>
              <th className="th">البيان</th>
              <th className="th" style={{ width: 160 }}>القيمة</th>
              <th className="th" style={{ width: 40 }}></th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="tr">
                  <td className="td" style={{ color: 'var(--txt-3)' }}>{i + 1}</td>
                  <td className="td">
                    <input value={r.label} onChange={e => updateRow(r.id, { label: e.target.value })}
                      placeholder="بيان..." className="w-full bg-transparent outline-none" style={{ color: 'var(--txt-1)' }} />
                  </td>
                  <td className="td">
                    <input type="number" value={r.value} onChange={e => updateRow(r.id, { value: e.target.value })}
                      placeholder="0" className="w-full bg-transparent outline-none tabular-nums font-bold text-left" style={{ color: 'var(--txt-1)' }} />
                  </td>
                  <td className="td">
                    <button onClick={() => removeRow(r.id)} className="p-1 rounded hover:bg-white/5" style={{ color: 'var(--txt-3)' }}>
                      <Icons.Trash size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--inner-border)', background: 'var(--app-bg-solid, rgba(255,255,255,0.03))' }}>
                <td className="td" colSpan={2} style={{ fontWeight: 800, color: 'var(--txt-1)' }}>الإجمالي</td>
                <td className="td tabular-nums font-extrabold" style={{ color: '#14b8a6', fontSize: 14 }}>{fmt(tableTotal * 100)} ج</td>
                <td className="td"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
