/**
 * خط أنابيب الاستيراد (Orchestrator).
 * ─────────────────────────────────────
 * analyze(): تحليل + تعيين + جمع المجهول والكاشيرين والمعاينة (بلا إدراج).
 * runImport(): الإدراج الفعلي — شيفت + يومية + معاملات ككائنات أعمال حقيقية (#6)،
 *              مع حفظ قواعد التعيين لإعادة الاستخدام، ضمن معاملة قاعدة واحدة (WAL).
 *
 * V1: المعاملات فقط. فوري/العهدة تبقى صفراً (وحدات مستقبلية — ADR).
 */
import type { Workbook } from 'exceljs'
import type { Database } from 'better-sqlite3'
import { horusBlockParser } from './blockParser'
import {
  buildCategoryIndex, resolveCategory, resolvePayment, resolveCashier, directionFromKind,
  type CategoryIndex,
} from './valueMapping'
import { validateTransaction, type MappedTransaction } from './validator'
import { buildDuplicateIndex, isDuplicate, findPriorImport, type PriorImport } from './duplicateChecker'
import { createShift, getJournalByShift, updateFawry, updateShiftCloseInputs, updateShiftStatus, overrideShiftExpenses, updateCustody } from '../../database/repositories/shifts'
import { addTransactionsBatch } from '../../database/repositories/transactions'
import { addTreasuryCheckpoint, getBalanceAsOf } from '../../database/repositories/treasury'
import type { ShiftType, ShiftFawry } from '../../../core/types'
import type { RawFawry } from './types'

// حقول فوري المالية (تُخزَّن بالقروش ×100). البون أرقام لا مبالغ.
const FAWRY_MONEY: (keyof RawFawry)[] = [
  'basicReceive', 'basicDeliver', 'airReceive', 'airDeliver',
  'cashoutReceive', 'cashoutDeliver', 'cashoutAdd', 'cashoutDiscount',
  'fawryToBasic', 'fawryToAir', 'cashoutToBasic', 'cashoutToAir', 'programSales',
]

/** بناء تعديل فوري بالقروش من القيم الخام (بالجنيه). */
function buildFawryPatch(f: RawFawry): Partial<Omit<ShiftFawry, 'id' | 'shiftId'>> {
  const patch: Partial<Omit<ShiftFawry, 'id' | 'shiftId'>> = {}
  for (const k of FAWRY_MONEY)
    if (f[k] !== undefined) (patch as Record<string, number>)[k] = Math.round((f[k] as number) * 100)
  if (f.firstVoucher !== undefined) patch.firstVoucher = f.firstVoucher
  if (f.lastVoucher !== undefined) patch.lastVoucher = f.lastVoucher
  return patch
}

/** مبيعات فوري المحسوبة من المحرّك (أساسي + إير تايم) — بالجنيه، للتحقّق مع «مبيعات فوري» المقروءة. */
function computedFawrySales(f: RawFawry): number {
  const basic = (f.basicReceive ?? 0) - (f.basicDeliver ?? 0) + (f.fawryToBasic ?? 0) + (f.cashoutToBasic ?? 0)
  const air = (f.airReceive ?? 0) - (f.airDeliver ?? 0) + (f.fawryToAir ?? 0) + (f.cashoutToAir ?? 0)
  return basic + air
}

// ═══ أنواع النتائج ═══
export interface UnknownCategory { normValue: string; rawValue: string; count: number }
export interface CashierEntry { normName: string; rawName: string; count: number; resolvedUserId: number | null }

export interface AnalysisResult {
  totalBlocks: number
  totalTransactions: number
  autoMapped: number
  cashiers: CashierEntry[]
  unknownCategories: UnknownCategory[]
  warnings: string[]
  priorImport: PriorImport | null
  // رصيد أول الصندوق المكتشف في الملف (إن وُجدت خليته) + ما كان سيُحسب تلقائياً عند نفس التاريخ للمقارنة
  openingBalance?: { amountPiastres: number; dateISO: string; calculatedPiastres: number }
}

