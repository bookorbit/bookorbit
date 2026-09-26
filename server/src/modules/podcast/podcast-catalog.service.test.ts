import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { PodcastCatalogService, pulledInRefreshSchedule } from './podcast-catalog.service';
import { PodcastOperationsService } from './podcast-operations.service';
import { PodcastPlaybackService } from './podcast-playback.service';

describe('PodcastCatalogService', () => {
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

  it('searches the directory only for a user who can add a feed somewhere', async () => {
    await catalogService.searchDirectory(requestUser(), { q: 'orbit', limit: 10 });

    expect(repo.hasManageablePodcastLibrary).toHaveBeenCalledWith(5);
    expect(directory.search).toHaveBeenCalledWith('orbit', 10);
  });

  it('refuses directory search when no podcast library is manageable', async () => {
    repo.hasManageablePodcastLibrary.mockResolvedValue(false);

    await expect(catalogService.searchDirectory(requestUser(), { q: 'orbit', limit: 10 })).rejects.toThrow('No podcast library access');
    expect(directory.search).not.toHaveBeenCalled();
  });

  it('lets a superuser search without a library access row', async () => {
    await catalogService.searchDirectory({ ...requestUser(), isSuperuser: true }, { q: 'orbit', limit: 10 });

    expect(repo.hasManageablePodcastLibrary).not.toHaveBeenCalled();
    expect(directory.search).toHaveBeenCalledWith('orbit', 10);
  });

  it('marks the directory rows the caller already follows, matching aliases as well as origin feeds', async () => {
    directory.search.mockResolvedValue([directoryEntry('https://a.example/feed.xml'), directoryEntry('https://b.example/feed.xml')]);
    secrets.hashUrl.mockImplementation((url: string) => `hash:${url}`);
    repo.findPodcastIdsByFeedHashes.mockResolvedValue([{ feedHash: 'hash:https://b.example/feed.xml', podcastId: 31, libraryId: 5 }]);

    const results = await catalogService.searchDirectory(requestUser(), { q: 'orbit', limit: 10 });

    expect(repo.findPodcastIdsByFeedHashes).toHaveBeenCalledWith(['hash:https://a.example/feed.xml', 'hash:https://b.example/feed.xml'], [5]);
    expect(results).toEqual([
      expect.objectContaining({ feedUrl: 'https://a.example/feed.xml', existingPodcastId: null, existingLibraryId: null }),
      expect.objectContaining({ feedUrl: 'https://b.example/feed.xml', existingPodcastId: 31, existingLibraryId: 5 }),
    ]);
  });

  it('keeps the subscription annotation out of the shared directory cache', async () => {
    const cached = [directoryEntry('https://a.example/feed.xml')];
    directory.search.mockResolvedValue(cached);
    repo.findPodcastIdsByFeedHashes.mockResolvedValue([{ feedHash: 'feed-hash', podcastId: 31, libraryId: 5 }]);

    const results = await catalogService.searchDirectory(requestUser(), { q: 'orbit', limit: 10 });

    expect(results[0]).toMatchObject({ existingPodcastId: 31 });
    expect(cached[0]).not.toHaveProperty('existingPodcastId');
  });

  it('scopes the subscription lookup to every library for a superuser', async () => {
    directory.search.mockResolvedValue([directoryEntry('https://a.example/feed.xml')]);

    await catalogService.searchDirectory({ ...requestUser(), isSuperuser: true }, { q: 'orbit', limit: 10 });

    expect(libraries.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(repo.findPodcastIdsByFeedHashes).toHaveBeenCalledWith(['feed-hash'], undefined);
  });

  it('leaves a directory row unannotated when its feed URL cannot be hashed', async () => {
    directory.search.mockResolvedValue([directoryEntry('not-a-url')]);
    secrets.hashUrl.mockImplementation(() => {
      throw new TypeError('Invalid URL');
    });

    const results = await catalogService.searchDirectory(requestUser(), { q: 'orbit', limit: 10 });

    expect(repo.findPodcastIdsByFeedHashes).toHaveBeenCalledWith([], [5]);
    expect(results[0]).toMatchObject({ existingPodcastId: null, existingLibraryId: null });
  });

  it('requires editor access for feed configuration updates', async () => {
    repo.findPodcast.mockResolvedValue({
      id: 3,
      libraryId: 7,
      acquisitionPolicy: 'manual',
      autoDownloadLimit: null,
      autoDownloadWindowDays: null,
      refreshIntervalMinutes: 60,
      lastRefreshAt: null,
      // Already sooner than the new cadence would put it, so the schedule is left alone here.
      nextRefreshAt: new Date(Date.now() + 60_000),
    });
    repo.updatePodcast.mockResolvedValue({ id: 3 });

    await catalogService.updatePodcastConfig(3, { acquisitionPolicy: 'remote_only', refreshIntervalMinutes: 120 }, requestUser());

    expect(libraries.verifyUserAccessLevel).toHaveBeenCalledWith(5, 7, false, 'editor');
    expect(repo.updatePodcast).toHaveBeenCalledWith(3, { acquisitionPolicy: 'remote_only', refreshIntervalMinutes: 120 });
  });

  it('pulls the pending refresh in when the cadence is shortened', async () => {
    repo.findPodcast.mockResolvedValue({
      id: 3,
      libraryId: 7,
      origin: 'feed',
      acquisitionPolicy: 'manual',
      autoDownloadLimit: null,
      autoDownloadWindowDays: null,
      refreshIntervalMinutes: 60,
      lastRefreshAt: new Date(Date.now() - 10 * 60_000),
      nextRefreshAt: new Date(Date.now() + 50 * 60_000),
    });
    repo.updatePodcast.mockResolvedValue({ id: 3 });

    await catalogService.updatePodcastConfig(3, { refreshIntervalMinutes: 15 }, requestUser());

    const [, values] = repo.updatePodcast.mock.calls.at(-1)!;
    expect(values.refreshIntervalMinutes).toBe(15);
    expect(values.nextRefreshAt).toBeInstanceOf(Date);
    expect((values.nextRefreshAt as Date).getTime()).toBeLessThan(Date.now() + 6 * 60_000);
  });

  it('backfills eligible existing episodes when automatic downloads are enabled', async () => {
    const existingPodcast = {
      id: 3,
      libraryId: 7,
      acquisitionPolicy: 'remote_only',
      autoDownloadLimit: null,
      autoDownloadWindowDays: null,
    };
    const updatedPodcast = {
      id: 3,
      libraryId: 7,
      acquisitionPolicy: 'newest',
      autoDownloadLimit: 2,
      autoDownloadWindowDays: null,
      refreshIntervalMinutes: 60,
    };
    repo.findPodcast.mockResolvedValueOnce(existingPodcast).mockResolvedValueOnce(updatedPodcast);
    repo.updatePodcast.mockResolvedValue(updatedPodcast);
    repo.findNewestEpisodeIds.mockResolvedValue([
      { id: 11, publishedAt: new Date() },
      { id: 12, publishedAt: new Date() },
    ]);
    repo.filterDownloadableEpisodeIds.mockResolvedValue([12]);
    jobs.enqueueMany.mockResolvedValue([{ id: 51, episodeId: 12 }]);

    await catalogService.updatePodcastConfig(3, { acquisitionPolicy: 'newest', autoDownloadLimit: 2 }, requestUser());

    expect(jobs.enqueueMany).toHaveBeenCalledWith([expect.objectContaining({ type: 'download', episodeId: 12, payload: { automatic: true } })]);
    expect(repo.markMediaQueued).toHaveBeenCalledWith([12]);
  });

  it('rejects podcast titles that become empty after trimming', async () => {
    await expect(catalogService.updatePodcastMetadata(3, { title: '   ' }, requestUser())).rejects.toThrow('Podcast title cannot be empty');
    expect(repo.updatePodcast).not.toHaveBeenCalled();
  });

  it('locks every edited metadata field so the next refresh cannot overwrite it', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, lockedFields: ['imageUrl'] });
    repo.updatePodcast.mockImplementation((_: number, values: Record<string, unknown>) => Promise.resolve({ id: 3, ...values }));

    await catalogService.updatePodcastMetadata(
      3,
      { title: '  Orbit Radio  ', siteUrl: 'https://orbit.example/show ', explicit: true, categories: ['News', ' news ', ''] },
      requestUser(),
    );

    expect(repo.updatePodcast).toHaveBeenCalledWith(3, {
      title: 'Orbit Radio',
      siteUrl: 'https://orbit.example/show',
      explicit: true,
      categories: ['News'],
      lockedFields: ['title', 'imageUrl', 'siteUrl', 'explicit', 'categories'],
    });
  });

  it('treats an explicit lock set as the final set before the edited fields are added', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, lockedFields: ['title', 'author', 'language'] });
    repo.updatePodcast.mockImplementation((_: number, values: Record<string, unknown>) => Promise.resolve({ id: 3, ...values }));

    await catalogService.updatePodcastMetadata(3, { author: 'Orbit Media', lockedFields: ['language'] }, requestUser());

    expect(repo.updatePodcast).toHaveBeenCalledWith(3, { author: 'Orbit Media', lockedFields: ['author', 'language'] });
  });

  it('records custom artwork with a cache-busting url and clears it on removal', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, lockedFields: [] });
    const uploadedAt = new Date('2026-07-31T10:00:00.000Z');
    repo.updatePodcast.mockResolvedValue({ id: 3, imageUrlEncrypted: 'encrypted-feed-artwork', customArtworkAt: uploadedAt });

    const uploaded = await catalogService.uploadPodcastArtwork(3, Buffer.from('bytes'), requestUser());

    expect(artwork.saveCustomArtwork).toHaveBeenCalledWith(3, Buffer.from('bytes'));
    expect(repo.updatePodcast).toHaveBeenCalledWith(3, { customArtworkAt: expect.any(Date) });
    expect(uploaded).toEqual({
      id: 3,
      imageUrl: `/api/v1/podcasts/3/artwork?v=${uploadedAt.getTime()}`,
      artworkUpdatedAt: uploadedAt.toISOString(),
    });

    repo.updatePodcast.mockResolvedValue({ id: 3, imageUrlEncrypted: 'encrypted-feed-artwork', customArtworkAt: null });

    await expect(catalogService.deletePodcastArtwork(3, requestUser())).resolves.toEqual({
      id: 3,
      imageUrl: '/api/v1/podcasts/3/artwork',
      artworkUpdatedAt: null,
    });
    expect(artwork.removeCustomArtwork).toHaveBeenCalledWith(3);
  });

  it('fetches artwork from a url through the guarded podcast fetch path', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, lockedFields: [] });
    repo.updatePodcast.mockResolvedValue({ id: 3, imageUrlEncrypted: null, customArtworkAt: new Date('2026-07-31T10:00:00.000Z') });
    secrets.redactUrl.mockReturnValue('https://cdn.example/artwork.png');

    await catalogService.uploadPodcastArtworkFromUrl(3, 'https://cdn.example/artwork.png', requestUser());

    expect(artwork.fetchArtworkFromUrl).toHaveBeenCalledWith('https://cdn.example/artwork.png');
    expect(artwork.saveCustomArtwork).toHaveBeenCalledWith(3, Buffer.from('artwork'));
  });

  it('does not restore a podcast while destructive work is active', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, archivedAt: new Date() });
    jobs.hasActiveDestructiveWork.mockResolvedValue(true);

    await expect(catalogService.archivePodcast(3, requestUser(), false)).rejects.toThrow('queued podcast purge or merge');
    expect(repo.archivePodcast).not.toHaveBeenCalled();
  });
});

