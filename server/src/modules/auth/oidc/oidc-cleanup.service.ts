import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { lt, or, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class OidcCleanupService {
  private readonly logger = new Logger(OidcCleanupService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runCleanup(): Promise<void> {
    const start = Date.now();
    this.logger.log('[auth.oidc_cleanup] [start] - OIDC cleanup started');
    try {
      const now = new Date();

      const [sessions, states, jtis] = await Promise.all([
        this.db
          .delete(schema.oidcSessions)
          .where(or(lt(schema.oidcSessions.expiresAt, now), eq(schema.oidcSessions.revoked, true)))
          .returning({ id: schema.oidcSessions.id }),
        this.db.delete(schema.oidcStates).where(lt(schema.oidcStates.expiresAt, now)).returning({ state: schema.oidcStates.state }),
        this.db.delete(schema.oidcUsedJtis).where(lt(schema.oidcUsedJtis.expiresAt, now)).returning({ jti: schema.oidcUsedJtis.jti }),
      ]);

      this.logger.log(
        `[auth.oidc_cleanup] [end] durationMs=${Date.now() - start} deletedSessions=${sessions.length} deletedStates=${states.length} deletedJtis=${jtis.length} - OIDC cleanup completed`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[auth.oidc_cleanup] [fail] durationMs=${Date.now() - start} errorClass=${errorClass} error="${errorMsg}" - OIDC cleanup failed`,
      );
    }
  }
}
