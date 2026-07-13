import { Inject, Injectable } from '@nestjs/common';
import type { AccountActivitySortDirection, AccountActivitySortField, AccountActivityState } from '@bookorbit/types';
import { and, asc, count, eq, gte, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface AccountActivityListQuery {
  page: number;
  pageSize: number;
  search?: string;
  state?: AccountActivityState;
  provisioningMethod?: string;
  sortBy: AccountActivitySortField;
  sortDir: AccountActivitySortDirection;
  recentCutoff: Date;
}

const accountActivitySelection = {
  id: schema.users.id,
  username: schema.users.username,
  name: schema.users.name,
  active: schema.users.active,
  isSuperuser: schema.users.isSuperuser,
  provisioningMethod: schema.users.provisioningMethod,
  createdAt: schema.users.createdAt,
  lastLoginAt: schema.users.lastLoginAt,
  lastAuthenticatedAt: schema.users.lastAuthenticatedAt,
  readingInsightsSharingLevel: schema.users.readingInsightsSharingLevel,
};

@Injectable()
export class AccountActivityRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(query: AccountActivityListQuery) {
    const filters = this.buildFilters(query);
    const where = filters.length > 0 ? and(...filters) : undefined;
    const offset = (query.page - 1) * query.pageSize;
    const sortColumn = {
      name: schema.users.name,
      createdAt: schema.users.createdAt,
      lastLoginAt: schema.users.lastLoginAt,
      lastAuthenticatedAt: schema.users.lastAuthenticatedAt,
    }[query.sortBy];
    const direction = query.sortDir === 'asc' ? sql.raw('asc') : sql.raw('desc');

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select(accountActivitySelection)
        .from(schema.users)
        .where(where)
        .orderBy(sql`${sortColumn} ${direction} nulls last`, asc(schema.users.username))
        .limit(query.pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(schema.users).where(where),
    ]);

    return { items, total: Number(total) };
  }

  async summary(recentCutoff: Date) {
    const [row] = await this.db
      .select({
        recent: sql<number>`count(*) filter (where ${schema.users.active} = true and ${schema.users.lastAuthenticatedAt} >= ${recentCutoff})::int`,
        dormant: sql<number>`count(*) filter (where ${schema.users.active} = true and ${schema.users.lastAuthenticatedAt} < ${recentCutoff})::int`,
        never: sql<number>`count(*) filter (where ${schema.users.active} = true and ${schema.users.lastAuthenticatedAt} is null)::int`,
        disabled: sql<number>`count(*) filter (where ${schema.users.active} = false)::int`,
      })
      .from(schema.users);

    return row ?? { recent: 0, dormant: 0, never: 0, disabled: 0 };
  }

  findById(userId: number) {
    return this.db.query.users.findFirst({
      columns: {
        id: true,
        username: true,
        name: true,
        email: true,
        active: true,
        isSuperuser: true,
        provisioningMethod: true,
        createdAt: true,
        lastLoginAt: true,
        lastAuthenticatedAt: true,
        readingInsightsSharingLevel: true,
      },
      where: eq(schema.users.id, userId),
    });
  }

  private buildFilters(query: AccountActivityListQuery): SQL[] {
    const filters: SQL[] = [];
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      filters.push(or(ilike(schema.users.name, pattern), ilike(schema.users.username, pattern))!);
    }
    if (query.provisioningMethod) {
      filters.push(eq(schema.users.provisioningMethod, query.provisioningMethod));
    }
    if (query.state === 'disabled') {
      filters.push(eq(schema.users.active, false));
    } else if (query.state === 'never') {
      filters.push(and(eq(schema.users.active, true), isNull(schema.users.lastAuthenticatedAt))!);
    } else if (query.state === 'recent') {
      filters.push(and(eq(schema.users.active, true), gte(schema.users.lastAuthenticatedAt, query.recentCutoff))!);
    } else if (query.state === 'dormant') {
      filters.push(and(eq(schema.users.active, true), lt(schema.users.lastAuthenticatedAt, query.recentCutoff))!);
    }
    return filters;
  }
}
