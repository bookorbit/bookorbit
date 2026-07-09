import { Inject, Injectable } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { NewReadwiseUserSetting, ReadwiseUserSetting } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface NewHighlightRow {
  annotationId: number;
  bookId: number;
  text: string;
  note: string | null;
  createdAt: Date;
  title: string | null;
  author: string; // joined, may be ''
  isbn13: string | null;
  isbn10: string | null;
}

@Injectable()
export class ReadwiseRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findSettings(userId: number): Promise<ReadwiseUserSetting | undefined> {
    return this.db.query.readwiseUserSettings.findFirst({
      where: eq(schema.readwiseUserSettings.userId, userId),
    });
  }

  async findLatestAnnotationId(userId: number): Promise<number> {
    const [row] = await this.db
      .select({ latestAnnotationId: sql<number>`coalesce(max(${schema.annotations.id}), 0)::int` })
      .from(schema.annotations)
      .where(eq(schema.annotations.userId, userId))
      .limit(1);

    return row?.latestAnnotationId ?? 0;
  }

  async upsertSettings(
    userId: number,
    data: Partial<Omit<ReadwiseUserSetting, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<ReadwiseUserSetting> {
    const [row] = await this.db
      .insert(schema.readwiseUserSettings)
      .values({ userId, ...data } as NewReadwiseUserSetting)
      .onConflictDoUpdate({
        target: schema.readwiseUserSettings.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async userHasReadwiseSyncPermission(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({
        isSuperuser: schema.users.isSuperuser,
        permissionName: schema.userPermissions.permissionName,
      })
      .from(schema.users)
      .leftJoin(
        schema.userPermissions,
        and(eq(schema.userPermissions.userId, schema.users.id), eq(schema.userPermissions.permissionName, Permission.ReadwiseSync)),
      )
      .where(and(eq(schema.users.id, userId), eq(schema.users.active, true)))
      .limit(1);
    return row?.isSuperuser === true || row?.permissionName === Permission.ReadwiseSync;
  }

  async findNewHighlights(userId: number, afterId: number, limit: number): Promise<NewHighlightRow[]> {
    const rows = await this.db
      .select({
        annotationId: schema.annotations.id,
        bookId: schema.annotations.bookId,
        text: schema.annotations.text,
        note: schema.annotations.note,
        createdAt: schema.annotations.createdAt,
        title: schema.bookMetadata.title,
        isbn13: schema.bookMetadata.isbn13,
        isbn10: schema.bookMetadata.isbn10,
        authorsCsv: sql<string>`coalesce(string_agg(${schema.authors.name}, '||' order by ${schema.bookAuthors.displayOrder}, ${schema.bookAuthors.authorId}), '')`,
      })
      .from(schema.annotations)
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.annotations.bookId))
      .leftJoin(schema.bookAuthors, eq(schema.bookAuthors.bookId, schema.annotations.bookId))
      .leftJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(
        and(
          eq(schema.annotations.userId, userId),
          gt(schema.annotations.id, afterId),
          ne(schema.annotations.text, ''),
          isNull(schema.annotations.deletedAt),
        ),
      )
      .groupBy(
        schema.annotations.id,
        schema.annotations.bookId,
        schema.annotations.text,
        schema.annotations.note,
        schema.annotations.createdAt,
        schema.bookMetadata.title,
        schema.bookMetadata.isbn13,
        schema.bookMetadata.isbn10,
      )
      .orderBy(asc(schema.annotations.id))
      .limit(limit);

    return rows.map((r) => ({
      annotationId: r.annotationId,
      bookId: r.bookId,
      text: r.text,
      note: r.note,
      createdAt: r.createdAt,
      title: r.title,
      isbn13: r.isbn13,
      isbn10: r.isbn10,
      author: r.authorsCsv
        ? r.authorsCsv
            .split('||')
            .filter((a) => a.length > 0)
            .join(', ')
        : '',
    }));
  }
}
