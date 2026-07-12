import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayPreferences, LocalePreferences, ThemePreferences } from '@bookorbit/types';

import { UserPreferencesRepository } from './user-preferences.repository';
import { UserPreferencesService } from './user-preferences.service';

const validThemePreferences: ThemePreferences = {
  theme: 'dark',
  accent: 'blue',
  radius: 'rounded',
  background: 'vinyl',
  brightness: 35,
};

const validDisplayPreferences: DisplayPreferences = {
  portraitCoverSize: 180,
  squareCoverSize: 160,
  coverSizeScope: 'per-view',
  gridGap: 28,
  portraitGridGap: 24,
  squareGridGap: 20,
  viewMode: 'grid',
  cardOverlays: ['progress-bar', 'format', 'rating'],
  smartScopeFilterExpanded: true,
  authorCoverSize: 140,
  authorCoverShape: 'circle',
  tableZebraStriping: false,
  tableDensity: 'comfortable',
  bookSpineOverlay: 'subtle',
  showSpineOnComics: false,
  bookShadowStrength: 'strong',
  bookCoverDisplayMode: 'natural-bottom',
  seriesCardCoverMode: 'stack',
  gridCardPrimaryLabel: 'hidden',
  gridCardSecondaryLabel: 'hidden',
  cardInfoMode: 'hover-overlay',
  thumbnailClickAction: 'reader',
};

const validLocalePreferences: LocalePreferences = {
  locale: 'nl',
};

const repo = {
  findByCategory: vi.fn<(...args: [number, string]) => Promise<{ data: ThemePreferences | DisplayPreferences | LocalePreferences } | undefined>>(),
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

  it('upsertThemePreferences rejects invalid background ids', async () => {
    await expect(service.upsertThemePreferences(11, { ...validThemePreferences, background: 'stars' } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
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
});
