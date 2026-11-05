export type EntryType = 'INCOME' | 'EXPENSE' | 'COD_SETTLEMENT';
export type ExpenseCategory = 'FUEL' | 'FOOD' | 'BIKE_SERVICE' | 'PHONE_RECHARGE' | 'BIKE_EMI' | 'OTHER';
export type PaidFrom = 'OWN' | 'COD_CASH';
export type SettlementMethod = 'DEPOSITED' | 'DEDUCTED_FROM_PAYOUT';
export interface LedgerEntry {
  id: number;
  type: EntryType;
  category: ExpenseCategory | null;
  amount: number;
  date: string;
  note: string | null;
  orderCount: number | null;
  hoursWorked: number | null;
  distanceKm: number | null;
  /** Cash collected from the customer on a COD order. Owed to the platform — never earnings. */
  codAmount?: number | null;
  /** null (older entries) means OWN. */
  paidFrom?: PaidFrom | null;
  settlementMethod?: SettlementMethod | null;
}
export type EntryDraft = Omit<LedgerEntry, 'id'>;

/** A single delivery logged with Quick order, as opposed to a whole-shift entry. */
export const isQuickOrder = (e: LedgerEntry): boolean => e.type === 'INCOME' && e.orderCount === 1 && !e.note && !e.hoursWorked;
