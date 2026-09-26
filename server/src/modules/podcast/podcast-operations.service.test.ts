import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { LibraryService } from '../library/library.service';
import { NotificationService } from '../notification/notification.service';
import { PodcastArtworkService } from './podcast-artwork.service';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastDirectoryService } from './podcast-directory.service';
import { PodcastEpisodeRepository } from './podcast-episode.repository';
import { PodcastFeedClientService } from './podcast-feed-client.service';
import { PodcastFeedParserService } from './podcast-feed-parser.service';
import { PodcastFeedSnapshotService } from './podcast-feed-snapshot.service';
import { PodcastGateway } from './podcast.gateway';
import { PodcastJobRepository } from './podcast-job.repository';
import { PodcastLocalShowImportService } from './podcast-local-show-import.service';
import { PodcastMediaStorageService } from './podcast-media-storage.service';
import { PodcastOpmlService } from './podcast-opml.service';
import { PodcastPlaybackRepository } from './podcast-playback.repository';
import { PodcastSecretService } from './podcast-secret.service';
import { PodcastAccessService } from './podcast-access.service';
import { PodcastCatalogService } from './podcast-catalog.service';
import { PodcastOperationsService } from './podcast-operations.service';
import { PodcastPlaybackService } from './podcast-playback.service';

