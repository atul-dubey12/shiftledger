import assert from 'node:assert/strict';
import { previousWeek, validPayout, weeklySummary } from '../src/app/weekly-summary';
import { isoDate } from '../src/app/ledger';
import { LedgerEntry } from '../src/app/entry.model';
const week = previousWeek(new Date(2026, 10, 16));
assert.equal(isoDate(week.start), '2026-11-09');
assert.equal(isoDate(week.end), '2026-11-16');
assert.equal(isoDate(previousWeek(new Date(2026, 10, 15)).start), '2026-11-02');
assert.equal(isoDate(previousWeek(new Date(2026, 0, 5)).start), '2025-12-29');
const entry = (id: number, date: string, type: LedgerEntry['type'], amount: number): LedgerEntry => ({ id, date, type, amount, category: type === 'EXPENSE' ? 'FUEL' : null, note: null, orderCount: null, hoursWorked: null, distanceKm: null });
const result = weeklySummary([
  entry(1, '2026-11-09', 'INCOME', 1000), entry(2, '2026-11-15', 'EXPENSE', 200),
  entry(3, '2026-11-16', 'INCOME', 500), entry(4, '2026-11-08', 'EXPENSE', 100),
  entry(5, '2026-11-15', 'COD_SETTLEMENT', 300),
], week.start);
assert.equal(result.totals.income, 1000);
assert.equal(result.totals.expenses, 200);
assert.equal(result.totals.net, 800);
assert.equal(result.expenses.length, 1);
assert.equal(result.categories[0].amount, 200);
assert.equal(result.payday, '2026-11-16');
assert.ok(validPayout(0, '2026-11-16', result.payday));
assert.ok(validPayout(850.25, '2026-11-17', result.payday));
for (const amount of [null, '', -1, NaN, Infinity, 12.345]) assert.ok(!validPayout(amount, result.payday, result.payday));
assert.ok(!validPayout(100, '2026-11-15', result.payday));
assert.ok(!validPayout(100, '2026-02-30', '2026-02-01'));
console.log('Weekly summary: date boundaries, totals, COD exclusion, and payout validation passed.');
