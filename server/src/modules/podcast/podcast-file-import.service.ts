import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { realpath, stat } from 'fs/promises';
import { basename, extname, join, relative } from 'path';
import { pathToFileURL } from 'url';

import {
  PODCAST_IMPORT_MAX_RESOLUTIONS,
  PODCAST_IMPORT_REPORT_GROUP_LIMIT,
  type PodcastImportAmbiguousFile,
  type PodcastImportDuplicateFile,
  type PodcastImportMatchedFile,
  type PodcastImportReport,
  type PodcastImportResolution,
  type PodcastImportScope,
  type PodcastImportSignal,
  type PodcastImportSkippedFile,
  type PodcastImportSkipReason,
  type PodcastImportSuggestedFeed,
  type PodcastImportUnclaimedFolder,
  type PodcastImportUnmatchedFile,
} from '@bookorbit/types';
import { buildNameExcludeMatcher, walkDirectoryTree } from '../../common/fs-walk.utils';
import { chunk, mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { PodcastJob } from '../../db/schema';
import {
  buildEpisodeIndex,
  buildShowIndex,
  matchEpisode,
  resolveShowScope,
  type ImportEpisodeRow,
  type PodcastEpisodeIndex,
  type ShowIndex,
} from './podcast-import-matcher';
import { PodcastFeedParserService } from './podcast-feed-parser.service';
import {
  deriveLocalShowMetadata,
  hashFileHandle,
  type LocalShowMetadata,
  PodcastImportCancelledError,
  type PodcastImportFolderMetadataContext,
  readBoundedTextFile,
} from './podcast-import-files';
import { PodcastJobRepository } from './podcast-job.repository';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastEpisodeRepository } from './podcast-episode.repository';
import { PodcastSecretService } from './podcast-secret.service';
import { METADATA_SIDECAR_NAME } from './podcast-sidecar.service';
import { AUDIO_EXTENSIONS, openRegularFileWithinRoot, resolveAudioMediaType } from './podcast-media-storage.service';
import { parsePodcastFileNameHints, parsePodcastFolderId, PodcastTagReaderService, type PodcastFileTags } from './podcast-tag-reader.service';

/** Ceilings that keep one run bounded no matter how large the folder is. */
const MAX_CANDIDATE_FILES = 20_000;
const MAX_EPISODES_PER_SHOW = 20_000;
const MAX_SUGGESTED_FEEDS = 50;
const MAX_UNCLAIMED_FOLDERS = 50;
const EPISODE_PAGE_SIZE = 500;
const ADOPTED_PATH_PAGE_SIZE = 1000;
const PROBE_CONCURRENCY = 3;
const PROGRESS_INTERVAL = 25;
/** Enough of a saved feed to reach its `rel="self"` link, which sits in the channel header. */
const SIDECAR_MAX_BYTES = 512 * 1024;
const FEED_SIDECAR_NAMES = ['feed.xml', 'rss.xml'];
/** BookOrbit's own partial downloads and the usual desktop clutter never carry a podcast. */
const EXCLUDED_NAMES = ['@eaDir', 'lost+found', '#recycle', '*.part'];

interface ImportOptions {
  dryRun: boolean;
  podcastId: number | null;
  resolutions: PodcastImportResolution[];
}

interface FolderContext extends PodcastImportFolderMetadataContext {
  folderPodcastId: number | null;
  feedSidecarPath: string | null;
  /** Resolved once per folder, on the first file that needs it. */
  sidecar?: DiscoveredFeed | null;
  fileCount: number;
  resolvedShow: boolean;
  tagFeedUrls: Set<string>;
  /** True once one file in the folder carried no feed URL tag, which breaks unanimity. */
  tagFeedUrlsIncomplete: boolean;
}

interface DiscoveredFeed {
  feedUrl: string;
  hash: string;
  source: 'feed_sidecar' | 'metadata_json' | 'feed_url_tag';
}

interface CandidateFile {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  sizeBytes: number;
  folder: FolderContext;
  tags: PodcastFileTags | null;
  hints: ReturnType<typeof parsePodcastFileNameHints>;
}

/**
 * Adopts audio files the user already placed inside the podcast library folder.
 *
 * For a subscribed show the feed stays the source of truth: the scan never invents an episode, it
 * only ties a file on disk to an episode a feed already published and flips that episode's media to
 * `local`. Folders that belong to no feed at all take the other route and become local shows, where
 * the files themselves are the source of truth. Either way files are adopted where they lie -
 * nothing is copied, renamed, or moved.
 */
