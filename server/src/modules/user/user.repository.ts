import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { hash } from 'bcryptjs';

import { Permission, withRequiredPermissions } from '@bookorbit/types';
import type { UserAttentionReason, UserListSortDirection, UserListSortField, UserListState, UserListSummary } from '@bookorbit/types';
import { RequestUser } from '../../common/types/request-user';
import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/**
 * An account needs an administrator's attention when it is locked out, is still on the
 * password it was created with, or was provisioned and never arrived. Disabled accounts are
 * excluded: there is nothing to repair on an account nobody can sign in to.
 */
function attentionCondition(): SQL {
  return and(
    eq(schema.users.active, true),
    or(
      sql`${schema.users.lockedUntil} is not null and ${schema.users.lockedUntil} > now()`,
      eq(schema.users.isDefaultPassword, true),
      isNull(schema.users.lastAuthenticatedAt),
    ),
  )!;
}

/**
 * One reason per account, most urgent first. `neverSignedIn` outranks `defaultPassword`
 * because every freshly created account carries the default-password flag until its reset
 * link is used - reporting that instead would hide every invite that never landed.
 */
function attentionReason(row: { lockedUntil: Date | null; lastAuthenticatedAt: Date | null }): UserAttentionReason {
  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) return 'locked';
  if (row.lastAuthenticatedAt === null) return 'neverSignedIn';
  return 'defaultPassword';
}

/** Same ranking as `attentionReason`, expressed for the ORDER BY. */
const attentionRank = sql`case
  when ${schema.users.lockedUntil} is not null and ${schema.users.lockedUntil} > now() then 0
  when ${schema.users.lastAuthenticatedAt} is null then 1
  else 2 end`;

export interface UserListQuery {
  page: number;
  pageSize: number;
  search?: string;
  state?: UserListState;
  provisioningMethod?: string;
  sortBy: UserListSortField;
  sortDir: UserListSortDirection;
}

@Injectable()
export class UserRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(query: UserListQuery) {
    const { page, pageSize } = query;
    const offset = page * pageSize;

    const filters = this.buildListFilters(query);
    const conditions = filters.length > 0 ? and(...filters) : undefined;
    const sortColumn = {
      username: schema.users.username,
      name: schema.users.name,
      email: schema.users.email,
      createdAt: schema.users.createdAt,
      lastActive: schema.users.lastAuthenticatedAt,
    }[query.sortBy];
    const direction = query.sortDir === 'desc' ? sql.raw('desc') : sql.raw('asc');

    const [userPage, [{ total }]] = await Promise.all([
      this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(conditions)
        .orderBy(sql`${sortColumn} ${direction} nulls last`, asc(schema.users.username))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(schema.users).where(conditions),
    ]);
    const normalizedTotal = Number(total);

    const userIds = userPage.map((u) => u.id);
    if (userIds.length === 0) return { users: [], total: normalizedTotal };

