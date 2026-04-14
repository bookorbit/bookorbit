import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { and, gt, lt, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class OidcStateService {
  private readonly ttlMs: number;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly configService: ConfigService,
  ) {
    this.ttlMs = this.configService.get<number>('oidcRuntime.stateTtlMs') ?? 5 * 60 * 1000;
  }

  async generate(providerId: number, meta?: Record<string, unknown>): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);

    await Promise.all([
      this.db.delete(schema.oidcStates).where(lt(schema.oidcStates.expiresAt, new Date())),
      this.db.insert(schema.oidcStates).values({ state, providerId, expiresAt, meta: meta ? JSON.stringify(meta) : null }),
    ]);

    return state;
  }

  async validateAndConsume(state: string): Promise<{ valid: boolean; providerId?: number; meta?: Record<string, unknown> }> {
    const deleted = await this.db
      .delete(schema.oidcStates)
      .where(and(eq(schema.oidcStates.state, state), gt(schema.oidcStates.expiresAt, new Date())))
      .returning();

    if (deleted.length === 0) return { valid: false };
    const row = deleted[0];
    const meta = row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : undefined;
    return { valid: true, providerId: row.providerId, meta };
  }
}
