import { Logger } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';

type ConnectCallback = (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void;
type AcquisitionKind = 'idle' | 'new' | 'queued';

export class InstrumentedPgPool extends Pool {
  private readonly logger = new Logger(InstrumentedPgPool.name);

  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const startedAt = Date.now();
    const acquisitionKind = this.classifyAcquisition();

    if (callback) {
      super.connect((error, client, done) => {
        this.logAcquire(startedAt, acquisitionKind, error);
        callback(error, client, done);
      });
      return;
    }

    return super.connect().then(
      (client) => {
        this.logAcquire(startedAt, acquisitionKind);
        return client;
      },
      (error: unknown) => {
        this.logAcquire(startedAt, acquisitionKind, error);
        throw error;
      },
    );
  }

  private classifyAcquisition(): AcquisitionKind {
    if (this.idleCount > 0) return 'idle';
    if (this.waitingCount > 0 || this.totalCount >= this.options.max) return 'queued';
    return 'new';
  }

  private logAcquire(startedAt: number, acquisitionKind: AcquisitionKind, error?: unknown): void {
    if (acquisitionKind === 'idle' && !error) return;
    const durationMs = Date.now() - startedAt;
    if (error) {
      const errorClass = error instanceof Error ? error.constructor.name : typeof error;
      const message = sanitizeLogValue(error instanceof Error ? error.message : error);
      this.logger.warn(
        `[db.pool_acquire] [fail] acquisitionKind=${acquisitionKind} durationMs=${durationMs} totalCount=${this.totalCount} idleCount=${this.idleCount} waitingCount=${this.waitingCount} errorClass=${errorClass} error="${message}" - database connection acquisition failed`,
      );
      return;
    }

    this.logger.debug(
      `[db.pool_acquire] [end] acquisitionKind=${acquisitionKind} durationMs=${durationMs} totalCount=${this.totalCount} idleCount=${this.idleCount} waitingCount=${this.waitingCount} - database connection acquired`,
    );
  }
}
