import { Injectable } from '@nestjs/common';
import type { MetadataCacheCounters } from '@bookorbit/types';

import { ACCESS_MAX_TRACKED_KEYS, BUDGET_SWEEP_THRESHOLD } from './metadata-cache.constants';

/** Since-boot counters for the stats endpoint. */
@Injectable()
export class MetadataCacheCounterService {
  private readonly counters: MetadataCacheCounters = {
    hits: 0,
    misses: 0,
    fallbacks: 0,
    liveCalls: 0,
    writes: 0,
    skippedWrites: 0,
    writeFailures: 0,
    readFailures: 0,
    uncacheable: {},
  };

  increment(counter: Exclude<keyof MetadataCacheCounters, 'uncacheable'>): void {
    this.counters[counter] += 1;
  }

  uncacheable(reason: string): void {
    this.counters.uncacheable[reason] = (this.counters.uncacheable[reason] ?? 0) + 1;
  }

  snapshot(): MetadataCacheCounters {
    return { ...this.counters, uncacheable: { ...this.counters.uncacheable } };
  }
}

/**
 * Live payload bytes, recomputed by every sweep and adjusted on each write and delete. Admission is
 * based on this rather than on table size, which does not shrink after deletes and could otherwise
 * keep writes closed forever.
 */
@Injectable()
export class MetadataCacheBudget {
  private liveBytes = 0;

  set(bytes: number): void {
    this.liveBytes = Math.max(0, bytes);
  }

  add(bytes: number): void {
    if (!Number.isFinite(bytes)) return;
    this.liveBytes = Math.max(0, this.liveBytes + bytes);
  }

  subtract(bytes: number): void {
    this.liveBytes = Math.max(0, this.liveBytes - bytes);
  }

  get bytes(): number {
    return this.liveBytes;
  }

  admits(maxBytes: number): boolean {
    return this.liveBytes < maxBytes;
  }

  needsSweep(maxBytes: number): boolean {
    return this.liveBytes > maxBytes * BUDGET_SWEEP_THRESHOLD;
  }
}

/** Keys answered from the cache, flushed in batches so reads do not each become a write. */
@Injectable()
export class MetadataCacheAccessTracker {
  private readonly touched = new Set<string>();

  record(keyHash: string): void {
    if (this.touched.size >= ACCESS_MAX_TRACKED_KEYS) return;
    this.touched.add(keyHash);
  }

  drain(): string[] {
    const keys = [...this.touched];
    this.touched.clear();
    return keys;
  }
}
