import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { EntryDraft, LedgerEntry } from './entry.model';
import { DeviceStore } from './device-store';
import { isoDate } from './ledger';
import { STORAGE } from './storage.config';

export interface ImportResult {
  imported: number;
  duplicates: number;
  errors: { row: number; message: string }[];
}

@Injectable({ providedIn: 'root' })
export class EntryService {
  private readonly http = inject(HttpClient);
  private readonly api = `${STORAGE.apiBaseUrl}/api/entries`;
  private readonly device = STORAGE.mode === 'device' ? new DeviceStore() : null;
  readonly onDevice = this.device !== null;

  /** Fire-and-forget request that wakes a sleeping server while the rest of the app loads. */
  wake(): void { if (!this.device) this.http.get(`${STORAGE.apiBaseUrl}/api/health`).subscribe({ error: () => {} }); }

  list(): Observable<LedgerEntry[]> { return this.device?.list() ?? this.http.get<LedgerEntry[]>(this.api); }
  create(entry: EntryDraft): Observable<LedgerEntry> { return this.device?.create(entry) ?? this.http.post<LedgerEntry>(this.api, entry); }
  update(id: number, entry: EntryDraft): Observable<LedgerEntry> { return this.device?.update(id, entry) ?? this.http.put<LedgerEntry>(`${this.api}/${id}`, entry); }
  delete(id: number): Observable<void> { return this.device?.delete(id) ?? this.http.delete<void>(`${this.api}/${id}`); }

  exportCsv(scope: 'period' | 'all', from = '', to = ''): Observable<void> | void {
    if (scope === 'all') {
      const name = `shiftledger-all-${isoDate(new Date())}.csv`;
      if (!this.device) return this.fetchCsv(`${this.api}/export`, name);
      this.download(this.device.csv('0000-01-01', '9999-12-31'), name);
      return;
    }
    const name = `shiftledger-${from}-to-${to}.csv`;
    if (!this.device) return this.fetchCsv(`${this.api}/export?from=${from}&to=${to}`, name);
    this.download(this.device.csv(from, to), name);
  }

  /** Navigating to the URL can't carry the server key, so fetch the file and save it from memory. */
  private fetchCsv(url: string, name: string): Observable<void> {
    return this.http.get(url, { responseType: 'text' }).pipe(map((csv) => this.download(csv, name)));
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
    if (!(err instanceof HttpErrorResponse) || err.status === 0) return 'No connection — check your signal and try again.';
    if (err.status === 401) return 'Server key missing or wrong — check Settings.';
    return typeof err.error?.message === 'string' && err.status === 400 ? err.error.message : fallback;
  }
}
