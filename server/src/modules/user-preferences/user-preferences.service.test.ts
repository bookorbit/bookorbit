import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Accent,
  BookRequestPreferences,
  CoverSearchPreferences,
  DisplayPreferences,
  LocalePreferences,
  ServerFontPreferences,
  ThemePreferences,
} from '@bookorbit/types';
import { MAX_SERVER_FONTS, SUPPORTED_LOCALES } from '@bookorbit/types';

import { UserPreferencesRepository } from './user-preferences.repository';
import { UserPreferencesService } from './user-preferences.service';

const validThemePreferences: ThemePreferences = {
  theme: 'dark',
  accent: 'blue',
  radius: 'rounded',
  background: 'vinyl',
  brightness: 35,
};

const addedAccentIds: readonly Accent[] = [
  'scarlet',
  'marigold',
  'viridian',
  'iris',
  'rosewater',
  'flax',
  'foam',
  'cornflower',
  'vermilion',
  'salmon',
  'copper',
  'sand',
  'chartreuse',
  'pear',
  'wasabi',
  'sprout',
  'malachite',
  'aloe',
  'turquoise',
  'aqua',
  'acid-green',
  'pistachio',
  'electric-blue',
  'baby-blue',
  'ultramarine',
  'bluebell',
  'purple',
  'thistle',
  'amethyst',
  'mauve',
  'raspberry',
  'rose-quartz',
  'jade',
  'sea-glass',
];

const validDisplayPreferences: DisplayPreferences = {
  portraitCoverSize: 180,
  squareCoverSize: 160,
  coverSizeScope: 'per-view',
  gridGap: 28,
  portraitGridGap: 24,
  squareGridGap: 20,
  viewMode: 'grid',
  cardOverlays: ['progress-bar', 'format', 'rating'],
  showJumpRails: true,
  smartScopeFilterExpanded: true,
  authorCoverSize: 140,
  authorCoverShape: 'circle',
  tableZebraStriping: false,
  tableDensity: 'comfortable',
  bookSpineOverlay: 'subtle',
  showSpineOnComics: false,
  bookShadowStrength: 'strong',
  bookCoverDisplayMode: 'natural-bottom',
  bookDetailCoverTint: 'duotone',
  seriesCardCoverMode: 'stack',
  gridCardPrimaryLabel: 'hidden',
  gridCardSecondaryLabel: 'hidden',
  cardInfoMode: 'hover-overlay',
  thumbnailClickAction: 'reader',
};

const validLocalePreferences: LocalePreferences = {
  locale: 'it',
};

const validCoverSearchPreferences: CoverSearchPreferences = {
  defaultProvider: 'itunes',
};

const validBookRequestPreferences: BookRequestPreferences = { defaultLanguage: 'de' };

const repo = {
  findByCategory: vi.fn<
    (...args: [number, string]) => Promise<
      | {
          data: ThemePreferences | DisplayPreferences | LocalePreferences | ServerFontPreferences | CoverSearchPreferences | BookRequestPreferences;
        }
      | undefined
    >
  >(),
  upsert: vi.fn<(...args: [number, string, Record<string, unknown>]) => Promise<void>>(),
  delete: vi.fn<(...args: [number, string]) => Promise<void>>(),
};