/** قرار تعيين فئة مجهولة: ربط بفئة، أو تخطٍّ (يُسجَّل). */
export type CategoryDecision =
  | { action: 'map'; mainCategoryId: number; subCategoryId: number | null }
  | { action: 'skip' }

export interface ImportOptions {
  fileName: string
  userId: number
  userName: string
  cashierMap: Record<string, number>            // normName → userId (يشمل '' للفارغ)
  categoryDecisions: Record<string, CategoryDecision> // للقيم المجهولة سابقاً
}

export interface ImportErrorRecord {
  sheet: string; row: number; type: string; original: string; message: string
}
export interface ImportReport {
  totalBlocks: number
  totalTransactions: number
  imported: number
  duplicates: number
  failed: number
  skipped: number
  shiftsCreated: number
  durationMs: number
  errors: ImportErrorRecord[]
  // نقطة ارتكاز الصندوق المُنشأة من خلية "رصيد أول الصندوق" في الملف (إن وُجدت)
  openingCheckpoint?: { date: string; amountPiastres: number; calculatedPiastres: number; mismatch: boolean }
}

const START_TIME: Record<ShiftType, string> = { morning: '08:00', evening: '16:00', between: '12:00' }

// ═══ التحليل (بلا إدراج) ═══
export function analyze(db: Database, workbook: Workbook, fileName: string): AnalysisResult {
  const parsed = horusBlockParser.parse(workbook)
  const idx = buildCategoryIndex(db)

  const cashierMap = new Map<string, CashierEntry>()
  const unknownMap = new Map<string, UnknownCategory>()
  let autoMapped = 0

  for (const b of parsed.blocks) {
    const cKey = b.cashierNorm
    const ce = cashierMap.get(cKey)
    if (ce) ce.count++
    else cashierMap.set(cKey, {
      normName: cKey, rawName: b.cashierRaw, count: 1,
      resolvedUserId: resolveCashier(db, cKey),
    })
    for (const t of b.transactions) {
      const res = resolveCategory(db, idx, t.categoryNorm)
      if (res.status === 'mapped') autoMapped++
      else {
        const u = unknownMap.get(t.categoryNorm)
        if (u) u.count++
        else unknownMap.set(t.categoryNorm, { normValue: t.categoryNorm, rawValue: t.categoryRaw, count: 1 })
      }
    }
  }

  return {
    totalBlocks: parsed.blocks.length,
    totalTransactions: parsed.totalTransactions,
    autoMapped,
    cashiers: Array.from(cashierMap.values()).sort((a, b) => b.count - a.count),
    unknownCategories: Array.from(unknownMap.values()).sort((a, b) => b.count - a.count),
    warnings: parsed.warnings,
    priorImport: findPriorImport(db, fileName),
    openingBalance: parsed.openingBalance ? {
      amountPiastres: parsed.openingBalance.amountPiastres,
      dateISO: parsed.openingBalance.dateISO,
      calculatedPiastres: getBalanceAsOf(db, parsed.openingBalance.dateISO),
    } : undefined,
  }
}

