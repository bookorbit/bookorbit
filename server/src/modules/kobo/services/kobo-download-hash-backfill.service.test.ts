import { Test } from '@nestjs/testing';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Mock } from 'vitest';

import { computeFileHash } from '../../../common/utils/file-hash.utils';
import { storageConfig } from '../../../config/config';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import { KoboDownloadRepository } from '../kobo-download.repository';
import { KoboDownloadHashBackfillService } from './kobo-download-hash-backfill.service';

const SOURCE_HASH = 'a'.repeat(32);
const KEY = 'kobo_download_hash_backfill';

describe('KoboDownloadHashBackfillService', () => {
  let root: string;
  let cache: string;
  let service: KoboDownloadHashBackfillService;
  let repository: {
    findCachedSourceFileId: Mock<KoboDownloadRepository['findCachedSourceFileId']>;
    registerDeliveredHash: Mock<KoboDownloadRepository['registerDeliveredHash']>;
  };
  let settings: { getValue: ReturnType<typeof vi.fn>; setValue: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kobo-hash-backfill-'));
    cache = join(root, '.kepub-cache');
    repository = { findCachedSourceFileId: vi.fn().mockResolvedValue(22), registerDeliveredHash: vi.fn().mockResolvedValue(undefined) };
    settings = { getValue: vi.fn().mockResolvedValue(null), setValue: vi.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        KoboDownloadHashBackfillService,
        { provide: KoboDownloadRepository, useValue: repository },
        { provide: AppSettingsService, useValue: settings },
        { provide: storageConfig.KEY, useValue: { appDataPath: root } },
      ],
    }).compile();
    service = module.get(KoboDownloadHashBackfillService);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function cachedFile(book = '11', name = `${SOURCE_HASH}.kepub.epub`, content = 'Converted KEPUB bytes') {
    const directory = join(cache, book);
    await mkdir(directory, { recursive: true });
    const path = join(directory, name);
    await writeFile(path, content);
    return path;
  }

  it('recovers actual cached bytes against a verified source and marks completion', async () => {
    const path = await cachedFile();
    await expect(service.run()).resolves.toEqual({ registered: 1, skipped: 0, failed: 0 });
    expect(repository.findCachedSourceFileId).toHaveBeenCalledExactlyOnceWith(11, SOURCE_HASH);
    expect(repository.registerDeliveredHash).toHaveBeenCalledExactlyOnceWith(22, await computeFileHash(path));
    expect(repository.registerDeliveredHash).not.toHaveBeenCalledWith(22, SOURCE_HASH);
    expect(settings.setValue).toHaveBeenCalledWith(KEY, '1');
  });

  it.each(['-hyph', '-noaudio-v1', '-noaudio-v1-hyph', '-noaudio-v2-hyph'])(
    'recovers the %s variant using its original source hash',
    async (suffix) => {
      const path = await cachedFile('11', `${SOURCE_HASH}${suffix}.kepub.epub`);
      await service.run();
      expect(repository.findCachedSourceFileId).toHaveBeenCalledWith(11, SOURCE_HASH);
      expect(repository.registerDeliveredHash).toHaveBeenCalledWith(22, await computeFileHash(path));
    },
  );

  it('does no filesystem or repository work after completed recovery', async () => {
    settings.getValue.mockResolvedValue('1');
    await cachedFile();
    await expect(service.run()).resolves.toEqual({ registered: 0, skipped: 0, failed: 0 });
    expect(repository.findCachedSourceFileId).not.toHaveBeenCalled();
    expect(settings.setValue).not.toHaveBeenCalled();
  });

  it('runs for an older recovery version', async () => {
    settings.getValue.mockResolvedValue('0');
    await cachedFile();
    await service.run();
    expect(repository.registerDeliveredHash).toHaveBeenCalledTimes(1);
  });

  it('completes safely when there is no conversion cache', async () => {
    await expect(service.run()).resolves.toEqual({ registered: 0, skipped: 0, failed: 0 });
    expect(settings.setValue).toHaveBeenCalledWith(KEY, '1');
  });

  it.each([
    'nohash.kepub.epub',
    'bad.kepub.epub',
    `${SOURCE_HASH}-hyph-noaudio-v1.kepub.epub`,
    `${SOURCE_HASH}.epub`,
    `${SOURCE_HASH}-noaudio-v0.kepub.epub`,
  ])('skips unverifiable cache keys (%s)', async (name) => {
    await cachedFile('11', name);
    await expect(service.run()).resolves.toEqual({ registered: 0, skipped: 1, failed: 0 });
    expect(repository.findCachedSourceFileId).not.toHaveBeenCalled();
  });

  it.each(['0', '01', '-1', '2147483648', '9007199254740992', 'other'])('skips invalid book directories (%s)', async (book) => {
    await cachedFile(book);
    await service.run();
    expect(repository.findCachedSourceFileId).not.toHaveBeenCalled();
  });

  it('ignores unfinished conversion directories and non-file entries', async () => {
    await mkdir(join(cache, '11', '.conversion-unfinished'), { recursive: true });
    await mkdir(join(cache, '11', `${SOURCE_HASH}.kepub.epub`));
    await service.run();
    expect(repository.findCachedSourceFileId).not.toHaveBeenCalled();
    expect(repository.registerDeliveredHash).not.toHaveBeenCalled();
  });

  it('skips ambiguous or missing source identities without guessing', async () => {
    repository.findCachedSourceFileId.mockResolvedValue(null);
    await cachedFile();
    await expect(service.run()).resolves.toEqual({ registered: 0, skipped: 1, failed: 0 });
    expect(repository.registerDeliveredHash).not.toHaveBeenCalled();
  });

  it('rejects a cache root symlink outside the configured data directory', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, cache);
    await expect(service.run()).rejects.toThrow('KEPUB cache must not be a symbolic link');
    expect(settings.setValue).not.toHaveBeenCalled();
    expect(repository.registerDeliveredHash).not.toHaveBeenCalled();
  });

  it('does not follow book-directory or cache-file symlinks', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await mkdir(join(cache, '12'), { recursive: true });
    await writeFile(join(outside, `${SOURCE_HASH}.kepub.epub`), 'Outside bytes');
    await symlink(outside, join(cache, '11'));
    await symlink(join(outside, `${SOURCE_HASH}.kepub.epub`), join(cache, '12', `${SOURCE_HASH}.kepub.epub`));
    await service.run();
    expect(repository.findCachedSourceFileId).not.toHaveBeenCalled();
    expect(repository.registerDeliveredHash).not.toHaveBeenCalled();
  });

  it('reports individual failures, continues with other artifacts, and leaves recovery retryable', async () => {
    await cachedFile('11');
    await cachedFile('12');
    repository.registerDeliveredHash.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(service.run()).resolves.toEqual({ registered: 1, skipped: 0, failed: 1 });
    expect(settings.setValue).not.toHaveBeenCalled();
    await expect(service.run()).resolves.toEqual({ registered: 2, skipped: 0, failed: 0 });
    expect(settings.setValue).toHaveBeenCalledWith(KEY, '1');
  });

  it('does not mark recovery complete when source lookup fails', async () => {
    await cachedFile();
    repository.findCachedSourceFileId.mockRejectedValue(new Error('Lookup failed'));
    await expect(service.run()).resolves.toEqual({ registered: 0, skipped: 0, failed: 1 });
    expect(settings.setValue).not.toHaveBeenCalled();
  });

  it('keeps work sequential across many cache files and coalesces concurrent recovery calls', async () => {
    for (let book = 1; book <= 30; book++) await cachedFile(String(book));
    let active = 0;
    let peak = 0;
    repository.registerDeliveredHash.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    });
    const first = service.run();
    expect(service.run()).toBe(first);
    await expect(first).resolves.toEqual({ registered: 30, skipped: 0, failed: 0 });
    expect(peak).toBe(1);
    expect(settings.getValue).toHaveBeenCalledTimes(1);
  });

  it('propagates failure to save completion so recovery can be retried', async () => {
    await cachedFile();
    settings.setValue.mockRejectedValueOnce(new Error('Marker write failed'));
    await expect(service.run()).rejects.toThrow('Marker write failed');
    await expect(service.run()).resolves.toEqual({ registered: 1, skipped: 0, failed: 0 });
  });
});
