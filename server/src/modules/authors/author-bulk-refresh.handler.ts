import { Injectable, type OnModuleInit } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';
import type { BulkItemOutcome, BulkRunHandler, BulkRunItemContext } from '../bulk-runs/bulk-run-handler';
import { BulkRunHandlerRegistry } from '../bulk-runs/bulk-run-handler.registry';
import { AuthorsService, type AuthorBulkRefreshScope } from './authors.service';

/** The event an attached stream gets per author, in the shape the route has always sent. */
export interface AuthorBulkRefreshEvent {
  authorId: number;
  updated: boolean;
  imageUpdated?: boolean;
  imageUrl?: string | null;
  error?: string;
}

export interface AuthorBulkRefreshState {
  ignoreCache: boolean;
  /** The libraries the actor may see and edit, worked out again whenever the run refreshes its actor. */
  scope: { actor: RequestUser; libraries: AuthorBulkRefreshScope } | null;
  /** Outbound requests of the author before, which paces the pause; null before the first author of this start. */
  previous: { outboundRequests: number | undefined } | null;
}

const SKIP_MESSAGES = {
  'not-found': 'Author not found',
  'no-access': 'Insufficient library access to mutate this author',
} as const;

/** Refreshes the metadata of a selection of authors, one at a time, pausing between them as the provider asks. */
@Injectable()
export class AuthorBulkRefreshHandler implements BulkRunHandler<AuthorBulkRefreshState>, OnModuleInit {
  readonly kind = 'author-refresh-metadata' as const;

  constructor(
    private readonly registry: BulkRunHandlerRegistry,
    private readonly authors: AuthorsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  prepare(run: BulkRunRow): Promise<{ state: AuthorBulkRefreshState }> {
    return Promise.resolve({ state: { ignoreCache: run.options.ignoreCache === true, scope: null, previous: null } });
  }

  async processItem(authorId: number, { run, actor, state }: BulkRunItemContext<AuthorBulkRefreshState>): Promise<BulkItemOutcome> {
    if (state.previous) await this.authors.pauseBetweenBulkAuthors(state.previous.outboundRequests);
    if (state.scope?.actor !== actor) state.scope = { actor, libraries: await this.authors.bulkRefreshScope(actor) };

    const access = await this.authors.bulkRefreshItemAccess(authorId, state.scope.libraries);
    if (access !== 'ok') return this.skipped(authorId, access, state);

    const result = await this.authors.refreshAuthorForBulk(authorId, state.ignoreCache, run.requestedBy ?? actor.id);
    if (result.kind === 'not-found') return this.skipped(authorId, 'not-found', state);
    if (result.kind === 'failed') {
      state.previous = { outboundRequests: undefined };
      const event: AuthorBulkRefreshEvent = { authorId, updated: false, imageUpdated: false, error: result.error };
      return { outcome: 'failed', code: 'refresh-failed', message: result.error, event };
    }
    state.previous = { outboundRequests: result.outboundRequests };
    const event: AuthorBulkRefreshEvent = { authorId, updated: result.updated, imageUpdated: result.imageUpdated, imageUrl: result.imageUrl };
    return { outcome: 'succeeded', stats: result.updated ? { updated: 1 } : undefined, event };
  }

  async finish(): Promise<void> {
    // Nothing to tear down: every author is its own unit of work.
  }

  /**
   * Today's `done`: `processed` counts every author reached and `failed` every one not refreshed,
   * those skipped as gone or out of reach included.
   */
  doneEvent(run: BulkRunRow): object {
    return { done: true, processed: run.processed, failed: run.failed + run.skipped, updated: run.stats.updated ?? 0 };
  }

  /** A skipped author makes no request, so the next one only yields. */
  private skipped(authorId: number, code: keyof typeof SKIP_MESSAGES, state: AuthorBulkRefreshState): BulkItemOutcome {
    state.previous = { outboundRequests: 0 };
    const event: AuthorBulkRefreshEvent = { authorId, updated: false, imageUpdated: false, error: SKIP_MESSAGES[code] };
    return { outcome: 'skipped', code, event };
  }
}
