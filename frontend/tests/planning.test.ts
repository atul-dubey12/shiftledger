import assert from 'node:assert/strict';
import { maintenanceStatus, monthlyReport } from '../src/app/planning';
import type { MaintenanceItem, SyncedPayout } from '../src/app/planning.service';
import { LedgerEntry } from '../src/app/entry.model';
const task: MaintenanceItem = { id: 'a', title: 'Oil', kind: 'OIL', dueDate: '2026-12-20', dueKm: 12000, estimatedCost: 500, completedOn: null, actualCost: null, version: 1 };
assert.equal(maintenanceStatus(task, 12000, '2026-11-15').label, 'Due now / overdue');
assert.equal(maintenanceStatus(task, 11600, '2026-11-15').label, 'Due soon');
assert.equal(maintenanceStatus({ ...task, dueDate: '2026-11-15' }, 0, '2026-11-15').label, 'Due now / overdue');
assert.equal(maintenanceStatus({ ...task, completedOn: '2026-11-14' }, 13000, '2026-11-15').label, 'Completed');
assert.equal(maintenanceStatus(task, null, '2026-11-15').label, 'Set odometer to check mileage');
const e = (id: number, date: string, type: LedgerEntry['type'], amount: number): LedgerEntry => ({ id, date, type, amount, category: type === 'EXPENSE' ? 'FUEL' : null, note: null, orderCount: null, hoursWorked: null, distanceKm: null });
const payouts: SyncedPayout[] = [
  { weekStart: '2026-10-26', amount: 900, date: '2026-11-02', version: 1 },
  { weekStart: '2026-11-23', amount: 1200, date: '2026-11-30', version: 1 },
  { weekStart: '2026-11-30', amount: 1500, date: '2026-12-07', version: 1 },
];
const report = monthlyReport([
  e(1, '2026-10-31', 'INCOME', 500), e(2, '2026-11-01', 'INCOME', 300),
  e(3, '2026-11-30', 'INCOME', 700), e(4, '2026-12-01', 'INCOME', 2000),
  e(5, '2026-11-15', 'EXPENSE', 100), e(6, '2026-11-15', 'COD_SETTLEMENT', 500),
], payouts, '2026-11', new Date(2026, 11, 10));
assert.equal(report.totals.income, 1000);
assert.equal(report.totals.net, 900);
assert.equal(report.bankTotal, 2100, 'Bank totals use received date, not work week');
assert.equal(report.weeks.reduce((n, w) => n + w.totals.income, 0), 1000, 'Split weeks never include adjacent-month earnings');
assert.equal(report.missingPayouts, 1);
assert.equal(report.inProgress, false);
assert.equal(monthlyReport([], [], '2024-02', new Date(2024,2,1)).end.getDate(), 29);
console.log('Passed: due thresholds, unknown odometer, completed reminders, cross-month weeks, bank receipt dates, surplus and leap years.');
