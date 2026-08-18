import type Database from 'better-sqlite3'
import type { Transaction, SmartLabel, MainCategory, SubCategory } from '../../../core/types'
import { addLedgerEntry, deleteLedgerEntriesByTransaction } from './parties'
import { assertMonthUnlocked } from './treasury'
import { normalizeArabic } from '../../../core/normalize'
import { CANONICAL_CATEGORIES } from '../canonicalCategories'

// v2.34.26 — حارس التصنيفات: اعتماد التصنيفات الحالية (canonicalCategories.ts) كمرجع صحيح —
// خريطة "اسم التصنيف الفرعي (مُطبَّع)" ← "اسم التصنيف الرئيسي الصحيح المعتمد"
const CANONICAL_SUB_TO_MAIN = new Map<string, string>()
for (const g of CANONICAL_CATEGORIES) for (const s of g.subs) CANONICAL_SUB_TO_MAIN.set(normalizeArabic(s), g.main)

// يحسم تاريخ الشيفت لقيد ما (عبر shift_id) لأغراض حارس القفل الشهري
function shiftDateOfTx(db: Database.Database, txId: number): string | undefined {
  return (db.prepare(`SELECT s.date FROM transactions t JOIN shifts s ON s.id = t.shift_id WHERE t.id = ?`)
    .get(txId) as { date: string } | undefined)?.date
}

function row2tx(r: Record<string, unknown>): Transaction {
  return {
    id:               r.id as number,
    shiftId:          r.shift_id as number,
    journalId:        r.journal_id as number,
    time:             r.time as string,
    description:      r.description as string,
    mainCategoryId:   r.main_category_id as number | null,
    subCategoryId:    r.sub_category_id as number | null,
    mainCategoryName: (r.main_category_name as string) ?? '',
    subCategoryName:  (r.sub_category_name as string) ?? '',
    amountIn:         r.amount_in as number,
    amountOut:        r.amount_out as number,
    payMethod:        r.pay_method as Transaction['payMethod'],
    employeeId:       r.employee_id as number | null,
    customerId:       r.customer_id as number | null,
    note:             r.note as string,
    createdBy:        r.created_by as number,
    createdAt:        r.created_at as string,
  }
}

const TX_SELECT = `
  SELECT t.*,
    mc.name AS main_category_name,
    sc.name AS sub_category_name
  FROM transactions t
  LEFT JOIN main_categories mc ON t.main_category_id = mc.id
  LEFT JOIN sub_categories  sc ON t.sub_category_id  = sc.id
`

export function getTransactionsByShift(db: Database.Database, shiftId: number): Transaction[] {
  return (db.prepare(`${TX_SELECT} WHERE t.shift_id = ? ORDER BY t.time ASC, t.id ASC`)
    .all(shiftId) as Record<string, unknown>[]).map(row2tx)
}

/**
 * جلب كل المعاملات لمجموعة من الشيفتات في استعلام واحد.
 * @param db - كائن قاعدة البيانات.
 * @param shiftIds - مصفوفة من أرقام الشيفتات.
 * @returns مصفوفة من المعاملات.
 */
export function getTransactionsByShiftIds(db: Database.Database, shiftIds: number[]): Transaction[] {
  if (shiftIds.length === 0) return []
  const placeholders = shiftIds.map(() => '?').join(',')
  const sql = `
    ${TX_SELECT}
    WHERE t.shift_id IN (${placeholders})
    ORDER BY t.created_at ASC
  `
  return (db.prepare(sql).all(...shiftIds) as Record<string, unknown>[]).map(row2tx)
}




/**
 * يُعيد توليد قيود كشف حساب العميل الخاصة ببند يومية واحد (حذف ثم إنشاء).
 *
 * كانت هذه المنطقة مكتوبة داخل `addTransaction` فقط، فينتج عنها خطآن:
 *  1) القيد يُنشأ بتاريخ **اليوم** لا بتاريخ الشيفت — فبند آجل لشيفت قديم (أو مستورد من إكسل)
 *     يظهر في كشف الحساب بتاريخ الاستيراد لا بتاريخ البيع الحقيقي.
 *  2) لا يوجد أي ربط بين القيد والبند، فالحذف/التعديل كانا يتركان قيداً يتيماً (دين وهمي دائم).
 * الآن القيد مرتبط بـ`transaction_id` ويُعاد توليده كلياً عند أي تعديل.
 */