    const rows = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        name: schema.users.name,
        email: schema.users.email,
        active: schema.users.active,
        isSuperuser: schema.users.isSuperuser,
        isDefaultPassword: schema.users.isDefaultPassword,
        lockedUntil: schema.users.lockedUntil,
        failedLoginAttempts: schema.users.failedLoginAttempts,
        provisioningMethod: schema.users.provisioningMethod,
        avatarUrl: schema.users.avatarUrl,
        createdAt: schema.users.createdAt,
        lastAuthenticatedAt: schema.users.lastAuthenticatedAt,
        permissionName: schema.userPermissions.permissionName,
      })
      .from(schema.users)
      .leftJoin(schema.userPermissions, eq(schema.userPermissions.userId, schema.users.id))
      .where(inArray(schema.users.id, userIds))
      .orderBy(schema.users.username);

    type UserListItem = {
      id: number;
      username: string;
      name: string;
      email: string | null;
      active: boolean;
      isSuperuser: boolean;
      isDefaultPassword: boolean;
      lockedUntil: Date | null;
      failedLoginAttempts: number;
      provisioningMethod: string;
      avatarUrl: string | null;
      createdAt: Date;
      lastAuthenticatedAt: Date | null;
      permissions: Permission[];
      hasContentFilters: boolean;
      libraryAccessCount: number;
    };

    const usersMap = new Map<number, UserListItem>();
    for (const row of rows) {
      if (!usersMap.has(row.id)) {
        usersMap.set(row.id, {
          id: row.id,
          username: row.username,
          name: row.name,
          email: row.email,
          active: row.active,
          isSuperuser: row.isSuperuser,
          isDefaultPassword: row.isDefaultPassword,
          lockedUntil: row.lockedUntil,
          failedLoginAttempts: row.failedLoginAttempts,
          provisioningMethod: row.provisioningMethod,
          avatarUrl: row.avatarUrl,
          createdAt: row.createdAt,
          lastAuthenticatedAt: row.lastAuthenticatedAt,
          permissions: [],
          hasContentFilters: false,
          libraryAccessCount: 0,
        });
      }
      if (row.permissionName) {
        usersMap.get(row.id)!.permissions.push(row.permissionName as Permission);
      }
    }

    if (userIds.length > 0) {
      const [tagFilterUsers, genreFilterUsers, libraryAccessCounts] = await Promise.all([
        this.db
          .select({ userId: schema.userContentFilterTags.userId })
          .from(schema.userContentFilterTags)
          .where(inArray(schema.userContentFilterTags.userId, userIds)),
        this.db
          .select({ userId: schema.userContentFilterGenres.userId })
          .from(schema.userContentFilterGenres)
          .where(inArray(schema.userContentFilterGenres.userId, userIds)),
        this.db
          .select({ userId: schema.userLibraryAccess.userId, granted: count() })
          .from(schema.userLibraryAccess)
          .where(inArray(schema.userLibraryAccess.userId, userIds))
          .groupBy(schema.userLibraryAccess.userId),
      ]);
      const usersWithFilters = new Set<number>();
      for (const r of tagFilterUsers) usersWithFilters.add(r.userId);
      for (const r of genreFilterUsers) usersWithFilters.add(r.userId);
      for (const [id, user] of usersMap) {
        if (usersWithFilters.has(id)) user.hasContentFilters = true;
      }
      for (const row of libraryAccessCounts) {
        const user = usersMap.get(row.userId);
        if (user) user.libraryAccessCount = Number(row.granted);
      }
    }

    const users = userIds.map((id) => usersMap.get(id)).filter((user): user is UserListItem => user !== undefined);
    return { users, total: normalizedTotal };
  }

  /** Counts across every account, deliberately ignoring the caller's current filter. */
  async summary(): Promise<UserListSummary> {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        admins: sql<number>`count(*) filter (where ${schema.users.isSuperuser} = true)::int`,
        active: sql<number>`count(*) filter (where ${schema.users.active} = true)::int`,
        inactive: sql<number>`count(*) filter (where ${schema.users.active} = false)::int`,
        attention: sql<number>`count(*) filter (where ${attentionCondition()})::int`,
      })
      .from(schema.users);
    return row ?? { total: 0, admins: 0, active: 0, inactive: 0, attention: 0 };
  }

  async findNeedingAttention(limit: number) {
    const rows = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        name: schema.users.name,
        avatarUrl: schema.users.avatarUrl,
        provisioningMethod: schema.users.provisioningMethod,
        createdAt: schema.users.createdAt,
        lockedUntil: schema.users.lockedUntil,
        isDefaultPassword: schema.users.isDefaultPassword,
        lastAuthenticatedAt: schema.users.lastAuthenticatedAt,
      })
      .from(schema.users)
      .where(attentionCondition())
      .orderBy(attentionRank, asc(schema.users.createdAt))
      .limit(limit);

    if (rows.length === 0) return [];

    // Only the newest unused link per account matters; the set is bounded by `limit`.
    const tokens = await this.db
      .select({
        userId: schema.passwordResetTokens.userId,
        expiresAt: schema.passwordResetTokens.expiresAt,
      })
      .from(schema.passwordResetTokens)
      .where(
        and(
          inArray(
            schema.passwordResetTokens.userId,
            rows.map((r) => r.id),
          ),
          isNull(schema.passwordResetTokens.usedAt),
        ),
      )
      .orderBy(desc(schema.passwordResetTokens.createdAt));

    const latestLink = new Map<number, Date>();
    for (const token of tokens) {
      if (!latestLink.has(token.userId)) latestLink.set(token.userId, token.expiresAt);
    }

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      name: row.name,
      avatarUrl: row.avatarUrl,
      provisioningMethod: row.provisioningMethod,
      createdAt: row.createdAt,
      lockedUntil: row.lockedUntil,
      reason: attentionReason(row),
      resetLinkExpiresAt: latestLink.get(row.id) ?? null,
    }));
  }

  private buildListFilters(query: UserListQuery): SQL[] {
    const filters: SQL[] = [];

    const search = query.search?.trim();
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      filters.push(or(ilike(schema.users.name, pattern), ilike(schema.users.username, pattern), ilike(schema.users.email, pattern))!);
    }
    if (query.provisioningMethod) {
      filters.push(eq(schema.users.provisioningMethod, query.provisioningMethod));
    }
    if (query.state === 'admins') {
      filters.push(eq(schema.users.isSuperuser, true));
    } else if (query.state === 'active') {
      filters.push(eq(schema.users.active, true));
    } else if (query.state === 'inactive') {
      filters.push(eq(schema.users.active, false));
    } else if (query.state === 'attention') {
      filters.push(attentionCondition());
    }

    return filters;
  }

  async findAssignable() {
    return this.db
      .select({ id: schema.users.id, username: schema.users.username, name: schema.users.name })
      .from(schema.users)
      .where(and(eq(schema.users.active, true), eq(schema.users.isSuperuser, false)))
      .orderBy(schema.users.name);
  }

  async findByUsername(username: string) {
    return this.db.query.users.findFirst({ where: eq(schema.users.username, username) });
  }

  async findByIdWithPermissions(id: number): Promise<RequestUser | null> {
    const [rows, tagFilterRows, genreFilterRows] = await Promise.all([
      this.db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          name: schema.users.name,
          email: schema.users.email,
          active: schema.users.active,
          isSuperuser: schema.users.isSuperuser,
          isDefaultPassword: schema.users.isDefaultPassword,
          tokenVersion: schema.users.tokenVersion,
          settings: schema.users.settings,
          avatarUrl: schema.users.avatarUrl,
          avatarSource: schema.users.avatarSource,
          avatarVersion: schema.users.avatarVersion,
          provisioningMethod: schema.users.provisioningMethod,
          seeOwnRequestedBooks: schema.users.seeOwnRequestedBooks,
          permissionName: schema.userPermissions.permissionName,
        })
        .from(schema.users)
        .leftJoin(schema.userPermissions, eq(schema.userPermissions.userId, schema.users.id))
        .where(eq(schema.users.id, id)),
      this.db
        .select({ filterType: schema.userContentFilterTags.filterType, tagId: schema.userContentFilterTags.tagId })
        .from(schema.userContentFilterTags)
        .where(eq(schema.userContentFilterTags.userId, id)),
      this.db
        .select({ filterType: schema.userContentFilterGenres.filterType, genreId: schema.userContentFilterGenres.genreId })
        .from(schema.userContentFilterGenres)
        .where(eq(schema.userContentFilterGenres.userId, id)),
    ]);

    if (rows.length === 0) return null;

    const first = rows[0];
    const permissions: Permission[] = [];

    for (const row of rows) {
      if (row.permissionName && !permissions.includes(row.permissionName as Permission)) {
        permissions.push(row.permissionName as Permission);
      }
    }

    return {
      id: first.id,
      username: first.username,
      name: first.name,
      email: first.email,
      active: first.active,
      isSuperuser: first.isSuperuser,
      isDefaultPassword: first.isDefaultPassword,
      tokenVersion: first.tokenVersion,
      settings: first.settings as Record<string, unknown>,
      avatarUrl: first.avatarUrl,
      avatarSource: first.avatarSource,
      avatarVersion: first.avatarVersion,
      provisioningMethod: first.provisioningMethod,
      permissions,
      contentFilters: {
        includeTagIds: tagFilterRows.filter((r) => r.filterType === 'include').map((r) => r.tagId),
        excludeTagIds: tagFilterRows.filter((r) => r.filterType === 'exclude').map((r) => r.tagId),
        includeGenreIds: genreFilterRows.filter((r) => r.filterType === 'include').map((r) => r.genreId),
        excludeGenreIds: genreFilterRows.filter((r) => r.filterType === 'exclude').map((r) => r.genreId),
        ...(first.seeOwnRequestedBooks ? { exemptRequestsFromUserId: first.id } : {}),
      },
    };
  }

  async findSettingsById(id: number): Promise<Record<string, unknown> | null> {
    const [user] = await this.db.select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return user ? ((user.settings ?? {}) as Record<string, unknown>) : null;
  }

  async create(data: typeof schema.users.$inferInsert) {
    const [user] = await this.db.insert(schema.users).values(data).returning();
    return user;
  }

  async update(id: number, data: Partial<Pick<typeof schema.users.$inferInsert, 'name' | 'email' | 'active' | 'settings' | 'seeOwnRequestedBooks'>>) {
    const { settings, ...rest } = data;
    const setData: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (settings !== undefined) {
      setData.settings = sql`${schema.users.settings} || ${JSON.stringify(settings)}::jsonb`;
    }
    const [user] = await this.db.update(schema.users).set(setData).where(eq(schema.users.id, id)).returning({
      id: schema.users.id,
      username: schema.users.username,
      name: schema.users.name,
      email: schema.users.email,
      active: schema.users.active,
      isDefaultPassword: schema.users.isDefaultPassword,
      settings: schema.users.settings,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    });
    return user;
  }

  async delete(id: number) {
    await this.db.delete(schema.users).where(eq(schema.users.id, id));
  }

  /**
   * The one chokepoint every assignment path reaches, which is why the dependency rule lives here
   * rather than in the service: user creation, shared-user creation, the permissions endpoint and
   * OIDC auto-provisioning all end up on this line, and the OIDC one skips the service's own
   * normalisation entirely. A permission that is inert without another is granted with it.
   */
  async setPermissions(userId: number, permissionNames: Permission[]) {
    const resolved = withRequiredPermissions(permissionNames);

    await this.db.transaction(async (tx) => {
      await tx.delete(schema.userPermissions).where(eq(schema.userPermissions.userId, userId));
      if (resolved.length > 0) {
        await tx.insert(schema.userPermissions).values(resolved.map((permissionName) => ({ userId, permissionName })));
      }
    });
  }

  async setSuperuser(userId: number, isSuperuser: boolean) {
    await this.db.update(schema.users).set({ isSuperuser }).where(eq(schema.users.id, userId));
  }

  async countOtherSuperusers(excludeUserId: number): Promise<number> {
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.users)
      .where(and(eq(schema.users.isSuperuser, true), ne(schema.users.id, excludeUserId)));
    return Number(total);
  }

  async incrementTokenVersion(userId: number) {
    await this.db
      .update(schema.users)
      .set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` })
      .where(eq(schema.users.id, userId));
  }

  async findByEmail(email: string) {
    return this.db.query.users.findFirst({ where: eq(schema.users.email, email) });
  }

  async generateResetToken(userId: number): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(schema.passwordResetTokens.userId, userId), isNull(schema.passwordResetTokens.usedAt)));
      await tx.insert(schema.passwordResetTokens).values({ userId, tokenHash, expiresAt });
    });

    return rawToken;
  }

  async clearLockout(userId: number): Promise<void> {
    await this.db.update(schema.users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(schema.users.id, userId));
  }

  async findByOidcSubject(subject: string, issuer: string) {
    return this.db.query.users.findFirst({
      where: and(eq(schema.users.oidcSubject, subject), eq(schema.users.oidcIssuer, issuer)),
    });
  }

  async linkOidcIdentity(userId: number, oidcSubject: string, oidcIssuer: string, avatarUrl?: string) {
    await this.db
      .update(schema.users)
      .set({ oidcSubject, oidcIssuer, ...(avatarUrl ? { avatarUrl } : {}) })
      .where(eq(schema.users.id, userId));
  }

  async unlinkOidcIdentity(userId: number) {
    await this.db.update(schema.users).set({ oidcSubject: null, oidcIssuer: null, provisioningMethod: 'local' }).where(eq(schema.users.id, userId));
  }

  async getUserOidcIdentity(userId: number): Promise<{ oidcSubject: string | null; oidcIssuer: string | null } | null> {
    const row = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { oidcSubject: true, oidcIssuer: true },
    });
    return row ?? null;
  }

  async findPasswordHashById(userId: number): Promise<string | null> {
    const row = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { passwordHash: true },
    });
    return row?.passwordHash ?? null;
  }

  async createOidcUser(data: { username: string; name: string; email?: string; oidcSubject: string; oidcIssuer: string; avatarUrl?: string }) {
    const passwordHash = await hash(`OIDC_USER_${randomUUID()}`, 12);
    const [user] = await this.db
      .insert(schema.users)
      .values({
        username: data.username,
        name: data.name,
        email: data.email,
        passwordHash,
        isDefaultPassword: false,
        oidcSubject: data.oidcSubject,
        oidcIssuer: data.oidcIssuer,
        avatarUrl: data.avatarUrl,
        avatarSource: data.avatarUrl ? 'external' : 'none',
        provisioningMethod: 'oidc',
      })
      .returning();
    return user;
  }

  async findAvatarStateById(id: number) {
    return this.db.query.users.findFirst({
      where: eq(schema.users.id, id),
      columns: {
        id: true,
        avatarUrl: true,
        avatarSource: true,
        avatarVersion: true,
      },
    });
  }

  async setAvatarSourceAndBumpVersion(userId: number, avatarSource: 'none' | 'external' | 'uploaded') {
    await this.db
      .update(schema.users)
      .set({
        avatarSource,
        avatarVersion: sql`${schema.users.avatarVersion} + 1`,
      })
      .where(eq(schema.users.id, userId));
  }

  async assignViewerLibraries(userId: number, libraryIds: number[]) {
    if (libraryIds.length === 0) return;
    await this.db
      .insert(schema.userLibraryAccess)
      .values(libraryIds.map((libraryId) => ({ userId, libraryId, accessLevel: 'viewer' as const })))
      .onConflictDoNothing();
  }

  async findLibraryIdsByUserId(userId: number): Promise<number[]> {
    const rows = await this.db
      .select({ libraryId: schema.userLibraryAccess.libraryId })
      .from(schema.userLibraryAccess)
      .where(eq(schema.userLibraryAccess.userId, userId));
    return rows.map((r) => r.libraryId);
  }

  async findExistingLibraryIds(libraryIds: number[]): Promise<number[]> {
    if (libraryIds.length === 0) return [];
    const rows = await this.db.select({ id: schema.libraries.id }).from(schema.libraries).where(inArray(schema.libraries.id, libraryIds));
    return rows.map((r) => r.id);
  }

  async replaceViewerLibraries(userId: number, libraryIds: number[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.userLibraryAccess).where(eq(schema.userLibraryAccess.userId, userId));
      if (libraryIds.length > 0) {
        await tx.insert(schema.userLibraryAccess).values(libraryIds.map((libraryId) => ({ userId, libraryId, accessLevel: 'viewer' as const })));
      }
    });
  }
}
