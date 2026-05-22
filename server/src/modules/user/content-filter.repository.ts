import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules, ContentFilterRulesWithNames } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class ContentFilterRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findByUserId(userId: number): Promise<ContentFilterRules> {
    const [tagRows, genreRows] = await Promise.all([
      this.db
        .select({ filterType: schema.userContentFilterTags.filterType, tagId: schema.userContentFilterTags.tagId })
        .from(schema.userContentFilterTags)
        .where(eq(schema.userContentFilterTags.userId, userId)),
      this.db
        .select({ filterType: schema.userContentFilterGenres.filterType, genreId: schema.userContentFilterGenres.genreId })
        .from(schema.userContentFilterGenres)
        .where(eq(schema.userContentFilterGenres.userId, userId)),
    ]);

    return {
      includeTagIds: tagRows.filter((r) => r.filterType === 'include').map((r) => r.tagId),
      excludeTagIds: tagRows.filter((r) => r.filterType === 'exclude').map((r) => r.tagId),
      includeGenreIds: genreRows.filter((r) => r.filterType === 'include').map((r) => r.genreId),
      excludeGenreIds: genreRows.filter((r) => r.filterType === 'exclude').map((r) => r.genreId),
    };
  }

  async findByUserIdWithNames(userId: number): Promise<ContentFilterRulesWithNames> {
    const [tagRows, genreRows] = await Promise.all([
      this.db
        .select({
          filterType: schema.userContentFilterTags.filterType,
          tagId: schema.userContentFilterTags.tagId,
          tagName: schema.tags.name,
        })
        .from(schema.userContentFilterTags)
        .innerJoin(schema.tags, eq(schema.userContentFilterTags.tagId, schema.tags.id))
        .where(eq(schema.userContentFilterTags.userId, userId)),
      this.db
        .select({
          filterType: schema.userContentFilterGenres.filterType,
          genreId: schema.userContentFilterGenres.genreId,
          genreName: schema.genres.name,
        })
        .from(schema.userContentFilterGenres)
        .innerJoin(schema.genres, eq(schema.userContentFilterGenres.genreId, schema.genres.id))
        .where(eq(schema.userContentFilterGenres.userId, userId)),
    ]);

    return {
      includeTags: tagRows.filter((r) => r.filterType === 'include').map((r) => ({ id: r.tagId, name: r.tagName })),
      excludeTags: tagRows.filter((r) => r.filterType === 'exclude').map((r) => ({ id: r.tagId, name: r.tagName })),
      includeGenres: genreRows.filter((r) => r.filterType === 'include').map((r) => ({ id: r.genreId, name: r.genreName })),
      excludeGenres: genreRows.filter((r) => r.filterType === 'exclude').map((r) => ({ id: r.genreId, name: r.genreName })),
    };
  }

  async replaceFilters(userId: number, filters: ContentFilterRules): Promise<void> {
    const allTagIds = [...new Set([...filters.includeTagIds, ...filters.excludeTagIds])];
    const allGenreIds = [...new Set([...filters.includeGenreIds, ...filters.excludeGenreIds])];

    await this.validateEntityIds(allTagIds, allGenreIds);

    await this.db.transaction(async (tx) => {
      await tx.delete(schema.userContentFilterTags).where(eq(schema.userContentFilterTags.userId, userId));
      await tx.delete(schema.userContentFilterGenres).where(eq(schema.userContentFilterGenres.userId, userId));

      const tagRows: (typeof schema.userContentFilterTags.$inferInsert)[] = [
        ...filters.includeTagIds.map((tagId) => ({ userId, filterType: 'include' as const, tagId })),
        ...filters.excludeTagIds.map((tagId) => ({ userId, filterType: 'exclude' as const, tagId })),
      ];

      const genreRows: (typeof schema.userContentFilterGenres.$inferInsert)[] = [
        ...filters.includeGenreIds.map((genreId) => ({ userId, filterType: 'include' as const, genreId })),
        ...filters.excludeGenreIds.map((genreId) => ({ userId, filterType: 'exclude' as const, genreId })),
      ];

      if (tagRows.length > 0) {
        await tx.insert(schema.userContentFilterTags).values(tagRows);
      }
      if (genreRows.length > 0) {
        await tx.insert(schema.userContentFilterGenres).values(genreRows);
      }
    });
  }

  async hasContentFilters(userId: number): Promise<boolean> {
    const [tagRow] = await this.db
      .select({ tagId: schema.userContentFilterTags.tagId })
      .from(schema.userContentFilterTags)
      .where(eq(schema.userContentFilterTags.userId, userId))
      .limit(1);
    if (tagRow) return true;

    const [genreRow] = await this.db
      .select({ genreId: schema.userContentFilterGenres.genreId })
      .from(schema.userContentFilterGenres)
      .where(eq(schema.userContentFilterGenres.userId, userId))
      .limit(1);
    return !!genreRow;
  }

  async hasAnyContentFilters(userIds: number[]): Promise<Set<number>> {
    if (userIds.length === 0) return new Set();

    const [tagRows, genreRows] = await Promise.all([
      this.db
        .select({ userId: schema.userContentFilterTags.userId })
        .from(schema.userContentFilterTags)
        .where(inArray(schema.userContentFilterTags.userId, userIds)),
      this.db
        .select({ userId: schema.userContentFilterGenres.userId })
        .from(schema.userContentFilterGenres)
        .where(inArray(schema.userContentFilterGenres.userId, userIds)),
    ]);

    const result = new Set<number>();
    for (const row of tagRows) result.add(row.userId);
    for (const row of genreRows) result.add(row.userId);
    return result;
  }

  private async validateEntityIds(tagIds: number[], genreIds: number[]): Promise<void> {
    if (tagIds.length > 0) {
      const existing = await this.db.select({ id: schema.tags.id }).from(schema.tags).where(inArray(schema.tags.id, tagIds));
      const existingSet = new Set(existing.map((r) => r.id));
      const missing = tagIds.filter((id) => !existingSet.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(`Unknown tag IDs: ${missing.join(', ')}`);
      }
    }

    if (genreIds.length > 0) {
      const existing = await this.db.select({ id: schema.genres.id }).from(schema.genres).where(inArray(schema.genres.id, genreIds));
      const existingSet = new Set(existing.map((r) => r.id));
      const missing = genreIds.filter((id) => !existingSet.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(`Unknown genre IDs: ${missing.join(', ')}`);
      }
    }
  }
}
