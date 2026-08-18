/**
 * تواريخ التقويم المحلي (core/date.ts)
 * ─────────────────────────────────────
 * كل تواريخ النظام (تاريخ الشيفت، الحضور، كشوف الحسابات، حدود فترات التقارير) نصوص
 * `YYYY-MM-DD` بالتقويم **المحلي** للجهاز — لأن يوم العمل يوم محلي لا يوم UTC.
 *
 * سبب وجود هذا الملف: كان الكود يستخدم `new Date().toISOString().slice(0, 10)` وهو
 * يُنتج تاريخ **UTC**، فينتج عنه في مصر (UTC+2/+3) خطآن مؤكَّدان:
 *   1) شيفت يُفتح 1:30 صباحاً يُسجَّل بتاريخ اليوم السابق.
 *   2) `new Date(y, m, 1).toISOString()` (منتصف ليل محلي) يرجع لليوم السابق، فكان
 *      آخر يوم في كل شهر يسقط من حدود فترات لوحة المعلومات والتقارير.
 *
 * حسابات الشهر هنا تعمل على النص مباشرةً (أو عبر `Date.UTC`) بلا أي منطقة زمنية،
 * فهي مأمونة من الانزياح مهما كان توقيت الجهاز.
 */

/** تاريخ اليوم (أو أي لحظة) بالتقويم المحلي — `YYYY-MM-DD`. */
export function localISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** عدد أيام شهر `YYYY-MM`. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** أول يوم في الشهر — `YYYY-MM` ← `YYYY-MM-01`. */
export function monthStartISO(month: string): string {
  return `${month}-01`
}

/** آخر يوم في الشهر — `YYYY-MM` ← `YYYY-MM-DD`. */
export function monthEndISO(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
}

/** أول يوم في الشهر التالي — الحدّ الحصري (exclusive) لفترة شهر كامل. */
export function nextMonthStartISO(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** إزاحة تاريخ `YYYY-MM-DD` بعدد أيام (موجب أو سالب) — بلا أي أثر لمنطقة زمنية. */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}
