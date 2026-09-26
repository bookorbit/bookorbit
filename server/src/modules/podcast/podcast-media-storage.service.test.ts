import { open, realpath, rm, stat, statfs } from 'fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PodcastMediaStorageService } from './podcast-media-storage.service';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  open: vi.fn(),
  realpath: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
  statfs: vi.fn(),
}));

describe('PodcastMediaStorageService', () => {
  const repo = {
    findPodcast: vi.fn(),
    findPodcastMediaFiles: vi.fn(),
    findEpisodeMediaContext: vi.fn(),
    findPodcastLibrary: vi.fn(),
    findPrimaryLibraryFolder: vi.fn(),
    findRetentionCandidates: vi.fn(),
    findFinishedCleanupCandidates: vi.fn(),
    getLibrarySettings: vi.fn(),
    getUnevictableLocalBytes: vi.fn(),
    updateMedia: vi.fn(),
    reconcileDurationFromMedia: vi.fn(),
  };
  const secrets = { decrypt: vi.fn(), redactUrl: vi.fn() };
  const urlSecurity = { fetch: vi.fn() };
  const gateway = { emitRetentionEvicted: vi.fn() };
  const tagReader = { read: vi.fn() };
  const service = new PodcastMediaStorageService(
    { maxEpisodeBytes: 1024 * 1024, requestTimeoutMs: 30_000, maxDownloadDurationMs: 60_000 } as never,
    repo as never,
    repo as never,
    secrets as never,
    urlSecurity as never,
    gateway as never,
    tagReader as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    repo.findFinishedCleanupCandidates.mockResolvedValue([]);
    repo.getUnevictableLocalBytes.mockResolvedValue(0n);
    vi.mocked(realpath).mockImplementation((path) => Promise.resolve(path.toString()));
    vi.mocked(rm).mockResolvedValue(undefined);
  });

  it('never forwards an active upstream content type for episode media', async () => {
    repo.findEpisodeMediaContext.mockResolvedValue({ episode: { enclosureUrlEncrypted: 'encrypted' } });
    secrets.decrypt.mockReturnValue('https://example.com/episode.mp3');
    urlSecurity.fetch.mockResolvedValue({
      response: new Response('<script>alert(1)</script>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      finalUrl: new URL('https://example.com/episode.mp3'),
    });

    const response = await service.openRemoteMedia(11);

    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects episode media without a supported audio type or extension', async () => {
    repo.findEpisodeMediaContext.mockResolvedValue({ episode: { enclosureUrlEncrypted: 'encrypted' } });
    secrets.decrypt.mockReturnValue('https://example.com/payload.html');
    urlSecurity.fetch.mockResolvedValue({
      response: new Response('<script>alert(1)</script>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      finalUrl: new URL('https://example.com/payload.html'),
    });

    await expect(service.openRemoteMedia(11)).rejects.toThrow('not a supported audio format');
  });

  it('accounts for concurrent download reservations against one library quota', async () => {
    repo.getLibrarySettings.mockResolvedValue({
      usedStorageBytes: 0n,
      storageQuotaBytes: 100n,
      minimumFreeSpaceBytes: 0n,
    });
    repo.findPodcastLibrary.mockResolvedValue({ id: 7 });
    repo.findPrimaryLibraryFolder.mockResolvedValue('/podcasts');
    repo.findRetentionCandidates.mockResolvedValue([]);
    vi.mocked(statfs).mockResolvedValue({ bavail: 1_000, bsize: 1 } as Awaited<ReturnType<typeof statfs>>);

    await (service as any).reserveDownloadCapacity(101, 7, 60, 0);
    await expect((service as any).reserveDownloadCapacity(102, 7, 60, 0)).rejects.toThrow('does not have enough storage');
    (service as any).downloadReservations.delete(101);
    await expect((service as any).reserveDownloadCapacity(102, 7, 60, 0)).resolves.toBeUndefined();
    (service as any).downloadReservations.delete(102);
  });

  it('replaces an under-declared feed runtime with the one decoded from the downloaded file', async () => {
    // The shape a real feed produces: dynamic ad insertion makes the delivered audio minutes
    // longer than the duration the publisher declared.
    tagReader.read.mockResolvedValue({ durationSeconds: 3003.32 });
    repo.reconcileDurationFromMedia.mockResolvedValue(true);

    await (service as any).reconcileDeclaredDuration(11, '/podcasts/episode.mp3', 2424);

    expect(repo.reconcileDurationFromMedia).toHaveBeenCalledWith(11, 3003);
  });

  it('leaves a runtime alone when the file only disagrees by rounding', async () => {
    tagReader.read.mockResolvedValue({ durationSeconds: 2424.4 });

    await (service as any).reconcileDeclaredDuration(11, '/podcasts/episode.mp3', 2424);

    expect(repo.reconcileDurationFromMedia).not.toHaveBeenCalled();
  });

  it('keeps the declared runtime when the file cannot be probed', async () => {
    // No ffprobe, or a file it cannot read: a download that already succeeded must not be undone
    // by a correction that could not be made.
    tagReader.read.mockResolvedValue(null);

    await (service as any).reconcileDeclaredDuration(11, '/podcasts/episode.mp3', 2424);

    expect(repo.reconcileDurationFromMedia).not.toHaveBeenCalled();
  });

  it('swallows a failed runtime correction rather than failing the download', async () => {
    tagReader.read.mockResolvedValue({ durationSeconds: 3003 });
    repo.reconcileDurationFromMedia.mockRejectedValue(new Error('database is away'));

    await expect((service as any).reconcileDeclaredDuration(11, '/podcasts/episode.mp3', 2424)).resolves.toBeUndefined();
  });

  it('corrects a runtime the feed never declared at all', async () => {
    tagReader.read.mockResolvedValue({ durationSeconds: 1800 });
    repo.reconcileDurationFromMedia.mockResolvedValue(true);

    await (service as any).reconcileDeclaredDuration(11, '/podcasts/episode.mp3', null);

    expect(repo.reconcileDurationFromMedia).toHaveBeenCalledWith(11, 1800);
  });

  it('carries the recorded digest alongside the opened local file', async () => {
    const digest = 'c'.repeat(64);
    repo.findEpisodeMediaContext.mockResolvedValue({
      libraryFolderPath: '/podcasts',
      libraryRoots: ['/podcasts'],
      episode: { origin: 'feed', enclosureUrlEncrypted: 'encrypted' },
      media: {
        status: 'local',
        localPath: '/podcasts/show/episode.mp3',
        mimeType: 'audio/mpeg',
        fileName: 'episode.mp3',
        checksum: digest,
      },
    });
    const info = { isFile: () => true, size: 2_048, dev: 1, ino: 2 };
    vi.mocked(stat).mockResolvedValue(info as Awaited<ReturnType<typeof stat>>);
    vi.mocked(open).mockResolvedValue({
      stat: vi.fn().mockResolvedValue(info),
      close: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof open>>);

    await expect(service.findAvailableLocalMedia(11)).resolves.toMatchObject({ size: 2_048, checksum: digest });
  });

  it('reports a cached file with no recorded digest as null', async () => {
    repo.findEpisodeMediaContext.mockResolvedValue({
      libraryFolderPath: '/podcasts',
      libraryRoots: ['/podcasts'],
      episode: { origin: 'feed', enclosureUrlEncrypted: 'encrypted' },
      media: { status: 'local', localPath: '/podcasts/show/episode.mp3', mimeType: 'audio/mpeg', fileName: 'episode.mp3' },
    });
    const info = { isFile: () => true, size: 2_048, dev: 1, ino: 2 };
    vi.mocked(stat).mockResolvedValue(info as Awaited<ReturnType<typeof stat>>);
    vi.mocked(open).mockResolvedValue({
      stat: vi.fn().mockResolvedValue(info),
      close: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof open>>);

    await expect(service.findAvailableLocalMedia(11)).resolves.toMatchObject({ checksum: null });
  });

  it('opens an adopted episode that lives in a local root rather than the downloads root', async () => {
    // The file the user brought sits outside the downloads root. Judging it against that root alone
    // reported every local episode as missing, and the repair path then erased a healthy media row.
    repo.findEpisodeMediaContext.mockResolvedValue({
      libraryFolderPath: '/podcasts/downloads',
      libraryRoots: ['/podcasts/downloads', '/archive/shows'],
      episode: { origin: 'local', enclosureUrlEncrypted: null },
      media: { status: 'local', localPath: '/archive/shows/Field Notes/ep1.mp3', mimeType: 'audio/mpeg', fileName: 'ep1.mp3', checksum: null },
    });
    const info = { isFile: () => true, size: 4_096, dev: 1, ino: 2 };
    vi.mocked(stat).mockResolvedValue(info as Awaited<ReturnType<typeof stat>>);
    vi.mocked(open).mockResolvedValue({
      stat: vi.fn().mockResolvedValue(info),
      close: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof open>>);

    await expect(service.findAvailableLocalMedia(11)).resolves.toMatchObject({ size: 4_096, mimeType: 'audio/mpeg' });
    expect(repo.updateMedia).not.toHaveBeenCalled();
  });

  it('leaves a local episode alone when its file belongs to no root of the library', async () => {
    repo.findEpisodeMediaContext.mockResolvedValue({
      libraryFolderPath: '/podcasts/downloads',
      libraryRoots: ['/podcasts/downloads', '/archive/shows'],
      episode: { origin: 'local', enclosureUrlEncrypted: null },
      media: { status: 'local', localPath: '/somewhere/else/ep1.mp3', mimeType: 'audio/mpeg', fileName: 'ep1.mp3', checksum: null },
    });

    await expect(service.findAvailableLocalMedia(11)).resolves.toBeNull();
    expect(repo.updateMedia).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'unavailable', localPath: null }));
  });

  it('repairs stale local media records when the file is missing', async () => {
    repo.findEpisodeMediaContext.mockResolvedValue({
      libraryFolderPath: '/podcasts',
      libraryRoots: ['/podcasts'],
      episode: { origin: 'feed', enclosureUrlEncrypted: 'encrypted' },
      media: { status: 'local', localPath: '/podcasts/missing.mp3', mimeType: 'audio/mpeg', fileName: 'missing.mp3' },
    });
    vi.mocked(stat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    await expect(service.findAvailableLocalMedia(11)).resolves.toBeNull();

    expect(repo.updateMedia).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ status: 'remote', localPath: null, fileName: null, downloadedAt: null }),
    );
  });

  it('does not stream a local media path that resolves outside the podcast storage folder', async () => {
    repo.findEpisodeMediaContext.mockResolvedValue({
      libraryFolderPath: '/podcasts',
      libraryRoots: ['/podcasts'],
      episode: { origin: 'feed', enclosureUrlEncrypted: 'encrypted' },
      media: { status: 'local', localPath: '/podcasts/linked.mp3', mimeType: 'audio/mpeg', fileName: 'linked.mp3' },
    });
    vi.mocked(realpath).mockImplementation((path) =>
      Promise.resolve(path.toString().endsWith('linked.mp3') ? '/path/to/outside-library/secret.mp3' : path.toString()),
    );

    await expect(service.findAvailableLocalMedia(11)).resolves.toBeNull();
    expect(repo.updateMedia).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'remote', localPath: null }));
  });

  it('removes a contained local download and resets its media record', async () => {
    repo.findEpisodeMediaContext.mockResolvedValue({
      libraryFolderPath: '/podcasts',
      libraryRoots: ['/podcasts'],
      episode: { origin: 'feed', enclosureUrlEncrypted: 'encrypted' },
      media: { status: 'local', localPath: '/podcasts/show/episode.mp3' },
    });
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>);

    await expect(service.removeEpisodeDownload(11)).resolves.toBe(true);

    expect(rm).toHaveBeenCalledWith('/podcasts/show/episode.mp3', { force: true });
    expect(repo.updateMedia).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'remote', localPath: null, sizeBytes: null }));
  });

  it('purges only the podcast media files owned by the library root', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7 });
    repo.findPrimaryLibraryFolder.mockResolvedValue('/podcasts');
    repo.findPodcastMediaFiles.mockResolvedValue([{ episodeId: 21, localPath: '/podcasts/show/episode.mp3', sizeBytes: 4096 }]);
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>);

    await expect(service.purgePodcastFiles(3)).resolves.toEqual({ files: 1, bytes: 4096 });

    expect(rm).toHaveBeenCalledWith('/podcasts/show/episode.mp3', { force: true });
  });

  describe('local-origin media', () => {
    function localEpisodeContext(media: Record<string, unknown> | null) {
      return { libraryFolderPath: '/podcasts', libraryRoots: ['/podcasts'], episode: { origin: 'local', enclosureUrlEncrypted: null }, media };
    }

    it('deletes the file but leaves the media unavailable rather than remote', async () => {
      repo.findEpisodeMediaContext.mockResolvedValue(localEpisodeContext({ status: 'local', localPath: '/podcasts/field/dawn.mp3' }));
      vi.mocked(stat).mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>);

      await expect(service.removeEpisodeDownload(11)).resolves.toBe(true);

      expect(rm).toHaveBeenCalledWith('/podcasts/field/dawn.mp3', { force: true });
      // `remote` would advertise a download that has nowhere to fetch from.
      expect(repo.updateMedia).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'unavailable', localPath: null }));
    });

    it('marks a vanished local file unavailable instead of pretending it can be re-fetched', async () => {
      repo.findEpisodeMediaContext.mockResolvedValue(
        localEpisodeContext({ status: 'local', localPath: '/podcasts/field/gone.mp3', mimeType: 'audio/mpeg', fileName: 'gone.mp3' }),
      );
      vi.mocked(stat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

      await expect(service.findAvailableLocalMedia(11)).resolves.toBeNull();

      expect(repo.updateMedia).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'unavailable', localPath: null }));
    });

    it('never proxies an origin a local episode does not have', async () => {
      repo.findEpisodeMediaContext.mockResolvedValue(localEpisodeContext(null));

      await expect(service.openRemoteMedia(11)).rejects.toMatchObject({
        status: 410,
        response: { errorCode: 'PODCAST_LOCAL_MEDIA_MISSING' },
      });
      expect(urlSecurity.fetch).not.toHaveBeenCalled();
      expect(repo.updateMedia).toHaveBeenCalledWith(11, expect.objectContaining({ status: 'unavailable' }));
    });

    it('refuses to download an episode whose file is already the only copy', async () => {
      repo.findEpisodeMediaContext.mockResolvedValue(localEpisodeContext(null));

      await expect(service.downloadEpisode(11)).rejects.toMatchObject({ response: { errorCode: 'PODCAST_LOCAL_NO_DOWNLOAD' } });
      expect(urlSecurity.fetch).not.toHaveBeenCalled();
    });

    it('says why retention could not free space when local files are pinning the library', async () => {
      repo.getLibrarySettings.mockResolvedValue({ storageQuotaBytes: 100n, minimumFreeSpaceBytes: 0n, usedStorageBytes: 100n });
      repo.findPodcastLibrary.mockResolvedValue({ id: 7 });
      repo.findPrimaryLibraryFolder.mockResolvedValue('/podcasts');
      repo.findRetentionCandidates.mockResolvedValue([]);
      repo.getUnevictableLocalBytes.mockResolvedValue(4096n);

      await expect(
        (service as never as { reserveDownloadCapacity: (...args: unknown[]) => Promise<void> }).reserveDownloadCapacity(102, 7, 60, 0),
      ).rejects.toMatchObject({ response: { errorCode: 'PODCAST_STORAGE_FULL' } });
    });
  });
});

