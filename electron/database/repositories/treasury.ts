import type Database from 'better-sqlite3'
import { createNotification } from './notifications'

// صف حركة الخزينة — قد يكون شيفت أو تسوية (راتب/سحب)
export interface TreasuryRow {
  kind:        'shift' | 'adjustment'
  id:          number
  shiftNum:    number | null
  date:        string
  label:       string   // اسم الكاشير أو وصف التسوية
  cashIn:      number   // وارد (نقدية متبقية)
  mgmtOut:     number   // منصرف (إدارة/راتب/سحب)
  net:         number
  running:     number   // الرصيد المتراكم بعد هذه الحركة
  status:      string   // حالة الشيفت أو نوع التسوية
}

export interface TreasuryData {
  opening:        number   // رصيد نقطة الارتكاز المعتمدة لبداية الفترة المعروضة — لتعبئة نموذج التعديل فقط
  prevBalance:    number   // الرصيد قبل بداية الفترة المعروضة (= رصيد أول الفترة). مع month='all' هذا هو رصيد الصندوق قبل أول شيفت في البرنامج على الإطلاق.
  shiftsCount:    number   // عدد حركات الفترة المعروضة
  monthIn:        number   // وارد الفترة المعروضة
  monthOut:       number   // منصرف الفترة المعروضة (إدارة + تسويات)
  movements:      TreasuryRow[]   // حركات الفترة (شيفتات + تسويات) مع الرصيد المتراكم
  firstShiftDate: string | null   // تاريخ أول شيفت مسجَّل في البرنامج على الإطلاق (بلا اعتماد على الفترة المعروضة) — لعرضه بجانب رصيد أول الفترة في وضع "الكل"
}

export interface TreasuryCheckpoint {
  date:   string
  amount: number
}

// آخر نقطة ارتكاز بتاريخ ≤ التاريخ المطلوب (أساس الحساب لهذه الفترة وما بعدها فقط)
function checkpointBefore(db: Database.Database, date: string): TreasuryCheckpoint {
  const row = db.prepare(
    `SELECT date, amount FROM treasury_checkpoints WHERE date <= ? ORDER BY date DESC, id DESC LIMIT 1`
  ).get(date) as TreasuryCheckpoint | undefined
  return row ?? { date: '0000-01-01', amount: 0 }
}

// رصيد الصندوق كما كان محسوباً تلقائياً عند تاريخ معيّن (يُستخدم لمقارنته بقيمة يدخلها العميل عند الاستيراد)
export function getBalanceAsOf(db: Database.Database, date: string): number {
  const cp = checkpointBefore(db, date)
  const one = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { t: number }).t
  const inc = one(`SELECT COALESCE(SUM(cashier_remaining),0) AS t FROM shifts WHERE status IN ${STATUSES} AND date >= ? AND date < ?`, cp.date, date)
  const mgmt = one(`SELECT COALESCE(SUM(t.amount_out),0) AS t FROM transactions t JOIN shifts s ON s.id=t.shift_id WHERE t.pay_method='management' AND s.status IN ${STATUSES} AND s.date >= ? AND s.date < ?`, cp.date, date)
  let adj = 0
  try { adj = one(`SELECT COALESCE(SUM(amount),0) AS t FROM treasury_adjustments WHERE date >= ? AND date < ?`, cp.date, date) } catch { /* الجدول قد لا يكون موجوداً */ }
  return cp.amount + inc - mgmt - adj
}

// إضافة نقطة ارتكاز جديدة (يدوية أو من استيراد إكسيل) — تصبح الأساس لكل ما بعد تاريخها فقط، ولا تؤثر رجعياً على الماضي
export function addTreasuryCheckpoint(
  db: Database.Database,
  data: { date: string; amount: number; source?: string; note?: string }
): number {
  const res = db.prepare(
    `INSERT INTO treasury_checkpoints (date, amount, source, note) VALUES (?, ?, ?, ?)`
  ).run(data.date, data.amount, data.source ?? 'manual', data.note ?? '')
  return res.lastInsertRowid as number
}

// مدفوعات الإدارة لشيفت معيّن
const MGMT_BY_SHIFT = `
  SELECT COALESCE(SUM(amount_out), 0) AS total
  FROM transactions WHERE shift_id = ? AND pay_method = 'management'
`
const STATUSES = `('open','review','approved')`

