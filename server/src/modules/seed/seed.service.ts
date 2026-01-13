import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

const BUILT_IN_PERMISSIONS = [
  { name: 'manage_users', description: 'Create/edit/delete/deactivate users', isSystem: true },
  { name: 'manage_roles', description: 'Create/edit/delete roles and permissions', isSystem: true },
  { name: 'manage_libraries', description: 'Create/delete/edit libraries, assign access', isSystem: true },
  { name: 'manage_app_settings', description: 'Change global app settings', isSystem: true },
  { name: 'library_upload', description: 'Add books to a library', isSystem: true },
  { name: 'library_download', description: 'Download book files', isSystem: true },
  { name: 'library_edit_metadata', description: 'Edit book info', isSystem: true },
  { name: 'library_delete_books', description: 'Delete books from a library', isSystem: true },
  { name: 'kobo_sync', description: 'Sync with Kobo device', isSystem: true },
];

const ADMIN_PERMISSIONS = [
  'manage_users',
  'manage_roles',
  'manage_libraries',
  'manage_app_settings',
  'library_upload',
  'library_download',
  'library_edit_metadata',
  'library_delete_books',
  'kobo_sync',
];

const USER_PERMISSIONS = ['library_upload', 'library_download', 'library_edit_metadata', 'library_delete_books', 'kobo_sync'];

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async onApplicationBootstrap() {
    await this.seedPermissions();
    await this.seedRoles();
    await this.seedAppSettings();
    await this.seedDefaultAdmin();
  }

  private async seedPermissions() {
    for (const perm of BUILT_IN_PERMISSIONS) {
      await this.db
        .insert(schema.permissions)
        .values(perm)
        .onConflictDoUpdate({ target: schema.permissions.name, set: { isSystem: true } });
    }
  }

  private async seedRoles() {
    const [adminRole] = await this.db
      .insert(schema.roles)
      .values({ name: 'Admin', description: 'Full system access', isSuperuser: true, isSystem: true })
      .onConflictDoNothing({ target: schema.roles.name })
      .returning();

    const [userRole] = await this.db
      .insert(schema.roles)
      .values({ name: 'User', description: 'Standard user access', isSuperuser: false, isSystem: true })
      .onConflictDoNothing({ target: schema.roles.name })
      .returning();

    // Fetch roles by name in case they already existed (onConflictDoNothing returns empty on conflict)
    const adminRoleRow = adminRole ?? (await this.db.query.roles.findFirst({ where: eq(schema.roles.name, 'Admin') }));
    const userRoleRow = userRole ?? (await this.db.query.roles.findFirst({ where: eq(schema.roles.name, 'User') }));

    if (adminRoleRow) {
      await this.assignPermissionsToRole(adminRoleRow.id, ADMIN_PERMISSIONS);
    }
    if (userRoleRow) {
      await this.assignPermissionsToRole(userRoleRow.id, USER_PERMISSIONS);
    }
  }

  private async assignPermissionsToRole(roleId: number, permissionNames: string[]) {
    const perms = await this.db.query.permissions.findMany({
      where: inArray(schema.permissions.name, permissionNames),
    });
    for (const perm of perms) {
      await this.db.insert(schema.rolePermissions).values({ roleId, permissionId: perm.id }).onConflictDoNothing();
    }
  }

  private async seedAppSettings() {
    await this.db
      .insert(schema.appSettings)
      .values({ key: 'allow_registration', value: 'false' })
      .onConflictDoNothing({ target: schema.appSettings.key });

    const defaultOidcConfig = JSON.stringify({
      enabled: false,
      issuerUri: '',
      clientId: '',
      clientSecret: '',
      scopes: 'openid profile email',
      claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
      autoProvision: { enabled: false, allowLocalLinking: true, defaultRoleId: null },
    });
    await this.db
      .insert(schema.appSettings)
      .values({ key: 'oidc_config', value: defaultOidcConfig })
      .onConflictDoNothing({ target: schema.appSettings.key });
  }

  private async seedDefaultAdmin() {
    const count = await this.db.$count(schema.users);
    if (count > 0) return;

    const passwordHash = await hash('admin', 12);
    const [user] = await this.db
      .insert(schema.users)
      .values({
        username: 'admin',
        name: 'Administrator',
        passwordHash,
        isDefaultPassword: true,
      })
      .returning();

    const adminRole = await this.db.query.roles.findFirst({ where: eq(schema.roles.name, 'Admin') });
    if (adminRole) {
      await this.db.insert(schema.userRoles).values({ userId: user.id, roleId: adminRole.id });
    }

    this.logger.warn('WARNING: Default admin account created. Login with admin/admin and change your password immediately.');
  }
}
