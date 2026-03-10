import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

const BUILT_IN_PERMISSIONS = [
  { name: 'manage_users', description: 'Create/edit/delete/deactivate users', isSystem: true },
  { name: 'manage_roles', description: 'Create/edit/delete roles and permissions', isSystem: true },
  { name: 'manage_libraries', description: 'Create/delete/edit libraries, assign access', isSystem: true },
  { name: 'manage_app_settings', description: 'Change global app settings', isSystem: true },
  { name: 'library_upload', description: 'Add books to a library', isSystem: true },
  { name: 'library_download', description: 'Download book files', isSystem: true },
  { name: 'library_edit_metadata', description: 'Edit book info', isSystem: true },
  { name: 'library_delete_books', description: 'Remove books from a library', isSystem: true },
  { name: 'kobo_sync', description: 'Sync with Kobo device', isSystem: true },
  { name: 'opds_access', description: 'Access the OPDS catalog', isSystem: true },
  { name: 'staging_access', description: 'Access the staging inbox to review and import files', isSystem: true },
  { name: 'email_send', description: 'Send books via email', isSystem: true },
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
  'opds_access',
  'staging_access',
  'email_send',
];

const USER_PERMISSIONS = [
  'library_upload',
  'library_download',
  'library_edit_metadata',
  'library_delete_books',
  'kobo_sync',
  'opds_access',
  'staging_access',
  'email_send',
];

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async onApplicationBootstrap() {
    await this.seedPermissions();
    await this.seedRoles();
    await this.seedAppSettings();
    await this.seedEmailDefaults();
  }

  private async seedPermissions() {
    await this.db
      .insert(schema.permissions)
      .values(BUILT_IN_PERMISSIONS)
      .onConflictDoUpdate({ target: schema.permissions.name, set: { isSystem: true } });
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
    if (perms.length === 0) return;
    await this.db
      .insert(schema.rolePermissions)
      .values(perms.map((perm) => ({ roleId, permissionId: perm.id })))
      .onConflictDoNothing();
  }

  private async seedAppSettings() {
    await this.db
      .insert(schema.appSettings)
      .values({ key: 'allow_registration', value: 'false' })
      .onConflictDoNothing({ target: schema.appSettings.key });

    await this.db.insert(schema.appSettings).values({ key: 'opds_enabled', value: 'true' }).onConflictDoNothing({ target: schema.appSettings.key });

    await this.db
      .insert(schema.appSettings)
      .values({ key: 'staging_auto_fetch_metadata', value: 'true' })
      .onConflictDoNothing({ target: schema.appSettings.key });

    await this.db
      .insert(schema.appSettings)
      .values({ key: 'staging_auto_finalize_enabled', value: 'false' })
      .onConflictDoNothing({ target: schema.appSettings.key });

    await this.db
      .insert(schema.appSettings)
      .values({ key: 'staging_auto_finalize_threshold', value: '85' })
      .onConflictDoNothing({ target: schema.appSettings.key });

    await this.db
      .insert(schema.appSettings)
      .values({ key: 'staging_auto_finalize_library_id', value: '' })
      .onConflictDoNothing({ target: schema.appSettings.key });

    await this.db
      .insert(schema.appSettings)
      .values({ key: 'staging_auto_finalize_folder_id', value: '' })
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

  private async seedEmailDefaults() {
    const existingSystemTemplate = await this.db.query.emailTemplates.findFirst({
      where: and(isNull(schema.emailTemplates.userId), eq(schema.emailTemplates.isSystem, true)),
    });

    if (!existingSystemTemplate) {
      await this.db.insert(schema.emailTemplates).values({
        userId: null,
        name: 'Default',
        subject: 'Your copy of {{title}} is ready',
        bodyText:
          'Hi,\n' +
          '\n' +
          'Your copy of "{{title}}" by {{author}} is attached and ready to read.\n' +
          '\n' +
          'Format: {{format}} ({{fileSize}})\n' +
          '\n' +
          'Enjoy!\n' +
          '- {{senderName}}',
        isDefault: true,
        isSystem: true,
      });
    }

    const emailRelayDefaults: Array<{ key: string; value: string }> = [
      { key: 'email_relay_enabled', value: 'false' },
      { key: 'email_relay_smtp', value: '{}' },
      { key: 'email_relay_from_strategy', value: 'system' },
      { key: 'email_relay_allow_user_override', value: 'true' },
      { key: 'email_domain_allowlist', value: '[]' },
      { key: 'email_domain_blocklist', value: '[]' },
    ];

    for (const setting of emailRelayDefaults) {
      await this.db.insert(schema.appSettings).values(setting).onConflictDoNothing({ target: schema.appSettings.key });
    }
  }
}
