vi.mock('../../common/utils/fs-stability.utils', () => ({
  waitForStability: vi.fn().mockResolvedValue(undefined),
}));

import { createHash } from 'crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PodcastImportReport } from '@bookorbit/types';
import type { PodcastJob } from '../../db/schema';
import { PodcastFileImportService } from './podcast-file-import.service';
import { localIdentityHash } from './podcast-import-files';
import { PodcastLocalShowImportService } from './podcast-local-show-import.service';
import type { PodcastFileTags, PodcastLocalFileProbe } from './podcast-tag-reader.service';

const identityHash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const sha256 = identityHash;

interface StubEpisode {
  episodeId: number;
  podcastId: number;
  podcastTitle: string;
  identityHash: string;
  title: string;
  publishedAt: Date | null;
  durationSeconds: number | null;
  enclosureUrlEncrypted: string;
  mediaStatus: string | null;
  checksum: string | null;
  localSizeBytes: number | null;
}

function stubEpisode(overrides: Partial<StubEpisode> = {}): StubEpisode {
  return {
    episodeId: 101,
    podcastId: 7,
    podcastTitle: 'Orbit Radio',
    identityHash: identityHash('guid-1'),
    title: 'Landing on the Moon',
    publishedAt: new Date('2026-03-04T09:00:00.000Z'),
    durationSeconds: 1800,
    enclosureUrlEncrypted: 'enc:https://cdn.example/orbit/landing.mp3',
    mediaStatus: 'remote',
    checksum: null,
    localSizeBytes: null,
    ...overrides,
  };
}

