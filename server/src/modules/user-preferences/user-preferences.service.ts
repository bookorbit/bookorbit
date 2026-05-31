import {
  ACCENT_IDS,
  AUTHOR_COVER_SHAPES,
  BACKGROUND_IDS,
  BOOK_COVER_DISPLAY_MODES,
  BOOK_SHADOW_STRENGTHS,
  BOOK_SPINE_OVERLAYS,
  BOOK_VIEW_MODES,
  CARD_INFO_MODES,
  CARD_OVERLAY_KEYS,
  COVER_SIZE_SCOPES,
  GRID_CARD_LABEL_FIELDS,
  RADIUS_IDS,
  SERIES_CARD_COVER_MODES,
  TABLE_DENSITIES,
  THEME_IDS,
  type DisplayPreferences,
  type ThemePreferences,
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
    smartScopeFilterExpanded: z.boolean(),
    authorCoverSize: z.number().int().min(100).max(400),
    authorCoverShape: z.enum(AUTHOR_COVER_SHAPES),
    tableZebraStriping: z.boolean(),
    tableDensity: z.enum(TABLE_DENSITIES),
    bookSpineOverlay: z.enum(BOOK_SPINE_OVERLAYS),
    bookShadowStrength: z.enum(BOOK_SHADOW_STRENGTHS),
    bookCoverDisplayMode: z.enum(BOOK_COVER_DISPLAY_MODES),
    seriesCardCoverMode: z.enum(SERIES_CARD_COVER_MODES).default('mosaic'),
    gridCardPrimaryLabel: z.enum(GRID_CARD_LABEL_FIELDS).default('hidden'),
    gridCardSecondaryLabel: z.enum(GRID_CARD_LABEL_FIELDS).default('hidden'),
    cardInfoMode: z.enum(CARD_INFO_MODES).default('hover-overlay'),
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
  });

@Injectable()
export class UserPreferencesService {
  private readonly logger = new Logger(UserPreferencesService.name);

  constructor(private readonly repo: UserPreferencesRepository) {}

  async getThemePreferences(userId: number): Promise<ThemePreferences | null> {
    const row = await this.repo.findByCategory(userId, 'theme');
    return row ? (row.data as ThemePreferences) : null;
  }

  async getDisplayPreferences(userId: number): Promise<DisplayPreferences | null> {
    const row = await this.repo.findByCategory(userId, 'display');
    return row ? (row.data as DisplayPreferences) : null;
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
