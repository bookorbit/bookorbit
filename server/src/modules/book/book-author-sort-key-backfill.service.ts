import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { DB } from '../../db';
import { hasMissingPrimaryAuthorSortNames, refreshMissingPrimaryAuthorSortNames } from '../../db/book-author-sort-key';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class BookAuthorSortKeyBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookAuthorSortKeyBackfillService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap(): Promise<void> {
    const event = 'book.author_sort_key_backfill';
    const startedAt = Date.now();

    try {
      const hasMissing = await hasMissingPrimaryAuthorSortNames(this.db);
      if (!hasMissing) return;

      this.logger.log(`[${event}] [start] version=1 - primary author sort key backfill started`);
      const updatedRows = await refreshMissingPrimaryAuthorSortNames(this.db);
      this.logger.log(
        `[${event}] [end] version=1 durationMs=${Date.now() - startedAt} updatedRows=${updatedRows} - primary author sort key backfill completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] version=1 durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - primary author sort key backfill failed`,
      );
    }
  }
}
