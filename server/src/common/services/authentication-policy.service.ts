import { ConflictException, ForbiddenException, Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, ne, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { LoginErrorCode } from '@bookorbit/types';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
export type AuthPolicyTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

const ADMIN_AUTH_AVAILABILITY_LOCK_KEY = 'bookorbit:administrator-auth-availability';

@Injectable()
export class AuthenticationPolicyService implements OnApplicationBootstrap {
  constructor(
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: Db,
  ) {}

  isPasswordLoginEnabled(): boolean {
    return this.config.get<boolean>('auth.passwordLoginEnabled') !== false;
  }

  assertPasswordLoginEnabled(): void {
    if (this.isPasswordLoginEnabled()) return;
    throw new ForbiddenException({
      message: 'Password authentication is disabled',
      errorCode: LoginErrorCode.PASSWORD_AUTH_DISABLED,
    });
  }

  async lockAdministratorAvailability(tx: AuthPolicyTransaction): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ADMIN_AUTH_AVAILABILITY_LOCK_KEY})::bigint)`);
  }

  async hasUsableOidcSuperuser(tx: AuthPolicyTransaction, excludedUserId?: number): Promise<boolean> {
    const exclusion = excludedUserId === undefined ? sql`true` : sql`${schema.users.id} <> ${excludedUserId}`;
    const rows = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.oidcIdentities, eq(schema.oidcIdentities.userId, schema.users.id))
      .innerJoin(schema.oidcProviders, eq(schema.oidcProviders.id, schema.oidcIdentities.providerId))
      .where(and(eq(schema.users.active, true), eq(schema.users.isSuperuser, true), eq(schema.oidcProviders.enabled, true), exclusion))
      .limit(1);
    return rows.length > 0;
  }

  async hasUsableOidcSuperuserOutsideProvider(tx: AuthPolicyTransaction, providerId: number): Promise<boolean> {
    const rows = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.oidcIdentities, eq(schema.oidcIdentities.userId, schema.users.id))
      .innerJoin(schema.oidcProviders, eq(schema.oidcProviders.id, schema.oidcIdentities.providerId))
      .where(
        and(
          eq(schema.users.active, true),
          eq(schema.users.isSuperuser, true),
          eq(schema.oidcProviders.enabled, true),
          ne(schema.oidcProviders.id, providerId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async hasEnabledOidcIdentityForUser(tx: AuthPolicyTransaction, userId: number): Promise<boolean> {
    const rows = await tx
      .select({ id: schema.oidcIdentities.id })
      .from(schema.oidcIdentities)
      .innerJoin(schema.oidcProviders, eq(schema.oidcProviders.id, schema.oidcIdentities.providerId))
      .where(and(eq(schema.oidcIdentities.userId, userId), eq(schema.oidcProviders.enabled, true)))
      .limit(1);
    return rows.length > 0;
  }

  async assertProviderAuthenticationCanChange(tx: AuthPolicyTransaction, providerId: number): Promise<void> {
    if (this.isPasswordLoginEnabled() || (await this.hasUsableOidcSuperuserOutsideProvider(tx, providerId))) return;
    throw new ConflictException('Cannot change the only OIDC provider available to administrators while password authentication is disabled');
  }

  async assertUsableOidcSuperuser(tx: AuthPolicyTransaction): Promise<void> {
    if (this.isPasswordLoginEnabled() || (await this.hasUsableOidcSuperuser(tx))) return;
    throw new ConflictException('Cannot remove the last administrator sign-in method while password authentication is disabled');
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.isPasswordLoginEnabled()) return;
    const ready = await this.db.transaction(async (tx) => {
      await this.lockAdministratorAvailability(tx);
      return this.hasUsableOidcSuperuser(tx);
    });
    if (!ready) {
      throw new Error(
        'DISABLE_LOCAL_AUTH requires at least one active superuser linked to an enabled OIDC provider. Set DISABLE_LOCAL_AUTH=false, restart BookOrbit, configure and link OIDC, then enable it again.',
      );
    }
  }
}
