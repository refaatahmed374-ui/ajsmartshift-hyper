import type Database from 'better-sqlite3'
import type { Employee, Attendance, AttendanceStatus, EmployeeFinancials } from '../../../core/types'

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
      `SELECT status, hours_worked, COALESCE(penalty_days, 0) AS penalty_days
       FROM attendance WHERE employee_id=? AND date LIKE ?`
    ).all(emp.id, `${month}%`) as { status: string; hours_worked: number; penalty_days: number }[]

    const presentRows = att.filter(a => a.status === 'present')
    const presentDays = presentRows.length
    const absentDays  = att.filter(a => a.status === 'absent').length
    const totalMinutes = presentRows.reduce((s, a) => s + (a.hours_worked || 0), 0)

    // v2.27.0 — مجموع الجزاءات بالأيام من الحضور (لا تُخصم من أيام الحضور)
    const penaltyDays = att.reduce((s, a) => s + (a.penalty_days || 0), 0)

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
      netByHours:    wageByHours - advances,
      netByDays:     wageByDays  - advances,
      dueSalary:     wageByDays  - advances - penaltyByDays,
    } as EmployeeFinancials
  })
}
