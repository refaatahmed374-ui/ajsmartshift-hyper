import type Database from 'better-sqlite3'

// صف حركة الخزينة — قد يكون شيفت أو تسوية (راتب/سحب)
export interface TreasuryRow {
  kind:        'shift' | 'adjustment'
  id:          number
  shiftNum:    number | null
  date:        string
  label:       string   // اسم الكاشير أو وصف التسوية
  cashIn:      number   // وارد (نقدية متبقية)
  mgmtOut:     number   // منصرف (إدارة/راتب/سحب)
  net:         number
  running:     number   // الرصيد المتراكم بعد هذه الحركة
  status:      string   // حالة الشيفت أو نوع التسوية
}

export interface TreasuryData {
  opening:        number   // رصيد أول الصندوق (يدوي — مرة واحدة)
  incomingAll:    number   // المضاف للخزينة (كل الفترات) = Σ نقدية الكاشير
  outgoingAll:    number   // المنصرف من الإدارة (كل الفترات) = Σ بنود إدارة + Σ تسويات
  currentBalance: number   // رصيد الصندوق الحالي = opening + incomingAll − outgoingAll
  prevBalance:    number   // الرصيد قبل بداية الشهر المعروض
  shiftsCount:    number   // عدد حركات الشهر المعروض
  monthIn:        number   // وارد الشهر المعروض
  monthOut:       number   // منصرف الشهر المعروض (إدارة + تسويات)
  movements:      TreasuryRow[]   // حركات الشهر (شيفتات + تسويات) مع الرصيد المتراكم
}

// مدفوعات الإدارة لشيفت معيّن
const MGMT_BY_SHIFT = `
  SELECT COALESCE(SUM(amount_out), 0) AS total
  FROM transactions WHERE shift_id = ? AND pay_method = 'management'
`
const STATUSES = `('open','review','approved')`

