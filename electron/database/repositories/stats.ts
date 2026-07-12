import type Database from 'better-sqlite3'

export interface Trend { value: number; isPositive: boolean }
export interface OverviewData {
  monthRevenues:  number   // إجمالي الوارد للشهر
  monthExpenses:  number   // إجمالي المنصرف للشهر
  monthProfit:    number   // الربح = وارد − منصرف
  todayRevenues:  number   // مبيعات اليوم
  invoicesCount:  number   // عدد الشيفتات (الفواتير)
  bestEmployee:   { name: string; days: number } | null
  topDescription: { text: string; count: number } | null
  topPayMethod:   { method: string; count: number } | null
  revenuesTrend:  Trend | null   // مقارنة بالشهر السابق
  profitTrend:    Trend | null
}

// الشهر السابق لـ YYYY-MM
function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)   // mo-1 الحالي، -1 السابق
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function pctTrend(cur: number, prev: number): Trend | null {
  if (prev === 0) return cur > 0 ? { value: 100, isPositive: true } : null
  const change = ((cur - prev) / Math.abs(prev)) * 100
  return { value: Math.round(Math.abs(change)), isPositive: change >= 0 }
}

export interface FinancialData {
  revenues:    number   // إيرادات (كل الوارد)
  purchases:   number   // مشتريات
  expenses:    number   // مصروفات تشغيلية (منصرف غير المشتريات)
  netProfit:   number   // صافي الربح = إيرادات − منصرف كلي
  cashIn:      number   // تدفق نقدي داخل (دفع كاشير وارد)
  cashOut:     number   // تدفق نقدي خارج (دفع كاشير منصرف)
  receivables: number   // ذمم مدينة (آجل)
}

const monthLike = (m: string) => `${m}%`

export function getOverview(db: Database.Database, month: string): OverviewData {
  const today = new Date().toISOString().slice(0, 10)

  const totals = db.prepare(`
    SELECT COALESCE(SUM(t.amount_in),0) AS rin, COALESCE(SUM(t.amount_out),0) AS rout
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    WHERE s.date LIKE ?
  `).get(monthLike(month)) as { rin: number; rout: number }

  const todayRow = db.prepare(`
    SELECT COALESCE(SUM(t.amount_in),0) AS rin
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    WHERE s.date = ?
  `).get(today) as { rin: number }

  const invoices = (db.prepare(
    `SELECT COUNT(*) AS c FROM shifts WHERE date LIKE ?`
  ).get(monthLike(month)) as { c: number }).c

  // أفضل موظف = الأكثر أيام حضور هذا الشهر
  const bestEmp = db.prepare(`
    SELECT e.name AS name, COUNT(*) AS days
    FROM attendance a JOIN employees e ON e.id = a.employee_id
    WHERE a.status = 'present' AND a.date LIKE ?
    GROUP BY a.employee_id ORDER BY days DESC LIMIT 1
  `).get(monthLike(month)) as { name: string; days: number } | undefined

  // أكثر بيان متكرر
  const topDesc = db.prepare(`
    SELECT t.description AS text, COUNT(*) AS count
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    WHERE s.date LIKE ? AND TRIM(t.description) <> ''
    GROUP BY t.description ORDER BY count DESC LIMIT 1
  `).get(monthLike(month)) as { text: string; count: number } | undefined

  // أكثر طريقة دفع
  const topPay = db.prepare(`
    SELECT t.pay_method AS method, COUNT(*) AS count
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    WHERE s.date LIKE ?
    GROUP BY t.pay_method ORDER BY count DESC LIMIT 1
  `).get(monthLike(month)) as { method: string; count: number } | undefined

  // مقارنة الشهر السابق
  const pm = prevMonth(month)
  const prevTotals = db.prepare(`
    SELECT COALESCE(SUM(t.amount_in),0) AS rin, COALESCE(SUM(t.amount_out),0) AS rout
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    WHERE s.date LIKE ?
  `).get(monthLike(pm)) as { rin: number; rout: number }

  return {
    monthRevenues: totals.rin,
    monthExpenses: totals.rout,
    monthProfit:   totals.rin - totals.rout,
    todayRevenues: todayRow.rin,
    invoicesCount: invoices,
    bestEmployee:  bestEmp ?? null,
    topDescription: topDesc ?? null,
    topPayMethod:  topPay ?? null,
    revenuesTrend: pctTrend(totals.rin, prevTotals.rin),
    profitTrend:   pctTrend(totals.rin - totals.rout, prevTotals.rin - prevTotals.rout),
  }
}

export function getFinancials(db: Database.Database, month: string): FinancialData {
  const sumOut = (catLike: string) => (db.prepare(`
    SELECT COALESCE(SUM(t.amount_out),0) AS v
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    LEFT JOIN main_categories mc ON mc.id = t.main_category_id
    WHERE s.date LIKE ? AND mc.name LIKE ?
  `).get(monthLike(month), catLike) as { v: number }).v

  const totals = db.prepare(`
    SELECT COALESCE(SUM(t.amount_in),0) AS rin, COALESCE(SUM(t.amount_out),0) AS rout
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    WHERE s.date LIKE ?
  `).get(monthLike(month)) as { rin: number; rout: number }

  const cashRow = db.prepare(`
    SELECT COALESCE(SUM(t.amount_in),0) AS cin, COALESCE(SUM(t.amount_out),0) AS cout
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    WHERE s.date LIKE ? AND t.pay_method = 'cashier'
  `).get(monthLike(month)) as { cin: number; cout: number }

  // الذمم المدينة = بنود التصنيف الفرعي «مبيعات آجل» (منصرف − وارد، أي المتبقي) — ADR-012 v2
  const credRow = db.prepare(`
    SELECT COALESCE(SUM(t.amount_out),0) AS out, COALESCE(SUM(t.amount_in),0) AS inn
    FROM transactions t
      JOIN shifts s ON s.id = t.shift_id
      JOIN sub_categories sc ON sc.id = t.sub_category_id
    WHERE s.date LIKE ? AND sc.name = 'مبيعات آجل'
  `).get(monthLike(month)) as { out: number; inn: number }

  const purchases = sumOut('%مشتر%')

  return {
    revenues:    totals.rin,
    purchases,
    expenses:    totals.rout - purchases,
    netProfit:   totals.rin - totals.rout,
    cashIn:      cashRow.cin,
    cashOut:     cashRow.cout,
    receivables: credRow.out - credRow.inn,
  }
}
