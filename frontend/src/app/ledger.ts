import { ExpenseCategory, LedgerEntry } from './entry.model';

export type Period = 'day' | 'week' | 'month';
export interface DateRange { start: Date; end: Date; }

export interface CategoryMeta { key: ExpenseCategory; label: string; emoji: string; icon: string; }
export const CATEGORIES: CategoryMeta[] = [
  { key: 'FUEL', label: 'Fuel', emoji: '⛽', icon: 'Fuel' },
  { key: 'FOOD', label: 'Food on duty', emoji: '🍱', icon: 'Utensils' },
  { key: 'BIKE_SERVICE', label: 'Bike service', emoji: '🔧', icon: 'Wrench' },
  { key: 'PHONE_RECHARGE', label: 'Phone & data', emoji: '📱', icon: 'Smartphone' },
  { key: 'BIKE_EMI', label: 'Bike EMI / rent', emoji: '🏍️', icon: 'CreditCard' },
  { key: 'OTHER', label: 'Other', emoji: '✳', icon: 'CircleDollarSign' },
];
export const categoryMeta = (key: ExpenseCategory | null): CategoryMeta => CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1];

export const DEFAULT_AMOUNTS: Record<ExpenseCategory | 'INCOME', number[]> = {
  INCOME: [800, 1000, 1500], FUEL: [100, 200, 500], FOOD: [50, 100, 150],
  BIKE_SERVICE: [300, 500, 1000], PHONE_RECHARGE: [199, 299, 499], BIKE_EMI: [1500, 2500, 3500], OTHER: [50, 100, 200],
};

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseDate(iso: string): Date { return new Date(`${iso}T00:00:00`); }
export function addDays(d: Date, days: number): Date { const next = new Date(d); next.setDate(d.getDate() + days); return next; }
export function startOfDay(d: Date): Date { const next = new Date(d); next.setHours(0, 0, 0, 0); return next; }
export function startOfWeek(d: Date): Date { const day = startOfDay(d); return addDays(day, -((day.getDay() + 6) % 7)); }

/** Half-open [start, end) range for the period containing `anchor`. */
export function rangeFor(period: Period, anchor: Date): DateRange {
  if (period === 'day') { const start = startOfDay(anchor); return { start, end: addDays(start, 1) }; }
  if (period === 'week') { const start = startOfWeek(anchor); return { start, end: addDays(start, 7) }; }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  return { start, end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) };
}
export function shiftAnchor(period: Period, anchor: Date, step: number): Date {
  if (period === 'day') return addDays(anchor, step);
  if (period === 'week') return addDays(anchor, step * 7);
  return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
}
export function inRange(entries: LedgerEntry[], range: DateRange): LedgerEntry[] {
  return entries.filter((e) => { const d = parseDate(e.date); return d >= range.start && d < range.end; });
}

export interface Totals {
  income: number; expenses: number; net: number; shifts: number;
  orders: number; hours: number; km: number; fuel: number;
  /** Income from shifts that recorded hours / orders, so the rates aren't skewed by shifts missing those fields. */
  incomeWithHours: number; incomeWithOrders: number;
}
export function totals(entries: LedgerEntry[]): Totals {
  const t: Totals = { income: 0, expenses: 0, net: 0, shifts: 0, orders: 0, hours: 0, km: 0, fuel: 0, incomeWithHours: 0, incomeWithOrders: 0 };
  for (const e of entries) {
    if (e.type === 'INCOME') {
      t.income += e.amount; t.shifts++;
      if (e.hoursWorked) { t.hours += e.hoursWorked; t.incomeWithHours += e.amount; }
      if (e.orderCount) { t.orders += e.orderCount; t.incomeWithOrders += e.amount; }
      t.km += e.distanceKm ?? 0;
    } else {
      t.expenses += e.amount;
      if (e.category === 'FUEL') t.fuel += e.amount;
    }
  }
  t.net = t.income - t.expenses;
  return t;
}

/** Percent change, or null when there's no baseline to compare against. */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export interface DayBar { date: Date; iso: string; income: number; expenses: number; }
export function dailySeries(entries: LedgerEntry[], range: DateRange): DayBar[] {
  const days: DayBar[] = [];
  for (let d = new Date(range.start); d < range.end; d = addDays(d, 1)) days.push({ date: d, iso: isoDate(d), income: 0, expenses: 0 });
  const byIso = new Map(days.map((d) => [d.iso, d]));
  for (const e of entries) {
    const day = byIso.get(e.date);
    if (!day) continue;
    if (e.type === 'INCOME') day.income += e.amount; else day.expenses += e.amount;
  }
  return days;
}

/** Most-used amounts for a category (or income), falling back to sensible presets. */
export function suggestedAmounts(entries: LedgerEntry[], key: ExpenseCategory | 'INCOME'): number[] {
  const counts = new Map<number, number>();
  for (const e of entries) {
    if ((key === 'INCOME' ? e.type === 'INCOME' : e.category === key)) counts.set(e.amount, (counts.get(e.amount) ?? 0) + 1);
  }
  const used = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([amount]) => amount);
  return [...new Set([...used, ...DEFAULT_AMOUNTS[key]])].slice(0, 4).sort((a, b) => a - b);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Weekday with the highest average earnings across days actually worked (needs a few weeks of data). */
export function bestWeekday(entries: LedgerEntry[]): { day: string; average: number } | null {
  const perDate = new Map<string, number>();
  for (const e of entries) if (e.type === 'INCOME') perDate.set(e.date, (perDate.get(e.date) ?? 0) + e.amount);
  if (perDate.size < 8) return null;
  const sums = Array(7).fill(0); const counts = Array(7).fill(0);
  for (const [iso, amount] of perDate) { const wd = parseDate(iso).getDay(); sums[wd] += amount; counts[wd]++; }
  let best = -1;
  for (let i = 0; i < 7; i++) if (counts[i] >= 2 && (best < 0 || sums[i] / counts[i] > sums[best] / counts[best])) best = i;
  return best < 0 ? null : { day: WEEKDAYS[best], average: sums[best] / counts[best] };
}
