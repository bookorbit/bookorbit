import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { ReaderPreferencesRepository } from './reader-preferences.repository';
import { ReaderPreferencesService } from './reader-preferences.service';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 7,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

const validPdfDefaults = {
  scrollMode: 'page',
  spread: 'none',
  zoomMode: 'fit-page',
  customScale: 1,
  rotation: 0,
} as const;

const validCbxDefaults = {
  fitMode: 'fit-page',
  viewMode: 'single',
  scrollMode: 'paginated',
  direction: 'ltr',
  spreadAlignment: 'normal',
  forceTwoPage: false,
  widePageSingletonMode: 'auto',
  bgColor: 'black',
} as const;

const mockRepo = {
  findPreference: vi.fn<(...args: [number, number]) => Promise<{ settings: Record<string, unknown> } | null>>(),
  upsertPreference: vi.fn<(...args: [number, number, Record<string, unknown>]) => Promise<void>>(),
  deletePreference: vi.fn<(...args: [number, number]) => Promise<void>>(),
  findAllDefaults: vi.fn<(...args: [number]) => Promise<Array<{ formatGroup: string; settings: Record<string, unknown> }>>>(),
  upsertDefault: vi.fn<(...args: [number, string, Record<string, unknown>]) => Promise<void>>(),
  deleteDefault: vi.fn<(...args: [number, string]) => Promise<void>>(),
};

const mockBookService = {
  verifyFileAccess: vi.fn<(...args: [number, RequestUser]) => Promise<{ format: string | null }>>(),
};

