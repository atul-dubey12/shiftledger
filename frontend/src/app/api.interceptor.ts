import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, signal, inject } from '@angular/core';
import { finalize, timeout } from 'rxjs';

const KEY_STORAGE = 'shiftledger.apiKey';
/** A free Render service can take most of a minute to wake up, so give requests well over that. */
const REQUEST_TIMEOUT_MS = 70_000;
const SLOW_AFTER_MS = 3_000;

export function readApiKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) ?? ''; } catch { return ''; }
}
export function saveApiKey(key: string): void {
  try { key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE); } catch { /* storage blocked */ }
}

/** Tracks whether any request has been waiting long enough to show the "waking up the server" banner. */
@Injectable({ providedIn: 'root' })
export class NetworkStatus {
  readonly slow = signal(false);
  private pending = 0;
  private timer?: ReturnType<typeof setTimeout>;

  start(): void {
    if (this.pending++ === 0) this.timer = setTimeout(() => this.slow.set(true), SLOW_AFTER_MS);
  }
  end(): void {
    if (--this.pending > 0) return;
    this.pending = 0;
    clearTimeout(this.timer);
    this.slow.set(false);
  }
}

/** Adds the server key, a generous timeout, and slow-request tracking to every API call. */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const status = inject(NetworkStatus);
  const key = readApiKey();
  const request = key ? req.clone({ setHeaders: { 'X-Api-Key': key } }) : req;
  status.start();
  return next(request).pipe(timeout(REQUEST_TIMEOUT_MS), finalize(() => status.end()));
};
