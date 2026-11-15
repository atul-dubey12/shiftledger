import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, effect, HostListener, input, signal, inject, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlanningService } from './planning.service';
import { LedgerEntry } from './entry.model';
import { addDays, categoryMeta, isoDate } from './ledger';
import { previousWeek, validPayout, WeeklyPayout, weeklySummary } from './weekly-summary';

@Component({
  selector: 'app-weekly-summary',
  imports: [CurrencyPipe, DatePipe, FormsModule],
  templateUrl: './weekly-summary.component.html',
})
export class WeeklySummaryComponent {
  readonly credential = input('');
  readonly planning = inject(PlanningService);
  readonly ready = this.planning.ready;
  readonly entries = input.required<LedgerEntry[]>();
  readonly incomplete = input(false);
  readonly now = signal(new Date());
  readonly offset = signal(0);
  readonly summary = computed(() => weeklySummary(this.entries(), addDays(previousWeek(this.now()).start, this.offset() * 7)));
  readonly collapsed = signal(false);
  readonly message = signal('');
  readonly busy = signal(false);
  readonly payout = computed<WeeklyPayout | null>(() => this.planning.payouts().find(p => p.weekStart === this.summary().key) ?? this.planning.legacy()[this.summary().key] ?? null);
  readonly saving = signal(false);
  private editVersion = 0;
  dirty = false;
  private editKey = '';
  amount: number | null = null;
  date = '';
  private get key() { return `shiftledger.weekly.${this.planning.scope()}.${this.summary().key}`; }
  constructor() {
    effect(() => { void this.planning.connect(this.credential()); });
    effect(() => {
      const paid = this.payout();
      const key = this.summary().key;
      const scope = this.planning.scope();
      const editKey = `${scope}:${key}`;
      if (!this.dirty || this.editKey !== editKey) {
        this.amount = paid?.amount ?? null;
        this.date = paid?.date ?? this.summary().payday;
        this.editVersion = this.planning.payouts().find(p => p.weekStart === key)?.version ?? 0;
        this.dirty = false; this.editKey = editKey;
      }

    });
    effect(() => { const scope = this.planning.scope(); if (scope) untracked(() => this.loadCollapsed()); });
  }
  private loadCollapsed() {
    try { this.collapsed.set(localStorage.getItem(`${this.key}.seen`) === 'yes'); } catch { /* Optional preference. */ }
  }
  async refreshPayout() { this.dirty = false; await this.planning.refresh(); }
  @HostListener('window:focus') refreshDate() {
    if (isoDate(previousWeek(new Date()).start) !== isoDate(previousWeek(this.now()).start)) {
      this.now.set(new Date()); this.offset.set(0); this.load(); this.loadCollapsed();
    }
  }
  move(step: number) { this.offset.update(n => Math.min(0, n + step)); this.load(); this.collapsed.set(false); }
  load() { this.message.set(''); this.dirty = false; }
  dismiss() {
    this.collapsed.set(true);
    try { localStorage.setItem(`${this.key}.seen`, 'yes'); } catch { /* Still dismiss for this visit. */ }
  }
  async save() {
    if (!this.ready() || this.saving()) return;
    if (!validPayout(this.amount, this.date, this.summary().payday) || this.date > isoDate(new Date())) {
      this.message.set('Enter a non-negative amount with up to two decimals and a received date between payday and today.'); return;
    }
    const week = this.summary().key;
    this.saving.set(true);
    try {
      await this.planning.savePayout(week, { amount: this.amount!, date: this.date }, this.editVersion);
      this.dirty = false;
      this.editVersion = this.planning.payouts().find(p => p.weekStart === week)?.version ?? 0;
      this.message.set(this.planning.onDevice ? 'Payout saved on this device.' : 'Bank payout saved to your account.');
    } catch (err) { this.message.set(this.planning.describe(err)); }
    finally { this.saving.set(false); }
  }

  category = categoryMeta;
  async download() {
    this.busy.set(true);
    try {
      const { downloadWeeklyPdf } = await import('./weekly-summary.pdf');
      await downloadWeeklyPdf(this.summary(), this.payout(), this.incomplete() || this.planning.stale(), this.planning.onDevice);
    } catch { this.message.set('Could not download the PDF. Please try again.'); }
    finally { this.busy.set(false); }
  }
}