// بطلب العميل — month='all' يعني "كل الفترات": نفس المعادلات بالضبط، لكن بلا حدود شهر — من أول شيفت في البرنامج
// على الإطلاق إلى آخر شيفت. بهذا تصبح المعادلات موحَّدة 100% بين وضع "شهر محدد" ووضع "الكل"، بلا أي منطق مضاعف.
export function getTreasuryData(db: Database.Database, month: string): TreasuryData {
  const isAll = month === 'all'
  const one = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { t: number }).t

  // أول شيفت مسجَّل في البرنامج على الإطلاق — أساس وضع "الكل"، ومعروض دائماً بجانب "رصيد أول الفترة" في هذا الوضع
  const firstShift = db.prepare(`SELECT MIN(date) AS d FROM shifts WHERE status IN ${STATUSES}`).get() as { d: string | null }
  const firstShiftDate = firstShift.d

  const monthStart = isAll ? (firstShiftDate ?? '0000-01-01') : `${month}-01`
  const dateLike    = isAll ? '%' : `${month}%`

  // آخر نقطة ارتكاز قبل بداية الفترة المعروضة
  const cpMonth = checkpointBefore(db, monthStart)

  let adjPrev = 0
  try {
    adjPrev = one(`SELECT COALESCE(SUM(amount),0) AS t FROM treasury_adjustments WHERE date >= ? AND date < ?`, cpMonth.date, monthStart)
  } catch { /* الجدول قد لا يكون موجوداً */ }

  // ===== الرصيد قبل بداية الفترة المعروضة (منذ آخر نقطة ارتكاز قبلها فقط) =====
  const incPrev = one(`SELECT COALESCE(SUM(cashier_remaining),0) AS t FROM shifts WHERE status IN ${STATUSES} AND date >= ? AND date < ?`, cpMonth.date, monthStart)
  const mgmtPrev = one(`SELECT COALESCE(SUM(t.amount_out),0) AS t FROM transactions t JOIN shifts s ON s.id=t.shift_id WHERE t.pay_method='management' AND s.status IN ${STATUSES} AND s.date >= ? AND s.date < ?`, cpMonth.date, monthStart)
  const prevBalance = cpMonth.amount + incPrev - mgmtPrev - adjPrev

  // ===== حركات الفترة: الشيفتات + التسويات =====
  const shifts = db.prepare(`
    SELECT id, monthly_shift_num AS num, date, cashier_name AS cashier,
           cashier_remaining AS cashIn, status
    FROM shifts WHERE date LIKE ? AND status IN ${STATUSES}
  `).all(dateLike) as { id: number; num: number; date: string; cashier: string; cashIn: number; status: string }[]

  let adjustments: { id: number; date: string; description: string; type: string; amount: number }[] = []
  try {
    adjustments = db.prepare(`
      SELECT id, date, description, type, amount FROM treasury_adjustments WHERE date LIKE ?
    `).all(dateLike) as typeof adjustments
  } catch { /* */ }

  // جلب كل مصروفات الإدارة للفترة مرة واحدة لتجنب N+1
  const mgmtOutByShiftId = new Map<number, number>()
  try {
    const mgmtRows = db.prepare(`
      SELECT s.id AS shift_id, COALESCE(SUM(t.amount_out), 0) AS total
      FROM shifts s JOIN transactions t ON s.id = t.shift_id
      WHERE s.date LIKE ? AND t.pay_method = 'management' AND s.status IN ${STATUSES}
      GROUP BY s.id
    `).all(dateLike) as { shift_id: number; total: number }[]
    mgmtRows.forEach(r => mgmtOutByShiftId.set(r.shift_id, r.total))
  } catch { /* */ }

  // دمج الحركات وترتيبها بالتاريخ
  const merged: TreasuryRow[] = [
    ...shifts.map(s => {
      const mgmtOut = mgmtOutByShiftId.get(s.id) ?? 0
      const cashIn = s.cashIn || 0
      return { kind: 'shift' as const, id: s.id, shiftNum: s.num, date: s.date,
        label: s.cashier, cashIn, mgmtOut, net: cashIn - mgmtOut, running: 0, status: s.status }
    }),
    ...adjustments.map(a => ({
      kind: 'adjustment' as const, id: a.id, shiftNum: null, date: a.date,
      label: a.description || (a.type === 'salary_payout' ? 'دفع رواتب' : a.type === 'salary_reversal' ? 'عكس رواتب' : 'سحب من الخزينة'),
      // كل التسويات في جانب "المنصرف" (signed): موجب=صرف، سالب=عكس/إرجاع يقلّل المنصرف
      cashIn: 0,
      mgmtOut: a.amount,
      net: -a.amount, running: 0, status: a.type,
    })),
  ].sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id)

  // نقاط ارتكاز إضافية وقعت داخل الفترة نفسها (بعد cpMonth) — مثلاً استيراد إكسيل لجزء من الشهر بدأ منتصفه،
  // أو تعديل يدوي لاحق. cpMonth/prevBalance لا يعرفان عنها لأنهما محسوبان عند بداية الفترة فقط، فيجب "القفز"
  // إليها أثناء المرور على الحركات بالترتيب الزمني، وإلا استمر الحساب من الرصيد القديم بالخطأ.
  const midCheckpoints = db.prepare(
    `SELECT date, amount FROM treasury_checkpoints WHERE date LIKE ? AND date > ? ORDER BY date ASC, id ASC`
  ).all(dateLike, cpMonth.date) as { date: string; amount: number }[]

  let running = prevBalance, monthIn = 0, monthOut = 0, cpIdx = 0
  for (const m of merged) {
    while (cpIdx < midCheckpoints.length && midCheckpoints[cpIdx].date <= m.date) {
      running = midCheckpoints[cpIdx].amount
      cpIdx++
    }
    running += m.net; m.running = running
    monthIn += m.cashIn; monthOut += m.mgmtOut
  }

  return {
    opening:        cpMonth.amount,
    prevBalance,
    shiftsCount:    merged.length,
    monthIn,
    monthOut,
    movements:      merged,
    firstShiftDate,
  }
}

