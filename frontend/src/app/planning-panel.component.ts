import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, effect, HostListener, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LedgerEntry } from './entry.model';
import { categoryMeta, isoDate } from './ledger';
import { MaintenanceItem, PlanningService } from './planning.service';
import { maintenanceStatus, monthlyReport } from './planning';

@Component({ selector: 'app-planning-panel', imports: [CurrencyPipe, DatePipe, FormsModule], templateUrl: './planning-panel.component.html' })
export class PlanningPanelComponent {
  readonly planning = inject(PlanningService);
  readonly entries = input.required<LedgerEntry[]>();
  readonly incomplete = input(false);
  readonly credential = input('');
  readonly today = signal(isoDate(new Date()));
  readonly month = signal(isoDate(new Date()).slice(0, 7));
  readonly report = computed(() => monthlyReport(this.entries(), this.planning.payouts(), this.month()));
  readonly busy = signal(false);
  readonly downloading = signal(false);
  readonly message = signal('');
  readonly form = signal<MaintenanceItem | null>(null);
  readonly pendingDelete = signal<string | null>(null);
  readonly odometer = signal<number | null>(null);
  private odoVersion = 0;
  readonly ordered = computed(() => [...this.planning.tasks()].sort((a,b) => Number(!!a.completedOn) - Number(!!b.completedOn) || Number(this.status(b).urgent) - Number(this.status(a).urgent) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')));
  readonly upcomingCost = computed(() => this.planning.tasks().filter(t => !t.completedOn).reduce((n,t) => n + (t.estimatedCost ?? 0), 0));
  readonly unpriced = computed(() => this.planning.tasks().filter(t => !t.completedOn && t.estimatedCost === null).length);
  constructor() {
    effect(() => { void this.planning.connect(this.credential()); this.form.set(null); this.message.set(''); });
    effect(() => { const bike = this.planning.bike(); this.odometer.set(bike.version ? bike.odometer : null); this.odoVersion = bike.version; });
  }
  @HostListener('window:focus') onFocus() { this.today.set(isoDate(new Date())); if (!this.busy() && !this.form()) void this.planning.refresh(); }
  status(task: MaintenanceItem) { return maintenanceStatus(task, this.planning.bike().version ? this.planning.bike().odometer : null, this.today()); }
  newTask() { this.form.set({ id: crypto.randomUUID(), title: '', kind: 'SERVICE', dueDate: null, dueKm: null, estimatedCost: null, completedOn: null, actualCost: null, version: 0 }); this.message.set(''); }
  edit(task: MaintenanceItem) { this.form.set({ ...task }); this.message.set(''); }
  complete(task: MaintenanceItem) { this.form.set({ ...task, completedOn: this.today() }); this.message.set('Review completion date and actual cost, then save.'); }
  async saveOdometer() {
    const value = this.odometer();
    if (value === null || !Number.isInteger(value) || value < 0 || value > 9999999) { this.message.set('Enter a whole odometer reading between 0 and 9999999.'); return; }
    await this.run(async () => { await this.planning.saveBike(value, this.odoVersion); this.message.set('Odometer saved.'); });
  }
  async saveTask() {
    const task = this.form(); if (!task) return;
    const value = { ...task, title: task.title.trim(), dueDate: task.dueDate || null, completedOn: task.completedOn || null };
    const money = (v: number | null) => v === null || (Number.isFinite(v) && v >= 0 && v <= 999999999 && Math.abs(v * 100 - Math.round(v * 100)) < 0.00001);
    if (!value.title || value.title.length > 120 || (!value.dueDate && value.dueKm === null) ||
      (value.dueKm !== null && (!Number.isInteger(value.dueKm) || value.dueKm < 0 || value.dueKm > 9999999)) ||
      !money(value.estimatedCost) || !money(value.actualCost) || (value.completedOn && value.completedOn > this.today()) || (!value.completedOn && value.actualCost !== null)) {
      this.message.set('Check the title, due date or whole kilometre reading, and costs. Actual costs need a completion date no later than today.'); return;
    }
    await this.run(async () => { await this.planning.saveTask(value); this.form.set(null); this.message.set('Maintenance saved. Record any payment as a ledger expense so it appears in your financial reports.'); });
  }
  async remove(task: MaintenanceItem) { await this.run(async () => { await this.planning.removeTask(task); this.pendingDelete.set(null); this.message.set('Maintenance item removed.'); }); }
  private async run(action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true); this.message.set('');
    try { await action(); } catch (err) { this.message.set(this.planning.describe(err)); } finally { this.busy.set(false); }
  }
  async download() {
    if (this.downloading()) return;
    this.downloading.set(true);
    try {
      const report = this.report();
      const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const lines = [
        `Month: ${this.month()}`, report.inProgress ? 'Month in progress — totals so far.' : 'Completed calendar month.',
        this.incomplete() || this.planning.stale() ? 'PROVISIONAL — cached or unsynced data. Refresh to confirm.' : 'Based on recorded ledger entries and saved payouts.', '',
        `Recorded earnings: ${money(report.totals.income)}`, `Work expenses: ${money(report.totals.expenses)}`,
        `Work surplus (earnings minus expenses): ${money(report.totals.net)}`,
        'Work surplus is potential savings before personal spending, taxes or other unrecorded costs; it is not a bank balance.',
        `Bank payouts received during this month: ${money(report.bankTotal)}`,
        `${report.missingPayouts} completed weeks with entries have no saved payout.`, '',
        'WEEKLY BREAKDOWN — earnings and expenses include ONLY dates in this month.',
        'Payouts below cover the whole work week and are not added to monthly earnings.',
        ...report.weeks.flatMap(w => [`${w.start} to ${w.end}${w.completed ? '' : ' (week in progress)'}`,
          `Earnings ${money(w.totals.income)} | Expenses ${money(w.totals.expenses)} | Surplus ${money(w.totals.net)}`,
          w.payout ? `Whole-week payout ${money(w.payout.amount)} received ${w.payout.date}` : 'Payout not entered.', '']),
        'BANK PAYOUTS RECEIVED THIS MONTH',
        ...report.received.map(p => `${p.date} | Week starting ${p.weekStart} | ${money(p.amount)}`),
        ...(report.received.length ? [] : ['No payouts recorded as received this month.']), '', 'ALL MONTHLY LEDGER ENTRIES',
        ...[...report.items].sort((a,b) => a.date.localeCompare(b.date) || a.id - b.id).flatMap(e => [
          `${e.date} | ${e.type === 'EXPENSE' ? categoryMeta(e.category).label : e.type === 'INCOME' ? 'Earnings' : 'COD settlement'} | ${money(e.amount)}`,
          ...(e.type === 'EXPENSE' ? [`Paid from ${e.paidFrom === 'COD_CASH' ? 'COD cash' : 'own money'}`] : []),
          ...(e.codAmount ? [`COD collected ${money(e.codAmount)} (not earnings)`] : []), ...(e.note ? [e.note] : []), '']),
      ];
      const { downloadReportPdf } = await import('./weekly-summary.pdf');
      await downloadReportPdf('Monthly report', this.month(), lines, `shiftledger-month-${this.month()}.pdf`);
    } catch { this.message.set('Could not download the monthly PDF. Please retry.'); }
    finally { this.downloading.set(false); }
  }
}
