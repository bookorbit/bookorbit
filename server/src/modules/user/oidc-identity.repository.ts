import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { AuthenticationPolicyService } from '../../common/services/authentication-policy.service';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class OidcIdentityRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authenticationPolicy: AuthenticationPolicyService,
  ) {}

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
    return this.db.transaction(async (tx) => {
      await this.authenticationPolicy.lockAdministratorAvailability(tx);
      const [row] = await tx
        .delete(schema.oidcIdentities)
        .where(and(eq(schema.oidcIdentities.userId, userId), eq(schema.oidcIdentities.providerId, providerId)))
        .returning();
      if (!row) return null;

      const user = await tx.query.users.findFirst({ where: eq(schema.users.id, userId) });
      const needsOidcMethod = !this.authenticationPolicy.isPasswordLoginEnabled() || user?.provisioningMethod === 'oidc';
      if (needsOidcMethod && !(await this.authenticationPolicy.hasEnabledOidcIdentityForUser(tx, userId))) {
        throw new ConflictException('Cannot unlink the last enabled sign-in provider for this account');
      }
      await this.authenticationPolicy.assertUsableOidcSuperuser(tx);
      return row;
    });
  }

  async removeAllForUser(userId: number) {
    await this.db.delete(schema.oidcIdentities).where(eq(schema.oidcIdentities.userId, userId));
  }

  async countByUser(userId: number): Promise<number> {
    const rows = await this.db.select({ id: schema.oidcIdentities.id }).from(schema.oidcIdentities).where(eq(schema.oidcIdentities.userId, userId));
    return rows.length;
  }
}
