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

describe('PodcastPlaybackService', () => {
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
  let playbackService: PodcastPlaybackService;

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
    playbackService = module.get(PodcastPlaybackService);
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

  it('derives progress and completes near the end', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(100));
    repo.getLibrarySettings.mockResolvedValue({ completionRemainingSeconds: 10 });
    repo.upsertEpisodeState.mockImplementation((_userId, _episodeId, values) => values);

    await playbackService.updateEpisodeState(11, requestUser(), { positionSeconds: 95, progressPercent: 95 });

    expect(libraries.verifyUserAccessLevel).toHaveBeenCalledWith(5, 7, false, 'viewer');
    expect(repo.upsertEpisodeState).toHaveBeenCalledWith(
      5,
      11,
      expect.objectContaining({ positionSeconds: 95, progressPercent: 95, finished: true }),
      undefined,
    );
  });

  /**
   * A player cannot seek past the media it loaded, so a position beyond the declared duration means
   * the declaration is short: shows with dynamically inserted ads ship files minutes longer than the
   * feed's tag. Truncating to the tag used to discard the listener's real place and store it as 100%
   * complete, which sent the next load back to the start of the episode.
   */
  it('keeps a position past the declared duration and leaves the percent to the player', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(100));
    repo.getLibrarySettings.mockResolvedValue({ completionRemainingSeconds: 10 });
    repo.upsertEpisodeState.mockImplementation((_userId, _episodeId, values) => values);

    await playbackService.updateEpisodeState(11, requestUser(), { positionSeconds: 120, progressPercent: 40 });

    expect(repo.upsertEpisodeState).toHaveBeenCalledWith(
      5,
      11,
      expect.objectContaining({ positionSeconds: 120, progressPercent: 40, finished: undefined }),
      undefined,
    );
  });

  it('resets progress when an episode is marked unplayed', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(100));
    repo.getLibrarySettings.mockResolvedValue({ completionRemainingSeconds: 10 });

    await playbackService.updateEpisodeState(11, requestUser(), { finished: false });

    expect(repo.upsertEpisodeState).toHaveBeenCalledWith(
      5,
      11,
      expect.objectContaining({ positionSeconds: 0, progressPercent: 0, finished: false, finishedAt: null }),
      undefined,
    );
  });

  it('sets full progress and the duration when an episode is marked played', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(100));
    repo.getLibrarySettings.mockResolvedValue({ completionRemainingSeconds: 10 });

    await playbackService.updateEpisodeState(11, requestUser(), { finished: true });

    expect(repo.upsertEpisodeState).toHaveBeenCalledWith(
      5,
      11,
      expect.objectContaining({ positionSeconds: 100, progressPercent: 100, finished: true, finishedAt: expect.any(Date) }),
      undefined,
    );
  });

  it('rejects empty episode state updates', async () => {
    await expect(playbackService.updateEpisodeState(11, requestUser(), {})).rejects.toThrow('Podcast episode state update is empty');
    expect(repo.findEpisodeForUser).not.toHaveBeenCalled();
  });

  it('does not auto-complete an episode with a zero duration', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(0));
    repo.getLibrarySettings.mockResolvedValue({ completionRemainingSeconds: 60 });

    await playbackService.updateEpisodeState(11, requestUser(), { positionSeconds: 0 });

    expect(repo.upsertEpisodeState).toHaveBeenCalledWith(5, 11, expect.objectContaining({ finished: undefined }), undefined);
  });

  it('forwards capturedAt as the stale-write guard and never as a stored column', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(100));
    repo.getLibrarySettings.mockResolvedValue({ completionRemainingSeconds: 10 });

    await playbackService.updateEpisodeState(11, requestUser(), { positionSeconds: 30, capturedAt: '2026-07-29T10:00:00.000Z' });

    const [, , values, notOlderThan] = repo.upsertEpisodeState.mock.calls.at(-1)!;
    expect(values).not.toHaveProperty('capturedAt');
    expect(notOlderThan).toEqual(new Date('2026-07-29T10:00:00.000Z'));
  });

  it('rejects a state update carrying only capturedAt', async () => {
    await expect(playbackService.updateEpisodeState(11, requestUser(), { capturedAt: '2026-07-29T10:00:00.000Z' })).rejects.toThrow(
      'Podcast episode state update is empty',
    );
    expect(repo.findEpisodeForUser).not.toHaveBeenCalled();
  });

  it('returns batch episode states scoped to accessible libraries', async () => {
    libraries.findAccessibleLibraryIds.mockResolvedValue([7]);
    repo.listEpisodeStates.mockResolvedValue([
      {
        episodeId: 11,
        positionSeconds: 42.5,
        progressPercent: 12,
        finished: false,
        finishedAt: null,
        pinned: false,
        lastListenedAt: new Date('2026-07-29T09:00:00.000Z'),
        updatedAt: new Date('2026-07-29T09:30:00.000Z'),
      },
    ]);

    const rows = await playbackService.listEpisodeStates(requestUser(), [11, 11, 12]);

    expect(repo.listEpisodeStates).toHaveBeenCalledWith(5, [11, 12], [7]);
    expect(rows).toEqual([
      {
        episodeId: 11,
        positionSeconds: 42.5,
        progressPercent: 12,
        finished: false,
        finishedAt: null,
        pinned: false,
        lastListenedAt: '2026-07-29T09:00:00.000Z',
        updatedAt: '2026-07-29T09:30:00.000Z',
      },
    ]);
  });

  it('skips the library lookup for an empty batch state request', async () => {
    await expect(playbackService.listEpisodeStates(requestUser(), [])).resolves.toEqual([]);
    expect(libraries.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(repo.listEpisodeStates).not.toHaveBeenCalled();
  });

  it('scopes continue listening to the libraries the user can reach', async () => {
    libraries.findAccessibleLibraryIds.mockResolvedValue([7, 9]);
    repo.listContinueListening.mockResolvedValue([]);

    await playbackService.listContinueListening(requestUser(), { size: 10 });

    expect(repo.listContinueListening).toHaveBeenCalledWith(5, 10, [7, 9]);
  });

  it('reads continue listening unfiltered for a superuser', async () => {
    repo.listContinueListening.mockResolvedValue([]);

    await playbackService.listContinueListening({ ...requestUser(), isSuperuser: true }, { size: 25 });

    expect(libraries.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(repo.listContinueListening).toHaveBeenCalledWith(5, 25, undefined);
  });

  it('reads batch states unfiltered for a superuser', async () => {
    repo.listEpisodeStates.mockResolvedValue([]);

    await playbackService.listEpisodeStates({ ...requestUser(), isSuperuser: true }, [11]);

    expect(repo.listEpisodeStates).toHaveBeenCalledWith(5, [11], undefined);
  });

  it('uses bounded queue neighbors as playback navigation when the episode is queued', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(100));
    repo.findEpisodeSummary.mockResolvedValue(episodeSummary(11));
    repo.findQueuePlaybackContext.mockResolvedValue({
      position: 3,
      total: 42,
      previous: episodeSummary(10),
      upcoming: [episodeSummary(12)],
    });
    libraries.findAccessibleLibraryIds.mockResolvedValue([7]);

    const result = await playbackService.getPlaybackContext(11, requestUser());

    expect(result.navigation).toEqual({ source: 'queue', previous: expect.objectContaining({ id: 10 }), next: expect.objectContaining({ id: 12 }) });
    expect(repo.findQueuePlaybackContext).toHaveBeenCalledWith(5, 11, [7]);
  });

  it('falls back to adjacent podcast episodes when the current episode is not queued', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(100));
    repo.findEpisodeSummary.mockResolvedValue(episodeSummary(11));
    repo.findQueuePlaybackContext.mockResolvedValue({ position: null, total: 0, previous: null, upcoming: [] });
    repo.findAdjacentEpisodeSummaries.mockResolvedValue({ previous: episodeSummary(10), next: episodeSummary(12) });
    libraries.findAccessibleLibraryIds.mockResolvedValue([7]);

    const result = await playbackService.getPlaybackContext(11, requestUser());

    expect(result.navigation).toEqual({
      source: 'podcast',
      previous: expect.objectContaining({ id: 10 }),
      next: expect.objectContaining({ id: 12 }),
    });
    expect(repo.findAdjacentEpisodeSummaries).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), 5);
  });

  it('limits queue reordering to libraries the current user can access', async () => {
    libraries.findAccessibleLibraryIds.mockResolvedValue([7, 9]);

    await playbackService.reorderQueue(requestUser(), { episodeIds: [12, 11] });

    expect(repo.reorderQueue).toHaveBeenCalledWith(5, [12, 11], [7, 9]);
  });

  it('limits a single queue move to libraries the current user can access', async () => {
    libraries.findAccessibleLibraryIds.mockResolvedValue([7, 9]);

    await playbackService.moveQueueItem(requestUser(), { episodeId: 12, position: 0 });

    expect(repo.moveQueueItem).toHaveBeenCalledWith(5, 12, 0, [7, 9]);
  });

  it('rejects a move of an episode that is no longer queued', async () => {
    libraries.findAccessibleLibraryIds.mockResolvedValue([7]);
    repo.moveQueueItem.mockResolvedValue(false);

    await expect(playbackService.moveQueueItem(requestUser(), { episodeId: 12, position: 3 })).rejects.toThrow(
      'The episode is no longer in the queue',
    );
  });

  it('moves without a library filter for a superuser', async () => {
    await playbackService.moveQueueItem({ ...requestUser(), isSuperuser: true }, { episodeId: 12, position: 2 });

    expect(libraries.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(repo.moveQueueItem).toHaveBeenCalledWith(5, 12, 2, undefined);
  });

  it('clears only the current user podcast queue and returns the pre-clear order', async () => {
    repo.clearQueue.mockResolvedValue({ removed: 3, previousEpisodeIds: [12, 11, 10] });

    await expect(playbackService.clearQueue(requestUser())).resolves.toEqual({ removed: 3, previousEpisodeIds: [12, 11, 10] });

    expect(repo.clearQueue).toHaveBeenCalledWith(5);
  });

  it('clears finished episodes from only the current user podcast queue and returns the pre-clear order', async () => {
    repo.clearFinishedQueue.mockResolvedValue({ removed: 2, previousEpisodeIds: [12, 11, 10] });

    await expect(playbackService.clearFinishedQueue(requestUser())).resolves.toEqual({ removed: 2, previousEpisodeIds: [12, 11, 10] });

    expect(repo.clearFinishedQueue).toHaveBeenCalledWith(5);
  });

  it('limits queue restoration to libraries the current user can access', async () => {
    libraries.findAccessibleLibraryIds.mockResolvedValue([7, 9]);
    repo.restoreQueue.mockResolvedValue(2);

    await expect(playbackService.restoreQueue(requestUser(), { episodeIds: [12, 11] })).resolves.toEqual({ restored: 2 });

    expect(repo.restoreQueue).toHaveBeenCalledWith(5, [12, 11], [7, 9]);
  });

  it('queues all show episodes and returns the first episode for inline playback', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, archivedAt: null });
    repo.addPodcastEpisodesToQueue.mockResolvedValue({ added: 8, skipped: 2, firstEpisodeId: 42 });

    await expect(playbackService.queueAllPodcastEpisodes(3, requestUser())).resolves.toEqual({
      completed: 8,
      failed: 0,
      skipped: 2,
      firstEpisodeId: 42,
    });

    expect(repo.addPodcastEpisodesToQueue).toHaveBeenCalledWith(5, 3);
    expect(libraries.verifyUserAccessLevel).toHaveBeenCalledWith(5, 7, false, 'viewer');
  });

  it('queues the episodes a playlist matches, bounded by the requested limit', async () => {
    repo.findPodcastLibrary.mockResolvedValue({ id: 7, name: 'Podcasts' });
    repo.addQueryEpisodesToQueue.mockResolvedValue({ added: 40, skipped: 12, firstEpisodeId: 91 });

    await expect(
      playbackService.queueEpisodesFromRules(7, requestUser(), {
        filter: 'unplayed',
        sort: 'newest',
        maxDurationMinutes: 20,
        followedOnly: false,
        limit: 100,
      }),
    ).resolves.toEqual({ completed: 40, failed: 0, skipped: 12, firstEpisodeId: 91 });

    expect(repo.addQueryEpisodesToQueue).toHaveBeenCalledWith(
      5,
      7,
      { filter: 'unplayed', sort: 'newest', maxDurationMinutes: 20, followedOnly: false },
      100,
    );
  });

  it('rejects playlist queueing for a library that is not a podcast library', async () => {
    repo.findPodcastLibrary.mockResolvedValue(null);

    await expect(
      playbackService.queueEpisodesFromRules(7, requestUser(), { filter: 'latest', sort: 'newest', followedOnly: false, limit: 100 }),
    ).rejects.toThrow('Podcast Library not found');

    expect(repo.addQueryEpisodesToQueue).not.toHaveBeenCalled();
  });

  it('marks every show episode played for only the current user', async () => {
    repo.findPodcast.mockResolvedValue({ id: 3, libraryId: 7, archivedAt: null });
    repo.markPodcastEpisodesFinished.mockResolvedValue(12);

    await expect(playbackService.markAllPodcastEpisodesPlayed(3, requestUser())).resolves.toEqual({
      completed: 12,
      failed: 0,
      skipped: 0,
    });

    expect(repo.markPodcastEpisodesFinished).toHaveBeenCalledWith(5, 3);
  });

  it('updates only the current user bookmark and normalizes an empty note', async () => {
    repo.findBookmarkAccess.mockResolvedValue({ libraryId: 7 });
    repo.updateBookmark.mockResolvedValue({
      id: 9,
      userId: 5,
      episodeId: 42,
      positionSeconds: 120,
      title: 'Key point',
      note: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await playbackService.updateBookmark(9, requestUser(), { title: ' Key point ', note: '  ' });

    expect(repo.updateBookmark).toHaveBeenCalledWith(5, 9, { title: 'Key point', note: null });
    expect(libraries.verifyUserAccessLevel).toHaveBeenCalledWith(5, 7, false, 'viewer');
  });

  it('revalidates library access before changing an existing bookmark', async () => {
    repo.findBookmarkAccess.mockResolvedValue({ libraryId: 7 });
    libraries.verifyUserAccessLevel.mockRejectedValueOnce(new Error('Library access denied'));

    await expect(playbackService.updateBookmark(9, requestUser(), { title: 'Changed' })).rejects.toThrow('Library access denied');

    expect(repo.updateBookmark).not.toHaveBeenCalled();
  });

  it('revalidates library access before deleting an existing bookmark', async () => {
    repo.findBookmarkAccess.mockResolvedValue({ libraryId: 7 });
    libraries.verifyUserAccessLevel.mockRejectedValueOnce(new Error('Library access denied'));

    await expect(playbackService.deleteBookmark(9, requestUser())).rejects.toThrow('Library access denied');

    expect(repo.deleteBookmark).not.toHaveBeenCalled();
  });

  it('rejects bookmark titles that become empty after trimming', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(100));

    await expect(playbackService.createBookmark(11, requestUser(), { positionSeconds: 1, title: '   ' })).rejects.toThrow(
      'Podcast bookmark title cannot be empty',
    );

    expect(repo.createBookmark).not.toHaveBeenCalled();
  });

  it('clamps listening session positions to the episode duration', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(100));

    await playbackService.createListeningSession(11, requestUser(), {
      sessionId: 'session-1',
      startedAt: '2026-07-11T12:00:00.000Z',
      endedAt: '2026-07-11T12:01:00.000Z',
      endPositionSeconds: 1000,
    });

    expect(repo.createListeningSession).toHaveBeenCalledWith(5, 11, 'session-1', expect.any(Date), expect.any(Date), 100);
  });

  it('rejects an empty episode metadata update and a title that becomes empty after trimming', async () => {
    await expect(playbackService.updateEpisodeMetadata(11, {}, requestUser())).rejects.toThrow('Podcast episode metadata update is empty');
    await expect(playbackService.updateEpisodeMetadata(11, { title: '   ' }, requestUser())).rejects.toThrow('Podcast episode title cannot be empty');
    expect(repo.findEpisodeForUser).not.toHaveBeenCalled();
    expect(repo.updateEpisodeMetadata).not.toHaveBeenCalled();
  });

  it('locks every edited episode field and sanitizes the description like a feed-sourced one', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(3600, { lockedFields: ['chapters'] }));
    repo.updateEpisodeMetadata.mockResolvedValue({ id: 11 });
    repo.findEpisodeSummary.mockResolvedValue(episodeSummary(11));

    await playbackService.updateEpisodeMetadata(
      11,
      {
        title: '  Orbital mechanics  ',
        description: '<p onclick="steal()">About <script>alert(1)</script>the launch</p>',
        season: ' 2 ',
        durationSeconds: 1800,
        explicit: true,
      },
      requestUser(),
    );

    expect(libraries.verifyUserAccessLevel).toHaveBeenCalledWith(5, 7, false, 'editor');
    expect(repo.updateEpisodeMetadata).toHaveBeenCalledWith(
      11,
      {
        title: 'Orbital mechanics',
        description: '<p>About the launch</p>',
        season: '2',
        durationSeconds: 1800,
        explicit: true,
      },
      ['title', 'description', 'season', 'durationSeconds', 'explicit', 'chapters'],
    );
  });

  it('treats an explicit episode lock set as the final set before the edited fields are added', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(3600, { lockedFields: ['title', 'subtitle', 'explicit'] }));
    repo.updateEpisodeMetadata.mockResolvedValue({ id: 11 });
    repo.findEpisodeSummary.mockResolvedValue(episodeSummary(11));

    await playbackService.updateEpisodeMetadata(11, { subtitle: 'Part one', lockedFields: ['explicit'] }, requestUser());

    expect(repo.updateEpisodeMetadata).toHaveBeenCalledWith(11, { subtitle: 'Part one' }, ['subtitle', 'explicit']);
  });

  it('edits an episode that has dropped out of the feed without touching its feed membership', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(3600, { inFeed: false }));
    repo.updateEpisodeMetadata.mockResolvedValue({ id: 11 });
    repo.findEpisodeSummary.mockResolvedValue(episodeSummary(11, { inFeed: false }));

    const updated = await playbackService.updateEpisodeMetadata(11, { title: 'Recovered back-catalogue title' }, requestUser());

    const [, values] = repo.updateEpisodeMetadata.mock.calls.at(-1)!;
    expect(values).not.toHaveProperty('inFeed');
    expect(updated.inFeed).toBe(false);
  });

  it('stores edited chapters in start order and drops blank titles', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(3600));
    repo.updateEpisodeMetadata.mockResolvedValue({ id: 11 });
    repo.findEpisodeSummary.mockResolvedValue(episodeSummary(11));

    await playbackService.updateEpisodeMetadata(
      11,
      {
        chapters: [
          { title: ' Outro ', startSeconds: 900 },
          { title: '  ', startSeconds: 60 },
          { title: 'Intro', startSeconds: 0, url: 'https://orbit.example/intro' },
        ],
      },
      requestUser(),
    );

    expect(repo.updateEpisodeMetadata).toHaveBeenCalledWith(
      11,
      {
        chapters: [
          { title: 'Intro', startSeconds: 0, url: 'https://orbit.example/intro' },
          { title: 'Outro', startSeconds: 900 },
        ],
      },
      ['chapters'],
    );
  });

  /**
   * This once clamped a reported position down to a shortened duration, to correct stored progress
   * left beyond a new end. It cannot: the same input is what a listener sends when the file simply
   * runs longer than the feed claims, and clamping there loses their place entirely. Stored progress
   * beyond a genuinely shortened episode belongs to whatever changes the duration, not to a write
   * carrying a position the player measured against real audio.
   */

  it('does not rewrite a reported position to a shorter declared duration', async () => {
    repo.findEpisodeForUser.mockResolvedValue(episodeContext(1800));
    repo.getLibrarySettings.mockResolvedValue({ completionRemainingSeconds: 10 });

    await playbackService.updateEpisodeState(11, requestUser(), { positionSeconds: 3400, progressPercent: 90 });

    expect(repo.upsertEpisodeState).toHaveBeenCalledWith(
      5,
      11,
      expect.objectContaining({ positionSeconds: 3400, progressPercent: 90, finished: undefined }),
      undefined,
    );
  });
});

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

function episodeSummary(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: `Episode ${id}`,
    subtitle: null,
    description: null,
    publishedAt: null,
    season: null,
    episode: null,
    episodeType: null,
    durationSeconds: 100,
    audioFormat: 'mp3',
    explicit: false,
    chapters: [],
    transcripts: [],
    inFeed: true,
    mediaStatus: 'remote',
    localSizeBytes: null,
    positionSeconds: 0,
    progressPercent: 0,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}
