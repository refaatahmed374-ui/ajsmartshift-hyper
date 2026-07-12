/**
 * محرّك التحقّق (Validation Engine).
 * كل معاملة يجب أن تستوفي: تاريخ صالح · قيمة رقمية موجبة · فئة مُعيّنة · طريقة دفع.
 * الفشل لا يوقف الاستيراد — يُسجّل ويُتخطّى (حسب المواصفات).
 */
import type { PayMethod } from '../../../core/types'

export type ErrorType =
  | 'invalid_date'
  | 'invalid_amount'
  | 'unknown_category'
  | 'missing_description'
  | 'invalid_payment'

export interface ValidationError {
  type: ErrorType
  message: string
}

/** معاملة بعد التطبيع والتعيين، جاهزة للتحقّق قبل الإدراج. */
export interface MappedTransaction {
  rowNum: number
  dateISO: string | null
  description: string
  amountPiastres: number       // بعد التحويل ×100
  mainCategoryId: number | null
  subCategoryId: number | null
  direction: 'in' | 'out'
  payMethod: PayMethod
  categoryRaw: string
  categoryStatus: 'mapped' | 'unknown' | 'skip'
}

const PAY_METHODS: PayMethod[] = ['cashier', 'management']

/** يتحقّق من معاملة واحدة. يعيد null إن كانت صحيحة، أو الخطأ الأول. */
export function validateTransaction(t: MappedTransaction): ValidationError | null {
  if (!t.dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(t.dateISO))
    return { type: 'invalid_date', message: `تاريخ غير صالح` }
  if (!t.description || t.description.trim() === '')
    return { type: 'missing_description', message: `البيان فارغ` }
  if (!Number.isFinite(t.amountPiastres) || t.amountPiastres <= 0)
    return { type: 'invalid_amount', message: `قيمة غير صالحة` }
  if (t.categoryStatus !== 'mapped' || t.mainCategoryId == null)
    return { type: 'unknown_category', message: `فئة غير مُعيّنة: ${t.categoryRaw}` }
  if (!PAY_METHODS.includes(t.payMethod))
    return { type: 'invalid_payment', message: `طريقة دفع غير صالحة: ${t.payMethod}` }
  return null
}
