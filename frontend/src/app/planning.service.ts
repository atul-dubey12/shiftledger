import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { STORAGE } from './storage.config';
import { isoDate } from './ledger';
import { validPayout, WeeklyPayout } from './weekly-summary';

export interface SyncedPayout extends WeeklyPayout { weekStart: string; version: number; }
export interface MaintenanceItem {
  id: string; title: string; kind: 'SERVICE' | 'OIL' | 'INSURANCE' | 'OTHER';
  dueDate: string | null; dueKm: number | null; estimatedCost: number | null;
  completedOn: string | null; actualCost: number | null; version: number;
}
export interface BikeState { odometer: number; version: number; }
interface Snapshot { payouts: SyncedPayout[]; tasks: MaintenanceItem[]; bike: BikeState; }

@Injectable({ providedIn: 'root' })
export class PlanningService {
  private readonly http = inject(HttpClient);
  readonly onDevice = STORAGE.mode === 'device';
  readonly payouts = signal<SyncedPayout[]>([]);
  readonly legacy = signal<Record<string, WeeklyPayout>>({});
  readonly tasks = signal<MaintenanceItem[]>([]);
  readonly bike = signal<BikeState>({ odometer: 0, version: 0 });
  readonly loading = signal(false);
  readonly ready = signal(false);
  readonly stale = signal(true);
  readonly error = signal('');
  readonly scope = signal('');
  private credential: string | null = null;
  private generation = 0;
  private readonly api = `${STORAGE.apiBaseUrl}/api`;
  private get cacheKey() { return `shiftledger.planning.${this.scope()}`; }

  async connect(credential: string) {
    if (credential === this.credential) return;
    this.credential = credential;
    const generation = ++this.generation;
    this.ready.set(false); this.stale.set(true); this.loading.set(true); this.error.set('');
    this.payouts.set([]); this.tasks.set([]); this.legacy.set({}); this.bike.set({ odometer: 0, version: 0 }); this.scope.set('');
    try {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${STORAGE.mode}:${STORAGE.apiBaseUrl}:${credential}`));
      if (generation !== this.generation) return;
      this.scope.set(Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''));
      try {
        const cached = JSON.parse(localStorage.getItem(this.cacheKey) ?? 'null');
        if (cached && Array.isArray(cached.payouts) && Array.isArray(cached.tasks) && Number.isFinite(cached.bike?.odometer)) this.apply(cached);
        const prefix = `shiftledger.weekly.${this.scope()}.`;
        const legacy: Record<string, WeeklyPayout> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)!;
          const week = key.slice(prefix.length);
          if (!key.startsWith(prefix) || !/^\d{4}-\d{2}-\d{2}$/.test(week)) continue;
          try {
            const value = JSON.parse(localStorage.getItem(key)!);
            const payday = new Date(`${week}T00:00:00`); payday.setDate(payday.getDate() + 7);
            if (value && validPayout(value.amount, value.date, isoDate(payday))) legacy[week] = value;
          } catch { /* Ignore only the corrupt legacy row. */ }
        }
        this.legacy.set(legacy);
      } catch { /* A missing browser cache must not block account access. */ }
      await this.refresh();
    } catch (err) { if (generation === this.generation) { this.error.set(this.describe(err)); this.loading.set(false); } }
  }
  private apply(snapshot: Snapshot) { this.payouts.set(snapshot.payouts); this.tasks.set(snapshot.tasks); this.bike.set(snapshot.bike); }
  private snapshot(): Snapshot { return { payouts: this.payouts(), tasks: this.tasks(), bike: this.bike() }; }
  private cache() { try { localStorage.setItem(this.cacheKey, JSON.stringify(this.snapshot())); } catch { /* The server remains authoritative. */ } }
  async refresh() {
    if (!this.scope()) return;
    const generation = this.generation;
    this.loading.set(true); this.ready.set(false); this.error.set('');
    try {
      if (!this.onDevice) {
        const [payouts, tasks, bike] = await Promise.all([
          firstValueFrom(this.http.get<SyncedPayout[]>(`${this.api}/payouts`)),
          firstValueFrom(this.http.get<MaintenanceItem[]>(`${this.api}/maintenance`)),
          firstValueFrom(this.http.get<BikeState>(`${this.api}/bike`)),
        ]);
        if (generation !== this.generation) return;
        this.apply({ payouts, tasks, bike }); this.cache();
      }
      this.ready.set(true); this.stale.set(false);
      // Migrate create-only. Existing server records always win over old browser copies.
      for (const [week, value] of Object.entries(this.legacy())) {
        if (generation !== this.generation) return;
        if (this.payouts().some(p => p.weekStart === week) || value.date > isoDate(new Date())) continue;
        try { await this.savePayout(week, value, 0); }
        catch (err) {
          if (err instanceof HttpErrorResponse && err.status === 409) {
            const payouts = await firstValueFrom(this.http.get<SyncedPayout[]>(`${this.api}/payouts`));
            if (generation === this.generation) { this.payouts.set(payouts); this.cache(); }
          } else throw err;
        }
      }
    } catch (err) {
      if (generation !== this.generation) return;
      this.stale.set(true); this.ready.set(false); this.error.set(this.describe(err));
    } finally { if (generation === this.generation) this.loading.set(false); }
  }
  private async write<T>(path: string, body: unknown, local: () => T): Promise<T> {
    if (!this.ready()) throw new Error('Refresh your account data before saving.');
    const generation = this.generation;
    const value = this.onDevice ? local() : await firstValueFrom(this.http.put<T>(`${this.api}/${path}`, body));
    if (generation !== this.generation) throw new Error('Account changed. Reload to check the saved record.');
    return value;
  }
  async savePayout(weekStart: string, value: WeeklyPayout, version: number) {
    const result = await this.write<SyncedPayout>(`payouts/${weekStart}`, { ...value, version }, () => ({ ...value, weekStart, version: version + 1 }));
    const snapshot = { ...this.snapshot(), payouts: [...this.payouts().filter(p => p.weekStart !== weekStart), result] };
    this.commit(snapshot); return result;
  }
  async saveTask(task: MaintenanceItem) {
    const result = await this.write<MaintenanceItem>(`maintenance/${task.id}`, task, () => ({ ...task, version: task.version + 1 }));
    this.commit({ ...this.snapshot(), tasks: [...this.tasks().filter(t => t.id !== task.id), result] });
  }
  async saveBike(odometer: number, version: number) {
    const result = await this.write<BikeState>('bike', { odometer, version }, () => ({ odometer, version: version + 1 }));
    this.commit({ ...this.snapshot(), bike: result });
  }
  async removeTask(task: MaintenanceItem) {
    if (!this.ready()) throw new Error('Refresh before deleting.');
    const generation = this.generation;
    if (!this.onDevice) await firstValueFrom(this.http.delete(`${this.api}/maintenance/${task.id}?version=${task.version}`));
    if (generation !== this.generation) return;
    this.commit({ ...this.snapshot(), tasks: this.tasks().filter(t => t.id !== task.id) });
  }
  private commit(snapshot: Snapshot) {
    if (this.onDevice) localStorage.setItem(this.cacheKey, JSON.stringify(snapshot));
    this.apply(snapshot); this.cache();
  }
  describe(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 409) return 'Changed on another device. Refresh, then review before saving again.';
      if (err.status === 404) return 'These features need the updated server. Your existing browser payouts are safe.';
      if (err.status === 401) return 'Server key missing or wrong. Check Settings.';
      return err.error?.message || 'Could not reach the server. Your changes are not confirmed; refresh and retry.';
    }
    return err instanceof Error ? err.message : 'Could not save. Please retry.';
  }
}
