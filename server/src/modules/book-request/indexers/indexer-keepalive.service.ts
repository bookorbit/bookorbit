import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { withDeadline } from '../../../common/utils/with-deadline.utils';
import { IndexerConfigService } from './indexer-config.service';
import { IndexerOperationLock } from './indexer-operation-lock';
import { IndexerRegistry } from './indexer-registry';

/**
 * How long one tracker gets to answer a keepalive.
 *
 * Generous, because a session refresh on a private tracker is several requests. Bounded at all
 * because the alternative is worse than a missed refresh: `running` is only cleared when the sweep
 * returns, so one adapter that never settles silently stops every future tick until a restart, and
 * nothing about that is visible except sessions quietly lapsing weeks later.
 */
const PER_INDEXER_TIMEOUT_MS = 60_000;

/**
 * Some trackers hand out a session that lapses on its own clock rather than on use, and the only
 * thing that surfaces the lapse is the next approval failing. Touching each of them on a schedule
 * moves that discovery to a background tick and, for adapters that rotate their session, keeps
 * the stored credential current while there is still a valid one to rotate from.
 *
 * Adapters that need nothing simply do not implement `keepalive`, so this costs a quiet instance
 * one query every six hours.
 */
@Injectable()
export class IndexerKeepaliveService {
  private readonly logger = new Logger(IndexerKeepaliveService.name);
  private running = false;

  constructor(
    private readonly indexers: IndexerConfigService,
    private readonly registry: IndexerRegistry,
    private readonly operationLock: IndexerOperationLock,
  ) {}

  @Cron('0 0 */6 * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.refreshSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[request_indexer.keepalive] [fail] error="${sanitizeLogValue(message)}" - keepalive tick failed`);
    } finally {
      this.running = false;
    }
  }

  private async refreshSessions(): Promise<void> {
    const configs = await this.indexers.resolveEnabledConfigs();

    for (const config of configs) {
      const adapter = this.registry.find(config.adapterType);
      if (!adapter?.keepalive) continue;
      // Nothing to refresh from: the stored session cannot be read, so a keepalive would open an
      // unauthenticated one and, for an adapter that rotates, write it back over the unreadable
      // original. The operator's fix is the encryption key, not another round trip.
      if (config.credentialError) {
        this.logger.warn(
          `[request_indexer.keepalive] [fail] indexerId=${config.id} error="${sanitizeLogValue(config.credentialError)}" - the stored credential could not be read, so the session was not refreshed`,
        );
        continue;
      }

      try {
        await this.operationLock.run(config.id, async () => {
          const current = await this.indexers.resolveConfig(config.id);
          const currentAdapter = this.registry.find(current.adapterType);
          if (!currentAdapter?.keepalive) return;
          // An adapter is handed no signal here, so nothing inside it is watching one: racing a
          // timer against the call is what makes a hang a logged failure rather than a keepalive
          // loop that silently never ticks again.
          await withDeadline(
            currentAdapter.keepalive(current),
            AbortSignal.timeout(PER_INDEXER_TIMEOUT_MS),
            () => new Error(`${current.name} did not answer in time`),
          );
        });
      } catch (error) {
        // One tracker being unreachable, or never answering at all, must not stop the others from
        // being kept alive - nor leave the latch above held for the life of the process.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[request_indexer.keepalive] [fail] indexerId=${config.id} error="${sanitizeLogValue(message)}" - could not refresh the tracker session`,
        );
      }
    }
  }
}
