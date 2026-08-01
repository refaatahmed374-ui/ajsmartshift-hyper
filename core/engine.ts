// ===== محرك الحسابات =====
// كل المبالغ بالقروش (integer). ممنوع float نهائياً.
// كل دالة هنا ليها unit test مقابلها في core/engine.test.ts

import type {
  ShiftFawry, ShiftCustody,
  FawryResult, CustodyResult,
  BalanceStatus,
} from './types'

// ═════════════════════════════════════════════════════════════
// ADR-012 v2 — معادلة الإغلاق الرسمية الموحّدة (المصدر الوحيد للنظام كله)
// ═════════════════════════════════════════════════════════════

export interface ShiftClosingInput {
  posSales: number          // مبيعات POS
  fawrySales: number        // مبيعات فوري + الربحية (تدخل درج الكاشير فعلياً — لازم تدخل معادلة العجز/الأوفر)
  cashierRemaining: number  // نقدية الكاشير (المتبقية في الدرج)
  cashierExpenses: number   // مصروفات الكاشير (منصرف البنود التي دفعها الكاشير)
  collections: number       // التحصيل (وارد فئة تحصيل)
}
export interface ShiftClosingResult { result: number; status: BalanceStatus }

/**
 * نتيجة إغلاق الشيفت — المعادلة الرسمية الوحيدة (v2.34.33 — تصحيح: التحصيل كان يُضاف فيُحتسَب مرتين
 * لأن نقدية الكاشير أصلاً بتشمل أي تحصيل استلمه الكاشير خلال الشيفت؛ الصواب طرحه لعزله عن نقدية المبيعات):
 * (v2.38.2 — تصحيح: مبيعات فوري تدخل درج الكاشير فعلياً ولم تكن داخلة في المعادلة، فيظهر "متزن" وهمي
 * رغم فرق حقيقي بين نقدية الكاشير واجمالي المبيعات كلما كانت مبيعات فوري غير صفرية)
 *   الإغلاق = (نقدية الكاشير + مصروفات الكاشير − التحصيل) − (مبيعات POS + مبيعات فوري)
 * موجب ⇒ أوفر (surplus) · سالب ⇒ عجز (deficit) · صفر ⇒ مطابق (balanced)
 */
export function calcShiftClosing(i: ShiftClosingInput): ShiftClosingResult {
  const result = (i.cashierRemaining + i.cashierExpenses - i.collections) - (i.posSales + i.fawrySales)
  const status: BalanceStatus = result > 0 ? 'surplus' : result < 0 ? 'deficit' : 'balanced'
  return { result, status }
}

// ===== 1. ماكينة فوري =====
export function calcFawry(f: ShiftFawry): FawryResult {
  // مبيعات أساسي = استلام أساسي − تسليم أساسي + "من فوري للأساسي" + "من كاش أوت للأساسي"
  const basicSales =
    (f.basicReceive - f.basicDeliver) + f.fawryToBasic + f.cashoutToBasic

  // مبيعات إير تايم = استلام − تسليم + "من فوري للإير تايم" + "من كاش أوت للإير تايم"
  const airSales =
    (f.airReceive - f.airDeliver) + f.fawryToAir + f.cashoutToAir

  // مبيعات كاش أوت = تسليم − استلام (للعلم فقط — لا تدخل في إجمالي فوري لأنها مدفوعات فيزا)
  const cashoutSales    = f.cashoutDeliver - f.cashoutReceive

  // إجمالي مبيعات فوري = أساسي + إير تايم فقط (كاش أوت = مبيعات فيزا، تُحسب من اليومية)
  const totalFawrySales = basicSales + airSales

  // الربحية = مبيعات فوري + الربحية (يدوي — أو القديم المستورَد من الإكسل للشيفتات التاريخية) − مبيعات أساسي − مبيعات إير تايم
  const fawryTotal = f.fawryTotalManual || f.programSales
  const profitability = fawryTotal - basicSales - airSales

  // عدد العمليات = آخر بون − أول بون
  const operationsCount = Math.max(0, f.lastVoucher - f.firstVoucher)

  return {
    basicSales,
    airSales,
    cashoutSales,
    totalFawrySales,
    profitability,
    operationsCount,
  }
}

// ===== 2. العهدة =====
export function calcCustody(c: ShiftCustody): CustodyResult {
  // باقي العهدة = إضافة للعهدة − (إدارة/محسوب)
  const remaining = c.addFromFund - c.managementPaid
  return { remaining }
}

// ===== 3. رقم الشيفت الشهري =====
// يُحسب من عدد الشيفتات في نفس الشهر الميلادي + 1
export function calcMonthlyShiftNum(
  shiftsThisMonth: { id: number }[]
): number {
  return shiftsThisMonth.length + 1
}

// ===== 4. تحديد نوع الشيفت تلقائياً =====
// صباحي: 06:00 → 13:59 | مسائي: 14:00 → 21:59 | بيتوين: غير ذلك
export function detectShiftType(startTime: string): 'morning' | 'evening' | 'between' {
  const hour = parseInt(startTime.split(':')[0], 10)
  if (hour >= 6  && hour < 14) return 'morning'
  if (hour >= 14 && hour < 22) return 'evening'
  return 'between'
}
