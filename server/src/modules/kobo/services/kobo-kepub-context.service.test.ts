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

  it('resolves a device copy built from a former primary only for callers that follow its source file', async () => {
    const { file, conversion, binary } = makeContext('epub');
    const reader = { findPrimaryReaderFilesByBookIds: vi.fn().mockResolvedValue([file]) };
    const source = {
      id: 66,
      bookId: 3,
      absolutePath: '/library/readalong.epub',
      format: 'epub',
      fileHash: 'old',
      sizeBytes: 900,
      mediaOverlayAvailable: true,
    };
    const release = vi.fn().mockResolvedValue(undefined);
    const deliveries = {
      current: vi.fn().mockResolvedValue({
        id: 'copy',
        state: 'transfer_observed',
        previousId: null,
        sourceFileId: 66,
        options: { hyphenate: false, converterVersion: 'v1' },
        metadata: { format: 'kepub' },
      }),
      resolve: vi.fn().mockResolvedValue({ path: '/cache/copy.kepub.epub', sha256: 'sha', release }),
      findSourceFile: vi.fn().mockResolvedValue(source),
    };
    const service = new KoboKepubContextService(
      reader as never,
      { getSettings: vi.fn().mockResolvedValue({ convertToKepub: true }) } as never,
      conversion as never,
      binary as never,
      deliveries as never,
    );

    await expect(service.resolveForBook(7, 3, 11)).resolves.toMatchObject({ ok: false, reason: 'historical_source_unavailable' });
    expect(release).toHaveBeenCalled();
    await expect(service.resolveForBook(7, 3, 11, { followDeliverySource: true })).resolves.toMatchObject({
      ok: true,
      file: { id: 66, absolutePath: '/library/readalong.epub' },
      ctx: { kepubPath: '/cache/copy.kepub.epub', fileHash: 'sha' },
    });
  });

  it('keeps placing positions on the copy the device holds after the book file changed, while it is cached', async () => {
    const { file, binary } = makeContext('epub');
    const reader = { findPrimaryReaderFilesByBookIds: vi.fn().mockResolvedValue([file]) };
    const release = vi.fn().mockResolvedValue(undefined);
    const conversion = {
      getKepubPath: vi.fn(),
      acquireCachedByDigest: vi.fn().mockResolvedValueOnce({ path: '/cache/delivered.kepub.epub', release }).mockResolvedValueOnce(null),
    };
    const deliveries = {
      current: vi.fn().mockResolvedValue({
        id: 'copy',
        state: 'transfer_observed',
        previousId: null,
        sourceFileId: 12,
        options: { hyphenate: false, converterVersion: 'v1' },
        metadata: { format: 'kepub', sha256: 'delivered-sha' },
      }),
      resolve: vi.fn().mockRejectedValue(new Error('source changed')),
      rememberContentDigest: vi.fn().mockResolvedValue(undefined),
    };
    const service = new KoboKepubContextService(
      reader as never,
      { getSettings: vi.fn().mockResolvedValue({ convertToKepub: true }) } as never,
      conversion as never,
      binary as never,
      deliveries as never,
    );

    await expect(service.resolveForBook(7, 3, 11)).resolves.toMatchObject({
      ok: true,
      file: { id: 12 },
      ctx: { kepubPath: '/cache/delivered.kepub.epub', fileHash: 'delivered-sha', hyphenate: false, kepubifyVersion: 'v1' },
      release,
    });
    expect(conversion.acquireCachedByDigest).toHaveBeenCalledWith(3, 'delivered-sha');
    expect(deliveries.rememberContentDigest).toHaveBeenCalledWith(expect.objectContaining({ id: 'copy' }), '/cache/delivered.kepub.epub');
    await expect(service.resolveForBook(7, 3, 11)).resolves.toMatchObject({ ok: false, reason: 'historical_artifact_unavailable' });
  });

  it('resolves a first delivery the device has not downloaded yet only for a bookmark sent to it', async () => {
    const { file, conversion, binary } = makeContext('epub');
    const offered = {
      id: 'first',
      state: 'offered',
      previousId: null,
      sourceFileId: 12,
      options: { hyphenate: false, converterVersion: 'v1' },
      metadata: { format: 'kepub' },
    };
    const deliveries = {
      current: vi.fn().mockResolvedValue(offered),
      resolve: vi.fn().mockResolvedValue({ path: '/cache/first.kepub.epub', sha256: 'sha', release: vi.fn() }),
      findSourceFile: vi.fn(),
    };
    const service = new KoboKepubContextService(
      { findPrimaryReaderFilesByBookIds: vi.fn().mockResolvedValue([file]) } as never,
      { getSettings: vi.fn().mockResolvedValue({ convertToKepub: true }) } as never,
      conversion as never,
      binary as never,
      deliveries as never,
    );

    await expect(service.resolveForBook(7, 3, 11)).resolves.toMatchObject({ ok: false, reason: 'unknown_delivery' });
    await expect(service.resolveForBook(7, 3, 11, { outgoing: true })).resolves.toMatchObject({
      ok: true,
      ctx: { kepubPath: '/cache/first.kepub.epub' },
    });
    deliveries.current.mockResolvedValue({ ...offered, previousId: 'earlier', options: { ...offered.options, replacement: true } });
    await expect(service.resolveForBook(7, 3, 11, { outgoing: true })).resolves.toMatchObject({ ok: false, reason: 'unknown_delivery' });
  });
});
