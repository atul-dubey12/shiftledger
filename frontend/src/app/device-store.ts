import { Observable, defer, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { EntryDraft, LedgerEntry } from './entry.model';
import { addDays, isoDate } from './ledger';

const KEY = 'shiftledger.entries';

/** Browser-storage stand-in for the Spring Boot API, used when the app is hosted statically (GitHub Pages). Mirrors its rules. */
export class DeviceStore {
  list(): Observable<LedgerEntry[]> { return defer(() => of(sorted(this.read()))); }

  create(draft: EntryDraft): Observable<LedgerEntry> {
    return defer(() => {
      const error = validate(draft);
      if (error) return badRequest(error);
      const entries = this.read();
      const entry: LedgerEntry = { ...clean(draft), id: entries.reduce((max, e) => Math.max(max, e.id), 0) + 1 };
      this.write([...entries, entry]);
      return of(entry);
    });
  }

  update(id: number, draft: EntryDraft): Observable<LedgerEntry> {
    return defer(() => {
      const error = validate(draft);
      if (error) return badRequest(error);
      const entries = this.read();
      if (!entries.some((e) => e.id === id)) return throwError(() => new HttpErrorResponse({ status: 404 }));
      const entry: LedgerEntry = { ...clean(draft), id };
      this.write(entries.map((e) => e.id === id ? entry : e));
      return of(entry);
    });
  }

  delete(id: number): Observable<void> {
    return defer(() => { this.write(this.read().filter((e) => e.id !== id)); return of(undefined); });
  }

  csv(from: string, to: string): string {
    const rows = sorted(this.read()).filter((e) => e.date >= from && e.date <= to).map((e) =>
      [e.date, e.type, e.category ?? '', e.amount, e.orderCount ?? '', e.hoursWorked ?? '', e.distanceKm ?? '', csvCell(e.note)].join(','));
    return ['Date,Type,Category,Amount,Orders,Hours,Km,Note', ...rows].join('\n') + '\n';
  }

  private read(): LedgerEntry[] {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
  }
  private write(entries: LedgerEntry[]): void { localStorage.setItem(KEY, JSON.stringify(entries)); }
}

const sorted = (entries: LedgerEntry[]) => [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
const badRequest = (message: string) => throwError(() => new HttpErrorResponse({ status: 400, error: { message } }));
const clean = (d: EntryDraft): EntryDraft => ({ ...d, note: d.note?.trim().slice(0, 180) || null });
const csvCell = (value: string | null) => value ? `"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"` : '';
const outside = (v: number | null, max: number) => v !== null && (v < 0 || v > max);

function validate(d: EntryDraft): string | null {
  if (!d.type || !d.amount || d.amount <= 0 || !d.date) return 'Type, positive amount, and date are required.';
  if (d.amount >= 10_000_000) return 'Amount is too large.';
  if (d.date > isoDate(addDays(new Date(), 1))) return 'Date cannot be in the future.';
  if (d.type === 'EXPENSE' && !d.category) return 'Choose an expense category.';
  if (d.type === 'EXPENSE' && (d.orderCount !== null || d.hoursWorked !== null || d.distanceKm !== null)) return 'Orders, hours and distance belong on shift earnings.';
  if (d.type === 'INCOME' && d.category) return 'Income entries do not have an expense category.';
  if (outside(d.orderCount, 500)) return 'Orders must be between 0 and 500.';
  if (outside(d.hoursWorked, 24)) return 'Hours must be between 0 and 24.';
  if (outside(d.distanceKm, 2000)) return 'Distance must be between 0 and 2000 km.';
  return null;
}
