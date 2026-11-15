import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { PlanningService, SyncedPayout } from '../src/app/planning.service';
const values = new Map<string, string>();
Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
Object.assign(globalThis, { localStorage: { get length() { return values.size; }, key(i: number) { return [...values.keys()][i]; }, getItem(k: string) { return values.get(k) ?? null; }, setItem(k: string,v: string) { values.set(k,v); } } });
let fail = false;
let server: SyncedPayout[] = [];
let writes = 0;
const http = {
  get(url: string) { return fail ? throwError(() => new HttpErrorResponse({ status: 0 })) : of(url.endsWith('/payouts') ? [...server] : url.endsWith('/bike') ? { odometer: 0, version: 0 } : []); },
  put(url: string, draft: any) {
    if (fail) return throwError(() => new HttpErrorResponse({ status: 0 }));
    const weekStart = url.split('/').pop()!;
    const existing = server.find(p => p.weekStart === weekStart);
    if ((existing?.version ?? 0) !== draft.version) return throwError(() => new HttpErrorResponse({ status: 409 }));
    const saved = { ...draft, weekStart, version: draft.version + 1 };
    server = [...server.filter(p => p.weekStart !== weekStart), saved]; writes++;
    return of(saved);
  },
};
const injector = Injector.create({ providers: [{ provide: HttpClient, useValue: http }] });
const make = () => runInInjectionContext(injector, () => new PlanningService());
const bytes = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('api::key-a'));
const scope = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
values.set(`shiftledger.weekly.${scope}.2026-10-26`, JSON.stringify({ amount: 900, date: '2026-11-02' }));
const first = make(); await first.connect('key-a');
assert.equal(first.payouts()[0].amount, 900); assert.equal(writes, 1, 'Legacy upload happens once');
await first.refresh(); assert.equal(writes, 1);
const second = make(); await second.connect('key-a');
assert.equal(second.payouts()[0].amount, 900, 'Second client fetches server records');
await first.savePayout('2026-10-26', { amount: 950, date: '2026-11-02' }, 1);
await assert.rejects(() => second.savePayout('2026-10-26', { amount: 100, date: '2026-11-02' }, 1));
await second.refresh(); assert.equal(second.payouts()[0].amount, 950, 'Old browser copy never replaces server record');
fail = true;
await first.refresh(); assert.ok(first.stale()); assert.ok(!first.ready());
assert.equal(first.payouts()[0].amount, 950, 'Offline data remains readable');
await assert.rejects(() => first.savePayout('2026-10-26', { amount: 4, date: '2026-11-02' }, 2));
await first.connect('key-b'); assert.equal(first.payouts().length, 0, 'Account change clears previous account cache');
fail = false;
values.clear();
const third = make(); await third.connect('key-a');
assert.equal(third.payouts()[0].amount, 950, 'Clearing browser data does not remove server payouts');
console.log('Passed: legacy migration, duplicate prevention, cross-client persistence, conflict handling, offline reads, credential isolation, cleared-browser recovery.');
