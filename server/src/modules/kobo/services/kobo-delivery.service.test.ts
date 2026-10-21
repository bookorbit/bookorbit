import { createHash } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ZipArchive } from 'archiver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kepubContentDigest } from './kepub-content-digest';

import {
  KoboDeliveryService,
  deliveryErrorCode,
  isSettledDelivery,
  isUnconfirmedReplacement,
  type KoboDeliveryRecord,
} from './kobo-delivery.service';

function record(overrides: Partial<KoboDeliveryRecord> = {}): KoboDeliveryRecord {
  return {
    id: 'stale',
    userId: 1,
    deviceId: 2,
    bookId: 3,
    sourceFileId: 4,
    metadata: {
      artifactId: 'artifact',
      sourceRevision: 'revision',
      requestedVariant: null,
      actualVariant: 'original',
      format: 'kepub',
      sizeBytes: 100,
      sha256: 'sha',
      fileHash: 'hash',
      outcome: 'original',
    },
    options: { hyphenate: false, converterVersion: 'v1' },
    state: 'transfer_observed',
    previousId: null,
    current: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService() {
  const repository = {
    retire: vi.fn().mockResolvedValue(undefined),
    reoffer: vi.fn().mockResolvedValue(undefined),
    transition: vi.fn().mockResolvedValue([{}]),
    adoptForDeviceReadingState: vi.fn().mockResolvedValue(undefined),
  };
  const downloads = { findBook: vi.fn().mockResolvedValue({ id: 3, primaryFileId: 4 }) };
  const service = new KoboDeliveryService(repository as never, downloads as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const offer = vi.spyOn(service, 'offer');
  const resolve = vi.spyOn(service, 'resolve');
  const artifact = (id: string) => ({ path: `/cache/${id}`, release: vi.fn() }) as never;
  return { service, repository, downloads, offer, resolve, artifact };
}

describe('KoboDeliveryService.prepareDownload', () => {
  it('serves the current offer when its source still rebuilds it', async () => {
    const { service, repository, offer, resolve, artifact } = makeService();
    const current = record();
    offer.mockResolvedValue(current);
    resolve.mockResolvedValue(artifact('stale'));

    const result = await service.prepareDownload(1, 2, 3, 'stale');

    expect(result.record).toBe(current);
    expect(repository.retire).not.toHaveBeenCalled();
    expect(repository.reoffer).not.toHaveBeenCalled();
  });

  it.each(['DELIVERY_SOURCE_CHANGED', 'DELIVERY_ARTIFACT_UNAVAILABLE'])(
    'replaces an offer whose source changed (%s) with a fresh one of the current file',
    async (code) => {
      const { service, repository, offer, resolve, artifact } = makeService();
      const stale = record();
      const fresh = record({ id: 'fresh', state: 'offered' });
      offer.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
      const freshArtifact = artifact('fresh');
      resolve.mockRejectedValueOnce(new ConflictException({ code })).mockResolvedValueOnce(freshArtifact);

      const result = await service.prepareDownload(1, 2, 3, 'stale');

      expect(result).toEqual({ record: fresh, artifact: freshArtifact });
      expect(repository.retire).toHaveBeenCalledWith(1, 2, 'stale');
      expect(repository.reoffer).toHaveBeenCalledWith(1, 2, 3);
      expect(resolve).toHaveBeenLastCalledWith(1, 2, fresh);
    },
  );

  it('asks the device to sync when the fresh offer changes format instead of sending it under the old one', async () => {
    const { service, repository, offer, resolve } = makeService();
    offer.mockResolvedValueOnce(record()).mockResolvedValueOnce(record({ id: 'fresh', metadata: { ...record().metadata, format: 'epub' } }));
    resolve.mockRejectedValueOnce(new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' }));

    const error = await service.prepareDownload(1, 2, 3).catch((caught: unknown) => caught);

    expect(deliveryErrorCode(error)).toBe('KOBO_DELIVERY_FORMAT_CHANGED');
    expect(repository.reoffer).toHaveBeenCalledWith(1, 2, 3);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('keeps a pending replacement on its guided flow', async () => {
    const { service, repository, offer, resolve } = makeService();
    offer.mockResolvedValue(record({ options: { hyphenate: false, converterVersion: 'v1', replacement: true } }));
    resolve.mockRejectedValue(new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' }));

    await expect(service.prepareDownload(1, 2, 3)).rejects.toThrow(ConflictException);
    expect(repository.retire).not.toHaveBeenCalled();
  });

  it('does not replace a previous delivery standing in for a cancelled replacement', async () => {
    const { service, repository, offer, resolve } = makeService();
    offer.mockResolvedValue(record({ current: false }));
    resolve.mockRejectedValue(new ConflictException({ code: 'DELIVERY_SOURCE_CHANGED' }));

    await expect(service.prepareDownload(1, 2, 3)).rejects.toThrow(ConflictException);
    expect(repository.retire).not.toHaveBeenCalled();
  });

  it.each([new ForbiddenException({ code: 'DELIVERY_SOURCE_OUTSIDE_LIBRARY' }), new ConflictException({ code: 'DELIVERY_SOURCE_UNAVAILABLE' })])(
    'rethrows failures that a fresh offer cannot fix: %s',
    async (failure) => {
      const { service, repository, offer, resolve } = makeService();
      offer.mockResolvedValue(record());
      resolve.mockRejectedValue(failure);

      await expect(service.prepareDownload(1, 2, 3)).rejects.toBe(failure);
      expect(repository.retire).not.toHaveBeenCalled();
    },
  );

  it('serves a fresh offer of the new primary when the device downloads a copy built from a former primary', async () => {
    const { service, repository, downloads, offer, resolve, artifact } = makeService();
    downloads.findBook.mockResolvedValue({ id: 3, primaryFileId: 9 });
    const fresh = record({ id: 'fresh', sourceFileId: 9, state: 'offered' });
    offer.mockResolvedValueOnce(record()).mockResolvedValueOnce(fresh);
    const freshArtifact = artifact('fresh');
    resolve.mockResolvedValueOnce(freshArtifact);

    await expect(service.prepareDownload(1, 2, 3)).resolves.toEqual({ record: fresh, artifact: freshArtifact });

    expect(repository.retire).toHaveBeenCalledWith(1, 2, 'stale');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(1, 2, fresh);
  });

  it('rejects a delivery id that is no longer current without preparing any bytes', async () => {
    const { service, offer, resolve } = makeService();
    offer.mockResolvedValue(record({ id: 'fresh' }));

    await expect(service.prepareDownload(1, 2, 3, 'stale')).rejects.toThrow(NotFoundException);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('KoboDeliveryService.transferObserved', () => {
  it('points the device bookmark at a delivery it just downloaded', async () => {
    const { service, repository } = makeService();

    await service.transferObserved(1, 2, record({ id: 'fresh', state: 'offered' }));

    expect(repository.transition).toHaveBeenCalledWith(1, 2, 'fresh', ['offered', 'transfer_observed'], 'transfer_observed');
    expect(repository.adoptForDeviceReadingState).toHaveBeenCalledWith(1, 2, 3, 'fresh');
  });

  it('leaves the bookmark alone for a replacement or a delivery that is no longer transferable', async () => {
    const { service, repository } = makeService();

    await service.transferObserved(1, 2, record({ options: { hyphenate: false, converterVersion: 'v1', replacement: true } }));
    repository.transition.mockResolvedValueOnce([]);
    await service.transferObserved(1, 2, record({ state: 'cancelled' }));

    expect(repository.adoptForDeviceReadingState).not.toHaveBeenCalled();
  });
});

function makeOfferService(current: KoboDeliveryRecord | null, previous: KoboDeliveryRecord | null = null) {
  const fresh = record({ id: 'fresh', state: 'offered', metadata: { ...record().metadata, format: 'pdf' } });
  const repository = {
    assertDevice: vi.fn().mockResolvedValue(undefined),
    findCurrent: vi.fn().mockResolvedValue(current),
    findById: vi.fn().mockResolvedValue(previous),
    retire: vi.fn().mockResolvedValue(undefined),
    offer: vi.fn().mockResolvedValue(fresh),
    cancel: vi.fn().mockResolvedValue(true),
    reoffer: vi.fn().mockResolvedValue(undefined),
  };
  const downloads = {
    findBook: vi.fn().mockResolvedValue({ id: 3, primaryFileId: 4 }),
    findPrimaryFile: vi.fn().mockResolvedValue({ id: 4, absolutePath: '/library/book.pdf', format: 'pdf', mediaOverlayAvailable: false }),
  };
  const settings = {
    getSettings: vi
      .fn()
      .mockResolvedValue({ readAloudDelivery: null, convertToKepub: false, forceEnableHyphenation: false, kepubConversionLimitMb: 100 }),
  };
  const artifacts = {
    prepare: vi.fn().mockResolvedValue({ ...fresh.metadata, path: '/library/book.pdf', release: vi.fn().mockResolvedValue(undefined) }),
  };
  const service = new KoboDeliveryService(
    repository as never,
    downloads as never,
    { assertBookAccessible: vi.fn().mockResolvedValue(undefined) } as never,
    settings as never,
    artifacts as never,
    {} as never,
    {} as never,
  );
  return { service, repository, fresh };
}

const replacement = (overrides: Partial<KoboDeliveryRecord> = {}) =>
  record({ id: 'replacement', state: 'prepared', options: { hyphenate: false, converterVersion: 'v1', replacement: true }, ...overrides });

describe('KoboDeliveryService.offer', () => {
  it.each(['prepared', 'cancelled'])('gives a book a first offer when a %s replacement has no earlier copy to stand back for', async (state) => {
    const { service, repository, fresh } = makeOfferService(replacement({ state }));

    await expect(service.offer(1, 2, 3)).resolves.toBe(fresh);

    expect(repository.retire).toHaveBeenCalledWith(1, 2, 'replacement');
    expect(repository.offer).toHaveBeenCalledWith(expect.objectContaining({ state: 'offered', sourceFileId: 4 }), false);
  });

  it('keeps serving the earlier copy while a replacement is only prepared', async () => {
    const previous = record({ id: 'previous', current: false });
    const { service, repository } = makeOfferService(replacement({ previousId: 'previous' }), previous);

    await expect(service.offer(1, 2, 3)).resolves.toBe(previous);

    expect(repository.retire).not.toHaveBeenCalled();
    expect(repository.offer).not.toHaveBeenCalled();
  });

  it('returns a current delivery unchanged', async () => {
    const current = record();
    const { service, repository } = makeOfferService(current);

    await expect(service.offer(1, 2, 3)).resolves.toBe(current);

    expect(repository.retire).not.toHaveBeenCalled();
  });
});

describe('KoboDeliveryService.cancelReplacement', () => {
  it('tells the device again which copy stands once an offered replacement is cancelled', async () => {
    const { service, repository } = makeOfferService(null, replacement({ state: 'offered' }));

    await service.cancelReplacement(1, 2, 'replacement');

    expect(repository.cancel).toHaveBeenCalledWith(1, 2, 'replacement');
    expect(repository.reoffer).toHaveBeenCalledWith(1, 2, 3);
  });

  it('does not re-announce a replacement the device was never told about, or one that was not cancelled', async () => {
    const prepared = makeOfferService(null, replacement());
    await prepared.service.cancelReplacement(1, 2, 'replacement');
    expect(prepared.repository.reoffer).not.toHaveBeenCalled();

    const confirmed = makeOfferService(null, replacement({ state: 'offered' }));
    confirmed.repository.cancel.mockResolvedValue(false);
    await confirmed.service.cancelReplacement(1, 2, 'replacement');
    expect(confirmed.repository.reoffer).not.toHaveBeenCalled();
  });
});

describe('delivery standing', () => {
  it('settles a first delivery on transfer and a replacement only on confirmation', () => {
    expect(isSettledDelivery(record({ state: 'transfer_observed' }))).toBe(true);
    expect(isSettledDelivery(record({ state: 'offered' }))).toBe(false);
    expect(isSettledDelivery(replacement({ state: 'transfer_observed', previousId: 'previous' }))).toBe(false);
    expect(isSettledDelivery(replacement({ state: 'user_confirmed', previousId: 'previous' }))).toBe(true);
    expect(isUnconfirmedReplacement(replacement({ state: 'transfer_observed', previousId: 'previous' }))).toBe(true);
    expect(isUnconfirmedReplacement(replacement({ state: 'user_confirmed', previousId: 'previous' }))).toBe(false);
    expect(isUnconfirmedReplacement(record({ state: 'transfer_observed' }))).toBe(false);
  });
});

describe('KoboDeliveryService.confirm', () => {
  it('moves the device bookmark onto the replacement the user confirmed', async () => {
    const transferred = replacement({ state: 'transfer_observed', previousId: 'previous' });
    const repository = {
      findById: vi.fn().mockResolvedValue(transferred),
      assertDevice: vi.fn().mockResolvedValue(undefined),
      findCurrent: vi.fn().mockResolvedValue(transferred),
      transition: vi.fn().mockResolvedValue([{}]),
      adoptForDeviceReadingState: vi.fn().mockResolvedValue(undefined),
    };
    const service = new KoboDeliveryService(
      repository as never,
      {} as never,
      { assertBookAccessible: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.confirm(1, 2, 'replacement');

    expect(repository.transition).toHaveBeenCalledWith(1, 2, 'replacement', ['transfer_observed', 'user_confirmed'], 'user_confirmed');
    expect(repository.adoptForDeviceReadingState).toHaveBeenCalledWith(1, 2, 3, 'replacement');
  });
});

describe('KoboDeliveryService.resolve with a rebuilt KEPUB', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-delivery-resolve-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const chapter = (text: string): [string, string] => ['OEBPS/chapter.xhtml', `<p><span class="koboSpan" id="kobo.1.1">${text}</span></p>`];
  const BASE: [string, string][] = [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', '<container/>'],
    ['OEBPS/content.opf', '<package/>'],
  ];

  async function writeKepub(name: string, entries: [string, string][]): Promise<string> {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const complete = new Promise<void>((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });
    for (const [entry, body] of entries) archive.append(body, { name: entry, store: entry === 'mimetype' });
    await archive.finalize();
    await complete;
    const path = join(root, name);
    await writeFile(path, Buffer.concat(chunks));
    return path;
  }

  async function sha256Of(path: string): Promise<string> {
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  }

  function makeResolver(convertedPath: string, converterVersion = 'v4-dev') {
    const repository = { assertDevice: vi.fn().mockResolvedValue(undefined), setKepubContentDigest: vi.fn().mockResolvedValue(undefined) };
    const downloads = {
      findPrimaryFile: vi.fn().mockResolvedValue({ id: 4, absolutePath: '/library/book.epub', format: 'epub', mediaOverlayAvailable: true }),
    };
    const access = { assertBookAccessible: vi.fn().mockResolvedValue(undefined) };
    const artifactRelease = vi.fn().mockResolvedValue(undefined);
    const artifacts = {
      prepare: vi
        .fn()
        .mockResolvedValue({ path: '/cache/stripped.epub', sha256: 'stripped-sha', actualVariant: 'audioless_epub', release: artifactRelease }),
    };
    const conversion = { acquireKepub: vi.fn().mockResolvedValue({ path: convertedPath, release: vi.fn().mockResolvedValue(undefined) }) };
    const binary = { getVersion: vi.fn().mockResolvedValue(converterVersion) };
    const service = new KoboDeliveryService(
      repository as never,
      downloads as never,
      access as never,
      {} as never,
      artifacts as never,
      conversion as never,
      binary as never,
    );
    return { service, repository, conversion };
  }

  function kepubRecord(sha256: string, options: Partial<KoboDeliveryRecord['options']> = {}): KoboDeliveryRecord {
    return record({
      metadata: { ...record().metadata, format: 'kepub', actualVariant: 'audioless_epub', sha256 },
      options: { hyphenate: false, converterVersion: 'v4-dev', ...options },
    });
  }

  it('accepts a rebuild that holds the delivered conversion in another entry order, under the delivered sha', async () => {
    const delivered = await writeKepub('delivered.kepub.epub', [...BASE, chapter('One.')]);
    const rebuilt = await writeKepub('rebuilt.kepub.epub', [BASE[0], chapter('One.'), BASE[2], BASE[1]]);
    const deliveredSha = await sha256Of(delivered);
    expect(await sha256Of(rebuilt)).not.toBe(deliveredSha);
    const { service } = makeResolver(rebuilt);

    const artifact = await service.resolve(1, 2, kepubRecord(deliveredSha, { kepubContentDigest: await kepubContentDigest(delivered) }));

    expect(artifact.path).toBe(rebuilt);
    expect(artifact.sha256).toBe(deliveredSha);
  });

  it('refuses a rebuild whose text differs from the delivered conversion', async () => {
    const delivered = await writeKepub('delivered.kepub.epub', [...BASE, chapter('One.')]);
    const different = await writeKepub('different.kepub.epub', [...BASE, chapter('Two.')]);
    const { service } = makeResolver(different);

    await expect(
      service.resolve(1, 2, kepubRecord(await sha256Of(delivered), { kepubContentDigest: await kepubContentDigest(delivered) })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a rebuild of a delivery made before digests were kept, and records one when the exact copy resolves', async () => {
    const delivered = await writeKepub('delivered.kepub.epub', [...BASE, chapter('One.')]);
    const rebuilt = await writeKepub('rebuilt.kepub.epub', [BASE[0], chapter('One.'), BASE[2], BASE[1]]);
    const legacy = kepubRecord(await sha256Of(delivered));

    await expect(makeResolver(rebuilt).service.resolve(1, 2, legacy)).rejects.toBeInstanceOf(ConflictException);

    const exact = makeResolver(delivered);
    await exact.service.resolve(1, 2, legacy);
    expect(exact.repository.setKepubContentDigest).toHaveBeenCalledWith(1, 2, 'stale', await kepubContentDigest(delivered));
  });

  it('tries another converter version only when a digest can confirm the content', async () => {
    const delivered = await writeKepub('delivered.kepub.epub', [...BASE, chapter('One.')]);
    const deliveredSha = await sha256Of(delivered);

    const withoutDigest = makeResolver(delivered, 'v4.0.4');
    await expect(withoutDigest.service.resolve(1, 2, kepubRecord(deliveredSha))).rejects.toBeInstanceOf(ConflictException);
    expect(withoutDigest.conversion.acquireKepub).not.toHaveBeenCalled();

    const withDigest = makeResolver(delivered, 'v4.0.4');
    await expect(
      withDigest.service.resolve(1, 2, kepubRecord(deliveredSha, { kepubContentDigest: await kepubContentDigest(delivered) })),
    ).resolves.toMatchObject({ sha256: deliveredSha });
  });
});
