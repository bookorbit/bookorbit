import {
  ACCENT_IDS,
  AUTHOR_COVER_SHAPES,
  PODCAST_PLAYLIST_MAX_SAVED,
  PODCAST_PLAYLIST_MAX_SHOWS,
  BACKGROUND_IDS,
  BOOK_COVER_DISPLAY_MODES,
  BOOK_DETAIL_COVER_TINTS,
  BOOK_SHADOW_STRENGTHS,
  BOOK_SPINE_OVERLAYS,
  BOOK_THUMBNAIL_CLICK_ACTION,
  BOOK_VIEW_MODES,
  CARD_INFO_MODES,
  CARD_OVERLAY_KEYS,
  COVER_SEARCH_DEFAULT_PROVIDERS,
  COVER_SIZE_SCOPES,
  DEFAULT_BOOK_REQUEST_PREFERENCES,
  RETIRED_BOOK_REQUEST_PREFERENCE_FIELDS,
  DEFAULT_COVER_SEARCH_PROVIDER,
  FONT_FAMILY_NAME_MAX_LENGTH,
  GRID_CARD_LABEL_FIELDS,
  MAX_SERVER_FONTS,
  RADIUS_IDS,
  REQUEST_LANGUAGE_CODES,
  SERIES_CARD_COVER_MODES,
  SUPPORTED_LOCALES,
  SURFACE_OPACITY_MAX,
  SURFACE_OPACITY_MIN,
  TABLE_DENSITIES,
  THEME_IDS,
  type BookRequestPreferences,
  type DisplayPreferences,
  type CoverSearchPreferences,
  type LocalePreferences,
  type PodcastPlaybackPreferences,
  type PodcastPlaylistPreferences,
  type ServerFontPreferences,
  type ThemePreferences,
  type WhatsNewPreferences,
} from '@bookorbit/types';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { UserPreferencesRepository } from './user-preferences.repository';

const THEME_PREFERENCES_SCHEMA = z
  .object({
    theme: z.enum(THEME_IDS),
    accent: z.enum(ACCENT_IDS),
    radius: z.enum(RADIUS_IDS),
    background: z.enum(BACKGROUND_IDS),
    brightness: z.number().int().min(0).max(100),
    surfaceOpacity: z.number().int().min(SURFACE_OPACITY_MIN).max(SURFACE_OPACITY_MAX).optional(),
  })
  .strict();

const DISPLAY_PREFERENCES_SCHEMA = z
  .object({
    portraitCoverSize: z.number().int().min(100).max(400),
    squareCoverSize: z.number().int().min(100).max(400),
    coverSizeScope: z.enum(COVER_SIZE_SCOPES),
    gridGap: z.number().int().min(1).max(80),
    portraitGridGap: z.number().int().min(1).max(80),
    squareGridGap: z.number().int().min(1).max(80),
    viewMode: z.enum(BOOK_VIEW_MODES),
    cardOverlays: z.array(z.enum(CARD_OVERLAY_KEYS)),
    showJumpRails: z.boolean().default(true),
    smartScopeFilterExpanded: z.boolean(),
    authorCoverSize: z.number().int().min(100).max(400),
    authorCoverShape: z.enum(AUTHOR_COVER_SHAPES),
    authorRowDensity: z.enum(TABLE_DENSITIES).default('comfortable'),
    authorCoverFallback: z.boolean().default(false),
    tableZebraStriping: z.boolean(),
    tableDensity: z.enum(TABLE_DENSITIES),
    bookSpineOverlay: z.enum(BOOK_SPINE_OVERLAYS),
    showSpineOnComics: z.boolean().default(false),
    bookShadowStrength: z.enum(BOOK_SHADOW_STRENGTHS),
    bookCoverDisplayMode: z.enum(BOOK_COVER_DISPLAY_MODES),
    bookDetailCoverTint: z.enum(BOOK_DETAIL_COVER_TINTS).default('single'),
    seriesCardCoverMode: z.enum(SERIES_CARD_COVER_MODES).default('stack'),
    gridCardPrimaryLabel: z.enum(GRID_CARD_LABEL_FIELDS).default('hidden'),
    gridCardSecondaryLabel: z.enum(GRID_CARD_LABEL_FIELDS).default('hidden'),
    cardInfoMode: z.enum(CARD_INFO_MODES).default('hover-overlay'),
    thumbnailClickAction: z.enum(BOOK_THUMBNAIL_CLICK_ACTION).default('reader'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (new Set(data.cardOverlays).size !== data.cardOverlays.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['cardOverlays'],
        message: 'cardOverlays must not contain duplicate values',
      });
    }
  }) satisfies z.ZodType<DisplayPreferences>;

