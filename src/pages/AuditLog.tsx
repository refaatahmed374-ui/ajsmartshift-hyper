import { useState, useEffect } from 'react'
import { api, call } from '../lib/api'
import { useToast } from '../store/toast'
import Icons from '../components/Icon'
import type { AuditLog as AuditEntry, User } from '../../core/types'

const OP_LABELS: Record<string, string> = {
  create: 'إنشاء', update: 'تعديل', delete: 'حذف',
  approve: 'اعتماد', close: 'إغلاق', login: 'دخول',
}
const ENTITY_LABELS: Record<string, string> = {
  transaction: 'بند', shift: 'شيفت', user: 'مستخدم',
  employee: 'موظف', settings: 'إعدادات',
}

export default function AuditLogPage() {
  const { show } = useToast()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [users,   setUsers]   = useState<User[]>([])
  const [loading, setLoading] = useState(false)

  // فلاتر
  const [filterUser,   setFilterUser]   = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterOp,     setFilterOp]     = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')

  // تفاصيل
  const [detail, setDetail] = useState<AuditEntry | null>(null)

  async function load() {
    setLoading(true)
    try {
      const opts: Record<string, unknown> = { limit: 200 }
      if (filterUser)   opts.userId     = +filterUser
      if (filterEntity) opts.entityType = filterEntity
      if (filterOp)     opts.operation  = filterOp
      if (dateFrom)     opts.dateFrom   = dateFrom
      if (dateTo)       opts.dateTo     = dateTo
      setEntries(await call(api.audit.get(opts)))
    } catch (e) { show((e as Error).message, 'error') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    call(api.users.getAll()).then(setUsers).catch(() => {})
    load()
  }, [])

  const opColor = (op: string) => ({
    create: '#2ea043', update: '#d29922', delete: '#f85149',
    approve: '#388bfd', close: '#8957e5', login: '#56b6c2',
  }[op] ?? '#6e7681')

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
      {/* رأس */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-brand-600/20 border border-brand-600/30
          flex items-center justify-center text-brand-400">
          <Icons.Records size={18} />
        </div>
        <div>
          <h1 className="t-display text-white">سجل التعديلات</h1>
          <p className="text-2xs text-surface-400">كل العمليات المسجّلة في النظام</p>
        </div>
      </div>

      {/* فلاتر */}
      <div className="card p-3 flex-shrink-0">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <select className="field text-xs" value={filterUser}
            onChange={e => setFilterUser(e.target.value)}>
            <option value="">كل المستخدمين</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>

          <select className="field text-xs" value={filterEntity}
            onChange={e => setFilterEntity(e.target.value)}>
            <option value="">كل الكيانات</option>
            {Object.entries(ENTITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          <select className="field text-xs" value={filterOp}
            onChange={e => setFilterOp(e.target.value)}>
            <option value="">كل العمليات</option>
            {Object.entries(OP_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          <input className="field text-xs" type="date" placeholder="من"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)} />

          <input className="field text-xs" type="date" placeholder="إلى"
            value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div className="flex justify-end mt-2">
          <button onClick={load} className="btn-ghost btn-sm">
            <Icons.Search size={13} /> بحث
          </button>
        </div>
      </div>

      {/* جدول */}
      <div className="card flex-1 overflow-hidden flex flex-col p-0">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-surface-400">
            جاري التحميل...
          </div>
        ) : entries.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-surface-400">
            <Icons.Records size={36} className="opacity-20" />
            <span className="text-sm">لا توجد سجلات</span>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">الوقت</th>
                  <th className="th">المستخدم</th>
                  <th className="th">العملية</th>
                  <th className="th">الكيان</th>
                  <th className="th">السبب</th>
                  <th className="th w-8"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="tr cursor-pointer" onClick={() => setDetail(e)}>
                    <td className="td text-surface-400 tabular-nums whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString('ar-EG')}
                    </td>
                    <td className="td font-medium">{e.userName}</td>
                    <td className="td">
                      <span className="badge text-2xs"
                        style={{ background: opColor(e.operation) + '22', color: opColor(e.operation) }}>
                        {OP_LABELS[e.operation] ?? e.operation}
                      </span>
                    </td>
                    <td className="td text-surface-400">
                      {ENTITY_LABELS[e.entityType] ?? e.entityType}
                      {e.entityId > 0 && <span className="mr-1 text-2xs">#{e.entityId}</span>}
                    </td>
                    <td className="td text-surface-400 max-w-[140px] truncate">
                      {e.reason || '—'}
                    </td>
                    <td className="td text-brand-400">
                      <Icons.Eye size={12} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* مودال التفاصيل */}
      {detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setDetail(null)}>
          <div className="bg-surface-700 border border-surface-500 rounded-2xl p-5 w-full max-w-lg
            shadow-2xl fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white">تفاصيل العملية</h3>
              <button onClick={() => setDetail(null)} className="text-surface-400 hover:text-white">
                <Icons.X size={16} />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              {[
                ['المستخدم',   detail.userName],
                ['العملية',    OP_LABELS[detail.operation] ?? detail.operation],
                ['الكيان',     `${ENTITY_LABELS[detail.entityType] ?? detail.entityType} #${detail.entityId}`],
                ['الوقت',      new Date(detail.createdAt).toLocaleString('ar-EG')],
                ['السبب',      detail.reason || '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-surface-400 w-20 flex-shrink-0">{k}:</span>
                  <span className="text-white">{v}</span>
                </div>
              ))}
              {detail.valueBefore && (
                <div>
                  <div className="text-2xs text-surface-400 mb-1">قبل:</div>
                  <pre className="bg-surface-800 rounded-lg p-2 text-2xs text-danger overflow-auto max-h-24">
                    {detail.valueBefore}
                  </pre>
                </div>
              )}
              {detail.valueAfter && (
                <div>
                  <div className="text-2xs text-surface-400 mb-1">بعد:</div>
                  <pre className="bg-surface-800 rounded-lg p-2 text-2xs text-success overflow-auto max-h-24">
                    {detail.valueAfter}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