export function syncCustomerLedger(db: Database.Database, txId: number): void {
  try {
    deleteLedgerEntriesByTransaction(db, txId)

    const tx = db.prepare(`
      SELECT t.shift_id AS shiftId, t.customer_id AS customerId, t.description AS description,
             t.amount_in AS amountIn, t.amount_out AS amountOut,
             s.date AS shiftDate, mc.name AS mainName, sc.name AS subName
      FROM transactions t
      JOIN shifts s ON s.id = t.shift_id
      LEFT JOIN main_categories mc ON mc.id = t.main_category_id
      LEFT JOIN sub_categories  sc ON sc.id = t.sub_category_id
      WHERE t.id = ?
    `).get(txId) as {
      shiftId: number; customerId: number | null; description: string
      amountIn: number; amountOut: number; shiftDate: string
      mainName: string | null; subName: string | null
    } | undefined

    if (!tx || !tx.customerId) return

    const customerExists = db.prepare(`SELECT id FROM customers WHERE id = ?`).get(tx.customerId)
    if (!customerExists) {
      console.warn(`[ledger] customer ${tx.customerId} not found, skipping ledger entry`)
      return
    }

    // تاريخ القيد = تاريخ الشيفت (لا تاريخ اليوم) حتى يستقرّ كشف الحساب زمنياً مهما تأخّر الإدخال
    const date = tx.shiftDate
    // الآجل يُحدَّد بالتصنيف الفرعي «مبيعات آجل» لا بطريقة الدفع (ADR-012 v2)
    if (tx.subName === 'مبيعات آجل') {
      // بيع آجل → دين على العميل (مدين)
      addLedgerEntry(db, {
        partyType: 'customer', partyId: tx.customerId, date,
        description: `[شيفت #${tx.shiftId}] ${tx.description}`,
        debit: tx.amountOut > 0 ? tx.amountOut : tx.amountIn, credit: 0,
        transactionId: txId,
      })
    } else if (tx.mainName === 'تحصيل') {
      // تحصيل → سداد العميل (دائن)
      addLedgerEntry(db, {
        partyType: 'customer', partyId: tx.customerId, date,
        description: `[شيفت #${tx.shiftId}] تحصيل: ${tx.description}`,
        debit: 0, credit: tx.amountIn > 0 ? tx.amountIn : tx.amountOut,
        transactionId: txId,
      })
    }
  } catch (e) {
    console.error('[ledger] Error syncing ledger entry:', e)
  }
}