const COVER_SEARCH_PREFERENCES_SCHEMA = z
  .object({
    defaultProvider: z.enum(COVER_SEARCH_DEFAULT_PROVIDERS),
  })
  .strict();

const COVER_SEARCH_DEFAULTS: CoverSearchPreferences = {
  defaultProvider: DEFAULT_COVER_SEARCH_PROVIDER,
};

/**
 * Destinations used to live here: first one pair for every medium, then one pair per medium. Both
 * are now answered by the instance default, so anything stored under either shape is dropped on
 * the way in rather than rejected. The object is strict and a strict parse failure falls back to
 * the defaults, which would take the user's pinned language down with it.
 */
function dropRetiredFields(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const record = { ...(value as Record<string, unknown>) };
  for (const field of RETIRED_BOOK_REQUEST_PREFERENCE_FIELDS) delete record[field];
  return record;
}

const BOOK_REQUEST_PREFERENCES_SCHEMA = z.preprocess(
  dropRetiredFields,
  z
    .object({
      /**
       * Defaulted rather than required, so a row stored before this field existed still parses.
       *
       * Restricted to codes the release matcher can actually compare: a language it does not know
       * is a hard filter nothing satisfies, so storing one would reject every release rather than
       * leaving the field open.
       */
      defaultLanguage: z
        .string()
        .refine((value) => REQUEST_LANGUAGE_CODES.includes(value), { message: 'must be a language the release matcher can compare' })
        .nullable()
        .default(null),
    })
    .strict(),
);

const LOCALE_PREFERENCES_SCHEMA = z
  .object({
    locale: z.enum(SUPPORTED_LOCALES),
  })
  .strict();

const WHATS_NEW_PREFERENCES_SCHEMA = z
  .object({
    lastSeenVersion: z.string().min(1).max(50).optional(),
    popupEnabled: z.boolean().optional(),
  })
  .strict();

const WHATS_NEW_DEFAULTS: WhatsNewPreferences = { lastSeenVersion: null, popupEnabled: true };
const PODCAST_PLAYBACK_DEFAULTS: PodcastPlaybackPreferences = {
  defaultPlaybackRate: 1,
  volume: 1,
  skipBackwardSeconds: 15,
  skipForwardSeconds: 30,
  podcastPlaybackRates: {},
};

const PODCAST_PLAYBACK_PREFERENCES_SCHEMA = z
  .object({
    defaultPlaybackRate: z.number().min(0.5).max(3),
    volume: z.number().min(0).max(1).default(1),
    skipBackwardSeconds: z.number().int().min(5).max(120),
    skipForwardSeconds: z.number().int().min(5).max(120),
    podcastPlaybackRates: z.record(z.string().regex(/^\d+$/), z.number().min(0.5).max(3)).refine((rates) => Object.keys(rates).length <= 1000),
  })
  .strict();

// Bounded by the server font cap: a reader cannot hide more families than can exist.
const SERVER_FONT_PREFERENCES_SCHEMA = z
  .object({
    hiddenFamilies: z.array(z.string().min(1).max(FONT_FAMILY_NAME_MAX_LENGTH)).max(MAX_SERVER_FONTS),
  })
  .strict();

