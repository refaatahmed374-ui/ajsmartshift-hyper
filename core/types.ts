// ===== الأنواع الأساسية =====
// كل المبالغ مخزّنة بالقروش (integer) — مثال: 12.50 جنيه = 1250

export type Role = 'manager' | 'branch_manager' | 'accountant' | 'supervisor' | 'cashier'

export const ROLE_LABELS: Record<Role, string> = {
  manager:        'مدير النظام',
  branch_manager: 'مدير الفرع',
  accountant:     'المحاسب',
  supervisor:     'مشرف',
  cashier:        'كاشير',
}

// ===== الصلاحيات =====
export type Permission =
  | 'sale.create'         // بيع
  | 'sale.return'         // مرتجعات
  | 'invoice.delete'      // حذف فاتورة
  | 'invoice.edit'        // تعديل فاتورة
  | 'profit.view'         // عرض الأرباح
  | 'shift.delete'        // حذف شيفت
  | 'shift.edit'          // تعديل شيفت
  | 'shift.approve'       // اعتماد شيفت
  | 'tx.delete'           // حذف بند من اليومية
  | 'report.export'       // تصدير التقارير
  | 'users.manage'        // إدارة المستخدمين
  | 'backup.manage'       // إدارة النسخ الاحتياطي
  | 'categories.manage'   // إدارة التصنيفات

export const ALL_PERMISSIONS: { key: Permission; label: string }[] = [
  { key: 'sale.create',       label: 'بيع'                 },
  { key: 'sale.return',       label: 'مرتجعات'             },
  { key: 'invoice.delete',    label: 'حذف فاتورة'          },
  { key: 'invoice.edit',      label: 'تعديل فاتورة'        },
  { key: 'profit.view',       label: 'عرض الأرباح'         },
  { key: 'shift.delete',      label: 'حذف شيفت'             },
  { key: 'shift.edit',        label: 'تعديل شيفت'           },
  { key: 'shift.approve',     label: 'اعتماد شيفت'          },
  { key: 'tx.delete',         label: 'حذف بند من اليومية'   },
  { key: 'report.export',     label: 'تصدير التقارير'       },
  { key: 'users.manage',      label: 'إدارة المستخدمين'     },
  { key: 'backup.manage',     label: 'إدارة النسخ الاحتياطي'},
  { key: 'categories.manage', label: 'إدارة التصنيفات'      },
]

// الصلاحيات الافتراضية حسب الدور
const ALL_KEYS = ALL_PERMISSIONS.map(p => p.key)
export const DEFAULT_PERMISSIONS: Record<Role, Permission[]> = {
  manager:        [...ALL_KEYS],
  branch_manager: ['sale.create','sale.return','invoice.edit','profit.view','shift.edit','shift.approve','tx.delete','report.export','categories.manage'],
  accountant:     ['profit.view','report.export','shift.approve'],
  supervisor:     ['sale.create','sale.return','shift.edit','shift.approve','report.export'],
  cashier:        ['sale.create','sale.return'],
}
export type ShiftType = 'morning' | 'evening' | 'between'
export type ShiftStatus = 'open' | 'review' | 'approved'
export type PayMethod = 'cashier' | 'management' | 'credit' | 'visa'
export type BalanceStatus = 'balanced' | 'deficit' | 'surplus'

// ===== المستخدمون =====
export interface User {
  id: number
  username: string
  displayName: string
  role: Role
  color: string
  active: boolean
  createdAt: string
}

// ===== الفروع =====
export interface Branch {
  id: number
  name: string
  address: string
  active: boolean
}

// ===== الموظفون =====
export interface Employee {
  id: number
  name: string
  nationalId: string
  phone: string
  hourlyRate: number     // قروش (مشتق: راتب اليوم ÷ ساعات العمل)
  monthlySalary: number  // الراتب الشهري — قروش
  workHours: number      // ساعات العمل اليومية ×100 (مثال: 8 ساعات = 800)
  startDate: string
  endDate: string | null
  status: 'active' | 'inactive'
}

// ===== الحضور بالتاريخ =====
export type AttendanceStatus = 'present' | 'absent' | 'leave'
export interface Attendance {
  id: number
  employeeId: number
  date: string           // YYYY-MM-DD
  status: AttendanceStatus
  checkIn: string | null
  checkOut: string | null
  hoursWorked: number    // دقائق
  penaltyDays: number    // v2.27.0 — جزاء بالأيام (0 / 0.5 / 1 / 3)
}

// ===== ملخص مالي شهري للموظف =====
export interface EmployeeFinancials {
  employeeId:    number
  name:          string
  monthlySalary: number   // قروش
  dailyWage:     number   // قروش = الشهري ÷ 30
  hourlyRate:    number   // قروش
  workHours:     number   // ساعات يومية ×100
  presentDays:   number   // أيام الحضور
  absentDays:    number   // أيام الغياب
  totalMinutes:  number   // إجمالي دقائق العمل الفعلية
  wageByHours:   number   // قروش = (إجمالي الساعات) × أجر الساعة
  wageByDays:    number   // قروش = أيام الحضور × أجر اليوم
  advances:      number   // قروش (سلف من اليومية)
  penalties:     number   // قروش — alias لـ penaltyByDays (للتوافق الخلفي)
  penaltyDays:   number   // v2.27.0 — مجموع الجزاءات بالأيام (من الحضور)
  penaltyByDays: number   // قروش = penaltyDays × dailyWage
  penaltyByHours:number   // قروش = penaltyDays × workHours × hourlyRate
  netByHours:    number   // قروش = wageByHours − advances
  netByDays:     number   // قروش = wageByDays − advances
  dueSalary:     number   // قروش = wageByDays − advances − penaltyByDays
}

