import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  APP_SETTING_KEYS,
  DEFAULT_AUDIT_RETENTION_DAYS,
  DEFAULT_AUTHOR_ENRICHMENT_CONFIG,
  DEFAULT_OIDC_CONFIG,
} from '../../common/constants/app-settings.constants';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { getSanitizedErrorInfo } from './seed-log.util';

const DEFAULT_SYSTEM_EMAIL_TEMPLATE_NAME = 'Default';
const DEFAULT_SYSTEM_EMAIL_TEMPLATE_SUBJECT = 'Your copy of {{title}} is ready';
const DEFAULT_SYSTEM_EMAIL_TEMPLATE_BODY =
  'Hi,\n' +
  '\n' +
  'Your copy of "{{title}}" by {{author}} is attached and ready to read.\n' +
  '\n' +
  'Format: {{format}} ({{fileSize}})\n' +
  '\n' +
  'Enjoy!\n' +
  '- {{senderName}}';

const DEFAULT_APP_SETTINGS: Array<typeof schema.appSettings.$inferInsert> = [
  { key: APP_SETTING_KEYS.ALLOW_REGISTRATION, value: 'false' },
  { key: APP_SETTING_KEYS.OPDS_ENABLED, value: 'true' },
  { key: APP_SETTING_KEYS.BOOK_DOCK_AUTO_FETCH_METADATA, value: 'true' },
  { key: APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_ENABLED, value: 'false' },
  { key: APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_THRESHOLD, value: '85' },
  { key: APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_LIBRARY_ID, value: '' },
  { key: APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_FOLDER_ID, value: '' },
  { key: APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_METADATA_MODE, value: 'safe_merge' },
  { key: APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_ENABLED, value: 'false' },
  { key: APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_WRITE_MODE, value: 'missing_only' },
  { key: APP_SETTING_KEYS.AUTHORS_AUTO_ENRICHMENT_CONFIG, value: JSON.stringify(DEFAULT_AUTHOR_ENRICHMENT_CONFIG) },
  { key: APP_SETTING_KEYS.AUTHORS_PROVIDER_AUDNEXUS_ENABLED, value: 'true' },
  { key: APP_SETTING_KEYS.AUDIT_RETENTION_DAYS, value: String(DEFAULT_AUDIT_RETENTION_DAYS) },
  { key: APP_SETTING_KEYS.OIDC_CONFIG, value: JSON.stringify(DEFAULT_OIDC_CONFIG) },
  { key: APP_SETTING_KEYS.UPDATE_CHECK_ENABLED, value: 'true' },
  { key: APP_SETTING_KEYS.HARDCOVER_ENABLED, value: 'false' },
];

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async onApplicationBootstrap() {
    const startedAt = Date.now();
    const event = 'seed.bootstrap_defaults';
    this.logger.log(`[${event}] [start] - default seeding started`);
    try {
      const appSettingsInserted = await this.seedAppSettings();
      const systemTemplatesInserted = await this.seedEmailDefaults();
      this.logger.log(
        `[${event}] [end] appSettingsInserted=${appSettingsInserted} systemTemplatesInserted=${systemTemplatesInserted} durationMs=${Date.now() - startedAt} - default seeding completed`,
      );
    } catch (error) {
      const { errorClass, errorMessage } = getSanitizedErrorInfo(error);
      this.logger.error(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - default seeding failed`,
      );
      throw error;
    }
  }

  private async seedAppSettings(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const result = await tx.insert(schema.appSettings).values(DEFAULT_APP_SETTINGS).onConflictDoNothing({ target: schema.appSettings.key });
      return result.rowCount ?? 0;
    });
  }

  private async seedEmailDefaults(): Promise<number> {
    const existingSystemTemplate = await this.db.query.emailTemplates.findFirst({
      where: and(isNull(schema.emailTemplates.userId), eq(schema.emailTemplates.isSystem, true)),
    });

    if (existingSystemTemplate) return 0;

    const result = await this.db
      .insert(schema.emailTemplates)
      .values({
        userId: null,
        name: DEFAULT_SYSTEM_EMAIL_TEMPLATE_NAME,
        subject: DEFAULT_SYSTEM_EMAIL_TEMPLATE_SUBJECT,
        bodyText: DEFAULT_SYSTEM_EMAIL_TEMPLATE_BODY,
        isDefault: true,
        isSystem: true,
      })
      .onConflictDoNothing();

    return result.rowCount ?? 0;
  }
}
