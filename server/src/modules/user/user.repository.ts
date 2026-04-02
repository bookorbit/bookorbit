import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { and, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { hash } from 'bcryptjs';

import { Permission } from '@projectx/types';
import { RequestUser } from '../../common/types/request-user';
import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class UserRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(page: number, pageSize: number) {
    const offset = page * pageSize;

    const [userPage, [{ total }]] = await Promise.all([
      this.db.select({ id: schema.users.id }).from(schema.users).orderBy(schema.users.username).limit(pageSize).offset(offset),
      this.db.select({ total: count() }).from(schema.users),
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
        provisioningMethod: schema.users.provisioningMethod,
        createdAt: schema.users.createdAt,
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
      provisioningMethod: string;
      createdAt: Date;
      permissions: Permission[];
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
          provisioningMethod: row.provisioningMethod,
          createdAt: row.createdAt,
          permissions: [],
        });
      }
      if (row.permissionName) {
        usersMap.get(row.id)!.permissions.push(row.permissionName as Permission);
      }
    }

    const users = userIds.map((id) => usersMap.get(id)).filter((user): user is UserListItem => user !== undefined);
    return { users, total: normalizedTotal };
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
    const rows = await this.db
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
        permissionName: schema.userPermissions.permissionName,
      })
      .from(schema.users)
      .leftJoin(schema.userPermissions, eq(schema.userPermissions.userId, schema.users.id))
      .where(eq(schema.users.id, id));

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
    };
  }

  async create(data: typeof schema.users.$inferInsert) {
    const [user] = await this.db.insert(schema.users).values(data).returning();
    return user;
  }

  async update(id: number, data: Partial<Pick<typeof schema.users.$inferInsert, 'name' | 'email' | 'active' | 'settings'>>) {
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

  async setPermissions(userId: number, permissionNames: Permission[]) {
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.userPermissions).where(eq(schema.userPermissions.userId, userId));
      if (permissionNames.length > 0) {
        await tx.insert(schema.userPermissions).values(permissionNames.map((permissionName) => ({ userId, permissionName })));
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
