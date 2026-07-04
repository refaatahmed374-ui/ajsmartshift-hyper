import { useState, useEffect } from 'react'
import { api, call } from '../lib/api'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import Modal from '../components/Modal'
import Icons from '../components/Icon'
import { getHiddenPages, setHiddenPages } from '../store/pageAccess'
import { usePermissions } from '../store/permissions'
import type { User, Permission } from '../../core/types'
import { ALL_PERMISSIONS } from '../../core/types'

// الأقسام القابلة للإخفاء (تطابق ids القائمة الجانبية)
const ALL_PAGES: { id: string; label: string }[] = [
  { id: 'dashboard',     label: 'لوحة التحكم' },
  { id: 'daily',         label: 'اليومية' },
  { id: 'reports',       label: 'التقارير' },
  { id: 'employees',     label: 'الموظفون' },
  { id: 'customers',     label: 'العملاء' },
  { id: 'suppliers',     label: 'الموردون' },
  { id: 'users',         label: 'المستخدمون' },
  { id: 'settings',      label: 'الإعدادات' },
  { id: 'categories',    label: 'التصنيفات' },
  { id: 'about',         label: 'حول البرنامج' },
]

const ROLES = [
  { value: 'manager',        label: 'مدير النظام', color: '#f85149' },
  { value: 'branch_manager', label: 'مدير الفرع',  color: '#e06c75' },
  { value: 'accountant',     label: 'المحاسب',     color: '#56b6c2' },
  { value: 'supervisor',     label: 'مشرف',        color: '#d29922' },
  { value: 'cashier',        label: 'كاشير',       color: '#388bfd' },
]

const COLORS = ['#388bfd','#2ea043','#d29922','#f85149','#8957e5','#e06c75','#56b6c2','#e5c07b']

const roleLabel = (r: string) => ROLES.find(x => x.value === r)?.label ?? r
const roleColor = (r: string) => ROLES.find(x => x.value === r)?.color ?? '#388bfd'

