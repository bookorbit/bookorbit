import type { BulkRunKind } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';

/** How one item went. `skipped` covers an item that is gone or no longer reachable. */
export interface BulkItemOutcome {
  outcome: 'succeeded' | 'failed' | 'skipped';
  /** A stable code for a failed or skipped item, such as `not-found` or `no-access`. */
  code?: string;
  /** A short message for a failure; sanitized and cut short before it is stored. */
  message?: string;
  /** Kind-specific counters to add, such as `{ updated: 1 }`. */
  stats?: Record<string, number>;
  /** The event attached streams get for this item, in the route's existing shape; never stored. */
  event?: object;
}

export interface BulkRunItemContext<S> {
  run: BulkRunRow;
  /** The account the run acts as, rechecked as the run goes; cut down to the key for a key run. */
  actor: RequestUser;
  /** What `prepare` returned. */
  state: S;
}

/** The run ended this way; `interrupted` is never passed, since a stopped server runs no code. */
export type BulkRunEnd = 'completed' | 'failed' | 'cancelled';

/**
 * One bulk run kind. The runner owns ordering, counters, cancellation, the actor and the streams;
 * the handler owns what one item means. A handler is registered by its feature module in
 * `onModuleInit` through `BulkRunHandlerRegistry`.
 */
export interface BulkRunHandler<S = unknown> {
  readonly kind: BulkRunKind;

  /** The kind tells its requester itself when a run completes; the runner still reports one that stops. */
  readonly notifiesCompletion?: boolean;

  /**
   * Setup before the first item still to do (`run.processed` onward), on every start, Continue
   * included. Answer `busy` to leave the run queued and let the dispatcher try another, as a move
   * does while one of its libraries is held by a scan.
   */
  prepare(run: BulkRunRow, actor: RequestUser): Promise<{ state: S } | 'busy'>;

  /** An event attached streams get once preparation ends, such as the embed route's `started`. */
  startEvent?(run: BulkRunRow, state: S): object | null;

  /** One item. A throw is recorded as a failure with code `error`; it never ends the run. */
  processItem(id: number, context: BulkRunItemContext<S>): Promise<BulkItemOutcome>;

  /** Teardown after the last item, a cancel or a failure; `state` is null when `prepare` never ran. */
  finish(run: BulkRunRow, state: S | null, end: BulkRunEnd): Promise<void>;

  /** The final `done` event, built from the settled row, keeping the route's existing meaning. */
  doneEvent(run: BulkRunRow): object;

  /** Whether an interrupted run may continue yet; a move waits for its libraries' boot rescan. */
  continuable?(run: Omit<BulkRunRow, 'subjectIds'>): boolean;
}
