import { useState, useEffect } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import Modal from '../components/Modal'
import Icons from '../components/Icon'
import type { MainCategory, SubCategory } from '../../core/types'

const CAT_COLORS = [
  '#388bfd','#2ea043','#d29922','#f85149',
  '#8957e5','#e06c75','#56b6c2','#e5c07b',
  '#61afef','#98c379','#c678dd','#e06c75',
]

// ===== نموذج تصنيف رئيسي =====
interface MainForm { name: string; color: string }
// ===== نموذج تصنيف فرعي =====
interface SubForm  { name: string; mainCategoryId: number }

export default function Categories() {
  const { show } = useToast()

  const [mainCats, setMainCats] = useState<MainCategory[]>([])
  const [subCats,  setSubCats]  = useState<SubCategory[]>([])
  const [loading,  setLoading]  = useState(false)

  // توسيع/طي التصنيف الرئيسي (للتوافق)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  // v2.27.0 (15-Jun) — التصنيف الرئيسي المحدد (تصميم master-detail)
  const [selectedMainId, setSelectedMainId] = useState<number | null>(null)

  // مودال تصنيف رئيسي
  const [mainModal,   setMainModal]   = useState(false)
  const [editingMain, setEditingMain] = useState<MainCategory | null>(null)
  const [mainForm,    setMainForm]    = useState<MainForm>({ name: '', color: '#388bfd' })
  const [savingMain,  setSavingMain]  = useState(false)

  // مودال تصنيف فرعي
  const [subModal,    setSubModal]    = useState(false)
  const [editingSub,  setEditingSub]  = useState<SubCategory | null>(null)
  const [subForm,     setSubForm]     = useState<SubForm>({ name: '', mainCategoryId: 0 })
  const [savingSub,   setSavingSub]   = useState(false)

  // مودال حذف
  const [deleteMain, setDeleteMain] = useState<MainCategory | null>(null)
  const [deleteSub,  setDeleteSub]  = useState<SubCategory | null>(null)
  const [deleting,   setDeleting]   = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [m, s] = await Promise.all([
        call(api.cats.getMain()),
        call(api.cats.getSub()),
      ])
      setMainCats(m)
      setSubCats(s)
    } catch (e) { show((e as Error).message, 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // ===== فتح مودالات =====
  function openAddMain() {
    setEditingMain(null)
    setMainForm({ name: '', color: '#388bfd' })
    setMainModal(true)
  }

  function openEditMain(cat: MainCategory) {
    setEditingMain(cat)
    setMainForm({ name: cat.name, color: cat.color })
    setMainModal(true)
  }

  function openAddSub(mainId: number) {
    setEditingSub(null)
    setSubForm({ name: '', mainCategoryId: mainId })
    setSubModal(true)
  }

  function openEditSub(sub: SubCategory) {
    setEditingSub(sub)
    setSubForm({ name: sub.name, mainCategoryId: sub.mainCategoryId })
    setSubModal(true)
  }

  // ===== حفظ تصنيف رئيسي =====
  async function handleSaveMain() {
    if (!mainForm.name.trim()) { show('أدخل اسم التصنيف', 'warning'); return }
    setSavingMain(true)
    try {
      if (editingMain) {
        await call(api.cats.updateMain(editingMain.id, { name: mainForm.name, color: mainForm.color }))
        show('تم تعديل التصنيف الرئيسي ✓', 'success')
      } else {
        await call(api.cats.createMain({ name: mainForm.name, color: mainForm.color }))
        show('تم إضافة التصنيف الرئيسي ✓', 'success')
      }
      setMainModal(false)
      await load()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setSavingMain(false) }
  }

  // ===== حفظ تصنيف فرعي =====
  async function handleSaveSub() {
    if (!subForm.name.trim()) { show('أدخل اسم التصنيف الفرعي', 'warning'); return }
    setSavingSub(true)
    try {
      if (editingSub) {
        await call(api.cats.updateSub(editingSub.id, subForm.name))
        show('تم تعديل التصنيف الفرعي ✓', 'success')
      } else {
        await call(api.cats.createSub({ mainCategoryId: subForm.mainCategoryId, name: subForm.name }))
        show('تم إضافة التصنيف الفرعي ✓', 'success')
      }
      setSubModal(false)
      await load()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setSavingSub(false) }
  }

  // ===== حذف تصنيف رئيسي =====
  async function handleDeleteMain() {
    if (!deleteMain) return
    setDeleting(true)
    try {
      const res = await call(api.cats.deleteMain(deleteMain.id)) as { ok: boolean; reason?: string }
      if (!res.ok) { show(res.reason ?? 'لا يمكن الحذف', 'error'); setDeleteMain(null); return }
      show('تم حذف التصنيف الرئيسي', 'success')
      setDeleteMain(null)
      await load()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setDeleting(false) }
  }

  // ===== حذف تصنيف فرعي =====
  async function handleDeleteSub() {
    if (!deleteSub) return
    setDeleting(true)
    try {
      const res = await call(api.cats.deleteSub(deleteSub.id)) as { ok: boolean; reason?: string }
      if (!res.ok) { show(res.reason ?? 'لا يمكن الحذف', 'error'); setDeleteSub(null); return }
      show('تم حذف التصنيف الفرعي', 'success')
      setDeleteSub(null)
      await load()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setDeleting(false) }
  }

  function toggleExpand(id: number) {
    setExpanded(p => ({ ...p, [id]: !p[id] }))
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">

      {/* رأس الصفحة */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-600/20 border border-brand-600/30
            flex items-center justify-center text-brand-400">
            <Icons.Settings size={18} />
          </div>
          <div>
            <h1 className="t-display text-white">الإضافات — التصنيفات</h1>
            <p className="text-2xs text-surface-400">
              {mainCats.length} تصنيف رئيسي — {subCats.length} تصنيف فرعي
            </p>
          </div>
        </div>
        <button onClick={openAddMain} className="btn-primary btn-sm">
          <Icons.Plus size={14} /> تصنيف رئيسي جديد
        </button>
      </div>

      {/* ═══ تصميم master-detail (v2.27.0 15-Jun) ═══ */}
      {loading ? (
        <div className="flex items-center justify-center h-32" style={{ color: 'var(--txt-3)' }}>جاري التحميل...</div>
      ) : mainCats.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3" style={{ color: 'var(--txt-3)' }}>
          <Icons.Settings size={40} className="opacity-20" />
          <span className="text-sm">لا توجد تصنيفات — أضف تصنيفاً رئيسياً للبدء</span>
        </div>
      ) : (() => {
        const activeMain = mainCats.find(c => c.id === selectedMainId) ?? mainCats[0]
        const activeSubs = subCats.filter(s => s.mainCategoryId === activeMain.id)
        return (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-4 overflow-hidden">
            {/* ── العمود الأيمن: التصنيفات الرئيسية ── */}
            <div className="lg:col-span-2 card p-0 overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--inner-border)', background: 'var(--inner-bg)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-1)' }}>📁 التصنيفات الرئيسية ({mainCats.length})</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {mainCats.map(cat => {
                  const subCount = subCats.filter(s => s.mainCategoryId === cat.id).length
                  const active = cat.id === activeMain.id
                  return (
                    <div key={cat.id}
                      onClick={() => setSelectedMainId(cat.id)}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all group"
                      style={active
                        ? { background: cat.color + '18', border: `1.5px solid ${cat.color}` }
                        : { background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cat.color, boxShadow: `0 0 6px ${cat.color}88` }} />
                      <span className="flex-1 font-bold text-sm" style={{ color: active ? cat.color : 'var(--txt-1)' }}>{cat.name}</span>
                      <span className="text-2xs px-2 py-0.5 rounded-full" style={{ background: cat.color + '22', color: cat.color }}>{subCount}</span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={e => { e.stopPropagation(); openEditMain(cat) }} className="p-1 rounded hover:bg-white/10" style={{ color: 'var(--txt-3)' }} title="تعديل"><Icons.Edit size={12} /></button>
                        <button onClick={e => { e.stopPropagation(); setDeleteMain(cat) }} className="p-1 rounded hover:bg-white/10 hover:text-danger" style={{ color: 'var(--txt-3)' }} title="حذف"><Icons.Trash size={12} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="p-2" style={{ borderTop: '1px solid var(--inner-border)' }}>
                <button onClick={openAddMain} className="btn-ghost btn-sm w-full justify-center" style={{ fontSize: 12 }}>
                  <Icons.Plus size={13} /> تصنيف رئيسي جديد
                </button>
              </div>
            </div>

            {/* ── العمود الأيسر: التصنيفات الفرعية للمحدد ── */}
            <div className="lg:col-span-3 card p-0 overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: `2px solid ${activeMain.color}`, background: activeMain.color + '10' }}>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: activeMain.color }} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: activeMain.color }}>{activeMain.name}</span>
                  <span className="text-2xs" style={{ color: 'var(--txt-3)' }}>— التصنيفات الفرعية ({activeSubs.length})</span>
                </div>
                <button onClick={() => openAddSub(activeMain.id)} className="btn-primary btn-sm" style={{ fontSize: 11, padding: '4px 12px' }}>
                  <Icons.Plus size={12} /> فرعي جديد
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {activeSubs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 py-8" style={{ color: 'var(--txt-3)' }}>
                    <span style={{ fontSize: 32, opacity: 0.3 }}>📂</span>
                    <span className="text-sm">لا توجد تصنيفات فرعية</span>
                    <button onClick={() => openAddSub(activeMain.id)} className="btn-ghost btn-sm mt-1" style={{ fontSize: 11 }}>
                      <Icons.Plus size={12} /> أضف أول تصنيف فرعي
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {activeSubs.map(sub => (
                      <div key={sub.id}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl group transition-all"
                        style={{ background: 'var(--inner-bg)', border: '1px solid var(--inner-border)' }}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: activeMain.color }} />
                        <span className="flex-1 text-sm font-medium" style={{ color: 'var(--txt-1)' }}>{sub.name}</span>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEditSub(sub)} className="p-1 rounded hover:bg-white/10" style={{ color: 'var(--accent)' }} title="تعديل"><Icons.Edit size={12} /></button>
                          <button onClick={() => setDeleteSub(sub)} className="p-1 rounded hover:bg-white/10 hover:text-danger" style={{ color: 'var(--txt-3)' }} title="حذف"><Icons.Trash size={12} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ===== مودال تصنيف رئيسي ===== */}
      <Modal
        open={mainModal}
        title={editingMain ? `تعديل: ${editingMain.name}` : 'إضافة تصنيف رئيسي'}
        onClose={() => setMainModal(false)}
        footer={<>
          <button onClick={() => setMainModal(false)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSaveMain} disabled={savingMain} className="btn-primary btn-sm">
            {savingMain ? 'جاري الحفظ...' : <><Icons.Save size={14} /> حفظ</>}
          </button>
        </>}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-surface-400 mb-1">اسم التصنيف *</label>
            <input
              className="field text-sm"
              placeholder="مثال: إيرادات، مصروفات، مشتريات..."
              value={mainForm.name}
              autoFocus
              onChange={e => setMainForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleSaveMain()}
            />
          </div>

          <div>
            <label className="block text-xs text-surface-400 mb-2">لون التصنيف</label>
            <div className="flex flex-wrap gap-2">
              {CAT_COLORS.map(c => (
                <button
                  key={c} type="button"
                  onClick={() => setMainForm(f => ({ ...f, color: c }))}
                  className={`w-8 h-8 rounded-full transition-all ${
                    mainForm.color === c
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-surface-700 scale-110'
                      : 'hover:scale-105'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
            {/* معاينة */}
            <div className="mt-3 flex items-center gap-2 bg-surface-800 rounded-lg px-3 py-2">
              <div className="w-3 h-3 rounded-full"
                style={{ background: mainForm.color, boxShadow: `0 0 6px ${mainForm.color}` }} />
              <span className="text-sm font-bold" style={{ color: mainForm.color }}>
                {mainForm.name || 'معاينة التصنيف'}
              </span>
            </div>
          </div>
        </div>
      </Modal>

      {/* ===== مودال تصنيف فرعي ===== */}
      <Modal
        open={subModal}
        title={editingSub ? `تعديل: ${editingSub.name}` : 'إضافة تصنيف فرعي'}
        onClose={() => setSubModal(false)}
        footer={<>
          <button onClick={() => setSubModal(false)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSaveSub} disabled={savingSub} className="btn-primary btn-sm">
            {savingSub ? 'جاري الحفظ...' : <><Icons.Save size={14} /> حفظ</>}
          </button>
        </>}>
        <div className="space-y-3">
          {/* التصنيف الرئيسي (عند الإضافة) */}
          {!editingSub && (
            <div>
              <label className="block text-xs text-surface-400 mb-1">التصنيف الرئيسي</label>
              <select
                className="field"
                value={subForm.mainCategoryId}
                onChange={e => setSubForm(f => ({ ...f, mainCategoryId: +e.target.value }))}>
                <option value={0}>— اختر —</option>
                {mainCats.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          {editingSub && (
            <div className="flex items-center gap-2 bg-surface-800 rounded-lg px-3 py-2">
              <div className="w-2.5 h-2.5 rounded-full"
                style={{ background: mainCats.find(m => m.id === editingSub.mainCategoryId)?.color ?? '#388bfd' }} />
              <span className="text-xs text-surface-400">
                تحت: <span className="text-white font-medium">
                  {mainCats.find(m => m.id === editingSub.mainCategoryId)?.name ?? ''}
                </span>
              </span>
            </div>
          )}
          <div>
            <label className="block text-xs text-surface-400 mb-1">اسم التصنيف الفرعي *</label>
            <input
              className="field text-sm"
              placeholder="مثال: مبيعات، إيجار، رواتب..."
              value={subForm.name}
              autoFocus
              onChange={e => setSubForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleSaveSub()}
            />
          </div>
        </div>
      </Modal>

      {/* ===== مودال حذف تصنيف رئيسي ===== */}
      <Modal
        open={!!deleteMain}
        title="تأكيد حذف التصنيف الرئيسي"
        onClose={() => setDeleteMain(null)}
        size="sm"
        footer={<>
          <button onClick={() => setDeleteMain(null)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleDeleteMain} disabled={deleting} className="btn-danger btn-sm">
            <Icons.Trash size={14} /> {deleting ? 'جاري الحذف...' : 'حذف'}
          </button>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-surface-300">
            هل تريد حذف التصنيف الرئيسي{' '}
            <span className="font-bold text-white">"{deleteMain?.name}"</span>؟
          </p>
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-xs text-danger">
            ⚠️ سيتم حذف جميع تصنيفاته الفرعية أيضاً. لا يمكن حذف تصنيف مستخدم في بنود اليومية.
          </div>
        </div>
      </Modal>

      {/* ===== مودال حذف تصنيف فرعي ===== */}
      <Modal
        open={!!deleteSub}
        title="تأكيد حذف التصنيف الفرعي"
        onClose={() => setDeleteSub(null)}
        size="sm"
        footer={<>
          <button onClick={() => setDeleteSub(null)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleDeleteSub} disabled={deleting} className="btn-danger btn-sm">
            <Icons.Trash size={14} /> {deleting ? 'جاري الحذف...' : 'حذف'}
          </button>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-surface-300">
            هل تريد حذف التصنيف الفرعي{' '}
            <span className="font-bold text-white">"{deleteSub?.name}"</span>؟
          </p>
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-xs text-warning">
            لا يمكن حذف تصنيف مستخدم في بنود اليومية.
          </div>
        </div>
      </Modal>
    </div>
  )
}
