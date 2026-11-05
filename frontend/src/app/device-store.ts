import { Observable, defer, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { cleanNote, formatCsv } from './csv';
import { EntryDraft, LedgerEntry } from './entry.model';
import { validate } from './validation';

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

  /** Appends drafts oldest-first, with increasing ids, in a single write. Existing entries stay. */
  importMany(drafts: EntryDraft[]): Observable<LedgerEntry[]> {
    return defer(() => {
      if (drafts.length === 0) return of([]);
      const entries = this.read();
      let nextId = entries.reduce((max, e) => Math.max(max, e.id), 0);
      const created: LedgerEntry[] = [];
      for (const draft of drafts) {
        const error = validate(draft);
        if (error) return badRequest(error);
        created.push({ ...clean(draft), id: ++nextId });
      }
      this.write([...entries, ...created]);
      return of(created);
    });
  }

  csv(from: string, to: string): string {
    return formatCsv(sorted(this.read()).filter((e) => e.date >= from && e.date <= to));
  }

  private read(): LedgerEntry[] {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
  }
  private write(entries: LedgerEntry[]): void { localStorage.setItem(KEY, JSON.stringify(entries)); }
}

const sorted = (entries: LedgerEntry[]) => [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
const badRequest = (message: string) => throwError(() => new HttpErrorResponse({ status: 400, error: { message } }));
const clean = (d: EntryDraft): EntryDraft => ({ ...d, note: cleanNote(d.note) });
