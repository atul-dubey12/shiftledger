import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Subject, timeout } from 'rxjs';
import { EntryDraft, LedgerEntry } from './entry.model';
import { readApiKey } from './api.interceptor';
import { STORAGE } from './storage.config';

interface Pending { token: string; entry: LedgerEntry; credentialScope: string; rejected?: string; }
@Injectable({ providedIn: 'root' })
export class OfflineQueue {
  private readonly http = inject(HttpClient);
  readonly pending = signal<LedgerEntry[]>([]);
  readonly rejectedIds = signal<number[]>([]);
  readonly syncing = signal(false);
  readonly offline = signal(!navigator.onLine);
  readonly failure = signal('');
  readonly changed = new Subject<void>();
  private readonly prefix = 'shiftledger.pending.v1.';
  private running = false;
  constructor() {
    window.addEventListener('online', () => { this.offline.set(false); void this.retry(); });
    window.addEventListener('offline', () => this.offline.set(true));
    window.addEventListener('storage', event => {
      if (event.key?.startsWith(this.prefix) || event.key === 'shiftledger.apiKey') {
        void this.restore().then(() => { this.changed.next(); void this.retry(); });
      }
    });
    if (STORAGE.mode === 'api') {
      void this.restore().then(() => this.retry()).catch(() => this.failure.set('Cannot read saved entries on this browser.'));
      setInterval(() => { if (this.pending().length && !this.failure()) void this.retry(); }, 30000);
    }
  }
  async scope(): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${STORAGE.apiBaseUrl}\n${readApiKey()}`));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }
  private read(scope: string): Pending[] {
    const rows: Pending[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith(this.prefix)) continue;
      const row: Pending = JSON.parse(localStorage.getItem(key)!);
      if (row.credentialScope === scope) rows.push(row);
    }
    return rows.sort((a, b) => b.entry.id - a.entry.id);
  }
  async restore(): Promise<void> {
    try {
      const credential = readApiKey();
      const rows = this.read(await this.scope());
      if (credential !== readApiKey()) return;
      this.pending.set(rows.map(r => r.entry));
      this.rejectedIds.set(rows.filter(r => r.rejected).map(r => r.entry.id));
    }
    catch { this.failure.set('Cannot read saved entries on this browser.'); }
  }
  async enqueue(draft: EntryDraft): Promise<LedgerEntry> {
    if (STORAGE.apiBaseUrl && !readApiKey()) throw new Error('Enter your server key in Settings before saving entries.');
    const token = crypto.randomUUID();
    const credentialScope = await this.scope();
    const entry = { ...draft, id: -(Date.now() * 1000 + crypto.getRandomValues(new Uint16Array(1))[0] % 1000) };
    try { localStorage.setItem(this.prefix + token, JSON.stringify({ token, credentialScope, entry })); }
    catch { throw new Error('Could not save on this device. Free browser storage and try again.'); }
    await this.restore();
    this.changed.next();
    void this.retry();
    return entry;
  }
  async retry(): Promise<void> {
    if (this.running || STORAGE.mode !== 'api' || !navigator.onLine) return;
    this.running = true;
    this.syncing.set(true);
    this.failure.set('');
    const credential = readApiKey();
    try {
      const scope = await this.scope();
      for (const row of this.read(scope)) {
        if (readApiKey() !== credential) break;
        if (row.rejected) continue;
        const { id, ...draft } = row.entry;
        let saved: LedgerEntry;
        try { saved = await firstValueFrom(this.http.put<LedgerEntry>(`${STORAGE.apiBaseUrl}/api/entries/queued/${row.token}`, draft).pipe(timeout(70000))); }
        catch (err) {
          if (err instanceof HttpErrorResponse && err.status === 400) {
            row.rejected = err.error?.message ?? 'Entry rejected by server. Edit or delete it.';
            localStorage.setItem(this.prefix + row.token, JSON.stringify(row));
            await this.restore();
            this.failure.set(row.rejected!);
            this.changed.next();
            continue;
          }
          throw err;
        }
        // Keep the queue item if its acknowledgement cannot be persisted. The server receipt makes retry safe.
        await this.saveAcknowledgement(saved, credential);
        localStorage.removeItem(this.prefix + row.token);
        await this.restore();
        this.changed.next();
      }
    } catch (err) {
      if (err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 500)) {
        this.failure.set('Server unavailable. Entries are saved on this device.');
      } else {
        this.failure.set(err instanceof HttpErrorResponse && err.status === 401 ? 'Server key rejected. Check Settings, then retry.'
          : err instanceof HttpErrorResponse && err.status === 400 ? (err.error?.message ?? 'An entry needs correction before it can sync.')
          : 'Sync failed. Your pending entries remain saved. Retry when the server is ready.');
      }
    } finally {
      this.running = false;
      this.syncing.set(false);
      if (this.pending().length > this.rejectedIds().length && navigator.onLine) setTimeout(() => { if (this.pending().length) void this.retry(); }, 60000);
    }
  }
  async removeRejected(id: number): Promise<void> {
    const row = this.read(await this.scope()).find(r => r.entry.id === id);
    if (!row?.rejected) throw new Error('Wait for this entry to sync before changing it.');
    localStorage.removeItem(this.prefix + row.token);
    await this.restore();
    this.changed.next();
  }
  async replaceRejected(id: number, draft: EntryDraft): Promise<LedgerEntry> {
    const row = this.read(await this.scope()).find(r => r.entry.id === id);
    if (!row?.rejected) throw new Error('Wait for this entry to sync before editing it.');
    const entry = await this.enqueue(draft);
    await this.removeRejected(id);
    return entry;
  }
  private async saveAcknowledgement(entry: LedgerEntry, credential: string): Promise<void> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${STORAGE.apiBaseUrl}/api/entries\n${credential}`));
    const key = 'shiftledger.snapshot.v1.' + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
    const old = JSON.parse(localStorage.getItem(key) ?? 'null');
    const entries: LedgerEntry[] = Array.isArray(old?.entries) ? old.entries : [];
    localStorage.setItem(key, JSON.stringify({ entries: [entry, ...entries.filter(e => e.id !== entry.id)], savedAt: old?.savedAt ?? new Date().toISOString() }));
  }
}
