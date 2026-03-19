import { Injectable, Logger } from '@nestjs/common';
import { MetadataProviderKey, ProviderThrottleRuntimeSnapshot, ProviderThrottleRuntimeState } from '@projectx/types';

const DEFAULT_SCHEDULE = [120, 300, 600, 1800, 3600];

const PROVIDER_SCHEDULES: Partial<Record<MetadataProviderKey, number[]>> = {
  // Google Books free tier is 1,000 req/day — throttles aggressively on batch fetches
  [MetadataProviderKey.GOOGLE]: [600, 1800, 3600, 7200, 14400],
};

function scheduleFor(key: MetadataProviderKey): number[] {
  return PROVIDER_SCHEDULES[key] ?? DEFAULT_SCHEDULE;
}

@Injectable()
export class ProviderThrottleTracker {
  private readonly logger = new Logger(ProviderThrottleTracker.name);
  private readonly throttledUntil = new Map<MetadataProviderKey, number>();
  private readonly backoffLevel = new Map<MetadataProviderKey, number>();

  record(key: MetadataProviderKey, retryAfterSeconds?: number): void {
    const level = this.backoffLevel.get(key) ?? 0;
    const schedule = scheduleFor(key);
    const seconds = retryAfterSeconds ?? schedule[Math.min(level, schedule.length - 1)];
    const until = Date.now() + seconds * 1000;
    this.throttledUntil.set(key, until);
    this.backoffLevel.set(key, level + 1);
    this.logger.log(`[${key}] cooldown set until ${new Date(until).toISOString()} (${seconds}s, level ${level + 1})`);
  }

  isThrottled(key: MetadataProviderKey): boolean {
    const until = this.throttledUntil.get(key);
    return until !== undefined && Date.now() < until;
  }

  clearOnSuccess(key: MetadataProviderKey): void {
    const wasThrottled = this.throttledUntil.has(key);
    this.throttledUntil.delete(key);
    this.backoffLevel.delete(key);
    if (wasThrottled) {
      this.logger.log(`[${key}] throttle cleared after successful fetch`);
    }
  }

  hasAnyActive(): boolean {
    const now = Date.now();
    for (const until of this.throttledUntil.values()) {
      if (now < until) return true;
    }
    return false;
  }

  snapshot(keys: MetadataProviderKey[]): ProviderThrottleRuntimeSnapshot {
    const now = Date.now();
    const unique = [...new Set(keys)];
    return {
      observedAt: new Date(now).toISOString(),
      providers: unique.map((key) => this.buildState(key, now)),
    };
  }

  private buildState(key: MetadataProviderKey, now: number): ProviderThrottleRuntimeState {
    const until = this.throttledUntil.get(key);
    const throttled = until !== undefined && now < until;
    return {
      key,
      throttled,
      throttledUntil: throttled ? new Date(until).toISOString() : null,
      remainingSeconds: throttled ? Math.ceil((until - now) / 1000) : 0,
      backoffLevel: this.backoffLevel.get(key) ?? 0,
    };
  }
}
