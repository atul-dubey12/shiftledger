import { Component, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, Bike, Check, CircleDollarSign, Plus, X } from 'lucide-angular';
import { EntryDraft, EntryType, ExpenseCategory, LedgerEntry, PaidFrom } from './entry.model';
import { EntryService } from './entry.service';
import { CATEGORIES, addDays, isoDate, suggestedAmounts } from './ledger';

@Component({
  selector: 'app-entry-form',
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './entry-form.component.html'
})
export class EntryFormComponent implements OnInit {
  @Input({ required: true }) type!: EntryType;
  @Input() entry: LedgerEntry | null = null;
  @Input() history: LedgerEntry[] = [];
  /** COD cash currently in the rider's pocket, so expenses can be paid from it. */
  @Input() cashInHand = 0;
  @Output() saved = new EventEmitter<{ entry: LedgerEntry; addAnother: boolean; edited: boolean }>();
  @Output() closed = new EventEmitter<void>();

  readonly icons = { Bike, Check, CircleDollarSign, Plus, X };
  readonly categories = CATEGORIES;
  private readonly service = inject(EntryService);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly category = signal<ExpenseCategory>('FUEL');
  readonly paidFrom = signal<PaidFrom>('OWN');
  readonly suggestions = computed(() => suggestedAmounts(this.history, this.type === 'INCOME' ? 'INCOME' : this.category()));
  readonly today = isoDate(new Date());
  readonly yesterday = isoDate(addDays(new Date(), -1));
  amount: number | null = null;
  date = this.today;
  note = '';
  orderCount: number | null = null;
  hoursWorked: number | null = null;
  distanceKm: number | null = null;
  codAmount: number | null = null;

  get editing(): boolean { return this.entry !== null; }
  get showPaidFrom(): boolean { return this.type === 'EXPENSE' && (this.cashInHand > 0 || this.entry?.paidFrom === 'COD_CASH'); }
  /** COD cash this expense may use: what's in hand, plus its own amount if it was already paid from COD. */
  get codAvailable(): number { return this.cashInHand + (this.entry?.paidFrom === 'COD_CASH' ? this.entry.amount : 0); }
  get overCod(): boolean { return this.paidFrom() === 'COD_CASH' && !!this.amount && this.amount > this.codAvailable; }

  ngOnInit(): void {
    // Riders usually pay work costs out of the COD cash they're carrying, so default to it when there is some.
    if (!this.entry) { if (this.type === 'EXPENSE' && this.cashInHand > 0) this.paidFrom.set('COD_CASH'); return; }
    this.amount = this.entry.amount;
    this.date = this.entry.date;
    this.note = this.entry.note ?? '';
    this.category.set(this.entry.category ?? 'FUEL');
    this.orderCount = this.entry.orderCount;
    this.hoursWorked = this.entry.hoursWorked;
    this.distanceKm = this.entry.distanceKm;
    this.codAmount = this.entry.codAmount ?? null;
    this.paidFrom.set(this.entry.paidFrom ?? 'OWN');
  }

  @HostListener('document:keydown.escape') close(): void { this.closed.emit(); }

  submit(addAnother: boolean): void {
    const income = this.type === 'INCOME';
    const zeroAllowed = income && ((this.codAmount ?? 0) > 0 || (this.hoursWorked ?? 0) > 0);
    if (this.amount == null || this.amount < 0 || (this.amount === 0 && !zeroAllowed)) { this.error.set('Enter an amount greater than ₹0.'); return; }
    const draft: EntryDraft = {
      type: this.type, category: income ? null : this.category(), amount: this.amount, date: this.date, note: this.note.trim() || null,
      orderCount: income ? this.orderCount || null : null,
      hoursWorked: income ? this.hoursWorked || null : null,
      distanceKm: income ? this.distanceKm || null : null,
      codAmount: income ? this.codAmount || null : null,
      paidFrom: income ? null : this.paidFrom(),
      settlementMethod: null,
    };
    this.saving.set(true);
    this.error.set('');
    const request = this.entry ? this.service.update(this.entry.id, draft) : this.service.create(draft);
    request.subscribe({
      next: (entry) => {
        this.saving.set(false);
        this.saved.emit({ entry, addAnother, edited: this.editing });
        if (addAnother) { this.amount = null; this.note = ''; this.orderCount = null; this.hoursWorked = null; this.distanceKm = null; this.codAmount = null; }
      },
      error: (err: HttpErrorResponse) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not save this entry. Check that the API is running.')); },
    });
  }
}