const PODCAST_PLAYLIST_RULES_SCHEMA = z
  .object({
    filter: z.enum(['latest', 'downloaded', 'in_progress', 'unplayed', 'finished']),
    sort: z.enum(['newest', 'oldest', 'shortest', 'longest', 'recently_listened']),
    minDurationMinutes: z.number().int().min(1).max(1440).nullable(),
    maxDurationMinutes: z.number().int().min(1).max(1440).nullable(),
    publishedWithinDays: z.number().int().min(1).max(3650).nullable(),
    podcastIds: z.array(z.number().int().positive()).max(PODCAST_PLAYLIST_MAX_SHOWS),
    followedOnly: z.boolean(),
  })
  .strict();

const PODCAST_PLAYLISTS_PREFERENCES_SCHEMA = z
  .object({
    playlists: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().trim().min(1).max(80),
            libraryId: z.number().int().positive(),
            rules: PODCAST_PLAYLIST_RULES_SCHEMA,
          })
          .strict(),
      )
      .max(PODCAST_PLAYLIST_MAX_SAVED),
  })
  .strict();

@Injectable()
export class UserPreferencesService {
  private readonly logger = new Logger(UserPreferencesService.name);

  constructor(private readonly repo: UserPreferencesRepository) {}

  async getWhatsNewPreferences(userId: number): Promise<WhatsNewPreferences> {
    const row = await this.repo.findByCategory(userId, 'whats-new');
    if (!row) return { ...WHATS_NEW_DEFAULTS };
    const stored = row.data as Partial<WhatsNewPreferences>;
    return {
      lastSeenVersion: stored.lastSeenVersion ?? null,
      popupEnabled: stored.popupEnabled ?? true,
    };
  }

  async getPodcastPlaybackPreferences(userId: number): Promise<PodcastPlaybackPreferences> {
    const row = await this.repo.findByCategory(userId, 'podcast-playback');
    if (!row) return { ...PODCAST_PLAYBACK_DEFAULTS, podcastPlaybackRates: {} };
    const stored = PODCAST_PLAYBACK_PREFERENCES_SCHEMA.safeParse(row.data);
    return stored.success ? stored.data : { ...PODCAST_PLAYBACK_DEFAULTS, podcastPlaybackRates: {} };
  }

  async upsertPodcastPlaybackPreferences(userId: number, data: Record<string, unknown>): Promise<void> {
    const result = PODCAST_PLAYBACK_PREFERENCES_SCHEMA.safeParse(data);
    if (!result.success) throw new BadRequestException('Invalid podcast playback preferences');
    await this.repo.upsert(userId, 'podcast-playback', result.data);
  }

  async getPodcastPlaylistPreferences(userId: number): Promise<PodcastPlaylistPreferences> {
    const row = await this.repo.findByCategory(userId, 'podcast-playlists');
    if (!row) return { playlists: [] };
    const stored = PODCAST_PLAYLISTS_PREFERENCES_SCHEMA.safeParse(row.data);
    return stored.success ? stored.data : { playlists: [] };
  }

  async upsertPodcastPlaylistPreferences(userId: number, data: Record<string, unknown>): Promise<void> {
    const result = PODCAST_PLAYLISTS_PREFERENCES_SCHEMA.safeParse(data);
    if (!result.success) throw new BadRequestException('Invalid podcast playlist preferences');
    const ids = new Set(result.data.playlists.map((playlist) => playlist.id));
    if (ids.size !== result.data.playlists.length) throw new BadRequestException('Podcast playlist ids must be unique');
    await this.repo.upsert(userId, 'podcast-playlists', result.data);
  }