function job(overrides: Partial<PodcastJob> = {}): PodcastJob {
  return {
    id: 1,
    type: 'import_scan',
    dedupeKey: 'import_scan:5',
    libraryId: 5,
    podcastId: null,
    episodeId: null,
    requestedByUserId: 3,
    status: 'processing',
    payload: { dryRun: true },
    progressCurrent: 0,
    progressTotal: null,
    attemptCount: 1,
    nextAttemptAt: new Date(),
    leaseUntil: null,
    lastError: null,
    cancelRequested: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PodcastJob;
}

describe('podcast import services', () => {
  let root: string;
  let attachments: Array<{ episodeId: number; values: Record<string, unknown> }>;
  let episodes: StubEpisode[];
  let adoptedPaths: Array<{ episodeId: number; localPath: string }>;
  let tagsByFile: Map<string, PodcastFileTags>;
  let probesByFile: Map<string, PodcastLocalFileProbe>;
  let embeddedCover: Buffer | null;
  let localPodcast: Record<string, unknown> | null;
  let localEpisodes: Array<{ podcastId: number; episode: Record<string, unknown>; media: Record<string, unknown> }>;
  let restoredMedia: Array<{ podcastId: number; identityHash: string }>;
  let showMediaPaths: Array<{ episodeId: number; localPath: string }>;
  let insertResult: boolean;
  let quotaBytes: bigint;
  let usedBytes: bigint;
  let cancelled: boolean;
  let savedPayload: Record<string, unknown> | null;
  let registeredByFolder: Map<string, Record<string, unknown>>;
  let createdShows: Array<{ libraryId: number; folderPath: string; values: Record<string, unknown> }>;
  let activeLocalShows: Array<{ id: number; localFolderPath: string | null; missingAt: Date | null }>;
  let missingWrites: Array<{ podcastId: number; missing: boolean }>;
  let enqueueJobResult: number | null;
  let localRoots: string[];

  function tags(overrides: Partial<PodcastFileTags> = {}): PodcastFileTags {
    return {
      episodeGuid: null,
      feedUrl: null,
      title: null,
      album: null,
      artist: null,
      description: null,
      publishedAt: null,
      durationSeconds: null,
      podcastFlag: false,
      ...overrides,
    };
  }

  function buildService() {
    const repo = {
      findPrimaryLibraryFolder: vi.fn().mockResolvedValue(root),
      findLocalLibraryFolders: vi.fn().mockResolvedValue(localRoots),
      listAdoptedMediaPaths: vi.fn((_libraryId: number, afterEpisodeId: number) => Promise.resolve(afterEpisodeId === 0 ? adoptedPaths : [])),
      listPodcastsForImport: vi.fn().mockResolvedValue({
        shows: [{ id: 7, title: 'Orbit Radio', author: null, feedUrlHash: 'hash-orbit' }],
        aliases: [],
      }),
      findImportEpisodesByIdentityHashes: vi.fn((_libraryId: number, hashes: string[]) =>
        Promise.resolve(episodes.filter((episode) => hashes.includes(episode.identityHash))),
      ),
      findImportEpisodesByIds: vi.fn((_libraryId: number, ids: number[]) =>
        Promise.resolve(episodes.filter((episode) => ids.includes(episode.episodeId))),
      ),
      listImportEpisodesForPodcast: vi.fn((podcastId: number, afterEpisodeId: number) =>
        Promise.resolve(episodes.filter((episode) => episode.podcastId === podcastId && episode.episodeId > afterEpisodeId)),
      ),
      getLibrarySettings: vi.fn(() => Promise.resolve({ storageQuotaBytes: quotaBytes, usedStorageBytes: usedBytes })),
      findLocalPodcastIdsByFolders: vi.fn(() => Promise.resolve(new Map<string, number>())),
      findLocalPodcastByFolder: vi.fn((_libraryId: number, folderPath: string) => Promise.resolve(registeredByFolder.get(folderPath) ?? null)),
      createLocalPodcast: vi.fn((libraryId: number, folderPath: string, values: Record<string, unknown>) => {
        createdShows.push({ libraryId, folderPath, values });
        return Promise.resolve({ podcast: { id: 91, libraryId, origin: 'local', localFolderPath: folderPath, ...values }, created: true });
      }),
      findActiveLocalPodcasts: vi.fn((_libraryId: number, afterId: number) => Promise.resolve(afterId === 0 ? activeLocalShows : [])),
      setLocalPodcastMissing: vi.fn((podcastId: number, missing: boolean) => {
        const show = activeLocalShows.find((candidate) => candidate.id === podcastId);
        const changed = show ? Boolean(show.missingAt) !== missing : true;
        if (show) show.missingAt = missing ? new Date() : null;
        if (changed) missingWrites.push({ podcastId, missing });
        return Promise.resolve(changed);
      }),
      findPodcast: vi.fn(() => Promise.resolve(localPodcast)),
      updatePodcast: vi.fn(() => Promise.resolve(localPodcast)),
      listPodcastMediaPaths: vi.fn((_podcastId: number, afterEpisodeId: number) => Promise.resolve(afterEpisodeId === 0 ? showMediaPaths : [])),
      insertLocalEpisode: vi.fn((podcastId: number, episode: Record<string, unknown>, media: Record<string, unknown>) => {
        if (insertResult) localEpisodes.push({ podcastId, episode, media });
        return Promise.resolve(insertResult);
      }),
      restoreLocalEpisodeMedia: vi.fn((podcastId: number, identityHash: string) => {
        restoredMedia.push({ podcastId, identityHash });
        return Promise.resolve(true);
      }),
      attachImportedMedia: vi.fn((episodeId: number, values: Record<string, unknown>) => {
        const target = episodes.find((episode) => episode.episodeId === episodeId);
        if (target?.mediaStatus === 'local') return Promise.resolve(false);
        attachments.push({ episodeId, values });
        return Promise.resolve(true);
      }),
    };
    const jobs = {
      updateProgress: vi.fn().mockResolvedValue(undefined),
      isCancellationRequested: vi.fn(() => Promise.resolve(cancelled)),
      updatePayload: vi.fn((_id: number, payload: Record<string, unknown>) => {
        savedPayload = payload;
        return Promise.resolve();
      }),
      enqueue: vi.fn(() => Promise.resolve(enqueueJobResult)),
    };
    const secrets = {
      decrypt: (value: string) => value.replace(/^enc:/, ''),
      hashUrl: (value: string) => {
        if (!value.startsWith('http')) throw new Error('bad url');
        return value === 'https://feeds.example/orbit.xml' ? 'hash-orbit' : `hash-${value}`;
      },
    };
    const parser = { identityHash };
    const tagReader = {
      read: vi.fn((path: string) => Promise.resolve(tagsByFile.get(path) ?? null)),
      readForImport: vi.fn((path: string) => Promise.resolve(probesByFile.get(path) ?? null)),
      extractEmbeddedCover: vi.fn(() => Promise.resolve(embeddedCover)),
    };
    const artwork = { saveCustomArtwork: vi.fn(() => Promise.resolve({ format: 'jpeg', bytes: 1 })) };
    const sidecars = { writeShowSidecar: vi.fn().mockResolvedValue(true) };
    const gateway = { emitShowDiscovered: vi.fn() };
    const fileService = new PodcastFileImportService(
      repo as never,
      repo as never,
      jobs as never,
      secrets as never,
      parser as never,
      tagReader as never,
    );
    const localShowService = new PodcastLocalShowImportService(
      repo as never,
      repo as never,
      jobs as never,
      tagReader as never,
      artwork as never,
      sidecars as never,
      gateway as never,
    );
    const service = {
      processImportScan: fileService.processImportScan.bind(fileService),
      resolveLocalShowFolder: localShowService.resolveLocalShowFolder.bind(localShowService),
      processLocalImport: localShowService.processLocalImport.bind(localShowService),
      runLocalShowDiscovery: localShowService.runLocalShowDiscovery.bind(localShowService),
      syncLocalShowFolder: localShowService.syncLocalShowFolder.bind(localShowService),
      markLocalShowMissingIfGone: localShowService.markLocalShowMissingIfGone.bind(localShowService),
    };
    return { service, repo, jobs, tagReader, artwork, sidecars, gateway };
  }

  function run(payload: Record<string, unknown> = { dryRun: true }): Promise<PodcastImportReport> {
    const { service } = buildService();
    return service.processImportScan(job({ payload }));
  }

  beforeEach(async () => {
    // The service walks the realpath of the library folder, and on macOS the temp directory is
    // reached through a symlink, so the fixture has to agree on which spelling of the path it uses.
    root = await realpath(await mkdtemp(join(tmpdir(), 'podcast-import-')));
    attachments = [];
    episodes = [stubEpisode()];
    adoptedPaths = [];
    tagsByFile = new Map();
    probesByFile = new Map();
    embeddedCover = null;
    localPodcast = {
      id: 21,
      libraryId: 5,
      origin: 'local',
      localFolderPath: join(root, 'Field Recordings'),
      title: 'Field Recordings',
      author: null,
      description: null,
    };
    localEpisodes = [];
    restoredMedia = [];
    showMediaPaths = [];
    insertResult = true;
    quotaBytes = 10n ** 12n;
    usedBytes = 0n;
    cancelled = false;
    savedPayload = null;
    localRoots = [];
    registeredByFolder = new Map();
    createdShows = [];
    activeLocalShows = [];
    missingWrites = [];
    enqueueJobResult = 61;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeAudio(relativePath: string, contents = 'audio-bytes'): Promise<string> {
    const absolute = join(root, relativePath);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, contents);
    return absolute;
  }

  it('adopts a tagged file in place and records the streamed checksum', async () => {
    const path = await writeAudio('Orbit Radio [7]/episode.mp3', 'the real bytes');
    tagsByFile.set(path, tags({ episodeGuid: 'guid-1' }));

    const report = await run({ dryRun: false });

    expect(report.counts.matched).toBe(1);
    expect(report.attached).toBe(1);
    expect(report.matched[0]).toMatchObject({ episodeId: 101, tier: 'exact', signals: ['episode_guid'], attached: true });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.values).toMatchObject({
      status: 'local',
      localPath: path,
      fileName: 'episode.mp3',
      format: 'mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 14,
      checksum: createHash('sha256').update('the real bytes').digest('hex'),
    });
  });

  it('writes nothing during a dry run but still reports what it would do', async () => {
    const path = await writeAudio('Orbit Radio [7]/episode.mp3');
    tagsByFile.set(path, tags({ episodeGuid: 'guid-1' }));

    const report = await run({ dryRun: true });

    expect(report.counts.matched).toBe(1);
    expect(report.attached).toBe(0);
    expect(report.matched[0]!.attached).toBe(false);
    expect(attachments).toHaveLength(0);
  });

  it('skips a file a media row already claims instead of matching it again', async () => {
    const path = await writeAudio('Orbit Radio [7]/episode.mp3');
    tagsByFile.set(path, tags({ episodeGuid: 'guid-1' }));
    adoptedPaths = [{ episodeId: 101, localPath: path }];

    const report = await run({ dryRun: false });

    expect(report.alreadyAdopted).toBe(1);
    expect(report.filesScanned).toBe(0);
    expect(attachments).toHaveLength(0);
  });

  it('reports a second file for an already-downloaded episode as a duplicate', async () => {
    episodes = [stubEpisode({ mediaStatus: 'local', checksum: 'stored-checksum', localSizeBytes: 999 })];
    const path = await writeAudio('Orbit Radio [7]/episode.mp3');
    tagsByFile.set(path, tags({ episodeGuid: 'guid-1' }));

    const report = await run({ dryRun: false });

    expect(report.counts.matched).toBe(0);
    expect(report.duplicates[0]).toMatchObject({ episodeId: 101, contentDiffers: true });
    expect(attachments).toHaveLength(0);
  });

  it('skips symlinks, empty files, and unsupported extensions, and names each in the report', async () => {
    const real = await writeAudio('outside.mp3');
    await mkdir(join(root, 'Orbit Radio [7]'), { recursive: true });
    await symlink(real, join(root, 'Orbit Radio [7]', 'linked.mp3'));
    await writeAudio('Orbit Radio [7]/empty.mp3', '');
    await writeAudio('Orbit Radio [7]/notes.txt', 'not audio');

    const report = await run({ dryRun: false });

    expect(report.skipped).toContainEqual({ path: join('Orbit Radio [7]', 'linked.mp3'), reason: 'symlink' });
    expect(report.skipped).toContainEqual({ path: join('Orbit Radio [7]', 'empty.mp3'), reason: 'empty_file' });
    expect(report.skipped.some((entry) => entry.path.endsWith('notes.txt'))).toBe(false);
    expect(attachments).toHaveLength(0);
  });

  it('refuses to write when adoption would push the library past its quota', async () => {
    quotaBytes = 5n;
    const path = await writeAudio('Orbit Radio [7]/episode.mp3', 'much larger than five bytes');
    tagsByFile.set(path, tags({ episodeGuid: 'guid-1' }));

    await expect(run({ dryRun: false })).rejects.toThrow(/quota/i);

    expect(attachments).toHaveLength(0);
    const report = savedPayload?.report as PodcastImportReport;
    expect(report.blockedReason).toBe('quota_exceeded');
    expect(report.quota.exceeded).toBe(true);
  });

  it('reports the quota shortfall on a dry run without failing the job', async () => {
    quotaBytes = 5n;
    const path = await writeAudio('Orbit Radio [7]/episode.mp3', 'much larger than five bytes');
    tagsByFile.set(path, tags({ episodeGuid: 'guid-1' }));

    const report = await run({ dryRun: true });

    expect(report.quota.exceeded).toBe(true);
    expect(report.blockedReason).toBeNull();
  });

  it('stops on cancellation before adopting anything', async () => {
    const path = await writeAudio('Orbit Radio [7]/episode.mp3');
    tagsByFile.set(path, tags({ episodeGuid: 'guid-1' }));
    cancelled = true;

    await expect(run({ dryRun: false })).rejects.toThrow(/cancelled/i);

    expect(attachments).toHaveLength(0);
  });

  it('suggests subscribing to a feed named by an unclaimed folder', async () => {
    await writeAudio('Unknown Show/ep1.mp3');
    await writeFile(
      join(root, 'Unknown Show', 'feed.xml'),
      '<rss><channel><link>https://site.example</link><atom:link rel="self" href="https://feeds.example/unknown.xml" /></channel></rss>',
    );

    const report = await run({ dryRun: true });

    expect(report.suggestedFeeds).toEqual([
      { folderPath: 'Unknown Show', feedUrl: 'https://feeds.example/unknown.xml', source: 'feed_sidecar', fileCount: 1 },
    ]);
    expect(report.unmatched[0]).toMatchObject({ reason: 'show_unresolved' });
  });

  it('reads an Audiobookshelf metadata.json when no saved feed is present', async () => {
    await writeAudio('Another Show/ep1.mp3');
    await writeFile(join(root, 'Another Show', 'metadata.json'), JSON.stringify({ feedUrl: 'https://feeds.example/another.xml' }));

    const report = await run({ dryRun: true });

    expect(report.suggestedFeeds[0]).toMatchObject({ source: 'metadata_json', feedUrl: 'https://feeds.example/another.xml' });
  });

  it('does not suggest a feed the library already follows', async () => {
    await writeAudio('Orbit Copy/ep1.mp3');
    await writeFile(
      join(root, 'Orbit Copy', 'feed.xml'),
      '<rss><channel><atom:link rel="self" href="https://feeds.example/orbit.xml"/></channel></rss>',
    );

    const report = await run({ dryRun: true });

    expect(report.suggestedFeeds).toEqual([]);
  });

  it('honours a review decision and records it as a manual match', async () => {
    await writeAudio('Loose files/mystery.mp3');

    const report = await run({ dryRun: false, resolutions: [{ path: join('Loose files', 'mystery.mp3'), episodeId: 101 }] });

    expect(report.matched[0]).toMatchObject({ episodeId: 101, signals: ['manual'], attached: true });
    expect(attachments).toHaveLength(1);
  });

  it('ignores a review decision naming an episode outside the library', async () => {
    await writeAudio('Loose files/mystery.mp3');

    const report = await run({ dryRun: false, resolutions: [{ path: join('Loose files', 'mystery.mp3'), episodeId: 4242 }] });

    expect(report.counts.matched).toBe(0);
    expect(attachments).toHaveLength(0);
  });

  it('matches an untagged file by its date and title once the folder names the show', async () => {
    await writeAudio('Orbit Radio [7]/2026-03-04 - Landing on the Moon.mp3');

    const report = await run({ dryRun: true });

    expect(report.counts.ambiguous).toBe(1);
    expect(report.ambiguous[0]).toMatchObject({ scope: 'folder_suffix', reason: 'single_fuzzy_signal' });
    expect(report.ambiguous[0]!.candidates[0]).toMatchObject({ episodeId: 101, signals: ['title_and_date'] });
  });

  describe('unclaimed folders', () => {
    it('offers a folder that names no feed as a local show, previewing what it would be called', async () => {
      const path = await writeAudio('Field Recordings/ep1.mp3');
      tagsByFile.set(path, tags({ album: 'Field Recordings 2026', artist: 'Ada' }));

      const report = await run({ dryRun: true });

      expect(report.suggestedFeeds).toEqual([]);
      expect(report.counts.unclaimedFolders).toBe(1);
      expect(report.unclaimedFolders[0]).toEqual({
        folderPath: 'Field Recordings',
        suggestedTitle: 'Field Recordings 2026',
        suggestedAuthor: 'Ada',
        fileCount: 1,
        existingPodcastId: null,
      });
    });

    it('prefers a metadata.json title over the tags the files agree on', async () => {
      const path = await writeAudio('Field Recordings/ep1.mp3');
      tagsByFile.set(path, tags({ album: 'Tagged Album' }));
      await writeFile(join(root, 'Field Recordings', 'metadata.json'), JSON.stringify({ title: 'Sidecar Title', author: 'Sidecar Author' }));

      const report = await run({ dryRun: true });

      expect(report.unclaimedFolders[0]).toMatchObject({ suggestedTitle: 'Sidecar Title', suggestedAuthor: 'Sidecar Author' });
    });

    it('falls back to the folder name when the files disagree on their album tag', async () => {
      const first = await writeAudio('Field Recordings/ep1.mp3', 'one');
      const second = await writeAudio('Field Recordings/ep2.mp3', 'two');
      tagsByFile.set(first, tags({ album: 'One Album' }));
      tagsByFile.set(second, tags({ album: 'Another Album' }));

      const report = await run({ dryRun: true });

      expect(report.unclaimedFolders[0]).toMatchObject({ suggestedTitle: 'Field Recordings', suggestedAuthor: null, fileCount: 2 });
    });

    it('does not offer a folder that names a feed, even one the library does not follow', async () => {
      await writeAudio('Unknown Show/ep1.mp3');
      await writeFile(
        join(root, 'Unknown Show', 'feed.xml'),
        '<rss><channel><atom:link rel="self" href="https://feeds.example/unknown.xml"/></channel></rss>',
      );

      const report = await run({ dryRun: true });

      expect(report.counts.suggestedFeeds).toBe(1);
      expect(report.unclaimedFolders).toEqual([]);
    });

    it('reports the folder rather than every file inside it', async () => {
      await writeAudio('Field Recordings/ep1.mp3', 'one');
      await writeAudio('Field Recordings/ep2.mp3', 'two');

      const report = await run({ dryRun: true });

      // The action is on the folder and is offered once. Repeating it as a miss per file would fill
      // a capped list with entries nobody can act on.
      expect(report.counts.unclaimedFolders).toBe(1);
      expect(report.unclaimedFolders[0]).toMatchObject({ fileCount: 2 });
      expect(report.counts.unmatched).toBe(0);
      expect(report.unmatched).toEqual([]);
    });

    it('still reports a miss the folder offer does not cover', async () => {
      // This folder names the subscribed show, so it is not an unclaimed folder: its file failing to
      // match an episode is a real miss and has to survive.
      await writeAudio('Orbit Radio [7]/mystery.mp3');
      await writeAudio('Field Recordings/ep1.mp3');
      episodes = [];

      const report = await run({ dryRun: true });

      expect(report.counts.unclaimedFolders).toBe(1);
      expect(report.unmatched).toHaveLength(1);
      expect(report.unmatched[0]).toMatchObject({ fileName: 'mystery.mp3', podcastId: 7 });
    });

    it('offers new files in a local show folder as episodes to add, not as failed matches', async () => {
      // The repository keeps local shows and their episodes out of the scan entirely, so a file
      // dropped into a local show's folder can only ever come back as "this folder is a show, add
      // it". Reporting it as a near miss against the show it already belongs to is the dead end
      // this guards: the scan can adopt onto a feed episode, and never create one.
      await writeAudio('Field Recordings/ep65.mp3');
      const { service, repo } = buildService();
      repo.findLocalPodcastIdsByFolders.mockImplementation((_libraryId: number, folders: string[]) =>
        Promise.resolve(new Map(folders.map((folder) => [folder, 6] as const))),
      );

      const report = await service.processImportScan(job({ payload: { dryRun: true } }));

      expect(report.unclaimedFolders[0]).toMatchObject({ folderPath: 'Field Recordings', existingPodcastId: 6, fileCount: 1 });
      expect(report.counts.unmatched).toBe(0);
      expect(report.counts.duplicates).toBe(0);
    });

    it('points a folder that is already a local show at the show it belongs to', async () => {
      await writeAudio('Field Recordings/ep1.mp3');
      const { service, repo } = buildService();
      repo.findLocalPodcastIdsByFolders.mockImplementation((_libraryId: number, folders: string[]) =>
        Promise.resolve(new Map(folders.map((folder) => [folder, 88] as const))),
      );

      const report = await service.processImportScan(job({ payload: { dryRun: true } }));

      expect(report.unclaimedFolders[0]).toMatchObject({ existingPodcastId: 88 });
    });
  });

  describe('local episode identity', () => {
    it('derives identity from the file bytes, in a namespace no feed identity reaches', () => {
      const checksum = sha256('the real bytes');

      // A feed identity is `sha256(<guid | enclosure url | title|date>)`. Prefixing the digest puts
      // local identities in a space those inputs do not produce, so the shared unique index can
      // hold both kinds of episode under one show - which is exactly what a merge produces.
      expect(localIdentityHash(checksum)).toBe(sha256(`local:${checksum}`));
      expect(localIdentityHash(checksum)).not.toBe(sha256(checksum));
      expect(localIdentityHash(sha256('other bytes'))).not.toBe(localIdentityHash(checksum));
    });
  });

  describe('local show folders', () => {
    function probe(overrides: Partial<PodcastLocalFileProbe> = {}): PodcastLocalFileProbe {
      return { ...tags(), chapters: [], hasEmbeddedCover: false, trackNumber: null, ...overrides };
    }

    function localJob(overrides: Record<string, unknown> = {}) {
      return job({ type: 'local_import', podcastId: 21, payload: { applyShowMetadata: false, ...overrides } });
    }

    it('refuses a folder path that climbs out of the library', async () => {
      const { service } = buildService();

      await expect(service.resolveLocalShowFolder(5, '../elsewhere')).rejects.toThrow(/outside the library/i);
    });

    it('refuses a folder holding no importable audio', async () => {
      await mkdir(join(root, 'Empty Folder'), { recursive: true });
      const { service } = buildService();

      await expect(service.resolveLocalShowFolder(5, 'Empty Folder')).rejects.toMatchObject({
        response: { errorCode: 'PODCAST_LOCAL_FOLDER_EMPTY' },
      });
    });

    it('resolves a folder to the show it would become', async () => {
      const path = await writeAudio('Field Recordings/ep1.mp3');
      tagsByFile.set(path, tags({ album: 'Field Recordings 2026', artist: 'Ada' }));
      const { service } = buildService();

      await expect(service.resolveLocalShowFolder(5, 'Field Recordings')).resolves.toMatchObject({
        relativePath: 'Field Recordings',
        // Tags are not probed on this path, so the folder name is what the show is created under and
        // the import job refines it once every file has been read.
        metadata: { title: 'Field Recordings', author: null },
      });
    });

    it('creates one episode per file, dated and titled from what each file carries', async () => {
      const first = await writeAudio('Field Recordings/2026-03-04 - Dawn Chorus.mp3', 'dawn bytes');
      const second = await writeAudio('Field Recordings/rain.mp3', 'rain bytes');
      probesByFile.set(first, probe({ durationSeconds: 610, chapters: [{ title: 'Intro', startSeconds: 0 }], trackNumber: '1' }));
      probesByFile.set(second, probe({ title: 'Rain On Glass', publishedAt: new Date('2026-05-01T00:00:00.000Z'), durationSeconds: 90 }));
      const { service } = buildService();

      await expect(service.processLocalImport(localJob())).resolves.toEqual({ added: 2, scanned: 2 });

      expect(localEpisodes).toHaveLength(2);
      expect(localEpisodes[0]).toMatchObject({
        podcastId: 21,
        episode: {
          title: 'Dawn Chorus',
          publishedAt: new Date('2026-03-04T12:00:00.000Z'),
          durationSeconds: 610,
          chapters: [{ title: 'Intro', startSeconds: 0 }],
          episode: '1',
        },
        media: { status: 'local', localPath: first, checksum: sha256('dawn bytes'), sizeBytes: 10, format: 'mp3' },
      });
      expect(localEpisodes[1]).toMatchObject({
        episode: { title: 'Rain On Glass', publishedAt: new Date('2026-05-01T00:00:00.000Z') },
        media: { localPath: second },
      });
    });

    it('derives identity from the file bytes so the same folder imports once', async () => {
      const path = await writeAudio('Field Recordings/ep1.mp3', 'stable bytes');
      const { service } = buildService();

      await service.processLocalImport(localJob());
      const firstIdentity = localEpisodes[0]!.episode.identityHash;
      expect(firstIdentity).toBe(sha256(`local:${sha256('stable bytes')}`));

      // A second run sees the media row that claims the path and never re-reads the file.
      showMediaPaths = [{ episodeId: 1, localPath: path }];
      await expect(service.processLocalImport(localJob())).resolves.toEqual({ added: 0, scanned: 0 });
      expect(localEpisodes).toHaveLength(1);
    });

    it('adds only the file that appeared since the last run', async () => {
      const existing = await writeAudio('Field Recordings/ep1.mp3', 'old bytes');
      await writeAudio('Field Recordings/ep2.mp3', 'new bytes');
      showMediaPaths = [{ episodeId: 1, localPath: existing }];
      const { service } = buildService();

      await expect(service.processLocalImport(localJob())).resolves.toEqual({ added: 1, scanned: 1 });
      expect(localEpisodes).toHaveLength(1);
      expect(localEpisodes[0]!.media.localPath).toBe(join(root, 'Field Recordings', 'ep2.mp3'));
    });

    it('makes an episode playable again when bytes it lost reappear, rather than adding a copy', async () => {
      await writeAudio('Field Recordings/ep1.mp3', 'returned bytes');
      insertResult = false;
      const { service } = buildService();

      await expect(service.processLocalImport(localJob())).resolves.toEqual({ added: 0, scanned: 1 });

      expect(restoredMedia).toHaveLength(1);
      expect(restoredMedia[0]).toMatchObject({ podcastId: 21, identityHash: sha256(`local:${sha256('returned bytes')}`) });
    });

    it('refuses a folder that would push the library past its quota', async () => {
      await writeAudio('Field Recordings/ep1.mp3', 'x'.repeat(500));
      quotaBytes = 100n;
      const { service } = buildService();

      await expect(service.processLocalImport(localJob())).rejects.toThrow(/quota/i);
      expect(localEpisodes).toHaveLength(0);
    });

    it('names the show and stores its artwork only on the run that created it', async () => {
      const path = await writeAudio('Field Recordings/ep1.mp3');
      probesByFile.set(path, probe({ album: 'Dawn Chorus Diaries', artist: 'Ada', hasEmbeddedCover: true }));
      embeddedCover = Buffer.from('cover-bytes');
      const { service, repo, artwork } = buildService();

      await service.processLocalImport(localJob({ applyShowMetadata: true }));

      expect(repo.updatePodcast).toHaveBeenCalledWith(21, { title: 'Dawn Chorus Diaries', author: 'Ada', description: null });
      expect(artwork.saveCustomArtwork).toHaveBeenCalledWith(21, embeddedCover);
    });

    it('leaves an existing show name and artwork alone on a later run', async () => {
      const path = await writeAudio('Field Recordings/ep1.mp3');
      probesByFile.set(path, probe({ album: 'Something Else', hasEmbeddedCover: true }));
      embeddedCover = Buffer.from('cover-bytes');
      const { service, repo, artwork } = buildService();

      await service.processLocalImport(localJob({ applyShowMetadata: false }));

      expect(repo.updatePodcast).not.toHaveBeenCalled();
      expect(artwork.saveCustomArtwork).not.toHaveBeenCalled();
    });

    it('prefers a cover sidecar over an embedded image', async () => {
      const path = await writeAudio('Field Recordings/ep1.mp3');
      probesByFile.set(path, probe({ hasEmbeddedCover: true }));
      embeddedCover = Buffer.from('embedded');
      await writeFile(join(root, 'Field Recordings', 'cover.jpg'), 'sidecar-cover');
      const { service, artwork } = buildService();

      await service.processLocalImport(localJob({ applyShowMetadata: true }));

      expect(artwork.saveCustomArtwork).toHaveBeenCalledWith(21, Buffer.from('sidecar-cover'));
    });

    it('writes the show sidecar after adopting new files', async () => {
      await writeAudio('Field Recordings/ep1.mp3', 'sidecar bytes');
      const { service, sidecars } = buildService();

      await service.processLocalImport(localJob());

      expect(sidecars.writeShowSidecar).toHaveBeenCalledWith(21, join(root, 'Field Recordings'), {
        title: expect.any(String),
        author: null,
        description: null,
      });
    });

    it('announces the show while its files are still being read', async () => {
      await writeAudio('Field Recordings/ep1.mp3', 'first bytes');
      const { service, gateway } = buildService();

      await service.processLocalImport(localJob({ applyShowMetadata: true }));

      expect(gateway.emitShowDiscovered).toHaveBeenCalledWith(
        expect.objectContaining({ libraryId: 5, podcastId: 21, title: 'Field Recordings', episodes: 1, created: true }),
      );
    });

    it('keeps importing when the show announcement fails', async () => {
      await writeAudio('Field Recordings/ep1.mp3', 'resilient bytes');
      const { service, gateway } = buildService();
      gateway.emitShowDiscovered.mockImplementation(() => {
        throw new Error('socket gone');
      });

      await expect(service.processLocalImport(localJob())).resolves.toEqual({ added: 1, scanned: 1 });
    });

    it('leaves the sidecar alone when a rescan adopted nothing', async () => {
      const existing = await writeAudio('Field Recordings/ep1.mp3', 'unchanged bytes');
      showMediaPaths = [{ episodeId: 1, localPath: existing }];
      const { service, sidecars } = buildService();

      await expect(service.processLocalImport(localJob())).resolves.toEqual({ added: 0, scanned: 0 });

      expect(sidecars.writeShowSidecar).not.toHaveBeenCalled();
    });

    it('refuses to import a show whose folder now resolves outside the library', async () => {
      localPodcast = { id: 21, libraryId: 5, origin: 'local', localFolderPath: join(root, '..', 'escaped') };
      const { service } = buildService();

      await expect(service.processLocalImport(localJob())).rejects.toThrow();
      expect(localEpisodes).toHaveLength(0);
    });
  });

  describe('local show discovery', () => {
    // The archive the user brought, registered as a local root beside the downloads root.
    beforeEach(() => {
      localRoots = [join(root, 'local')];
    });

    it('registers a folder in a local root as a show and queues its first import', async () => {
      await writeAudio('local/Field Notes/one.mp3');
      const { service, jobs } = buildService();

      const result = await service.runLocalShowDiscovery(5);

      expect(result.discovered).toBe(1);
      expect(createdShows).toEqual([
        { libraryId: 5, folderPath: join(root, 'local', 'Field Notes'), values: expect.objectContaining({ title: 'Field Notes' }) },
      ]);
      expect(jobs.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'local_import',
          dedupeKey: 'local_import:91',
          libraryId: 5,
          podcastId: 91,
          payload: expect.objectContaining({ applyShowMetadata: true }),
        }),
      );
    });

    it('leaves registered, empty, and audio-free folders alone during discovery', async () => {
      await mkdir(join(root, 'local', 'Empty Folder'), { recursive: true });
      await writeAudio('local/Registered Show/one.mp3');
      registeredByFolder.set(join(root, 'local', 'Registered Show'), { id: 21, libraryId: 5, archivedAt: null });
      const { service, jobs } = buildService();

      const result = await service.runLocalShowDiscovery(5);

      expect(result.discovered).toBe(0);
      expect(createdShows).toHaveLength(0);
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it('rescans a registered show only when its folder holds unadopted audio', async () => {
      const folder = join(root, 'Field Recordings');
      const adoptedPath = await writeAudio('Field Recordings/old.mp3');
      activeLocalShows = [{ id: 21, localFolderPath: folder, missingAt: null }];
      showMediaPaths = [{ episodeId: 1, localPath: adoptedPath }];
      const { service, jobs } = buildService();

      expect((await service.runLocalShowDiscovery(5)).rescans).toBe(0);
      expect(jobs.enqueue).not.toHaveBeenCalled();

      await writeAudio('Field Recordings/new.mp3');
      expect((await service.runLocalShowDiscovery(5)).rescans).toBe(1);
      expect(jobs.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'local_import',
          dedupeKey: 'local_import:21',
          podcastId: 21,
          payload: expect.objectContaining({ applyShowMetadata: false }),
        }),
      );
    });

    it('flags a show whose folder left the disk, then clears it when the folder is back', async () => {
      const folder = join(root, 'local', 'Field Notes');
      await writeAudio('local/Field Notes/one.mp3');
      activeLocalShows = [{ id: 21, localFolderPath: folder, missingAt: null }];
      const { service } = buildService();

      await rm(folder, { recursive: true, force: true });
      expect((await service.runLocalShowDiscovery(5)).missing).toBe(1);
      expect(missingWrites).toEqual([{ podcastId: 21, missing: true }]);

      await writeAudio('local/Field Notes/one.mp3');
      const restored = await service.runLocalShowDiscovery(5);

      expect(restored.restored).toBe(1);
      expect(missingWrites).toEqual([
        { podcastId: 21, missing: true },
        { podcastId: 21, missing: false },
      ]);
    });

    it('writes nothing for a show that was already flagged and is still gone', async () => {
      const folder = join(root, 'local', 'Field Notes');
      activeLocalShows = [{ id: 21, localFolderPath: folder, missingAt: new Date() }];
      const { service } = buildService();

      const result = await service.runLocalShowDiscovery(5);

      expect(result.missing).toBe(0);
      expect(missingWrites).toHaveLength(0);
    });

    it('flags a deleted folder the watcher reports, and spares one that is still there', async () => {
      const gone = join(root, 'local', 'Gone Show');
      const present = join(root, 'local', 'Present Show');
      await writeAudio('local/Present Show/one.mp3');
      registeredByFolder.set(gone, { id: 41, libraryId: 5, archivedAt: null });
      registeredByFolder.set(present, { id: 42, libraryId: 5, archivedAt: null });
      const { service } = buildService();

      expect(await service.markLocalShowMissingIfGone(5, gone)).toBe(true);
      expect(await service.markLocalShowMissingIfGone(5, present)).toBe(false);
      expect(missingWrites).toEqual([{ podcastId: 41, missing: true }]);
    });

    it('leaves an archived show unflagged when its folder is deleted', async () => {
      const folder = join(root, 'local', 'Archived Show');
      registeredByFolder.set(folder, { id: 43, libraryId: 5, archivedAt: new Date() });
      const { service } = buildService();

      expect(await service.markLocalShowMissingIfGone(5, folder)).toBe(false);
      expect(missingWrites).toHaveLength(0);
    });

    it('sync reports deferred while the show already has an active import', async () => {
      const folder = join(root, 'local', 'Busy Show');
      await writeAudio('local/Busy Show/one.mp3');
      registeredByFolder.set(folder, { id: 33, libraryId: 5, archivedAt: null });
      enqueueJobResult = null;
      const { service } = buildService();

      const result = await service.syncLocalShowFolder(5, join('local', 'Busy Show'));

      expect(result).toEqual({ outcome: 'deferred', jobId: null });
    });

    it('sync leaves an archived show alone', async () => {
      const folder = join(root, 'local', 'Archived Show');
      await writeAudio('local/Archived Show/one.mp3');
      registeredByFolder.set(folder, { id: 33, libraryId: 5, archivedAt: new Date() });
      const { service, jobs } = buildService();

      const result = await service.syncLocalShowFolder(5, join('local', 'Archived Show'));

      expect(result.outcome).toBe('skipped');
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it('sync refuses paths that escape the library roots', async () => {
      const { service, jobs } = buildService();

      const result = await service.syncLocalShowFolder(5, join('..', 'outside'));

      expect(result.outcome).toBe('skipped');
      expect(createdShows).toHaveLength(0);
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it('leaves folders in the downloads root out of discovery', async () => {
      // The downloads root is where BookOrbit's own files land, so a folder appearing there is not
      // a show the user brought. Adopting one is asked for through the import report instead.
      await writeAudio('Some Downloaded Show/one.mp3');
      const { service, jobs } = buildService();

      const result = await service.runLocalShowDiscovery(5);

      expect(result.discovered).toBe(0);
      expect(createdShows).toHaveLength(0);
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it('sweeps every local root, not only the first', async () => {
      const second = await realpath(await mkdtemp(join(tmpdir(), 'podcast-second-')));
      localRoots = [join(root, 'local'), second];
      await writeAudio('local/Field Notes/one.mp3');
      await mkdir(join(second, 'Night Shift'), { recursive: true });
      await writeFile(join(second, 'Night Shift', 'one.mp3'), 'night bytes');
      const { service } = buildService();

      const result = await service.runLocalShowDiscovery(5);

      expect(result.discovered).toBe(2);
      expect(createdShows.map((show) => show.folderPath).sort()).toEqual([join(root, 'local', 'Field Notes'), join(second, 'Night Shift')].sort());
    });

    it('takes an absolute folder path from the watcher', async () => {
      await writeAudio('local/Field Notes/one.mp3');
      const { service } = buildService();

      const result = await service.syncLocalShowFolder(5, join(root, 'local', 'Field Notes'));

      expect(result.outcome).toBe('created');
      expect(createdShows).toEqual([
        { libraryId: 5, folderPath: join(root, 'local', 'Field Notes'), values: expect.objectContaining({ title: 'Field Notes' }) },
      ]);
    });
  });

  describe('local show folder depth', () => {
    it('imports episodes filed under season subfolders as one show', async () => {
      await writeAudio('Field Recordings/loose.mp3', 'loose bytes');
      await writeAudio('Field Recordings/Season 01/ep1.mp3', 'season one bytes');
      await writeAudio('Field Recordings/Season 02/Bonus/ep2.mp3', 'bonus bytes');
      const { service } = buildService();

      await expect(service.processLocalImport(job({ type: 'local_import', podcastId: 21, payload: { applyShowMetadata: false } }))).resolves.toEqual({
        added: 3,
        scanned: 3,
      });
      expect(localEpisodes.map((entry) => entry.media.localPath).sort()).toEqual(
        [
          join(root, 'Field Recordings', 'loose.mp3'),
          join(root, 'Field Recordings', 'Season 01', 'ep1.mp3'),
          join(root, 'Field Recordings', 'Season 02', 'Bonus', 'ep2.mp3'),
        ].sort(),
      );
    });

    it('stops descending past the depth cap', async () => {
      await writeAudio('Field Recordings/a/b/c/one.mp3', 'deep enough bytes');
      await writeAudio('Field Recordings/a/b/c/d/too-deep.mp3', 'too deep bytes');
      const { service } = buildService();

      await expect(service.resolveLocalShowFolder(5, 'Field Recordings')).resolves.toMatchObject({ metadata: { title: 'Field Recordings' } });
      await expect(service.processLocalImport(job({ type: 'local_import', podcastId: 21, payload: { applyShowMetadata: false } }))).resolves.toEqual({
        added: 1,
        scanned: 1,
      });
      expect(localEpisodes[0]!.media.localPath).toBe(join(root, 'Field Recordings', 'a', 'b', 'c', 'one.mp3'));
    });

    it('reports a folder whose only audio sits past the depth cap as empty', async () => {
      await writeAudio('Field Recordings/a/b/c/d/too-deep.mp3', 'too deep bytes');
      const { service } = buildService();

      await expect(service.resolveLocalShowFolder(5, 'Field Recordings')).rejects.toMatchObject({
        response: { errorCode: 'PODCAST_LOCAL_FOLDER_EMPTY' },
      });
    });
  });
});
