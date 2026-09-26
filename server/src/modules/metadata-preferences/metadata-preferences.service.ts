import { Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { eq, isNotNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { FieldPreferenceOverrides, LibraryMetadataPreferences, MetadataFetchPreferences } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { MetadataPreferenceResolver } from './metadata-preference-resolver';

type Db = NodePgDatabase<typeof schema>;

const GLOBAL_PREFERENCES_KEY = 'metadata_fetch_preferences';
const AUDIO_COVER_SEED_KEY = 'metadata_fetch_audio_cover_rule_seeded';

@Injectable()
export class MetadataPreferencesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MetadataPreferencesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly resolver: MetadataPreferenceResolver,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.seedAudioCoverRules();
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[metadata_preferences.audio_cover_seed] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - audiobook cover rules not seeded; the Cover rule still seeds them on read`,
      );
    }
  }

  /**
   * Writes an Audiobook cover rule into every stored scope that has only a Cover rule, once. A
   * marker keeps it from running again, so a library override the user later removes stays removed.
   */
  async seedAudioCoverRules(): Promise<{ global: boolean; libraries: number } | null> {
    const startedAt = Date.now();
    const marker = await this.db.query.appSettings.findFirst({ where: eq(schema.appSettings.key, AUDIO_COVER_SEED_KEY) });
    if (marker) return null;

    let globalSeeded = false;
    const globalRow = await this.db.query.appSettings.findFirst({ where: eq(schema.appSettings.key, GLOBAL_PREFERENCES_KEY) });
    if (globalRow) {
      const parsed = this.parseStoredPreferences(globalRow.value);
      const seededFields = parsed ? this.resolver.withSeededAudioCoverRule(parsed.fields) : undefined;
      if (parsed && seededFields && seededFields !== parsed.fields) {
        await this.db
          .update(schema.appSettings)
          .set({ value: JSON.stringify({ ...parsed, fields: seededFields }) })
          .where(eq(schema.appSettings.key, GLOBAL_PREFERENCES_KEY));
        globalSeeded = true;
      }
    }

    const libraryRows = await this.db
      .select({ id: schema.libraries.id, overrides: schema.libraries.metadataFetchPreferences })
      .from(schema.libraries)
      .where(isNotNull(schema.libraries.metadataFetchPreferences));
    let librariesSeeded = 0;
    for (const row of libraryRows) {
      const seeded = this.resolver.withSeededAudioCoverRule(row.overrides);
      if (!seeded || seeded === row.overrides) continue;
      await this.db.update(schema.libraries).set({ metadataFetchPreferences: seeded }).where(eq(schema.libraries.id, row.id));
      librariesSeeded++;
    }

    await this.db
      .insert(schema.appSettings)
      .values({ key: AUDIO_COVER_SEED_KEY, value: new Date().toISOString() })
      .onConflictDoNothing({ target: schema.appSettings.key });
    this.logger.log(
      `[metadata_preferences.audio_cover_seed] [end] globalSeeded=${globalSeeded} librariesSeeded=${librariesSeeded} durationMs=${Date.now() - startedAt} - audiobook cover rules seeded from cover rules`,
    );
    return { global: globalSeeded, libraries: librariesSeeded };
  }

  private parseStoredPreferences(value: string): (MetadataFetchPreferences & Record<string, unknown>) | null {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as MetadataFetchPreferences & Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  async getGlobal(): Promise<MetadataFetchPreferences> {
    const startedAt = Date.now();
    const row = await this.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, GLOBAL_PREFERENCES_KEY),
    });
    if (!row) return this.resolver.getDefaultPreferences();
    try {
      const parsed = JSON.parse(row.value) as MetadataFetchPreferences;
      return this.resolver.resolve(parsed, null);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      const rawMessage = error instanceof Error ? error.message : 'unknown error';
      const errorMessage = sanitizeLogValue(rawMessage);
      this.logger.warn(
        `[metadata_preferences.global_parse] [fail] key=${GLOBAL_PREFERENCES_KEY} durationMs=${durationMs} errorClass=${errorClass} error="${errorMessage}" - failed to parse persisted global preferences`,
      );
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