describe('ReaderPreferencesService', () => {
  let service: ReaderPreferencesService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBookService.verifyFileAccess.mockResolvedValue({ format: 'pdf' });
    mockRepo.findPreference.mockResolvedValue(null);
    mockRepo.upsertPreference.mockResolvedValue(undefined);
    mockRepo.deletePreference.mockResolvedValue(undefined);
    mockRepo.findAllDefaults.mockResolvedValue([]);
    mockRepo.upsertDefault.mockResolvedValue(undefined);
    mockRepo.deleteDefault.mockResolvedValue(undefined);
    service = new ReaderPreferencesService(mockRepo as unknown as ReaderPreferencesRepository, mockBookService as unknown as BookService);
  });

  it('verifies file access before loading a per-book preference', async () => {
    const user = makeUser({ id: 12 });
    mockRepo.findPreference.mockResolvedValueOnce({ settings: { zoomMode: 'fit-width' } });

    const result = await service.getPreference(user, 42);

    expect(mockBookService.verifyFileAccess).toHaveBeenCalledWith(42, user);
    expect(mockRepo.findPreference).toHaveBeenCalledWith(12, 42);
    expect(result).toEqual({ settings: { zoomMode: 'fit-width' } });
  });

  it('does not query preferences when file access check fails', async () => {
    const user = makeUser();
    mockBookService.verifyFileAccess.mockRejectedValueOnce(new ForbiddenException());

    await expect(service.getPreference(user, 99)).rejects.toThrow(ForbiddenException);
    expect(mockRepo.findPreference).not.toHaveBeenCalled();
  });

  it('accepts valid partial per-book settings for the inferred file format group', async () => {
    const user = makeUser({ id: 4 });
    mockBookService.verifyFileAccess.mockResolvedValueOnce({ format: 'pdf' });

    await service.upsertPreference(user, 10, { zoomMode: 'custom', customScale: 1.4 });

    expect(mockRepo.upsertPreference).toHaveBeenCalledWith(4, 10, { zoomMode: 'custom', customScale: 1.4 });
  });

  it('accepts new PDF layout choices and normalizes legacy wrapped mode', async () => {
    const user = makeUser({ id: 4 });

    await service.upsertPreference(user, 10, { scrollMode: 'wrapped', spread: 'auto', zoomMode: 'automatic' });

    expect(mockRepo.upsertPreference).toHaveBeenCalledWith(4, 10, {
      scrollMode: 'vertical',
      spread: 'auto',
      zoomMode: 'automatic',
    });
  });

  it('maps cbz file format to cbx group and validates against comics settings', async () => {
    const user = makeUser();
    mockBookService.verifyFileAccess.mockResolvedValueOnce({ format: 'cbz' });

    await service.upsertPreference(user, 11, { fitMode: 'fit-page', direction: 'rtl' });

    expect(mockRepo.upsertPreference).toHaveBeenCalledWith(7, 11, { fitMode: 'fit-page', direction: 'rtl' });
  });

  it('rejects per-book settings with unknown keys', async () => {
    const user = makeUser();

    await expect(service.upsertPreference(user, 12, { unknownSetting: true })).rejects.toThrow(BadRequestException);
    expect(mockRepo.upsertPreference).not.toHaveBeenCalled();
  });

  it('rejects per-book settings with invalid values', async () => {
    const user = makeUser();

    await expect(service.upsertPreference(user, 13, { customScale: 10 })).rejects.toThrow(BadRequestException);
    expect(mockRepo.upsertPreference).not.toHaveBeenCalled();
  });

  it('verifies file access before deleting a per-book preference', async () => {
    const user = makeUser({ id: 22 });

    await service.deletePreference(user, 77);

    expect(mockBookService.verifyFileAccess).toHaveBeenCalledWith(77, user);
    expect(mockRepo.deletePreference).toHaveBeenCalledWith(22, 77);
  });

  it('returns all defaults for a user', async () => {
    mockRepo.findAllDefaults.mockResolvedValueOnce([{ formatGroup: 'pdf', settings: validPdfDefaults }]);

    const result = await service.getAllDefaults(55);

    expect(mockRepo.findAllDefaults).toHaveBeenCalledWith(55);
    expect(result).toEqual([{ formatGroup: 'pdf', settings: validPdfDefaults }]);
  });

  it('normalizes format group values when writing defaults', async () => {
    await service.upsertDefault(3, 'PDF', validPdfDefaults);

    expect(mockRepo.upsertDefault).toHaveBeenCalledWith(3, 'pdf', validPdfDefaults);
  });

  it('validates full cbx default payloads including spread settings', async () => {
    await service.upsertDefault(3, 'cbx', validCbxDefaults);

    expect(mockRepo.upsertDefault).toHaveBeenCalledWith(3, 'cbx', validCbxDefaults);
  });

  it('rejects default writes for invalid format groups', async () => {
    await expect(service.upsertDefault(3, 'video', validPdfDefaults)).rejects.toThrow(BadRequestException);
    expect(mockRepo.upsertDefault).not.toHaveBeenCalled();
  });

  it('rejects partial payloads for defaults', async () => {
    await expect(service.upsertDefault(3, 'pdf', { zoomMode: 'fit-page' })).rejects.toThrow(BadRequestException);
    expect(mockRepo.upsertDefault).not.toHaveBeenCalled();
  });

  it('rejects cbx defaults that omit required spread settings', async () => {
    await expect(
      service.upsertDefault(3, 'cbx', {
        fitMode: 'fit-page',
        viewMode: 'single',
        scrollMode: 'paginated',
        direction: 'ltr',
        bgColor: 'black',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockRepo.upsertDefault).not.toHaveBeenCalled();
  });

  it('normalizes format group values when deleting defaults', async () => {
    await service.deleteDefault(9, 'AuDiO');

    expect(mockRepo.deleteDefault).toHaveBeenCalledWith(9, 'audio');
  });

  describe('epub footerDisplayMode validation', () => {
    const validEpubDefaults = {
      themeName: 'default',
      isDark: false,
      fontFamily: null,
      fontSize: 16,
      lineHeight: 1.5,
      maxColumnCount: 2,
      gap: 0.05,
      maxInlineSize: 720,
      maxBlockSize: 1440,
      justify: true,
      hyphenate: true,
      flow: 'paginated' as const,
      overrideBookFormatting: true,
      footerDisplayMode: 0 as const,
      fixedLayoutSpread: 'auto' as const,
    };

    it('accepts valid footerDisplayMode values (0, 1, 2) in full epub defaults', async () => {
      for (const mode of [0, 1, 2] as const) {
        vi.clearAllMocks();
        mockRepo.upsertDefault.mockResolvedValue(undefined);
        await service.upsertDefault(1, 'epub', { ...validEpubDefaults, footerDisplayMode: mode });
        expect(mockRepo.upsertDefault).toHaveBeenCalledWith(1, 'epub', expect.objectContaining({ footerDisplayMode: mode }));
      }
    });

    it('rejects invalid footerDisplayMode values in epub defaults', async () => {
      await expect(service.upsertDefault(1, 'epub', { ...validEpubDefaults, footerDisplayMode: 3 })).rejects.toThrow(BadRequestException);
      await expect(service.upsertDefault(1, 'epub', { ...validEpubDefaults, footerDisplayMode: -1 })).rejects.toThrow(BadRequestException);
    });

    it('accepts partial epub per-book settings with footerDisplayMode', async () => {
      const user = makeUser();
      mockBookService.verifyFileAccess.mockResolvedValueOnce({ format: 'epub' });

      await service.upsertPreference(user, 20, { footerDisplayMode: 1 });

      expect(mockRepo.upsertPreference).toHaveBeenCalledWith(7, 20, { footerDisplayMode: 1 });
    });

    it('accepts partial epub per-book settings with fixedLayoutSpread', async () => {
      const user = makeUser();
      mockBookService.verifyFileAccess.mockResolvedValueOnce({ format: 'epub' });

      await service.upsertPreference(user, 22, { fixedLayoutSpread: 'none' });

      expect(mockRepo.upsertPreference).toHaveBeenCalledWith(7, 22, { fixedLayoutSpread: 'none' });
    });

    it('rejects partial epub per-book settings with invalid footerDisplayMode', async () => {
      const user = makeUser();
      mockBookService.verifyFileAccess.mockResolvedValueOnce({ format: 'epub' });

      await expect(service.upsertPreference(user, 21, { footerDisplayMode: 5 })).rejects.toThrow(BadRequestException);
      expect(mockRepo.upsertPreference).not.toHaveBeenCalled();
    });

    it('rejects partial epub per-book settings with invalid fixedLayoutSpread', async () => {
      const user = makeUser();
      mockBookService.verifyFileAccess.mockResolvedValueOnce({ format: 'epub' });

      await expect(service.upsertPreference(user, 23, { fixedLayoutSpread: 'two-page' })).rejects.toThrow(BadRequestException);
      expect(mockRepo.upsertPreference).not.toHaveBeenCalled();
    });

    it('requires footerDisplayMode when saving full epub defaults', async () => {
      const withoutFooterMode = { ...validEpubDefaults };
      delete (withoutFooterMode as Record<string, unknown>).footerDisplayMode;

      await expect(service.upsertDefault(1, 'epub', withoutFooterMode)).rejects.toThrow(BadRequestException);
    });

    it('requires fixedLayoutSpread when saving full epub defaults', async () => {
      const withoutSpread = { ...validEpubDefaults };
      delete (withoutSpread as Record<string, unknown>).fixedLayoutSpread;

      await expect(service.upsertDefault(1, 'epub', withoutSpread)).rejects.toThrow(BadRequestException);
    });
  });
});