export function addTransaction(
  db: Database.Database,
  data: {
    shiftId: number
    journalId: number
    description: string
    mainCategoryId: number | null
    subCategoryId: number | null
    amountIn: number
    amountOut: number
    payMethod: Transaction['payMethod']
    employeeId: number | null
    customerId: number | null
    note: string
    createdBy: number
  }
): Transaction {
  const shiftRow = db.prepare(`SELECT date FROM shifts WHERE id = ?`).get(data.shiftId) as { date: string } | undefined
  if (shiftRow) assertMonthUnlocked(db, shiftRow.date)

  const res = db.prepare(`
    INSERT INTO transactions
      (shift_id, journal_id, description, main_category_id, sub_category_id,
       amount_in, amount_out, pay_method, employee_id, customer_id, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.shiftId, data.journalId, data.description,
    data.mainCategoryId, data.subCategoryId,
    data.amountIn, data.amountOut, data.payMethod,
    data.employeeId, data.customerId, data.note, data.createdBy
  )
  const id = res.lastInsertRowid as number

  // تحديث التسمية الذكية
  updateSmartLabel(db, data.description, data.mainCategoryId, data.subCategoryId, data.payMethod)

  // ═══ v2.27.0 — تسجيل في كشف حساب العميل تلقائياً ═══
  syncCustomerLedger(db, id)

  return row2tx(
    db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id) as Record<string, unknown>
  )
}

// ═══ حفظ دفعة واحدة (transaction واحدة) — أسرع بكثير من الحفظ بنداً بنداً ═══
export function addTransactionsBatch(
  db: Database.Database,
  items: Parameters<typeof addTransaction>[1][]
): Transaction[] {
  const run = db.transaction((rows: Parameters<typeof addTransaction>[1][]) => {
    return rows.map(r => addTransaction(db, r))
  })
  return run(items)
}

export function updateTransaction(
  db: Database.Database,
  id: number,
  data: Partial<Pick<Transaction, 'description' | 'mainCategoryId' | 'subCategoryId' | 'amountIn' | 'amountOut' | 'payMethod' | 'employeeId' | 'customerId' | 'note'>>
): void {
  const sets: string[] = []
  const vals: unknown[] = []
  if (data.description    !== undefined) { sets.push('description = ?');     vals.push(data.description) }
  if (data.mainCategoryId !== undefined) { sets.push('main_category_id = ?'); vals.push(data.mainCategoryId) }
  if (data.subCategoryId  !== undefined) { sets.push('sub_category_id = ?');  vals.push(data.subCategoryId) }
  if (data.amountIn       !== undefined) { sets.push('amount_in = ?');        vals.push(data.amountIn) }
  if (data.amountOut      !== undefined) { sets.push('amount_out = ?');       vals.push(data.amountOut) }
  if (data.payMethod      !== undefined) { sets.push('pay_method = ?');       vals.push(data.payMethod) }
  if (data.employeeId     !== undefined) { sets.push('employee_id = ?');      vals.push(data.employeeId) }
  if (data.customerId     !== undefined) { sets.push('customer_id = ?');      vals.push(data.customerId) }
  if (data.note           !== undefined) { sets.push('note = ?');             vals.push(data.note) }
  if (sets.length === 0) return
  const shiftDate = shiftDateOfTx(db, id)
  if (shiftDate) assertMonthUnlocked(db, shiftDate)
  db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  // إعادة مزامنة كشف حساب العميل: تغيير المبلغ/العميل/التصنيف كان يترك القيد القديم بقيمته
  // القديمة (أو على العميل القديم) بلا أي تحديث
  syncCustomerLedger(db, id)
}

export function deleteTransaction(db: Database.Database, id: number): void {
  const shiftDate = shiftDateOfTx(db, id)
  if (shiftDate) assertMonthUnlocked(db, shiftDate)
  // قيود كشف الحساب أولاً (قبل اختفاء البند) وإلا بقيت يتيمة كديون وهمية على العميل
  deleteLedgerEntriesByTransaction(db, id)
  db.prepare(`DELETE FROM transactions WHERE id = ?`).run(id)
}

// ===== التصنيفات =====
// تحويل صفوف قاعدة البيانات (snake_case) إلى camelCase
function row2main(r: Record<string, unknown>): MainCategory {
  return {
    id:             r.id as number,
    name:           r.name as string,
    color:          r.color as string,
    sortOrder:      (r.sort_order as number) ?? 0,
    accountingType: (r.accounting_type as string | null) ?? null,
  }
}
function row2sub(r: Record<string, unknown>): SubCategory {
  return {
    id:             r.id as number,
    mainCategoryId: r.main_category_id as number,
    name:           r.name as string,
    sortOrder:      (r.sort_order as number) ?? 0,
    accountingType: (r.accounting_type as string | null) ?? null,
  }
}

export function getMainCategories(db: Database.Database): MainCategory[] {
  return (db.prepare(`SELECT * FROM main_categories ORDER BY sort_order`).all() as Record<string, unknown>[])
    .map(row2main)
}

export function getSubCategories(db: Database.Database, mainId?: number): SubCategory[] {
  const rows = (mainId !== undefined
    ? db.prepare(`SELECT * FROM sub_categories WHERE main_category_id=? ORDER BY sort_order`).all(mainId)
    : db.prepare(`SELECT * FROM sub_categories ORDER BY main_category_id, sort_order`).all()
  ) as Record<string, unknown>[]
  return rows.map(row2sub)
}

// ===== CRUD التصنيفات الرئيسية =====
export function createMainCategory(
  db: Database.Database,
  data: { name: string; color: string }
): number {
  const maxOrder = (db.prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM main_categories`).get() as { m: number }).m
  const res = db.prepare(
    `INSERT INTO main_categories (name, color, sort_order) VALUES (?, ?, ?)`
  ).run(data.name.trim(), data.color, maxOrder + 1)
  return res.lastInsertRowid as number
}

export function updateMainCategory(
  db: Database.Database,
  id: number,
  data: { name?: string; color?: string }
): void {
  const sets: string[] = []; const params: unknown[] = []
  if (data.name)  { sets.push('name=?');  params.push(data.name.trim()) }
  if (data.color) { sets.push('color=?'); params.push(data.color) }
  if (!sets.length) return
  params.push(id)
  db.prepare(`UPDATE main_categories SET ${sets.join(',')} WHERE id=?`).run(...params)
}

