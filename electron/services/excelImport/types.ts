/**
 * أنواع محرّك استيراد Excel (مشتركة بين المكوّنات).
 * البنية: Workbook → Worksheet → ShiftBlock → Transactions
 */
import type { ShiftType } from '../../../core/types'

/** معاملة خام كما قُرئت من الإكسل (قبل التحقّق والتعيين النهائي). */
export interface RawTransaction {
  rowNum: number            // رقم الصف في الورقة (للتقارير والأخطاء)
  amount: number            // القيمة (قروش×؟ — تبقى كما في الإكسل حتى التحويل)
  description: string        // البيان (خام)
  categoryRaw: string        // الفئة كما في الإكسل
  categoryNorm: string       // الفئة بعد التطبيع (مفتاح التعيين)
  payRaw: string             // الدفع كما في الإكسل
  payNorm: string            // الدفع بعد التطبيع
}

/** بيانات ماكينة فوري الخام (العمودان E/F داخل الكتلة) — بالجنيه كما في الإكسل. */
export interface RawFawry {
  basicReceive?: number; basicDeliver?: number
  airReceive?: number; airDeliver?: number
  cashoutReceive?: number; cashoutDeliver?: number
  fawryToBasic?: number; fawryToAir?: number
  cashoutToBasic?: number; cashoutToAir?: number
  programSales?: number                 // «مبيعات البرنامج»
  firstVoucher?: number; lastVoucher?: number   // أرقام بون (ليست مبالغ)
  importedFawrySales?: number           // «مبيعات فوري» المقروءة — للتحقّق فقط (تُحسب من المحرّك)
}

/** بيانات التقفيل الخام (العمودان G/H داخل الكتلة) — بالجنيه كما في الإكسل. */
export interface RawClosing {
  posSales?: number          // «إجمالي مبيعات» → مبيعات POS
  cashierRemaining?: number  // «نقدية» → نقدية الكاشير
  cashierExpenses?: number   // «كاشير» → مصروفات الكاشير (للتحقّق مع المحسوبة من البنود)
  custodyAdd?: number        // «اضافي عهدة» → عهدة مستلمة (addFromFund)
  custodyManagement?: number // «ادارة» → عهدة منصرفة (managementPaid)
}

/** كتلة شيفت واحدة = ترويسة + معاملاتها + فوري + تقفيل. */
export interface RawShiftBlock {
  sheetName: string
  headerRow: number
  dateISO: string | null     // yyyy-mm-dd
  dateRaw: unknown           // القيمة الأصلية (Date أو نص)
  dayName: string
  shiftRaw: string           // صباحي/مسائي…
  shiftType: ShiftType | null
  cashierRaw: string         // اسم الكاشير كما في الإكسل
  cashierNorm: string
  transactions: RawTransaction[]
  fawry: RawFawry            // العمودان E/F
  closing: RawClosing        // العمودان G/H
}

/** رصيد أول الصندوق كما أدخله العميل — قيمة على مستوى الملف كله، لا الكتلة (خلية "رصيد أول الصندوق"). */
export interface RawOpeningBalance {
  amountPiastres: number
  dateISO: string            // تاريخ الكتلة التي وُجدت فيها الخلية — يُصبح تاريخ نقطة الارتكاز
  sheetName: string
  row: number
}

/** ناتج تحليل المصنّف بالكامل. */
export interface ParseResult {
  blocks: RawShiftBlock[]
  totalTransactions: number
  sheetsScanned: number
  warnings: string[]         // مشاكل غير قاتلة (كاشير فارغ، نوع شيفت مجهول…)
  openingBalance?: RawOpeningBalance   // إن وُجدت خلية "رصيد أول الصندوق" في الملف (أول ظهور فقط)
}

/** تعيين اتجاه المعاملة يُشتقّ من «نوع الفئة» لا من قاعدة التعيين (decision #5). */
export type CategoryKind = 'income' | 'expense' | 'purchase' | 'collection' | 'return' | 'misc'

/** اتجاه المبلغ في جدول transactions. */
export type Direction = 'in' | 'out'

/** واجهة عامة لأي محلّل قالب (يسمح بإضافة محلّلات مستقبلية — decision #1). */
export interface WorkbookParser {
  readonly id: string
  readonly label: string
  parse(workbook: import('exceljs').Workbook): ParseResult
}
