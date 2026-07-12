/**
 * كشف التكرار + حارس إعادة الاستيراد.
 * مفتاح التكرار (حسب المواصفات): التاريخ + القيمة + الفئة + البيان.
 * يُفحص فقط مقابل السجلات الموجودة في القاعدة (لا يمنع تكرار سطور حقيقية داخل نفس الشيفت).
 */
import type { Database } from 'better-sqlite3'

export interface DuplicateIndex { keys: Set<string> }

function dupKey(dateISO: string, description: string, amountPiastres: number, mainCategoryId: number | null): string {
  return `${dateISO}|${description}|${amountPiastres}|${mainCategoryId ?? 0}`
}

/**
 * يبني فهرس التكرار مرة واحدة لكل تواريخ الاستيراد (استعلام واحد بدل استعلام لكل صف)،
 * لتفادي مئات/آلاف الاستعلامات المتزامنة داخل معاملة استيراد واحدة تُجمّد واجهة التطبيق.
 */
export function buildDuplicateIndex(db: Database, dates: string[]): DuplicateIndex {
  const keys = new Set<string>()
  const uniqueDates = Array.from(new Set(dates))
  if (!uniqueDates.length) return { keys }
  const placeholders = uniqueDates.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT s.date AS date, t.description AS description,
           (t.amount_in + t.amount_out) AS amount, t.main_category_id AS mainCategoryId
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    WHERE s.date IN (${placeholders})
  `).all(...uniqueDates) as { date: string; description: string; amount: number; mainCategoryId: number | null }[]
  for (const r of rows) keys.add(dupKey(r.date, r.description, r.amount, r.mainCategoryId))
  return { keys }
}

/** هل توجد معاملة مطابقة مسبقاً في القاعدة؟ (بحث في الفهرس المبني مسبقاً — بلا استعلام) */
export function isDuplicate(
  idx: DuplicateIndex,
  dateISO: string,
  amountPiastres: number,
  mainCategoryId: number | null,
  description: string
): boolean {
  return idx.keys.has(dupKey(dateISO, description, amountPiastres, mainCategoryId))
}

export interface PriorImport {
  id: number
  fileName: string
  imported: number
  createdAt: string
}

/** حارس إعادة الاستيراد: آخر استيراد لنفس اسم الملف (إن وُجد). */
export function findPriorImport(db: Database, fileName: string): PriorImport | null {
  const row = db.prepare(`
    SELECT id, file_name AS fileName, imported, created_at AS createdAt
    FROM import_history WHERE file_name = ? ORDER BY id DESC LIMIT 1
  `).get(fileName) as PriorImport | undefined
  return row ?? null
}
