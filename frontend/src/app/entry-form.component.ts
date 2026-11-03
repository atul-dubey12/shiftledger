import { Component, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, Bike, Check, CircleDollarSign, Plus, X } from 'lucide-angular';
import { EntryDraft, EntryType, ExpenseCategory, LedgerEntry } from './entry.model';
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
  @Output() saved = new EventEmitter<{ entry: LedgerEntry; addAnother: boolean; edited: boolean }>();
  @Output() closed = new EventEmitter<void>();

  readonly icons = { Bike, Check, CircleDollarSign, Plus, X };
  readonly categories = CATEGORIES;
  private readonly service = inject(EntryService);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly category = signal<ExpenseCategory>('FUEL');
  readonly suggestions = computed(() => suggestedAmounts(this.history, this.type === 'INCOME' ? 'INCOME' : this.category()));
  readonly today = isoDate(new Date());
  readonly yesterday = isoDate(addDays(new Date(), -1));
  amount: number | null = null;
  date = this.today;
  note = '';
  orderCount: number | null = null;
  hoursWorked: number | null = null;
  distanceKm: number | null = null;

  get editing(): boolean { return this.entry !== null; }

  ngOnInit(): void {
    if (!this.entry) return;
    this.amount = this.entry.amount;
    this.date = this.entry.date;
    this.note = this.entry.note ?? '';
    this.category.set(this.entry.category ?? 'FUEL');
    this.orderCount = this.entry.orderCount;
    this.hoursWorked = this.entry.hoursWorked;
    this.distanceKm = this.entry.distanceKm;
  }

  @HostListener('document:keydown.escape') close(): void { this.closed.emit(); }

  submit(addAnother: boolean): void {
    if (!this.amount || this.amount <= 0) { this.error.set('Enter an amount greater than ₹0.'); return; }
    const income = this.type === 'INCOME';
    const draft: EntryDraft = {
      type: this.type, category: income ? null : this.category(), amount: this.amount, date: this.date, note: this.note.trim() || null,
      orderCount: income ? this.orderCount || null : null,
      hoursWorked: income ? this.hoursWorked || null : null,
      distanceKm: income ? this.distanceKm || null : null,
    };
    this.saving.set(true);
    this.error.set('');
    const request = this.entry ? this.service.update(this.entry.id, draft) : this.service.create(draft);
    request.subscribe({
      next: (entry) => {
        this.saving.set(false);
        this.saved.emit({ entry, addAnother, edited: this.editing });
        if (addAnother) { this.amount = null; this.note = ''; this.orderCount = null; this.hoursWorked = null; this.distanceKm = null; }
      },
      error: (err: HttpErrorResponse) => { this.saving.set(false); this.error.set(this.service.errorMessage(err, 'Could not save this entry. Check that the API is running.')); },
    });
  }
}
