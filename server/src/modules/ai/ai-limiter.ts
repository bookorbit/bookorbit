import { Injectable } from '@nestjs/common';

export interface AiLimits {
  maxParallel: number;
  requestsPerMinute: number | null;
}

/** Thrown to a waiter whose signal aborted before its turn came. */
export class AiLimiterAbortedError extends Error {
  constructor() {
    super('Cancelled while waiting for the connection');
    this.name = 'AiLimiterAbortedError';
  }
}

/**
 * `interactive` is someone waiting for the answer on screen; it goes ahead of `background` work
 * such as a build, first come first served within each.
 */
export type AiLimiterPriority = 'interactive' | 'background';

interface Waiter {
  priority: AiLimiterPriority;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  detach: () => void;
}

const MINUTE_MS = 60_000;

/**
 * One connection's gate, shared by every feature and both slots: at most `maxParallel` requests
 * in flight, at most `requestsPerMinute` started in any minute, interactive requests ahead of
 * background ones and first come first served within each. A 429 with `retry-after` holds the
 * whole connection, not only the request that got it.
 */
export class AiConnectionLimiter {
  private active = 0;
  private readonly queue: Waiter[] = [];
  private starts: number[] = [];
  private heldUntil = 0;
  private timer: NodeJS.Timeout | null = null;
  private limits: AiLimits = { maxParallel: 1, requestsPerMinute: null };

  get inFlight(): number {
    return this.active;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /** Resolves with a release function once a request may start. Limits apply as of this call. */
  acquire(limits: AiLimits, signal?: AbortSignal, priority: AiLimiterPriority = 'background'): Promise<() => void> {
    this.limits = { maxParallel: Math.max(1, limits.maxParallel), requestsPerMinute: limits.requestsPerMinute };
    if (signal?.aborted) return Promise.reject(new AiLimiterAbortedError());

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index !== -1) this.queue.splice(index, 1);
        reject(new AiLimiterAbortedError());
      };
      const waiter: Waiter = { priority, resolve, reject, detach: () => signal?.removeEventListener('abort', onAbort) };
      signal?.addEventListener('abort', onAbort, { once: true });
      const firstBackground = priority === 'interactive' ? this.queue.findIndex((queued) => queued.priority === 'background') : -1;
      if (firstBackground === -1) this.queue.push(waiter);
      else this.queue.splice(firstBackground, 0, waiter);
      this.pump();
    });
  }

  /** Nothing new starts on this connection for `ms`. Requests in flight are not touched. */
  hold(ms: number): void {
    this.heldUntil = Math.max(this.heldUntil, Date.now() + Math.max(0, ms));
    this.pump();
  }

  private pump(): void {
    const now = Date.now();
    this.starts = this.starts.filter((at) => at > now - MINUTE_MS);
    while (this.queue.length > 0 && this.active < this.limits.maxParallel) {
      if (now < this.heldUntil) return this.wake(this.heldUntil - now);
      const perMinute = this.limits.requestsPerMinute;
      if (perMinute !== null && this.starts.length >= perMinute) return this.wake(this.starts[0] + MINUTE_MS - now);

      const waiter = this.queue.shift() as Waiter;
      waiter.detach();
      this.active++;
      this.starts.push(now);
      waiter.resolve(this.releaser());
    }
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.pump();
    };
  }

  private wake(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, ms);
    this.timer.unref?.();
  }
}

/** One limiter per saved connection, for this server instance. */
@Injectable()
export class AiLimiterService {
  private readonly limiters = new Map<number, AiConnectionLimiter>();

  for(connectionId: number): AiConnectionLimiter {
    let limiter = this.limiters.get(connectionId);
    if (!limiter) {
      limiter = new AiConnectionLimiter();
      this.limiters.set(connectionId, limiter);
    }
    return limiter;
  }
}
