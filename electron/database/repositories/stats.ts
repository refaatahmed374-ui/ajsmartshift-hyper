import type Database from 'better-sqlite3'
import { nextMonthStartISO } from '../../../core/date'

export interface FinancialData {
  revenues:    number   // إيرادات الفترة = مبيعات الشيفتات (POS + فوري)
  purchases:   number   // مشتريات
  expenses:    number   // مصروفات تشغيلية (بقية التكاليف غير المشتريات)
  netProfit:   number   // صافي الربح = الإيرادات − إجمالي التكاليف
  cashIn:      number   // تدفق نقدي داخل (وارد بدفع كاشير)
  cashOut:     number   // تدفق نقدي خارج (منصرف بدفع كاشير)
  receivables: number   // ذمم مدينة — رصيد تراكمي حتى نهاية الشهر (مبيعات آجلة لم تُحصَّل بعد)
}

const monthLike = (m: string) => `${m}%`

/**
 * الملخّص المالي للشهر (قائمة الدخل المبسّطة + التدفق النقدي + الذمم) — تُعرض في شاشة التقارير.
 *
 * ═══ تصحيحان محاسبيان جوهريان ═══
 *
 * (1) «الإيرادات» و«صافي الربح» كانا يُحسبان من `SUM(transactions.amount_in)`.
 *     لكن هناك migration في `database/index.ts` تُجبر **كل** بند ليس تحت تصنيف «تحصيل» على أن
 *     يكون `amount_out` (توحيد اتجاه المبلغ). فـ`amount_in` لا يحتوي عملياً إلا على التحصيل،
 *     ومعناه أن «الإيرادات» كانت = التحصيل فقط، و«صافي الربح» = التحصيل − كل المنصرف
 *     ⇒ رقم سالب ضخم بلا معنى. المبيعات الحقيقية لا تُخزَّن في البنود أصلاً بل في
 *     `shifts.pos_sales` و`shift_fawry`، فمنهما تُقرأ الإيرادات الآن — بنفس تعريف
 *     «اجمالي المبيعات» المعتمد في ملخّص الشيفت: `pos_sales + (fawry_total_manual أو program_sales)`.
 *
 *     ولنفس السبب استُبعدت فئتا `income` و`collection` من جانب التكاليف: منصرف فئة «مبيعات»
 *     (مبيعات آجل/فيزا) ليس مصروفاً بل أثر جانبي لتوحيد الاتجاه، وكان يُحتسَب تكلفةً بالخطأ.
 *     والتحصيل ليس إيراداً جديداً (المبيعة الآجلة محتسَبة أصلاً في مبيعات الشيفت) فلا يدخل الطرفين.
 *
 * (2) «الذمم المدينة» كانت `منصرف − وارد` لبنود التصنيف الفرعي «مبيعات آجل» فقط. لكن السداد
 *     يُسجَّل تحت تصنيف مختلف تماماً («تحصيل ← تحصيل مبيعات آجلة»)، فالطرف الدائن كان صفراً
 *     دائماً ⇒ الذمم تتراكم بلا نهاية مهما سدَّد العملاء. الآن يُطرح التحصيل الفعلي.
 */
export function getFinancials(db: Database.Database, month: string): FinancialData {
  const one = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { v: number }).v

  // ── الإيرادات: مبيعات الشيفتات (POS + فوري) — لا من اتجاه مبالغ البنود ──
  const revenues = one(`
    SELECT COALESCE(SUM(s.pos_sales), 0)
         + COALESCE(SUM(COALESCE(NULLIF(f.fawry_total_manual, 0), f.program_sales, 0)), 0) AS v
    FROM shifts s LEFT JOIN shift_fawry f ON f.shift_id = s.id
    WHERE s.date LIKE ?
  `, monthLike(month))

  // ── التكاليف: كل المنصرف عدا فئتَي «مبيعات» (income) و«تحصيل» (collection) ──
  const COST_FILTER = `(mc.kind IS NULL OR mc.kind NOT IN ('income', 'collection'))`
  const costs = one(`
    SELECT COALESCE(SUM(t.amount_out), 0) AS v
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    LEFT JOIN main_categories mc ON mc.id = t.main_category_id
    WHERE s.date LIKE ? AND ${COST_FILTER}
  `, monthLike(month))

  const purchases = one(`
    SELECT COALESCE(SUM(t.amount_out), 0) AS v
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    JOIN main_categories mc ON mc.id = t.main_category_id
    WHERE s.date LIKE ? AND mc.kind = 'purchase'
  `, monthLike(month))

  // ── التدفق النقدي عبر درج الكاشير ──
  const cashRow = db.prepare(`
    SELECT COALESCE(SUM(t.amount_in), 0) AS cin, COALESCE(SUM(t.amount_out), 0) AS cout
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    WHERE s.date LIKE ? AND t.pay_method = 'cashier'
  `).get(monthLike(month)) as { cin: number; cout: number }

  // ── الذمم المدينة: رصيد تراكمي حتى نهاية الشهر المعروض (لا حركة الشهر وحده) ──
  // الذمم بند رصيد لا بند فترة: لو بِيع آجلاً في يناير وسُدِّد في فبراير، الحساب الشهري
  // يُظهر +المبلغ في يناير و−المبلغ في فبراير (ذمم سالبة بلا معنى). التراكمي يُظهر
  // الرصيد القائم فعلاً: المبلغ في يناير ثم صفر في فبراير.
  const upTo = nextMonthStartISO(month)   // حدّ حصري
  const creditSales = one(`
    SELECT COALESCE(SUM(t.amount_out + t.amount_in), 0) AS v
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    JOIN sub_categories sc ON sc.id = t.sub_category_id
    WHERE s.date < ? AND sc.name = 'مبيعات آجل'
  `, upTo)
  const creditCollected = one(`
    SELECT COALESCE(SUM(t.amount_in + t.amount_out), 0) AS v
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    JOIN sub_categories sc ON sc.id = t.sub_category_id
    JOIN main_categories mc ON mc.id = sc.main_category_id
    WHERE s.date < ? AND mc.kind = 'collection' AND sc.name = 'تحصيل مبيعات آجلة'
  `, upTo)

  return {
    revenues,
    purchases,
    expenses:    costs - purchases,
    netProfit:   revenues - costs,
    cashIn:      cashRow.cin,
    cashOut:     cashRow.cout,
    receivables: creditSales - creditCollected,
  }
}
