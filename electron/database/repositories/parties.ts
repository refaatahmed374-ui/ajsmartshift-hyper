import type Database from 'better-sqlite3'

export type PartyType = 'customer' | 'supplier'

export interface Party {
  id: number
  name: string
  phone: string
  address: string
  notes: string
  openingBalance: number
  loyaltyPoints?: number
  active: number
  balance: number      // الرصيد الحالي محسوب (افتتاحي + مدين − دائن)
}

export interface LedgerEntry {
  id: number
  partyType: PartyType
  partyId: number
  date: string
  description: string
  debit: number
  credit: number
  balance?: number     // رصيد متراكم
  transactionId?: number | null   // البند الذي وَلَّد هذا القيد (null = قيد يدوي)
}

function table(type: PartyType): string {
  return type === 'customer' ? 'customers' : 'suppliers'
}

// رصيد طرف = افتتاحي + Σ(مدين) − Σ(دائن)
function partyBalance(db: Database.Database, type: PartyType, id: number, opening: number): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM party_ledger WHERE party_type=? AND party_id=?`
  ).get(type, id) as { d: number; c: number }
  return opening + row.d - row.c
}

export function getParties(db: Database.Database, type: PartyType): Party[] {
  const rows = db.prepare(`SELECT * FROM ${table(type)} ORDER BY name`).all() as Record<string, unknown>[]
  return rows.map(r => {
    const id = r.id as number
    const opening = (r.opening_balance as number) ?? 0
    return {
      id, name: r.name as string, phone: r.phone as string, address: r.address as string,
      notes: r.notes as string, openingBalance: opening,
      loyaltyPoints: (r.loyalty_points as number) ?? 0,
      active: r.active as number,
      balance: partyBalance(db, type, id, opening),
    }
  })
}

export function createParty(
  db: Database.Database, type: PartyType,
  data: { name: string; phone: string; address: string; notes: string; openingBalance: number }
): number {
  const t = table(type)
  const res = db.prepare(
    `INSERT INTO ${t} (name, phone, address, notes, opening_balance) VALUES (?, ?, ?, ?, ?)`
  ).run(data.name.trim(), data.phone, data.address, data.notes, data.openingBalance)
  return res.lastInsertRowid as number
}

export function updateParty(
  db: Database.Database, type: PartyType, id: number,
  data: { name?: string; phone?: string; address?: string; notes?: string; openingBalance?: number; active?: number }
): void {
  const t = table(type)
  const sets: string[] = []; const vals: unknown[] = []
  const map: Record<string, string> = { name: 'name', phone: 'phone', address: 'address', notes: 'notes', openingBalance: 'opening_balance', active: 'active' }
  for (const [k, col] of Object.entries(map)) {
    const v = (data as Record<string, unknown>)[k]
    if (v !== undefined) { sets.push(`${col}=?`); vals.push(v) }
  }
  if (!sets.length) return
  db.prepare(`UPDATE ${t} SET ${sets.join(',')} WHERE id=?`).run(...vals, id)
}

export function deleteParty(db: Database.Database, type: PartyType, id: number): { ok: boolean; reason?: string } {
  const ledgerCount = (db.prepare(
    `SELECT COUNT(*) AS c FROM party_ledger WHERE party_type=? AND party_id=?`
  ).get(type, id) as { c: number }).c
  if (ledgerCount > 0) return { ok: false, reason: `لا يمكن الحذف — يوجد ${ledgerCount} حركة في كشف الحساب` }
  db.prepare(`DELETE FROM ${table(type)} WHERE id=?`).run(id)
  return { ok: true }
}

// ===== كشف الحساب =====
export function getLedger(db: Database.Database, type: PartyType, partyId: number): LedgerEntry[] {
  const opening = (db.prepare(`SELECT opening_balance AS o FROM ${table(type)} WHERE id=?`).get(partyId) as { o: number } | undefined)?.o ?? 0
  const rows = db.prepare(
    `SELECT * FROM party_ledger WHERE party_type=? AND party_id=? ORDER BY date ASC, id ASC`
  ).all(type, partyId) as Record<string, unknown>[]
  let bal = opening
  return rows.map(r => {
    const debit = r.debit as number, credit = r.credit as number
    bal += debit - credit
    return {
      id: r.id as number, partyType: type, partyId,
      date: r.date as string, description: r.description as string,
      debit, credit, balance: bal,
      transactionId: (r.transaction_id as number | null) ?? null,
    }
  })
}

export function addLedgerEntry(
  db: Database.Database,
  data: { partyType: PartyType; partyId: number; date: string; description: string; debit: number; credit: number
          transactionId?: number | null },
): number {
  const res = db.prepare(`
    INSERT INTO party_ledger (party_type, party_id, date, description, debit, credit, transaction_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(data.partyType, data.partyId, data.date, data.description, data.debit, data.credit,
         data.transactionId ?? null)
  return res.lastInsertRowid as number
}

// حذف كل قيود كشف الحساب المولَّدة من بند يومية معيّن — يُستدعى عند حذف البند أو قبل إعادة توليده
export function deleteLedgerEntriesByTransaction(db: Database.Database, transactionId: number): void {
  db.prepare(`DELETE FROM party_ledger WHERE transaction_id = ?`).run(transactionId)
}

// حذف قيود كشف الحساب المولَّدة من كل بنود شيفت معيّن — يُستدعى عند حذف الشيفت بالكامل
export function deleteLedgerEntriesByShift(db: Database.Database, shiftId: number): void {
  db.prepare(`
    DELETE FROM party_ledger WHERE transaction_id IN (SELECT id FROM transactions WHERE shift_id = ?)
  `).run(shiftId)
}

export function deleteLedgerEntry(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM party_ledger WHERE id=?`).run(id)
}

// ===== نقاط الولاء (للعملاء) =====
export function addLoyaltyPoints(db: Database.Database, customerId: number, points: number): void {
  db.prepare(`UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id=?`).run(points, customerId)
}
