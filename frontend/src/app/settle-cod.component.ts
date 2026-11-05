import { Component, EventEmitter, HostListener, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, Check, HandCoins, X } from 'lucide-angular';
import { LedgerEntry, SettlementMethod } from './entry.model';
import { EntryService } from './entry.service';
import { isoDate } from './ledger';

const METHOD_KEY = 'shiftledger.settlementMethod';

/** Records COD cash handed back to the platform (deposited, or deducted from the payout). */
@Component({
  selector: 'app-settle-cod',
  imports: [FormsModule, LucideAngularModule],
  template: `
<div class="modal-backdrop" (click)="closed.emit()">
  <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="settle-title" (click)="$event.stopPropagation()">
    <div class="modal-head">
      <span class="modal-icon modal-cod"><i-lucide [img]="icons.HandCoins"></i-lucide></span>
      <div><h2 id="settle-title">{{ entry ? 'Edit settlement' : 'Settle COD cash' }}</h2><p class="modal-subtitle">Cash you've given back to Zomato</p></div>
      <button type="button" class="icon-button modal-close" aria-label="Close" (click)="closed.emit()"><i-lucide [img]="icons.X"></i-lucide></button>
    </div>
    <form (ngSubmit)="save()">
      <label class="field-label" for="settle-amount">Amount settled</label>
      <div class="amount-input"><span>₹</span><input id="settle-amount" name="amount" type="number" inputmode="decimal" min="1" [(ngModel)]="amount" required></div>
      @if (!entry && owed > 0) {
        <div class="chip-row"><button type="button" class="chip" [class.selected]="amount === owed" (click)="amount = owed">All of it · ₹{{ owed }}</button></div>
      }
      <span class="field-label">How was it settled?</span>
      <div class="segmented segmented-full">
        <button type="button" [class.selected]="method() === 'DEDUCTED_FROM_PAYOUT'" (click)="method.set('DEDUCTED_FROM_PAYOUT')">Cut from payout</button>
        <button type="button" [class.selected]="method() === 'DEPOSITED'" (click)="method.set('DEPOSITED')">Deposited</button>
      </div>
      <label class="field-label" for="settle-date">Date</label>
      <input class="form-input" id="settle-date" name="date" type="date" [max]="today" [(ngModel)]="date" required>
      <label class="field-label" for="settle-note">Note <span>(optional)</span></label>
      <input class="form-input" id="settle-note" name="note" type="text" maxlength="180" placeholder="e.g. Weekly payout adjustment" [(ngModel)]="note">
      @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
      <div class="modal-actions">
        <button class="primary-button" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save settlement' }} <i-lucide [img]="icons.Check"></i-lucide></button>
      </div>
    </form>
  </section>
</div>`
})
export class SettleCodComponent implements OnInit {
  @Input() owed = 0;
  @Input() entry: LedgerEntry | null = null;
  @Output() saved = new EventEmitter<{ entry: LedgerEntry; edited: boolean }>();
  @Output() closed = new EventEmitter<void>();

  readonly icons = { Check, HandCoins, X };
  private readonly service = inject(EntryService);
  readonly today = isoDate(new Date());
  readonly method = signal<SettlementMethod>((localStorage.getItem(METHOD_KEY) as SettlementMethod) || 'DEDUCTED_FROM_PAYOUT');
  readonly saving = signal(false);
  readonly error = signal('');
  amount: number | null = null;
  date = this.today;
  note = '';

  ngOnInit(): void {
    if (this.entry) {
      this.amount = this.entry.amount; this.date = this.entry.date; this.note = this.entry.note ?? '';
      if (this.entry.settlementMethod) this.method.set(this.entry.settlementMethod);
    } else {
      this.amount = this.owed || null;
    }
  }

  @HostListener('document:keydown.escape') onEscape(): void { this.closed.emit(); }

  save(): void {
    if (!this.amount || this.amount <= 0) { this.error.set('Enter the amount you settled.'); return; }
    const draft = {
      type: 'COD_SETTLEMENT' as const, category: null, amount: this.amount, date: this.date, note: this.note.trim() || null,
      orderCount: null, hoursWorked: null, distanceKm: null, codAmount: null, paidFrom: null, settlementMethod: this.method(),
    };
    this.saving.set(true);
    (this.entry ? this.service.update(this.entry.id, draft) : this.service.create(draft)).subscribe({
      next: (entry) => { localStorage.setItem(METHOD_KEY, this.method()); this.saving.set(false); this.saved.emit({ entry, edited: !!this.entry }); },
      error: (err: HttpErrorResponse) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not save. Try again.')); },
    });
  }
}
