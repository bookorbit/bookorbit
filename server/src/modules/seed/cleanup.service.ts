import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { isNotNull, lt, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { getSanitizedErrorInfo } from './seed-log.util';

@Injectable()
export class CleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CleanupService.name);

  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async onApplicationBootstrap() {
    await this.cleanup();
  }

  @Cron('0 3 * * *')
  async cleanup() {
    const startedAt = Date.now();
    const event = 'seed.cleanup_tokens';
    this.logger.log(`[${event}] [start] - token cleanup started`);
    try {
      const now = new Date();

      const { rowCount: refreshCount } = await this.db
        .delete(schema.refreshTokens)
        .where(or(lt(schema.refreshTokens.expiresAt, now), isNotNull(schema.refreshTokens.revokedAt)));

      const { rowCount: resetCount } = await this.db
        .delete(schema.passwordResetTokens)
        .where(or(lt(schema.passwordResetTokens.expiresAt, now), isNotNull(schema.passwordResetTokens.usedAt)));
      this.logger.log(
        `[${event}] [end] refreshDeleted=${refreshCount ?? 0} resetDeleted=${resetCount ?? 0} durationMs=${Date.now() - startedAt} - token cleanup completed`,
      );
    } catch (error) {
      const { errorClass, errorMessage } = getSanitizedErrorInfo(error);
      this.logger.error(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - token cleanup failed`,
      );
      throw error;
    }
  }
}
