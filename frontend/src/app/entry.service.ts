import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { EntryDraft, LedgerEntry } from './entry.model';
import { DeviceStore } from './device-store';
import { STORAGE_MODE } from './storage.config';

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

  exportCsv(from: string, to: string): void {
    if (!this.device) { window.location.href = `${this.api}/export?from=${from}&to=${to}`; return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([this.device.csv(from, to)], { type: 'text/csv;charset=utf-8' }));
    link.download = `shiftledger-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /** Pulls the API's validation message out of a failed request, if it sent one. */
  errorMessage(err: HttpErrorResponse, fallback: string): string {
    return typeof err.error?.message === 'string' && err.status === 400 ? err.error.message : fallback;
  }
}
