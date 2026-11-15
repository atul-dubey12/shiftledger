import { LedgerEntry } from './entry.model';
import { addDays, CATEGORIES, inRange, isoDate, startOfWeek, totals } from './ledger';

export interface WeeklyPayout { amount: number; date: string; }
export function previousWeek(now: Date) {
  const end = startOfWeek(now);
  return { start: addDays(end, -7), end };
}
export function weeklySummary(entries: LedgerEntry[], start: Date) {
  const end = addDays(start, 7);
  const items = inRange(entries, { start, end }).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const expenses = items.filter(e => e.type === 'EXPENSE');
  return {
    key: isoDate(start), start, end: addDays(end, -1), payday: isoDate(end), items, expenses,
    totals: totals(items),
    categories: CATEGORIES.map(c => ({ ...c, amount: expenses.filter(e => e.category === c.key).reduce((n, e) => n + e.amount, 0) })).filter(c => c.amount > 0),
  };
}
export function validPayout(amount: unknown, date: string, payday: string): boolean {
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= 999999999 &&
    Math.abs(amount * 100 - Math.round(amount * 100)) < 0.00001 && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date && date >= payday;
}
