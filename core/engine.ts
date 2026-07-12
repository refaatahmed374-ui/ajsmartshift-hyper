// ===== محرك الحسابات =====
// كل المبالغ بالقروش (integer). ممنوع float نهائياً.
// كل دالة هنا ليها unit test مقابلها في core/engine.test.ts

import type {
  ShiftFawry, ShiftCustody,
  FawryResult, CustodyResult, ShiftAnalysisResult,
  BalanceStatus, EmployeeAttendance, Employee,
  Transaction
} from './types'

// ═════════════════════════════════════════════════════════════
// ADR-012 v2 — معادلة الإغلاق الرسمية الموحّدة (المصدر الوحيد للنظام كله)
// ═════════════════════════════════════════════════════════════

/**
 * مبيعات فوري مع العمولة = مبيعات فوري قبل العمولة × (1 + النسبة%).
 * @param programSales  مبيعات فوري قبل العمولة (قروش)
 * @param commissionPct نسبة العمولة مخزّنة ×100 (2.00% = 200)
 */
export function calcFawryWithCommission(programSales: number, commissionPct: number): number {
  return Math.round(programSales * (1 + commissionPct / 10000))
}

export interface ShiftClosingInput {
  posSales: number          // مبيعات POS
  cashierRemaining: number  // نقدية الكاشير (المتبقية في الدرج)
  cashierExpenses: number   // مصروفات الكاشير (منصرف البنود التي دفعها الكاشير)
  collections: number       // التحصيل (وارد فئة تحصيل)
}
export interface ShiftClosingResult { result: number; status: BalanceStatus }

/**
 * نتيجة إغلاق الشيفت — المعادلة الرسمية الوحيدة (ADR-012 v2 — مطابقة لتسوية شيت حورس):
 *   الإغلاق = (نقدية الكاشير + مصروفات الكاشير + التحصيل) − مبيعات POS
 * موجب ⇒ أوفر (surplus) · سالب ⇒ عجز (deficit) · صفر ⇒ مطابق (balanced)
 */
export function calcShiftClosing(i: ShiftClosingInput): ShiftClosingResult {
  const result = i.cashierRemaining + i.cashierExpenses + i.collections - i.posSales
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
  const cashoutDiscount = 0
  const cashoutAdd      = 0

  // إجمالي مبيعات فوري = أساسي + إير تايم فقط (كاش أوت = مبيعات فيزا، تُحسب من اليومية)
  const totalFawrySales = basicSales + airSales

  // الربحية = مبيعات البرنامج − مبيعات أساسي − مبيعات إير تايم
  const profitability = f.programSales - basicSales - airSales

  // عدد العمليات = آخر بون − أول بون
  const operationsCount = Math.max(0, f.lastVoucher - f.firstVoucher)

  return {
    basicSales,
    airSales,
    cashoutSales,
    cashoutDiscount,
    cashoutAdd,
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

// ===== 3. تحليل الشيفت (الصندوق) =====
export function calcShiftAnalysis(
  transactions: Transaction[],
  openingBalance: number,
  actualCash: number
): ShiftAnalysisResult {
  let totalIn = 0
  let totalOut = 0

  for (const tx of transactions) {
    totalIn  += tx.amountIn
    totalOut += tx.amountOut
  }

  // النقدية المتوقعة = رصيد البداية + الوارد − المنصرف
  const expectedCash = openingBalance + totalIn - totalOut
  const difference = actualCash - expectedCash

  let status: BalanceStatus = 'balanced'
  if (difference < 0) status = 'deficit'
  else if (difference > 0) status = 'surplus'

  return { totalIn, totalOut, expectedCash, actualCash, difference, status }
}

// ===== 4. حساب الكاشير =====
// دفع بواسطة الكاشير = مجموع كل عمليات الدفع بواسطة الكاشير
export function calcCashierTotal(transactions: Transaction[]): number {
  return transactions
    .filter(tx => tx.payMethod === 'cashier')
    .reduce((sum, tx) => sum + tx.amountOut, 0)
}

// ===== 5. مصروفات الصندوق =====
// مصروفات الصندوق = إدارة/محسوب من قسم العهدة
export function calcFundExpenses(custody: ShiftCustody): number {
  return custody.managementPaid
}

// ===== 6. سلف الموظف =====
// السلفة = تتجمّع من بنود اليومية حيث (الموظف موجود + payMethod)
export function calcEmployeeAdvances(
  transactions: Transaction[],
  employeeId: number
): number {
  return transactions
    .filter(tx => tx.employeeId === employeeId && tx.amountOut > 0)
    .reduce((sum, tx) => sum + tx.amountOut, 0)
}

// ===== 7. التقفيل الشهري للموظف =====
export function calcEmployeeMonthly(
  employee: Employee,
  attendanceRecords: EmployeeAttendance[],
  advances: number
): {
  hoursWorked: number
  grossSalary: number
  netSalary: number
} {
  // مجموع الدقائق → ساعات
  const totalMinutes = attendanceRecords
    .filter(a => a.employeeId === employee.id && a.checkOut !== null)
    .reduce((sum, a) => sum + a.hoursWorked, 0)

  const hoursWorked = Math.round(totalMinutes / 60 * 100) / 100

  // الراتب الإجمالي = ساعات × أجر الساعة (بالقروش)
  const grossSalary = Math.round(hoursWorked * employee.hourlyRate)

  // صافي الراتب = الإجمالي − السلف
  const netSalary = grossSalary - advances

  return { hoursWorked, grossSalary, netSalary }
}

// ===== 8. رقم الشيفت الشهري =====
// يُحسب من عدد الشيفتات في نفس الشهر الميلادي + 1
export function calcMonthlyShiftNum(
  shiftsThisMonth: { id: number }[]
): number {
  return shiftsThisMonth.length + 1
}

// ===== 9. تحديد نوع الشيفت تلقائياً =====
// صباحي: 06:00 → 13:59 | مسائي: 14:00 → 21:59 | بيتوين: غير ذلك
export function detectShiftType(startTime: string): 'morning' | 'evening' | 'between' {
  const hour = parseInt(startTime.split(':')[0], 10)
  if (hour >= 6  && hour < 14) return 'morning'
  if (hour >= 14 && hour < 22) return 'evening'
  return 'between'
}

// ===== 10. تحويل القروش ← → جنيه =====
export function piasToEGP(pias: number): string {
  const egp = pias / 100
  return egp.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function egpToPias(egp: string | number): number {
  const n = typeof egp === 'string' ? parseFloat(egp.replace(/,/g, '')) : egp
  if (isNaN(n)) return 0
  return Math.round(n * 100)
}

// ===== 11. فحص عتبة التنبيه =====
export function isAnomalous(difference: number, threshold: number): boolean {
  return Math.abs(difference) > threshold
}

// ===== 12. آخر شيفت في الشهر (للتقفيل) =====
export function isLastShiftOfMonth(
  shiftDate: string,
  allShiftDates: string[]
): boolean {
  const shiftMonth = shiftDate.substring(0, 7) // YYYY-MM
  const monthShifts = allShiftDates.filter(d => d.startsWith(shiftMonth))
  const sorted = [...monthShifts].sort()
  return sorted[sorted.length - 1] === shiftDate
}
