import type Database from 'better-sqlite3'
import type { Shift, ShiftFawry, ShiftCustody, Journal, Transaction } from '../../../core/types'
import { detectShiftType, calcMonthlyShiftNum } from '../../../core/engine'

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
    cashoutAdd:      (r.cashout_add as number) ?? 0,
    cashoutDiscount: (r.cashout_discount as number) ?? 0,
    commissionPct:   (r.commission_pct as number) ?? 0,
    fawryToBasic:    r.fawry_to_basic as number,
    fawryToAir:      r.fawry_to_air as number,
    cashoutToBasic:  r.cashout_to_basic as number,
    cashoutToAir:    r.cashout_to_air as number,
    programSales:    r.program_sales as number,
    firstVoucher:    r.first_voucher as number,
    lastVoucher:     r.last_voucher as number,
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

  // رقم الشيفت الشهري
  const month = data.date.substring(0, 7)
  const existing = db
    .prepare(`SELECT id FROM shifts WHERE date LIKE ?`)
    .all(`${month}%`) as { id: number }[]
  const monthlyNum = calcMonthlyShiftNum(existing)

  const res = db.prepare(`
    INSERT INTO shifts
      (branch_id, monthly_shift_num, date, type, cashier_user_id, cashier_name,
       start_time, opening_balance, created_by, note)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(monthlyNum, data.date, shiftType, data.cashierUserId, data.cashierName,
         data.startTime, data.openingBalance, data.createdBy, data.note ?? '')

  const shiftId = res.lastInsertRowid as number

  // إنشاء يومية تلقائية
  const journalNum = `J-${data.date.replace(/-/g, '')}-${String(monthlyNum).padStart(2, '0')}`
  db.prepare(`INSERT INTO journals (shift_id, journal_num) VALUES (?, ?)`).run(shiftId, journalNum)

  // إنشاء سجل فوري وعهدة فارغ
  db.prepare(`INSERT INTO shift_fawry (shift_id) VALUES (?)`).run(shiftId)
  db.prepare(`INSERT INTO shift_custody (shift_id) VALUES (?)`).run(shiftId)

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
  if (status === 'approved') {
    db.prepare(`UPDATE shifts SET status=?, approved_by=?, approved_at=datetime('now') WHERE id=?`)
      .run(status, userId, shiftId)
    db.prepare(`UPDATE journals SET status='approved', approved_by=?, approved_at=datetime('now') WHERE shift_id=?`)
      .run(userId, shiftId)
  } else {
    db.prepare(`UPDATE shifts SET status=? WHERE id=?`).run(status, shiftId)
    db.prepare(`UPDATE journals SET status=? WHERE shift_id=?`).run(status, shiftId)
  }
}

export function closeShift(
  db: Database.Database,
  shiftId: number,
  cashierRemaining: number, // v2.31.3 إصلاح: تم تغيير الاسم ليعكس المعنى الصحيح
  posSales: number,
  _cashierRemaining_ignored: number // هذا المعامل لم يعد مستخدماً
): void {
  // حساب التلقائيات من قاعدة البيانات مباشرة
  const collectionsRow = db.prepare(`
    SELECT COALESCE(SUM(amount_in), 0) AS total FROM transactions t JOIN main_categories mc ON t.main_category_id=mc.id WHERE t.shift_id = ? AND mc.name = 'تحصيل'
  `).get(shiftId) as { total: number }

  // مصروفات الشيفت = إجمالي المنصرف − مدفوعات الإدارة (الإدارة تذهب للعهدة)
  const expensesRow = db.prepare(`
    SELECT COALESCE(SUM(amount_out), 0) AS total
    FROM transactions WHERE shift_id = ? AND pay_method != 'management'
  `).get(shiftId) as { total: number }

  const cashierCollections = collectionsRow.total
  const shiftExpenses      = expensesRow.total

  db.prepare(`
    UPDATE shifts SET
      end_time           = time('now'),
      closing_balance    = ?, -- الرصيد الختامي هو النقدية المتبقية
      status             = 'review',
      pos_sales          = ?,
      cashier_remaining  = ?,
      cashier_collections = ?,
      shift_expenses     = ?
    WHERE id = ?
  `).run(cashierRemaining, posSales, cashierRemaining, cashierCollections, shiftExpenses, shiftId)
}

// ADR-012 v2 — تحرير بيانات الشيفت (التاريخ/النوع/اسم الكاشير) يدوياً
export function updateShiftMeta(
  db: Database.Database,
  shiftId: number,
  data: { date?: string; type?: 'morning' | 'evening' | 'between'; cashierName?: string }
): void {
  const sets: string[] = []; const vals: (string | number)[] = []
  if (data.date !== undefined) { sets.push('date = ?'); vals.push(data.date) }
  if (data.type !== undefined) { sets.push('type = ?'); vals.push(data.type) }
  if (data.cashierName !== undefined) { sets.push('cashier_name = ?'); vals.push(data.cashierName) }
  if (!sets.length) return
  db.prepare(`UPDATE shifts SET ${sets.join(', ')} WHERE id = ?`).run(...vals, shiftId)
}

// ADR-012 — تحديث مدخلات إغلاق الكاشير (POS + نقدية متبقية) وإعادة حساب المشتقّات
// بنفس معادلة closeShift تماماً، لكن بلا تغيير الحالة (تحرير مباشر داخل الورقة الموحّدة).
export function updateShiftCloseInputs(
  db: Database.Database,
  shiftId: number,
  data: { posSales: number; cashierRemaining: number }
): void {
  const collectionsRow = db.prepare(`
    SELECT COALESCE(SUM(amount_in), 0) AS total
    FROM transactions t JOIN main_categories mc ON t.main_category_id=mc.id WHERE t.shift_id = ? AND mc.name = 'تحصيل'
  `).get(shiftId) as { total: number }
  const expensesRow = db.prepare(`
    SELECT COALESCE(SUM(amount_out), 0) AS total
    FROM transactions WHERE shift_id = ? AND pay_method != 'management'
  `).get(shiftId) as { total: number }
  db.prepare(`
    UPDATE shifts SET pos_sales=?, cashier_remaining=?, cashier_collections=?, shift_expenses=? WHERE id=?
  `).run(data.posSales, data.cashierRemaining, collectionsRow.total, expensesRow.total, shiftId)
}

// استيراد Excel — يثق برقم «مصروفات الكاشير» المُصالَح فعلياً في الشيت المرجعي (قروش)
// بدل الاشتقاق من (pay_method != 'management') على البنود المستوردة، والذي قد ينتفخ إذا كان
// عمود «الدفع» فارغاً لبنود مشتريات/مصروفات/أجور جُمعية لا تمثّل صرفاً فعلياً من درج الكاشير.
export function overrideShiftExpenses(db: Database.Database, shiftId: number, shiftExpensesPias: number): void {
  db.prepare(`UPDATE shifts SET shift_expenses=? WHERE id=?`).run(shiftExpensesPias, shiftId)
}

// ===== بيانات فوري =====
export function getFawry(db: Database.Database, shiftId: number): ShiftFawry | null {
  const row = db.prepare(`SELECT * FROM shift_fawry WHERE shift_id=?`).get(shiftId) as Record<string, unknown> | undefined
  return row ? row2fawry(row) : null
}

// ADR-012 v2 — قيم فوري اللازمة لمعادلة الإغلاق لكل شيفتات شهر (لسجل اليوميات)
export function getFawryClosingMonth(db: Database.Database, month: string): { shiftId: number; programSales: number; commissionPct: number }[] {
  return (db.prepare(`
    SELECT f.shift_id AS shiftId, f.program_sales AS programSales, f.commission_pct AS commissionPct
    FROM shift_fawry f JOIN shifts s ON s.id = f.shift_id
    WHERE s.date LIKE ?
  `).all(`${month}%`) as { shiftId: number; programSales: number; commissionPct: number }[])
}

// ADR-012 v2 — قيم فوري لكل الشيفتات (للوحة المعلومات التراكمية)
export function getAllFawryClosing(db: Database.Database): { shiftId: number; programSales: number; commissionPct: number }[] {
  return (db.prepare(`
    SELECT shift_id AS shiftId, program_sales AS programSales, commission_pct AS commissionPct FROM shift_fawry
  `).all() as { shiftId: number; programSales: number; commissionPct: number }[])
}

export function updateFawry(
  db: Database.Database,
  shiftId: number,
  data: Partial<Omit<ShiftFawry, 'id' | 'shiftId'>>
): void {
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
  db.prepare(`UPDATE shifts SET note=? WHERE id=?`).run(note, shiftId)
}

export function updateShiftOpeningBalance(
  db: Database.Database,
  shiftId: number,
  openingBalance: number
): void {
  db.prepare(`UPDATE shifts SET opening_balance=? WHERE id=?`).run(openingBalance, shiftId)
}

export function deleteShift(
  db: Database.Database,
  shiftId: number
): { ok: boolean; reason?: string } {
  const shift = db.prepare(`SELECT status FROM shifts WHERE id=?`).get(shiftId) as { status: string } | undefined
  if (!shift) return { ok: false, reason: 'الشيفت غير موجود' }

  // حذف البيانات المرتبطة أولاً
  db.prepare(`DELETE FROM transactions    WHERE shift_id=?`).run(shiftId)
  db.prepare(`DELETE FROM shift_fawry     WHERE shift_id=?`).run(shiftId)
  db.prepare(`DELETE FROM shift_custody   WHERE shift_id=?`).run(shiftId)
  db.prepare(`DELETE FROM employee_attendance WHERE shift_id=?`).run(shiftId)
  db.prepare(`DELETE FROM journals        WHERE shift_id=?`).run(shiftId)
  db.prepare(`DELETE FROM notifications   WHERE shift_id=?`).run(shiftId)
  db.prepare(`DELETE FROM shifts          WHERE id=?`).run(shiftId)
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
