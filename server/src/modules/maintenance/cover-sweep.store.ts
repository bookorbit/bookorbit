import { Injectable } from '@nestjs/common';
import type { CoverSweepStatus } from '@bookorbit/types';

/**
 * Sweep results are held in memory rather than a table: a sweep is cheap to repeat, its
 * findings go stale the moment a cover is re-extracted, and every cleanup re-verifies on
 * disk before touching anything. Retention is capped so a large library cannot grow the heap.
 */
export const MAX_SWEEP_ENTRIES = 50_000;
export const SWEEP_TTL_MS = 30 * 60 * 1000;
const MAX_TRACKED_USERS = 8;

export interface OrphanedCoverDir {
  bookId: number;
  fileCount: number;
  sizeBytes: number;
}

export interface SweepRecord {
  status: CoverSweepStatus;
  libraryIds: number[];
  startedAt: number;
  completedAt: number | null;
  processedBooks: number;
  totalBooks: number | null;
  brokenCoverBookIds: number[];
  brokenCoverCount: number;
  orphanedCoverDirs: OrphanedCoverDir[];
  orphanedCoverDirCount: number;
  orphanedBytes: number;
  truncated: boolean;
  errorCode: string | null;
}

@Injectable()
export class CoverSweepStore {
  private readonly byUser = new Map<number, SweepRecord>();

  get(userId: number): SweepRecord | undefined {
    const record = this.byUser.get(userId);
    if (!record) return undefined;
    if (record.status !== 'running' && Date.now() - (record.completedAt ?? record.startedAt) > SWEEP_TTL_MS) {
      this.byUser.delete(userId);
      return undefined;
    }
    return record;
  }

  isRunning(userId: number): boolean {
    return this.get(userId)?.status === 'running';
  }

  start(userId: number, libraryIds: number[]): SweepRecord {
    const record: SweepRecord = {
      status: 'running',
      libraryIds,
      startedAt: Date.now(),
      completedAt: null,
      processedBooks: 0,
      totalBooks: null,
      brokenCoverBookIds: [],
      brokenCoverCount: 0,
      orphanedCoverDirs: [],
      orphanedCoverDirCount: 0,
      orphanedBytes: 0,
      truncated: false,
      errorCode: null,
    };
    this.evictOldest();
    this.byUser.set(userId, record);
    return record;
  }

  fail(userId: number, errorCode: string): void {
    const record = this.byUser.get(userId);
    if (!record) return;
    record.status = 'failed';
    record.errorCode = errorCode;
    record.completedAt = Date.now();
  }

  complete(userId: number): void {
    const record = this.byUser.get(userId);
    if (!record) return;
    record.status = 'completed';
    record.completedAt = Date.now();
  }

  addBrokenCovers(record: SweepRecord, bookIds: number[]): void {
    record.brokenCoverCount += bookIds.length;
    const room = MAX_SWEEP_ENTRIES - record.brokenCoverBookIds.length;
    if (room <= 0) {
      if (bookIds.length > 0) record.truncated = true;
      return;
    }
    if (bookIds.length > room) record.truncated = true;
    record.brokenCoverBookIds.push(...bookIds.slice(0, room));
  }

  addOrphanedCoverDirs(record: SweepRecord, dirs: OrphanedCoverDir[]): void {
    record.orphanedCoverDirCount += dirs.length;
    record.orphanedBytes += dirs.reduce((total, dir) => total + dir.sizeBytes, 0);
    const room = MAX_SWEEP_ENTRIES - record.orphanedCoverDirs.length;
    if (room <= 0) {
      if (dirs.length > 0) record.truncated = true;
      return;
    }
    if (dirs.length > room) record.truncated = true;
    record.orphanedCoverDirs.push(...dirs.slice(0, room));
  }

  private evictOldest(): void {
    while (this.byUser.size >= MAX_TRACKED_USERS) {
      const entries = [...this.byUser.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
      const victim = entries.find(([, record]) => record.status !== 'running') ?? entries[0];
      if (!victim) return;
      this.byUser.delete(victim[0]);
    }
  }
}
