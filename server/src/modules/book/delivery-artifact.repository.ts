import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DeliveryArtifactMetadata } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { recordBookFileHashHistory } from '../../db/book-file-hash-history';

@Injectable()
export class DeliveryArtifactRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async findSourceRoot(bookFileId: number) {
    const [row] = await this.db
      .select({ root: schema.libraryFolders.path })
      .from(schema.bookFiles)
      .innerJoin(schema.libraryFolders, eq(schema.libraryFolders.id, schema.bookFiles.libraryFolderId))
      .where(eq(schema.bookFiles.id, bookFileId))
      .limit(1);
    return row?.root;
  }

  findInspection(bookFileId: number) {
    return this.db.query.deliveryInspections.findFirst({ where: eq(schema.deliveryInspections.bookFileId, bookFileId) });
  }

  async saveInspection(values: typeof schema.deliveryInspections.$inferInsert) {
    await this.db
      .insert(schema.deliveryInspections)
      .values(values)
      .onConflictDoUpdate({
        target: schema.deliveryInspections.bookFileId,
        set: { ...values, checkedAt: new Date() },
      });
  }

  findMany(selectionIds: string[], userId: number, scope: string) {
    return this.db.query.deliveryArtifacts.findMany({
      where: and(
        inArray(schema.deliveryArtifacts.selectionId, selectionIds),
        eq(schema.deliveryArtifacts.userId, userId),
        eq(schema.deliveryArtifacts.scope, scope),
      ),
    });
  }

  find(selectionId: string, userId: number, scope: string) {
    return this.db.query.deliveryArtifacts.findFirst({
      where: and(
        eq(schema.deliveryArtifacts.selectionId, selectionId),
        eq(schema.deliveryArtifacts.userId, userId),
        eq(schema.deliveryArtifacts.scope, scope),
      ),
    });
  }

  async seal(selectionId: string, userId: number, scope: string, bookFileId: number, metadata: DeliveryArtifactMetadata) {
    await this.db.insert(schema.deliveryArtifacts).values({ selectionId, userId, scope, bookFileId, metadata }).onConflictDoNothing();
    return this.find(selectionId, userId, scope);
  }

  async registerHash(bookFileId: number, fileHash: string) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '1s'`);
      await tx.execute(sql`set local statement_timeout = '2s'`);
      await recordBookFileHashHistory(tx, bookFileId, fileHash, 'kobo_download');
    });
  }
}
