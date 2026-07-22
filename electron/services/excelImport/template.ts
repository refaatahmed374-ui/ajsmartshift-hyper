/**
 * قالب استيراد فارغ (قالب حورس) — يبنيه العميل بنفسه ويملأ الخلايا الفارغة فقط.
 * يطابق تماماً تخطيط الأعمدة الذي يقرأه horusBlockParser (انظر blockParser.ts).
 */
import ExcelJS from 'exceljs'

const FAWRY_LABELS = [
  'استلام اساسي', 'تسليم اساسي', 'استلام اير تايم', 'تسليم اير تايم',
  'استلام كاش اوت', 'تسليم كاش اوت', 'اضافة كاش اوت', 'خصم كاش اوت',
  'من فوري للاساسي', 'من فوري للايرتايم', 'من كاش للرئيسي', 'من كاش للايرتايم',
  'مبيعات البرنامج', 'مبيعات فوري', 'اول بون', 'اخر بون',
]

// "رصيد اول الصندوق" تُكتب مرة واحدة فقط في أول شيفت بالملف (تصبح تاريخ نقطة ارتكاز الصندوق)
// "اضافي عهدة"/"ادارة" (العهدة) تُكتبان في كل شيفت — عهدة مستلمة/منصرفة (انظر blockParser.ts CLOSING_LABELS)
const CLOSING_LABELS_FIRST_BLOCK = ['اجمالي مبيعات', 'نقدية', 'كاشير', 'اضافي عهدة', 'ادارة', 'رصيد اول الصندوق']
const CLOSING_LABELS_OTHER_BLOCKS = ['اجمالي مبيعات', 'نقدية', 'كاشير', 'اضافي عهدة', 'ادارة']

const TRANSACTION_ROWS = 30   // يكفي لأكبر عدد بنود يومية متوقّع للشيفت الواحد
const HEADER_FILL = 'FFE8EEF9'
const LABEL_FILL = 'FFF3F4F6'

function styleHeaderCell(cell: ExcelJS.Cell) {
  cell.font = { bold: true }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
}
function styleLabelCell(cell: ExcelJS.Cell) {
  cell.font = { bold: true, size: 10 }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_FILL } }
}

/** يبني كتلة شيفت فارغة (ترويسة + صف رؤوس + صفوف قيم فارغة) بدءاً من الصف r، ويُرجع صف نهاية الكتلة. */
function buildEmptyBlock(ws: ExcelJS.Worksheet, r: number, isFirstBlock: boolean): number {
  // صف الترويسة
  ws.getCell(r, 1).value = 'التاريخ'; styleHeaderCell(ws.getCell(r, 1))
  ws.getCell(r, 2).value = null
  ws.getCell(r, 2).numFmt = 'yyyy-mm-dd'
  ws.getCell(r, 3).value = 'اليوم'; styleHeaderCell(ws.getCell(r, 3))
  ws.getCell(r, 5).value = 'الشيفت'; styleHeaderCell(ws.getCell(r, 5))
  ws.getCell(r, 7).value = 'اسم الكاشير'; styleHeaderCell(ws.getCell(r, 7))

  // صف الرؤوس (توضيحي فقط — لا يقرأه المحلّل، لكنه يوضّح للعميل معنى كل عمود)
  const subHeaders = ['القيمة', 'البيان', 'الفئة', 'الدفع', 'بيان مكنة فوري', 'القيمة', 'تقفيل', 'الشيفت']
  subHeaders.forEach((h, i) => { const c = ws.getCell(r + 1, i + 1); c.value = h; styleLabelCell(c) })

  const blockStart = r + 2
  const closingLabels = isFirstBlock ? CLOSING_LABELS_FIRST_BLOCK : CLOSING_LABELS_OTHER_BLOCKS

  for (let i = 0; i < TRANSACTION_ROWS; i++) {
    const row = blockStart + i
    if (i < FAWRY_LABELS.length) { const c = ws.getCell(row, 5); c.value = FAWRY_LABELS[i]; styleLabelCell(c) }
    if (i < closingLabels.length) { const c = ws.getCell(row, 7); c.value = closingLabels[i]; styleLabelCell(c) }
  }

  return blockStart + TRANSACTION_ROWS   // صف بداية الكتلة التالية
}

/** يبني ملف قالب فارغ بكتلة شيفت واحدة جاهزة للتعبئة — تُنسَخ لأسفل لكل شيفت إضافي. */
export function buildTemplateWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('يوميات الشيفتات')
  ws.columns = [{ width: 12 }, { width: 14 }, { width: 10 }, { width: 12 }, { width: 20 }, { width: 12 }, { width: 20 }, { width: 12 }]
  ws.views = [{ rightToLeft: true }]

  buildEmptyBlock(ws, 1, true)

  const notes = wb.addWorksheet('تعليمات التعبئة')
  notes.views = [{ rightToLeft: true }]
  notes.columns = [{ width: 90 }]
  ;[
    'تعليمات تعبئة القالب:',
    '— في صف الترويسة (الخلفية الزرقاء): اكتب التاريخ، اليوم، نوع الشيفت (صباحي/مسائي/بيني)، واسم الكاشير في الخلايا المجاورة للتسميات.',
    '— في أعمدة A–D: اكتب بنود اليومية (القيمة، البيان، الفئة، طريقة الدفع) صفاً بصف.',
    '— في عمود F (بجانب عمود E): اكتب قيم بيانات ماكينة فوري المقابلة للتسمية في نفس الصف.',
    '— في عمود H (بجانب عمود G): اكتب "إجمالي مبيعات" و"نقدية" و"كاشير" لهذا الشيفت.',
    '— "اضافي عهدة"/"ادارة": عهدة هذا الشيفت المستلمة/المنصرفة — الفرق بينهما (المتبقي) يعود للصندوق ولا يدخل في الحسابات المالية.',
    '— "رصيد أول الصندوق": يُكتب مرة واحدة فقط في أول شيفت بالملف (أقدم تاريخ) — يمثّل رصيد الصندوق قبل بداية هذه الفترة.',
    '— لإضافة المزيد من الشيفتات/الأيام: انسخ كتلة شيفت كاملة (كل صفوفها) والصقها أسفل آخر كتلة، ثم عدّل التاريخ والكاشير.',
    '— لا تُغيّر التسميات الموجودة في الخلايا الملوّنة — عدّل فقط الخلايا الفارغة المجاورة لها.',
  ].forEach((line, i) => { notes.getCell(i + 1, 1).value = line })

  return wb
}