describe('UserPreferencesService', () => {
  let service: UserPreferencesService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo.findByCategory.mockResolvedValue(undefined);
    repo.upsert.mockResolvedValue(undefined);
    service = new UserPreferencesService(repo as unknown as UserPreferencesRepository);
  });

  it('getThemePreferences returns null when repository has no row', async () => {
    await expect(service.getThemePreferences(7)).resolves.toBeNull();
    expect(repo.findByCategory).toHaveBeenCalledWith(7, 'theme');
  });

  it('getThemePreferences returns saved theme settings when row exists', async () => {
    repo.findByCategory.mockResolvedValueOnce({ data: validThemePreferences });

    await expect(service.getThemePreferences(7)).resolves.toEqual(validThemePreferences);
  });

  it('getDisplayPreferences returns null when repository has no row', async () => {
    await expect(service.getDisplayPreferences(7)).resolves.toBeNull();
    expect(repo.findByCategory).toHaveBeenCalledWith(7, 'display');
  });

  it('getDisplayPreferences returns saved display settings when row exists', async () => {
    repo.findByCategory.mockResolvedValueOnce({ data: validDisplayPreferences });

    await expect(service.getDisplayPreferences(7)).resolves.toEqual(validDisplayPreferences);
  });

  it('getCoverSearchPreferences returns the DuckDuckGo default when no preference exists', async () => {
    await expect(service.getCoverSearchPreferences(7)).resolves.toEqual({ defaultProvider: 'duckduckgo' });
    expect(repo.findByCategory).toHaveBeenCalledWith(7, 'cover-search');
  });

  it('getCoverSearchPreferences returns a saved provider', async () => {
    repo.findByCategory.mockResolvedValueOnce({ data: validCoverSearchPreferences });

    await expect(service.getCoverSearchPreferences(7)).resolves.toEqual(validCoverSearchPreferences);
  });

  it('getCoverSearchPreferences falls back safely when stored data is malformed', async () => {
    repo.findByCategory.mockResolvedValueOnce({ data: { defaultProvider: 'unknown' } } as never);

    await expect(service.getCoverSearchPreferences(7)).resolves.toEqual({ defaultProvider: 'duckduckgo' });
  });

  it.each(['duckduckgo', 'itunes', 'all'] as const)('upsertCoverSearchPreferences accepts %s', async (defaultProvider) => {
    await expect(service.upsertCoverSearchPreferences(11, { defaultProvider })).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'cover-search', { defaultProvider });
  });

  it('upsertCoverSearchPreferences rejects a provider that is not valid for every book', async () => {
    await expect(service.upsertCoverSearchPreferences(11, { defaultProvider: 'audiobookcovers' })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertCoverSearchPreferences rejects unknown fields', async () => {
    await expect(service.upsertCoverSearchPreferences(11, { ...validCoverSearchPreferences, unexpected: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('getBookRequestPreferences returns no language when nothing was saved', async () => {
    await expect(service.getBookRequestPreferences(7)).resolves.toEqual({ defaultLanguage: null });
    expect(repo.findByCategory).toHaveBeenCalledWith(7, 'book-requests');
  });

  it('getBookRequestPreferences returns the pinned language', async () => {
    repo.findByCategory.mockResolvedValueOnce({ data: validBookRequestPreferences });

    await expect(service.getBookRequestPreferences(7)).resolves.toEqual(validBookRequestPreferences);
  });

  it('getBookRequestPreferences falls back safely when stored data is malformed', async () => {
    repo.findByCategory.mockResolvedValueOnce({ data: { defaultLanguage: 'klingon' } } as never);

    await expect(service.getBookRequestPreferences(7)).resolves.toEqual({ defaultLanguage: null });
  });

  it('upsertBookRequestPreferences saves a pinned language', async () => {
    await expect(service.upsertBookRequestPreferences(11, { ...validBookRequestPreferences })).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'book-requests', validBookRequestPreferences);
  });

  /**
   * Destinations lived in this category under two different shapes before the instance default
   * replaced them. Rows written by either build still exist, and both must keep their language
   * rather than failing strict validation and reverting the whole category to the defaults.
   */
  it('getBookRequestPreferences drops a destination pinned before the instance default existed', async () => {
    repo.findByCategory.mockResolvedValueOnce({ data: { defaultLibraryId: 4, defaultFolderId: 9, defaultLanguage: 'de' } } as never);

    await expect(service.getBookRequestPreferences(7)).resolves.toEqual({ defaultLanguage: 'de' });
  });

  it('getBookRequestPreferences drops a per-medium destination too', async () => {
    repo.findByCategory.mockResolvedValueOnce({
      data: { destinations: { ebook: { libraryId: 4, folderId: 9 } }, defaultLanguage: 'de' },
    } as never);

    await expect(service.getBookRequestPreferences(7)).resolves.toEqual({ defaultLanguage: 'de' });
  });

  it('upsertBookRequestPreferences drops a destination a stale client still sends', async () => {
    await expect(service.upsertBookRequestPreferences(11, { defaultLibraryId: 4, defaultLanguage: 'de' })).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'book-requests', { defaultLanguage: 'de' });
  });

  it('upsertBookRequestPreferences rejects a language no release could be matched against', async () => {
    await expect(service.upsertBookRequestPreferences(11, { ...validBookRequestPreferences, defaultLanguage: 'klingon' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertBookRequestPreferences rejects unknown fields', async () => {
    await expect(service.upsertBookRequestPreferences(11, { ...validBookRequestPreferences, unexpected: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('getLocalePreferences returns null when repository has no row', async () => {
    await expect(service.getLocalePreferences(7)).resolves.toBeNull();
    expect(repo.findByCategory).toHaveBeenCalledWith(7, 'locale');
  });

  it('getLocalePreferences returns saved locale settings when row exists', async () => {
    repo.findByCategory.mockResolvedValueOnce({ data: validLocalePreferences });

    await expect(service.getLocalePreferences(7)).resolves.toEqual(validLocalePreferences);
  });

  it('upsertLocalePreferences persists validated settings', async () => {
    await expect(service.upsertLocalePreferences(11, validLocalePreferences)).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'locale', validLocalePreferences);
  });

  it.each(SUPPORTED_LOCALES)('upsertLocalePreferences accepts the %s locale', async (locale) => {
    const preferences: LocalePreferences = { locale };

    await expect(service.upsertLocalePreferences(11, preferences)).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'locale', preferences);
  });

  it('upsertLocalePreferences rejects unsupported locale', async () => {
    await expect(service.upsertLocalePreferences(11, { locale: 'unsupported' } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertLocalePreferences rejects extra unknown fields', async () => {
    await expect(
      service.upsertLocalePreferences(11, { ...validLocalePreferences, unexpected: true } as Record<string, unknown>),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertThemePreferences persists validated settings', async () => {
    await expect(service.upsertThemePreferences(11, validThemePreferences)).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'theme', validThemePreferences);
  });

  it('upsertThemePreferences accepts the system theme', async () => {
    const systemThemePreferences = { ...validThemePreferences, theme: 'system' } as const;

    await expect(service.upsertThemePreferences(11, systemThemePreferences)).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'theme', systemThemePreferences);
  });

  it.each(addedAccentIds)('upsertThemePreferences accepts the %s accent', async (accent) => {
    const preferences = { ...validThemePreferences, accent };

    await expect(service.upsertThemePreferences(11, preferences)).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'theme', preferences);
  });

  it('upsertThemePreferences accepts a payload without surfaceOpacity', async () => {
    await expect(service.upsertThemePreferences(11, { ...validThemePreferences })).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'theme', validThemePreferences);
  });

  it.each([80, 92, 100])('upsertThemePreferences accepts surfaceOpacity %i', async (surfaceOpacity) => {
    const preferences = { ...validThemePreferences, surfaceOpacity };

    await expect(service.upsertThemePreferences(11, preferences)).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'theme', preferences);
  });

  it.each([79, 101, 50.5])('upsertThemePreferences rejects surfaceOpacity %s', async (surfaceOpacity) => {
    await expect(service.upsertThemePreferences(11, { ...validThemePreferences, surfaceOpacity })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertThemePreferences rejects invalid theme ids', async () => {
    await expect(service.upsertThemePreferences(11, { ...validThemePreferences, theme: 'sepia' } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertThemePreferences rejects invalid accent ids', async () => {
    await expect(service.upsertThemePreferences(11, { ...validThemePreferences, accent: 'magenta' } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertThemePreferences rejects invalid radius ids', async () => {
    await expect(service.upsertThemePreferences(11, { ...validThemePreferences, radius: 'soft' } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it.each(['stars', 'terminal'])('upsertThemePreferences rejects the unsupported %s background id', async (background) => {
    await expect(service.upsertThemePreferences(11, { ...validThemePreferences, background } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertThemePreferences rejects brightness below zero', async () => {
    await expect(service.upsertThemePreferences(11, { ...validThemePreferences, brightness: -1 })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertThemePreferences rejects brightness above one hundred', async () => {
    await expect(service.upsertThemePreferences(11, { ...validThemePreferences, brightness: 101 })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertThemePreferences rejects extra unknown fields', async () => {
    await expect(
      service.upsertThemePreferences(11, { ...validThemePreferences, unexpected: true } as Record<string, unknown>),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertThemePreferences rejects payloads missing required fields', async () => {
    const { background, ...incomplete } = validThemePreferences;
    void background;

    await expect(service.upsertThemePreferences(11, incomplete)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertThemePreferences rethrows repository failures after validation', async () => {
    const err = new Error('database unavailable');
    repo.upsert.mockRejectedValueOnce(err);

    await expect(service.upsertThemePreferences(11, validThemePreferences)).rejects.toBe(err);
    expect(repo.upsert).toHaveBeenCalledWith(11, 'theme', validThemePreferences);
  });

  it('upsertThemePreferences logs and rethrows non-Error repository failures', async () => {
    const err = 'database unavailable';
    repo.upsert.mockRejectedValueOnce(err);

    await expect(service.upsertThemePreferences(11, validThemePreferences)).rejects.toBe(err);
    expect(repo.upsert).toHaveBeenCalledWith(11, 'theme', validThemePreferences);
  });

  it('upsertDisplayPreferences persists validated settings', async () => {
    await expect(service.upsertDisplayPreferences(11, validDisplayPreferences as unknown as Record<string, unknown>)).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'display', validDisplayPreferences);
  });

  it('upsertDisplayPreferences accepts all valid thumbnailClickAction values', async () => {
    for (const value of ['reader', 'details']) {
      await expect(
        service.upsertDisplayPreferences(11, { ...validDisplayPreferences, thumbnailClickAction: value } as unknown as Record<string, unknown>),
      ).resolves.toBeUndefined();
    }
  });

  it('upsertDisplayPreferences defaults thumbnailClickAction to reader when omitted', async () => {
    const { thumbnailClickAction, ...withoutAction } = validDisplayPreferences;
    void thumbnailClickAction;

    await expect(service.upsertDisplayPreferences(11, withoutAction as unknown as Record<string, unknown>)).resolves.toBeUndefined();

    expect(repo.upsert).toHaveBeenCalledWith(11, 'display', expect.objectContaining({ thumbnailClickAction: 'reader' }));
  });

  it('upsertDisplayPreferences rejects invalid thumbnailClickAction values', async () => {
    await expect(
      service.upsertDisplayPreferences(11, { ...validDisplayPreferences, thumbnailClickAction: 'preview' } as unknown as Record<string, unknown>),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences accepts all valid seriesCardCoverMode values', async () => {
    for (const value of ['stack', 'mosaic', 'first-volume', 'latest-volume', 'first-unread']) {
      await expect(
        service.upsertDisplayPreferences(11, { ...validDisplayPreferences, seriesCardCoverMode: value } as unknown as Record<string, unknown>),
      ).resolves.toBeUndefined();
    }
  });

  it('upsertDisplayPreferences defaults seriesCardCoverMode to stack when omitted', async () => {
    const { seriesCardCoverMode, ...withoutMode } = validDisplayPreferences;
    void seriesCardCoverMode;

    await expect(service.upsertDisplayPreferences(11, withoutMode as unknown as Record<string, unknown>)).resolves.toBeUndefined();

    expect(repo.upsert).toHaveBeenCalledWith(11, 'display', expect.objectContaining({ seriesCardCoverMode: 'stack' }));
  });

  it('upsertDisplayPreferences accepts both showSpineOnComics values', async () => {
    for (const value of [true, false]) {
      await expect(
        service.upsertDisplayPreferences(11, { ...validDisplayPreferences, showSpineOnComics: value } as unknown as Record<string, unknown>),
      ).resolves.toBeUndefined();
      expect(repo.upsert).toHaveBeenCalledWith(11, 'display', expect.objectContaining({ showSpineOnComics: value }));
    }
  });

  it('upsertDisplayPreferences defaults showSpineOnComics to false when omitted', async () => {
    const { showSpineOnComics, ...withoutFlag } = validDisplayPreferences;
    void showSpineOnComics;

    await expect(service.upsertDisplayPreferences(11, withoutFlag as unknown as Record<string, unknown>)).resolves.toBeUndefined();

    expect(repo.upsert).toHaveBeenCalledWith(11, 'display', expect.objectContaining({ showSpineOnComics: false }));
  });

  it('upsertDisplayPreferences rejects non-boolean showSpineOnComics', async () => {
    await expect(
      service.upsertDisplayPreferences(11, { ...validDisplayPreferences, showSpineOnComics: 'yes' } as unknown as Record<string, unknown>),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences accepts both showJumpRails values', async () => {
    for (const value of [true, false]) {
      await expect(
        service.upsertDisplayPreferences(11, { ...validDisplayPreferences, showJumpRails: value } as unknown as Record<string, unknown>),
      ).resolves.toBeUndefined();
      expect(repo.upsert).toHaveBeenCalledWith(11, 'display', expect.objectContaining({ showJumpRails: value }));
    }
  });

  it('upsertDisplayPreferences defaults showJumpRails to true when omitted', async () => {
    const { showJumpRails, ...withoutFlag } = validDisplayPreferences;
    void showJumpRails;

    await expect(service.upsertDisplayPreferences(11, withoutFlag as unknown as Record<string, unknown>)).resolves.toBeUndefined();

    expect(repo.upsert).toHaveBeenCalledWith(11, 'display', expect.objectContaining({ showJumpRails: true }));
  });

  it('upsertDisplayPreferences rejects non-boolean showJumpRails', async () => {
    await expect(
      service.upsertDisplayPreferences(11, { ...validDisplayPreferences, showJumpRails: 'yes' } as unknown as Record<string, unknown>),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences rejects invalid cover display modes', async () => {
    await expect(
      service.upsertDisplayPreferences(11, { ...validDisplayPreferences, bookCoverDisplayMode: 'stretched' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences rejects invalid enum values', async () => {
    await expect(service.upsertDisplayPreferences(11, { ...validDisplayPreferences, tableDensity: 'huge' } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences rejects cover sizes below bounds', async () => {
    await expect(service.upsertDisplayPreferences(11, { ...validDisplayPreferences, portraitCoverSize: 99 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences rejects grid gaps above bounds', async () => {
    await expect(service.upsertDisplayPreferences(11, { ...validDisplayPreferences, squareGridGap: 81 })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences rejects duplicate card overlays', async () => {
    await expect(service.upsertDisplayPreferences(11, { ...validDisplayPreferences, cardOverlays: ['format', 'format'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences rejects unknown card overlays', async () => {
    await expect(
      service.upsertDisplayPreferences(11, { ...validDisplayPreferences, cardOverlays: ['format', 'provider'] } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences rejects extra unknown fields', async () => {
    await expect(
      service.upsertDisplayPreferences(11, { ...validDisplayPreferences, unexpected: true } as Record<string, unknown>),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences rejects payloads missing required fields', async () => {
    const { bookCoverDisplayMode, ...incomplete } = validDisplayPreferences;
    void bookCoverDisplayMode;

    await expect(service.upsertDisplayPreferences(11, incomplete as unknown as Record<string, unknown>)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertDisplayPreferences rethrows repository failures after validation', async () => {
    const err = new Error('database unavailable');
    repo.upsert.mockRejectedValueOnce(err);

    await expect(service.upsertDisplayPreferences(11, validDisplayPreferences as unknown as Record<string, unknown>)).rejects.toBe(err);
    expect(repo.upsert).toHaveBeenCalledWith(11, 'display', validDisplayPreferences);
  });

  it('upsertDisplayPreferences logs and rethrows non-Error repository failures', async () => {
    const err = 'database unavailable';
    repo.upsert.mockRejectedValueOnce(err);

    await expect(service.upsertDisplayPreferences(11, validDisplayPreferences as unknown as Record<string, unknown>)).rejects.toBe(err);
    expect(repo.upsert).toHaveBeenCalledWith(11, 'display', validDisplayPreferences);
  });

  it('upsertDisplayPreferences accepts all valid gridCardPrimaryLabel values', async () => {
    for (const value of ['hidden', 'book-title', 'series-title', 'series-title-position', 'author']) {
      await expect(
        service.upsertDisplayPreferences(11, { ...validDisplayPreferences, gridCardPrimaryLabel: value } as unknown as Record<string, unknown>),
      ).resolves.toBeUndefined();
    }
  });

  it('upsertDisplayPreferences accepts all valid gridCardSecondaryLabel values', async () => {
    for (const value of ['hidden', 'book-title', 'series-title', 'series-title-position', 'author']) {
      await expect(
        service.upsertDisplayPreferences(11, { ...validDisplayPreferences, gridCardSecondaryLabel: value } as unknown as Record<string, unknown>),
      ).resolves.toBeUndefined();
    }
  });

  it('upsertDisplayPreferences rejects invalid gridCardPrimaryLabel value', async () => {
    await expect(
      service.upsertDisplayPreferences(11, { ...validDisplayPreferences, gridCardPrimaryLabel: 'unknown-field' } as unknown as Record<
        string,
        unknown
      >),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsertDisplayPreferences rejects invalid gridCardSecondaryLabel value', async () => {
    await expect(
      service.upsertDisplayPreferences(11, { ...validDisplayPreferences, gridCardSecondaryLabel: 'bad-value' } as unknown as Record<string, unknown>),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsertDisplayPreferences defaults gridCardPrimaryLabel to hidden when omitted', async () => {
    const { gridCardPrimaryLabel, ...withoutPrimary } = validDisplayPreferences;
    void gridCardPrimaryLabel;
    await expect(service.upsertDisplayPreferences(11, withoutPrimary as unknown as Record<string, unknown>)).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'display', expect.objectContaining({ gridCardPrimaryLabel: 'hidden' }));
  });

  it('upsertDisplayPreferences defaults gridCardSecondaryLabel to hidden when omitted', async () => {
    const { gridCardSecondaryLabel, ...withoutSecondary } = validDisplayPreferences;
    void gridCardSecondaryLabel;
    await expect(service.upsertDisplayPreferences(11, withoutSecondary as unknown as Record<string, unknown>)).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'display', expect.objectContaining({ gridCardSecondaryLabel: 'hidden' }));
  });

  it('getWhatsNewPreferences returns defaults when repository has no row', async () => {
    await expect(service.getWhatsNewPreferences(7)).resolves.toEqual({ lastSeenVersion: null, popupEnabled: true });
    expect(repo.findByCategory).toHaveBeenCalledWith(7, 'whats-new');
  });

  it('getWhatsNewPreferences fills missing fields with defaults', async () => {
    repo.findByCategory.mockResolvedValueOnce({ data: { lastSeenVersion: 'v1.2.0' } } as never);
    await expect(service.getWhatsNewPreferences(7)).resolves.toEqual({ lastSeenVersion: 'v1.2.0', popupEnabled: true });
  });

  it('upsertWhatsNewPreferences merges a partial update onto existing values', async () => {
    repo.findByCategory.mockResolvedValueOnce({ data: { lastSeenVersion: 'v1.0.0', popupEnabled: true } } as never);
    await expect(service.upsertWhatsNewPreferences(11, { popupEnabled: false })).resolves.toBeUndefined();
    expect(repo.upsert).toHaveBeenCalledWith(11, 'whats-new', { lastSeenVersion: 'v1.0.0', popupEnabled: false });
  });

  it('upsertWhatsNewPreferences rejects unknown fields', async () => {
    await expect(service.upsertWhatsNewPreferences(11, { lastSeenVersion: 'v1.0.0', nope: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('upsertWhatsNewPreferences rejects a non-boolean popupEnabled', async () => {
    await expect(service.upsertWhatsNewPreferences(11, { popupEnabled: 'yes' })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  describe('server font preferences', () => {
    it('defaults to hiding nothing when the reader has never set them', async () => {
      repo.findByCategory.mockResolvedValue(undefined);

      await expect(service.getServerFontPreferences(11)).resolves.toEqual({ hiddenFamilies: [] });
      expect(repo.findByCategory).toHaveBeenCalledWith(11, 'server-fonts');
    });

    it('returns the stored opt-outs', async () => {
      repo.findByCategory.mockResolvedValue({ data: { hiddenFamilies: ['OpenDyslexic'] } });

      await expect(service.getServerFontPreferences(11)).resolves.toEqual({ hiddenFamilies: ['OpenDyslexic'] });
    });

    it('tolerates a malformed stored payload rather than failing the reader', async () => {
      repo.findByCategory.mockResolvedValue({ data: { hiddenFamilies: 'OpenDyslexic' } as never });

      await expect(service.getServerFontPreferences(11)).resolves.toEqual({ hiddenFamilies: [] });
    });

    it('persists the opt-out list under its own category', async () => {
      await service.upsertServerFontPreferences(11, { hiddenFamilies: ['OpenDyslexic', 'Literata'] });

      expect(repo.upsert).toHaveBeenCalledWith(11, 'server-fonts', { hiddenFamilies: ['OpenDyslexic', 'Literata'] });
    });

    it('accepts an empty list, which is how a reader restores everything', async () => {
      await service.upsertServerFontPreferences(11, { hiddenFamilies: [] });

      expect(repo.upsert).toHaveBeenCalledWith(11, 'server-fonts', { hiddenFamilies: [] });
    });

    it('deduplicates repeated family names', async () => {
      await service.upsertServerFontPreferences(11, { hiddenFamilies: ['Literata', 'Literata', 'OpenDyslexic'] });

      expect(repo.upsert).toHaveBeenCalledWith(11, 'server-fonts', { hiddenFamilies: ['Literata', 'OpenDyslexic'] });
    });

    it('replaces rather than merges, so un-hiding actually removes an entry', async () => {
      repo.findByCategory.mockResolvedValue({ data: { hiddenFamilies: ['Literata', 'OpenDyslexic'] } });

      await service.upsertServerFontPreferences(11, { hiddenFamilies: ['Literata'] });

      expect(repo.upsert).toHaveBeenCalledWith(11, 'server-fonts', { hiddenFamilies: ['Literata'] });
    });

    it('rejects a missing hiddenFamilies key', async () => {
      await expect(service.upsertServerFontPreferences(11, {})).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('rejects non-string entries', async () => {
      await expect(service.upsertServerFontPreferences(11, { hiddenFamilies: [42] })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('rejects empty family names', async () => {
      await expect(service.upsertServerFontPreferences(11, { hiddenFamilies: [''] })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('rejects a family name longer than the column allows', async () => {
      await expect(service.upsertServerFontPreferences(11, { hiddenFamilies: ['x'.repeat(201)] })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('rejects a list longer than the server font cap', async () => {
      const tooMany = Array.from({ length: MAX_SERVER_FONTS + 1 }, (_, i) => `Family ${i}`);

      await expect(service.upsertServerFontPreferences(11, { hiddenFamilies: tooMany })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('accepts a list exactly at the cap', async () => {
      const atCap = Array.from({ length: MAX_SERVER_FONTS }, (_, i) => `Family ${i}`);

      await expect(service.upsertServerFontPreferences(11, { hiddenFamilies: atCap })).resolves.toBeUndefined();
    });

    it('rejects unknown keys', async () => {
      await expect(service.upsertServerFontPreferences(11, { hiddenFamilies: [], sneaky: true })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });
});
