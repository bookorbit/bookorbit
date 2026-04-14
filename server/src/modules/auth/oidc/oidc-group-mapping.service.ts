import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class OidcGroupMappingService {
  private readonly logger = new Logger(OidcGroupMappingService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Provider-scoped full-sync of OIDC group permissions.
   *
   * For the given provider, calculates which permissions the user should have
   * based on their group claims and the provider's group mappings. Updates
   * `oidc_permission_grants` for provenance tracking, then materializes the
   * effective union of all provider grants into `user_permissions`.
   */
  async syncUserGroups(userId: number, providerId: number, groups: string[]): Promise<void> {
    const start = Date.now();
    this.logger.log(`[auth.oidc_group_sync] [start] userId=${userId} providerId=${providerId} groupCount=${groups.length} - group sync started`);

    await this.db.transaction(async (tx) => {
      // Get mappings for this specific provider
      const providerMappings = await tx.query.oidcGroupMappings.findMany({
        where: eq(schema.oidcGroupMappings.providerId, providerId),
      });
      if (providerMappings.length === 0) {
        // No mappings for this provider - clean up any stale grants
        await tx
          .delete(schema.oidcPermissionGrants)
          .where(and(eq(schema.oidcPermissionGrants.userId, userId), eq(schema.oidcPermissionGrants.providerId, providerId)));
        return;
      }

      // Desired permissions based on user's groups and this provider's mappings
      const desired = new Set(
        providerMappings.filter((m) => m.permissionName && groups.includes(m.oidcGroupClaim)).map((m) => m.permissionName as string),
      );

      // Current grants for this provider
      const currentGrants = await tx.query.oidcPermissionGrants.findMany({
        where: and(eq(schema.oidcPermissionGrants.userId, userId), eq(schema.oidcPermissionGrants.providerId, providerId)),
      });
      const currentGrantPerms = new Set(currentGrants.map((g) => g.permissionName));

      const toAdd = [...desired].filter((p) => !currentGrantPerms.has(p));
      const toRemove = [...currentGrantPerms].filter((p) => !desired.has(p));

      // Update provenance table
      if (toAdd.length > 0) {
        await tx
          .insert(schema.oidcPermissionGrants)
          .values(toAdd.map((permissionName) => ({ userId, providerId, permissionName })))
          .onConflictDoNothing();
      }
      if (toRemove.length > 0) {
        await tx
          .delete(schema.oidcPermissionGrants)
          .where(
            and(
              eq(schema.oidcPermissionGrants.userId, userId),
              eq(schema.oidcPermissionGrants.providerId, providerId),
              inArray(schema.oidcPermissionGrants.permissionName, toRemove),
            ),
          );
      }

      // Now materialize: effective OIDC permissions = union across all providers
      const allGrants = await tx.query.oidcPermissionGrants.findMany({
        where: eq(schema.oidcPermissionGrants.userId, userId),
      });
      const effectiveOidcPerms = new Set(allGrants.map((g) => g.permissionName));

      // All OIDC-managed permission names (from all providers)
      const allMappings = await tx.query.oidcGroupMappings.findMany();
      const allOidcPermissions = new Set(allMappings.map((m) => m.permissionName).filter(Boolean) as string[]);

      // Current user permissions
      const currentUserPerms = await tx.query.userPermissions.findMany({
        where: eq(schema.userPermissions.userId, userId),
      });
      const currentUserPermSet = new Set(currentUserPerms.map((p) => p.permissionName));

      // Add OIDC-granted permissions not yet in user_permissions
      const permsToAdd = [...effectiveOidcPerms].filter((p) => !currentUserPermSet.has(p));
      // Remove OIDC-managed permissions that are no longer granted by any provider
      const permsToRemove = currentUserPerms
        .filter((p) => allOidcPermissions.has(p.permissionName) && !effectiveOidcPerms.has(p.permissionName))
        .map((p) => p.permissionName);

      if (permsToAdd.length > 0) {
        await tx
          .insert(schema.userPermissions)
          .values(permsToAdd.map((permissionName) => ({ userId, permissionName })))
          .onConflictDoNothing();
      }
      if (permsToRemove.length > 0) {
        await tx
          .delete(schema.userPermissions)
          .where(and(eq(schema.userPermissions.userId, userId), inArray(schema.userPermissions.permissionName, permsToRemove)));
      }

      this.logger.log(
        `[auth.oidc_group_sync] [end] userId=${userId} providerId=${providerId} durationMs=${Date.now() - start} added=${permsToAdd.length} removed=${permsToRemove.length} - group sync completed`,
      );
    });
  }

  async removeProviderGrants(userId: number, providerId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Remove grants from this provider
      await tx
        .delete(schema.oidcPermissionGrants)
        .where(and(eq(schema.oidcPermissionGrants.userId, userId), eq(schema.oidcPermissionGrants.providerId, providerId)));

      // Recalculate effective permissions from remaining providers
      const remainingGrants = await tx.query.oidcPermissionGrants.findMany({
        where: eq(schema.oidcPermissionGrants.userId, userId),
      });
      const effectiveOidcPerms = new Set(remainingGrants.map((g) => g.permissionName));

      // Get all OIDC-managed permission names
      const allMappings = await tx.query.oidcGroupMappings.findMany();
      const allOidcPermissions = new Set(allMappings.map((m) => m.permissionName).filter(Boolean) as string[]);

      // Remove user permissions that were OIDC-managed but no longer granted
      const currentUserPerms = await tx.query.userPermissions.findMany({
        where: eq(schema.userPermissions.userId, userId),
      });
      const permsToRemove = currentUserPerms
        .filter((p) => allOidcPermissions.has(p.permissionName) && !effectiveOidcPerms.has(p.permissionName))
        .map((p) => p.permissionName);

      if (permsToRemove.length > 0) {
        await tx
          .delete(schema.userPermissions)
          .where(and(eq(schema.userPermissions.userId, userId), inArray(schema.userPermissions.permissionName, permsToRemove)));
      }
    });
  }
}
