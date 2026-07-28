/**
 * محلّل الكتل (Block Parser) — الاستراتيجية الرسمية لقالب «حسابات حورس».
 * ─────────────────────────────────────────────────────────────────
 * الملف ورقة واحدة تحوي الشهر كاملاً ككُتل شيفتات متكرّرة. كل كتلة:
 *   صف ترويسة:  A=التاريخ | B=<تاريخ> | C=اليوم | D=<يوم> | E=الشيفت | F=<صباحي/مسائي> | G=اسم الكاشير | H=<اسم>
 *   صف رؤوس:    A=القيمة | B=البيان | C=الفئة | D=الدفع | E=بيان مكنة فوري | F=القيمة | G=تقفيل | H=الشيفت
 *   المعاملات:  أعمدة A–D حتى يفرغ عمود القيمة (فوري/التقفيل في E–H تُتجاهل — decision #2).
 *
 * لا يعتمد على الألوان/الخطوط/الحدود — فقط على مواضع الأعمدة ونصّ الترويسة (decision: reading strategy).
 */
import type { Workbook, Worksheet, Cell } from 'exceljs'
import { normalizeArabic, normalizeValue } from './normalize'
import type { ParseResult, RawShiftBlock, RawFawry, RawClosing, RawOpeningBalance, WorkbookParser } from './types'
import type { ShiftType } from '../../../core/types'

const HDR_DATE = 'التاريخ'     // علامة بداية الكتلة (العمود A في صف الترويسة)

// ═══ خرائط تسميات فوري/التقفيل (بالاسم لا بالموضع — decision: reading strategy) ═══
// المفاتيح بصيغة normalizeValue حتى تُطابَق مهما اختلفت الهمزات/المسافات.
const nv = (s: string) => normalizeValue(s)
const FAWRY_LABELS: Record<string, keyof RawFawry> = {
  [nv('استلام اساسي')]: 'basicReceive',
  [nv('تسليم اساسي')]: 'basicDeliver',
  [nv('استلام اير تايم')]: 'airReceive',
  [nv('تسليم اير تايم')]: 'airDeliver',
  [nv('استلام كاش اوت')]: 'cashoutReceive',
  [nv('تسليم كاش اوت')]: 'cashoutDeliver',
  [nv('من فوري للاساسي')]: 'fawryToBasic',
  [nv('من فوري للايرتايم')]: 'fawryToAir',
  [nv('من كاش للرئيسي')]: 'cashoutToBasic',
  [nv('من كاش للايرتايم')]: 'cashoutToAir',
  [nv('مبيعات البرنامج')]: 'programSales',
  [nv('مبيعات فوري')]: 'importedFawrySales',   // للتحقّق فقط
  [nv('اول بون')]: 'firstVoucher',
  [nv('اخر بون')]: 'lastVoucher',
}
const CLOSING_LABELS: Record<string, keyof RawClosing> = {
  [nv('اجمالي مبيعات')]: 'posSales',        // #4 → مبيعات POS
  [nv('نقدية')]: 'cashierRemaining',        // نقدية الكاشير
  [nv('كاشير')]: 'cashierExpenses',         // مصروفات الكاشير (للتحقّق)
  [nv('اضافي عهدة')]: 'custodyAdd',         // → عهدة مستلمة (addFromFund)
  [nv('ادارة')]: 'custodyManagement',       // → عهدة منصرفة (managementPaid)
}
// خلية على مستوى الملف كله (لا الكتلة) — تُقرأ من نفس عمودي التقفيل G/H، وتُعتمد نقطة ارتكاز لرصيد الصندوق.
// "رصيد سابق" هو المسمّى الطبيعي الموجود فعلاً في قسم «الصندوق» بقالب حورس الأصلي (يتكرّر في كل شيفت)،
// و"رصيد اول الصندوق" مسمّى بديل لمن لا يستخدم قسم الصندوق. يُؤخَذ أول ظهور فقط (أول شيفت بالملف) ويُتجاهَل الباقي
// (تكرار "رصيد سابق" في كل شيفت لاحق أمر متوقَّع وليس تعارضاً — رصيدنا الخاص يُكمل الحساب من نقطة الارتكاز الأولى).
const OPENING_BALANCE_LABELS = new Set([nv('رصيد اول الصندوق'), nv('رصيد سابق')])

