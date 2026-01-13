import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { and, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { hash } from 'bcryptjs';

import { RequestUser, RequestUserRole } from '../../common/types/request-user';
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

    const userIds = userPage.map((u) => u.id);
    if (userIds.length === 0) return { users: [], total };

    const rows = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        name: schema.users.name,
        email: schema.users.email,
        active: schema.users.active,
        isDefaultPassword: schema.users.isDefaultPassword,
        createdAt: schema.users.createdAt,
        roleId: schema.roles.id,
        roleName: schema.roles.name,
        roleIsSuperuser: schema.roles.isSuperuser,
        roleIsSystem: schema.roles.isSystem,
      })
      .from(schema.users)
      .leftJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .leftJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(inArray(schema.users.id, userIds))
      .orderBy(schema.users.username);

    type UserListRole = { id: number; name: string; isSuperuser: boolean; isSystem: boolean };
    type UserListItem = {
      id: number;
      username: string;
      name: string;
      email: string | null;
      active: boolean;
      isDefaultPassword: boolean;
      createdAt: Date;
      roles: UserListRole[];
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
          isDefaultPassword: row.isDefaultPassword,
          createdAt: row.createdAt,
          roles: [],
        });
      }
      if (row.roleId) {
        usersMap.get(row.id)!.roles.push({ id: row.roleId, name: row.roleName!, isSuperuser: row.roleIsSuperuser!, isSystem: row.roleIsSystem! });
      }
    }

    const users = userIds.map((id) => usersMap.get(id)!);
    return { users, total };
  }

  async findByUsername(username: string) {
    return this.db.query.users.findFirst({ where: eq(schema.users.username, username) });
  }

  async findByIdWithRolesAndPermissions(id: number): Promise<RequestUser | null> {
    const rows = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        name: schema.users.name,
        email: schema.users.email,
        active: schema.users.active,
        isDefaultPassword: schema.users.isDefaultPassword,
        tokenVersion: schema.users.tokenVersion,
        settings: schema.users.settings,
        avatarUrl: schema.users.avatarUrl,
        provisioningMethod: schema.users.provisioningMethod,
        roleId: schema.roles.id,
        roleName: schema.roles.name,
        roleDescription: schema.roles.description,
        roleIsSuperuser: schema.roles.isSuperuser,
        roleIsSystem: schema.roles.isSystem,
        permId: schema.permissions.id,
        permName: schema.permissions.name,
      })
      .from(schema.users)
      .leftJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .leftJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
      .leftJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .where(eq(schema.users.id, id));

    if (rows.length === 0) return null;

    const first = rows[0];
    const rolesMap = new Map<number, RequestUserRole>();

    for (const row of rows) {
      if (row.roleId === null) continue;
      if (!rolesMap.has(row.roleId)) {
        rolesMap.set(row.roleId, {
          id: row.roleId,
          name: row.roleName!,
          description: row.roleDescription ?? null,
          isSuperuser: row.roleIsSuperuser!,
          isSystem: row.roleIsSystem!,
          permissions: [],
        });
      }
      if (row.permId !== null) {
        const role = rolesMap.get(row.roleId)!;
        if (!role.permissions.some((p) => p.id === row.permId)) {
          role.permissions.push({ id: row.permId, name: row.permName! });
        }
      }
    }

    return {
      id: first.id,
      username: first.username,
      name: first.name,
      email: first.email,
      active: first.active,
      isDefaultPassword: first.isDefaultPassword,
      tokenVersion: first.tokenVersion,
      settings: first.settings as Record<string, unknown>,
      avatarUrl: first.avatarUrl,
      provisioningMethod: first.provisioningMethod,
      roles: Array.from(rolesMap.values()),
    };
  }

  async create(data: typeof schema.users.$inferInsert) {
    const [user] = await this.db.insert(schema.users).values(data).returning();
    return user;
  }

  async update(id: number, data: Partial<Pick<typeof schema.users.$inferInsert, 'name' | 'email' | 'active' | 'settings'>>) {
    const [user] = await this.db.update(schema.users).set(data).where(eq(schema.users.id, id)).returning({
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

  async assignRole(userId: number, roleId: number) {
    await this.db.insert(schema.userRoles).values({ userId, roleId }).onConflictDoNothing();
  }

  async revokeRole(userId: number, roleId: number) {
    await this.db.delete(schema.userRoles).where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.roleId, roleId)));
  }

  async countOtherSuperusers(excludeUserId: number): Promise<number> {
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .where(and(eq(schema.roles.isSuperuser, true), ne(schema.userRoles.userId, excludeUserId)));
    return total;
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
        provisioningMethod: 'oidc',
      })
      .returning();
    return user;
  }
}
