export type EntryType = 'INCOME' | 'EXPENSE';
export type ExpenseCategory = 'FUEL' | 'FOOD' | 'BIKE_SERVICE' | 'PHONE_RECHARGE' | 'BIKE_EMI' | 'OTHER';
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
}
export type EntryDraft = Omit<LedgerEntry, 'id'>;
