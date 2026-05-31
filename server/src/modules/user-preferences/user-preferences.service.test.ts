import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayPreferences, ThemePreferences } from '@bookorbit/types';

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
  bookShadowStrength: 'strong',
  bookCoverDisplayMode: 'natural-bottom',
  seriesCardCoverMode: 'mosaic',
  gridCardPrimaryLabel: 'hidden',
  gridCardSecondaryLabel: 'hidden',
  cardInfoMode: 'hover-overlay',
};

const repo = {
  findByCategory: vi.fn<(...args: [number, string]) => Promise<{ data: ThemePreferences | DisplayPreferences } | undefined>>(),
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
});
