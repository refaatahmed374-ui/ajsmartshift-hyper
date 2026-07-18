import { useState } from 'react'
import { api, call } from '../lib/api'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import type { User } from '../../core/types'
import type {
  AnalysisResult, CategoryDecision, ImportReport,
} from '../../electron/services/excelImport/pipeline'

type MainCat = { id: number; name: string; kind?: string }
type SubCat = { id: number; name: string; mainCategoryId: number }
type Step = 'start' | 'cashiers' | 'categories' | 'preview' | 'importing' | 'report'

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444']

export default function ImportExcel() {
  const { user } = useAuth()
  const toast = useToast()

  const [step, setStep] = useState<Step>('start')
  const [busy, setBusy] = useState(false)
  const [fileInfo, setFileInfo] = useState<{ filePath: string; fileName: string } | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [mains, setMains] = useState<MainCat[]>([])
  const [subs, setSubs] = useState<SubCat[]>([])
  const [cashierMap, setCashierMap] = useState<Record<string, number>>({})
  const [catDecisions, setCatDecisions] = useState<Record<string, CategoryDecision>>({})
  const [report, setReport] = useState<ImportReport | null>(null)
  const [ackMismatch, setAckMismatch] = useState(false)

  async function loadRefData() {
    const [u, m, s] = await Promise.all([
      call<User[]>(api.users.getAll()),
      call<MainCat[]>(api.cats.getMain()),
      call<SubCat[]>(api.cats.getSub()),
    ])
    setUsers(u.filter(x => x.active)); setMains(m); setSubs(s)
  }

  async function pickFile() {
    setBusy(true)
    try {
      const r = await call<{ canceled: boolean; filePath?: string; fileName?: string; analysis?: AnalysisResult }>(api.excel.analyze())
      if (r.canceled || !r.analysis) return
      await loadRefData()
      setFileInfo({ filePath: r.filePath!, fileName: r.fileName! })
      setAnalysis(r.analysis)
      const cm: Record<string, number> = {}
      for (const c of r.analysis.cashiers) cm[c.normName] = c.resolvedUserId ?? 0
      setCashierMap(cm)
      const cd: Record<string, CategoryDecision> = {}
      for (const u of r.analysis.unknownCategories) cd[u.normValue] = { action: 'skip' }
      setCatDecisions(cd)
      setStep('cashiers')
    } catch (e) { toast.show((e as Error).message, 'error') }
    finally { setBusy(false) }
  }

  async function createCashierUser(normName: string, rawName: string) {
    try {
      const displayName = rawName || 'كاشير مستورد'
      const username = 'imp_' + Date.now().toString(36)
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]
      const id = await call<number>(api.users.create({ username, displayName, password: '123456', role: 'cashier', color }))
      await loadRefData()
      setCashierMap(m => ({ ...m, [normName]: id }))
      toast.show(`أُنشئ مستخدم «${displayName}» (كلمة المرور: 123456)`, 'success')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const allCashiersMapped = analysis?.cashiers.every(c => (cashierMap[c.normName] ?? 0) > 0) ?? false

  async function doImport() {
    if (!fileInfo || !user) return
    setStep('importing'); setBusy(true)
    try {
      const options = {
        fileName: fileInfo.fileName,
        userId: user.id,
        userName: user.displayName,
        cashierMap,
        categoryDecisions: catDecisions,
      }
      const rep = await call<ImportReport>(api.excel.import(fileInfo.filePath, options))
      setReport(rep); setAckMismatch(false); setStep('report')
      toast.show(`تم استيراد ${rep.imported} معاملة`, 'success')
    } catch (e) { toast.show((e as Error).message, 'error'); setStep('preview') }
    finally { setBusy(false) }
  }

  async function downloadTemplate() {
    setBusy(true)
    try {
      const r = await call<{ canceled: boolean; path?: string }>(api.excel.downloadTemplate())
      if (!r.canceled) toast.show('تم حفظ القالب الفارغ ✓', 'success')
    } catch (e) { toast.show((e as Error).message, 'error') }
    finally { setBusy(false) }
  }

  async function exportErrors() {
    if (!report) return
    try {
      const r = await call<{ canceled: boolean; path?: string }>(api.excel.exportErrors(report.errors))
      if (!r.canceled) toast.show('حُفظ سجل الأخطاء', 'success')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  function reset() {
    setStep('start'); setFileInfo(null); setAnalysis(null); setReport(null)
    setCashierMap({}); setCatDecisions({})
  }

  // حساب المعاينة
  const decidedMap = analysis ? analysis.unknownCategories.filter(u => catDecisions[u.normValue]?.action === 'map').reduce((s, u) => s + u.count, 0) : 0
  const decidedSkip = analysis ? analysis.unknownCategories.filter(u => catDecisions[u.normValue]?.action !== 'map').reduce((s, u) => s + u.count, 0) : 0
  const estImport = (analysis?.autoMapped ?? 0) + decidedMap

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ color: 'var(--txt-1)' }}>
      <div className="max-w-4xl mx-auto">
        {/* الترويسة */}
        <div className="mb-5">
          <h1 className="text-2xl font-extrabold mb-1">استيراد اليومية من Excel</h1>
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>محرّك ترحيل بيانات اليومية التاريخية — التطبيع، التعيين، كشف التكرار، والمعاينة قبل الحفظ.</p>
        </div>

        <Stepper step={step} />

        {/* ═══ البداية ═══ */}
        {step === 'start' && (
          <Card>
            <div className="text-center py-8">
              <div className="text-5xl mb-3">📥</div>
              <p className="mb-5 text-sm" style={{ color: 'var(--txt-2)' }}>
                اختر ملف Excel (.xlsx) يحتوي يوميات الشيفتات. يقرأ النظام جدول المعاملات فقط،
                ويتجاهل أقسام فوري والعهدة تلقائياً.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button onClick={pickFile} disabled={busy}
                  className="px-6 py-3 rounded-xl font-bold text-white"
                  style={{ background: 'linear-gradient(90deg,#3b82f6,#8b5cf6)', opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'جارٍ القراءة…' : '📂 اختر ملف Excel'}
                </button>
                <button onClick={downloadTemplate} disabled={busy}
                  className="px-6 py-3 rounded-xl font-bold text-sm"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--txt-1)', opacity: busy ? 0.6 : 1 }}>
                  📄 تحميل قالب فارغ
                </button>
              </div>
              <p className="mt-3 text-xs" style={{ color: 'var(--txt-3)' }}>
                لو أول مرة تستورد بيانات، حمّل القالب الفارغ واملأ خلاياه الفارغة فقط (مع تعليمات التعبئة في الورقة الثانية).
              </p>
            </div>
          </Card>
        )}

        {/* ═══ الكاشير ═══ */}
        {step === 'cashiers' && analysis && (
          <Card>
            {analysis.priorImport && (
              <Banner type="warning">⚠️ سبق استيراد ملف بنفس الاسم «{analysis.priorImport.fileName}» ({analysis.priorImport.imported} معاملة) بتاريخ {analysis.priorImport.createdAt?.slice(0, 10)}. قد تتكرّر البيانات.</Banner>
            )}
            <SummaryBar a={analysis} />
            <h3 className="font-bold mb-3 mt-2">تعيين الكاشير ({analysis.cashiers.length})</h3>
            <p className="text-xs mb-3" style={{ color: 'var(--txt-2)' }}>اربط كل اسم كاشير في الإكسل بمستخدم في النظام (يُحفظ التعيين للاستيرادات القادمة).</p>
            <div className="space-y-2">
              {analysis.cashiers.map(c => (
                <div key={c.normName} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: 'var(--surface-2, rgba(255,255,255,0.03))' }}>
                  <div className="flex-1">
                    <span className="font-bold">{c.rawName || '(بدون اسم)'}</span>
                    <span className="text-xs mr-2" style={{ color: 'var(--txt-2)' }}>{c.count} شيفت</span>
                  </div>
                  <select value={cashierMap[c.normName] ?? 0}
                    onChange={e => setCashierMap(m => ({ ...m, [c.normName]: Number(e.target.value) }))}
                    className="px-3 py-1.5 rounded-lg text-sm" style={{ background: 'var(--app-bg-solid)', color: 'var(--txt-1)', border: '1px solid var(--border, rgba(255,255,255,0.15))' }}>
                    <option value={0}>— اختر مستخدماً —</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                  </select>
                  <button onClick={() => createCashierUser(c.normName, c.rawName)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>
                    ＋ جديد
                  </button>
                </div>
              ))}
            </div>
            <NavButtons onBack={reset} backLabel="إلغاء"
              onNext={() => setStep('categories')} nextDisabled={!allCashiersMapped}
              nextLabel={analysis.unknownCategories.length ? 'التالي: الفئات المجهولة' : 'التالي: المعاينة'} />
            {!allCashiersMapped && <p className="text-xs mt-2" style={{ color: '#f59e0b' }}>عيّن كل الكاشيرين للمتابعة.</p>}
          </Card>
        )}

        {/* ═══ الفئات المجهولة ═══ */}
        {step === 'categories' && analysis && (
          <Card>
            <h3 className="font-bold mb-1">مراجعة الفئات المجهولة ({analysis.unknownCategories.length})</h3>
            <p className="text-xs mb-3" style={{ color: 'var(--txt-2)' }}>الفئات التي لم تُطابَق تلقائياً. اربطها بفئة نظام أو تخطَّها (تُسجَّل). القرار يُحفظ كقاعدة دائمة.</p>
            {analysis.unknownCategories.length === 0 && <Banner type="success">✓ كل الفئات مُطابَقة تلقائياً — لا مجهول.</Banner>}
            <div className="space-y-2">
              {analysis.unknownCategories.map(u => {
                const dec = catDecisions[u.normValue]
                const mainId = dec?.action === 'map' ? dec.mainCategoryId : 0
                const subId = dec?.action === 'map' ? (dec.subCategoryId ?? 0) : 0
                return (
                  <div key={u.normValue} className="flex items-center gap-2 p-2 rounded-lg flex-wrap" style={{ background: 'var(--surface-2, rgba(255,255,255,0.03))' }}>
                    <div className="flex-1 min-w-[120px]">
                      <span className="font-bold">{u.rawValue}</span>
                      <span className="text-xs mr-2" style={{ color: 'var(--txt-2)' }}>{u.count} بند</span>
                    </div>
                    <select value={mainId}
                      onChange={e => {
                        const v = Number(e.target.value)
                        setCatDecisions(d => ({ ...d, [u.normValue]: v === 0 ? { action: 'skip' } : { action: 'map', mainCategoryId: v, subCategoryId: null } }))
                      }}
                      className="px-3 py-1.5 rounded-lg text-sm" style={{ background: 'var(--app-bg-solid)', color: 'var(--txt-1)', border: '1px solid var(--border, rgba(255,255,255,0.15))' }}>
                      <option value={0}>— تخطٍّ هذا البند —</option>
                      {mains.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    {mainId > 0 && (
                      <select value={subId}
                        onChange={e => {
                          const sv = Number(e.target.value)
                          setCatDecisions(d => ({ ...d, [u.normValue]: { action: 'map', mainCategoryId: mainId, subCategoryId: sv || null } }))
                        }}
                        className="px-3 py-1.5 rounded-lg text-sm" style={{ background: 'var(--app-bg-solid)', color: 'var(--txt-1)', border: '1px solid var(--border, rgba(255,255,255,0.15))' }}>
                        <option value={0}>— بدون فرعي —</option>
                        {subs.filter(s => s.mainCategoryId === mainId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                  </div>
                )
              })}
            </div>
            <NavButtons onBack={() => setStep('cashiers')} onNext={() => setStep('preview')} nextLabel="التالي: المعاينة" />
          </Card>
        )}

        {/* ═══ المعاينة ═══ */}
        {step === 'preview' && analysis && (
          <Card>
            <h3 className="font-bold mb-3">المعاينة قبل الاستيراد</h3>
            {analysis.openingBalance ? (
              (() => {
                const ob = analysis.openingBalance!
                const mismatch = Math.abs(ob.amountPiastres - ob.calculatedPiastres) > 100
                return (
                  <Banner type={mismatch ? 'warning' : 'success'}>
                    💰 رصيد أول الصندوق المكتشف في الملف: <b>{(ob.amountPiastres / 100).toLocaleString('ar-EG')} ج</b> بتاريخ {ob.dateISO}.
                    سيُعتمد كنقطة ارتكاز جديدة لحساب الصندوق من هذا التاريخ فصاعداً.
                    {mismatch && <> ⚠️ يختلف عن الرصيد المحسوب تلقائياً ({(ob.calculatedPiastres / 100).toLocaleString('ar-EG')} ج) — سيُعتمد كتصحيح، راجع البيانات إن لم يكن هذا مقصوداً.</>}
                  </Banner>
                )
              })()
            ) : (
              <Banner type="warning">لم يتم العثور على خلية "رصيد أول الصندوق" في الملف — سيُستخدم آخر رصيد محسوب تلقائياً بدون نقطة ارتكاز جديدة.</Banner>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label="الملف" value={fileInfo?.fileName ?? ''} small />
              <Stat label="الشيفتات" value={String(analysis.totalBlocks)} />
              <Stat label="إجمالي المعاملات" value={String(analysis.totalTransactions)} />
              <Stat label="ستُستورد (تقديري)" value={String(estImport)} accent="#10b981" />
              <Stat label="مطابقة تلقائية" value={String(analysis.autoMapped)} />
              <Stat label="عُيّنت يدوياً" value={String(decidedMap)} />
              <Stat label="ستُتخطّى" value={String(decidedSkip)} accent="#f59e0b" />
              <Stat label="تحذيرات" value={String(analysis.warnings.length)} />
            </div>
            <NavButtons onBack={() => setStep(analysis.unknownCategories.length ? 'categories' : 'cashiers')}
              onNext={doImport} nextLabel="🚀 بدء الاستيراد" nextColor="linear-gradient(90deg,#10b981,#059669)" />
          </Card>
        )}

        {/* ═══ جارٍ الاستيراد ═══ */}
        {step === 'importing' && (
          <Card><div className="text-center py-10"><div className="text-4xl mb-3 animate-pulse">⏳</div><p className="font-bold">جارٍ الاستيراد وحفظ البيانات…</p></div></Card>
        )}

        {/* ═══ التقرير ═══ */}
        {step === 'report' && report && (
          <Card>
            <div className="text-center mb-4"><div className="text-4xl mb-2">✅</div><h3 className="font-extrabold text-lg">اكتمل الاستيراد</h3></div>
            {report.openingCheckpoint && (
              <Banner type={report.openingCheckpoint.mismatch ? 'warning' : 'success'}>
                💰 تم اعتماد رصيد أول الصندوق ({(report.openingCheckpoint.amountPiastres / 100).toLocaleString('ar-EG')} ج) بتاريخ {report.openingCheckpoint.date} كنقطة ارتكاز جديدة.
                {report.openingCheckpoint.mismatch && !ackMismatch && (
                  <div className="mt-2">
                    <div className="mb-2">⚠️ يختلف عن الرصيد الذي كان سيُحسب تلقائياً ({(report.openingCheckpoint.calculatedPiastres / 100).toLocaleString('ar-EG')} ج). القيمة المُدخلة اعتُمدت بالفعل — راجع الملف إن لم يكن هذا مقصوداً.</div>
                    <div className="flex gap-2">
                      <button onClick={() => setAckMismatch(true)} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399' }}>
                        ✓ اعتماد القيمة كما هي
                      </button>
                      <button onClick={exportErrors} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                        مراجعة الملف
                      </button>
                    </div>
                  </div>
                )}
              </Banner>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <Stat label="استُوردت" value={String(report.imported)} accent="#10b981" />
              <Stat label="شيفتات أُنشئت" value={String(report.shiftsCreated)} />
              <Stat label="مكرّرة" value={String(report.duplicates)} accent="#f59e0b" />
              <Stat label="فشلت" value={String(report.failed)} accent="#ef4444" />
              <Stat label="تُخطّيت" value={String(report.skipped)} />
              <Stat label="المدّة" value={`${(report.durationMs / 1000).toFixed(1)} ث`} />
            </div>
            <div className="flex gap-3 justify-center">
              {report.errors.length > 0 && (
                <button onClick={exportErrors} className="px-4 py-2 rounded-xl font-bold text-sm" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                  ⬇ تصدير الأخطاء ({report.errors.length})
                </button>
              )}
              <button onClick={reset} className="px-4 py-2 rounded-xl font-bold text-sm text-white" style={{ background: 'linear-gradient(90deg,#3b82f6,#8b5cf6)' }}>
                استيراد ملف آخر
              </button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// ═══ مكوّنات مساعدة ═══
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl p-5 mt-4" style={{ background: 'var(--app-bg-solid)', border: '1px solid var(--border, rgba(255,255,255,0.10))' }}>{children}</div>
}
function Banner({ type, children }: { type: 'warning' | 'success'; children: React.ReactNode }) {
  const c = type === 'warning' ? { bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.4)', tx: '#fbbf24' } : { bg: 'rgba(16,185,129,0.12)', bd: 'rgba(16,185,129,0.4)', tx: '#34d399' }
  return <div className="p-3 rounded-lg text-sm mb-3" style={{ background: c.bg, border: `1px solid ${c.bd}`, color: c.tx }}>{children}</div>
}
function SummaryBar({ a }: { a: AnalysisResult }) {
  return (
    <div className="flex gap-4 flex-wrap text-sm mb-3 pb-3" style={{ borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))' }}>
      <span><b>{a.totalBlocks}</b> شيفت</span>
      <span><b>{a.totalTransactions}</b> معاملة</span>
      <span style={{ color: '#34d399' }}><b>{a.autoMapped}</b> مطابقة تلقائية</span>
      <span style={{ color: '#fbbf24' }}><b>{a.unknownCategories.length}</b> فئة مجهولة</span>
    </div>
  )
}
function Stat({ label, value, accent, small }: { label: string; value: string; accent?: string; small?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface-2, rgba(255,255,255,0.03))', border: '1px solid var(--border, rgba(255,255,255,0.08))' }}>
      <div className="text-xs mb-1" style={{ color: 'var(--txt-2)' }}>{label}</div>
      <div className="font-extrabold tabular-nums truncate" style={{ fontSize: small ? 13 : 20, color: accent ?? 'var(--txt-1)' }}>{value}</div>
    </div>
  )
}
function NavButtons({ onBack, onNext, nextLabel, backLabel = 'رجوع', nextDisabled, nextColor }: {
  onBack: () => void; onNext: () => void; nextLabel: string; backLabel?: string; nextDisabled?: boolean; nextColor?: string
}) {
  return (
    <div className="flex justify-between mt-5">
      <button onClick={onBack} className="px-4 py-2 rounded-xl font-bold text-sm" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--txt-1)' }}>{backLabel}</button>
      <button onClick={onNext} disabled={nextDisabled}
        className="px-5 py-2 rounded-xl font-bold text-sm text-white"
        style={{ background: nextColor ?? 'linear-gradient(90deg,#3b82f6,#8b5cf6)', opacity: nextDisabled ? 0.5 : 1 }}>{nextLabel}</button>
    </div>
  )
}
function Stepper({ step }: { step: Step }) {
  const steps: [Step, string][] = [['start', 'الملف'], ['cashiers', 'الكاشير'], ['categories', 'الفئات'], ['preview', 'المعاينة'], ['report', 'التقرير']]
  const idx = steps.findIndex(s => s[0] === step || (step === 'importing' && s[0] === 'preview'))
  return (
    <div className="flex items-center gap-2 text-xs">
      {steps.map(([id, label], i) => (
        <div key={id} className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full font-bold" style={{
            background: i <= idx ? 'linear-gradient(90deg,#3b82f6,#8b5cf6)' : 'rgba(255,255,255,0.06)',
            color: i <= idx ? '#fff' : 'var(--txt-2)',
          }}>{i + 1}. {label}</span>
          {i < steps.length - 1 && <span style={{ color: 'var(--txt-2)' }}>›</span>}
        </div>
      ))}
    </div>
  )
}
