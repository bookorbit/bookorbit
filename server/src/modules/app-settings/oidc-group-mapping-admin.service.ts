import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/**
 * @deprecated Use OidcProviderService for provider-scoped group mapping operations.
 * Kept temporarily for backward compatibility during migration.
 */
@Injectable()
export class OidcGroupMappingAdminService {
  constructor(@Inject(DB) private readonly db: Db) {}

  listMappings() {
    return this.db.query.oidcGroupMappings.findMany({ orderBy: (t, { asc }) => [asc(t.oidcGroupClaim)] });
  }

  async updateMapping(id: number, permissionName: string) {
    const [row] = await this.db.update(schema.oidcGroupMappings).set({ permissionName }).where(eq(schema.oidcGroupMappings.id, id)).returning();
    if (!row) throw new NotFoundException(`Group mapping ${id} not found`);
    return row;
  }

  async deleteMapping(id: number) {
    const [row] = await this.db.delete(schema.oidcGroupMappings).where(eq(schema.oidcGroupMappings.id, id)).returning();
    if (!row) throw new NotFoundException(`Group mapping ${id} not found`);
  }
}
