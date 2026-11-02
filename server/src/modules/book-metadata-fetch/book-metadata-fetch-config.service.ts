import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  BookMetadataFetchConfig,
  BookMetadataFetchConfigOverride,
  BookMetadataFetchLibraryConfig,
  BookMetadataFetchLibraryConfigEntry,
} from '@bookorbit/types';
import { asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { appSettings, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const KEYS = {
  CONFIG: 'book_metadata_fetch_config',
  PAUSED: 'book_metadata_fetch_paused',
} as const;

export const DEFAULT_BOOK_METADATA_FETCH_CONFIG: BookMetadataFetchConfig = {
  enabled: false,
  triggerOnImport: false,
  conditions: {
    scoreThreshold: { enabled: true, threshold: 60 },
    missingFields: { enabled: true, fields: ['description', 'cover'] },
    neverFetched: { enabled: true },
  },
};

@Injectable()
export class BookMetadataFetchConfigService {
  private readonly logger = new Logger(BookMetadataFetchConfigService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async getGlobalConfig(): Promise<BookMetadataFetchConfig> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(appSettings.key, KEYS.CONFIG) });
    return this.parseSafe<BookMetadataFetchConfig>(KEYS.CONFIG, row?.value, { ...DEFAULT_BOOK_METADATA_FETCH_CONFIG });
  }

  async setGlobalConfig(config: BookMetadataFetchConfig): Promise<void> {
    const value = JSON.stringify(config);
    await this.db.insert(appSettings).values({ key: KEYS.CONFIG, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }

  async getEffectiveConfig(libraryId: number): Promise<BookMetadataFetchConfig> {
    const [global, library] = await Promise.all([
      this.getGlobalConfig(),
      this.db.query.libraries.findFirst({ where: eq(libraries.id, libraryId), columns: { bookMetadataFetchConfig: true } }),
    ]);

    const override = library?.bookMetadataFetchConfig ?? null;
    return this.deepMerge(global, override);
  }

  async setLibraryOverride(libraryId: number, override: BookMetadataFetchConfigOverride): Promise<void> {
    await this.db.update(libraries).set({ bookMetadataFetchConfig: override }).where(eq(libraries.id, libraryId));
  }

  async getLibraryConfigWithLastRun(libraryId: number): Promise<BookMetadataFetchLibraryConfig> {
    const [global, library] = await Promise.all([
      this.getGlobalConfig(),
      this.db.query.libraries.findFirst({
        where: eq(libraries.id, libraryId),
        columns: {
          bookMetadataFetchConfig: true,
          bookMetadataFetchLastRunAt: true,
          bookMetadataFetchLastQueuedCount: true,
        },
      }),
    ]);
    const override = library?.bookMetadataFetchConfig ?? null;
    const config = this.deepMerge(global, override);
    return {
      ...config,
      override,
      lastRunAt: library?.bookMetadataFetchLastRunAt?.toISOString() ?? null,
      lastQueuedCount: library?.bookMetadataFetchLastQueuedCount ?? null,
    };
  }

  /** Every books library with its effective config, its stored override and its last run. */
  async listLibraryConfigs(): Promise<BookMetadataFetchLibraryConfigEntry[]> {
    const [global, rows] = await Promise.all([
      this.getGlobalConfig(),
      this.db
        .select({
          id: libraries.id,
          name: libraries.name,
          override: libraries.bookMetadataFetchConfig,
          lastRunAt: libraries.bookMetadataFetchLastRunAt,
          lastQueuedCount: libraries.bookMetadataFetchLastQueuedCount,
        })
        .from(libraries)
        // The sidebar's order, so the tabs read the same way as Field Rules'.
        .orderBy(asc(libraries.displayOrder), asc(libraries.name)),
    ]);
    return rows.map((row) => {
      const override = (row.override as BookMetadataFetchConfigOverride | null) ?? null;
      return {
        libraryId: row.id,
        libraryName: row.name,
        ...this.deepMerge(global, override),
        override,
        lastRunAt: row.lastRunAt?.toISOString() ?? null,
        lastQueuedCount: row.lastQueuedCount ?? null,
      };
    });
  }

  async bookLibraryIds(): Promise<number[]> {
    const rows = await this.db.select({ id: libraries.id }).from(libraries).orderBy(asc(libraries.id));
    return rows.map((row) => row.id);
  }

  async recordLibraryRun(libraryId: number, queuedCount: number): Promise<void> {
    await this.db
      .update(libraries)
      .set({ bookMetadataFetchLastRunAt: new Date(), bookMetadataFetchLastQueuedCount: queuedCount })
      .where(eq(libraries.id, libraryId));
  }

  async isPaused(): Promise<boolean> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(appSettings.key, KEYS.PAUSED) });
    return row?.value === 'true';
  }

  async setPaused(paused: boolean): Promise<void> {
    const value = paused ? 'true' : 'false';
    await this.db.insert(appSettings).values({ key: KEYS.PAUSED, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }

  private deepMerge(global: BookMetadataFetchConfig, override: BookMetadataFetchConfigOverride): BookMetadataFetchConfig {
    if (!override) return global;
    return {
      enabled: override.enabled ?? global.enabled,
      triggerOnImport: override.triggerOnImport ?? global.triggerOnImport,
      conditions: {
        scoreThreshold: { ...global.conditions.scoreThreshold, ...(override.conditions?.scoreThreshold ?? {}) },
        missingFields: { ...global.conditions.missingFields, ...(override.conditions?.missingFields ?? {}) },
        neverFetched: { ...global.conditions.neverFetched, ...(override.conditions?.neverFetched ?? {}) },
      },
    };
  }

  private parseSafe<T>(key: string, value: string | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[book.metadata_fetch.config_parse] [fail] key=${key} errorClass=${errorClass} error="${message}" - failed to parse stored config`,
      );
      return fallback;
    }
  }
}
