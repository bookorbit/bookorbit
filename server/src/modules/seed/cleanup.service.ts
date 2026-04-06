import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { eq, isNotNull, lt, or } from 'drizzle-orm';
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

  private async hasAuthStateTables(): Promise<boolean> {
    const result = await this.db.execute<{ table_name: string }>(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('refresh_tokens', 'password_reset_tokens', 'oidc_sessions')
    `);
    return result.rows.length === 3;
  }

  @Cron('0 3 * * *')
  async cleanup() {
    const startedAt = Date.now();
    const event = 'seed.cleanup_auth_state';
    this.logger.log(`[${event}] [start] - auth state cleanup started`);
    try {
      if (!(await this.hasAuthStateTables())) {
        this.logger.log(`[${event}] [end] skipped=true reason=auth_tables_missing durationMs=${Date.now() - startedAt} - auth state cleanup skipped`);
        return;
      }

      const now = new Date();

      const { rowCount: refreshCount } = await this.db
        .delete(schema.refreshTokens)
        .where(or(lt(schema.refreshTokens.expiresAt, now), isNotNull(schema.refreshTokens.revokedAt)));

      const { rowCount: resetCount } = await this.db
        .delete(schema.passwordResetTokens)
        .where(or(lt(schema.passwordResetTokens.expiresAt, now), isNotNull(schema.passwordResetTokens.usedAt)));

      const { rowCount: oidcCount } = await this.db
        .delete(schema.oidcSessions)
        .where(or(lt(schema.oidcSessions.expiresAt, now), eq(schema.oidcSessions.revoked, true)));

      this.logger.log(
        `[${event}] [end] refreshDeleted=${refreshCount ?? 0} resetDeleted=${resetCount ?? 0} oidcDeleted=${oidcCount ?? 0} durationMs=${Date.now() - startedAt} - auth state cleanup completed`,
      );
    } catch (error) {
      const { errorClass, errorMessage } = getSanitizedErrorInfo(error);
      this.logger.error(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - auth state cleanup failed`,
      );
      throw error;
    }
  }
}