export function deleteMainCategory(
  db: Database.Database,
  id: number
): { ok: boolean; reason?: string } {
  const usedInTx = (db.prepare(
    `SELECT COUNT(*) AS c FROM transactions WHERE main_category_id=?`
  ).get(id) as { c: number }).c
  if (usedInTx > 0)
    return { ok: false, reason: `هذا التصنيف مستخدم في ${usedInTx} بند — لا يمكن حذفه` }
  // حذف التصنيفات الفرعية أولاً ثم الرئيسي
  db.prepare(`DELETE FROM sub_categories   WHERE main_category_id=?`).run(id)
  db.prepare(`DELETE FROM smart_labels     WHERE main_category_id=?`).run(id)
  db.prepare(`DELETE FROM main_categories  WHERE id=?`).run(id)
  return { ok: true }
}

// ===== CRUD التصنيفات الفرعية =====
// v2.34.26 — يبحث هل الاسم (بعد التطبيع) يخصّ تصنيفًا فرعيًا آخر موجودًا فعليًا (أي رئيسي)، لمنع تكرار
function findDuplicateSubByName(db: Database.Database, name: string, excludeId?: number): { id: number; name: string; mainName: string } | undefined {
  const key = normalizeArabic(name)
  const rows = db.prepare(
    `SELECT sc.id, sc.name, mc.name AS main_name FROM sub_categories sc
     JOIN main_categories mc ON mc.id = sc.main_category_id
     WHERE sc.id != COALESCE(?, -1)`
  ).all(excludeId ?? null) as { id: number; name: string; main_name: string }[]
  const hit = rows.find(r => normalizeArabic(r.name) === key)
  return hit ? { id: hit.id, name: hit.name, mainName: hit.main_name } : undefined
}

export function createSubCategory(
  db: Database.Database,
  data: { mainCategoryId: number; name: string }
): { ok: boolean; id?: number; reason?: string } {
  const key = normalizeArabic(data.name)
  const correctMain = CANONICAL_SUB_TO_MAIN.get(key)
  if (correctMain) {
    const correctMainRow = db.prepare(`SELECT id FROM main_categories WHERE name=?`).get(correctMain) as { id: number } | undefined
    if (correctMainRow && correctMainRow.id !== data.mainCategoryId)
      return { ok: false, reason: `هذا التصنيف الفرعي "${data.name.trim()}" يجب أن يكون تحت التصنيف الرئيسي "${correctMain}"` }
  }
  const dup = findDuplicateSubByName(db, data.name)
  if (dup) return { ok: false, reason: `هذا التصنيف الفرعي موجود بالفعل باسم "${dup.name}" تحت "${dup.mainName}"` }

  const maxOrder = (db.prepare(
    `SELECT COALESCE(MAX(sort_order),0) AS m FROM sub_categories WHERE main_category_id=?`
  ).get(data.mainCategoryId) as { m: number }).m
  const res = db.prepare(
    `INSERT INTO sub_categories (main_category_id, name, sort_order) VALUES (?, ?, ?)`
  ).run(data.mainCategoryId, data.name.trim(), maxOrder + 1)
  return { ok: true, id: res.lastInsertRowid as number }
}

export function updateSubCategory(
  db: Database.Database,
  id: number,
  name: string
): { ok: boolean; reason?: string } {
  const current = db.prepare(`SELECT main_category_id FROM sub_categories WHERE id=?`).get(id) as { main_category_id: number } | undefined
  if (!current) return { ok: false, reason: 'التصنيف الفرعي غير موجود' }

  const key = normalizeArabic(name)
  const correctMain = CANONICAL_SUB_TO_MAIN.get(key)
  if (correctMain) {
    const correctMainRow = db.prepare(`SELECT id FROM main_categories WHERE name=?`).get(correctMain) as { id: number } | undefined
    if (correctMainRow && correctMainRow.id !== current.main_category_id)
      return { ok: false, reason: `الاسم "${name.trim()}" معروف كتصنيف فرعي تحت "${correctMain}" — لا يمكن استخدامه هنا` }
  }
  const dup = findDuplicateSubByName(db, name, id)
  if (dup) return { ok: false, reason: `هذا التصنيف الفرعي موجود بالفعل باسم "${dup.name}" تحت "${dup.mainName}"` }

  db.prepare(`UPDATE sub_categories SET name=? WHERE id=?`).run(name.trim(), id)
  return { ok: true }
}

