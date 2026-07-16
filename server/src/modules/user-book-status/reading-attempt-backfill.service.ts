import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ReadingAttemptOutcome } from '@bookorbit/types';

import { resolveTimeZone, toDateKeyInTimeZone } from '../../common/utils/timezone.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ReadingAttemptRepository } from './reading-attempt.repository';

const BATCH_SIZE = 250;

@Injectable()
export class ReadingAttemptBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReadingAttemptBackfillService.name);

  constructor(private readonly repository: ReadingAttemptRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    const event = 'reading_attempt.backfill';
    const startedAt = Date.now();
    let migrated = 0;
    this.logger.log(`[${event}] [start] batchSize=${BATCH_SIZE} - reading attempt backfill started`);
    try {
      for (;;) {
        const rows = await this.repository.findLegacyBackfillCandidates(BATCH_SIZE);
        if (rows.length === 0) break;

        await this.repository.transaction(async (tx) => {
          for (const row of rows) {
            const timezone = resolveTimeZone((row.settings as { timezone?: unknown } | null)?.timezone, 'UTC');
            const startedOn = row.startedAt ? toDateKeyInTimeZone(row.startedAt, timezone) : null;
            const endedOn = row.finishedAt ? toDateKeyInTimeZone(row.finishedAt, timezone) : null;

            if (row.status === 'rereading') {
              await this.repository.create(tx, {
                userId: row.userId,
                bookId: row.bookId,
                startedOn: null,
                endedOn: null,
                outcome: 'completed',
                origin: 'migration',
              });
            }

            const outcome: ReadingAttemptOutcome | null =
              row.status === 'read' ? 'completed' : row.status === 'skimmed' ? 'skimmed' : row.status === 'abandoned' ? 'abandoned' : null;
            const attempt = await this.repository.create(tx, {
              userId: row.userId,
              bookId: row.bookId,
              startedOn,
              endedOn: outcome ? endedOn : null,
              outcome,
              origin: 'migration',
            });
            if (attempt && (startedOn || endedOn)) {
              await this.repository.attachBackfilledSessions(tx, row.userId, row.bookId, attempt.id, timezone, startedOn, endedOn);
            }
            migrated++;
          }
        });
        if (rows.length < BATCH_SIZE) break;
      }
      this.logger.log(`[${event}] [end] durationMs=${Date.now() - startedAt} migrated=${migrated} - reading attempt backfill completed`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - reading attempt backfill failed`,
      );
      throw error;
    }
  }
}
