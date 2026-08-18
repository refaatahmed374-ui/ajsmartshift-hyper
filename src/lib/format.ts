// دوال التنسيق المستخدمة في الواجهة
import { localISO } from '../../core/date'

export function fmt(pias: number): string {
  return (pias / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function fmtShort(pias: number): string {
  const v = pias / 100
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(v) >= 1_000)     return (v / 1_000).toFixed(1)     + 'K'
  return v.toFixed(2)
}

export function parsePias(input: string): number {
  const n = parseFloat(input.replace(/,/g, ''))
  return isNaN(n) ? 0 : Math.round(n * 100)
}

// تاريخ اليوم بالتقويم المحلي — كان `toISOString()` (وهو UTC) فيرجع تاريخ الأمس
// لأي عملية بين منتصف الليل والفجر بتوقيت مصر (UTC+2/+3).
export function todayISO(): string {
  return localISO()
}

export function nowTime(): string {
  return new Date().toTimeString().slice(0, 5)
}

export function monthKey(date: string): string {
  return date.slice(0, 7)  // YYYY-MM
}

export function fmtDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function fmtDateTime(iso: string): string {
  if (!iso) return ''
  const dt = new Date(iso)
  return dt.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })
}

export function shiftTypeLabel(t: string): string {
  return { morning: 'صباحي', evening: 'مسائي', between: 'بيتوين' }[t] ?? t
}

export function statusLabel(s: string): string {
  return { open: 'مفتوح', review: 'مراجعة', approved: 'معتمد' }[s] ?? s
}

export function roleLabel(r: string): string {
  return ({
    manager: 'مدير النظام', branch_manager: 'مدير الفرع', accountant: 'المحاسب',
    supervisor: 'مشرف', cashier: 'كاشير',
  } as Record<string, string>)[r] ?? r
}

export function payMethodLabel(p: string): string {
  return ({ cashier: 'كاشير', management: 'الصندوق' } as Record<string, string>)[p] ?? p
}
