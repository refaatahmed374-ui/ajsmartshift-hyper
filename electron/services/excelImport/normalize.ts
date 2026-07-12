/**
 * طبقة التطبيع (Normalization) — محرّك استيراد Excel
 * ─────────────────────────────────────────────────
 * تُطبّق قبل أي تعيين (Value Mapping). مسؤوليتها الوحيدة توحيد شكل النص:
 * الهمزات وأشكال الألف، الياء/الألف المقصورة، التاء المربوطة، التطويل،
 * التشكيل، الأرقام العربية، والمسافات — إضافةً لقاموس أخطاء إملائية شائعة.
 *
 * القاعدة: التطبيع لا يعرف شيئاً عن فئات النظام. يحوّل نصاً خاماً إلى
 * «نص قانوني» (canonical) فقط، ثم تتولّى طبقة التعيين الربط.
 */

/** إزالة التشكيل (الحركات) */
const TASHKEEL = /[ً-ْٰ]/g
/** التطويل (ـ) */
const TATWEEL = /ـ/g

/** أرقام عربية-هندية → لاتينية */
function fixDigits(s: string): string {
  return s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
          .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
}

/**
 * التطبيع العام لأي نص عربي.
 * يُنتج مفتاحاً قانونياً ثابتاً بغضّ النظر عن اختلاف الهمزات/المسافات.
 */
export function normalizeArabic(input: unknown): string {
  if (input === null || input === undefined) return ''
  let s = String(input)
  s = s.replace(TASHKEEL, '')
  s = s.replace(TATWEEL, '')
  s = fixDigits(s)
  // توحيد أشكال الألف والهمزات
  s = s.replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ → ا
  s = s.replace(/ى/g, 'ي')                     // ى → ي
  s = s.replace(/ة/g, 'ه')                     // ة → ه
  s = s.replace(/ؤ/g, 'و')                     // ؤ → و
  s = s.replace(/ئ/g, 'ي')                     // ئ → ي
  // توحيد المسافات
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/**
 * قاموس الأخطاء الإملائية الشائعة الخاصة بالمجال (بعد التطبيع العام).
 * المفاتيح والقيم كلّها بصيغة normalizeArabic. يُوسَّع بسهولة.
 * مبني على أخطاء حقيقية رُصدت في ملفات العملاء.
 */
const TYPO_MAP: Record<string, string> = {
  'اداوات تغليف': 'ادوات تغليف',
  'كيمو استبداك': 'كيمو استبدال',
  'تليفوان وانترنت': 'تليفون وانترنت',
  'اجل عميل': 'اجل',
  'خصم عميل': 'خصومات البيع',
}

/**
 * التطبيع الكامل = تطبيع عام + تصحيح الأخطاء الإملائية المعروفة.
 * هذا هو المفتاح الذي تُبنى عليه طبقة التعيين.
 */
export function normalizeValue(input: unknown): string {
  const base = normalizeArabic(input)
  return TYPO_MAP[base] ?? base
}

/** إضافة/تحديث قاعدة تصحيح إملائي وقت التشغيل (لملفات القوالب المستقبلية). */
export function addTypoRule(fromRaw: string, toRaw: string): void {
  TYPO_MAP[normalizeArabic(fromRaw)] = normalizeArabic(toRaw)
}
