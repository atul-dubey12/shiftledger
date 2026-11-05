import { Component, EventEmitter, HostListener, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, Check, Timer, X } from 'lucide-angular';
import { LedgerEntry } from './entry.model';
import { EntryService } from './entry.service';
import { isoDate } from './ledger';

/** Closes a day of quick orders: logs hours worked (for ₹/hour) and any incentive or bonus. */
@Component({
  selector: 'app-end-shift',
  imports: [FormsModule, LucideAngularModule],
  template: `
<div class="modal-backdrop" (click)="closed.emit()">
  <section class="entry-modal" role="dialog" aria-modal="true" aria-labelledby="end-title" (click)="$event.stopPropagation()">
    <div class="modal-head">
      <span class="modal-icon modal-income"><i-lucide [img]="icons.Timer"></i-lucide></span>
      <div><h2 id="end-title">End shift</h2><p class="modal-subtitle">{{ ordersToday }} {{ ordersToday === 1 ? 'order' : 'orders' }} today · log your hours and any incentive</p></div>
      <button type="button" class="icon-button modal-close" aria-label="Close" (click)="closed.emit()"><i-lucide [img]="icons.X"></i-lucide></button>
    </div>
    <form (ngSubmit)="save()">
      <span class="field-label">Hours worked</span>
      <div class="chip-row chip-row-big">
        @for (h of hourChips; track h) { <button type="button" class="chip" [class.selected]="hours === h" (click)="hours = h">{{ h }} h</button> }
        <input class="form-input chip-input" name="hours" type="number" inputmode="decimal" min="0.25" max="24" step="0.25" placeholder="Other" aria-label="Other hours"
               [ngModel]="hourChips.includes(hours ?? -1) ? null : hours" (ngModelChange)="hours = $event">
      </div>
      <label class="field-label" for="incentive">Incentive / bonus <span>(optional)</span></label>
      <div class="amount-input"><span>₹</span><input id="incentive" name="incentive" type="number" inputmode="decimal" min="0" placeholder="0" [(ngModel)]="incentive"></div>
      @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
      <div class="modal-actions">
        <button class="primary-button" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Finish shift' }} <i-lucide [img]="icons.Check"></i-lucide></button>
      </div>
    </form>
  </section>
</div>`
})
export class EndShiftComponent {
  @Input() ordersToday = 0;
  @Output() saved = new EventEmitter<LedgerEntry>();
  @Output() closed = new EventEmitter<void>();

  readonly icons = { Check, Timer, X };
  readonly hourChips = [4, 6, 8, 10];
  private readonly service = inject(EntryService);
  readonly saving = signal(false);
  readonly error = signal('');
  hours: number | null = null;
  incentive: number | null = null;

  @HostListener('document:keydown.escape') onEscape(): void { this.closed.emit(); }

  save(): void {
    if (!this.hours || this.hours <= 0 || this.hours > 24) { this.error.set('Enter the hours you worked (up to 24).'); return; }
    this.saving.set(true);
    this.service.create({
      type: 'INCOME', category: null, amount: this.incentive || 0, date: isoDate(new Date()), note: this.incentive ? 'Shift incentive' : 'End of shift',
      orderCount: null, hoursWorked: this.hours, distanceKm: null, codAmount: null, paidFrom: null, settlementMethod: null,
    }).subscribe({
      next: (entry) => { this.saving.set(false); this.saved.emit(entry); },
      error: (err: HttpErrorResponse) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not save. Try again.')); },
    });
  }
}