// ===== الشيفتات =====
export interface Shift {
  id: number
  branchId: number
  monthlyShiftNum: number
  date: string
  type: ShiftType
  cashierUserId: number
  cashierName: string
  startTime: string
  endTime: string | null
  status: ShiftStatus
  openingBalance: number  // قروش
  closingBalance: number | null
  note: string
  createdBy: number
  approvedBy: number | null
  approvedAt: string | null
  // ===== بيانات الإغلاق =====
  posSales:           number   // مبيعات برنامج POS — يدوي — قروش
  cashierRemaining:   number   // نقدية متبقية مع الكاشير — يدوي — قروش
  cashierCollections: number   // تحصيلات الكاشير — تلقائي — قروش
  shiftExpenses:      number   // مصروفات الشيفت — تلقائي — قروش
}

// ===== اليوميات =====
export interface Journal {
  id: number
  shiftId: number
  journalNum: string
  status: ShiftStatus
  approvedBy: number | null
  approvedAt: string | null
  attachmentPath: string | null
}

// ===== بنود اليومية =====
export interface Transaction {
  id: number
  shiftId: number
  journalId: number
  time: string
  description: string
  mainCategoryId: number | null
  subCategoryId: number | null
  mainCategoryName: string
  subCategoryName: string
  amountIn: number    // قروش
  amountOut: number   // قروش
  payMethod: PayMethod
  employeeId: number | null
  customerId: number | null    // v2.27.0 — مرتبط بعميل (للدفع الآجل + التحصيلات)
  note: string
  createdBy: number
  createdAt: string
}

// ===== التصنيفات =====
export interface MainCategory {
  id: number
  name: string
  color: string
  sortOrder: number
}

export interface SubCategory {
  id: number
  mainCategoryId: number
  name: string
  sortOrder: number
}

// ===== التسميات الذكية =====
export interface SmartLabel {
  id: number
  pattern: string
  mainCategoryId: number
  subCategoryId: number | null
  usageCount: number
  lastUsed: string
}

// ===== بيانات فوري لكل شيفت =====
export interface ShiftFawry {
  id: number
  shiftId: number
  // أساسي
  basicReceive: number   // قروش
  basicDeliver: number
  // إير تايم
  airReceive: number
  airDeliver: number
  // كاش أوت
  cashoutReceive: number
  cashoutDeliver: number
  // تحويلات
  fawryToBasic: number
  fawryToAir: number
  cashoutToBasic: number
  cashoutToAir: number
  // مبيعات البرنامج (يدوي)
  programSales: number
  // العمليات
  firstVoucher: number
  lastVoucher: number
}

// ===== العهدة =====
export interface ShiftCustody {
  id: number
  shiftId: number
  addFromFund: number    // إضافة للعهدة من صندوق سابق
  managementPaid: number // إدارة/محسوب
}

// ===== الكاشير =====
export interface ShiftCashier {
  id: number
  shiftId: number
  totalPaid: number  // مجموع دفع الكاشير
}

// ===== حضور الموظفين =====
export interface EmployeeAttendance {
  id: number
  employeeId: number
  shiftId: number
  checkIn: string
  checkOut: string | null
  hoursWorked: number  // دقائق
}

// ===== سجل التعديلات =====
export interface AuditLog {
  id: number
  userId: number
  userName: string
  entityType: string
  entityId: number
  operation: string
  valueBefore: string
  valueAfter: string
  reason: string
  createdAt: string
}

// ===== إعدادات =====
export interface Setting {
  key: string
  value: string
}

// ===== نتائج محرك الحسابات =====
export interface FawryResult {
  basicSales: number       // مبيعات أساسي
  airSales: number         // مبيعات إير تايم
  cashoutSales: number     // مبيعات كاش أوت
  cashoutDiscount: number  // خصم كاش أوت (لما تسليم < استلام)
  cashoutAdd: number       // إضافة كاش أوت = مبيعات فيزا − 1.8%
  totalFawrySales: number  // إجمالي مبيعات فوري
  profitability: number    // الربحية = مبيعات البرنامج − مبيعات فوري
  operationsCount: number  // عدد العمليات = آخر بون − أول بون
}

export interface CustodyResult {
  remaining: number  // باقي العهدة = إضافة − (إدارة/محسوب)
}

export interface ShiftAnalysisResult {
  totalIn: number
  totalOut: number
  expectedCash: number
  actualCash: number
  difference: number
  status: BalanceStatus
}

export interface EmployeeMonthlyResult {
  employeeId: number
  name: string
  hoursWorked: number
  hourlyRate: number
  advances: number  // قروش
  grossSalary: number
  netSalary: number
}

// ===== التنبيهات =====
export interface Notification {
  id: number
  type: 'deficit' | 'surplus' | 'approval_pending' | 'info'
  title: string
  message: string
  shiftId: number | null
  isRead: number   // 0 | 1
  createdAt: string
}

// ===== نوع IPC (للتواصل بين main و renderer) =====
export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
