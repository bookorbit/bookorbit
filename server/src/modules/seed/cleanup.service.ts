import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { isNotNull, lt, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

@Injectable()
export class CleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CleanupService.name);

  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async onApplicationBootstrap() {
    await this.cleanup();
  }

  @Cron('0 3 * * *')
  async cleanup() {
    const now = new Date();

    const { rowCount: refreshCount } = await this.db
      .delete(schema.refreshTokens)
      .where(or(lt(schema.refreshTokens.expiresAt, now), isNotNull(schema.refreshTokens.revokedAt)));

    const { rowCount: resetCount } = await this.db
      .delete(schema.passwordResetTokens)
      .where(or(lt(schema.passwordResetTokens.expiresAt, now), isNotNull(schema.passwordResetTokens.usedAt)));

    if ((refreshCount ?? 0) + (resetCount ?? 0) > 0) {
      this.logger.log(`Token cleanup: removed ${refreshCount} refresh tokens, ${resetCount} reset tokens`);
    }
  }
}
