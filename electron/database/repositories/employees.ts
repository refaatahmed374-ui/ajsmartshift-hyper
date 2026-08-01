import type Database from 'better-sqlite3'
import type { Employee, Attendance, AttendanceStatus, EmployeeFinancials } from '../../../core/types'
import { normalizeValue } from '../../../core/normalize'
import { similarity } from '../../../core/similarity'

function row2emp(r: Record<string, unknown>): Employee {
  return {
    id:            r.id as number,
    name:          r.name as string,
    nationalId:    r.national_id as string,
    phone:         r.phone as string,
    hourlyRate:    r.hourly_rate as number,
    monthlySalary: (r.monthly_salary as number) ?? 0,
    workHours:     (r.work_hours as number) ?? 800,
    startDate:     r.start_date as string,
    endDate:       r.end_date as string | null,
    status:        r.status as Employee['status'],
  }
}

function row2att(r: Record<string, unknown>): Attendance {
  return {
    id:          r.id as number,
    employeeId:  r.employee_id as number,
    date:        r.date as string,
    status:      r.status as AttendanceStatus,
    checkIn:     r.check_in as string | null,
    checkOut:    r.check_out as string | null,
    hoursWorked: r.hours_worked as number,
    penaltyDays: (r.penalty_days as number) ?? 0,
    bonusAmount: (r.bonus_amount as number) ?? 0,
  }
}

// أجر الساعة المشتق = (الراتب الشهري ÷ 30) ÷ ساعات العمل اليومية
function deriveHourly(monthlySalary: number, workHours: number): number {
  const hrs = (workHours || 800) / 100   // workHours مخزّن ×100
  if (hrs <= 0) return 0
  const daily = monthlySalary / 30
  return Math.round(daily / hrs)
}

// ===== الموظفون =====
export function getAllEmployees(db: Database.Database): Employee[] {
  return (db.prepare(`SELECT * FROM employees ORDER BY name`).all() as Record<string, unknown>[]).map(row2emp)
}
export function getActiveEmployees(db: Database.Database): Employee[] {
  return (db.prepare(`SELECT * FROM employees WHERE status='active' ORDER BY name`).all() as Record<string, unknown>[]).map(row2emp)
}
export function getEmployeeById(db: Database.Database, id: number): Employee | null {
  const row = db.prepare(`SELECT * FROM employees WHERE id=?`).get(id) as Record<string, unknown> | undefined
  return row ? row2emp(row) : null
}

