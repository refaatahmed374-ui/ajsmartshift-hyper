import { create } from 'zustand'
import type { Shift, Journal, Transaction, ShiftFawry, ShiftCustody, MainCategory, SubCategory } from '../../core/types'
import { api, call } from '../lib/api'

interface ShiftState {
  activeShift:   Shift | null
  journal:       Journal | null
  transactions:  Transaction[]
  fawry:         ShiftFawry | null
  custody:       ShiftCustody | null
  mainCats:      MainCategory[]
  subCats:       SubCategory[]
  loading:       boolean

  loadActiveShift:   () => Promise<void>
  loadTransactions:  (shiftId: number) => Promise<void>
  loadFawry:         (shiftId: number) => Promise<void>
  loadCustody:       (shiftId: number) => Promise<void>
  loadCategories:    () => Promise<void>
  addTransaction:    (data: Parameters<typeof api.tx.add>[0]) => Promise<Transaction>
  addTransactionsBatch: (items: Parameters<typeof api.tx.add>[0][]) => Promise<Transaction[]>
  updateTransaction: (id: number, data: Parameters<typeof api.tx.update>[1]) => Promise<void>
  deleteTransaction: (id: number) => Promise<void>
  updateFawry:       (shiftId: number, data: Parameters<typeof api.fawry.update>[1]) => Promise<void>
  updateCustody:     (shiftId: number, data: Parameters<typeof api.custody.update>[1]) => Promise<void>
  refreshAll:        (shiftId: number) => Promise<void>
  clear:             () => void
}

export const useShift = create<ShiftState>((set, get) => ({
  activeShift:  null,
  journal:      null,
  transactions: [],
  fawry:        null,
  custody:      null,
  mainCats:     [],
  subCats:      [],
  loading:      false,

  loadActiveShift: async () => {
    set({ loading: true })
    try {
      const shift = await call(api.shifts.getActive())
      if (!shift) { set({ activeShift: null, journal: null, loading: false }); return }
      const journal = await call(api.journal.getByShift(shift.id))
      set({ activeShift: shift, journal, loading: false })
      await get().refreshAll(shift.id)
    } catch { set({ loading: false }) }
  },

  loadTransactions: async (shiftId) => {
    const txs = await call(api.tx.getByShift(shiftId))
    set({ transactions: txs })
  },

  loadFawry: async (shiftId) => {
    const f = await call(api.fawry.get(shiftId))
    set({ fawry: f })
  },

  loadCustody: async (shiftId) => {
    const c = await call(api.custody.get(shiftId))
    set({ custody: c })
  },

  loadCategories: async () => {
    const [mainCats, subCats] = await Promise.all([
      call(api.cats.getMain()),
      call(api.cats.getSub()),
    ])
    set({ mainCats, subCats })
  },

  addTransaction: async (data) => {
    const tx = await call(api.tx.add(data))
    set(s => ({ transactions: [...s.transactions, tx] }))
    return tx
  },

  addTransactionsBatch: async (items) => {
    if (items.length === 0) return []
    const txs = await call(api.tx.addBatch(items)) as Transaction[]
    set(s => ({ transactions: [...s.transactions, ...txs] }))
    return txs
  },

  updateTransaction: async (id, data) => {
    await call(api.tx.update(id, data))
    // إعادة جلب البنود لضمان تحديث أسماء التصنيفات
    const shiftId = get().activeShift?.id
    if (shiftId) await get().loadTransactions(shiftId)
  },

  deleteTransaction: async (id) => {
    await call(api.tx.delete(id))
    set(s => ({ transactions: s.transactions.filter(t => t.id !== id) }))
  },

  updateFawry: async (shiftId, data) => {
    await call(api.fawry.update(shiftId, data))
    await get().loadFawry(shiftId)
  },

  updateCustody: async (shiftId, data) => {
    await call(api.custody.update(shiftId, data))
    await get().loadCustody(shiftId)
  },

  refreshAll: async (shiftId) => {
    const [, , , shift] = await Promise.all([
      get().loadTransactions(shiftId),
      get().loadFawry(shiftId),
      get().loadCustody(shiftId),
      call(api.shifts.getById(shiftId)),
    ])
    // الشيفت لم يعد مفتوحاً (اعتماد/تغيير حالة) — لم يعد "الشيفت النشط"، فتُفرَغ حتى تظهر شاشة "لا يوجد شيفت مفتوح"
    // (بدون هذا كانت شاشة العمليات اليومية تفضل عارضة نفس الشيفت المعتمَد من غير أي تحديث بعد الضغط على "اعتماد الشيفت")
    set({ activeShift: shift && shift.status === 'open' ? shift : null })
  },

  clear: () => set({
    activeShift: null, journal: null, transactions: [],
    fawry: null, custody: null,
  }),
}))