export function deleteSubCategory(
  db: Database.Database,
  id: number
): { ok: boolean; reason?: string } {
  const used = (db.prepare(
    `SELECT COUNT(*) AS c FROM transactions WHERE sub_category_id=?`
  ).get(id) as { c: number }).c
  if (used > 0)
    return { ok: false, reason: `هذا التصنيف الفرعي مستخدم في ${used} بند — لا يمكن حذفه` }
  db.prepare(`UPDATE smart_labels SET sub_category_id=NULL WHERE sub_category_id=?`).run(id)
  db.prepare(`DELETE FROM sub_categories WHERE id=?`).run(id)
  return { ok: true }
}

// ===== التسميات الذكية =====
// v2.38.5 — بطلب العميل: توسيع الاقتراح ليشمل "طريقة الدفع" أيضاً — نتتبّع توزيعها الفعلي لكل نمط
// بيان (كاشير/إدارة)، ونقترحها في suggestForDescription فقط لو نسبة الاتفاق التاريخي عالية.
function updateSmartLabel(
  db: Database.Database,
  description: string,
  mainCatId: number | null,
  subCatId: number | null,
  payMethod?: Transaction['payMethod']
): void {
  if (!description.trim() || mainCatId === null) return
  const pattern = description.trim().toLowerCase()
  const cashierInc    = payMethod === 'cashier'    ? 1 : 0
  const managementInc = payMethod === 'management' ? 1 : 0
  const existing = db.prepare(`SELECT id FROM smart_labels WHERE pattern = ?`).get(pattern) as { id: number } | undefined
  if (existing) {
    db.prepare(`
      UPDATE smart_labels SET usage_count = usage_count + 1, last_used = datetime('now'),
        main_category_id=?, sub_category_id=?,
        pay_cashier_count = pay_cashier_count + ?, pay_management_count = pay_management_count + ?
      WHERE pattern=?
    `).run(mainCatId, subCatId, cashierInc, managementInc, pattern)
  } else {
    db.prepare(`
      INSERT INTO smart_labels (pattern, main_category_id, sub_category_id, pay_cashier_count, pay_management_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(pattern, mainCatId, subCatId, cashierInc, managementInc)
  }
}

// نسبة الاتفاق الأدنى (٪) قبل اقتراح طريقة الدفع تلقائياً — "بنسبة كبيرة" بطلب العميل
const PAY_METHOD_SUGGEST_THRESHOLD = 0.8
const PAY_METHOD_SUGGEST_MIN_SAMPLES = 2

export function suggestCategory(
  db: Database.Database,
  description: string
): { mainCategoryId: number; subCategoryId: number | null; payMethod: Transaction['payMethod'] | null } | null {
  if (!description.trim()) return null
  const pattern = description.trim().toLowerCase()

  // مطابقة تامة أولاً
  let row = db.prepare(
    `SELECT * FROM smart_labels WHERE pattern = ? ORDER BY usage_count DESC LIMIT 1`
  ).get(pattern) as Record<string, unknown> | undefined

  // مطابقة جزئية
  if (!row) {
    row = db.prepare(
      `SELECT * FROM smart_labels WHERE pattern LIKE ? ORDER BY usage_count DESC LIMIT 1`
    ).get(`%${pattern}%`) as Record<string, unknown> | undefined
  }

  if (!row) return null

  const cashierCount    = (row.pay_cashier_count as number)    ?? 0
  const managementCount = (row.pay_management_count as number) ?? 0
  const total = cashierCount + managementCount
  let payMethod: Transaction['payMethod'] | null = null
  if (total >= PAY_METHOD_SUGGEST_MIN_SAMPLES) {
    if (cashierCount / total >= PAY_METHOD_SUGGEST_THRESHOLD) payMethod = 'cashier'
    else if (managementCount / total >= PAY_METHOD_SUGGEST_THRESHOLD) payMethod = 'management'
  }

  return {
    mainCategoryId: row.main_category_id as number,
    subCategoryId:  row.sub_category_id as number | null,
    payMethod,
  }
}

export function getSmartLabels(db: Database.Database): SmartLabel[] {
  return db.prepare(`SELECT * FROM smart_labels ORDER BY usage_count DESC`).all() as SmartLabel[]
}
