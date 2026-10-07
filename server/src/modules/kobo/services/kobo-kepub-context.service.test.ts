import { describe, expect, it, vi } from 'vitest';

import { KoboKepubContextService } from './kobo-kepub-context.service';

function makeContext(format: string, convertToKepub = true) {
  const file = { id: 12, bookId: 3, absolutePath: '/library/book.kepub', format, fileHash: 'hash', sizeBytes: 200 };
  const reader = { findPrimaryReaderFilesByBookIds: vi.fn().mockResolvedValue([file]) };
  const settings = { convertToKepub, forceEnableHyphenation: true, kepubConversionLimitMb: 0 };
  const conversion = { getKepubPath: vi.fn().mockResolvedValue('/library/converted.kepub') };
  const binary = { getVersion: vi.fn().mockResolvedValue('test-version') };
  const service = new KoboKepubContextService(
    reader as never,
    { getSettings: vi.fn().mockResolvedValue(settings) } as never,
    conversion as never,
    binary as never,
  );
  return { service, file, settings, conversion, binary };
}

describe('KoboKepubContextService', () => {
  it.each([true, false])('uses the original native KEPUB with conversion enabled=%s', async (convert) => {
    const { service, file, settings, conversion, binary } = makeContext('kepub', convert);
    expect(await service.resolveForBook(7, 3)).toEqual({
      ok: true,
      file,
      settings,
      ctx: { kepubPath: file.absolutePath, fileHash: 'hash', hyphenate: false, kepubifyVersion: 'native-kepub' },
    });
    expect(conversion.getKepubPath).not.toHaveBeenCalled();
    expect(binary.getVersion).not.toHaveBeenCalled();
  });

  it('preserves EPUB conversion and hyphenation settings', async () => {
    const { service, settings, file, conversion } = makeContext('epub');
    settings.kepubConversionLimitMb = 100;
    expect(await service.resolveForBook(7, 3)).toMatchObject({
      ok: true,
      ctx: { kepubPath: '/library/converted.kepub', hyphenate: true, kepubifyVersion: 'test-version' },
    });
    expect(conversion.getKepubPath).toHaveBeenCalledWith({ sourcePath: file.absolutePath, fileHash: 'hash', bookId: 3, hyphenate: true });
  });

  it('keeps unsupported formats and disabled EPUB conversion degraded', async () => {
    expect(await makeContext('pdf').service.resolveForBook(7, 3)).toMatchObject({ ok: false, reason: 'kepub_required' });
    expect(await makeContext('epub', false).service.resolveForBook(7, 3)).toMatchObject({ ok: false, reason: 'kepub_required' });
  });
});