@Injectable()
export class PodcastFileImportService {
  private readonly logger = new Logger(PodcastFileImportService.name);

  constructor(
    private readonly catalog: PodcastCatalogRepository,
    private readonly episodes: PodcastEpisodeRepository,
    private readonly jobs: PodcastJobRepository,
    private readonly secrets: PodcastSecretService,
    private readonly parser: PodcastFeedParserService,
    private readonly tagReader: PodcastTagReaderService,
  ) {}

  async processImportScan(job: PodcastJob): Promise<PodcastImportReport> {
    const event = 'podcast.import_scan';
    const startedAt = new Date();
    const options = parseImportOptions(job.payload);
    this.logger.log(`[${event}] [start] jobId=${job.id} libraryId=${job.libraryId} dryRun=${options.dryRun} - podcast local import started`);
    try {
      const report = await this.run(job, options, startedAt);
      await this.jobs.updatePayload(job.id, { ...job.payload, report });
      if (report.blockedReason === 'quota_exceeded') {
        throw new BadRequestException('Importing these files would exceed the podcast library storage quota. Raise the quota or import fewer files.');
      }
      this.logger.log(
        `[${event}] [end] jobId=${job.id} libraryId=${job.libraryId} durationMs=${Date.now() - startedAt.getTime()} discovered=${report.filesDiscovered} scanned=${report.filesScanned} matched=${report.counts.matched} attached=${report.attached} ambiguous=${report.counts.ambiguous} unmatched=${report.counts.unmatched} - podcast local import completed`,
      );
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${event}] [fail] jobId=${job.id} libraryId=${job.libraryId} durationMs=${Date.now() - startedAt.getTime()} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - podcast local import failed`,
      );
      throw error;
    }
  }

  private async run(job: PodcastJob, options: ImportOptions, startedAt: Date): Promise<PodcastImportReport> {
    const libraryId = job.libraryId;
    // Only the downloads root is scanned. This run attaches loose files to episodes a feed already
    // described, and a local root holds shows discovery has registered on its own terms.
    const rootPath = await this.catalog.findPrimaryLibraryFolder(libraryId);
    if (!rootPath) throw new NotFoundException('Podcast library storage folder not found');
    const root = await realpath(rootPath);

    const skipped: PodcastImportSkippedFile[] = [];
    const discovery = await this.discoverCandidates(root, skipped);
    const adopted = await this.loadAdoptedPaths(libraryId);

    const pending: CandidateFile[] = [];
    let alreadyAdopted = 0;
    for (const candidate of discovery.candidates) {
      if (adopted.has(candidate.absolutePath)) {
        alreadyAdopted++;
        candidate.folder.fileCount--;
        continue;
      }
      pending.push(candidate);
    }

    await this.jobs.updateProgress(job.id, 0, pending.length);
    await this.probeCandidates(job, pending);

    const shows = await this.episodes.listPodcastsForImport(libraryId);
    const showIndex = buildShowIndex(shows.shows, shows.aliases);
    const requestedPodcastId = options.podcastId !== null && showIndex.byId.has(options.podcastId) ? options.podcastId : null;
    if (options.podcastId !== null && requestedPodcastId === null) throw new BadRequestException('Podcast is not in this library');

    const directHits = await this.loadDirectHits(libraryId, pending);
    const resolutions = await this.loadResolutions(libraryId, options.resolutions);

    const matched: PodcastImportMatchedFile[] = [];
    const ambiguous: PodcastImportAmbiguousFile[] = [];
    const unmatched: PodcastImportUnmatchedFile[] = [];
    const duplicates: PodcastImportDuplicateFile[] = [];
    const episodeIndexes = new Map<number, PodcastEpisodeIndex>();
    const claimedEpisodeIds = new Set<number>();

    for (const candidate of pending) {
      const resolved = resolutions.get(candidate.relativePath);
      const scopeResult = resolved
        ? { scope: 'request' as PodcastImportScope, podcastIds: [resolved.podcastId] }
        : resolveShowScope(showIndex, {
            requestedPodcastId,
            folderPodcastId: candidate.folder.folderPodcastId,
            folderTitle: candidate.folder.folderTitle,
            feedUrlHashFromTag: this.hashOrNull(candidate.tags?.feedUrl ?? null),
            feedUrlHashFromSidecar: (await this.resolveSidecar(candidate.folder))?.hash ?? null,
            albumTag: candidate.tags?.album ?? null,
          });
      if (scopeResult.scope !== 'library' && scopeResult.scope !== 'title_similarity') candidate.folder.resolvedShow = true;

      const scopedIndexes: PodcastEpisodeIndex[] = [];
      for (const podcastId of scopeResult.podcastIds) {
        scopedIndexes.push(await this.episodeIndexFor(podcastId, episodeIndexes));
      }

      const guidIdentityHash = candidate.tags?.episodeGuid ? this.parser.identityHash(candidate.tags.episodeGuid) : null;
      const result = resolved
        ? ({ kind: 'matched', tier: 'exact', episode: resolved, signals: ['manual'] } as const)
        : matchEpisode({
            fileName: candidate.fileName,
            tags: candidate.tags,
            hints: candidate.hints,
            scopedIndexes,
            guidIdentityHash,
            guidEpisode: guidIdentityHash ? (directHits.byIdentityHash.get(guidIdentityHash) ?? null) : null,
            suffixEpisode: candidate.hints.episodeId === null ? null : (directHits.byId.get(candidate.hints.episodeId) ?? null),
            scopedPodcastIds: scopeResult.podcastIds,
          });

      if (result.kind === 'none') {
        unmatched.push({
          ...fileSummary(candidate),
          reason: scopeResult.scope === 'library' ? 'show_unresolved' : 'no_episode_candidate',
          podcastId: scopeResult.podcastIds[0] ?? null,
          podcastTitle: showIndex.byId.get(scopeResult.podcastIds[0] ?? -1)?.title ?? null,
        });
        continue;
      }
      if (result.kind === 'ambiguous') {
        ambiguous.push({
          ...fileSummary(candidate),
          scope: scopeResult.scope,
          reason: result.reason,
          candidates: result.candidates.map((entry) => ({
            episodeId: entry.episode.episodeId,
            podcastId: entry.episode.podcastId,
            podcastTitle: entry.episode.podcastTitle,
            episodeTitle: entry.episode.title,
            publishedAt: entry.episode.publishedAt?.toISOString() ?? null,
            durationSeconds: entry.episode.durationSeconds,
            signals: entry.signals,
          })),
        });
        continue;
      }

      const episode = result.episode;
      if (episode.mediaStatus === 'local') {
        duplicates.push({
          ...fileSummary(candidate),
          episodeId: episode.episodeId,
          podcastId: episode.podcastId,
          episodeTitle: episode.title,
          contentDiffers: await this.contentDiffers(root, candidate, episode),
        });
        continue;
      }
      // Two files resolving to one episode is a duplicate on disk, not a reason to write twice.
      if (claimedEpisodeIds.has(episode.episodeId)) {
        duplicates.push({
          ...fileSummary(candidate),
          episodeId: episode.episodeId,
          podcastId: episode.podcastId,
          episodeTitle: episode.title,
          contentDiffers: true,
        });
        continue;
      }
      claimedEpisodeIds.add(episode.episodeId);
      matched.push({
        ...fileSummary(candidate),
        episodeId: episode.episodeId,
        podcastId: episode.podcastId,
        podcastTitle: episode.podcastTitle,
        episodeTitle: episode.title,
        tier: result.tier,
        signals: [...result.signals] as PodcastImportSignal[],
        scope: scopeResult.scope,
        attached: false,
      });
    }

    const settings = await this.catalog.getLibrarySettings(libraryId);
    const headroomBytes = settings.storageQuotaBytes > settings.usedStorageBytes ? settings.storageQuotaBytes - settings.usedStorageBytes : 0n;
    const adoptBytes = matched.reduce((total, file) => total + BigInt(file.sizeBytes), 0n);
    const exceeded = adoptBytes > headroomBytes;

    // An import must never be the reason another episode is evicted, so a run that does not fit is
    // refused outright rather than allowed to run retention.
    let attached = 0;
    if (!options.dryRun && !exceeded) {
      attached = await this.attachMatches(job, root, matched, unmatched);
    }

    const { suggestedFeeds, unclaimedFolders } = await this.collectLeftoverFolders(libraryId, root, discovery.folders, showIndex);
    const reported = dropFilesCoveredByUnclaimedFolders(unmatched, unclaimedFolders);
    const finishedAt = new Date();
    return {
      libraryId,
      dryRun: options.dryRun,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      filesDiscovered: discovery.candidates.length,
      filesScanned: pending.length,
      alreadyAdopted,
      attached,
      counts: {
        matched: matched.length,
        ambiguous: ambiguous.length,
        unmatched: reported.length,
        duplicates: duplicates.length,
        skipped: skipped.length,
        suggestedFeeds: suggestedFeeds.length,
        unclaimedFolders: unclaimedFolders.length,
      },
      matched: matched.slice(0, PODCAST_IMPORT_REPORT_GROUP_LIMIT),
      ambiguous: ambiguous.slice(0, PODCAST_IMPORT_REPORT_GROUP_LIMIT),
      unmatched: reported.slice(0, PODCAST_IMPORT_REPORT_GROUP_LIMIT),
      duplicates: duplicates.slice(0, PODCAST_IMPORT_REPORT_GROUP_LIMIT),
      suggestedFeeds,
      unclaimedFolders,
      skipped: skipped.slice(0, PODCAST_IMPORT_REPORT_GROUP_LIMIT),
      unreadableFolders: discovery.unreadableFolders.map((folder) => relative(root, folder)).slice(0, PODCAST_IMPORT_REPORT_GROUP_LIMIT),
      quota: { adoptBytes: adoptBytes.toString(), headroomBytes: headroomBytes.toString(), exceeded },
      blockedReason: !options.dryRun && exceeded ? 'quota_exceeded' : null,
      truncated:
        discovery.truncated || [matched, ambiguous, reported, duplicates, skipped].some((group) => group.length > PODCAST_IMPORT_REPORT_GROUP_LIMIT),
    };
  }

  /**
   * One pass over the library folder. A file is a candidate when its extension is in the same audio
   * allowlist the download path enforces, it is a regular file the walk reached without following a
   * link, and it holds bytes.
   */
  private async discoverCandidates(
    root: string,
    skipped: PodcastImportSkippedFile[],
  ): Promise<{ candidates: CandidateFile[]; folders: FolderContext[]; unreadableFolders: string[]; truncated: boolean }> {
    const shouldExclude = buildNameExcludeMatcher(EXCLUDED_NAMES);
    const candidates: CandidateFile[] = [];
    const folders: FolderContext[] = [];
    let truncated = false;

    const { skippedDirs } = await walkDirectoryTree(root, {
      shouldExclude,
      // A symlink to something that is not audio is not something the user meant to import, so it
      // is passed over silently rather than filling the report with noise.
      onSkippedEntry: ({ path, reason }) => {
        if (!AUDIO_EXTENSIONS.has(extname(path).toLowerCase())) return;
        skipped.push({ path: relative(root, path), reason: reason === 'symlink' ? 'symlink' : 'unreadable' });
      },
      visit: async ({ path: directory, filePaths }) => {
        const folderName = basename(directory);
        const folderPodcastId = parsePodcastFolderId(folderName);
        const folder: FolderContext = {
          path: directory,
          folderPodcastId,
          folderTitle: folderPodcastId === null ? folderName : folderName.replace(/\s*\[\d+\]$/, '').trim(),
          feedSidecarPath: filePaths.find((file) => FEED_SIDECAR_NAMES.includes(basename(file).toLowerCase())) ?? null,
          metadataSidecarPath: filePaths.find((file) => basename(file).toLowerCase() === METADATA_SIDECAR_NAME) ?? null,
          fileCount: 0,
          resolvedShow: false,
          tagFeedUrls: new Set(),
          tagFeedUrlsIncomplete: false,
          albumTags: new Set(),
          artistTags: new Set(),
        };

        for (const filePath of filePaths) {
          const fileName = basename(filePath);
          if (!AUDIO_EXTENSIONS.has(extname(fileName).toLowerCase())) continue;
          if (candidates.length >= MAX_CANDIDATE_FILES) {
            truncated = true;
            break;
          }
          let info: Awaited<ReturnType<typeof stat>>;
          try {
            info = await stat(filePath);
          } catch {
            skipped.push({ path: relative(root, filePath), reason: 'unreadable' });
            continue;
          }
          if (!info.isFile()) {
            skipped.push({ path: relative(root, filePath), reason: 'unsupported_format' });
            continue;
          }
          if (info.size === 0) {
            skipped.push({ path: relative(root, filePath), reason: 'empty_file' });
            continue;
          }
          folder.fileCount++;
          candidates.push({
            absolutePath: filePath,
            relativePath: relative(root, filePath),
            fileName,
            sizeBytes: info.size,
            folder,
            tags: null,
            hints: parsePodcastFileNameHints(fileName),
          });
        }
        if (folder.fileCount > 0) folders.push(folder);
      },
    });

    return { candidates, folders, unreadableFolders: [...skippedDirs], truncated };
  }

  private async loadAdoptedPaths(libraryId: number): Promise<Set<string>> {
    const paths = new Set<string>();
    let afterEpisodeId = 0;
    for (;;) {
      const rows = await this.episodes.listAdoptedMediaPaths(libraryId, afterEpisodeId, ADOPTED_PATH_PAGE_SIZE);
      if (rows.length === 0) break;
      for (const row of rows) {
        afterEpisodeId = row.episodeId;
        if (row.localPath) paths.add(row.localPath);
      }
      if (rows.length < ADOPTED_PATH_PAGE_SIZE) break;
    }
    return paths;
  }

  private async probeCandidates(job: PodcastJob, candidates: CandidateFile[]): Promise<void> {
    let processed = 0;
    let lastReported = 0;
    await mapWithConcurrency(candidates, PROBE_CONCURRENCY, async (candidate) => {
      candidate.tags = await this.tagReader.read(candidate.absolutePath);
      if (candidate.tags?.feedUrl) candidate.folder.tagFeedUrls.add(candidate.tags.feedUrl);
      else candidate.folder.tagFeedUrlsIncomplete = true;
      if (candidate.tags?.album) candidate.folder.albumTags.add(candidate.tags.album);
      if (candidate.tags?.artist) candidate.folder.artistTags.add(candidate.tags.artist);
      processed++;
      if (processed - lastReported < PROGRESS_INTERVAL && processed !== candidates.length) return;
      lastReported = processed;
      await this.jobs.updateProgress(job.id, processed, candidates.length);
      if (await this.jobs.isCancellationRequested(job.id)) throw new PodcastImportCancelledError();
    });
  }

  /**
   * The two signals that survive without a resolved show: an Apple episode GUID hashes straight
   * onto the identity a feed already wrote, and a `[<episodeId>]` suffix names a row outright.
   * Both are looked up in batches across the whole library rather than per file.
   */
  private async loadDirectHits(
    libraryId: number,
    candidates: CandidateFile[],
  ): Promise<{ byIdentityHash: Map<string, ImportEpisodeRow>; byId: Map<number, ImportEpisodeRow> }> {
    const identityHashes = new Set<string>();
    const episodeIds = new Set<number>();
    for (const candidate of candidates) {
      if (candidate.tags?.episodeGuid) identityHashes.add(this.parser.identityHash(candidate.tags.episodeGuid));
      if (candidate.hints.episodeId !== null) episodeIds.add(candidate.hints.episodeId);
    }
    const byIdentityHash = new Map<string, ImportEpisodeRow>();
    const byId = new Map<number, ImportEpisodeRow>();
    for (const batch of chunk([...identityHashes], EPISODE_PAGE_SIZE)) {
      for (const row of await this.episodes.findImportEpisodesByIdentityHashes(libraryId, batch)) {
        byIdentityHash.set(row.identityHash, this.toEpisodeRow(row));
      }
    }
    for (const batch of chunk([...episodeIds], EPISODE_PAGE_SIZE)) {
      for (const row of await this.episodes.findImportEpisodesByIds(libraryId, batch)) byId.set(row.episodeId, this.toEpisodeRow(row));
    }
    return { byIdentityHash, byId };
  }

  /** Review-UI decisions, re-checked server side: an override may only name an episode in this library. */
  private async loadResolutions(libraryId: number, resolutions: PodcastImportResolution[]): Promise<Map<string, ImportEpisodeRow>> {
    if (resolutions.length === 0) return new Map();
    const rows = await this.episodes.findImportEpisodesByIds(
      libraryId,
      resolutions.map((resolution) => resolution.episodeId),
    );
    const byEpisodeId = new Map<number, ImportEpisodeRow>(rows.map((row) => [row.episodeId, this.toEpisodeRow(row)] as const));
    const resolved = new Map<string, ImportEpisodeRow>();
    for (const resolution of resolutions) {
      const episode = byEpisodeId.get(resolution.episodeId);
      if (episode) resolved.set(resolution.path, episode);
    }
    return resolved;
  }

  private async episodeIndexFor(podcastId: number, cache: Map<number, PodcastEpisodeIndex>): Promise<PodcastEpisodeIndex> {
    const cached = cache.get(podcastId);
    if (cached) return cached;
    const rows: ImportEpisodeRow[] = [];
    let afterEpisodeId = 0;
    for (;;) {
      const page = await this.episodes.listImportEpisodesForPodcast(podcastId, afterEpisodeId, EPISODE_PAGE_SIZE);
      if (page.length === 0) break;
      for (const row of page) {
        afterEpisodeId = row.episodeId;
        rows.push(this.toEpisodeRow(row));
      }
      if (page.length < EPISODE_PAGE_SIZE || rows.length >= MAX_EPISODES_PER_SHOW) break;
    }
    if (rows.length >= MAX_EPISODES_PER_SHOW) {
      this.logger.warn(
        `[podcast.import_scan] [end] podcastId=${podcastId} indexed=${rows.length} - show has more episodes than the import index holds, later episodes were not matched against`,
      );
    }
    const index = buildEpisodeIndex(podcastId, rows);
    cache.set(podcastId, index);
    return index;
  }

  private toEpisodeRow(row: Awaited<ReturnType<PodcastEpisodeRepository['findImportEpisodesByIds']>>[number]): ImportEpisodeRow {
    let enclosureUrl: string | null = null;
    try {
      // A local-origin episode has no enclosure at all, which is the same as losing the signal.
      if (row.enclosureUrlEncrypted) enclosureUrl = this.secrets.decrypt(row.enclosureUrlEncrypted);
    } catch {
      // A row whose enclosure cannot be decrypted simply loses the file-name signal.
    }
    return { ...row, enclosureUrl };
  }

  /**
   * Adopts each matched file in its own transaction, so a cancelled or crashed run leaves whole
   * rows behind rather than a half-written one.
   */
  private async attachMatches(
    job: PodcastJob,
    root: string,
    matched: PodcastImportMatchedFile[],
    unmatched: PodcastImportUnmatchedFile[],
  ): Promise<number> {
    let attached = 0;
    const failed: PodcastImportMatchedFile[] = [];
    for (const file of matched) {
      if (await this.jobs.isCancellationRequested(job.id)) throw new PodcastImportCancelledError();
      try {
        if (await this.attachFile(root, file)) {
          file.attached = true;
          attached++;
          continue;
        }
        failed.push(file);
        unmatched.push({ ...fileSummary(file), reason: 'attach_conflict', podcastId: file.podcastId, podcastTitle: file.podcastTitle });
      } catch (error) {
        const reason: PodcastImportSkipReason = error instanceof BadRequestException ? 'outside_library_root' : 'unreadable';
        failed.push(file);
        unmatched.push({ ...fileSummary(file), reason, podcastId: file.podcastId, podcastTitle: file.podcastTitle });
        this.logger.warn(
          `[podcast.import_attach] [fail] jobId=${job.id} episodeId=${file.episodeId} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - podcast file adoption failed`,
        );
      }
    }
    // A file that could not be adopted is reported under the reason it failed for, not as a match.
    const failedPaths = new Set(failed.map((file) => file.path));
    matched.splice(0, matched.length, ...matched.filter((file) => !failedPaths.has(file.path)));
    return attached;
  }

  private async attachFile(root: string, file: PodcastImportMatchedFile): Promise<boolean> {
    const absolutePath = join(root, file.path);
    const opened = await openRegularFileWithinRoot(root, absolutePath);
    let checksum: string;
    let sizeBytes: number;
    try {
      checksum = await hashFileHandle(opened.handle);
      sizeBytes = opened.size;
    } finally {
      await opened.handle.close();
    }
    const resolvedPath = await realpath(absolutePath);
    const mediaType = resolveAudioMediaType(pathToFileURL(resolvedPath), null);
    if (!mediaType) throw new BadRequestException('Podcast import candidate is not a supported audio format');
    return this.episodes.attachImportedMedia(file.episodeId, {
      status: 'local',
      localPath: resolvedPath,
      fileName: basename(resolvedPath),
      format: mediaType.extension.slice(1),
      mimeType: mediaType.contentType,
      sizeBytes,
      checksum,
      downloadedAt: new Date(),
      lastError: null,
    });
  }

  /**
   * Whether a file that lost the race for an already-adopted episode holds different bytes. Sizes
   * settle it in almost every case; only an equal-sized rival is worth hashing.
   */
  private async contentDiffers(root: string, candidate: CandidateFile, episode: ImportEpisodeRow): Promise<boolean> {
    if (episode.localSizeBytes !== null && episode.localSizeBytes !== candidate.sizeBytes) return true;
    if (!episode.checksum) return false;
    try {
      const opened = await openRegularFileWithinRoot(root, candidate.absolutePath);
      try {
        return (await hashFileHandle(opened.handle)) !== episode.checksum;
      } finally {
        await opened.handle.close();
      }
    } catch {
      return false;
    }
  }

  /**
   * What is left over once the matching is done, split by whether a feed could be discovered.
   *
   * A folder that names a feed BookOrbit does not follow becomes a one-click subscribe offer. A
   * folder that names none has no feed to wait for, so its only route into the library is becoming
   * a local show, and the entry carries the preview of what that show would be called.
   */
  private async collectLeftoverFolders(
    libraryId: number,
    root: string,
    folders: FolderContext[],
    showIndex: ShowIndex,
  ): Promise<{ suggestedFeeds: PodcastImportSuggestedFeed[]; unclaimedFolders: PodcastImportUnclaimedFolder[] }> {
    const suggestedFeeds: PodcastImportSuggestedFeed[] = [];
    const unclaimed: Array<{ folder: FolderContext; metadata: LocalShowMetadata }> = [];
    for (const folder of folders) {
      if (folder.resolvedShow || folder.fileCount === 0) continue;
      const unanimousTagUrl = !folder.tagFeedUrlsIncomplete && folder.tagFeedUrls.size === 1 ? [...folder.tagFeedUrls][0]! : null;
      const unanimousTagHash = this.hashOrNull(unanimousTagUrl);
      const discovered =
        (await this.resolveSidecar(folder)) ??
        (unanimousTagUrl && unanimousTagHash ? { feedUrl: unanimousTagUrl, hash: unanimousTagHash, source: 'feed_url_tag' as const } : null);
      if (discovered) {
        // A folder whose feed is already subscribed is neither an offer nor a candidate: its files
        // simply did not match, which the unmatched group already reports.
        if (showIndex.byFeedHash.has(discovered.hash) || suggestedFeeds.length >= MAX_SUGGESTED_FEEDS) continue;
        suggestedFeeds.push({
          folderPath: relative(root, folder.path),
          feedUrl: discovered.feedUrl,
          source: discovered.source,
          fileCount: folder.fileCount,
        });
        continue;
      }
      if (unclaimed.length >= MAX_UNCLAIMED_FOLDERS) continue;
      unclaimed.push({ folder, metadata: await this.deriveShowMetadata(folder) });
    }
    const existing = await this.catalog.findLocalPodcastIdsByFolders(
      libraryId,
      unclaimed.map((entry) => entry.folder.path),
    );
    return {
      suggestedFeeds,
      unclaimedFolders: unclaimed.map(({ folder, metadata }) => ({
        folderPath: relative(root, folder.path),
        suggestedTitle: metadata.title,
        suggestedAuthor: metadata.author,
        fileCount: folder.fileCount,
        existingPodcastId: existing.get(folder.path) ?? null,
      })),
    };
  }

  /**
   * What a folder would become as a show. An Audiobookshelf-style `metadata.json` is authoritative
   * when it is there; otherwise a tag the whole folder agrees on stands in, and the folder's own
   * name is the answer of last resort - it is the one thing every folder has.
   */
  private async deriveShowMetadata(folder: FolderContext): Promise<LocalShowMetadata> {
    return deriveLocalShowMetadata(folder);
  }

  private async resolveSidecar(folder: FolderContext): Promise<DiscoveredFeed | null> {
    if (folder.sidecar !== undefined) return folder.sidecar;
    folder.sidecar = null;
    if (folder.feedSidecarPath) {
      const feedUrl = await this.readSelfLink(folder.feedSidecarPath);
      const hash = this.hashOrNull(feedUrl);
      if (feedUrl && hash) folder.sidecar = { feedUrl, hash, source: 'feed_sidecar' };
    }
    if (!folder.sidecar && folder.metadataSidecarPath) {
      const feedUrl = await this.readMetadataFeedUrl(folder.metadataSidecarPath);
      const hash = this.hashOrNull(feedUrl);
      if (feedUrl && hash) folder.sidecar = { feedUrl, hash, source: 'metadata_json' };
    }
    return folder.sidecar;
  }

  /**
   * A saved feed's own address, which is the `rel="self"` link. The channel `<link>` is deliberately
   * not read: that is the show's website, and hashing it would compare against the wrong thing.
   */
  private async readSelfLink(path: string): Promise<string | null> {
    const xml = await readBoundedTextFile(path, SIDECAR_MAX_BYTES);
    if (!xml) return null;
    for (const tag of xml.match(/<[^>]*\blink\b[^>]*>/gi) ?? []) {
      if (!/\brel\s*=\s*["']self["']/i.test(tag)) continue;
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (href) return href.trim();
    }
    return null;
  }

  private async readMetadataFeedUrl(path: string): Promise<string | null> {
    const raw = await readBoundedTextFile(path, SIDECAR_MAX_BYTES);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      const feedUrl = (parsed as { feedUrl?: unknown })?.feedUrl;
      return typeof feedUrl === 'string' && feedUrl.trim().length > 0 ? feedUrl.trim() : null;
    } catch {
      return null;
    }
  }

  /** Tag and sidecar URLs are third-party text, so an unparseable one is simply not a signal. */
  private hashOrNull(url: string | null): string | null {
    if (!url) return null;
    try {
      return this.secrets.hashUrl(url);
    } catch {
      return null;
    }
  }
}

function parseImportOptions(payload: Record<string, unknown>): ImportOptions {
  const podcastId = payload.podcastId;
  const rawResolutions = Array.isArray(payload.resolutions) ? payload.resolutions : [];
  const resolutions: PodcastImportResolution[] = [];
  for (const entry of rawResolutions.slice(0, PODCAST_IMPORT_MAX_RESOLUTIONS)) {
    const path = (entry as { path?: unknown })?.path;
    const episodeId = (entry as { episodeId?: unknown })?.episodeId;
    if (typeof path !== 'string' || !path || !Number.isInteger(episodeId) || (episodeId as number) <= 0) {
      throw new BadRequestException('Invalid podcast import resolution');
    }
    resolutions.push({ path, episodeId: episodeId as number });
  }
  if (podcastId !== undefined && podcastId !== null && (!Number.isInteger(podcastId) || (podcastId as number) <= 0)) {
    throw new BadRequestException('Invalid podcast import job');
  }
  return { dryRun: payload.dryRun !== false, podcastId: (podcastId as number | undefined) ?? null, resolutions };
}

/**
 * Drops the misses that the unclaimed-folder offer already covers.
 *
 * Every file in a folder that belongs to no show reports `show_unresolved`, which is true but not
 * actionable on its own: the action is on the folder, and it is offered once. Leaving the files in
 * as well would fill a capped list with entries nobody can do anything about, pushing out the
 * misses that are actionable - a file whose show resolved but whose episode did not.
 */
function dropFilesCoveredByUnclaimedFolders(
  unmatched: PodcastImportUnmatchedFile[],
  unclaimedFolders: PodcastImportUnclaimedFolder[],
): PodcastImportUnmatchedFile[] {
  if (unclaimedFolders.length === 0) return unmatched;
  const covered = new Set(unclaimedFolders.map((folder) => folder.folderPath));
  return unmatched.filter((file) => file.reason !== 'show_unresolved' || !covered.has(parentFolderPath(file.path)));
}

/** The folder half of a library-relative file path. A file sitting in the library root has none. */
function parentFolderPath(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separator === -1 ? '' : path.slice(0, separator);
}

function fileSummary(file: CandidateFile | PodcastImportMatchedFile) {
  const path = 'relativePath' in file ? file.relativePath : file.path;
  return { path, fileName: file.fileName, sizeBytes: file.sizeBytes };
}
