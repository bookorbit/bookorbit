import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, gte, lte, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AuditAction, AuditResource } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { NewAuditLog } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface AuditLogQuery {
  userId?: number;
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
    const { userId, action, resource, dateFrom, dateTo, page, pageSize } = query;

    const filters = [
      userId !== undefined ? eq(schema.auditLog.userId, userId) : undefined,
      action ? eq(schema.auditLog.action, action) : undefined,
      resource ? eq(schema.auditLog.resource, resource) : undefined,
      dateFrom ? gte(schema.auditLog.createdAt, dateFrom) : undefined,
      dateTo ? lte(schema.auditLog.createdAt, dateTo) : undefined,
    ].filter(Boolean) as ReturnType<typeof eq>[];

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

  async deleteOlderThan(before: Date): Promise<void> {
    await this.db.delete(schema.auditLog).where(lte(schema.auditLog.createdAt, before));
  }
}
