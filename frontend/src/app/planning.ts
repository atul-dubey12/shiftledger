import { LedgerEntry } from './entry.model';
import { addDays, inRange, isoDate, parseDate, startOfWeek, totals } from './ledger';
import { MaintenanceItem, SyncedPayout } from './planning.service';

export function maintenanceStatus(task: MaintenanceItem, odometer: number | null, today: string) {
  if (task.completedOn) return { label: 'Completed', urgent: false };
  const days = task.dueDate ? Math.round((Date.parse(task.dueDate) - Date.parse(today)) / 86400000) : null;
  const km = task.dueKm !== null && odometer !== null ? task.dueKm - odometer : null;
  if ((days !== null && days <= 0) || (km !== null && km <= 0)) return { label: 'Due now / overdue', urgent: true };
  if ((days !== null && days <= 30) || (km !== null && km <= 500)) return { label: 'Due soon', urgent: true };
  return { label: task.dueKm !== null && odometer === null ? 'Set odometer to check mileage' : 'Upcoming', urgent: false };
}

export function monthlyReport(entries: LedgerEntry[], payouts: SyncedPayout[], month: string, now = new Date()) {
  const start = parseDate(`${month}-01`);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const items = inRange(entries, { start, end });
  const received = payouts.filter(p => p.date >= isoDate(start) && p.date < isoDate(end));
  const weeks = [];
  for (let week = startOfWeek(start); week < end; week = addDays(week, 7)) {
    const next = addDays(week, 7);
    const clipped = inRange(items, { start: week, end: next });
    weeks.push({ start: isoDate(week), end: isoDate(addDays(next, -1)), totals: totals(clipped),
      payout: payouts.find(p => p.weekStart === isoDate(week)) ?? null, completed: next <= now, hasEntries: clipped.length > 0 });
  }
  return { start, end: addDays(end, -1), items, received, weeks, totals: totals(items),
    bankTotal: received.reduce((sum, p) => sum + p.amount, 0),
    missingPayouts: weeks.filter(w => w.completed && w.hasEntries && !w.payout).length,
    inProgress: now < end };
}