/** الصيغ المطبَّعة لأنواع الشيفت (تُحسب مرة). */
const SHIFT_MORNING = normalizeArabic('صباحي')
const SHIFT_EVENING = normalizeArabic('مسائي') // ملاحظة: الهمزة ئ→ي فتصبح «مسايي»
const SHIFT_BETWEEN = new Set([normalizeArabic('بيني'), normalizeArabic('بيتوين'), normalizeArabic('بين')])

/** نوع الشيفت من نصّ الإكسل (مقارنة بالصيغة المطبَّعة). */
function mapShiftType(raw: string): ShiftType | null {
  const n = normalizeArabic(raw)
  if (n === SHIFT_MORNING) return 'morning'
  if (n === SHIFT_EVENING) return 'evening'
  if (SHIFT_BETWEEN.has(n)) return 'between'
  return null
}

/** استخلاص نص من قيمة خلية exceljs مهما كان نوعها (نص/منسّق richText/معادلة/رابط). */
function valToStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.richText)) return (o.richText as { text?: unknown }[]).map(rt => String(rt.text ?? '')).join('')
    if ('text' in o) return String(o.text ?? '')
    if ('result' in o) return String(o.result ?? '')  // معادلة
    if ('hyperlink' in o && 'text' in o) return String(o.text ?? '')
    return ''
  }
  return String(v)
}

/** قراءة قيمة خلية كنص مطبَّع. */
function cellStr(ws: Worksheet, row: number, col: number): string {
  return valToStr((ws.getCell(row, col) as Cell).value).trim()
}

/** قيمة رقمية أو null (يدعم المعادلات ذات النتيجة الرقمية). */
function cellNum(ws: Worksheet, row: number, col: number): number | null {
  const v: unknown = (ws.getCell(row, col) as Cell).value
  if (typeof v === 'number') return v
  if (typeof v === 'object' && v !== null && 'result' in v) {
    const r = (v as { result: unknown }).result
    if (typeof r === 'number') return r
  }
  const s = valToStr(v).trim()
  if (s !== '' && !isNaN(Number(s))) return Number(s)
  return null
}

/** تحويل خلية التاريخ إلى ISO yyyy-mm-dd. */
function toISO(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof v === 'string') {
    const s = v.trim()
    // dd-mm-yy أو dd/mm/yyyy
    const m = s.match(/^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})$/)
    if (m) {
      let [, a, b, c] = m
      let day: string, mon: string, year: string
      if (a.length === 4) { year = a; mon = b; day = c }          // yyyy-mm-dd
      else { day = a; mon = b; year = c.length === 2 ? '20' + c : c } // dd-mm-yy(yy)
      return `${year}-${mon.padStart(2, '0')}-${day.padStart(2, '0')}`
    }
  }
  return null
}

