import { Injectable, Logger } from '@nestjs/common';

export const LIBRARY_OPERATION_KINDS = ['scan', 'book_move', 'bulk_rename', 'book_merge', 'library_delete'] as const;
export type LibraryOperationKind = (typeof LIBRARY_OPERATION_KINDS)[number];

export type LibraryOperationRelease = () => void;

/**
 * Proof that a caller holds the gate on some libraries for a long run, so work it starts inside the
 * run (a merge per duplicate group) can go ahead instead of refusing because the gate is held.
 */
export interface LibraryOperationLease {
  readonly kind: LibraryOperationKind;
  readonly libraryIds: readonly number[];
  holds(libraryId: number): boolean;
  release(): void;
}

interface GateHolder {
  kind: LibraryOperationKind;
  token: symbol;
  waiters: Array<() => void>;
}

/**
 * One operation that rewrites a library's folder layout at a time: a full or folder scan, a book
 * move, a bulk rename, a merge, or deleting the library. The registry is in-process, which holds
 * because BookOrbit runs a single server process per database. It is provided once, by CommonModule.
 */
@Injectable()
export class LibraryOperationGate {
  private readonly logger = new Logger(LibraryOperationGate.name);
  private readonly holders = new Map<number, GateHolder>();

  tryAcquire(libraryId: number, kind: LibraryOperationKind): LibraryOperationRelease | null {
    return this.tryAcquireAll([libraryId], kind);
  }

  /** Acquires every library or none, so a move between two libraries never holds just one. */
  tryAcquireAll(libraryIds: number[], kind: LibraryOperationKind): LibraryOperationRelease | null {
    const unique = [...new Set(libraryIds)];
    if (unique.some((libraryId) => this.holders.has(libraryId))) return null;

    const token = Symbol(kind);
    for (const libraryId of unique) {
      this.holders.set(libraryId, { kind, token, waiters: [] });
      this.logger.log(`[library_gate] [start] libraryId=${libraryId} kind=${kind} - library operation gate acquired`);
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const libraryId of unique) this.releaseOne(libraryId, token);
    };
  }

  /** Like `tryAcquireAll`, as a lease work started inside the run can check. */
  tryAcquireLease(libraryIds: number[], kind: LibraryOperationKind): LibraryOperationLease | null {
    const unique = [...new Set(libraryIds)].sort((a, b) => a - b);
    const release = this.tryAcquireAll(unique, kind);
    if (!release) return null;
    const token = this.holders.get(unique[0]!)?.token ?? null;
    let released = false;
    return {
      kind,
      libraryIds: unique,
      holds: (libraryId) => !released && token !== null && this.holders.get(libraryId)?.token === token,
      release: () => {
        released = true;
        release();
      },
    };
  }

  current(libraryId: number): LibraryOperationKind | null {
    return this.holders.get(libraryId)?.kind ?? null;
  }

  isHeld(libraryId: number): boolean {
    return this.holders.has(libraryId);
  }

  /** Resolves immediately when the library is free. */
  whenReleased(libraryId: number): Promise<void> {
    const holder = this.holders.get(libraryId);
    if (!holder) return Promise.resolve();
    return new Promise((resolve) => holder.waiters.push(resolve));
  }

  private releaseOne(libraryId: number, token: symbol): void {
    const holder = this.holders.get(libraryId);
    if (!holder || holder.token !== token) return;
    this.holders.delete(libraryId);
    this.logger.log(`[library_gate] [end] libraryId=${libraryId} kind=${holder.kind} - library operation gate released`);
    for (const resolve of holder.waiters) resolve();
  }
}
