import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, map, from, switchMap, concat, of, tap, catchError, throwError } from 'rxjs';
import { EntryDraft, LedgerEntry } from './entry.model';
import { DeviceStore } from './device-store';
import { isoDate } from './ledger';
import { readApiKey } from './api.interceptor';
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

  readonly cachedAt = signal<string | null>(null);
  private readonly restoredScopes = new Set<string>();

  /** Scope snapshots to the server and credential without storing another copy of the key. */
  private async cacheKey(): Promise<string | null> {
    try {
      const bytes = new TextEncoder().encode(`${this.api}\n${readApiKey()}`);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return 'shiftledger.snapshot.v1.' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }

  list(): Observable<LedgerEntry[]> {
    if (this.device) return this.device.list();
    return from(this.cacheKey()).pipe(switchMap(key => {
      let snapshot: { entries: LedgerEntry[]; savedAt: string } | null = null;
      try {
        const value = key && !this.restoredScopes.has(key) ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
        if (value && Array.isArray(value.entries) && typeof value.savedAt === 'string'
            && Number.isFinite(Date.parse(value.savedAt))
            && value.entries.every((e: LedgerEntry) => e && Number.isFinite(e.id) && Number.isFinite(e.amount)
              && typeof e.date === 'string' && ['INCOME', 'EXPENSE', 'COD_SETTLEMENT'].includes(e.type))) snapshot = value;
      } catch { /* A corrupt or unavailable cache must never block the API. */ }
      if (key) this.restoredScopes.add(key);
      if (snapshot) this.cachedAt.set(snapshot.savedAt);
      const fresh = this.http.get<LedgerEntry[]>(this.api).pipe(tap(entries => {
        this.cachedAt.set(null);
        try { if (key) localStorage.setItem(key, JSON.stringify({ entries, savedAt: new Date().toISOString() })); } catch { /* Storage full or disabled. */ }
      }), catchError(err => {
        if (err instanceof HttpErrorResponse && err.status === 401) {
          this.cachedAt.set(null);
          try { if (key) localStorage.removeItem(key); } catch { /* Storage disabled. */ }
        }
        return throwError(() => err);
      }));
      return snapshot ? concat(of(snapshot.entries), fresh) : fresh;
    }));
  }
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
