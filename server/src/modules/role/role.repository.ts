import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class RoleRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAll() {
    return this.db.query.roles.findMany({ orderBy: schema.roles.name });
  }

  findById(id: number) {
    return this.db.query.roles.findFirst({ where: eq(schema.roles.id, id) });
  }

  async findWithPermissions(id: number) {
    const rows = await this.db
      .select({
        roleId: schema.roles.id,
        roleName: schema.roles.name,
        roleDesc: schema.roles.description,
        roleIsSuperuser: schema.roles.isSuperuser,
        roleIsSystem: schema.roles.isSystem,
        permId: schema.permissions.id,
        permName: schema.permissions.name,
        permDesc: schema.permissions.description,
      })
      .from(schema.roles)
      .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
      .leftJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .where(eq(schema.roles.id, id));

    if (rows.length === 0) return null;

    const first = rows[0];
    return {
      id: first.roleId,
      name: first.roleName,
      description: first.roleDesc,
      isSuperuser: first.roleIsSuperuser,
      isSystem: first.roleIsSystem,
      permissions: rows.filter((r) => r.permId !== null).map((r) => ({ id: r.permId!, name: r.permName!, description: r.permDesc })),
    };
  }

  async findAllWithPermissions() {
    const rows = await this.db
      .select({
        roleId: schema.roles.id,
        roleName: schema.roles.name,
        roleDesc: schema.roles.description,
        roleIsSuperuser: schema.roles.isSuperuser,
        roleIsSystem: schema.roles.isSystem,
        permId: schema.permissions.id,
        permName: schema.permissions.name,
        permDesc: schema.permissions.description,
      })
      .from(schema.roles)
      .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
      .leftJoin(schema.permissions, eq(schema.permissions.id, schema.rolePermissions.permissionId))
      .orderBy(schema.roles.name);

    const rolesMap = new Map<
      number,
      {
        id: number;
        name: string;
        description: string | null;
        isSuperuser: boolean;
        isSystem: boolean;
        permissions: { id: number; name: string; description: string | null }[];
      }
    >();

    for (const row of rows) {
      if (!rolesMap.has(row.roleId)) {
        rolesMap.set(row.roleId, {
          id: row.roleId,
          name: row.roleName,
          description: row.roleDesc ?? null,
          isSuperuser: row.roleIsSuperuser,
          isSystem: row.roleIsSystem,
          permissions: [],
        });
      }
      if (row.permId !== null) {
        rolesMap.get(row.roleId)!.permissions.push({ id: row.permId, name: row.permName!, description: row.permDesc ?? null });
      }
    }

    return Array.from(rolesMap.values());
  }

  async create(data: { name: string; description?: string }) {
    const [role] = await this.db.insert(schema.roles).values(data).returning();
    return role;
  }

  async update(id: number, data: { name?: string; description?: string }) {
    const [role] = await this.db.update(schema.roles).set(data).where(eq(schema.roles.id, id)).returning();
    return role;
  }

  async delete(id: number) {
    await this.db.delete(schema.roles).where(eq(schema.roles.id, id));
  }

  async assignPermission(roleId: number, permissionId: number) {
    await this.db.insert(schema.rolePermissions).values({ roleId, permissionId }).onConflictDoNothing();
  }

  async revokePermission(roleId: number, permissionId: number) {
    await this.db
      .delete(schema.rolePermissions)
      .where(and(eq(schema.rolePermissions.roleId, roleId), eq(schema.rolePermissions.permissionId, permissionId)));
  }

  findAllPermissions() {
    return this.db.query.permissions.findMany({ orderBy: schema.permissions.name });
  }

  findPermissionById(id: number) {
    return this.db.query.permissions.findFirst({ where: eq(schema.permissions.id, id) });
  }

  async createPermission(data: { name: string; description?: string }) {
    const [perm] = await this.db.insert(schema.permissions).values(data).returning();
    return perm;
  }

  async deletePermission(id: number) {
    await this.db.delete(schema.permissions).where(eq(schema.permissions.id, id));
  }
}