export interface TreasuryPosition {
  opening: number   // رصيد الصندوق فور بداية الفترة (قبل أي شيفت بتاريخ fromDate)
  incoming: number  // وارد الفترة (نقدية الكاشير)
  outgoing: number  // منصرف الفترة (إدارة + تسويات)
  closing: number   // رصيد الصندوق في نهاية الفترة = opening + incoming − outgoing
}

// رصيد الصندوق لأي مدى تاريخ مرن (يوم/شهر/سنة/كل الفترات) — يُستخدم في لوحة المعلومات بدل شاشة الصندوق الشهرية الثابتة.
// toDateExclusive حصري (لا يشمل تاريخه نفسه)، بنفس اصطلاح باقي استعلامات هذا الملف.
export function getTreasuryPosition(db: Database.Database, fromDate: string, toDateExclusive: string): TreasuryPosition {
  const opening = getBalanceAsOf(db, fromDate)
  const one = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { t: number }).t
  const incoming = one(`SELECT COALESCE(SUM(cashier_remaining),0) AS t FROM shifts WHERE status IN ${STATUSES} AND date >= ? AND date < ?`, fromDate, toDateExclusive)
  const mgmt = one(`SELECT COALESCE(SUM(t.amount_out),0) AS t FROM transactions t JOIN shifts s ON s.id=t.shift_id WHERE t.pay_method='management' AND s.status IN ${STATUSES} AND s.date >= ? AND s.date < ?`, fromDate, toDateExclusive)
  let adj = 0
  try { adj = one(`SELECT COALESCE(SUM(amount),0) AS t FROM treasury_adjustments WHERE date >= ? AND date < ?`, fromDate, toDateExclusive) } catch { /* الجدول قد لا يكون موجوداً */ }
  const outgoing = mgmt + adj
  // closing = getBalanceAsOf(toDateExclusive) لا opening+incoming-outgoing — لأن نقطة ارتكاز جديدة قد تقع
  // داخل المدى نفسه (بين fromDate وtoDateExclusive)، فتُعيد ضبط الرصيد بمعزل عن الجمع الخطي البسيط.
  const closing = getBalanceAsOf(db, toDateExclusive)
  return { opening, incoming, outgoing, closing }
}

export interface ShiftTreasuryPosition {
  before: number   // رصيد الصندوق قبل هذا الشيفت
  cashIn: number   // نقدية هذا الشيفت
  mgmtOut: number  // مصروفات إدارة هذا الشيفت
  after: number    // رصيد الصندوق بعد هذا الشيفت (= قبل + نقدية − مصروفات)
}

// موضع شيفت معيّن على خط رصيد الصندوق (قبل/بعد) — لعرضه في بطاقة الشيفت نفسها للتحقّق السريع
export function getShiftTreasuryPosition(db: Database.Database, shiftId: number): ShiftTreasuryPosition | null {
  const shift = db.prepare(`SELECT date FROM shifts WHERE id = ?`).get(shiftId) as { date: string } | undefined
  if (!shift) return null
  const month = shift.date.slice(0, 7)
  const data = getTreasuryData(db, month)
  const idx = data.movements.findIndex(m => m.kind === 'shift' && m.id === shiftId)
  if (idx === -1) return null
  const m = data.movements[idx]
  // before = after − net دائماً صحيح (يراعي تلقائياً أي نقطة ارتكاز وسط الشهر تسبق هذا الشيفت مباشرة)
  const before = m.running - m.net
  return { before, cashIn: m.cashIn, mgmtOut: m.mgmtOut, after: m.running }
}