describe('PodcastMediaStorageService retention', () => {
  const repo = {
    findPodcastLibrary: vi.fn(),
    findPrimaryLibraryFolder: vi.fn(),
    findRetentionCandidates: vi.fn(),
    findFinishedCleanupCandidates: vi.fn(),
    getLibrarySettings: vi.fn(),
    getUnevictableLocalBytes: vi.fn(),
    updateMedia: vi.fn(),
    reconcileDurationFromMedia: vi.fn(),
  };
  const gateway = { emitRetentionEvicted: vi.fn() };
  const service = new PodcastMediaStorageService(
    { maxEpisodeBytes: 1024 * 1024, requestTimeoutMs: 30_000, maxDownloadDurationMs: 60_000 } as never,
    repo as never,
    repo as never,
    {} as never,
    {} as never,
    gateway as never,
    { read: vi.fn() } as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(realpath).mockImplementation((path) => Promise.resolve(path.toString()));
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(stat).mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>);
    vi.mocked(statfs).mockResolvedValue({ bavail: 1_000_000, bsize: 1 } as Awaited<ReturnType<typeof statfs>>);
    repo.findPodcastLibrary.mockResolvedValue({ id: 7 });
    repo.findPrimaryLibraryFolder.mockResolvedValue('/podcasts');
    repo.findRetentionCandidates.mockResolvedValue([]);
    repo.findFinishedCleanupCandidates.mockResolvedValue([]);
    repo.getUnevictableLocalBytes.mockResolvedValue(0n);
    repo.getLibrarySettings.mockResolvedValue({ usedStorageBytes: 0n, storageQuotaBytes: 1_000n, minimumFreeSpaceBytes: 0n });
  });

  it('deletes a finished episode, marks it remote, and announces the eviction', async () => {
    repo.findFinishedCleanupCandidates.mockResolvedValueOnce([
      { episodeId: 21, podcastId: 3, localPath: '/podcasts/show/finished.mp3', sizeBytes: 400 },
    ]);

    await expect(service.runRetention(7)).resolves.toMatchObject({ cleaned: 1, evicted: 0 });

    expect(rm).toHaveBeenCalledWith('/podcasts/show/finished.mp3', { force: true });
    expect(repo.updateMedia).toHaveBeenCalledWith(21, expect.objectContaining({ status: 'remote', localPath: null, sizeBytes: null }));
    expect(gateway.emitRetentionEvicted).toHaveBeenCalledWith({ libraryId: 7, podcastId: 3, episodeId: 21, reason: 'played' });
  });

  it('repairs a row whose file is already gone instead of failing the pass', async () => {
    repo.findFinishedCleanupCandidates.mockResolvedValueOnce([
      { episodeId: 22, podcastId: 3, localPath: '/podcasts/show/missing.mp3', sizeBytes: 400 },
    ]);
    vi.mocked(realpath).mockImplementation((path) =>
      path.toString() === '/podcasts/show/missing.mp3'
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(path.toString()),
    );

    await expect(service.runRetention(7)).resolves.toMatchObject({ cleaned: 1 });

    expect(rm).not.toHaveBeenCalledWith('/podcasts/show/missing.mp3', { force: true });
    expect(repo.updateMedia).toHaveBeenCalledWith(22, expect.objectContaining({ status: 'remote' }));
  });

  it('cleans up before measuring pressure, so a finished file is what frees the quota', async () => {
    repo.findFinishedCleanupCandidates.mockResolvedValueOnce([
      { episodeId: 23, podcastId: 3, localPath: '/podcasts/show/played.mp3', sizeBytes: 900 },
    ]);
    repo.getLibrarySettings.mockResolvedValue({ usedStorageBytes: 0n, storageQuotaBytes: 100n, minimumFreeSpaceBytes: 0n });

    await expect(service.runRetention(7)).resolves.toMatchObject({ cleaned: 1, evicted: 0, capacityAvailable: true });

    expect(repo.findFinishedCleanupCandidates.mock.invocationCallOrder[0]).toBeLessThan(repo.getLibrarySettings.mock.invocationCallOrder[0]!);
    expect(repo.findRetentionCandidates).not.toHaveBeenCalled();
  });

  it('reports a space eviction under quota pressure', async () => {
    repo.getLibrarySettings.mockResolvedValue({ usedStorageBytes: 500n, storageQuotaBytes: 100n, minimumFreeSpaceBytes: 0n });
    repo.findRetentionCandidates.mockResolvedValueOnce([{ episodeId: 24, podcastId: 4, localPath: '/podcasts/show/cold.mp3', sizeBytes: 500 }]);

    await expect(service.runRetention(7)).resolves.toMatchObject({ evicted: 1, cleaned: 0 });

    expect(gateway.emitRetentionEvicted).toHaveBeenCalledWith({ libraryId: 7, podcastId: 4, episodeId: 24, reason: 'space' });
  });
});