export default function Users() {
  const { user: me } = useAuth()
  const { show }    = useToast()
  const permStore   = usePermissions()

  const [users,    setUsers]    = useState<User[]>([])
  const [loading,  setLoading]  = useState(false)

  // مصفوفة صلاحيات الإجراءات (منقولة من الإعدادات): userId → Set<Permission>
  const [permsMap,   setPermsMap]   = useState<Record<number, Set<Permission>>>({})
  const [savingPerm, setSavingPerm] = useState(false)

  // مودال الإضافة / التعديل
  const [showForm,   setShowForm]   = useState(false)
  const [editing,    setEditing]    = useState<User | null>(null)
  const [form, setForm] = useState({
    username: '', displayName: '', password: '', role: 'cashier', color: '#388bfd',
  })
  const [saving, setSaving] = useState(false)

  // مودال تغيير الباسورد
  const [pwdModal, setPwdModal] = useState<User | null>(null)
  const [newPwd,   setNewPwd]   = useState('')

  // v2.27.0 (14-Jun) — مودال صلاحيات الأقسام
  const [permModal,   setPermModal]   = useState<User | null>(null)
  const [permHidden,  setPermHidden]  = useState<string[]>([])
  const [permSaving,  setPermSaving]  = useState(false)

  async function openPerms(u: User) {
    setPermModal(u)
    setPermHidden(await getHiddenPages(u.id))
  }
  function togglePage(pageId: string) {
    setPermHidden(prev => prev.includes(pageId) ? prev.filter(p => p !== pageId) : [...prev, pageId])
  }
  async function savePerms() {
    if (!permModal) return
    setPermSaving(true)
    try {
      await setHiddenPages(permModal.id, permHidden)
      show(`✓ تم حفظ صلاحيات ${permModal.displayName}`, 'success')
      setPermModal(null)
    } catch (e) { show((e as Error).message, 'error') }
    finally { setPermSaving(false) }
  }

  async function load() {
    setLoading(true)
    try { setUsers(await call(api.users.getAll())) }
    catch (e) { show((e as Error).message, 'error') }
    finally { setLoading(false) }
  }

  async function loadPerms() {
    const raw = await call(api.perms.getAll()) as { userId: number; permission: Permission; granted: number }[]
    const map: Record<number, Set<Permission>> = {}
    for (const r of raw) {
      if (!map[r.userId]) map[r.userId] = new Set()
      if (r.granted) map[r.userId].add(r.permission)
    }
    setPermsMap(map)
  }

  async function togglePerm(userId: number, perm: Permission) {
    const current = permsMap[userId]?.has(perm) ?? false
    setSavingPerm(true)
    try {
      await call(api.perms.set(userId, perm, !current))
      await loadPerms()
      await permStore.load(userId)
    } catch (e) { show((e as Error).message, 'error') }
    finally { setSavingPerm(false) }
  }

  useEffect(() => { load(); loadPerms() }, [])

  function openAdd() {
    setEditing(null)
    setForm({ username: '', displayName: '', password: '', role: 'cashier', color: '#388bfd' })
    setShowForm(true)
  }

  function openEdit(u: User) {
    setEditing(u)
    setForm({ username: u.username, displayName: u.displayName, password: '', role: u.role, color: u.color })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.displayName.trim())  { show('أدخل الاسم', 'warning'); return }
    if (!editing && !form.username.trim()) { show('أدخل اسم المستخدم', 'warning'); return }
    if (!editing && !form.password.trim()) { show('أدخل كلمة المرور', 'warning'); return }
    setSaving(true)
    try {
      if (editing) {
        await call(api.users.update(editing.id, {
          displayName: form.displayName, role: form.role, color: form.color,
        }))
        show('تم تحديث المستخدم', 'success')
      } else {
        await call(api.users.create({
          username: form.username, displayName: form.displayName,
          password: form.password, role: form.role, color: form.color,
        }))
        show('تم إنشاء المستخدم', 'success')
      }
      setShowForm(false)
      await load()
    } catch (e) { show((e as Error).message, 'error') }
    finally { setSaving(false) }
  }

  async function handleToggle(u: User) {
    if (u.id === me?.id) { show('لا يمكنك تعطيل حسابك الحالي', 'warning'); return }
    try {
      await call(api.users.toggleActive(u.id))
      show(u.active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب', 'success')
      await load()
    } catch (e) { show((e as Error).message, 'error') }
  }

  async function handleChangePwd() {
    if (!pwdModal) return
    if (!newPwd.trim() || newPwd.length < 3) { show('كلمة المرور قصيرة جداً', 'warning'); return }
    try {
      await call(api.users.updatePassword(pwdModal.id, newPwd))
      show('تم تغيير كلمة المرور', 'success')
      setPwdModal(null); setNewPwd('')
    } catch (e) { show((e as Error).message, 'error') }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
      {/* رأس */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-600/20 border border-brand-600/30
            flex items-center justify-center text-brand-400">
            <Icons.Employees size={18} />
          </div>
          <div>
            <h1 className="t-display text-white">إدارة المستخدمين</h1>
            <p className="text-2xs text-surface-400">{users.length} مستخدم مسجّل</p>
          </div>
        </div>
        <button onClick={openAdd} className="btn-primary btn-sm">
          <Icons.Plus size={14} /> مستخدم جديد
        </button>
      </div>

      {/* جدول المستخدمين */}
      <div className="card flex-1 overflow-hidden flex flex-col p-0">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-surface-400 text-sm">
            جاري التحميل...
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">المستخدم</th>
                  <th className="th">الاسم</th>
                  <th className="th">الدور</th>
                  <th className="th">الحالة</th>
                  <th className="th">تاريخ الإنشاء</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="tr">
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center
                          text-white text-xs font-bold flex-shrink-0"
                          style={{ background: u.color }}>
                          {u.displayName[0]}
                        </div>
                        <span className="font-mono text-surface-400 text-xs">{u.username}</span>
                      </div>
                    </td>
                    <td className="td font-medium">{u.displayName}
                      {u.id === me?.id && <span className="text-2xs text-brand-400 mr-1">(أنت)</span>}
                    </td>
                    <td className="td">
                      <span className="badge text-xs"
                        style={{ background: roleColor(u.role) + '22', color: roleColor(u.role) }}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="td">
                      <span className={`badge text-xs ${u.active ? 'badge-approved' : 'badge-deficit'}`}>
                        {u.active ? 'نشط' : 'معطّل'}
                      </span>
                    </td>
                    <td className="td text-surface-400 text-xs">
                      {new Date(u.createdAt).toLocaleDateString('ar-EG')}
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(u)}
                          className="p-1.5 rounded-lg hover:bg-surface-600 text-surface-400
                            hover:text-brand-400 transition-colors" title="تعديل">
                          <Icons.Edit size={13} />
                        </button>
                        <button onClick={() => { setPwdModal(u); setNewPwd('') }}
                          className="p-1.5 rounded-lg hover:bg-surface-600 text-surface-400
                            hover:text-warning transition-colors" title="تغيير الباسورد">
                          <Icons.Lock size={13} />
                        </button>
                        {/* v2.27.0 (14-Jun) — صلاحيات الأقسام */}
                        <button onClick={() => openPerms(u)}
                          className="p-1.5 rounded-lg hover:bg-surface-600 text-surface-400
                            hover:text-info transition-colors" title="صلاحيات الأقسام">
                          <Icons.Settings size={13} />
                        </button>
                        <button onClick={() => handleToggle(u)}
                          className={`p-1.5 rounded-lg hover:bg-surface-600 transition-colors
                            ${u.active ? 'text-success hover:text-danger' : 'text-danger hover:text-success'}`}
                          title={u.active ? 'تعطيل' : 'تفعيل'}>
                          {u.active ? <Icons.Eye size={13} /> : <Icons.Check size={13} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ مصفوفة صلاحيات الإجراءات (منقولة من إعدادات النظام) ═══ */}
      <div className="card flex-shrink-0">
        <div className="flex items-center gap-2 mb-4">
          <Icons.Lock size={15} className="text-brand-400" />
          <span className="font-bold text-white text-sm">صلاحيات المستخدمين (الإجراءات)</span>
          {savingPerm && (
            <span className="text-2xs text-surface-400 mr-auto animate-pulse">جاري الحفظ...</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="th text-right min-w-[120px]">المستخدم</th>
                {ALL_PERMISSIONS.map(p => (
                  <th key={p.key} className="th text-center min-w-[80px] leading-tight">
                    <span className="block text-2xs text-surface-400 whitespace-nowrap">{p.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="tr">
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center
                        text-white text-2xs font-bold flex-shrink-0"
                        style={{ background: u.color }}>
                        {u.displayName[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-white text-xs truncate">{u.displayName}</div>
                        <div className="text-2xs text-surface-500">{u.username}</div>
                      </div>
                    </div>
                  </td>
                  {ALL_PERMISSIONS.map(p => {
                    const granted = permsMap[u.id]?.has(p.key) ?? false
                    return (
                      <td key={p.key} className="td text-center">
                        <button
                          onClick={() => togglePerm(u.id, p.key)}
                          disabled={savingPerm}
                          className={`w-5 h-5 rounded flex items-center justify-center mx-auto
                            transition-all border-2
                            ${granted
                              ? 'bg-brand-600 border-brand-600 text-white'
                              : 'bg-surface-700 border-surface-500 hover:border-surface-400'
                            }`}>
                          {granted && <Icons.Check size={11} />}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-2xs text-surface-500">
          ✓ التغييرات تُحفظ فوراً. الصلاحيات تنطبق على المستخدم عند دخوله التالي أو فوراً إذا كان داخلاً.
        </div>
      </div>

      {/* مودال إضافة/تعديل */}
      <Modal open={showForm} title={editing ? 'تعديل مستخدم' : 'مستخدم جديد'}
        onClose={() => setShowForm(false)}
        footer={<>
          <button onClick={() => setShowForm(false)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
            {saving ? 'جاري الحفظ...' : <><Icons.Save size={14} /> حفظ</>}
          </button>
        </>}>
        <div className="space-y-3">
          {!editing && (
            <div>
              <label className="block text-xs text-surface-400 mb-1">اسم المستخدم (للدخول) *</label>
              <input className="field" placeholder="مثال: cashier5" value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
            </div>
          )}
          <div>
            <label className="block text-xs text-surface-400 mb-1">الاسم المعروض *</label>
            <input className="field" placeholder="مثال: أحمد محمد" value={form.displayName}
              onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} />
          </div>
          {!editing && (
            <div>
              <label className="block text-xs text-surface-400 mb-1">كلمة المرور *</label>
              <input className="field" type="password" placeholder="••••••" value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
          )}
          <div>
            <label className="block text-xs text-surface-400 mb-1">الدور</label>
            <div className="grid grid-cols-3 gap-2">
              {ROLES.map(r => (
                <button key={r.value} type="button" onClick={() => setForm(f => ({ ...f, role: r.value }))}
                  className={`py-2 rounded-lg text-xs font-medium transition-all border
                    ${form.role === r.value
                      ? 'border-transparent text-white'
                      : 'border-surface-500 text-surface-400 hover:border-surface-400 bg-surface-800'
                    }`}
                  style={form.role === r.value ? { background: r.color + 'aa', borderColor: r.color } : {}}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-surface-400 mb-2">لون المستخدم</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`w-7 h-7 rounded-full transition-all ${form.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-surface-700 scale-110' : ''}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* مودال تغيير الباسورد */}
      <Modal open={!!pwdModal} title={`تغيير باسورد — ${pwdModal?.displayName}`}
        onClose={() => setPwdModal(null)} size="sm"
        footer={<>
          <button onClick={() => setPwdModal(null)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleChangePwd} className="btn-warning btn-sm">
            <Icons.Lock size={14} /> تغيير
          </button>
        </>}>
        <div>
          <label className="block text-xs text-surface-400 mb-1">كلمة المرور الجديدة</label>
          <input className="field" type="password" placeholder="••••••" value={newPwd}
            autoFocus onChange={e => setNewPwd(e.target.value)} />
        </div>
      </Modal>

      {/* v2.27.0 (14-Jun) — مودال صلاحيات الأقسام */}
      <Modal open={!!permModal} title={`صلاحيات الأقسام — ${permModal?.displayName}`}
        onClose={() => setPermModal(null)}
        footer={<>
          <button onClick={() => setPermModal(null)} className="btn-ghost btn-sm">إلغاء</button>
          <button onClick={savePerms} disabled={permSaving} className="btn-success-pro btn-sm">
            {permSaving ? <><Icons.Refresh size={14} className="animate-spin" /> جاري...</> : <><Icons.Check size={14} /> حفظ الصلاحيات</>}
          </button>
        </>}>
        <div className="space-y-3">
          <div className="text-xs p-2.5 rounded-lg" style={{ background: 'var(--inner-bg)', color: 'var(--txt-2)' }}>
            💡 فعّل القسم لإظهاره لهذا المستخدم، أو عطّله لإخفائه من قائمته الجانبية
          </div>
          <div className="grid grid-cols-2 gap-2">
            {ALL_PAGES.map(p => {
              const visible = !permHidden.includes(p.id)
              return (
                <button key={p.id} type="button" onClick={() => togglePage(p.id)}
                  className="flex items-center justify-between px-3 py-2 rounded-lg transition-all border"
                  style={visible
                    ? { background: 'rgba(16,185,129,0.10)', borderColor: 'rgba(16,185,129,0.40)', color: '#10b981' }
                    : { background: 'var(--inner-bg)', borderColor: 'var(--inner-border)', color: 'var(--txt-3)' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{p.label}</span>
                  <span className="w-5 h-5 rounded-md flex items-center justify-center"
                    style={visible
                      ? { background: '#10b981', color: 'white' }
                      : { border: '1.5px solid var(--inner-border)' }}>
                    {visible && <Icons.Check size={12} />}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </Modal>
    </div>
  )
}