export function createEmployee(
  db: Database.Database,
  data: { name: string; nationalId: string; phone: string; monthlySalary: number; workHours: number; startDate: string; endDate: string | null; status: string }
): number {
  const hourly = deriveHourly(data.monthlySalary, data.workHours)
  const res = db.prepare(`
    INSERT INTO employees (name, national_id, phone, hourly_rate, monthly_salary, work_hours, start_date, end_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.name, data.nationalId, data.phone, hourly, data.monthlySalary, data.workHours, data.startDate, data.endDate, data.status)
  return res.lastInsertRowid as number
}

export function updateEmployee(
  db: Database.Database,
  id: number,
  data: Partial<{ name: string; nationalId: string; phone: string; monthlySalary: number; workHours: number; startDate: string; endDate: string | null; status: string }>
): void {
  const cur = getEmployeeById(db, id)
  if (!cur) return
  const monthlySalary = data.monthlySalary ?? cur.monthlySalary
  const workHours     = data.workHours     ?? cur.workHours
  const hourly        = deriveHourly(monthlySalary, workHours)

  db.prepare(`
    UPDATE employees SET
      name=?, national_id=?, phone=?, hourly_rate=?, monthly_salary=?, work_hours=?,
      start_date=?, end_date=?, status=?
    WHERE id=?
  `).run(
    data.name ?? cur.name,
    data.nationalId ?? cur.nationalId,
    data.phone ?? cur.phone,
    hourly,
    monthlySalary,
    workHours,
    data.startDate ?? cur.startDate,
    data.endDate !== undefined ? data.endDate : cur.endDate,
    data.status ?? cur.status,
    id,
  )
}

// ===== الحضور بالتاريخ =====
function minutesBetween(checkIn: string, checkOut: string): number {
  const [ih, im] = checkIn.split(':').map(Number)
  const [oh, om] = checkOut.split(':').map(Number)
  const inMin = ih * 60 + im, outMin = oh * 60 + om
  return outMin >= inMin ? outMin - inMin : (24 * 60 - inMin) + outMin
}

export function setAttendance(
  db: Database.Database,
  data: { employeeId: number; date: string; status: AttendanceStatus; checkIn: string | null; checkOut: string | null; penaltyDays?: number }
): void {
  let hours = 0
  if (data.status === 'present' && data.checkIn && data.checkOut) {
    hours = minutesBetween(data.checkIn, data.checkOut)
  }
  const penalty = Math.max(0, Math.min(3, data.penaltyDays ?? 0))
  db.prepare(`
    INSERT INTO attendance (employee_id, date, status, check_in, check_out, hours_worked, penalty_days)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      status=excluded.status, check_in=excluded.check_in,
      check_out=excluded.check_out, hours_worked=excluded.hours_worked,
      penalty_days=excluded.penalty_days
  `).run(data.employeeId, data.date, data.status, data.checkIn, data.checkOut, hours, penalty)
}

// v2.27.0 — تحديث الجزاء فقط (دون تغيير الحضور)
export function setAttendancePenalty(
  db: Database.Database,
  employeeId: number,
  date: string,
  penaltyDays: number,
): void {
  const penalty = Math.max(0, Math.min(3, penaltyDays))
  // إذا الصف غير موجود — أنشئه بحالة 'present' افتراضياً (الجزاء بدون حضور غير منطقي)
  db.prepare(`
    INSERT INTO attendance (employee_id, date, status, check_in, check_out, hours_worked, penalty_days)
    VALUES (?, ?, 'present', NULL, NULL, 0, ?)
    ON CONFLICT(employee_id, date) DO UPDATE SET penalty_days=excluded.penalty_days
  `).run(employeeId, date, penalty)
}

// مكافأة الموظف — بجوار الجزاء، قيمة مالية (قروش) لا عدد أيام؛ لا تُخصم/تُضاف لأيام الحضور
export function setAttendanceBonus(
  db: Database.Database,
  employeeId: number,
  date: string,
  bonusAmount: number,
): void {
  const bonus = Math.max(0, bonusAmount)
  // إذا الصف غير موجود — أنشئه بحالة 'present' افتراضياً (نفس منطق الجزاء)
  db.prepare(`
    INSERT INTO attendance (employee_id, date, status, check_in, check_out, hours_worked, bonus_amount)
    VALUES (?, ?, 'present', NULL, NULL, 0, ?)
    ON CONFLICT(employee_id, date) DO UPDATE SET bonus_amount=excluded.bonus_amount
  `).run(employeeId, date, bonus)
}

export function deleteAttendance(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM attendance WHERE id=?`).run(id)
}

export function getAttendanceMonth(db: Database.Database, employeeId: number, month: string): Attendance[] {
  return (db.prepare(
    `SELECT * FROM attendance WHERE employee_id=? AND date LIKE ? ORDER BY date DESC`
  ).all(employeeId, `${month}%`) as Record<string, unknown>[]).map(row2att)
}

// ===== الحسابات المالية الشهرية لكل الموظفين =====
export function getMonthlyFinancials(db: Database.Database, month: string): EmployeeFinancials[] {
  const emps = getActiveEmployees(db)
  return emps.map(emp => {
    // الحضور
    const att = db.prepare(
      `SELECT status, hours_worked, COALESCE(penalty_days, 0) AS penalty_days, COALESCE(bonus_amount, 0) AS bonus_amount
       FROM attendance WHERE employee_id=? AND date LIKE ?`
    ).all(emp.id, `${month}%`) as { status: string; hours_worked: number; penalty_days: number; bonus_amount: number }[]

    const presentRows = att.filter(a => a.status === 'present')
    const presentDays = presentRows.length
    const absentDays  = att.filter(a => a.status === 'absent').length
    const totalMinutes = presentRows.reduce((s, a) => s + (a.hours_worked || 0), 0)

    // v2.27.0 — مجموع الجزاءات بالأيام من الحضور (لا تُخصم من أيام الحضور)
    const penaltyDays = att.reduce((s, a) => s + (a.penalty_days || 0), 0)
    // مجموع مكافآت الشهر (قروش) — لا تؤثر على أيام الحضور، تُضاف مباشرة للراتب المستحق
    const bonusAmount = att.reduce((s, a) => s + (a.bonus_amount || 0), 0)

    const dailyWage  = Math.round(emp.monthlySalary / 30)
    const totalHours = totalMinutes / 60
    const wageByHours = Math.round(totalHours * emp.hourlyRate)
    const wageByDays  = presentDays * dailyWage

    // قيم الجزاء بالعملتين:
    // باليوم: عدد أيام الجزاء × أجر اليوم
    // بالساعة: عدد أيام الجزاء × ساعات العمل اليومية × أجر الساعة
    const workHoursPerDay = emp.workHours / 100   // workHours مضروبة ×100
    const penaltyByDays   = Math.round(penaltyDays * dailyWage)
    const penaltyByHours  = Math.round(penaltyDays * workHoursPerDay * emp.hourlyRate)

    // دالة لجمع بنود اليومية للموظف حسب التصنيف الفرعي (السلف فقط)
    // v2.33.0 — "أجور" دُمجت تصنيفات فرعية جوه "مصروفات"، فبقينا نتحقّق بالتصنيف الفرعي بدل الرئيسي
    const sumByCategory = (subCatName: string): number => {
      const row = db.prepare(`
        SELECT COALESCE(SUM(t.amount_out), 0) AS total
        FROM transactions t
        JOIN shifts s ON s.id = t.shift_id
        LEFT JOIN sub_categories sc ON sc.id = t.sub_category_id
        WHERE t.employee_id = ? AND sc.name = ? AND s.date LIKE ?
      `).get(emp.id, subCatName, `${month}%`) as { total: number }
      return row.total
    }

    const advances = sumByCategory('سلفة موظف')     // السلف فقط (الجزاءات صارت من الحضور)

    return {
      employeeId:    emp.id,
      name:          emp.name,
      monthlySalary: emp.monthlySalary,
      dailyWage,
      hourlyRate:    emp.hourlyRate,
      workHours:     emp.workHours,
      presentDays,
      absentDays,
      totalMinutes,
      wageByHours,
      wageByDays,
      advances,
      penalties:     penaltyByDays,   // alias للتوافق
      penaltyDays,
      penaltyByDays,
      penaltyByHours,
      bonusAmount,
      netByHours:    wageByHours - advances,
      netByDays:     wageByDays  - advances,
      dueSalary:     wageByDays  - advances - penaltyByDays + bonusAmount,
    } as EmployeeFinancials
  })
}

