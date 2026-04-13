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
   * Full-sync OIDC group permissions for a user.
   *
   * Adds permissions gained from the current group claims and removes permissions
   * that were previously granted via OIDC groups but are no longer in scope.
   *
   * Note: Any permission that exists in `oidc_group_mappings` is treated as
   * OIDC-managed. If an admin also manually granted the same permission, OIDC
   * management takes precedence — the permission will be removed if the user's
   * groups no longer entitle it.
   */
  async syncUserGroups(userId: number, groups: string[]): Promise<void> {
    const start = Date.now();
    this.logger.log(`[auth.oidc_group_sync] [start] userId=${userId} groupCount=${groups.length} - group sync started`);

    await this.db.transaction(async (tx) => {
      // All group mappings in the system — defines the OIDC-managed permission set.
      const allMappings = await tx.query.oidcGroupMappings.findMany();
      if (allMappings.length === 0) return;

      const allOidcPermissions = new Set(allMappings.map((m) => m.permissionName).filter(Boolean) as string[]);

      // Desired permissions based on the user's current groups.
      const desired = new Set(
        allMappings.filter((m) => m.permissionName && groups.includes(m.oidcGroupClaim)).map((m) => m.permissionName as string),
      );

      // Current user permissions that are OIDC-managed.
      const currentUserPerms = await tx.query.userPermissions.findMany({
        where: eq(schema.userPermissions.userId, userId),
      });
      const currentOidcPerms = currentUserPerms.filter((p) => allOidcPermissions.has(p.permissionName)).map((p) => p.permissionName);

      const toAdd = [...desired].filter((p) => !currentUserPerms.some((up) => up.permissionName === p));
      const toRemove = currentOidcPerms.filter((p) => !desired.has(p));

      if (toAdd.length > 0) {
        await tx
          .insert(schema.userPermissions)
          .values(toAdd.map((permissionName) => ({ userId, permissionName })))
          .onConflictDoNothing();
      }

      if (toRemove.length > 0) {
        await tx
          .delete(schema.userPermissions)
          .where(and(eq(schema.userPermissions.userId, userId), inArray(schema.userPermissions.permissionName, toRemove)));
      }

      this.logger.log(
        `[auth.oidc_group_sync] [end] userId=${userId} durationMs=${Date.now() - start} added=${toAdd.length} removed=${toRemove.length} - group sync completed`,
      );
    });
  }
}
