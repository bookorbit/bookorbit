import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class OidcGroupMappingService {
  private readonly logger = new Logger(OidcGroupMappingService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async syncUserGroups(userId: number, groups: string[]): Promise<void> {
    if (groups.length === 0) return;

    const mappings = await this.db.query.oidcGroupMappings.findMany({
      where: inArray(schema.oidcGroupMappings.oidcGroupClaim, groups),
    });

    const permissionNames = [...new Set(mappings.flatMap((m) => (m.permissionName ? [m.permissionName] : [])))];
    if (permissionNames.length === 0) return;

    for (const permissionName of permissionNames) {
      await this.db.insert(schema.userPermissions).values({ userId, permissionName }).onConflictDoNothing();
    }

    this.logger.debug(`Synced ${permissionNames.length} permission(s) for user ${userId} from OIDC groups`);
  }
}
