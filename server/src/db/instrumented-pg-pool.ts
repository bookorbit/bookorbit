import { Logger } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';

type ConnectCallback = (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void;
type AcquisitionKind = 'idle' | 'new' | 'queued';

/** Pool counters, sampled at one instant. */
interface PoolCounts {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export class InstrumentedPgPool extends Pool {
  private readonly logger = new Logger(InstrumentedPgPool.name);

  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const startedAt = Date.now();
    const acquisitionKind = this.classifyAcquisition();
    // Sampled now, not when the line is written. A failing acquire logs five
    // seconds after it began, by which time whatever was holding the pool has
    // usually finished, so the counters read at log time describe the
    // recovery, not the problem. See `logAcquire`.
    const countsAtStart = this.counts();

    if (callback) {
      super.connect((error, client, done) => {
        this.logAcquire(startedAt, acquisitionKind, countsAtStart, error);
        callback(error, client, done);
      });
      return;
    }

    return super.connect().then(
      (client) => {
        this.logAcquire(startedAt, acquisitionKind, countsAtStart);
        return client;
      },
      (error: unknown) => {
        this.logAcquire(startedAt, acquisitionKind, countsAtStart, error);
        throw error;
      },
    );
  }

  private counts(): PoolCounts {
    return { totalCount: this.totalCount, idleCount: this.idleCount, waitingCount: this.waitingCount };
  }

  private classifyAcquisition(): AcquisitionKind {
    if (this.idleCount > 0) return 'idle';
    if (this.waitingCount > 0 || this.totalCount >= this.options.max) return 'queued';
    return 'new';
  }

  /**
   * Report the pool as it was when the acquire *began*, and again as it is now.
   *
   * These lines previously carried only the counters read at log time. For a
   * failure that is five seconds after the fact, and it made a saturated pool
   * look like an impossible one: a real incident logged
   * `idleCount=9 waitingCount=0` on every failure, which reads as nine
   * connections sitting unused while acquisition timed out. They were not
   * unused during the wait. Three expensive requests held the pool at
   * `totalCount=19` of `max: 20`, and by the time the timeout fired and the
   * line was written they had finished and released — so the log described the
   * recovery and hid the cause.
   *
   * `acquisitionKind` has the same problem in the other direction: it is
   * sampled before `super.connect()` and nothing holds the idle connection it
   * saw, so a concurrent acquire can take it first. That is how a failure comes
   * to be labelled `acquisitionKind=idle` — it was idle when we looked, and
   * gone when we asked.
   */
  private logAcquire(startedAt: number, acquisitionKind: AcquisitionKind, atStart: PoolCounts, error?: unknown): void {
    if (acquisitionKind === 'idle' && !error) return;
    const durationMs = Date.now() - startedAt;
    const start = `startTotal=${atStart.totalCount} startIdle=${atStart.idleCount} startWaiting=${atStart.waitingCount}`;
    const now = `totalCount=${this.totalCount} idleCount=${this.idleCount} waitingCount=${this.waitingCount}`;

    if (error) {
      const errorClass = error instanceof Error ? error.constructor.name : typeof error;
      const message = sanitizeLogValue(error instanceof Error ? error.message : error);
      this.logger.warn(
        `[db.pool_acquire] [fail] acquisitionKind=${acquisitionKind} durationMs=${durationMs} ${start} ${now} errorClass=${errorClass} error="${message}" - database connection acquisition failed`,
      );
      return;
    }

    this.logger.debug(
      `[db.pool_acquire] [end] acquisitionKind=${acquisitionKind} durationMs=${durationMs} ${start} ${now} - database connection acquired`,
    );
  }
}
