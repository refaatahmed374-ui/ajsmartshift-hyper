// طبقة التواصل مع الـ main process — كل الاستدعاءات تمر من هنا
import type { Api } from '../../electron/preload'

declare global {
  interface Window { api: Api }
}

export const api = window.api

// مساعد: انتزع البيانات أو ارمِ خطأ
export async function call<T>(promise: Promise<{ ok: boolean; data?: T; error?: string }>): Promise<T> {
  const res = await promise
  if (!res.ok) throw new Error(res.error ?? 'خطأ غير معروف')
  return res.data as T
}
