import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { AudioCoverEmbedProgressEvent } from '@bookorbit/types';

import type { BulkRunRow } from '../../db/schema';
import type { BulkItemOutcome, BulkRunHandler, BulkRunItemContext } from '../bulk-runs/bulk-run-handler';
import { BulkRunHandlerRegistry } from '../bulk-runs/bulk-run-handler.registry';
import { BookService, type BulkBookSkipCode } from './book.service';

/** What a refresh stream says about a book passed over, in the `error` field the page already shows. */
const REFRESH_SKIP_MESSAGES: Record<BulkBookSkipCode, string> = {
  'not-found': 'Book not found',
  'no-access': 'No longer accessible',
};

/**
 * Bulk metadata refresh. Each book's event carries the refreshed detail to whoever follows the run;
 * the detail is never stored. The final `processed` counts successes and `failed` every other book,
 * as the route always reported.
 */
@Injectable()
export class BookRefreshMetadataBulkHandler implements BulkRunHandler<null>, OnModuleInit {
  readonly kind = 'book-refresh-metadata' as const;

  constructor(
    private readonly registry: BulkRunHandlerRegistry,
    private readonly books: BookService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  prepare(): Promise<{ state: null }> {
    return Promise.resolve({ state: null });
  }

  async processItem(id: number, { run, actor }: BulkRunItemContext<null>): Promise<BulkItemOutcome> {
    const item = await this.books.refreshMetadataBulkItem(id, actor, { ignoreCache: run.options.ignoreCache === true });
    switch (item.status) {
      case 'success':
        return { outcome: 'succeeded', event: { bookId: id, success: true, detail: item.detail } };
      case 'failed':
        return { outcome: 'failed', code: 'refresh-failed', message: item.error, event: { bookId: id, success: false, error: item.error } };
      case 'skipped':
        return { outcome: 'skipped', code: item.code, event: { bookId: id, success: false, error: REFRESH_SKIP_MESSAGES[item.code] } };
    }
  }

  async finish(): Promise<void> {}

  doneEvent(run: BulkRunRow): object {
    return { done: true, processed: run.succeeded, failed: run.failed + run.skipped };
  }
}

/**
 * Bulk cover re-extraction from each book's own files. Only a book with an unlocked slot to extract
 * is attempted and gets an event; the final `processed` counts those attempts, plus `updated`.
 */
@Injectable()
export class BookReExtractCoverBulkHandler implements BulkRunHandler<null>, OnModuleInit {
  readonly kind = 'book-re-extract-cover' as const;

  constructor(
    private readonly registry: BulkRunHandlerRegistry,
    private readonly books: BookService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  prepare(): Promise<{ state: null }> {
    return Promise.resolve({ state: null });
  }

  async processItem(id: number, { actor }: BulkRunItemContext<null>): Promise<BulkItemOutcome> {
    const item = await this.books.reExtractCoverBulkItem(id, actor);
    switch (item.status) {
      case 'attempted':
        return { outcome: 'succeeded', stats: item.updated ? { updated: 1 } : undefined, event: { bookId: id } };
      case 'no-source':
        return { outcome: 'skipped', code: 'no-cover-source' };
      case 'locked':
        return { outcome: 'skipped', code: 'locked' };
      case 'skipped':
        return { outcome: 'skipped', code: item.code };
    }
  }

  async finish(): Promise<void> {}

  doneEvent(run: BulkRunRow): object {
    return { done: true, processed: run.succeeded, updated: run.stats.updated ?? 0 };
  }
}

export interface EmbedAudioCoverRunState {
  /** The books still to do that hold a read-along EPUB; only these are visited. */
  candidates: Set<number>;
}

/**
 * Bulk audiobook cover embed into read-along EPUBs. `started` counts the books still to do that hold
 * one, and only those get an event; the rest count as skipped without a visit.
 */
@Injectable()
export class BookEmbedAudioCoverBulkHandler implements BulkRunHandler<EmbedAudioCoverRunState>, OnModuleInit {
  readonly kind = 'book-embed-audio-cover' as const;

  constructor(
    private readonly registry: BulkRunHandlerRegistry,
    private readonly books: BookService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async prepare(run: BulkRunRow): Promise<{ state: EmbedAudioCoverRunState }> {
    return { state: { candidates: await this.books.findReadAlongBookIds(run.subjectIds.slice(run.processed)) } };
  }

  startEvent(_run: BulkRunRow, state: EmbedAudioCoverRunState): AudioCoverEmbedProgressEvent {
    return { started: true, total: state.candidates.size };
  }

  async processItem(id: number, { actor, state }: BulkRunItemContext<EmbedAudioCoverRunState>): Promise<BulkItemOutcome> {
    if (!state.candidates.has(id)) return { outcome: 'skipped', code: 'no_read_along_file' };
    const result = await this.books.embedAudioCoverBulkItem(id, actor);
    const event: AudioCoverEmbedProgressEvent = { bookId: id, status: result.status, reason: result.reason };
    if (result.status === 'success') return { outcome: 'succeeded', event };
    if (result.status === 'failed') return { outcome: 'failed', code: result.code, message: result.reason, event };
    return { outcome: 'skipped', code: result.code, event };
  }

  async finish(): Promise<void> {}

  doneEvent(run: BulkRunRow): AudioCoverEmbedProgressEvent {
    return {
      done: true,
      processed: run.processed,
      succeeded: run.succeeded,
      failed: run.failed,
      skipped: run.skipped,
      cancelled: run.status === 'cancelled',
    };
  }
}
