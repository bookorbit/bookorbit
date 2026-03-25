import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { FieldPreferenceOverrides, LibraryMetadataPreferences, MetadataFetchPreferences } from '@projectx/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { MetadataPreferenceResolver } from './metadata-preference-resolver';

type Db = NodePgDatabase<typeof schema>;

const GLOBAL_PREFERENCES_KEY = 'metadata_fetch_preferences';

@Injectable()
export class MetadataPreferencesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly resolver: MetadataPreferenceResolver,
  ) {}

  async getGlobal(): Promise<MetadataFetchPreferences> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, GLOBAL_PREFERENCES_KEY),
    });
    if (!row) return this.resolver.getDefaultPreferences();
    try {
      const parsed = JSON.parse(row.value) as MetadataFetchPreferences;
      return this.resolver.resolve(parsed, null);
    } catch {
      return this.resolver.getDefaultPreferences();
    }
  }

  async setGlobal(prefs: MetadataFetchPreferences): Promise<void> {
    const normalized = this.resolver.resolve(prefs, null);
    const value = JSON.stringify(normalized);
    await this.db
      .insert(schema.appSettings)
      .values({ key: GLOBAL_PREFERENCES_KEY, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
  }

  async getForLibrary(libraryId: number, global?: MetadataFetchPreferences): Promise<LibraryMetadataPreferences> {
    const library = await this.db.query.libraries.findFirst({
      where: eq(schema.libraries.id, libraryId),
      columns: { metadataFetchPreferences: true },
    });
    if (!library) throw new NotFoundException(`Library ${libraryId} not found`);

    const globalPrefs = global ?? (await this.getGlobal());
    const overrides = library.metadataFetchPreferences ?? null;
    const effective = this.resolver.resolve(globalPrefs, overrides);
    return { libraryId, overrides, effective };
  }

  async setLibraryOverrides(libraryId: number, overrides: FieldPreferenceOverrides): Promise<void> {
    const library = await this.db.query.libraries.findFirst({
      where: eq(schema.libraries.id, libraryId),
      columns: { id: true },
    });
    if (!library) throw new NotFoundException(`Library ${libraryId} not found`);
    await this.db
      .update(schema.libraries)
      .set({ metadataFetchPreferences: Object.keys(overrides).length ? overrides : null })
      .where(eq(schema.libraries.id, libraryId));
  }

  async resetGlobal(): Promise<void> {
    await this.db.delete(schema.appSettings).where(eq(schema.appSettings.key, GLOBAL_PREFERENCES_KEY));
  }

  async resetLibraryToGlobal(libraryId: number): Promise<void> {
    const result = await this.db
      .update(schema.libraries)
      .set({ metadataFetchPreferences: null })
      .where(eq(schema.libraries.id, libraryId))
      .returning({ id: schema.libraries.id });
    if (!result.length) throw new NotFoundException(`Library ${libraryId} not found`);
  }
}
