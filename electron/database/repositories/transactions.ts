import type Database from 'better-sqlite3'
import type { Transaction, SmartLabel, MainCategory, SubCategory } from '../../../core/types'
import { addLedgerEntry } from './parties'

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
  updateSmartLabel(db, data.description, data.mainCategoryId, data.subCategoryId)

  // ═══ v2.27.0 — تسجيل في كشف حساب العميل تلقائياً ═══
  if (data.customerId) {
    try {
      // جلب اسم التصنيف الرئيسي لتحديد نوع الحركة
      const mainName = data.mainCategoryId ? (db.prepare(
        `SELECT name FROM main_categories WHERE id = ?`
      ).get(data.mainCategoryId) as { name: string } | undefined)?.name : null
      const today = new Date().toISOString().slice(0, 10)

      // التحقق من أن العميل موجود
      const customerExists = db.prepare(`SELECT id FROM customers WHERE id = ?`).get(data.customerId)
      if (!customerExists) {
        console.warn(`[ledger] customer ${data.customerId} not found, skipping ledger entry`)
      } else if (data.payMethod === 'credit') {
        // دفع آجل → دين على العميل (مدين)
        const amount = data.amountOut > 0 ? data.amountOut : data.amountIn
        addLedgerEntry(db, {
          partyType: 'customer', partyId: data.customerId,
          date: today,
          description: `[شيفت #${data.shiftId}] ${data.description}`,
          debit:  amount,
          credit: 0,
        })
        console.log(`[ledger] credit debit added: customer ${data.customerId}, amount ${amount}`)
      } else if (mainName === 'تحصيل') {
        // تحصيل → سداد العميل (دائن)
        const amount = data.amountIn > 0 ? data.amountIn : data.amountOut
        addLedgerEntry(db, {
          partyType: 'customer', partyId: data.customerId,
          date: today,
          description: `[شيفت #${data.shiftId}] تحصيل: ${data.description}`,
          debit:  0,
          credit: amount,
        })
        console.log(`[ledger] collection credit added: customer ${data.customerId}, amount ${amount}`)
      } else {
        console.warn(`[ledger] customer ${data.customerId} set but no matching condition (payMethod=${data.payMethod}, mainName=${mainName})`)
      }
    } catch (e) {
      console.error('[ledger] Error adding ledger entry:', e)
    }
  }

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
  db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
}

export function deleteTransaction(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM transactions WHERE id = ?`).run(id)
}

// ===== التصنيفات =====
// تحويل صفوف قاعدة البيانات (snake_case) إلى camelCase
function row2main(r: Record<string, unknown>): MainCategory {
  return {
    id:        r.id as number,
    name:      r.name as string,
    color:     r.color as string,
    sortOrder: (r.sort_order as number) ?? 0,
  }
}
function row2sub(r: Record<string, unknown>): SubCategory {
  return {
    id:             r.id as number,
    mainCategoryId: r.main_category_id as number,
    name:           r.name as string,
    sortOrder:      (r.sort_order as number) ?? 0,
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
export function createSubCategory(
  db: Database.Database,
  data: { mainCategoryId: number; name: string }
): number {
  const maxOrder = (db.prepare(
    `SELECT COALESCE(MAX(sort_order),0) AS m FROM sub_categories WHERE main_category_id=?`
  ).get(data.mainCategoryId) as { m: number }).m
  const res = db.prepare(
    `INSERT INTO sub_categories (main_category_id, name, sort_order) VALUES (?, ?, ?)`
  ).run(data.mainCategoryId, data.name.trim(), maxOrder + 1)
  return res.lastInsertRowid as number
}

export function updateSubCategory(
  db: Database.Database,
  id: number,
  name: string
): void {
  db.prepare(`UPDATE sub_categories SET name=? WHERE id=?`).run(name.trim(), id)
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
function updateSmartLabel(
  db: Database.Database,
  description: string,
  mainCatId: number | null,
  subCatId: number | null
): void {
  if (!description.trim() || mainCatId === null) return
  const pattern = description.trim().toLowerCase()
  const existing = db.prepare(`SELECT id FROM smart_labels WHERE pattern = ?`).get(pattern) as { id: number } | undefined
  if (existing) {
    db.prepare(`UPDATE smart_labels SET usage_count = usage_count + 1, last_used = datetime('now'), main_category_id=?, sub_category_id=? WHERE pattern=?`)
      .run(mainCatId, subCatId, pattern)
  } else {
    db.prepare(`INSERT INTO smart_labels (pattern, main_category_id, sub_category_id) VALUES (?, ?, ?)`)
      .run(pattern, mainCatId, subCatId)
  }
}

export function suggestCategory(
  db: Database.Database,
  description: string
): { mainCategoryId: number; subCategoryId: number | null } | null {
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
  return {
    mainCategoryId: row.main_category_id as number,
    subCategoryId:  row.sub_category_id as number | null,
  }
}

export function getSmartLabels(db: Database.Database): SmartLabel[] {
  return db.prepare(`SELECT * FROM smart_labels ORDER BY usage_count DESC`).all() as SmartLabel[]
}
