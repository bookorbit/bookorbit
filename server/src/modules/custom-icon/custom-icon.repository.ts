import { Inject, Injectable } from '@nestjs/common';
import { asc, count, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { CustomIconSort } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { CustomIconRow, NewCustomIcon } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface FindPageOptions {
  q?: string;
  sort: CustomIconSort;
  page: number;
  size: number;
}

export interface CustomIconUsageBreakdown {
  libraries: number;
  collections: number;
  smartScopes: number;
}

@Injectable()
export class CustomIconRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAll(): Promise<CustomIconRow[]> {
    return this.db.query.customIcons.findMany({ orderBy: [schema.customIcons.name, schema.customIcons.slug] });
  }

  async findCatalog(limit: number): Promise<{ items: CustomIconRow[]; total: number }> {
    const [items, totalRows] = await Promise.all([
      this.db.query.customIcons.findMany({
        orderBy: [asc(schema.customIcons.name), asc(schema.customIcons.slug)],
        limit,
      }),
      this.db.select({ value: count() }).from(schema.customIcons),
    ]);
    return { items, total: totalRows[0]?.value ?? 0 };
  }

  async findPage(options: FindPageOptions): Promise<{ items: CustomIconRow[]; total: number }> {
    const where = this.buildSearchFilter(options.q);
    const orderBy =
      options.sort === 'newest'
        ? [desc(schema.customIcons.createdAt), desc(schema.customIcons.id)]
        : [asc(schema.customIcons.name), asc(schema.customIcons.slug)];

    const [items, totalRows] = await Promise.all([
      this.db.query.customIcons.findMany({
        where,
        orderBy,
        limit: options.size,
        offset: options.page * options.size,
      }),
      this.db.select({ value: count() }).from(schema.customIcons).where(where),
    ]);

    return { items, total: totalRows[0]?.value ?? 0 };
  }

  findBySlug(slug: string): Promise<CustomIconRow | undefined> {
    return this.db.query.customIcons.findFirst({ where: eq(schema.customIcons.slug, slug) });
  }

  async findExistingSlugs(slugs: string[]): Promise<string[]> {
    if (slugs.length === 0) return [];
    const rows = await this.db.select({ slug: schema.customIcons.slug }).from(schema.customIcons).where(inArray(schema.customIcons.slug, slugs));
    return rows.map((row) => row.slug);
  }

  async findByHashes(hashes: string[]): Promise<Pick<CustomIconRow, 'slug' | 'name' | 'fileHash'>[]> {
    if (hashes.length === 0) return [];
    return this.db
      .select({ slug: schema.customIcons.slug, name: schema.customIcons.name, fileHash: schema.customIcons.fileHash })
      .from(schema.customIcons)
      .where(inArray(schema.customIcons.fileHash, hashes));
  }

  async create(data: NewCustomIcon): Promise<CustomIconRow> {
    const [row] = await this.db.insert(schema.customIcons).values(data).returning();
    return row!;
  }

  async update(slug: string, data: Partial<Pick<CustomIconRow, 'name' | 'originalFileName' | 'storedFileName' | 'fileSize' | 'fileHash'>>) {
    const [row] = await this.db.update(schema.customIcons).set(data).where(eq(schema.customIcons.slug, slug)).returning();
    return row;
  }

  async delete(slug: string): Promise<CustomIconRow | undefined> {
    const [row] = await this.db.delete(schema.customIcons).where(eq(schema.customIcons.slug, slug)).returning();
    return row;
  }

  async deleteMany(slugs: string[]): Promise<CustomIconRow[]> {
    if (slugs.length === 0) return [];
    return this.db.delete(schema.customIcons).where(inArray(schema.customIcons.slug, slugs)).returning();
  }

  async usageBreakdown(slug: string): Promise<CustomIconUsageBreakdown> {
    const value = `custom:${slug}`;
    const [libraryCount, collectionCount, smartScopeCount] = await Promise.all([
      this.db.select({ count: count() }).from(schema.libraries).where(eq(schema.libraries.icon, value)),
      this.db.select({ count: count() }).from(schema.collections).where(eq(schema.collections.icon, value)),
      this.db.select({ count: count() }).from(schema.smartScopes).where(eq(schema.smartScopes.icon, value)),
    ]);
    return {
      libraries: libraryCount[0]?.count ?? 0,
      collections: collectionCount[0]?.count ?? 0,
      smartScopes: smartScopeCount[0]?.count ?? 0,
    };
  }

  private buildSearchFilter(q?: string): SQL | undefined {
    const term = q?.trim();
    if (!term) return undefined;
    const pattern = `%${escapeLike(term)}%`;
    return or(ilike(schema.customIcons.name, pattern), ilike(schema.customIcons.slug, pattern));
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
