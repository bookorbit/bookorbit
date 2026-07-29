import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AuditAction, AuditResource } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { NewAuditLog } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface AuditLogQuery {
  userId?: number;
  search?: string;
  actorUsername?: string;
  action?: AuditAction;
  resource?: AuditResource;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}

@Injectable()
export class AuditRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async insert(record: NewAuditLog): Promise<void> {
    await this.db.insert(schema.auditLog).values(record);
  }

  async findAll(query: AuditLogQuery) {
    const { userId, search, actorUsername, action, resource, dateFrom, dateTo, page, pageSize } = query;
    const normalizedSearch = search?.trim();
    const searchPattern = normalizedSearch ? `%${escapeLike(normalizedSearch)}%` : undefined;
    const numericSearch = normalizedSearch && /^\d+$/.test(normalizedSearch) ? Number(normalizedSearch) : undefined;

    const filters = [
      userId !== undefined ? eq(schema.auditLog.userId, userId) : undefined,
      actorUsername?.trim() ? eq(schema.auditLog.actorUsername, actorUsername.trim()) : undefined,
      action ? eq(schema.auditLog.action, action) : undefined,
      resource ? eq(schema.auditLog.resource, resource) : undefined,
      dateFrom ? gte(schema.auditLog.createdAt, dateFrom) : undefined,
      dateTo ? lte(schema.auditLog.createdAt, dateTo) : undefined,
      searchPattern
        ? or(
            ilike(schema.auditLog.actorUsername, searchPattern),
            ilike(schema.auditLog.action, searchPattern),
            ilike(schema.auditLog.description, searchPattern),
            ilike(schema.auditLog.resource, searchPattern),
            numericSearch !== undefined ? eq(schema.auditLog.resourceId, numericSearch) : undefined,
            sql`${schema.auditLog.meta}::text ILIKE ${searchPattern}`,
          )
        : undefined,
    ].filter((filter): filter is SQL => filter !== undefined);

    const where = filters.length > 0 ? and(...filters) : undefined;
    const offset = (page - 1) * pageSize;

    const [data, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(schema.auditLog)
        .where(where)
        .orderBy(desc(schema.auditLog.createdAt), asc(schema.auditLog.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(schema.auditLog).where(where),
    ]);

    return { data, total };
  }

  async findActors(query: string | undefined, limit: number) {
    const normalizedQuery = query?.trim();
    const where = normalizedQuery ? ilike(schema.auditLog.actorUsername, `%${escapeLike(normalizedQuery)}%`) : undefined;
    return this.db
      .selectDistinct({
        userId: schema.auditLog.userId,
        username: schema.auditLog.actorUsername,
      })
      .from(schema.auditLog)
      .where(where)
      .orderBy(asc(schema.auditLog.actorUsername))
      .limit(limit);
  }

  async deleteOlderThan(before: Date): Promise<void> {
    await this.db.delete(schema.auditLog).where(lte(schema.auditLog.createdAt, before));
  }

  async findReadingInsightsAccess(subjectUserId: number, page: number, pageSize: number) {
    const where = and(
      eq(schema.auditLog.action, AuditAction.ReadingInsightsProfileView),
      eq(schema.auditLog.resource, AuditResource.ReadingInsightsProfile),
      eq(schema.auditLog.resourceId, subjectUserId),
    );
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select({
          id: schema.auditLog.id,
          viewerUsername: schema.auditLog.actorUsername,
          meta: schema.auditLog.meta,
          viewedAt: schema.auditLog.createdAt,
        })
        .from(schema.auditLog)
        .where(where)
        .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ total: count() }).from(schema.auditLog).where(where),
    ]);
    return { items, total: Number(total) };
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