// ═══ الاستيراد الفعلي ═══
export function runImport(db: Database, workbook: Workbook, opts: ImportOptions): ImportReport {
  const t0 = Date.now()
  const parsed = horusBlockParser.parse(workbook)

  const report: ImportReport = {
    totalBlocks: parsed.blocks.length,
    totalTransactions: parsed.totalTransactions,
    imported: 0, duplicates: 0, failed: 0, skipped: 0, shiftsCreated: 0,
    durationMs: 0, errors: [],
  }

  const run = db.transaction(() => {
    // 1) حفظ قرارات التعيين لإعادة الاستخدام (#7 + محرّك التعيين)
    const upsertCat = db.prepare(`
      INSERT INTO import_category_map (excel_value, main_category_id, sub_category_id, created_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(excel_value) DO UPDATE SET
        main_category_id=excluded.main_category_id, sub_category_id=excluded.sub_category_id, active=1
    `)
    for (const [val, d] of Object.entries(opts.categoryDecisions))
      if (d.action === 'map') upsertCat.run(val, d.mainCategoryId, d.subCategoryId, opts.userId)

    const upsertCashier = db.prepare(`
      INSERT INTO import_cashier_map (excel_name, user_id, created_by) VALUES (?, ?, ?)
      ON CONFLICT(excel_name) DO UPDATE SET user_id=excluded.user_id
    `)
    for (const [name, uid] of Object.entries(opts.cashierMap))
      if (uid) upsertCashier.run(name, uid, opts.userId)

    // 2) فهرس الفئات بعد حفظ القواعد (يشمل القرارات الجديدة)
    const idx: CategoryIndex = buildCategoryIndex(db)
    const skipSet = new Set(
      Object.entries(opts.categoryDecisions).filter(([, d]) => d.action === 'skip').map(([v]) => v)
    )
    // فهرس التكرار — استعلام واحد لكل تواريخ الملف بدل استعلام لكل معاملة
    const dupIdx = buildDuplicateIndex(db, parsed.blocks.map(b => b.dateISO).filter((d): d is string => !!d))

    // فهرس الشيفتات المستوردة سابقاً بنفس تواريخ الملف — يمنع إنشاء شيفت مكرر عند إعادة استيراد نفس الملف/الفترة
    // (بدون هذا، إعادة الاستيراد كانت تُنشئ شيفتات جديدة بنفس نقدية الكاشير رغم أن معاملاتها الفردية تُكتشف كمكررة،
    //  فيتضخّم "المضاف للخزينة" في حساب الصندوق مع كل إعادة استيراد)
    const importedShiftKeys = new Set<string>()
    {
      const dates = Array.from(new Set(parsed.blocks.map(b => b.dateISO).filter((d): d is string => !!d)))
      if (dates.length) {
        const placeholders = dates.map(() => '?').join(',')
        const rows = db.prepare(`
          SELECT date, cashier_user_id AS cashierUserId, type
          FROM shifts WHERE date IN (${placeholders}) AND note = 'مستورد من Excel'
        `).all(...dates) as { date: string; cashierUserId: number; type: string }[]
        for (const r of rows) importedShiftKeys.add(`${r.date}|${r.cashierUserId}|${r.type}`)
      }
    }

    // 3) لكل كتلة → شيفت + معاملات
    for (const b of parsed.blocks) {
      const shiftType: ShiftType = b.shiftType ?? 'morning'
      const cashierUserId = opts.cashierMap[b.cashierNorm] ?? resolveCashier(db, b.cashierNorm)
      if (!b.dateISO || !cashierUserId) {
        report.failed += b.transactions.length
        report.errors.push({ sheet: b.sheetName, row: b.headerRow, type: 'invalid_block',
          original: `${b.dateRaw}/${b.cashierRaw}`, message: !cashierUserId ? 'كاشير غير مُعيّن' : 'تاريخ غير صالح' })
        continue
      }

      if (importedShiftKeys.has(`${b.dateISO}|${cashierUserId}|${shiftType}`)) {
        report.duplicates += b.transactions.length
        report.errors.push({ sheet: b.sheetName, row: b.headerRow, type: 'duplicate_shift',
          original: `${b.dateRaw}/${b.cashierRaw}`,
          message: 'شيفت مستورد مسبقاً بنفس التاريخ والكاشير ونوع الشيفت — تم تخطّيه لمنع الازدواج' })
        continue
      }

      const shift = createShift(db, {
        cashierUserId, cashierName: b.cashierRaw || 'غير محدد',
        date: b.dateISO, startTime: START_TIME[shiftType], openingBalance: 0,
        createdBy: opts.userId, type: shiftType, note: 'مستورد من Excel',
      })
      report.shiftsCreated++
      const journal = getJournalByShift(db, shift.id)
      if (!journal) continue

      const batch: Parameters<typeof addTransactionsBatch>[1] = []
      for (const t of b.transactions) {
        // تخطٍّ صريح
        if (skipSet.has(t.categoryNorm)) {
          report.skipped++
          report.errors.push({ sheet: b.sheetName, row: t.rowNum, type: 'skipped', original: t.categoryRaw, message: 'تخطٍّ باختيار المستخدم' })
          continue
        }
        const res = resolveCategory(db, idx, t.categoryNorm)
        const amountPiastres = Math.round(t.amount * 100)
        const payMethod = resolvePayment(t.payNorm)
        const mapped: MappedTransaction = {
          rowNum: t.rowNum, dateISO: b.dateISO, description: t.description,
          amountPiastres, mainCategoryId: res.mainCategoryId, subCategoryId: res.subCategoryId,
          direction: res.direction, payMethod, categoryRaw: t.categoryRaw,
          categoryStatus: res.status,
        }
        const err = validateTransaction(mapped)
        if (err) {
          if (err.type === 'unknown_category') report.skipped++
          else report.failed++
          report.errors.push({ sheet: b.sheetName, row: t.rowNum, type: err.type, original: `${t.categoryRaw} | ${t.amount} | ${t.description}`, message: err.message })
          continue
        }
        if (isDuplicate(dupIdx, b.dateISO, amountPiastres, res.mainCategoryId, t.description)) {
          report.duplicates++
          report.errors.push({ sheet: b.sheetName, row: t.rowNum, type: 'duplicate', original: `${t.description} | ${t.amount}`, message: 'مكرّرة (موجودة مسبقاً)' })
          continue
        }
        batch.push({
          shiftId: shift.id, journalId: journal.id, description: t.description,
          mainCategoryId: res.mainCategoryId, subCategoryId: res.subCategoryId,
          amountIn: res.direction === 'in' ? amountPiastres : 0,
          amountOut: res.direction === 'out' ? amountPiastres : 0,
          payMethod, employeeId: null, customerId: null, note: '', createdBy: opts.userId,
        })
      }
      if (batch.length) {
        addTransactionsBatch(db, batch)
        report.imported += batch.length
      }

      // 4) بيانات فوري (E/F) — تُخزَّن بالقروش (#3, #5)
      const fawryPatch = buildFawryPatch(b.fawry)
      if (Object.keys(fawryPatch).length) updateFawry(db, shift.id, fawryPatch)

      // 5) POS + نقدية الكاشير (G/H) — «إجمالي مبيعات» → POS (#4)
      if (b.closing.posSales !== undefined || b.closing.cashierRemaining !== undefined)
        updateShiftCloseInputs(db, shift.id, {
          posSales: Math.round((b.closing.posSales ?? 0) * 100),
          cashierRemaining: Math.round((b.closing.cashierRemaining ?? 0) * 100),
        })

      // 5ب) العهدة (G/H) — «اضافي عهدة» → عهدة مستلمة، «ادارة» → عهدة منصرفة (متبقي العهدة يُحسب تلقائياً في المحرّك، معلوماتي فقط)
      if (b.closing.custodyAdd !== undefined || b.closing.custodyManagement !== undefined)
        updateCustody(db, shift.id, {
          addFromFund: Math.round((b.closing.custodyAdd ?? 0) * 100),
          managementPaid: Math.round((b.closing.custodyManagement ?? 0) * 100),
        })

      // 6) تحقّق (#12): «مبيعات فوري» المقروءة = أساسي + إير تايم المحسوبة
      if (b.fawry.importedFawrySales !== undefined) {
        const diff = Math.abs(computedFawrySales(b.fawry) - b.fawry.importedFawrySales)
        if (diff > 1) report.errors.push({
          sheet: b.sheetName, row: b.headerRow, type: 'fawry_mismatch',
          original: `محسوبة ${computedFawrySales(b.fawry)} ≠ مقروءة ${b.fawry.importedFawrySales}`,
          message: 'عدم تطابق مبيعات فوري المحسوبة مع المقروءة',
        })
      }

      // 7) تحقّق (#12): مصروفات الكاشير المحسوبة من البنود = «كاشير» في تقفيل الشيت
      // ونثق برقم الشيت المرجعي (المُصالَح فعلياً) بدل الاشتقاق من pay_method عند الاختلاف —
      // لأن عمود «الدفع» قد يكون فارغاً لبنود مشتريات/مصروفات/أجور جُمعية فتُحتسَب خطأً كصرف كاشير.
      if (b.closing.cashierExpenses !== undefined) {
        const impCashierExp = batch.filter(x => x.payMethod === 'cashier').reduce((sm, x) => sm + x.amountOut, 0)
        const sheetCashierExp = Math.round(b.closing.cashierExpenses * 100)
        if (Math.abs(impCashierExp - sheetCashierExp) > 100) {
          report.errors.push({
            sheet: b.sheetName, row: b.headerRow, type: 'cashier_expenses_mismatch',
            original: `محسوبة ${impCashierExp / 100} ≠ شيت ${b.closing.cashierExpenses}`,
            message: 'مصروفات الكاشير المحسوبة من البنود لا تطابق قيمة التقفيل بالشيت — تم اعتماد رقم الشيت',
          })
        }
        overrideShiftExpenses(db, shift.id, sheetCashierExp)
      }

      // 8) الشيفتات المستوردة مكتملة البيانات فعلياً — يجب إخراجها من status='open'
      // حتى لا تُنتحل كـ«الشيفت النشط» من قِبل شاشة الإدخال اليومي (getActiveShift)
      updateShiftStatus(db, shift.id, 'review', opts.userId)
    }

    // 4) رصيد أول الصندوق المُدخل يدوياً في الملف (إن وُجد) → نقطة ارتكاز جديدة مؤرَّخة لحساب الصندوق.
    // القيمة المُدخلة تُعتمد دائماً كتصحيح شامل (تُلغي الحاجة لإعادة حساب أي تسويات يدوية قبلها) — غير حاجزة،
    // فقط تُسجَّل كتحذير غير قاتل إن اختلفت بشكل ملحوظ عمّا كان النظام سيحسبه تلقائياً عند نفس التاريخ.
    if (parsed.openingBalance) {
      const { dateISO, amountPiastres } = parsed.openingBalance
      const calculated = getBalanceAsOf(db, dateISO)
      const mismatch = Math.abs(calculated - amountPiastres) > 100
      if (mismatch) {
        report.errors.push({
          sheet: parsed.openingBalance.sheetName, row: parsed.openingBalance.row, type: 'opening_balance_mismatch',
          original: `مُدخل ${amountPiastres / 100} ≠ محسوب تلقائياً ${calculated / 100}`,
          message: 'رصيد أول الصندوق المُدخل يختلف عن الرصيد الذي كان سيُحسب تلقائياً بتاريخه — تم اعتماد القيمة المُدخلة كتصحيح',
        })
      }
      addTreasuryCheckpoint(db, {
        date: dateISO, amount: amountPiastres, source: 'import',
        note: `مستورد من ${opts.fileName}`,
      })
      report.openingCheckpoint = { date: dateISO, amountPiastres, calculatedPiastres: calculated, mismatch }
    }

    // 5) سجل الاستيراد
    db.prepare(`
      INSERT INTO import_history (user_id, user_name, file_name, sheets, total, imported, failed, duplicates, skipped, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(opts.userId, opts.userName, opts.fileName, parsed.sheetsScanned,
           report.totalTransactions, report.imported, report.failed, report.duplicates, report.skipped, Date.now() - t0)
  })

  run()
  report.durationMs = Date.now() - t0
  return report
}