  async upsertWhatsNewPreferences(userId: number, data: Record<string, unknown>): Promise<void> {
    const start = Date.now();
    this.logger.log(`[user_preferences.upsert_whats_new] [start] userId=${userId} - upsert whats-new preferences started`);

    const result = WHATS_NEW_PREFERENCES_SCHEMA.safeParse(data);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'settings';
      const issueMessage = firstIssue?.message ?? 'Invalid settings payload';
      throw new BadRequestException(`Invalid whats-new preferences at "${issuePath}": ${issueMessage}`);
    }

    try {
      const existing = await this.getWhatsNewPreferences(userId);
      const merged: WhatsNewPreferences = { ...existing, ...result.data };
      await this.repo.upsert(userId, 'whats-new', { ...merged });
      const durationMs = Date.now() - start;
      this.logger.log(`[user_preferences.upsert_whats_new] [end] userId=${userId} durationMs=${durationMs} - upsert whats-new preferences completed`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[user_preferences.upsert_whats_new] [fail] userId=${userId} durationMs=${durationMs} errorClass=${errorClass} error="${error}" - upsert whats-new preferences failed`,
      );
      throw err;
    }
  }

  async getServerFontPreferences(userId: number): Promise<ServerFontPreferences> {
    const row = await this.repo.findByCategory(userId, 'server-fonts');
    const stored = (row?.data ?? {}) as Partial<ServerFontPreferences>;
    return { hiddenFamilies: Array.isArray(stored.hiddenFamilies) ? stored.hiddenFamilies : [] };
  }

  async upsertServerFontPreferences(userId: number, data: Record<string, unknown>): Promise<void> {
    const start = Date.now();
    this.logger.log(`[user_preferences.upsert_server_fonts] [start] userId=${userId} - upsert server font preferences started`);

    const result = SERVER_FONT_PREFERENCES_SCHEMA.safeParse(data);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'settings';
      const issueMessage = firstIssue?.message ?? 'Invalid settings payload';
      throw new BadRequestException(`Invalid server font preferences at "${issuePath}": ${issueMessage}`);
    }

    try {
      const hiddenFamilies = [...new Set(result.data.hiddenFamilies)];
      await this.repo.upsert(userId, 'server-fonts', { hiddenFamilies });
      const durationMs = Date.now() - start;
      this.logger.log(
        `[user_preferences.upsert_server_fonts] [end] userId=${userId} durationMs=${durationMs} hiddenCount=${hiddenFamilies.length} - upsert server font preferences completed`,
      );
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[user_preferences.upsert_server_fonts] [fail] userId=${userId} durationMs=${durationMs} errorClass=${errorClass} error="${error}" - upsert server font preferences failed`,
      );
      throw err;
    }
  }

  async getLocalePreferences(userId: number): Promise<LocalePreferences | null> {
    const row = await this.repo.findByCategory(userId, 'locale');
    return row ? (row.data as LocalePreferences) : null;
  }

  async upsertLocalePreferences(userId: number, data: Record<string, unknown>): Promise<void> {
    const start = Date.now();
    this.logger.log(`[user_preferences.upsert_locale] [start] userId=${userId} - upsert locale preferences started`);

    const result = LOCALE_PREFERENCES_SCHEMA.safeParse(data);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'settings';
      const issueMessage = firstIssue?.message ?? 'Invalid settings payload';
      throw new BadRequestException(`Invalid locale preferences at "${issuePath}": ${issueMessage}`);
    }

    try {
      await this.repo.upsert(userId, 'locale', result.data);
      const durationMs = Date.now() - start;
      this.logger.log(`[user_preferences.upsert_locale] [end] userId=${userId} durationMs=${durationMs} - upsert locale preferences completed`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[user_preferences.upsert_locale] [fail] userId=${userId} durationMs=${durationMs} errorClass=${errorClass} error="${error}" - upsert locale preferences failed`,
      );
      throw err;
    }
  }

  async getThemePreferences(userId: number): Promise<ThemePreferences | null> {
    const row = await this.repo.findByCategory(userId, 'theme');
    return row ? (row.data as ThemePreferences) : null;
  }

  async getDisplayPreferences(userId: number): Promise<DisplayPreferences | null> {
    const row = await this.repo.findByCategory(userId, 'display');
    return row ? (row.data as DisplayPreferences) : null;
  }

  async getCoverSearchPreferences(userId: number): Promise<CoverSearchPreferences> {
    const row = await this.repo.findByCategory(userId, 'cover-search');
    const result = COVER_SEARCH_PREFERENCES_SCHEMA.safeParse(row?.data);
    return result.success ? result.data : { ...COVER_SEARCH_DEFAULTS };
  }

  async upsertCoverSearchPreferences(userId: number, data: Record<string, unknown>): Promise<void> {
    const result = COVER_SEARCH_PREFERENCES_SCHEMA.safeParse(data);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'settings';
      const issueMessage = firstIssue?.message ?? 'Invalid settings payload';
      throw new BadRequestException(`Invalid cover search preferences at "${issuePath}": ${issueMessage}`);
    }

    await this.repo.upsert(userId, 'cover-search', result.data);
  }

  async getBookRequestPreferences(userId: number): Promise<BookRequestPreferences> {
    const row = await this.repo.findByCategory(userId, 'book-requests');
    const result = BOOK_REQUEST_PREFERENCES_SCHEMA.safeParse(row?.data);
    return result.success ? result.data : { ...DEFAULT_BOOK_REQUEST_PREFERENCES };
  }

  async upsertBookRequestPreferences(userId: number, data: Record<string, unknown>): Promise<void> {
    const result = BOOK_REQUEST_PREFERENCES_SCHEMA.safeParse(data);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'settings';
      const issueMessage = firstIssue?.message ?? 'Invalid settings payload';
      throw new BadRequestException(`Invalid book request preferences at "${issuePath}": ${issueMessage}`);
    }

    await this.repo.upsert(userId, 'book-requests', result.data);
  }

  async upsertThemePreferences(userId: number, data: Record<string, unknown>): Promise<void> {
    const start = Date.now();
    this.logger.log(`[user_preferences.upsert_theme] [start] userId=${userId} - upsert theme preferences started`);

    const result = THEME_PREFERENCES_SCHEMA.safeParse(data);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'settings';
      const issueMessage = firstIssue?.message ?? 'Invalid settings payload';
      throw new BadRequestException(`Invalid theme preferences at "${issuePath}": ${issueMessage}`);
    }

    try {
      await this.repo.upsert(userId, 'theme', result.data);
      const durationMs = Date.now() - start;
      this.logger.log(`[user_preferences.upsert_theme] [end] userId=${userId} durationMs=${durationMs} - upsert theme preferences completed`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[user_preferences.upsert_theme] [fail] userId=${userId} durationMs=${durationMs} errorClass=${errorClass} error="${error}" - upsert theme preferences failed`,
      );
      throw err;
    }
  }

  async upsertDisplayPreferences(userId: number, data: Record<string, unknown>): Promise<void> {
    const start = Date.now();
    this.logger.log(`[user_preferences.upsert_display] [start] userId=${userId} - upsert display preferences started`);

    const result = DISPLAY_PREFERENCES_SCHEMA.safeParse(data);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'settings';
      const issueMessage = firstIssue?.message ?? 'Invalid settings payload';
      throw new BadRequestException(`Invalid display preferences at "${issuePath}": ${issueMessage}`);
    }

    try {
      await this.repo.upsert(userId, 'display', result.data);
      const durationMs = Date.now() - start;
      this.logger.log(`[user_preferences.upsert_display] [end] userId=${userId} durationMs=${durationMs} - upsert display preferences completed`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[user_preferences.upsert_display] [fail] userId=${userId} durationMs=${durationMs} errorClass=${errorClass} error="${error}" - upsert display preferences failed`,
      );
      throw err;
    }
  }
}