describe('PodcastOperationsService', () => {
  const repo = {
    findEpisodeForUser: vi.fn(),
    findEpisodeSummary: vi.fn(),
    findQueuePlaybackContext: vi.fn(),
    findAdjacentEpisodeSummaries: vi.fn(),
    findBookmarkAccess: vi.fn(),
    deleteBookmark: vi.fn(),
    updateBookmark: vi.fn(),
    createBookmark: vi.fn(),
    createListeningSession: vi.fn(),
    getLibrarySettings: vi.fn(),
    upsertEpisodeState: vi.fn(),
    listEpisodeStates: vi.fn(),
    listContinueListening: vi.fn(),
    findPodcast: vi.fn(),
    updatePodcast: vi.fn(),
    updateEpisodeMetadata: vi.fn(),
    findFollow: vi.fn(),
    countEpisodesCreatedSince: vi.fn(),
    markFollowNotified: vi.fn(),
    syncPodcastFeed: vi.fn(),
    reparsePodcastFeed: vi.fn(),
    markRefreshNotModified: vi.fn(),
    findPodcastByFeedHash: vi.fn(),
    archivePodcast: vi.fn(),
    mergePodcastInto: vi.fn(),
    deletePodcast: vi.fn(),
    listFollowedUsers: vi.fn(),
    markFollowsNotified: vi.fn(),
    markRefreshFailed: vi.fn(),
    findNewestEpisodeIds: vi.fn(),
    filterDownloadableEpisodeIds: vi.fn(),
    markMediaQueued: vi.fn(),
    reorderQueue: vi.fn(),
    moveQueueItem: vi.fn(),
    clearQueue: vi.fn(),
    clearFinishedQueue: vi.fn(),
    restoreQueue: vi.fn(),
    addPodcastEpisodesToQueue: vi.fn(),
    addQueryEpisodesToQueue: vi.fn(),
    findPodcastLibrary: vi.fn(),
    markPodcastEpisodesFinished: vi.fn(),
    findLocalPodcastEpisodeIds: vi.fn(),
    countLocalOriginDownloads: vi.fn(),
    createLocalPodcast: vi.fn(),
    findLocalPodcastByFolder: vi.fn(),
    countLocalPodcasts: vi.fn(),
    hasManageablePodcastLibrary: vi.fn(),
    findPodcastIdsByFeedHashes: vi.fn(),
    findPodcastsInLibrary: vi.fn(),
    getPodcastMediaStats: vi.fn(),
  };
  const jobs = {
    enqueue: vi.fn(),
    enqueueDestructive: vi.fn(),
    enqueueMany: vi.fn(),
    cancelPodcastWork: vi.fn(),
    hasActiveDestructiveWork: vi.fn(),
    cancelEpisodeDownload: vi.fn(),
    findLatestByType: vi.fn(),
    listActiveDownloadBatchJobs: vi.fn(),
    findDownloadBatchJobs: vi.fn(),
  };
  const storage = {
    purgePodcastFiles: vi.fn(),
    removeEpisodeDownload: vi.fn(),
  };
  const artwork = {
    saveCustomArtwork: vi.fn(),
    removeCustomArtwork: vi.fn(),
    purgeCustomArtwork: vi.fn(),
    fetchArtworkFromUrl: vi.fn(),
  };
  const libraries = { verifyUserAccessLevel: vi.fn(), findAccessibleLibraryIds: vi.fn() };
  const notifications = { notify: vi.fn() };
  const gateway = {
    emitDownloadProgress: vi.fn(),
    emitDownloadComplete: vi.fn(),
  };
  const feeds = { fetchFeed: vi.fn() };
  const snapshots = { write: vi.fn(), read: vi.fn(), remove: vi.fn() };
  const parser = { parse: vi.fn() };
  const imports = { resolveLocalShowFolder: vi.fn() };
  const directory = { search: vi.fn() };
  const secrets = { decrypt: vi.fn(), hashUrl: vi.fn().mockReturnValue('feed-hash'), redactUrl: vi.fn() };
  let catalogService: PodcastCatalogService;
  let operationsService: PodcastOperationsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PodcastAccessService,
        PodcastCatalogService,
        PodcastPlaybackService,
        PodcastOperationsService,
        { provide: PodcastCatalogRepository, useValue: repo },
        { provide: PodcastEpisodeRepository, useValue: repo },
        { provide: PodcastPlaybackRepository, useValue: repo },
        { provide: PodcastJobRepository, useValue: jobs },
        { provide: PodcastFeedClientService, useValue: feeds },
        { provide: PodcastDirectoryService, useValue: directory },
        { provide: PodcastSecretService, useValue: secrets },
        { provide: PodcastLocalShowImportService, useValue: imports },
        { provide: PodcastOpmlService, useValue: {} },
        { provide: PodcastArtworkService, useValue: artwork },
        { provide: PodcastMediaStorageService, useValue: storage },
        { provide: PodcastFeedSnapshotService, useValue: snapshots },
        { provide: PodcastFeedParserService, useValue: parser },
        { provide: LibraryService, useValue: libraries },
        { provide: NotificationService, useValue: notifications },
        { provide: PodcastGateway, useValue: gateway },
      ],
    }).compile();
    catalogService = module.get(PodcastCatalogService);
    operationsService = module.get(PodcastOperationsService);
    jobs.enqueue.mockResolvedValue(41);
    jobs.enqueueMany.mockResolvedValue([]);
    jobs.cancelPodcastWork.mockResolvedValue(0);
    jobs.hasActiveDestructiveWork.mockResolvedValue(false);
    jobs.enqueueDestructive.mockResolvedValue(99);
    jobs.cancelEpisodeDownload.mockResolvedValue({ processing: 0, cancelledBatchIds: [] });
    jobs.listActiveDownloadBatchJobs.mockResolvedValue([]);
    jobs.findDownloadBatchJobs.mockResolvedValue([]);
    repo.countLocalOriginDownloads.mockResolvedValue(0);
    snapshots.write.mockResolvedValue(new Date('2026-07-31T12:00:00.000Z'));
    snapshots.read.mockResolvedValue(null);
    storage.purgePodcastFiles.mockResolvedValue({ files: 0, bytes: 0 });
    storage.removeEpisodeDownload.mockResolvedValue(true);
    artwork.saveCustomArtwork.mockResolvedValue({ format: 'png', bytes: 64 });
    artwork.removeCustomArtwork.mockResolvedValue(true);
    artwork.purgeCustomArtwork.mockResolvedValue(undefined);
    artwork.fetchArtworkFromUrl.mockResolvedValue(Buffer.from('artwork'));
    snapshots.remove.mockResolvedValue(undefined);
    repo.listFollowedUsers.mockResolvedValue([]);
    repo.findNewestEpisodeIds.mockResolvedValue([]);
    repo.filterDownloadableEpisodeIds.mockImplementation((ids: number[]) => Promise.resolve(ids));
    repo.reorderQueue.mockResolvedValue(true);
    repo.moveQueueItem.mockResolvedValue(true);
    repo.clearQueue.mockResolvedValue({ removed: 0, previousEpisodeIds: [] });
    repo.clearFinishedQueue.mockResolvedValue({ removed: 0, previousEpisodeIds: [] });
    repo.restoreQueue.mockResolvedValue(0);
    repo.addPodcastEpisodesToQueue.mockResolvedValue({ added: 0, skipped: 0 });
    repo.addQueryEpisodesToQueue.mockResolvedValue({ added: 0, skipped: 0 });
    repo.findPodcastLibrary.mockResolvedValue({ id: 7, name: 'Podcasts' });
    repo.markPodcastEpisodesFinished.mockResolvedValue(0);
    repo.findLocalPodcastEpisodeIds.mockResolvedValue([]);
    repo.hasManageablePodcastLibrary.mockResolvedValue(true);
    repo.findPodcastIdsByFeedHashes.mockResolvedValue([]);
    directory.search.mockResolvedValue([]);
    libraries.findAccessibleLibraryIds.mockResolvedValue([5]);
    // Reset rather than clear: an implementation installed by one test survives clearAllMocks.
    secrets.hashUrl.mockReturnValue('feed-hash');
  });

  it('queues only downloadable episodes from the bounded latest selection', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, archivedAt: null });
    repo.findNewestEpisodeIds.mockResolvedValue([{ id: 42 }, { id: 43 }, { id: 44 }]);
    repo.filterDownloadableEpisodeIds.mockResolvedValue([42, 44]);
    jobs.enqueueMany.mockResolvedValue([{ id: 1, episodeId: 42 }]);

    const result = await operationsService.downloadLatestPodcastEpisodes(3, { count: 3 }, requestUser());

    expect(result).toEqual({ completed: 1, failed: 0, skipped: 2, batchId: expect.any(String) });

    expect(repo.findNewestEpisodeIds).toHaveBeenCalledWith(3, 3);
    expect(repo.markMediaQueued).toHaveBeenCalledWith([42]);
    expect(jobs.enqueueMany).toHaveBeenCalledWith([
      expect.objectContaining({ episodeId: 42, downloadBatchId: result.batchId }),
      expect.objectContaining({ episodeId: 44, downloadBatchId: result.batchId }),
    ]);
    expect(gateway.emitDownloadProgress).toHaveBeenCalledWith(expect.objectContaining({ episodeId: 42, batchId: result.batchId, status: 'queued' }));
  });

  it('does not expose an empty download batch when every requested episode is already active', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, archivedAt: null });
    repo.findNewestEpisodeIds.mockResolvedValue([{ id: 42 }]);
    jobs.enqueueMany.mockResolvedValue([]);

    await expect(operationsService.downloadLatestPodcastEpisodes(3, { count: 1 }, requestUser())).resolves.toEqual({
      completed: 0,
      failed: 0,
      skipped: 1,
      batchId: null,
    });
  });

  it('returns user-scoped active download batches with truthful terminal and byte totals', async () => {
    libraries.findAccessibleLibraryIds.mockResolvedValue([7]);
    jobs.listActiveDownloadBatchJobs.mockResolvedValue([
      {
        batchId: '0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115',
        libraryId: 7,
        podcastId: 3,
        podcastTitle: 'Orbit Radio',
        episodeId: 42,
        episodeTitle: 'Launch',
        status: 'completed',
        progressCurrent: 100,
        progressTotal: 100,
        createdAt: new Date('2026-08-01T12:00:00.000Z'),
        updatedAt: new Date('2026-08-01T12:01:00.000Z'),
      },
      {
        batchId: '0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115',
        libraryId: 7,
        podcastId: 3,
        podcastTitle: 'Orbit Radio',
        episodeId: 43,
        episodeTitle: 'Landing',
        status: 'processing',
        progressCurrent: 25,
        progressTotal: null,
        createdAt: new Date('2026-08-01T12:00:00.000Z'),
        updatedAt: new Date('2026-08-01T12:02:00.000Z'),
      },
    ]);

    await expect(operationsService.listActiveDownloadBatches(requestUser())).resolves.toEqual([
      expect.objectContaining({
        id: '0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115',
        total: 2,
        completed: 1,
        downloading: 1,
        receivedBytes: 125,
        totalBytes: null,
        updatedAt: '2026-08-01T12:02:00.000Z',
      }),
    ]);
    expect(jobs.listActiveDownloadBatchJobs).toHaveBeenCalledWith(5, [7]);
  });

  it('does not reveal a requested batch after library access is removed', async () => {
    libraries.findAccessibleLibraryIds.mockResolvedValue([]);

    await expect(operationsService.findDownloadBatch('0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115', requestUser())).rejects.toThrow(
      'Podcast download batch not found',
    );
    expect(jobs.findDownloadBatchJobs).toHaveBeenCalledWith(5, [], ['0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115']);
  });

  it('removes show downloads in bounded batches and reports partial failures', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, archivedAt: null });
    repo.findLocalPodcastEpisodeIds.mockResolvedValueOnce([{ id: 42 }, { id: 43 }]);
    storage.removeEpisodeDownload.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('busy'));

    await expect(operationsService.removeAllPodcastDownloads(3, requestUser())).resolves.toEqual({
      completed: 1,
      failed: 1,
      skipped: 0,
    });

    expect(repo.findLocalPodcastEpisodeIds).toHaveBeenCalledWith(3, 0, 200);
    expect(gateway.emitDownloadComplete).toHaveBeenCalledWith(expect.objectContaining({ episodeId: 42, mediaStatus: 'remote' }));
  });

  it('delivers due digest notifications and advances the watermark', async () => {
    const lastNotifiedAt = new Date('2026-07-09T00:00:00.000Z');
    repo.findFollow.mockResolvedValue({ notificationMode: 'daily', lastNotifiedAt });
    repo.findPodcast.mockResolvedValue({ id: 3, title: 'Orbit Radio' });
    repo.countEpisodesCreatedSince.mockResolvedValue(2);

    await operationsService.processDigest(3, 5);

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: '2 new episodes of Orbit Radio', scope: { kind: 'user', userId: 5 } }),
    );
    expect(repo.markFollowNotified).toHaveBeenCalledWith(5, 3);
  });

  it('forces an artwork backfill refresh for podcasts missing stored artwork', async () => {
    const podcast = {
      id: 3,
      libraryId: 7,
      title: 'Believed',
      archivedAt: null,
      imageUrlEncrypted: null,
      feedUrlEncrypted: 'encrypted-feed-url',
      etag: 'feed-etag',
      lastModified: 'Fri, 10 Jul 2026 00:00:00 GMT',
      acquisitionPolicy: 'remote_only',
    };
    repo.findPodcast.mockResolvedValue(podcast);
    secrets.decrypt.mockReturnValue('https://feeds.npr.org/510326/podcast.xml');
    feeds.fetchFeed.mockResolvedValue({
      feed: { title: 'Believed', episodes: [] },
      finalUrl: 'https://feeds.npr.org/510326/podcast.xml',
      etag: 'fresh-etag',
      lastModified: null,
      notModified: false,
      status: 200,
    });
    repo.syncPodcastFeed.mockResolvedValue({ insertedEpisodeIds: [], episodeCount: 0 });

    await operationsService.processRefresh(3);

    expect(feeds.fetchFeed).toHaveBeenCalledWith('https://feeds.npr.org/510326/podcast.xml');
    expect(repo.syncPodcastFeed).toHaveBeenCalledWith(3, expect.objectContaining({ title: 'Believed' }), expect.any(Object));
  });

  it('batches immediate follower notifications without failing a successful refresh', async () => {
    const podcast = {
      id: 3,
      libraryId: 7,
      title: 'Orbit Radio',
      archivedAt: null,
      imageUrlEncrypted: 'encrypted-artwork',
      feedUrlEncrypted: 'encrypted-feed-url',
      etag: null,
      lastModified: null,
      acquisitionPolicy: 'remote_only',
    };
    repo.findPodcast.mockResolvedValue(podcast);
    repo.listFollowedUsers.mockResolvedValue([{ userId: 5 }, { userId: 6 }]);
    secrets.decrypt.mockReturnValue('https://example.com/feed.xml');
    feeds.fetchFeed.mockResolvedValue({
      feed: { title: 'Orbit Radio', episodes: [] },
      finalUrl: 'https://example.com/feed.xml',
      etag: null,
      lastModified: null,
      notModified: false,
      status: 200,
    });
    repo.syncPodcastFeed.mockResolvedValue({ insertedEpisodeIds: [101, 102], episodeCount: 2 });

    await operationsService.processRefresh(3);

    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: 'users', userIds: [5, 6] } }));
    expect(repo.markFollowsNotified).toHaveBeenCalledWith([5, 6], 3);
    expect(repo.markRefreshFailed).not.toHaveBeenCalled();
  });

  it('stores the fetched feed body and records the write in the same sync call', async () => {
    repo.findPodcast.mockResolvedValue(refreshablePodcast());
    secrets.decrypt.mockReturnValue('https://example.com/feed.xml');
    feeds.fetchFeed.mockResolvedValue(fetchResult({ xml: '<rss><channel><title>Orbit Radio</title></channel></rss>' }));
    repo.syncPodcastFeed.mockResolvedValue({ insertedEpisodeIds: [], episodeCount: 0 });
    const snapshotAt = new Date('2026-07-31T12:00:00.000Z');
    snapshots.write.mockResolvedValue(snapshotAt);

    await operationsService.processRefresh(3);

    expect(snapshots.write).toHaveBeenCalledWith(3, '<rss><channel><title>Orbit Radio</title></channel></rss>');
    expect(repo.syncPodcastFeed).toHaveBeenCalledWith(3, expect.any(Object), expect.objectContaining({ snapshotAt }));
  });

  it('leaves the stored copy and its timestamp untouched when the feed answers 304', async () => {
    repo.findPodcast.mockResolvedValue(refreshablePodcast());
    secrets.decrypt.mockReturnValue('https://example.com/feed.xml');
    feeds.fetchFeed.mockResolvedValue({
      feed: null,
      xml: null,
      finalUrl: 'https://example.com/feed.xml',
      etag: 'feed-etag',
      lastModified: null,
      notModified: true,
      status: 304,
    });

    await expect(operationsService.processRefresh(3)).resolves.toBe(0);

    expect(snapshots.write).not.toHaveBeenCalled();
    expect(repo.markRefreshNotModified).toHaveBeenCalledWith(3, 304, 'feed-etag', null);
  });

  it('keeps the last good copy when the feed fails to parse', async () => {
    repo.findPodcast.mockResolvedValue(refreshablePodcast());
    secrets.decrypt.mockReturnValue('https://example.com/feed.xml');
    feeds.fetchFeed.mockRejectedValue(new Error('Podcast feed is not valid XML'));
    repo.markRefreshFailed.mockResolvedValue(1);

    await expect(operationsService.processRefresh(3)).rejects.toThrow('Podcast feed is not valid XML');

    expect(snapshots.write).not.toHaveBeenCalled();
  });

  it('completes a refresh whose snapshot write failed, without claiming a stored copy exists', async () => {
    repo.findPodcast.mockResolvedValue(refreshablePodcast());
    secrets.decrypt.mockReturnValue('https://example.com/feed.xml');
    feeds.fetchFeed.mockResolvedValue(fetchResult({ xml: '<rss/>' }));
    repo.syncPodcastFeed.mockResolvedValue({ insertedEpisodeIds: [], episodeCount: 0 });
    snapshots.write.mockResolvedValue(null);

    await expect(operationsService.processRefresh(3)).resolves.toBe(0);

    expect(repo.syncPodcastFeed).toHaveBeenCalledWith(3, expect.any(Object), expect.objectContaining({ snapshotAt: null }));
    expect(repo.markRefreshFailed).not.toHaveBeenCalled();
  });

  it('refuses to queue a reparse for a podcast that has no stored copy yet', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, origin: 'feed', archivedAt: null, feedSnapshotAt: null });

    await expect(operationsService.enqueueReparse(3, requestUser())).rejects.toThrow('No stored feed copy exists');
    expect(jobs.enqueue).not.toHaveBeenCalled();

    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, origin: 'feed', archivedAt: new Date(), feedSnapshotAt: new Date() });
    await expect(operationsService.enqueueReparse(3, requestUser())).rejects.toThrow('Restore the podcast before reparsing');
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('queues one reparse per podcast for an editor who can manage feeds', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, origin: 'feed', archivedAt: null, feedSnapshotAt: new Date() });

    await expect(operationsService.enqueueReparse(3, requestUser())).resolves.toEqual({ jobId: 41 });

    expect(libraries.verifyUserAccessLevel).toHaveBeenCalledWith(5, 7, false, 'editor');
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'reparse', dedupeKey: 'reparse:3', podcastId: 3 }));
  });

  it('applies a parser change from the stored copy without a network call or follower notifications', async () => {
    repo.findPodcast.mockResolvedValue(refreshablePodcast());
    repo.listFollowedUsers.mockResolvedValue([{ userId: 5 }]);
    snapshots.read.mockResolvedValue('<rss><channel><title>Orbit Radio</title></channel></rss>');
    // Stands in for a parser improvement: the same stored bytes now yield an episode the old parser missed.
    parser.parse.mockReturnValue({ title: 'Orbit Radio', episodes: [{ identity: 'ep-1' }] });
    repo.reparsePodcastFeed.mockResolvedValue({ insertedEpisodeIds: [101], episodeCount: 1 });

    await expect(operationsService.processReparse(3)).resolves.toBe(1);

    expect(feeds.fetchFeed).not.toHaveBeenCalled();
    expect(repo.reparsePodcastFeed).toHaveBeenCalledWith(3, expect.objectContaining({ episodes: [{ identity: 'ep-1' }] }));
    expect(repo.syncPodcastFeed).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('reports a reparse whose stored copy has gone missing instead of clearing the feed', async () => {
    repo.findPodcast.mockResolvedValue(refreshablePodcast());
    snapshots.read.mockResolvedValue(null);

    await expect(operationsService.processReparse(3)).rejects.toThrow('No stored feed copy exists');

    expect(repo.reparsePodcastFeed).not.toHaveBeenCalled();
    expect(repo.markRefreshFailed).not.toHaveBeenCalled();
  });

  describe('local-origin shows and episodes', () => {
    const localPodcast = { id: 3, libraryId: 7, origin: 'local', archivedAt: null, feedSnapshotAt: null, acquisitionPolicy: 'manual' };

    it('refuses a manual refresh and a reparse with a stable code', async () => {
      repo.findPodcast.mockResolvedValue(localPodcast);

      await expect(operationsService.enqueueRefresh(3, requestUser())).rejects.toMatchObject({ response: { errorCode: 'PODCAST_LOCAL_NO_REFRESH' } });
      await expect(operationsService.enqueueReparse(3, requestUser())).rejects.toMatchObject({ response: { errorCode: 'PODCAST_LOCAL_NO_REFRESH' } });
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it('does nothing when a queued refresh reaches a show that has become local', async () => {
      repo.findPodcast.mockResolvedValue(localPodcast);

      await expect(operationsService.processRefresh(3)).resolves.toBe(0);
      await expect(operationsService.processReparse(3)).resolves.toBe(0);
      expect(feeds.fetchFeed).not.toHaveBeenCalled();
      expect(repo.markRefreshFailed).not.toHaveBeenCalled();
    });

    it('refuses a download for an episode that has no enclosure to fetch', async () => {
      repo.findEpisodeForUser.mockResolvedValue(episodeContext(600, { origin: 'local' }));

      await expect(operationsService.enqueueDownload(11, requestUser())).rejects.toMatchObject({
        response: { errorCode: 'PODCAST_LOCAL_NO_DOWNLOAD' },
      });
      expect(jobs.enqueue).not.toHaveBeenCalled();
      expect(repo.markMediaQueued).not.toHaveBeenCalled();
    });

    it('refuses a config write that only means something for a feed', async () => {
      repo.findPodcast.mockResolvedValue(localPodcast);

      await expect(catalogService.updatePodcastConfig(3, { refreshIntervalMinutes: 30 }, requestUser())).rejects.toMatchObject({
        response: { errorCode: 'PODCAST_LOCAL_NO_REFRESH' },
      });
      expect(repo.updatePodcast).not.toHaveBeenCalled();
    });

    it('still accepts the cleanup settings that do apply', async () => {
      repo.findPodcast.mockResolvedValue(localPodcast);
      repo.updatePodcast.mockResolvedValue({ ...localPodcast, downloadCleanup: 'keep' });

      await catalogService.updatePodcastConfig(3, { downloadCleanup: 'keep' }, requestUser());

      expect(repo.updatePodcast).toHaveBeenCalledWith(3, { downloadCleanup: 'keep' });
    });

    it('refuses to delete a local episode, whose file belongs to the user rather than to BookOrbit', async () => {
      repo.findEpisodeForUser.mockResolvedValue(episodeContext(600, { origin: 'local' }));

      await expect(operationsService.removeDownload(11, requestUser())).rejects.toMatchObject({
        response: { errorCode: 'PODCAST_LOCAL_FILE_NOT_REMOVABLE' },
      });
      expect(storage.removeEpisodeDownload).not.toHaveBeenCalled();
    });

    it('still drops a feed episode download, which is only a cached copy', async () => {
      repo.findEpisodeForUser.mockResolvedValue(episodeContext(600, { origin: 'feed' }));

      await operationsService.removeDownload(11, requestUser());

      expect(storage.removeEpisodeDownload).toHaveBeenCalledWith(11);
      expect(gateway.emitDownloadComplete).toHaveBeenCalledWith(expect.objectContaining({ episodeId: 11, mediaStatus: 'remote' }));
    });

    it('reports local files as skipped rather than removing them in a bulk download clear', async () => {
      repo.findPodcast.mockResolvedValue(localPodcast);
      repo.countLocalOriginDownloads.mockResolvedValue(12);
      repo.findLocalPodcastEpisodeIds.mockResolvedValue([]);

      await expect(operationsService.removeAllPodcastDownloads(3, requestUser())).resolves.toEqual({ completed: 0, failed: 0, skipped: 12 });
      expect(storage.removeEpisodeDownload).not.toHaveBeenCalled();
    });

    it('never queues automatic downloads for a show with no feed', async () => {
      repo.findPodcast.mockResolvedValue({ ...localPodcast, acquisitionPolicy: 'newest', autoDownloadLimit: 3 });

      await operationsService.processRefresh(3);

      expect(repo.findNewestEpisodeIds).not.toHaveBeenCalled();
      expect(jobs.enqueueMany).not.toHaveBeenCalled();
    });

    it('reports how many shows an OPML export had to leave out', async () => {
      repo.findPodcastLibrary.mockResolvedValue({ id: 7, name: 'Podcasts' });
      repo.countLocalPodcasts.mockResolvedValue(4);

      const result = await catalogService.exportOpml(7, false, false);

      expect(result.omittedLocalShows).toBe(4);
    });

    it('creates a show from a folder and queues the scan that fills it', async () => {
      repo.findPodcastLibrary.mockResolvedValue({ id: 7, name: 'Podcasts' });
      imports.resolveLocalShowFolder.mockResolvedValue({
        absolutePath: '/library/Field Recordings',
        relativePath: 'Field Recordings',
        metadata: { title: 'Field Recordings', author: null, description: null },
      });
      repo.findLocalPodcastByFolder.mockResolvedValue(null);
      repo.createLocalPodcast.mockResolvedValue({ podcast: { id: 31, title: 'Field Recordings' }, created: true });

      await expect(operationsService.createLocalPodcast(7, 'Field Recordings', requestUser())).resolves.toEqual({
        id: 31,
        title: 'Field Recordings',
        created: true,
        jobId: 41,
      });
      expect(jobs.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'local_import',
          dedupeKey: 'local_import:31',
          payload: { folderPath: '/library/Field Recordings', applyShowMetadata: true },
        }),
      );
    });

    it('re-imports into the show a folder already is, without re-deriving its metadata', async () => {
      repo.findPodcastLibrary.mockResolvedValue({ id: 7, name: 'Podcasts' });
      imports.resolveLocalShowFolder.mockResolvedValue({
        absolutePath: '/library/Field Recordings',
        relativePath: 'Field Recordings',
        metadata: { title: 'Field Recordings', author: null, description: null },
      });
      repo.findLocalPodcastByFolder.mockResolvedValue({ id: 31, title: 'Dawn Chorus Diaries' });

      await expect(operationsService.createLocalPodcast(7, 'Field Recordings', requestUser())).resolves.toMatchObject({
        id: 31,
        created: false,
      });
      expect(repo.createLocalPodcast).not.toHaveBeenCalled();
      expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ applyShowMetadata: false }) }));
    });
  });

  it('removes the stored feed copy of the podcast a merge consumes', async () => {
    repo.findPodcast
      .mockResolvedValueOnce({ id: 3, libraryId: 7, archivedAt: new Date() })
      .mockResolvedValueOnce({ id: 4, libraryId: 7, archivedAt: new Date() });
    repo.mergePodcastInto.mockResolvedValue(0);

    await operationsService.processMerge(3, { sourcePodcastId: 4 });

    expect(snapshots.remove).toHaveBeenCalledWith(4);
    expect(snapshots.remove).not.toHaveBeenCalledWith(3);
    expect(repo.mergePodcastInto.mock.invocationCallOrder[0]).toBeLessThan(artwork.purgeCustomArtwork.mock.invocationCallOrder[0]!);
    expect(artwork.purgeCustomArtwork.mock.invocationCallOrder[0]).toBeLessThan(snapshots.remove.mock.invocationCallOrder[0]!);
  });

  it('preserves purge cleanup ordering across the focused storage owners', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, archivedAt: new Date() });

    await operationsService.processPurge(3);

    expect(artwork.purgeCustomArtwork).toHaveBeenCalledWith(3);
    expect(snapshots.remove).toHaveBeenCalledWith(3);
    expect(storage.purgePodcastFiles).toHaveBeenCalledWith(3);
    expect(repo.deletePodcast).toHaveBeenCalledWith(3);
    expect(artwork.purgeCustomArtwork.mock.invocationCallOrder[0]).toBeLessThan(snapshots.remove.mock.invocationCallOrder[0]!);
    expect(snapshots.remove.mock.invocationCallOrder[0]).toBeLessThan(storage.purgePodcastFiles.mock.invocationCallOrder[0]!);
    expect(storage.purgePodcastFiles.mock.invocationCallOrder[0]).toBeLessThan(repo.deletePodcast.mock.invocationCallOrder[0]!);
  });

  it('requires an archived podcast and waits for active work before queuing a purge', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, archivedAt: null });

    await expect(operationsService.enqueuePurge(3, requestUser())).rejects.toThrow('Archive the podcast before purging it');
    expect(jobs.cancelPodcastWork).not.toHaveBeenCalled();

    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, archivedAt: new Date() });
    jobs.cancelPodcastWork.mockResolvedValue(1);
    await expect(operationsService.enqueuePurge(3, requestUser())).rejects.toThrow('Podcast jobs are still stopping');
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  describe('bulk delete', () => {
    /**
     * Bulk delete reaches purge through the same access check and archive gate a single delete uses,
     * so the archive write has to be visible to the read that follows it, as it is against a database.
     */
    function resolveShowsForPurge(shows: Array<{ id: number; archivedAt: Date | null }>) {
      const state = shows.map((show) => ({ ...show }));
      repo.findPodcastsInLibrary.mockResolvedValue(shows.map((show) => ({ id: show.id, archivedAt: show.archivedAt })));
      repo.archivePodcast.mockImplementation((podcastId: number, archived: boolean) => {
        const show = state.find((candidate) => candidate.id === podcastId);
        if (show) show.archivedAt = archived ? new Date('2026-08-12T00:00:00.000Z') : null;
        return Promise.resolve(show ? { ...show, libraryId: 7 } : null);
      });
      repo.findPodcast.mockImplementation((podcastId: number) => {
        const show = state.find((candidate) => candidate.id === podcastId);
        return Promise.resolve(show ? { ...show, libraryId: 7 } : null);
      });
    }

    it('archives and queues a purge for every named show', async () => {
      resolveShowsForPurge([
        { id: 3, archivedAt: null },
        { id: 4, archivedAt: null },
      ]);

      const result = await operationsService.bulkDeleteShows(7, [3, 4], requestUser());

      expect(result).toEqual({ completed: 2, failed: 0, skipped: 0 });
      expect(repo.archivePodcast).toHaveBeenCalledWith(3, true);
      expect(repo.archivePodcast).toHaveBeenCalledWith(4, true);
      expect(jobs.enqueueDestructive).toHaveBeenCalledTimes(2);
    });

    it('leaves a show that is already archived without a second archive write', async () => {
      resolveShowsForPurge([{ id: 3, archivedAt: new Date('2026-08-01T00:00:00.000Z') }]);

      const result = await operationsService.bulkDeleteShows(7, [3], requestUser());

      expect(result).toEqual({ completed: 1, failed: 0, skipped: 0 });
      expect(repo.archivePodcast).not.toHaveBeenCalled();
      expect(jobs.enqueueDestructive).toHaveBeenCalledTimes(1);
    });

    it('counts ids this library does not hold as skipped rather than refusing the run', async () => {
      resolveShowsForPurge([{ id: 3, archivedAt: null }]);

      const result = await operationsService.bulkDeleteShows(7, [3, 999], requestUser());

      expect(result).toEqual({ completed: 1, failed: 0, skipped: 1 });
      expect(jobs.enqueueDestructive).toHaveBeenCalledTimes(1);
    });

    it('deduplicates repeated ids before resolving them', async () => {
      resolveShowsForPurge([{ id: 3, archivedAt: null }]);

      const result = await operationsService.bulkDeleteShows(7, [3, 3, 3], requestUser());

      expect(repo.findPodcastsInLibrary).toHaveBeenCalledWith(7, [3]);
      expect(result).toEqual({ completed: 1, failed: 0, skipped: 0 });
    });

    it('counts a show whose work is still stopping without stranding the rest', async () => {
      resolveShowsForPurge([
        { id: 3, archivedAt: null },
        { id: 4, archivedAt: null },
      ]);
      jobs.cancelPodcastWork.mockImplementation((ids: number[]) => Promise.resolve(ids.includes(3) ? 1 : 0));

      const result = await operationsService.bulkDeleteShows(7, [3, 4], requestUser());

      expect(result).toEqual({ completed: 1, failed: 1, skipped: 0 });
      expect(jobs.enqueueDestructive).toHaveBeenCalledTimes(1);
      expect(jobs.enqueueDestructive).toHaveBeenCalledWith(expect.objectContaining({ podcastId: 4 }), [4]);
    });

    it('verifies library ownership before touching anything', async () => {
      libraries.verifyUserAccessLevel.mockRejectedValueOnce(new Error('Forbidden'));

      await expect(operationsService.bulkDeleteShows(7, [3], requestUser())).rejects.toThrow('Forbidden');
      expect(repo.findPodcastsInLibrary).not.toHaveBeenCalled();
      expect(jobs.enqueueDestructive).not.toHaveBeenCalled();
    });

    it('sums the disk cost of the selection so one confirmation can name it', async () => {
      repo.findPodcastsInLibrary.mockResolvedValue([
        { id: 3, archivedAt: null },
        { id: 4, archivedAt: null },
      ]);
      repo.getPodcastMediaStats.mockResolvedValueOnce({ files: 2, bytes: 2048 }).mockResolvedValueOnce({ files: 1, bytes: 1024 });

      const preview = await operationsService.getBulkPurgePreview(7, [3, 4], requestUser());

      expect(preview).toEqual({ shows: 2, files: 3, bytes: 3072 });
    });

    it('reports an empty preview when the library holds none of the named shows', async () => {
      repo.findPodcastsInLibrary.mockResolvedValue([]);

      const preview = await operationsService.getBulkPurgePreview(7, [999], requestUser());

      expect(preview).toEqual({ shows: 0, files: 0, bytes: 0 });
      expect(repo.getPodcastMediaStats).not.toHaveBeenCalled();
    });
  });

  it('requires both podcasts to stay archived while merging', async () => {
    repo.findPodcast
      .mockResolvedValueOnce({ id: 3, libraryId: 7, archivedAt: new Date() })
      .mockResolvedValueOnce({ id: 4, libraryId: 7, archivedAt: null });

    await expect(operationsService.enqueueMerge(3, 4, requestUser())).rejects.toThrow('Archive both podcasts before merging them');

    repo.findPodcast
      .mockResolvedValueOnce({ id: 3, libraryId: 7, archivedAt: new Date() })
      .mockResolvedValueOnce({ id: 4, libraryId: 7, archivedAt: new Date() });
    jobs.cancelPodcastWork.mockResolvedValue(0);
    await operationsService.enqueueMerge(3, 4, requestUser());

    expect(jobs.cancelPodcastWork).toHaveBeenLastCalledWith([3, 4]);
    expect(jobs.enqueueDestructive).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'merge', podcastId: 3, payload: { sourcePodcastId: 4 } }),
      [3, 4],
    );
  });

  it('waits for an active episode download before removing its local file', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(100));
    jobs.cancelEpisodeDownload.mockResolvedValue({ processing: 1, cancelledBatchIds: [] });

    await expect(operationsService.removeDownload(11, requestUser())).rejects.toThrow('Podcast download is still stopping');
    expect(storage.removeEpisodeDownload).not.toHaveBeenCalled();

    jobs.cancelEpisodeDownload.mockResolvedValue({
      processing: 0,
      cancelledBatchIds: ['0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115'],
    });
    repo.countLocalOriginDownloads.mockResolvedValue(0);
    await operationsService.removeDownload(11, requestUser());
    expect(storage.removeEpisodeDownload).toHaveBeenCalledWith(11);
    expect(gateway.emitDownloadComplete).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: '0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115', jobStatus: 'cancelled' }),
    );
  });

  it('validates archive state again before a purge executes', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, archivedAt: null });

    await expect(operationsService.processPurge(3)).rejects.toThrow('Podcast must remain archived');
    expect(storage.purgePodcastFiles).not.toHaveBeenCalled();
    expect(repo.deletePodcast).not.toHaveBeenCalled();
  });

  it('treats an already removed purge target as an idempotent success', async () => {
    repo.findPodcast.mockResolvedValue(null);

    await expect(operationsService.processPurge(3)).resolves.toBeUndefined();
    expect(storage.purgePodcastFiles).not.toHaveBeenCalled();
  });

  it('validates archive state again before a merge executes', async () => {
    repo.findPodcast
      .mockResolvedValueOnce({ id: 3, libraryId: 7, archivedAt: new Date() })
      .mockResolvedValueOnce({ id: 4, libraryId: 7, archivedAt: null });

    await expect(operationsService.processMerge(3, { sourcePodcastId: 4 })).rejects.toThrow('Podcasts must remain archived');
    expect(repo.mergePodcastInto).not.toHaveBeenCalled();
  });

  it('queues a local file import with the dry-run flag and any review decisions', async () => {
    repo.findPodcastLibrary.mockResolvedValue({ id: 7, type: 'podcasts' });

    await expect(
      operationsService.enqueueImportScan(7, { dryRun: false, resolutions: [{ path: 'show/one.mp3', episodeId: 55 }] } as never, requestUser()),
    ).resolves.toEqual({ jobId: 41 });

    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'import_scan',
        dedupeKey: 'import_scan:7',
        libraryId: 7,
        payload: { dryRun: false, resolutions: [{ path: 'show/one.mp3', episodeId: 55 }] },
      }),
    );
  });

  it('refuses a second import while one is already running for the library', async () => {
    repo.findPodcastLibrary.mockResolvedValue({ id: 7, type: 'podcasts' });
    jobs.enqueue.mockResolvedValue(null);

    await expect(operationsService.enqueueImportScan(7, { dryRun: true } as never, requestUser())).rejects.toThrow('already running');
  });

  it('rejects an import narrowed to a podcast from another library', async () => {
    repo.findPodcastLibrary.mockResolvedValue({ id: 7, type: 'podcasts' });
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 9 });

    await expect(operationsService.enqueueImportScan(7, { dryRun: true, podcastId: 3 } as never, requestUser())).rejects.toThrow('Podcast not found');
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('returns the last import job together with the report it stored', async () => {
    repo.findPodcastLibrary.mockResolvedValue({ id: 7, type: 'podcasts' });
    jobs.findLatestByType.mockResolvedValue({
      id: 12,
      status: 'completed',
      payload: { dryRun: true, report: { libraryId: 7, attached: 0 } },
      progressCurrent: 3,
      progressTotal: 3,
      lastError: null,
      createdAt: new Date('2026-07-31T10:00:00.000Z'),
      updatedAt: new Date('2026-07-31T10:00:04.000Z'),
    });

    await expect(operationsService.getLatestImportScan(7)).resolves.toEqual({
      job: {
        id: 12,
        status: 'completed',
        dryRun: true,
        progressCurrent: 3,
        progressTotal: 3,
        lastError: null,
        createdAt: '2026-07-31T10:00:00.000Z',
        updatedAt: '2026-07-31T10:00:04.000Z',
      },
      report: { libraryId: 7, attached: 0 },
    });
  });

  it('reports no import history before a library has ever been scanned', async () => {
    repo.findPodcastLibrary.mockResolvedValue({ id: 7, type: 'podcasts' });
    jobs.findLatestByType.mockResolvedValue(null);

    await expect(operationsService.getLatestImportScan(7)).resolves.toEqual({ job: null, report: null });
  });
});

function refreshablePodcast(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    libraryId: 7,
    origin: 'feed',
    title: 'Orbit Radio',
    archivedAt: null,
    imageUrlEncrypted: 'encrypted-artwork',
    feedUrlEncrypted: 'encrypted-feed-url',
    etag: null,
    lastModified: null,
    acquisitionPolicy: 'remote_only',
    ...overrides,
  };
}

function fetchResult(overrides: Record<string, unknown> = {}) {
  return {
    feed: { title: 'Orbit Radio', episodes: [] },
    xml: '<rss/>',
    finalUrl: 'https://example.com/feed.xml',
    etag: null,
    lastModified: null,
    notModified: false,
    status: 200,
    ...overrides,
  };
}

function episodeContext(durationSeconds: number, episode: Record<string, unknown> = {}) {
  return {
    episode: { id: 11, origin: 'feed', durationSeconds, lockedFields: [], inFeed: true, ...episode },
    podcast: { id: 3, libraryId: 7 },
    media: null,
    state: null,
    queuedEpisodeId: null,
  };
}

function requestUser(): RequestUser {
  return {
    id: 5,
    username: 'listener',
    isSuperuser: false,
    permissions: [],
  } as RequestUser;
}
