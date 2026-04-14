import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class OidcIdentityRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findByProviderAndSubject(providerId: number, oidcSubject: string) {
    return this.db.query.oidcIdentities.findFirst({
      where: and(eq(schema.oidcIdentities.providerId, providerId), eq(schema.oidcIdentities.oidcSubject, oidcSubject)),
    });
  }

  async findByIssuerAndSubject(oidcIssuer: string, oidcSubject: string) {
    return this.db.query.oidcIdentities.findFirst({
      where: and(eq(schema.oidcIdentities.oidcIssuer, oidcIssuer), eq(schema.oidcIdentities.oidcSubject, oidcSubject)),
    });
  }

  async findByUser(userId: number) {
    return this.db
      .select({
        id: schema.oidcIdentities.id,
        providerId: schema.oidcIdentities.providerId,
        providerSlug: schema.oidcProviders.slug,
        providerName: schema.oidcProviders.displayName,
        providerIconUrl: schema.oidcProviders.iconUrl,
        oidcSubject: schema.oidcIdentities.oidcSubject,
        oidcIssuer: schema.oidcIdentities.oidcIssuer,
        linkedAt: schema.oidcIdentities.linkedAt,
      })
      .from(schema.oidcIdentities)
      .innerJoin(schema.oidcProviders, eq(schema.oidcIdentities.providerId, schema.oidcProviders.id))
      .where(eq(schema.oidcIdentities.userId, userId));
  }

  async findByUserAndProvider(userId: number, providerId: number) {
    return this.db.query.oidcIdentities.findFirst({
      where: and(eq(schema.oidcIdentities.userId, userId), eq(schema.oidcIdentities.providerId, providerId)),
    });
  }

  async create(data: { userId: number; providerId: number; oidcSubject: string; oidcIssuer: string }) {
    const [row] = await this.db.insert(schema.oidcIdentities).values(data).returning();
    return row;
  }

  async remove(userId: number, providerId: number) {
    const [row] = await this.db
      .delete(schema.oidcIdentities)
      .where(and(eq(schema.oidcIdentities.userId, userId), eq(schema.oidcIdentities.providerId, providerId)))
      .returning();
    return row ?? null;
  }

  async removeAllForUser(userId: number) {
    await this.db.delete(schema.oidcIdentities).where(eq(schema.oidcIdentities.userId, userId));
  }

  async countByUser(userId: number): Promise<number> {
    const rows = await this.db.select({ id: schema.oidcIdentities.id }).from(schema.oidcIdentities).where(eq(schema.oidcIdentities.userId, userId));
    return rows.length;
  }
}