export function getTreasuryData(db: Database.Database, month: string): TreasuryData {
  const monthStart = `${month}-01`

  // رصيد أول الصندوق (يدوي) من الإعدادات
  let opening = 0
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'treasury.opening'`).get() as { value: string } | undefined
    opening = row ? (parseInt(row.value, 10) || 0) : 0
  } catch { /* */ }

  const one = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { t: number }).t

  // ===== الإجماليات التراكمية (كل الفترات) =====
  const incAll = one(`SELECT COALESCE(SUM(cashier_remaining),0) AS t FROM shifts WHERE status IN ${STATUSES}`)
  const mgmtAll = one(`SELECT COALESCE(SUM(t.amount_out),0) AS t FROM transactions t JOIN shifts s ON s.id=t.shift_id WHERE t.pay_method='management' AND s.status IN ${STATUSES}`)
  let adjAll = 0, adjPrev = 0
  try {
    adjAll  = one(`SELECT COALESCE(SUM(amount),0) AS t FROM treasury_adjustments`)
    adjPrev = one(`SELECT COALESCE(SUM(amount),0) AS t FROM treasury_adjustments WHERE date < ?`, monthStart)
  } catch { /* الجدول قد لا يكون موجوداً */ }
  const outAll = mgmtAll + adjAll

  // ===== الرصيد قبل بداية الشهر المعروض =====
  const incPrev = one(`SELECT COALESCE(SUM(cashier_remaining),0) AS t FROM shifts WHERE status IN ${STATUSES} AND date < ?`, monthStart)
  const mgmtPrev = one(`SELECT COALESCE(SUM(t.amount_out),0) AS t FROM transactions t JOIN shifts s ON s.id=t.shift_id WHERE t.pay_method='management' AND s.status IN ${STATUSES} AND s.date < ?`, monthStart)
  const prevBalance = opening + incPrev - mgmtPrev - adjPrev

  // ===== حركات الشهر: الشيفتات + التسويات =====
  const shifts = db.prepare(`
    SELECT id, monthly_shift_num AS num, date, cashier_name AS cashier,
           cashier_remaining AS cashIn, status
    FROM shifts WHERE date LIKE ? AND status IN ${STATUSES}
  `).all(`${month}%`) as { id: number; num: number; date: string; cashier: string; cashIn: number; status: string }[]

  let adjustments: { id: number; date: string; description: string; type: string; amount: number }[] = []
  try {
    adjustments = db.prepare(`
      SELECT id, date, description, type, amount FROM treasury_adjustments WHERE date LIKE ?
    `).all(`${month}%`) as typeof adjustments
  } catch { /* */ }

  // دمج الحركات وترتيبها بالتاريخ
  const merged: TreasuryRow[] = [
    ...shifts.map(s => {
      const mgmtOut = (db.prepare(MGMT_BY_SHIFT).get(s.id) as { total: number }).total
      const cashIn = s.cashIn || 0
      return { kind: 'shift' as const, id: s.id, shiftNum: s.num, date: s.date,
        label: s.cashier, cashIn, mgmtOut, net: cashIn - mgmtOut, running: 0, status: s.status }
    }),
    ...adjustments.map(a => ({
      kind: 'adjustment' as const, id: a.id, shiftNum: null, date: a.date,
      label: a.description || (a.type === 'salary_payout' ? 'دفع رواتب' : a.type === 'salary_reversal' ? 'عكس رواتب' : 'سحب من الخزينة'),
      // كل التسويات في جانب "المنصرف" (signed): موجب=صرف، سالب=عكس/إرجاع يقلّل المنصرف
      cashIn: 0,
      mgmtOut: a.amount,
      net: -a.amount, running: 0, status: a.type,
    })),
  ].sort((x, y) => x.date.localeCompare(y.date) || x.id - y.id)

  let running = prevBalance, monthIn = 0, monthOut = 0
  for (const m of merged) {
    running += m.net; m.running = running
    monthIn += m.cashIn; monthOut += m.mgmtOut
  }

  return {
    opening,
    incomingAll:    incAll,
    outgoingAll:    outAll,
    currentBalance: opening + incAll - outAll,
    prevBalance,
    shiftsCount:    merged.length,
    monthIn,
    monthOut,
    movements:      merged,
  }
}

// ═══ v2.27.0 (14-Jun) — إضافة تسوية (خصم) من خزينة الإدارة ═══
export function addTreasuryAdjustment(
  db: Database.Database,
  data: { date: string; type: string; description: string; amount: number }
): number {
  const res = db.prepare(
    `INSERT INTO treasury_adjustments (date, type, description, amount) VALUES (?, ?, ?, ?)`
  ).run(data.date, data.type, data.description, data.amount)
  return res.lastInsertRowid as number
}

// ═══ تقارير الرواتب ═══
export function savePayrollReport(
  db: Database.Database,
  data: { month: string; totalAmount: number; paymentMethod: string; employeeCount: number; detailsJson: string }
): number {
  const res = db.prepare(
    `INSERT INTO payroll_reports (month, total_amount, payment_method, employee_count, details_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(data.month, data.totalAmount, data.paymentMethod, data.employeeCount, data.detailsJson)
  return res.lastInsertRowid as number
}

export function listPayrollReports(db: Database.Database): unknown[] {
  return db.prepare(`SELECT * FROM payroll_reports ORDER BY created_at DESC`).all()
}

// حذف تقرير راتب + عكس خصم الخزينة (تسوية عكسية سالبة تُعيد المبلغ)
export function deletePayrollReport(db: Database.Database, id: number): boolean {
  const rep = db.prepare(`SELECT month, total_amount FROM payroll_reports WHERE id = ?`).get(id) as { month: string; total_amount: number } | undefined
  if (!rep) return false
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM payroll_reports WHERE id = ?`).run(id)
    // عكس الخصم: تسوية بقيمة سالبة تُعيد المبلغ لخزينة الإدارة
    db.prepare(`INSERT INTO treasury_adjustments (date, type, description, amount) VALUES (?, ?, ?, ?)`)
      .run(new Date().toISOString().slice(0, 10), 'salary_reversal', `إلغاء رواتب شهر ${rep.month}`, -rep.total_amount)
  })
  tx()
  return true
}

// ═══ تقارير التقفيل الشهري ═══
export function saveMonthlyClose(db: Database.Database, month: string, dataJson: string): number {
  const res = db.prepare(`
    INSERT INTO monthly_close_reports (month, data_json) VALUES (?, ?)
    ON CONFLICT(month) DO UPDATE SET data_json=excluded.data_json, created_at=datetime('now')
  `).run(month, dataJson)
  return res.lastInsertRowid as number
}

export function listMonthlyCloses(db: Database.Database): unknown[] {
  return db.prepare(`SELECT * FROM monthly_close_reports ORDER BY month DESC`).all()
}

export function getMonthlyClose(db: Database.Database, month: string): unknown {
  return db.prepare(`SELECT * FROM monthly_close_reports WHERE month = ?`).get(month) ?? null
}