// ═══ اليومية المستوردة هي المرجع الأساسي لسلف الموظفين — بوابة إلزامية في "إدارة الموظفين" ═══
// كل بند "مصروفات ← سلفة موظف" بلا employee_id يعني اسمًا لسه ملوش موظف مسجَّل. بمجرد التسجيل تُربط
// كل بنوده القديمة بأثر رجعي تلقائيًا (بغضّ النظر عن الشهر أو تاريخ الاستيراد) — لا إدخال يدوي مكرَّر أبداً.

function salaryAdvanceSubCategoryId(db: Database.Database): number | null {
  const row = db.prepare(`
    SELECT sc.id FROM sub_categories sc JOIN main_categories mc ON mc.id = sc.main_category_id
    WHERE sc.name = 'سلفة موظف' AND mc.name = 'مصروفات'
  `).get() as { id: number } | undefined
  return row ? row.id : null
}

export interface UnlinkedAdvanceName {
  normName: string
  rawName: string
  count: number
  totalAmountPiastres: number
  suggestedEmployeeId: number | null
  suggestedName: string | null
  suggestedScore: number   // 0..1
}

// كل الأسماء الظاهرة في بنود "سلفة موظف" المستوردة ولسه مالهاش موظف مربوط — لعرضها في بوابة التسجيل الإلزامية
export function getUnlinkedAdvanceNames(db: Database.Database): UnlinkedAdvanceName[] {
  const advanceSubId = salaryAdvanceSubCategoryId(db)
  if (advanceSubId === null) return []

  const rows = db.prepare(`
    SELECT description, amount_out AS amountOut
    FROM transactions WHERE sub_category_id = ? AND employee_id IS NULL
  `).all(advanceSubId) as { description: string; amountOut: number }[]

  const map = new Map<string, UnlinkedAdvanceName>()
  for (const r of rows) {
    const normName = normalizeValue(r.description)
    if (!normName) continue
    const existing = map.get(normName)
    if (existing) { existing.count++; existing.totalAmountPiastres += r.amountOut }
    else map.set(normName, {
      normName, rawName: r.description, count: 1, totalAmountPiastres: r.amountOut,
      suggestedEmployeeId: null, suggestedName: null, suggestedScore: 0,
    })
  }
  if (map.size === 0) return []

  // اقتراح تلقائي بأقرب موظف موجود بالاسم (يدعم حرف ناقص/تشكيل متبقٍ) — يبقى قابلاً للتعديل يدوياً في الشاشة
  const employees = getAllEmployees(db)
  const empCandidates = employees.map(e => ({ key: normalizeValue(e.name), id: e.id, name: e.name }))
  const THRESHOLD = 0.7
  for (const c of Array.from(map.values())) {
    let best: { id: number; name: string; score: number } | null = null
    for (const emp of empCandidates) {
      const score = similarity(c.normName, emp.key)
      if (!best || score > best.score) best = { id: emp.id, name: emp.name, score }
    }
    if (best && best.score >= THRESHOLD) {
      c.suggestedEmployeeId = best.id
      c.suggestedName = best.name
      c.suggestedScore = best.score
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}

function daysInMonth(monthStr: string): number {
  const [y, m] = monthStr.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

// يوم واحد بعدد ساعات محدَّد (بداية عامة 09:00) — لا يستبدل أي سجل موجود (يدوي أو مستقبلي)
function fillAttendanceDay(db: Database.Database, employeeId: number, date: string, workHoursHundredths: number): void {
  const totalMin = Math.round(((workHoursHundredths || 800) / 100) * 60)
  const outMin = (9 * 60 + totalMin) % (24 * 60)
  const checkOut = `${String(Math.floor(outMin / 60)).padStart(2, '0')}:${String(outMin % 60).padStart(2, '0')}`
  db.prepare(`
    INSERT OR IGNORE INTO attendance (employee_id, date, status, check_in, check_out, hours_worked)
    VALUES (?, ?, 'present', '09:00', ?, ?)
  `).run(employeeId, date, checkOut, totalMin)
}

// بطلب العميل — يملأ الشهر كاملاً (اليوم 1 حتى آخر يوم فيه أو اليوم الحالي أيهما أقرب) بعدد الساعات الافتراضي
// المُدخَل عند تسجيل الموظف، اعتباراً بأنه عمل طوال الشهر ما لم يوجد سجل حضور فعلي يقول غير ذلك.
function fillAttendanceForMonth(db: Database.Database, employeeId: number, monthStr: string, workHoursHundredths: number): void {
  const todayStr = new Date().toISOString().slice(0, 10)
  const lastDay = daysInMonth(monthStr)
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`
    if (dateStr > todayStr) break
    fillAttendanceDay(db, employeeId, dateStr, workHoursHundredths)
  }
}

// يربط كل بنود "سلفة موظف" غير المربوطة بنفس الاسم المطبَّع بموظف محدَّد بأثر رجعي، ويملأ حضور كل الأشهر المتأثرة تلقائياً
export function linkAdvancesToEmployee(
  db: Database.Database, employeeId: number, normName: string,
): { linkedCount: number; monthsFilled: string[] } {
  const advanceSubId = salaryAdvanceSubCategoryId(db)
  if (advanceSubId === null) return { linkedCount: 0, monthsFilled: [] }

  const rows = db.prepare(`
    SELECT t.id AS txId, t.description AS description, s.date AS date
    FROM transactions t JOIN shifts s ON s.id = t.shift_id
    WHERE t.sub_category_id = ? AND t.employee_id IS NULL
  `).all(advanceSubId) as { txId: number; description: string; date: string }[]

  const matched = rows.filter(r => normalizeValue(r.description) === normName)
  if (matched.length === 0) return { linkedCount: 0, monthsFilled: [] }

  const upd = db.prepare(`UPDATE transactions SET employee_id = ? WHERE id = ?`)
  const months = new Set<string>()
  for (const m of matched) { upd.run(employeeId, m.txId); months.add(m.date.slice(0, 7)) }

  const emp = getEmployeeById(db, employeeId)
  const workHours = emp?.workHours ?? 800
  for (const month of Array.from(months)) fillAttendanceForMonth(db, employeeId, month, workHours)

  // يُحفَظ لربط تلقائي فوري لأي استيراد مستقبلي بنفس الاسم — بلا حاجة لإعادة المرور على هذه البوابة
  db.prepare(`
    INSERT INTO import_employee_map (excel_name, employee_id) VALUES (?, ?)
    ON CONFLICT(excel_name) DO UPDATE SET employee_id=excluded.employee_id
  `).run(normName, employeeId)

  return { linkedCount: matched.length, monthsFilled: Array.from(months).sort() }
}

// إنشاء موظف جديد (أو استخدام موظف موجود) + ربط سلفه المستوردة فوراً — استدعاء واحد من بوابة التسجيل الإلزامية
export function registerFromAdvance(
  db: Database.Database,
  data: {
    normName: string
    employeeId?: number   // موظف موجود بالفعل — يُربط مباشرة بلا إنشاء
    newEmployee?: { name: string; nationalId: string; phone: string; monthlySalary: number; workHours: number; startDate: string; status: string }
  },
): { employeeId: number; linkedCount: number; monthsFilled: string[] } {
  const employeeId = data.employeeId ?? (() => {
    if (!data.newEmployee) throw new Error('يجب اختيار موظف موجود أو إدخال بيانات موظف جديد')
    return createEmployee(db, { ...data.newEmployee, endDate: null })
  })()
  const { linkedCount, monthsFilled } = linkAdvancesToEmployee(db, employeeId, data.normName)
  return { employeeId, linkedCount, monthsFilled }
}
