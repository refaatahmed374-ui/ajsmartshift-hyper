/**
 * نظام الخطوط المركزي — AJ Smart Shift
 * ====================================
 * المصدر الوحيد لأحجام/أوزان الخطوط في كل البرنامج.
 * يُطبّق عبر classes في index.css (.t-display, .t-heading ...).
 *
 * القاعدة: أوزان 400/500/600/700 فقط (ممنوع 100/200/300/800/900).
 * كل القيم المالية تستخدم font-variant-numeric: tabular-nums.
 */

export interface TypeStyle {
  fontSize:   string
  fontWeight: number
  lineHeight: string
  letterSpacing?: string
  tabularNums?: boolean
}

export const typography = {
  /** عنوان الصفحة الرئيسي — لوحة التحكم، السجلات، المستخدمون */
  display: {
    fontSize:   '24px',
    fontWeight: 700,
    lineHeight: '32px',
    letterSpacing: '-0.01em',
  } as TypeStyle,

  /** عناوين كبيرة ثانوية / ترحيب */
  heading: {
    fontSize:   '20px',
    fontWeight: 700,
    lineHeight: '28px',
  } as TypeStyle,

  /** عنوان بطاقة — إجمالي الوارد، رصيد البداية */
  title: {
    fontSize:   '16px',
    fontWeight: 600,
    lineHeight: '24px',
  } as TypeStyle,

  /** نص عادي — اسم المستخدم، حالة الشيفت */
  body: {
    fontSize:   '14px',
    fontWeight: 500,
    lineHeight: '22px',
  } as TypeStyle,

  /** نص ثانوي — التاريخ، الإصدار، آخر مزامنة */
  caption: {
    fontSize:   '12px',
    fontWeight: 400,
    lineHeight: '18px',
  } as TypeStyle,

  /** القيمة المالية الكبيرة — 0.00 ج */
  numberLg: {
    fontSize:   '32px',
    fontWeight: 700,
    lineHeight: '40px',
    tabularNums: true,
  } as TypeStyle,

  /** القيمة المالية المتوسطة — الرصيد، الوارد، المنصرف */
  numberMd: {
    fontSize:   '22px',
    fontWeight: 600,
    lineHeight: '30px',
    tabularNums: true,
  } as TypeStyle,

  /** رقم صغير داخل الجداول */
  numberSm: {
    fontSize:   '14px',
    fontWeight: 600,
    lineHeight: '20px',
    tabularNums: true,
  } as TypeStyle,

  /** عنصر القائمة الجانبية */
  navItem: {
    fontSize:   '15px',
    fontWeight: 500,
    lineHeight: '24px',
  } as TypeStyle,

  /** عنصر القائمة الجانبية النشط */
  navItemActive: {
    fontSize:   '15px',
    fontWeight: 600,
    lineHeight: '24px',
  } as TypeStyle,
} as const

/** نظام المسافات — 8px Grid */
export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  x2: '48px',
} as const

/** الخطوط المعتمدة */
export const fontFamily = {
  arabic: "'IBM Plex Sans Arabic', 'IBM Plex Sans', system-ui, sans-serif",
  latin:  "'IBM Plex Sans', 'IBM Plex Sans Arabic', system-ui, sans-serif",
} as const

/** تحويل TypeStyle إلى كائن style لـ React (للاستخدام المباشر عند الحاجة) */
export function asStyle(t: TypeStyle): React.CSSProperties {
  return {
    fontSize:      t.fontSize,
    fontWeight:    t.fontWeight,
    lineHeight:    t.lineHeight,
    letterSpacing: t.letterSpacing,
    ...(t.tabularNums ? { fontVariantNumeric: 'tabular-nums' as const } : {}),
  }
}
