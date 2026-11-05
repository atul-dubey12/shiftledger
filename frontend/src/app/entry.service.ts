import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { EntryDraft, LedgerEntry } from './entry.model';
import { DeviceStore } from './device-store';
import { isoDate } from './ledger';
import { STORAGE_MODE } from './storage.config';

export interface ImportResult {
  imported: number;
  duplicates: number;
  errors: { row: number; message: string }[];
}

@Injectable({ providedIn: 'root' })
export class EntryService {
  private readonly http = inject(HttpClient);
  private readonly api = '/api/entries';
  private readonly device = STORAGE_MODE === 'device' ? new DeviceStore() : null;
  readonly onDevice = this.device !== null;

  list(): Observable<LedgerEntry[]> { return this.device?.list() ?? this.http.get<LedgerEntry[]>(this.api); }
  create(entry: EntryDraft): Observable<LedgerEntry> { return this.device?.create(entry) ?? this.http.post<LedgerEntry>(this.api, entry); }
  update(id: number, entry: EntryDraft): Observable<LedgerEntry> { return this.device?.update(id, entry) ?? this.http.put<LedgerEntry>(`${this.api}/${id}`, entry); }
  delete(id: number): Observable<void> { return this.device?.delete(id) ?? this.http.delete<void>(`${this.api}/${id}`); }

  exportCsv(scope: 'period' | 'all', from = '', to = ''): void {
    if (scope === 'all') {
      const name = `shiftledger-all-${isoDate(new Date())}.csv`;
      if (!this.device) { window.location.href = `${this.api}/export`; return; }
      this.download(this.device.csv('0000-01-01', '9999-12-31'), name);
      return;
    }
    if (!this.device) { window.location.href = `${this.api}/export?from=${from}&to=${to}`; return; }
    this.download(this.device.csv(from, to), `shiftledger-${from}-to-${to}.csv`);
  }

  /** Server re-checks every row. Device mode classifies locally and does not call this. */
  previewImport(entries: EntryDraft[]): Observable<ImportResult> {
    return this.http.post<ImportResult>(`${this.api}/import`, { entries, dryRun: true });
  }

  saveImport(entries: EntryDraft[]): Observable<ImportResult> {
    if (this.device) return this.device.importMany(entries).pipe(map((saved) => ({ imported: saved.length, duplicates: 0, errors: [] })));
    return this.http.post<ImportResult>(`${this.api}/import`, { entries, dryRun: false });
  }

  private download(csv: string, filename: string): void {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /** Pulls the API's validation message out of a failed request, if it sent one. */
  errorMessage(err: HttpErrorResponse, fallback: string): string {
    return typeof err.error?.message === 'string' && err.status === 400 ? err.error.message : fallback;
  }
}
