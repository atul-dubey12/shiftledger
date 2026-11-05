import { Component, EventEmitter, HostListener, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, Banknote, Check, X, Zap } from 'lucide-angular';
import { LedgerEntry } from './entry.model';
import { EntryService } from './entry.service';
import { isoDate, suggestedAmounts } from './ledger';

const LAST_KEY = 'shiftledger.quickOrder';
const KM_CHIPS = [2, 4, 6, 8];

/** One-hand, ~2-tap logging of a single delivery right after it's done. */
@Component({
  selector: 'app-quick-order',
  imports: [FormsModule, LucideAngularModule],
  template: `
<div class="modal-backdrop" (click)="closed.emit()">
  <section class="entry-modal quick-sheet" role="dialog" aria-modal="true" aria-labelledby="qo-title" (click)="$event.stopPropagation()">
    <div class="modal-head">
      <span class="modal-icon modal-income"><i-lucide [img]="icons.Zap"></i-lucide></span>
      <div><h2 id="qo-title">Quick order</h2><p class="modal-subtitle">Log the delivery you just finished</p></div>
      <button type="button" class="icon-button modal-close" aria-label="Close" (click)="closed.emit()"><i-lucide [img]="icons.X"></i-lucide></button>
    </div>

    <span class="field-label">Payout</span>
    <div class="chip-row chip-row-big">
      @for (value of payouts(); track value) {
        <button type="button" class="chip" [class.selected]="payout() === value" (click)="payout.set(value)">₹{{ value }}</button>
      }
      <input class="form-input chip-input" type="number" inputmode="decimal" min="0" placeholder="Other ₹" aria-label="Other payout"
             [ngModel]="payouts().includes(payout() ?? -1) ? null : payout()" (ngModelChange)="payout.set($event)">
    </div>

    <span class="field-label">Distance <span>(optional)</span></span>
    <div class="chip-row chip-row-big">
      @for (value of kmChips; track value) {
        <button type="button" class="chip" [class.selected]="km() === value" (click)="km.set(km() === value ? null : value)">{{ value }} km</button>
      }
      <input class="form-input chip-input" type="number" inputmode="decimal" min="0" step="0.1" placeholder="Other km" aria-label="Other distance"
             [ngModel]="kmChips.includes(km() ?? -1) ? null : km()" (ngModelChange)="km.set($event)">
    </div>

    <button type="button" class="cod-toggle" role="switch" [attr.aria-checked]="isCod()" [class.on]="isCod()" (click)="isCod.set(!isCod())">
      <i-lucide [img]="icons.Banknote"></i-lucide>
      <span><strong>Cash on delivery</strong><small>Collected cash from the customer</small></span>
      <span class="switch"><span></span></span>
    </button>
    @if (isCod()) {
      <label class="field-label" for="cod-amount">Cash collected</label>
      <div class="amount-input amount-cod"><span>₹</span>
        <input id="cod-amount" type="number" inputmode="decimal" min="1" placeholder="Bill amount" [ngModel]="cod()" (ngModelChange)="cod.set($event)" autofocus>
      </div>
      <p class="hint">This is Zomato's money — it's tracked separately and never counted as your earnings.</p>
    }

    @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
    <div class="modal-actions">
      <button type="button" class="primary-button big-save" [disabled]="saving()" (click)="save()">
        {{ saving() ? 'Saving…' : summary() }} <i-lucide [img]="icons.Check"></i-lucide>
      </button>
    </div>
  </section>
</div>`
})
export class QuickOrderComponent {
  @Input() set history(entries: LedgerEntry[]) { this.entries.set(entries); }
  @Output() saved = new EventEmitter<LedgerEntry>();
  @Output() closed = new EventEmitter<void>();

  readonly icons = { Banknote, Check, X, Zap };
  readonly kmChips = KM_CHIPS;
  private readonly service = inject(EntryService);
  private readonly entries = signal<LedgerEntry[]>([]);
  private readonly last = readLast();
  readonly payouts = computed(() => suggestedAmounts(this.entries(), 'ORDER'));
  readonly payout = signal<number | null>(this.last.payout);
  readonly km = signal<number | null>(this.last.km);
  readonly isCod = signal(false);
  readonly cod = signal<number | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly summary = computed(() => {
    const parts = [`Save ₹${this.payout() || 0}`];
    if (this.km()) parts.push(`${this.km()} km`);
    if (this.isCod() && this.cod()) parts.push(`₹${this.cod()} cash`);
    return parts.join(' · ');
  });

  @HostListener('document:keydown.escape') onEscape(): void { this.closed.emit(); }

  save(): void {
    const payout = this.payout() || 0;
    const cod = this.isCod() ? this.cod() || 0 : 0;
    if (payout < 0) { this.error.set('Payout cannot be negative.'); return; }
    if (this.isCod() && cod <= 0) { this.error.set('Enter the cash you collected.'); return; }
    if (!payout && !cod) { this.error.set('Pick a payout for this order.'); return; }
    this.saving.set(true);
    this.service.create({
      type: 'INCOME', category: null, amount: payout, date: isoDate(new Date()), note: null,
      orderCount: 1, hoursWorked: null, distanceKm: this.km() || null, codAmount: cod || null, paidFrom: null, settlementMethod: null,
    }).subscribe({
      next: (entry) => {
        localStorage.setItem(LAST_KEY, JSON.stringify({ payout: payout || null, km: this.km() || null }));
        this.saving.set(false);
        this.saved.emit(entry);
      },
      error: (err: HttpErrorResponse) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not save this order. Try again.')); },
    });
  }
}

function readLast(): { payout: number | null; km: number | null } {
  try { return { payout: null, km: null, ...JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') }; }
  catch { return { payout: null, km: null }; }
}
