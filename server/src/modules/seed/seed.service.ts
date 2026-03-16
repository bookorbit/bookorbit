import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async onApplicationBootstrap() {
    await this.seedAppSettings();
    await this.seedEmailDefaults();
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

    await this.db
      .insert(schema.appSettings)
      .values({ key: 'staging_auto_finalize_metadata_mode', value: 'safe_merge' })
      .onConflictDoNothing({ target: schema.appSettings.key });

    await this.db
      .insert(schema.appSettings)
      .values({ key: 'authors_auto_enrichment_enabled', value: 'false' })
      .onConflictDoNothing({ target: schema.appSettings.key });

    await this.db
      .insert(schema.appSettings)
      .values({ key: 'authors_auto_enrichment_write_mode', value: 'missing_only' })
      .onConflictDoNothing({ target: schema.appSettings.key });

    const defaultAuthorEnrichmentConfig = JSON.stringify({
      enabled: false,
      triggerOnImport: true,
      writeMode: 'missing_only',
      conditions: { neverEnriched: true, missingBio: false, missingPhoto: false },
    });
    await this.db
      .insert(schema.appSettings)
      .values({ key: 'authors_auto_enrichment_config', value: defaultAuthorEnrichmentConfig })
      .onConflictDoNothing({ target: schema.appSettings.key });

    await this.db
      .insert(schema.appSettings)
      .values({ key: 'authors_provider_audnexus_enabled', value: 'true' })
      .onConflictDoNothing({ target: schema.appSettings.key });

    const defaultOidcConfig = JSON.stringify({
      enabled: false,
      issuerUri: '',
      clientId: '',
      clientSecret: '',
      scopes: 'openid profile email',
      claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
      autoProvision: { enabled: false, allowLocalLinking: true, defaultPermissionNames: [] },
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
  }
}