/** تحليل ورقة واحدة إلى كتل. openingFound تُجمَّع فيها كل ظهورات خلية "رصيد أول الصندوق" عبر كل الأوراق. */
function parseSheet(ws: Worksheet, warnings: string[], openingFound: RawOpeningBalance[]): RawShiftBlock[] {
  const blocks: RawShiftBlock[] = []
  const maxRow = ws.rowCount
  let r = 1
  while (r <= maxRow) {
    if (normalizeArabic(cellStr(ws, r, 1)) === HDR_DATE) {
      // صف ترويسة
      const dateRaw = (ws.getCell(r, 2) as Cell).value
      const shiftRaw = cellStr(ws, r, 6)
      const cashierRaw = cellStr(ws, r, 8)
      const shiftType = mapShiftType(shiftRaw)
      const block: RawShiftBlock = {
        sheetName: ws.name,
        headerRow: r,
        dateISO: toISO(dateRaw),
        dateRaw,
        dayName: cellStr(ws, r, 4),
        shiftRaw,
        shiftType,
        cashierRaw,
        cashierNorm: normalizeValue(cashierRaw),
        transactions: [],
        fawry: {},
        closing: {},
      }
      if (!block.dateISO) warnings.push(`صف ${r}: تاريخ غير صالح (${String(dateRaw)})`)
      if (!shiftType) warnings.push(`صف ${r}: نوع شيفت مجهول (${shiftRaw})`)
      if (!cashierRaw) warnings.push(`صف ${r}: اسم الكاشير فارغ`)

      // نطاق الكتلة الكامل = من r+2 حتى بداية الكتلة التالية (أو نهاية الورقة).
      // فوري/التقفيل (E–H) يمتدّان أبعد من معاملات اليومية (A–D)، فنحسب النطاق كاملاً.
      let blockEnd = r + 2
      while (blockEnd <= maxRow && normalizeArabic(cellStr(ws, blockEnd, 1)) !== HDR_DATE) blockEnd++

      // 1) معاملات اليومية (A–D) — تتوقّف عند أول صف قيمته وبيانه فارغان
      for (let tr = r + 2; tr < blockEnd; tr++) {
        const amount = cellNum(ws, tr, 1)
        const desc = cellStr(ws, tr, 2)
        if (amount !== null && desc !== '') {
          const categoryRaw = cellStr(ws, tr, 3)
          const payRaw = cellStr(ws, tr, 4)
          block.transactions.push({
            rowNum: tr, amount, description: desc,
            categoryRaw, categoryNorm: normalizeValue(categoryRaw),
            payRaw, payNorm: normalizeValue(payRaw),
          })
        }
        // صف فارغ أو جزئي (فاصل بصري) — يُتجاهَل، والقراءة تستمر حتى نهاية نطاق الكتلة
      }

      // 2) فوري (E=اسم، F=قيمة) + التقفيل (G=اسم، H=قيمة) — بالاسم عبر كامل نطاق الكتلة
      for (let er = r + 2; er < blockEnd; er++) {
        const fKey = FAWRY_LABELS[normalizeValue(cellStr(ws, er, 5))]
        if (fKey) { const v = cellNum(ws, er, 6); if (v !== null) block.fawry[fKey] = v }
        const closingLabel = normalizeValue(cellStr(ws, er, 7))
        const cKey = CLOSING_LABELS[closingLabel]
        if (cKey) { const v = cellNum(ws, er, 8); if (v !== null) block.closing[cKey] = v }
        // "رصيد أول الصندوق" أو "رصيد سابق" — نقطة ارتكاز الصندوق. تُؤخَذ فقط من أول شيفت بالملف (أول ظهور)،
        // وتُتجاهَل كل الظهورات اللاحقة (متوقَّعة وطبيعية مع "رصيد سابق" المتكرر في كل شيفت — ليست تعارضاً)
        if (openingFound.length === 0 && OPENING_BALANCE_LABELS.has(closingLabel) && block.dateISO) {
          const v = cellNum(ws, er, 8)
          if (v !== null) openingFound.push({ amountPiastres: Math.round(v * 100), dateISO: block.dateISO, sheetName: ws.name, row: er })
        }
      }

      blocks.push(block)
      r = blockEnd
    } else {
      r++
    }
  }
  return blocks
}

/** المحلّل الرسمي لقالب حسابات حورس (كتل شيفتات). */
export const horusBlockParser: WorkbookParser = {
  id: 'horus-block-v1',
  label: 'قالب حورس — كتل شيفتات (V1)',
  parse(workbook: Workbook): ParseResult {
    const warnings: string[] = []
    const blocks: RawShiftBlock[] = []
    const openingFound: RawOpeningBalance[] = []
    let sheetsScanned = 0
    workbook.eachSheet((ws) => {
      sheetsScanned++
      blocks.push(...parseSheet(ws, warnings, openingFound))
    })

    // نقطة ارتكاز الصندوق (رصيد أول الصندوق/رصيد سابق) — أول ظهور فقط عبر كل الملف (انظر الحارس داخل parseSheet)
    const openingBalance: RawOpeningBalance | undefined = openingFound[0]

    return {
      blocks,
      totalTransactions: blocks.reduce((s, b) => s + b.transactions.length, 0),
      sheetsScanned,
      warnings,
      openingBalance,
    }
  },
}
