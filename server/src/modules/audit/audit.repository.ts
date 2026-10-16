import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, like, lte, not, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  AUDIT_CATEGORY_PREFIXES,
  AUDIT_SECURITY_ACTIONS,
  AUDIT_SECURITY_GROUP_KEYS,
  AUDIT_SECURITY_GROUPS,
  AUDIT_SIGN_IN_ACTIONS,
  AuditAction,
  AuditResource,
  type AuditCategory,
  type AuditLogKind,
  type AuditSecurityGroup,
} from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { NewAuditLog } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface AuditLogFilters {
  userId?: number;
  search?: string;
  actorUsername?: string;
  action?: AuditAction;
  resource?: AuditResource;
  resourceId?: number;
  ip?: string;
  kind?: AuditLogKind;
  category?: AuditCategory;
  securityGroup?: AuditSecurityGroup;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface AuditLogQuery extends AuditLogFilters {
  page: number;
  pageSize: number;
}

export interface AuditSignInQuery {
  search?: string;
  actorUsername?: string;
  ip?: string;
  dateFrom?: Date;
  dateTo?: Date;
  tz: string;
  page: number;
  pageSize: number;
}

export interface AuditTargetRef {
  resource: string;
  resourceId: number;
}

const log = schema.auditLog;
const SIGN_IN_ACTIONS = [...AUDIT_SIGN_IN_ACTIONS];
const SECURITY_ACTIONS = [...AUDIT_SECURITY_ACTIONS];
const SUCCESSFUL_SIGN_INS = [AuditAction.AuthLogin, AuditAction.OidcLogin, AuditAction.MagicLinkLogin];

/** Where each target type keeps its human name. Types missing here have nothing to look up. */
const TARGET_LABELS: Partial<Record<AuditResource, { table: PgTable; id: PgColumn; label: SQL }>> = {
  [AuditResource.Library]: { table: schema.libraries, id: schema.libraries.id, label: sql`${schema.libraries.name}` },
  [AuditResource.User]: {
    table: schema.users,
    id: schema.users.id,
    label: sql`coalesce(nullif(${schema.users.name}, ''), ${schema.users.username})`,
  },
  [AuditResource.ReadingInsightsProfile]: {
    table: schema.users,
    id: schema.users.id,
    label: sql`coalesce(nullif(${schema.users.name}, ''), ${schema.users.username})`,
  },
  [AuditResource.Book]: { table: schema.bookMetadata, id: schema.bookMetadata.bookId, label: sql`${schema.bookMetadata.title}` },
  [AuditResource.BookRequest]: { table: schema.bookRequests, id: schema.bookRequests.id, label: sql`${schema.bookRequests.title}` },
  [AuditResource.Collection]: { table: schema.collections, id: schema.collections.id, label: sql`${schema.collections.name}` },
  [AuditResource.SmartScope]: { table: schema.smartScopes, id: schema.smartScopes.id, label: sql`${schema.smartScopes.name}` },
  [AuditResource.DownloadClient]: { table: schema.downloadClients, id: schema.downloadClients.id, label: sql`${schema.downloadClients.name}` },
  [AuditResource.RequestIndexer]: { table: schema.requestIndexers, id: schema.requestIndexers.id, label: sql`${schema.requestIndexers.name}` },
  [AuditResource.KoboDevice]: { table: schema.koboDevices, id: schema.koboDevices.id, label: sql`${schema.koboDevices.name}` },
  [AuditResource.EmailProvider]: { table: schema.emailProviders, id: schema.emailProviders.id, label: sql`${schema.emailProviders.name}` },
  [AuditResource.EmailTemplate]: { table: schema.emailTemplates, id: schema.emailTemplates.id, label: sql`${schema.emailTemplates.name}` },
  [AuditResource.EmailRecipient]: { table: schema.emailRecipients, id: schema.emailRecipients.id, label: sql`${schema.emailRecipients.name}` },
  [AuditResource.EmailRecipientGroup]: {
    table: schema.emailRecipientGroups,
    id: schema.emailRecipientGroups.id,
    label: sql`${schema.emailRecipientGroups.name}`,
  },
  [AuditResource.Author]: { table: schema.authors, id: schema.authors.id, label: sql`${schema.authors.name}` },
  [AuditResource.Podcast]: { table: schema.podcasts, id: schema.podcasts.id, label: sql`${schema.podcasts.title}` },
};

export function hasTargetLabels(resource: string | null | undefined): resource is AuditResource {
  return !!resource && resource in TARGET_LABELS;
}

export const targetKey = (resource: string, resourceId: number) => `${resource}:${resourceId}`;

function categoryCondition(category: AuditCategory): SQL {
  const prefixed = (prefixes: readonly string[]) => or(...prefixes.map((prefix) => like(log.action, `${escapeLike(prefix)}%`))) as SQL;
  if (category !== 'other') return prefixed(AUDIT_CATEGORY_PREFIXES[category]);
  return not(prefixed(Object.values(AUDIT_CATEGORY_PREFIXES).flat()));
}

/** The category an action belongs to, computed in SQL so counts group without loading rows. */
const categoryExpression = sql.join(
  [
    sql`case`,
    ...Object.entries(AUDIT_CATEGORY_PREFIXES).map(
      ([category, prefixes]) => sql`when ${or(...prefixes.map((prefix) => like(log.action, `${escapeLike(prefix)}%`)))} then ${category}`,
    ),
    sql`else 'other' end`,
  ],
  sql` `,
);

function kindCondition(kind: AuditLogKind): SQL {
  if (kind === 'changes') return notInArray(log.action, SIGN_IN_ACTIONS);
  if (kind === 'signins') return inArray(log.action, SIGN_IN_ACTIONS);
  return inArray(log.action, SECURITY_ACTIONS);
}

function searchCondition(search: string | undefined): SQL | undefined {
  const normalized = search?.trim();
  if (!normalized) return undefined;
  const pattern = `%${escapeLike(normalized)}%`;
  const numeric = /^\d+$/.test(normalized) ? Number(normalized) : undefined;
  // Every branch has an index (trigram, btree or primary key), so Postgres can OR them without a table scan.
  return or(
    ilike(log.actorUsername, pattern),
    ilike(log.action, pattern),
    ilike(log.description, pattern),
    ilike(log.resource, pattern),
    ilike(log.resourceLabel, pattern),
    /^[0-9a-f:.]+$/i.test(normalized) && /[.:]/.test(normalized) ? eq(log.ip, normalized) : undefined,
    numeric !== undefined && numeric <= 2147483647 ? eq(log.resourceId, numeric) : undefined,
    numeric !== undefined ? eq(log.id, numeric) : undefined,
    sql`${log.meta}::text ILIKE ${pattern}`,
  );
}

function filterConditions(filters: AuditLogFilters, omit: { kind?: boolean; category?: boolean; securityGroup?: boolean } = {}): SQL[] {
  const { userId, search, actorUsername, action, resource, resourceId, ip, kind, category, securityGroup, dateFrom, dateTo } = filters;
  return [
    userId !== undefined ? eq(log.userId, userId) : undefined,
    actorUsername?.trim() ? eq(log.actorUsername, actorUsername.trim()) : undefined,
    action ? eq(log.action, action) : undefined,
    resource ? eq(log.resource, resource) : undefined,
    resourceId !== undefined ? eq(log.resourceId, resourceId) : undefined,
    ip?.trim() ? eq(log.ip, ip.trim()) : undefined,
    kind && !omit.kind ? kindCondition(kind) : undefined,
    category && !omit.category ? categoryCondition(category) : undefined,
    securityGroup && !omit.securityGroup ? inArray(log.action, [...AUDIT_SECURITY_GROUPS[securityGroup]]) : undefined,
    dateFrom ? gte(log.createdAt, dateFrom) : undefined,
    dateTo ? lte(log.createdAt, dateTo) : undefined,
    searchCondition(search),
  ].filter((condition): condition is SQL => condition !== undefined);
}

const whereOf = (conditions: SQL[]) => (conditions.length > 0 ? and(...conditions) : undefined);

@Injectable()
export class AuditRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async insert(record: NewAuditLog): Promise<void> {
    await this.db.insert(log).values(record);
  }

  async findAll(query: AuditLogQuery) {
    const where = whereOf(filterConditions(query));
    const offset = (query.page - 1) * query.pageSize;

    const [data, [{ total }]] = await Promise.all([
      this.db.select().from(log).where(where).orderBy(desc(log.createdAt), asc(log.id)).limit(query.pageSize).offset(offset),
      this.db.select({ total: count() }).from(log).where(where),
    ]);

    return { data, total };
  }

  /** Counts for the view switcher, the category menu and the security chips, in two aggregate queries. */
  async summarize(filters: AuditLogFilters) {
    const base = whereOf(filterConditions(filters, { kind: true, category: true, securityGroup: true }));
    const inView = whereOf(filterConditions(filters, { category: true }));
    const groupCounts = Object.fromEntries(
      AUDIT_SECURITY_GROUP_KEYS.map((group) => [
        group,
        sql<number>`count(*) filter (where ${inArray(log.action, [...AUDIT_SECURITY_GROUPS[group]])})::int`,
      ]),
    ) as Record<AuditSecurityGroup, SQL<number>>;

    const [[kinds], categories, [{ oldestAt }]] = await Promise.all([
      this.db
        .select({
          all: sql<number>`count(*)::int`,
          changes: sql<number>`count(*) filter (where ${kindCondition('changes')})::int`,
          signins: sql<number>`count(*) filter (where ${kindCondition('signins')})::int`,
          security: sql<number>`count(*) filter (where ${kindCondition('security')})::int`,
          ...groupCounts,
        })
        .from(log)
        .where(base),
      this.db
        .select({ category: sql<AuditCategory>`${categoryExpression}`, total: sql<number>`count(*)::int` })
        .from(log)
        .where(inView)
        .groupBy(sql`1`),
      this.db.select({ oldestAt: sql<Date | null>`min(${log.createdAt})` }).from(log),
    ]);

    const { all, changes, signins, security, ...securityGroups } = kinds;
    return {
      kinds: { all, changes, signins, security },
      securityGroups: securityGroups as Record<AuditSecurityGroup, number>,
      categories: Object.fromEntries(categories.map((row) => [row.category, row.total])) as Partial<Record<AuditCategory, number>>,
      oldestAt: oldestAt ? new Date(oldestAt) : null,
    };
  }

  /** Sign-in traffic folded per person, local day and address, newest group first. */
  async findSignInGroups(query: AuditSignInQuery) {
    const normalized = query.search?.trim();
    const pattern = normalized ? `%${escapeLike(normalized)}%` : undefined;
    const where = and(
      inArray(log.action, SIGN_IN_ACTIONS),
      query.actorUsername?.trim() ? eq(log.actorUsername, query.actorUsername.trim()) : undefined,
      query.ip?.trim() ? eq(log.ip, query.ip.trim()) : undefined,
      query.dateFrom ? gte(log.createdAt, query.dateFrom) : undefined,
      query.dateTo ? lte(log.createdAt, query.dateTo) : undefined,
      pattern ? or(ilike(log.actorUsername, pattern), ilike(log.ip, pattern), sql`${log.meta}->>'attemptedUsername' ILIKE ${pattern}`) : undefined,
    );
    const day = sql<string>`to_char(${log.createdAt} at time zone ${query.tz}, 'YYYY-MM-DD')`;
    const groups = this.db
      .select({
        day: day.as('day'),
        actorUsername: log.actorUsername,
        userId: log.userId,
        ip: log.ip,
        signIns: sql<number>`count(*) filter (where ${inArray(log.action, SUCCESSFUL_SIGN_INS)})::int`.as('sign_ins'),
        signOuts: sql<number>`count(*) filter (where ${eq(log.action, AuditAction.AuthLogout)})::int`.as('sign_outs'),
        failed: sql<number>`count(*) filter (where ${eq(log.action, AuditAction.AuthLoginFailed)})::int`.as('failed'),
        failedUsernames: sql<
          string[]
        >`coalesce(array_agg(distinct ${log.meta}->>'attemptedUsername') filter (where ${eq(log.action, AuditAction.AuthLoginFailed)} and ${log.meta}->>'attemptedUsername' is not null), '{}')`.as(
          'failed_usernames',
        ),
        firstAt: sql<Date>`min(${log.createdAt})`.as('first_at'),
        lastAt: sql<Date>`max(${log.createdAt})`.as('last_at'),
      })
      .from(log)
      .where(where)
      .groupBy(sql`1`, log.actorUsername, log.userId, log.ip)
      .as('groups');

    const [data, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(groups)
        .orderBy(desc(groups.lastAt), asc(groups.actorUsername))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: count() }).from(groups),
    ]);
    return { data, total };
  }

  /** Current names for the given targets, one query per target type. */
  async findLiveLabels(targets: AuditTargetRef[]): Promise<Map<string, string>> {
    const byType = new Map<AuditResource, Set<number>>();
    for (const { resource, resourceId } of targets) {
      if (!hasTargetLabels(resource)) continue;
      if (!byType.has(resource)) byType.set(resource, new Set());
      byType.get(resource)!.add(resourceId);
    }
    const labels = new Map<string, string>();
    await Promise.all(
      [...byType].map(async ([resource, ids]) => {
        const source = TARGET_LABELS[resource]!;
        const rows = await this.db
          .select({ id: sql<number>`${source.id}`, label: sql<string | null>`${source.label}` })
          .from(source.table)
          .where(inArray(source.id, [...ids]));
        for (const row of rows) if (row.label) labels.set(targetKey(resource, Number(row.id)), row.label);
      }),
    );
    return labels;
  }

  /** The newest name the log recorded for each target, for targets that no longer exist. */
  async findSnapshotLabels(targets: AuditTargetRef[]): Promise<Map<string, string>> {
    if (targets.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([log.resource, log.resourceId], { resource: log.resource, resourceId: log.resourceId, label: log.resourceLabel })
      .from(log)
      .where(
        and(
          isNotNull(log.resourceLabel),
          or(...targets.map((target) => and(eq(log.resource, target.resource), eq(log.resourceId, target.resourceId)))),
        ),
      )
      .orderBy(log.resource, log.resourceId, desc(log.createdAt));
    return new Map(
      rows
        .filter((row) => row.resource && row.resourceId !== null && row.label)
        .map((row) => [targetKey(row.resource!, row.resourceId!), row.label!]),
    );
  }

  /**
   * Names rows written before targets were snapshotted: from the target itself while it exists, otherwise
   * from the log's own "Created library 'Name'" line for the same target. Only fills empty labels.
   */
  async backfillTargetLabels(): Promise<{ fromLive: number; fromHistory: number }> {
    let fromLive = 0;
    for (const [resource, source] of Object.entries(TARGET_LABELS)) {
      const result = await this.db.execute(
        sql`update ${log} set ${sql.raw('resource_label')} = left(${source.label}, 255) from ${source.table}
            where ${log.resource} = ${resource} and ${log.resourceLabel} is null and ${log.resourceId} = ${source.id} and ${source.label} is not null`,
      );
      fromLive += result.rowCount ?? 0;
    }
    const created = sql`select distinct on (${log.resource}, ${log.resourceId}) ${log.resource} as resource, ${log.resourceId} as resource_id,
        substring(${log.description} from ${"'(.+)'$"}) as label
      from ${log} where ${log.resourceId} is not null and ${log.description} ~ ${"^Created .+'.+'$"}
      order by ${log.resource}, ${log.resourceId}, ${log.createdAt} desc`;
    const history = await this.db.execute(
      sql`update ${log} set ${sql.raw('resource_label')} = left(created.label, 255) from (${created}) as created
          where ${log.resource} = created.resource and ${log.resourceId} = created.resource_id and ${log.resourceLabel} is null and created.label is not null`,
    );
    return { fromLive, fromHistory: history.rowCount ?? 0 };
  }

  /** One batch of the export, oldest first after the cursor, so a long export never holds the table in memory. */
  async findExportBatch(filters: AuditLogFilters, afterId: number, batchSize: number) {
    return this.db
      .select()
      .from(log)
      .where(whereOf([...filterConditions(filters), sql`${log.id} > ${afterId}`]))
      .orderBy(asc(log.id))
      .limit(batchSize);
  }

  async findActors(query: string | undefined, limit: number) {
    const normalizedQuery = query?.trim();
    const where = normalizedQuery ? ilike(log.actorUsername, `%${escapeLike(normalizedQuery)}%`) : undefined;
    return this.db
      .selectDistinct({
        userId: log.userId,
        username: log.actorUsername,
      })
      .from(log)
      .where(where)
      .orderBy(asc(log.actorUsername))
      .limit(limit);
  }

  async deleteOlderThan(before: Date): Promise<void> {
    await this.db.delete(log).where(lte(log.createdAt, before));
  }

  async findReadingInsightsAccess(subjectUserId: number, page: number, pageSize: number) {
    const where = and(
      eq(log.action, AuditAction.ReadingInsightsProfileView),
      eq(log.resource, AuditResource.ReadingInsightsProfile),
      eq(log.resourceId, subjectUserId),
    );
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select({
          id: log.id,
          viewerUsername: log.actorUsername,
          meta: log.meta,
          viewedAt: log.createdAt,
        })
        .from(log)
        .where(where)
        .orderBy(desc(log.createdAt), desc(log.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ total: count() }).from(log).where(where),
    ]);
    return { items, total: Number(total) };
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
