import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const WINDOW_MS = 60_000;
const MAX_FAILURES_PER_WINDOW = 30;
/** Bounds memory under a spray from many addresses: the oldest windows are dropped first. */
const MAX_TRACKED_ADDRESSES = 10_000;

interface FailureWindow {
  startedAt: number;
  failures: number;
}

/**
 * Counts refused API keys per client address. A key's secret is too long to guess, so this does not
 * protect the keys: it stops one client from turning a stream of bad keys into a stream of database
 * lookups and log lines. The `@nestjs/throttler` storage cannot be used here because it only counts
 * by incrementing, and a successful request must not count.
 */
@Injectable()
export class ApiKeyFailureLimiter {
  private readonly windows = new Map<string, FailureWindow>();

  assertNotBlocked(address: string | null): void {
    const window = this.currentWindow(address);
    if (window && window.failures >= MAX_FAILURES_PER_WINDOW) {
      throw new HttpException('Too many invalid API keys from this address', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  recordFailure(address: string | null): void {
    const key = address ?? 'unknown';
    const window = this.currentWindow(address);
    if (window) {
      window.failures += 1;
      return;
    }
    if (this.windows.size >= MAX_TRACKED_ADDRESSES) {
      const oldest = this.windows.keys().next().value;
      if (oldest !== undefined) this.windows.delete(oldest);
    }
    this.windows.set(key, { startedAt: Date.now(), failures: 1 });
  }

  private currentWindow(address: string | null): FailureWindow | null {
    const key = address ?? 'unknown';
    const window = this.windows.get(key);
    if (!window) return null;
    if (Date.now() - window.startedAt >= WINDOW_MS) {
      this.windows.delete(key);
      return null;
    }
    return window;
  }
}
