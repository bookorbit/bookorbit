import { Injectable } from '@nestjs/common';

export interface ScanEntry {
  jobId: number;
  libraryId: number;
  processed: number;
  total: number;
  added: number;
  updated: number;
  missing: number;
  lastEmitMs: number;
  lastEmitPct: number;
}

@Injectable()
export class ScanJobStore {
  private readonly byLibrary = new Map<number, ScanEntry>();
  private readonly pendingRescan = new Set<number>();
  private readonly scanStartLock = new Set<number>();

  isRunning(libraryId: number): boolean {
    return this.byLibrary.has(libraryId);
  }

  isStartLocked(libraryId: number): boolean {
    return this.scanStartLock.has(libraryId);
  }

  acquireStartLock(libraryId: number): boolean {
    if (this.scanStartLock.has(libraryId)) return false;
    this.scanStartLock.add(libraryId);
    return true;
  }

  releaseStartLock(libraryId: number): void {
    this.scanStartLock.delete(libraryId);
  }

  markPendingRescan(libraryId: number): void {
    this.pendingRescan.add(libraryId);
  }

  consumePendingRescan(libraryId: number): boolean {
    return this.pendingRescan.delete(libraryId);
  }

  create(jobId: number, libraryId: number, total: number): ScanEntry {
    const entry: ScanEntry = {
      jobId,
      libraryId,
      processed: 0,
      total,
      added: 0,
      updated: 0,
      missing: 0,
      lastEmitMs: 0,
      lastEmitPct: -1,
    };
    this.byLibrary.set(libraryId, entry);
    return entry;
  }

  setTotal(libraryId: number, total: number): void {
    const entry = this.byLibrary.get(libraryId);
    if (entry) entry.total = total;
  }

  increment(libraryId: number, delta: { processed?: number; added?: number; updated?: number; missing?: number }): ScanEntry | undefined {
    const entry = this.byLibrary.get(libraryId);
    if (!entry) return undefined;
    if (delta.processed !== undefined) entry.processed += delta.processed;
    if (delta.added !== undefined) entry.added += delta.added;
    if (delta.updated !== undefined) entry.updated += delta.updated;
    if (delta.missing !== undefined) entry.missing += delta.missing;
    return entry;
  }

  get(libraryId: number): ScanEntry | undefined {
    return this.byLibrary.get(libraryId);
  }

  shouldEmit(entry: ScanEntry): boolean {
    if (entry.total > 0 && entry.processed >= entry.total) return true;
    const pct = entry.total > 0 ? Math.floor((entry.processed / entry.total) * 100) : 0;
    if (pct >= entry.lastEmitPct + 1) return true;
    return Date.now() - entry.lastEmitMs >= 1000;
  }

  markEmitted(entry: ScanEntry): void {
    entry.lastEmitMs = Date.now();
    entry.lastEmitPct = entry.total > 0 ? Math.floor((entry.processed / entry.total) * 100) : 0;
  }

  delete(libraryId: number): void {
    this.byLibrary.delete(libraryId);
  }
}
