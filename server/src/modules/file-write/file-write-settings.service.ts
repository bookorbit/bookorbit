import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { GlobalFileWriteSettings } from '@projectx/types';
import { DEFAULT_FILE_WRITE_SETTINGS } from '@projectx/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';

const FILE_WRITE_SETTINGS_KEY = 'file_write_settings';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class FileWriteSettingsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // libraryId reserved for Phase 2 per-library overrides
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolve(_libraryId: number): Promise<GlobalFileWriteSettings> {
    return this.getGlobal();
  }

  async getGlobal(): Promise<GlobalFileWriteSettings> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, FILE_WRITE_SETTINGS_KEY),
    });
    if (!row) return { ...DEFAULT_FILE_WRITE_SETTINGS };
    try {
      const stored = JSON.parse(row.value) as Partial<GlobalFileWriteSettings>;
      return mergeSettings(DEFAULT_FILE_WRITE_SETTINGS, stored);
    } catch {
      return { ...DEFAULT_FILE_WRITE_SETTINGS };
    }
  }

  async updateGlobal(patch: Partial<GlobalFileWriteSettings>): Promise<GlobalFileWriteSettings> {
    const current = await this.getGlobal();
    const merged = mergeSettings(current, patch);
    const value = JSON.stringify(merged);
    await this.db
      .insert(schema.appSettings)
      .values({ key: FILE_WRITE_SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
    return merged;
  }
}

function mergeSettings(base: GlobalFileWriteSettings, patch: Partial<GlobalFileWriteSettings>): GlobalFileWriteSettings {
  return {
    ...base,
    ...patch,
    epub: { ...base.epub, ...(patch.epub ?? {}) },
    pdf: { ...base.pdf, ...(patch.pdf ?? {}) },
    cbx: { ...base.cbx, ...(patch.cbx ?? {}) },
  };
}
