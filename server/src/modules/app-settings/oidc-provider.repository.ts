import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class OidcProviderRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAll() {
    return this.db.query.oidcProviders.findMany({
      orderBy: [asc(schema.oidcProviders.displayOrder), asc(schema.oidcProviders.id)],
    });
  }

  findEnabled() {
    return this.db.query.oidcProviders.findMany({
      where: eq(schema.oidcProviders.enabled, true),
      orderBy: [asc(schema.oidcProviders.displayOrder), asc(schema.oidcProviders.id)],
    });
  }

  findBySlug(slug: string) {
    return this.db.query.oidcProviders.findFirst({
      where: eq(schema.oidcProviders.slug, slug),
    });
  }

  findById(id: number) {
    return this.db.query.oidcProviders.findFirst({
      where: eq(schema.oidcProviders.id, id),
    });
  }

  findByIssuerUri(issuerUri: string) {
    return this.db.query.oidcProviders.findFirst({
      where: eq(schema.oidcProviders.issuerUri, issuerUri),
    });
  }

  async create(data: typeof schema.oidcProviders.$inferInsert) {
    const [row] = await this.db.insert(schema.oidcProviders).values(data).returning();
    return row;
  }

  async update(id: number, data: Partial<Omit<typeof schema.oidcProviders.$inferInsert, 'id'>>) {
    const [row] = await this.db.update(schema.oidcProviders).set(data).where(eq(schema.oidcProviders.id, id)).returning();
    return row ?? null;
  }

  async remove(id: number) {
    const [row] = await this.db.delete(schema.oidcProviders).where(eq(schema.oidcProviders.id, id)).returning();
    return row ?? null;
  }

  async reorder(orderedIds: number[]) {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(schema.oidcProviders).set({ displayOrder: i }).where(eq(schema.oidcProviders.id, orderedIds[i]));
      }
    });
  }

  async countLinkedIdentities(providerId: number): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.oidcIdentities)
      .where(eq(schema.oidcIdentities.providerId, providerId));
    return result?.count ?? 0;
  }

  findGroupMappingsByProvider(providerId: number) {
    return this.db.query.oidcGroupMappings.findMany({
      where: eq(schema.oidcGroupMappings.providerId, providerId),
      orderBy: [asc(schema.oidcGroupMappings.oidcGroupClaim)],
    });
  }

  async createGroupMapping(providerId: number, oidcGroupClaim: string, permissionName: string) {
    const [row] = await this.db.insert(schema.oidcGroupMappings).values({ providerId, oidcGroupClaim, permissionName }).returning();
    return row;
  }

  async updateGroupMapping(id: number, providerId: number, permissionName: string) {
    const [row] = await this.db
      .update(schema.oidcGroupMappings)
      .set({ permissionName })
      .where(and(eq(schema.oidcGroupMappings.id, id), eq(schema.oidcGroupMappings.providerId, providerId)))
      .returning();
    return row ?? null;
  }

  async deleteGroupMapping(id: number, providerId: number) {
    const [row] = await this.db
      .delete(schema.oidcGroupMappings)
      .where(and(eq(schema.oidcGroupMappings.id, id), eq(schema.oidcGroupMappings.providerId, providerId)))
      .returning();
    return row ?? null;
  }
}
