/**
 * طبقة تعيين القيم (Value Mapping) — مستقلّة تماماً عن تعيين الحقول (decision #4).
 * ─────────────────────────────────────────────────────────────────────────
 * تحوّل «قيمة فئة» مطبَّعة من الإكسل → فئة نظام (رئيسية/فرعية).
 * أولوية التعيين (من مواصفات محرّك التعيين):
 *   1) قاعدة تعيين محفوظة (import_category_map)
 *   2) مطابقة اسم فرعي مطبَّع
 *   3) مطابقة اسم رئيسي مطبَّع
 *   4) → مجهول (تذهب لشاشة المراجعة، ثم تُحفظ قاعدة)
 *
 * الاتجاه (وارد/منصرف) يُشتقّ من «نوع الفئة» (kind) لا من قاعدة التعيين (decision #5).
 */
import type { Database } from 'better-sqlite3'
import type { PayMethod } from '../../../core/types'
import { normalizeValue } from '../../../core/normalize'
import type { CategoryKind, Direction } from './types'

// القاعدة الرسمية (ADR-012 v2): كل البنود منصرف إلا فئة «تحصيل» → وارد.
// حتى بنود «مبيعات» (فيزا/آجل) تُخزَّن منصرفاً — لأنها ليست نقداً في درج الكاشير.
const KIND_DIRECTION: Record<CategoryKind, Direction> = {
  income: 'out',
  collection: 'in',
  expense: 'out',
  purchase: 'out',
  return: 'out',
  misc: 'out',
}

/** اتجاه المعاملة من نوع الفئة. */
export function directionFromKind(kind: string): Direction {
  return KIND_DIRECTION[kind as CategoryKind] ?? 'out'
}

export interface CategoryResolution {
  status: 'mapped' | 'unknown'
  mainCategoryId: number | null
  subCategoryId: number | null
  mainName: string
  subName: string | null
  kind: CategoryKind
  direction: Direction
  source: 'rule' | 'sub-name' | 'main-name' | 'none'
}

interface MainRow { id: number; name: string; kind: string }
interface SubRow { id: number; name: string; main_category_id: number }

/** فهرس فئات النظام (يُبنى مرة لكل عملية استيراد). */
export interface CategoryIndex {
  mainById: Map<number, MainRow>
  mainByNorm: Map<string, MainRow>
  subByNorm: Map<string, SubRow>
}

export function buildCategoryIndex(db: Database): CategoryIndex {
  const mains = db.prepare(`SELECT id, name, kind FROM main_categories`).all() as MainRow[]
  const subs = db.prepare(`SELECT id, name, main_category_id FROM sub_categories`).all() as SubRow[]
  const mainById = new Map<number, MainRow>()
  const mainByNorm = new Map<string, MainRow>()
  const subByNorm = new Map<string, SubRow>()
  for (const m of mains) { mainById.set(m.id, m); mainByNorm.set(normalizeValue(m.name), m) }
  for (const s of subs) subByNorm.set(normalizeValue(s.name), s)
  return { mainById, mainByNorm, subByNorm }
}

function make(main: MainRow, sub: SubRow | null, source: CategoryResolution['source']): CategoryResolution {
  const kind = (main.kind as CategoryKind) ?? 'misc'
  return {
    status: 'mapped',
    mainCategoryId: main.id,
    subCategoryId: sub ? sub.id : null,
    mainName: main.name,
    subName: sub ? sub.name : null,
    kind,
    direction: directionFromKind(kind),
    source,
  }
}

const UNKNOWN: CategoryResolution = {
  status: 'unknown', mainCategoryId: null, subCategoryId: null,
  mainName: '', subName: null, kind: 'misc', direction: 'out', source: 'none',
}

/**
 * حلّ قيمة فئة مطبَّعة → فئة نظام.
 * @param normValue القيمة بعد normalizeValue
 */
export function resolveCategory(db: Database, idx: CategoryIndex, normValue: string): CategoryResolution {
  if (!normValue) return { ...UNKNOWN }

  // 1) قاعدة تعيين محفوظة
  const rule = db.prepare(
    `SELECT main_category_id, sub_category_id FROM import_category_map WHERE excel_value=? AND active=1`
  ).get(normValue) as { main_category_id: number | null; sub_category_id: number | null } | undefined
  if (rule) {
    const sub = rule.sub_category_id ? (Array.from(idx.subByNorm.values()).find(s => s.id === rule.sub_category_id) ?? null) : null
    const mainId = rule.main_category_id ?? (sub ? sub.main_category_id : null)
    const main = mainId != null ? idx.mainById.get(mainId) : undefined
    if (main) return make(main, sub, 'rule')
  }

  // 2) مطابقة اسم فرعي
  const sub = idx.subByNorm.get(normValue)
  if (sub) {
    const main = idx.mainById.get(sub.main_category_id)
    if (main) return make(main, sub, 'sub-name')
  }

  // 3) مطابقة اسم رئيسي
  const main = idx.mainByNorm.get(normValue)
  if (main) return make(main, null, 'main-name')

  // 4) مجهول
  return { ...UNKNOWN }
}

/**
 * طريقة الدفع النهائية — نوعان فقط. عمود «الدفع» هو المصدر:
 * «إدارة» → management، وكل ما عداه (كاشير/تحصيل/فارغ/مجهول) → cashier.
 * الآجل/الفيزا لم تعودا طرق دفع؛ تُتتبَّعان بالتصنيف الفرعي.
 */
export function resolvePayment(normPay: string): PayMethod {
  if (normPay === normalizeValue('ادارة')) return 'management'   // يشمل «إدارة» بعد التطبيع
  return 'cashier'
}

/** تعيين اسم كاشير مطبَّع → معرّف مستخدم (من قاعدة التعيين المحفوظة). */
export function resolveCashier(db: Database, normName: string): number | null {
  if (!normName) return null
  const row = db.prepare(`SELECT user_id FROM import_cashier_map WHERE excel_name=?`).get(normName) as { user_id: number } | undefined
  return row ? row.user_id : null
}

/** تعيين اسم موظف مطبَّع (من بند "سلفة موظف") → معرّف موظف (من قاعدة التعيين المحفوظة). */
export function resolveEmployeeByName(db: Database, normName: string): number | null {
  if (!normName) return null
  const row = db.prepare(`SELECT employee_id FROM import_employee_map WHERE excel_name=?`).get(normName) as { employee_id: number } | undefined
  return row ? row.employee_id : null
}

/** معرّف التصنيف الفرعي "سلفة موظف" تحت "مصروفات" — البنود المصنَّفة عليه هي وحدها المؤهَّلة للربط بموظف. */
export function getSalaryAdvanceSubCategoryId(db: Database): number | null {
  const row = db.prepare(`
    SELECT sc.id FROM sub_categories sc JOIN main_categories mc ON mc.id = sc.main_category_id
    WHERE sc.name = 'سلفة موظف' AND mc.name = 'مصروفات'
  `).get() as { id: number } | undefined
  return row ? row.id : null
}
