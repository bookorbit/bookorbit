import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DEFAULT_UPLOAD_PATTERN } from '@projectx/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';

const APP_SETTING_KEYS = {
  OIDC_CONFIG: 'oidc_config',
  UPLOAD_FILE_PATTERN: 'upload_file_pattern',
} as const;

type Db = NodePgDatabase<typeof schema>;

export interface OidcFullConfig {
  enabled: boolean;
  providerName: string;
  issuerUri: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  claimMapping: {
    username: string;
    name: string;
    email: string;
    groups: string;
  };
  autoProvision: {
    enabled: boolean;
    allowLocalLinking: boolean;
    defaultRoleId: number | null;
  };
}

const DEFAULT_OIDC_CONFIG: OidcFullConfig = {
  enabled: false,
  providerName: '',
  issuerUri: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
  autoProvision: { enabled: false, allowLocalLinking: true, defaultRoleId: null },
};

@Injectable()
export class AppSettingsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAll() {
    return this.db.select().from(schema.appSettings).orderBy(schema.appSettings.key);
  }

  async update(key: string, value: string) {
    const [setting] = await this.db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).returning();

    if (!setting) throw new NotFoundException(`Setting '${key}' not found`);
    return setting;
  }

  async getOidcConfig(): Promise<OidcFullConfig> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(schema.appSettings.key, APP_SETTING_KEYS.OIDC_CONFIG) });
    if (!row) return { ...DEFAULT_OIDC_CONFIG };
    try {
      return JSON.parse(row.value) as OidcFullConfig;
    } catch {
      return { ...DEFAULT_OIDC_CONFIG };
    }
  }

  async getUploadPattern(): Promise<string> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(schema.appSettings.key, APP_SETTING_KEYS.UPLOAD_FILE_PATTERN) });
    return row?.value ?? DEFAULT_UPLOAD_PATTERN;
  }

  async setUploadPattern(pattern: string): Promise<void> {
    await this.db
      .insert(schema.appSettings)
      .values({ key: APP_SETTING_KEYS.UPLOAD_FILE_PATTERN, value: pattern })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: pattern } });
  }

  async updateOidcConfig(config: Partial<OidcFullConfig>): Promise<OidcFullConfig> {
    const current = await this.getOidcConfig();
    const merged: OidcFullConfig = {
      ...current,
      ...config,
      claimMapping: { ...current.claimMapping, ...(config.claimMapping ?? {}) },
      autoProvision: { ...current.autoProvision, ...(config.autoProvision ?? {}) },
    };
    const value = JSON.stringify(merged);

    await this.db
      .insert(schema.appSettings)
      .values({ key: APP_SETTING_KEYS.OIDC_CONFIG, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });

    return merged;
  }
}