function requestUser(): RequestUser {
  return {
    id: 5,
    username: 'listener',
    isSuperuser: false,
    permissions: [],
  } as RequestUser;
}

function directoryEntry(feedUrl: string) {
  return { title: 'Orbit Radio', author: 'Orbit', feedUrl, artworkUrl: null, genre: null };
}

describe('pulledInRefreshSchedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const lastRefreshAt = new Date('2026-08-05T16:15:00.000Z');

  it('pulls a shortened cadence in to one interval after the last refresh', () => {
    vi.setSystemTime(new Date('2026-08-05T16:28:00.000Z'));
    const next = pulledInRefreshSchedule({ refreshIntervalMinutes: 60, lastRefreshAt, nextRefreshAt: new Date('2026-08-05T17:15:00.000Z') }, 30);
    expect(next).toEqual(new Date('2026-08-05T16:45:00.000Z'));
  });

  it('never schedules in the past, so saving a setting is not itself a fetch', () => {
    vi.setSystemTime(new Date('2026-08-05T16:28:00.000Z'));
    const next = pulledInRefreshSchedule({ refreshIntervalMinutes: 60, lastRefreshAt, nextRefreshAt: new Date('2026-08-05T17:15:00.000Z') }, 5);
    expect(next).toEqual(new Date('2026-08-05T16:28:00.000Z'));
  });

  it('leaves a lengthened cadence to take effect after the pending sweep', () => {
    vi.setSystemTime(new Date('2026-08-05T16:28:00.000Z'));
    expect(
      pulledInRefreshSchedule({ refreshIntervalMinutes: 60, lastRefreshAt, nextRefreshAt: new Date('2026-08-05T17:15:00.000Z') }, 1440),
    ).toBeUndefined();
  });

  it('does nothing when the cadence is absent or unchanged', () => {
    const podcast = { refreshIntervalMinutes: 60, lastRefreshAt, nextRefreshAt: new Date('2026-08-05T17:15:00.000Z') };
    expect(pulledInRefreshSchedule(podcast, undefined)).toBeUndefined();
    expect(pulledInRefreshSchedule(podcast, 60)).toBeUndefined();
  });

  it('measures from now for a show that has never refreshed', () => {
    vi.setSystemTime(new Date('2026-08-05T16:28:00.000Z'));
    const next = pulledInRefreshSchedule(
      { refreshIntervalMinutes: 60, lastRefreshAt: null, nextRefreshAt: new Date('2026-08-05T20:00:00.000Z') },
      30,
    );
    expect(next).toEqual(new Date('2026-08-05T16:58:00.000Z'));
  });
});
