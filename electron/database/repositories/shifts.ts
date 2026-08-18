import type Database from 'better-sqlite3'
import type { Shift, ShiftFawry, ShiftCustody, Journal } from '../../../core/types'
import { detectShiftType, calcMonthlyShiftNum, calcShiftClosing } from '../../../core/engine'
import { assertMonthUnlocked } from './treasury'
import { createNotification } from './notifications'
import { deleteLedgerEntriesByShift } from './parties'

// عتبة تنبيه العجز/الأوفر بالقروش (settings.alert_threshold) — الافتراضي 0 أي "نبّه على أي فرق".
// تتجاهل أي قيمة مخزَّنة غير صالحة (مثل 'NaN') بدل أن تُعطّل التنبيهات كلياً.
function getAlertThreshold(db: Database.Database): number {
  const row = db.prepare(`SELECT value FROM settings WHERE key='alert_threshold'`).get() as { value: string } | undefined
  const n = Number(row?.value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

// يحسم تاريخ الشيفت لأغراض حارس القفل الشهري، ويتحقق منه فورًا
function assertShiftMonthUnlocked(db: Database.Database, shiftId: number): void {
  const row = db.prepare(`SELECT date FROM shifts WHERE id = ?`).get(shiftId) as { date: string } | undefined
  if (row) assertMonthUnlocked(db, row.date)
}

// ===== تحويل الصفوف =====
function row2shift(r: Record<string, unknown>): Shift {
  return {
    id:                 r.id as number,
    branchId:           r.branch_id as number,
    monthlyShiftNum:    r.monthly_shift_num as number,
    date:               r.date as string,
    type:               r.type as Shift['type'],
    cashierUserId:      r.cashier_user_id as number,
    cashierName:        r.cashier_name as string,
    startTime:          r.start_time as string,
    endTime:            r.end_time as string | null,
    status:             r.status as Shift['status'],
    openingBalance:     r.opening_balance as number,
    closingBalance:     r.closing_balance as number | null,
    note:               r.note as string,
    createdBy:          r.created_by as number,
    approvedBy:         r.approved_by as number | null,
    approvedAt:         r.approved_at as string | null,
    posSales:           (r.pos_sales           as number) ?? 0,
    cashierRemaining:   (r.cashier_remaining   as number) ?? 0,
    cashierCollections: (r.cashier_collections as number) ?? 0,
    shiftExpenses:      (r.shift_expenses      as number) ?? 0,
  }
}

function row2fawry(r: Record<string, unknown>): ShiftFawry {
  return {
    id:              r.id as number,
    shiftId:         r.shift_id as number,
    basicReceive:    r.basic_receive as number,
    basicDeliver:    r.basic_deliver as number,
    airReceive:      r.air_receive as number,
    airDeliver:      r.air_deliver as number,
    cashoutReceive:  r.cashout_receive as number,
    cashoutDeliver:  r.cashout_deliver as number,
    fawryToBasic:    r.fawry_to_basic as number,
    fawryToAir:      r.fawry_to_air as number,
    cashoutToBasic:  r.cashout_to_basic as number,
    cashoutToAir:    r.cashout_to_air as number,
    programSales:    r.program_sales as number,
    firstVoucher:    r.first_voucher as number,
    lastVoucher:     r.last_voucher as number,
    fawryTotalManual: (r.fawry_total_manual as number) ?? 0,
  }
}

// ===== الشيفتات =====
export function createShift(
  db: Database.Database,
  data: {
    cashierUserId: number
    cashierName: string
    date: string
    startTime: string
    openingBalance: number
    createdBy: number
    note?: string
    type?: 'morning' | 'evening' | 'between'   // اختياري — يُختار يدوياً وإلا يُشتق من الوقت
  }
): Shift {
  const shiftType = data.type ?? detectShiftType(data.startTime)

  // رقم الشيفت الشهري — من أكبر رقم مستخدَم في الشهر لا من عدد الشيفتات (يمنع التكرار بعد الحذف)
  const month = data.date.substring(0, 7)
  const existingNums = (db
    .prepare(`SELECT monthly_shift_num AS n FROM shifts WHERE date LIKE ?`)
    .all(`${month}%`) as { n: number }[]).map(r => r.n)
  const monthlyNum = calcMonthlyShiftNum(existingNums)

  // الشيفت وتوابعه (يومية + فوري + عهدة) وحدة واحدة — أي فشل جزئي كان يترك شيفتاً بلا يومية
  // فتفشل عليه كل عمليات إضافة البنود لاحقاً
  const shiftId = db.transaction(() => {
    const res = db.prepare(`
      INSERT INTO shifts
        (branch_id, monthly_shift_num, date, type, cashier_user_id, cashier_name,
         start_time, opening_balance, created_by, note)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(monthlyNum, data.date, shiftType, data.cashierUserId, data.cashierName,
           data.startTime, data.openingBalance, data.createdBy, data.note ?? '')

    const id = res.lastInsertRowid as number

    // إنشاء يومية تلقائية
    const journalNum = `J-${data.date.replace(/-/g, '')}-${String(monthlyNum).padStart(2, '0')}`
    db.prepare(`INSERT INTO journals (shift_id, journal_num) VALUES (?, ?)`).run(id, journalNum)

    // إنشاء سجل فوري وعهدة فارغ
    db.prepare(`INSERT INTO shift_fawry (shift_id) VALUES (?)`).run(id)
    db.prepare(`INSERT INTO shift_custody (shift_id) VALUES (?)`).run(id)
    return id
  })()

  return row2shift(db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(shiftId) as Record<string, unknown>)
}

export function getShiftById(db: Database.Database, id: number): Shift | null {
  const row = db.prepare(`SELECT * FROM shifts WHERE id = ?`).get(id) as Record<string, unknown> | undefined
  return row ? row2shift(row) : null
}

export function getShifts(
  db: Database.Database,
  opts: { limit?: number; offset?: number; month?: string; status?: string } = {}
): Shift[] {
  let q = `SELECT * FROM shifts WHERE 1=1`
  const params: (string | number)[] = []
  if (opts.month)  { q += ` AND date LIKE ?`;   params.push(`${opts.month}%`) }
  if (opts.status) { q += ` AND status = ?`;    params.push(opts.status) }
  q += ` ORDER BY date DESC, start_time DESC`
  if (opts.limit)  { q += ` LIMIT ?`;  params.push(opts.limit) }
  if (opts.offset) { q += ` OFFSET ?`; params.push(opts.offset) }
  return (db.prepare(q).all(...params) as Record<string, unknown>[]).map(row2shift)
}

export function getActiveShift(db: Database.Database): Shift | null {
  const row = db.prepare(`SELECT * FROM shifts WHERE status = 'open' ORDER BY date DESC, start_time DESC LIMIT 1`).get() as Record<string, unknown> | undefined
  return row ? row2shift(row) : null
}

export function updateShiftStatus(
  db: Database.Database,
  shiftId: number,
  status: Shift['status'],
  userId: number
): void {
  assertShiftMonthUnlocked(db, shiftId)
  if (status === 'approved') {
    // إعادة احتساب التحصيل ومصروفات الكاشير من البنود قبل الاعتماد، حتى لا يُعتمد الشيفت
    // بمشتقّات قديمة إن أُضيف/عُدِّل بند بعد آخر حفظ لمدخلات التقفيل
    recalcShiftDerived(db, shiftId)
    db.prepare(`UPDATE shifts SET status=?, approved_by=?, approved_at=datetime('now') WHERE id=?`)
      .run(status, userId, shiftId)
    db.prepare(`UPDATE journals SET status='approved', approved_by=?, approved_at=datetime('now') WHERE shift_id=?`)
      .run(userId, shiftId)
    notifyShiftBalance(db, shiftId)
  } else {
    // تصفير بيانات الاعتماد عند إعادة الفتح — كانت تبقى كما هي فيظل الشيفت المفتوح
    // يحمل توقيع من اعتمده وتاريخ اعتماده
    db.prepare(`UPDATE shifts SET status=?, approved_by=NULL, approved_at=NULL WHERE id=?`).run(status, shiftId)
    db.prepare(`UPDATE journals SET status=?, approved_by=NULL, approved_at=NULL WHERE shift_id=?`).run(status, shiftId)
  }
}

/**
 * تنبيه العجز/الأوفر عند اعتماد الشيفت — بنفس معادلة الإغلاق الرسمية (core/engine).
 *
 * كان هذا المنطق داخل `closeShift`، وهي دالة **لم تكن تُستدعى من أي شاشة إطلاقاً** (الإقفال الحي
 * يمرّ بـ`updateShiftCloseInputs` ثم `updateShiftStatus('approved')`). فكانت النتيجة أن تنبيهات
 * العجز/الأوفر لا تُنشأ أبداً رغم وجود شاشة تنبيهات تعرضها وإعداد عتبة يضبطها. نُقل هنا إلى
 * مسار الاعتماد الفعلي، وحُذفت `closeShift` كلياً.
 *
 * فوري: يُقرأ `fawry_total_manual` فقط ولا يُسقَط على `program_sales` إطلاقاً — لأن مبيعات
 * البرنامج للشيفتات المستورَدة داخلة أصلاً في `pos_sales` فتُحتسَب مرتين (راجع CLAUDE.md).
 */
function notifyShiftBalance(db: Database.Database, shiftId: number): void {
  const shift = db.prepare(`
    SELECT monthly_shift_num AS num, cashier_name AS cashier, pos_sales AS posSales,
           cashier_remaining AS cashierRemaining, cashier_collections AS collections,
           shift_expenses AS expenses
    FROM shifts WHERE id = ?
  `).get(shiftId) as {
    num: number; cashier: string; posSales: number
    cashierRemaining: number; collections: number; expenses: number
  } | undefined
  if (!shift) return

  const fawryRow = db.prepare(`SELECT fawry_total_manual FROM shift_fawry WHERE shift_id = ?`)
    .get(shiftId) as { fawry_total_manual: number } | undefined

  const { result, status } = calcShiftClosing({
    posSales:         shift.posSales,
    fawrySales:       fawryRow?.fawry_total_manual ?? 0,
    cashierRemaining: shift.cashierRemaining,
    cashierExpenses:  shift.expenses,
    collections:      shift.collections,
  })

  // تنبيه واحد فقط لكل شيفت — إعادة الاعتماد تستبدل التنبيه القديم بدل تكديس نسخ منه
  db.prepare(`DELETE FROM notifications WHERE shift_id = ? AND type IN ('deficit','surplus')`).run(shiftId)

  // عتبة التنبيه (قروش) من الإعدادات — كانت مبذورة وقابلة للتحرير في شاشة الإعدادات
  // لكن لا يقرؤها أي كود على الإطلاق
  if (status === 'balanced' || Math.abs(result) < getAlertThreshold(db)) return

  const amountEgp = (Math.abs(result) / 100).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  createNotification(db, {
    type: status,
    title: status === 'deficit' ? 'عجز في شيفت' : 'أوفر في شيفت',
    message: `شيفت #${shift.num} (${shift.cashier}) — الفرق: ${amountEgp} ج`,
    shiftId,
  })
}

// ADR-012 v2 — تحرير بيانات الشيفت (التاريخ/النوع/اسم الكاشير) يدوياً
export function updateShiftMeta(
  db: Database.Database,
  shiftId: number,
  data: { date?: string; type?: 'morning' | 'evening' | 'between'; cashierName?: string }
): void {
  assertShiftMonthUnlocked(db, shiftId)
  const sets: string[] = []; const vals: (string | number)[] = []
  if (data.date !== undefined) { sets.push('date = ?'); vals.push(data.date) }
  if (data.type !== undefined) { sets.push('type = ?'); vals.push(data.type) }
  if (data.cashierName !== undefined) { sets.push('cashier_name = ?'); vals.push(data.cashierName) }
  if (!sets.length) return
  db.prepare(`UPDATE shifts SET ${sets.join(', ')} WHERE id = ?`).run(...vals, shiftId)
}

// ADR-012 — تحديث مدخلات إغلاق الكاشير (POS + نقدية متبقية) وإعادة حساب المشتقّات
// بنفس معادلة closeShift تماماً، لكن بلا تغيير الحالة (تحرير مباشر داخل الورقة الموحّدة).
//
// `posSales` و`cashierRemaining` اختياريان: الحقل غير المُمرَّر يُترك على قيمته المخزَّنة.
// (كان النوع يُلزم بتمرير الاثنين، فكان الاستيراد يمرّر `?? 0` للحقل الغائب من الشيت
//  فيدهس القيمة الصحيحة بصفر — ولو كان الغائب هو مبيعات POS ظهر عجز وهمي بحجم مبيعات الشيفت كله.)
export function updateShiftCloseInputs(
  db: Database.Database,
  shiftId: number,
  data: { posSales?: number; cashierRemaining?: number }
): void {
  assertShiftMonthUnlocked(db, shiftId)
  recalcShiftDerived(db, shiftId, data)
}

// إعادة احتساب مشتقّات التقفيل (التحصيل + مصروفات الكاشير) من بنود الشيفت،
// مع تحديث اختياري لمدخلات الكاشير اليدوية.
function recalcShiftDerived(
  db: Database.Database,
  shiftId: number,
  data: { posSales?: number; cashierRemaining?: number } = {},
): void {
  const collectionsRow = db.prepare(`
    SELECT COALESCE(SUM(amount_in), 0) AS total
    FROM transactions t JOIN main_categories mc ON t.main_category_id=mc.id WHERE t.shift_id = ? AND mc.name = 'تحصيل'
  `).get(shiftId) as { total: number }
  const expensesRow = db.prepare(`
    SELECT COALESCE(SUM(amount_out), 0) AS total
    FROM transactions WHERE shift_id = ? AND pay_method != 'management'
  `).get(shiftId) as { total: number }

  const sets = ['cashier_collections=?', 'shift_expenses=?']
  const vals: number[] = [collectionsRow.total, expensesRow.total]
  if (data.posSales         !== undefined) { sets.push('pos_sales=?');         vals.push(data.posSales) }
  if (data.cashierRemaining !== undefined) { sets.push('cashier_remaining=?'); vals.push(data.cashierRemaining) }
  db.prepare(`UPDATE shifts SET ${sets.join(', ')} WHERE id=?`).run(...vals, shiftId)
}

// الشيفتات المستوردة من Excel لا تمرّ بـ`closeShift`، فلا يُحسب لها التحصيل ولا مصروفات
// الكاشير إطلاقاً ما لم يحتوِ الشيت على خانتَي التقفيل. تُستدعى بعد إدراج بنود الشيفت.
export function recalcShiftClosingTotals(db: Database.Database, shiftId: number): void {
  recalcShiftDerived(db, shiftId)
}

// استيراد Excel — يثق برقم «مصروفات الكاشير» المُصالَح فعلياً في الشيت المرجعي (قروش)
// بدل الاشتقاق من (pay_method != 'management') على البنود المستوردة، والذي قد ينتفخ إذا كان
// عمود «الدفع» فارغاً لبنود مشتريات/مصروفات/أجور جُمعية لا تمثّل صرفاً فعلياً من درج الكاشير.
export function overrideShiftExpenses(db: Database.Database, shiftId: number, shiftExpensesPias: number): void {
  assertShiftMonthUnlocked(db, shiftId)
  db.prepare(`UPDATE shifts SET shift_expenses=? WHERE id=?`).run(shiftExpensesPias, shiftId)
}

// ===== بيانات فوري =====
export function getFawry(db: Database.Database, shiftId: number): ShiftFawry | null {
  const row = db.prepare(`SELECT * FROM shift_fawry WHERE shift_id=?`).get(shiftId) as Record<string, unknown> | undefined
  return row ? row2fawry(row) : null
}

// ADR-012 v2 — قيم فوري لكل الشيفتات (للوحة المعلومات التراكمية)
export function getAllFawryClosing(db: Database.Database): { shiftId: number; programSales: number; fawryTotalManual: number }[] {
  return (db.prepare(`
    SELECT shift_id AS shiftId, program_sales AS programSales, fawry_total_manual AS fawryTotalManual FROM shift_fawry
  `).all() as { shiftId: number; programSales: number; fawryTotalManual: number }[])
}

export function updateFawry(
  db: Database.Database,
  shiftId: number,
  data: Partial<Omit<ShiftFawry, 'id' | 'shiftId'>>
): void {
  assertShiftMonthUnlocked(db, shiftId)
  const fields = Object.keys(data)
    .map(k => `${k.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`)
    .join(', ')
  const values = Object.values(data)
  db.prepare(`UPDATE shift_fawry SET ${fields} WHERE shift_id=?`).run(...values, shiftId)
}

// ===== العهدة =====
export function getCustody(db: Database.Database, shiftId: number): ShiftCustody | null {
  const row = db.prepare(`SELECT * FROM shift_custody WHERE shift_id=?`).get(shiftId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id:             row.id as number,
    shiftId:        row.shift_id as number,
    addFromFund:    row.add_from_fund as number,
    managementPaid: row.management_paid as number,
  }
}

// دفعة عهدة لعدة شيفتات (للوحة المعلومات — تجميع فتري بلا استعلام لكل شيفت)
export function getCustodyByShiftIds(db: Database.Database, shiftIds: number[]): ShiftCustody[] {
  if (shiftIds.length === 0) return []
  const placeholders = shiftIds.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM shift_custody WHERE shift_id IN (${placeholders})`).all(...shiftIds) as Record<string, unknown>[]
  return rows.map(row => ({
    id:             row.id as number,
    shiftId:        row.shift_id as number,
    addFromFund:    row.add_from_fund as number,
    managementPaid: row.management_paid as number,
  }))
}

export function updateCustody(
  db: Database.Database,
  shiftId: number,
  data: { addFromFund?: number; managementPaid?: number }
): void {
  assertShiftMonthUnlocked(db, shiftId)
  if (data.addFromFund !== undefined)
    db.prepare(`UPDATE shift_custody SET add_from_fund=? WHERE shift_id=?`).run(data.addFromFund, shiftId)
  if (data.managementPaid !== undefined)
    db.prepare(`UPDATE shift_custody SET management_paid=? WHERE shift_id=?`).run(data.managementPaid, shiftId)
}

// ===== تعديل وحذف الشيفت =====
export function updateShiftNote(
  db: Database.Database,
  shiftId: number,
  note: string
): void {
  assertShiftMonthUnlocked(db, shiftId)
  db.prepare(`UPDATE shifts SET note=? WHERE id=?`).run(note, shiftId)
}

export function deleteShift(
  db: Database.Database,
  shiftId: number
): { ok: boolean; reason?: string } {
  const shift = db.prepare(`SELECT status, date FROM shifts WHERE id=?`).get(shiftId) as { status: string; date: string } | undefined
  if (!shift) return { ok: false, reason: 'الشيفت غير موجود' }
  assertMonthUnlocked(db, shift.date)

  // حذف البيانات المرتبطة أولاً — داخل معاملة واحدة حتى لا يترك أي فشل جزئي شيفتاً نصف محذوف
  db.transaction(() => {
    // قيود كشف حساب العملاء المولَّدة من بنود هذا الشيفت — قبل حذف البنود نفسها،
    // وإلا بقيت ديوناً وهمية دائمة على العملاء بلا أي وسيلة لإزالتها
    deleteLedgerEntriesByShift(db, shiftId)
    db.prepare(`DELETE FROM transactions    WHERE shift_id=?`).run(shiftId)
    db.prepare(`DELETE FROM shift_fawry     WHERE shift_id=?`).run(shiftId)
    db.prepare(`DELETE FROM shift_custody   WHERE shift_id=?`).run(shiftId)
    db.prepare(`DELETE FROM employee_attendance WHERE shift_id=?`).run(shiftId)
    db.prepare(`DELETE FROM journals        WHERE shift_id=?`).run(shiftId)
    db.prepare(`DELETE FROM notifications   WHERE shift_id=?`).run(shiftId)
    db.prepare(`DELETE FROM shifts          WHERE id=?`).run(shiftId)
  })()
  return { ok: true }
}

// ===== اليومية =====
export function getJournalByShift(db: Database.Database, shiftId: number): Journal | null {
  const row = db.prepare(`SELECT * FROM journals WHERE shift_id=?`).get(shiftId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id:             row.id as number,
    shiftId:        row.shift_id as number,
    journalNum:     row.journal_num as string,
    status:         row.status as Journal['status'],
    approvedBy:     row.approved_by as number | null,
    approvedAt:     row.approved_at as string | null,
    attachmentPath: row.attachment_path as string | null,
  }
}
