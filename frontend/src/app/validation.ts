import { EntryDraft } from './entry.model';
import { addDays, isoDate } from './ledger';

const outside = (v: number | null | undefined, max: number) => v != null && (v < 0 || v > max);
const positive = (v: number | null | undefined) => v != null && v > 0;

/** Same rules and messages as EntryController.validate. */
export function validate(d: EntryDraft): string | null {
  if (!d.type || d.amount == null || !d.date) return 'Type, amount, and date are required.';
  // A COD order whose payout isn't known yet, or an end-of-shift entry that only records hours, may carry ₹0.
  const zeroAllowed = d.type === 'INCOME' && (positive(d.codAmount) || positive(d.hoursWorked));
  if (d.amount < 0 || (d.amount === 0 && !zeroAllowed)) return 'Enter an amount greater than ₹0.';
  if (d.amount >= 10_000_000) return 'Amount is too large.';
  if (d.date > isoDate(addDays(new Date(), 1))) return 'Date cannot be in the future.';
  const hasShiftDetails = d.orderCount != null || d.hoursWorked != null || d.distanceKm != null;
  if (d.type === 'INCOME') {
    if (d.category) return 'Income entries do not have an expense category.';
    if (d.paidFrom) return 'Only expenses can be paid from COD cash.';
  } else if (d.type === 'EXPENSE') {
    if (!d.category) return 'Choose an expense category.';
    if (hasShiftDetails) return 'Orders, hours and distance belong on shift earnings.';
    if (d.codAmount != null) return 'COD cash is recorded on orders, not expenses.';
  } else {
    if (!d.settlementMethod) return 'Choose how the COD cash was settled.';
    if (d.category || hasShiftDetails || d.codAmount != null || d.paidFrom) return 'A COD settlement only has an amount, date, method and note.';
  }
  if (d.type !== 'COD_SETTLEMENT' && d.settlementMethod) return 'Settlement method only applies to COD settlements.';
  if (d.codAmount != null && (d.codAmount < 0 || d.codAmount >= 100_000)) return 'COD cash must be between ₹0 and ₹1,00,000.';
  if (outside(d.orderCount, 500)) return 'Orders must be between 0 and 500.';
  if (outside(d.hoursWorked, 24)) return 'Hours must be between 0 and 24.';
  if (outside(d.distanceKm, 2000)) return 'Distance must be between 0 and 2000 km.';
  return null;
}