// ═══ v2.27.0 (14-Jun) — إضافة تسوية (خصم) من خزينة الإدارة ═══
export function addTreasuryAdjustment(
  db: Database.Database,
  data: { date: string; type: string; description: string; amount: number }
): number {
  const res = db.prepare(
    `INSERT INTO treasury_adjustments (date, type, description, amount) VALUES (?, ?, ?, ?)`
  ).run(data.date, data.type, data.description, data.amount)
  return res.lastInsertRowid as number
}

// ═══ تقارير الرواتب ═══
export function savePayrollReport(
  db: Database.Database,
  data: { month: string; totalAmount: number; paymentMethod: string; employeeCount: number; detailsJson: string }
): number {
  const res = db.prepare(
    `INSERT INTO payroll_reports (month, total_amount, payment_method, employee_count, details_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(data.month, data.totalAmount, data.paymentMethod, data.employeeCount, data.detailsJson)
  return res.lastInsertRowid as number
}

export function listPayrollReports(db: Database.Database): unknown[] {
  return db.prepare(`SELECT * FROM payroll_reports ORDER BY created_at DESC`).all()
}

// حذف تقرير راتب + عكس خصم الخزينة (تسوية عكسية سالبة تُعيد المبلغ)
export function deletePayrollReport(db: Database.Database, id: number): boolean {
  const rep = db.prepare(`SELECT month, total_amount FROM payroll_reports WHERE id = ?`).get(id) as { month: string; total_amount: number } | undefined
  if (!rep) return false
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM payroll_reports WHERE id = ?`).run(id)
    // عكس الخصم: تسوية بقيمة سالبة تُعيد المبلغ لخزينة الإدارة
    db.prepare(`INSERT INTO treasury_adjustments (date, type, description, amount) VALUES (?, ?, ?, ?)`)
      .run(new Date().toISOString().slice(0, 10), 'salary_reversal', `إلغاء رواتب شهر ${rep.month}`, -rep.total_amount)
  })
  tx()
  return true
}

// ═══ تقارير التقفيل الشهري ═══

export function listMonthlyCloses(db: Database.Database): unknown[] {
  return db.prepare(`SELECT * FROM monthly_close_reports ORDER BY month DESC`).all()
}

export function getMonthlyClose(db: Database.Database, month: string): unknown {
  return db.prepare(`SELECT * FROM monthly_close_reports WHERE month = ?`).get(month) ?? null
}

// اعتماد التقفيل الشهري — يحفظ اللقطة النهائية (Snapshot) ويجمّدها؛ يُستدعى فقط بعد التأكد من عدم وجود أخطاء مانعة بالواجهة
export function approveMonthClose(db: Database.Database, month: string, dataJson: string, userId: number): void {
  db.prepare(`
    INSERT INTO monthly_close_reports (month, data_json, status, approved_by, approved_at, unapproved_at)
    VALUES (?, ?, 'approved', ?, datetime('now'), NULL)
    ON CONFLICT(month) DO UPDATE SET
      data_json=excluded.data_json, status='approved', approved_by=excluded.approved_by,
      approved_at=datetime('now'), unapproved_at=NULL, created_at=datetime('now')
  `).run(month, dataJson, userId)
  createNotification(db, {
    type: 'info',
    title: 'تم اعتماد التقفيل الشهري',
    message: `تم اعتماد تقفيل شهر ${month} — النتائج مجمَّدة الآن ولا يمكن تعديل قيود هذا الشهر`,
  })
}

// فك اعتماد التقفيل الشهري — يُعيد الشهر لوضع "مفتوح" ليسمح بتعديل القيود وإعادة الاحتساب
export function unapproveMonthClose(db: Database.Database, month: string, _userId: number): void {
  const res = db.prepare(`
    UPDATE monthly_close_reports SET status='open', approved_by=NULL, approved_at=NULL, unapproved_at=datetime('now')
    WHERE month = ? AND status='approved'
  `).run(month)
  if (res.changes === 0) throw new Error(`شهر ${month} غير مُعتمَد أصلاً — لا يوجد ما يُفَك اعتماده`)
}

// حارس القفل الشهري — يُستدعى من كل دوال كتابة القيود/الشيفتات لمنع التعديل في شهر مُعتمَد ومُجمَّد
export function assertMonthUnlocked(db: Database.Database, date: string): void {
  const month = date.slice(0, 7)
  const row = db.prepare(`SELECT status FROM monthly_close_reports WHERE month = ?`).get(month) as { status: string } | undefined
  if (row?.status === 'approved')
    throw new Error(`شهر ${month} مُقفَل (تم اعتماد تقفيله) — يجب فك اعتماد التقفيل الشهري من شاشة التقارير أولاً قبل تعديل أي قيد أو شيفت في هذا الشهر`)
}
