import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Dirent } from 'fs';
import { readdir, realpath, stat } from 'fs/promises';
import { basename, extname, isAbsolute, join, relative } from 'path';
import { pathToFileURL } from 'url';

import { PODCAST_ERROR_CODES } from '@bookorbit/types';
import { buildNameExcludeMatcher } from '../../common/fs-walk.utils';
import { waitForStability } from '../../common/utils/fs-stability.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { PodcastJob } from '../../db/schema';
import { PodcastGateway } from './podcast.gateway';
import { PodcastArtworkService } from './podcast-artwork.service';
import {
  deriveLocalShowMetadata,
  hashFileHandle,
  localIdentityHash,
  type LocalShowMetadata,
  PodcastImportCancelledError,
  type PodcastImportFolderMetadataContext,
  readBoundedBinaryFile,
} from './podcast-import-files';
import { PodcastJobRepository } from './podcast-job.repository';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastEpisodeRepository } from './podcast-episode.repository';
import { METADATA_SIDECAR_NAME, PodcastSidecarService } from './podcast-sidecar.service';
import {
  AUDIO_EXTENSIONS,
  isPodcastPathInsideRoot as isPathInsideRoot,
  openRegularFileWithinRoot,
  resolveAudioMediaType,
} from './podcast-media-storage.service';
import { parsePodcastFileNameHints, PodcastTagReaderService } from './podcast-tag-reader.service';

const MAX_LOCAL_SHOW_FILES = 20_000;
const LOCAL_SHOW_PAGE_SIZE = 200;
/** How many files a new show reads its name and artwork from. A folder agrees or it does not. */
const SHOW_METADATA_SAMPLE_SIZE = 10;
const ADOPTED_PATH_PAGE_SIZE = 1000;
const PROGRESS_INTERVAL = 25;
const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
/** The names the podcast clients and the books scanner both write show artwork under. */
const ARTWORK_SIDECAR_NAMES = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'folder.jpg', 'folder.png'];
/** BookOrbit's own partial downloads and the usual desktop clutter never carry a podcast. */
const EXCLUDED_NAMES = ['@eaDir', 'lost+found', '#recycle', '*.part'];

/**
 * How deep inside a show folder episodes are looked for. Archives file episodes under `Season 01/`
 * or `2023/` as readily as they keep them loose, and the cap is what keeps a root someone pointed at
 * their whole drive from being walked to the bottom.
 */
const MAX_LOCAL_SHOW_DEPTH = 3;

/** The roots of one podcast library, resolved through symlinks and ready to compare paths against. */
export interface PodcastLibraryRoots {
  /** Where BookOrbit downloads. Null when the folder is gone or unreadable. */
  downloads: string | null;
  /** Roots holding folders the user brought. New folders under these become shows on their own. */
  local: string[];
  /** Every root, for the checks that only ask whether a path belongs to this library at all. */
  all: string[];
}

export interface LocalShowSyncResult {
  outcome: 'created' | 'rescan' | 'deferred' | 'skipped';
  jobId: number | null;
}

/** What one discovery sweep changed: shows found, shows rescanned, and folders that came and went. */
export interface LocalShowDiscoveryResult {
  discovered: number;
  rescans: number;
  missing: number;
  restored: number;
}

export interface LocalShowFolder {
  absolutePath: string;
  relativePath: string;
  metadata: LocalShowMetadata;
}

interface LocalCandidateFile {
  absolutePath: string;
  fileName: string;
  sizeBytes: number;
  modifiedAt: Date;
}

interface FolderContext extends PodcastImportFolderMetadataContext {
  folderPodcastId: number | null;
  feedSidecarPath: string | null;
  sidecar: null;
  fileCount: number;
  resolvedShow: false;
  tagFeedUrls: Set<string>;
  tagFeedUrlsIncomplete: false;
}

@Injectable()
export class PodcastLocalShowImportService {
  private readonly logger = new Logger(PodcastLocalShowImportService.name);

  constructor(
    private readonly catalog: PodcastCatalogRepository,
    private readonly episodes: PodcastEpisodeRepository,
    private readonly jobs: PodcastJobRepository,
    private readonly tagReader: PodcastTagReaderService,
    private readonly artwork: PodcastArtworkService,
    private readonly sidecars: PodcastSidecarService,
    private readonly gateway: PodcastGateway,
  ) {}

  private async deriveShowMetadata(folder: PodcastImportFolderMetadataContext): Promise<LocalShowMetadata> {
    return deriveLocalShowMetadata(folder);
  }
  async resolveLibraryRoots(libraryId: number): Promise<PodcastLibraryRoots> {
    const [downloadsPath, localPaths] = await Promise.all([
      this.catalog.findPrimaryLibraryFolder(libraryId),
      this.catalog.findLocalLibraryFolders(libraryId),
    ]);
    const downloads = downloadsPath ? await realpath(downloadsPath).catch(() => null) : null;
    const local = (await Promise.all(localPaths.map((path) => realpath(path).catch(() => null)))).filter((path): path is string => path !== null);
    return { downloads, local, all: downloads ? [downloads, ...local] : local };
  }

  /**
   * One pass of automatic local-show upkeep for a library: a folder in a local root that is not a
   * show yet becomes one, and a registered show whose folder holds audio it has not adopted gets a
   * `local_import` job. Both halves are idempotent, so the watcher, the periodic pass, and a manual
   * import can overlap freely; the job dedupe key collapses whatever they agree on.
   *
   * Only local roots are swept. A new folder under the downloads root is BookOrbit's own work
   * landing, which is why a show there has to be asked for through the import report instead.
   *
   * The same pass is where a show whose folder is gone gets flagged missing, and where one whose
   * folder is back gets cleared. The row is never removed: a drive that is merely unmounted would
   * otherwise cost the listening history, and the flag costs nothing to undo.
   */
  async runLocalShowDiscovery(libraryId: number): Promise<LocalShowDiscoveryResult> {
    const event = 'podcast.local_discovery';
    const startedAt = Date.now();
    let discovered = 0;
    let rescans = 0;
    let missing = 0;
    let restored = 0;
    const roots = await this.resolveLibraryRoots(libraryId);
    // Every root being unreachable is a mount problem, not a library of deleted shows: leaving early
    // keeps a blipped share from flagging everything under it missing.
    if (roots.all.length === 0) return { discovered, rescans, missing, restored };

    const shouldExclude = buildNameExcludeMatcher(EXCLUDED_NAMES);
    for (const localRoot of roots.local) {
      const entries = await readdir(localRoot, { withFileTypes: true }).catch(() => [] as Dirent[]);
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || shouldExclude(entry.name)) continue;
        const absolutePath = await realpath(join(localRoot, entry.name)).catch(() => null);
        if (!absolutePath || (await this.catalog.findLocalPodcastByFolder(libraryId, absolutePath))) continue;
        const result = await this.syncLocalShowFolder(libraryId, absolutePath);
        if (result.outcome === 'created') discovered++;
      }
    }

    let afterId = 0;
    for (;;) {
      const shows = await this.catalog.findActiveLocalPodcasts(libraryId, afterId, LOCAL_SHOW_PAGE_SIZE);
      for (const show of shows) {
        afterId = show.id;
        if (!show.localFolderPath) continue;
        const folderPath = await realpath(show.localFolderPath).catch(() => null);
        if (!folderPath) {
          if (await this.catalog.setLocalPodcastMissing(show.id, true)) missing++;
          continue;
        }
        if (show.missingAt && (await this.catalog.setLocalPodcastMissing(show.id, false))) restored++;
        if (!isInsideAnyRoot(roots.all, folderPath)) continue;
        if (!(await this.folderHasUnadoptedAudio(folderPath, show.id))) continue;
        const jobId = await this.jobs.enqueue({
          type: 'local_import',
          dedupeKey: `local_import:${show.id}`,
          libraryId,
          podcastId: show.id,
          payload: { folderPath: show.localFolderPath, applyShowMetadata: false },
        });
        if (jobId) rescans++;
      }
      if (shows.length < LOCAL_SHOW_PAGE_SIZE) break;
    }

    if (discovered > 0 || rescans > 0 || missing > 0 || restored > 0) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} discovered=${discovered} rescans=${rescans} missing=${missing} restored=${restored} - local show discovery completed`,
      );
    }
    return { discovered, rescans, missing, restored };
  }

  /**
   * Reacts to something disappearing under a watched root: the show that folder belongs to is
   * flagged missing, but only once the folder itself is really gone. A folder that is still there -
   * one file removed from inside it, or a delete undone before the debounce elapsed - is left alone,
   * as is a show the user already archived.
   */
  async markLocalShowMissingIfGone(libraryId: number, folderPath: string): Promise<boolean> {
    const info = await stat(folderPath).catch(() => null);
    if (info?.isDirectory()) return false;

    const show = await this.catalog.findLocalPodcastByFolder(libraryId, folderPath);
    if (!show || show.archivedAt) return false;
    const flagged = await this.catalog.setLocalPodcastMissing(show.id, true);
    if (flagged) {
      this.logger.log(
        `[podcast.local_missing] [end] libraryId=${libraryId} podcastId=${show.id} folder="${sanitizeLogValue(folderPath)}" - local show folder gone from disk`,
      );
    }
    return flagged;
  }

  /**
   * Brings one folder in line with the show it is or should be: a registered show gets a rescan job
   * when its folder holds unadopted audio, an unregistered folder with audio becomes a new show.
   * Everything that is not a syncable folder - vanished, empty, archived, outside every root - is a
   * quiet `skipped`, because the callers are watchers and sweeps reacting to filesystem noise, not
   * users awaiting an error. `deferred` means an import for this show is already running; the
   * caller should try again later rather than assume the new files were seen.
   */
  async syncLocalShowFolder(libraryId: number, folderPath: string): Promise<LocalShowSyncResult> {
    const skipped: LocalShowSyncResult = { outcome: 'skipped', jobId: null };
    const roots = await this.resolveLibraryRoots(libraryId);
    const absolutePath = await this.resolveFolderWithinRoots(roots, folderPath).catch(() => null);
    if (!absolutePath) return skipped;
    const info = await stat(absolutePath).catch(() => null);
    if (!info?.isDirectory()) return skipped;

    const existing = await this.catalog.findLocalPodcastByFolder(libraryId, absolutePath);
    if (existing) {
      if (existing.archivedAt) return skipped;
      // The folder is here and readable, so clear the flag before the no-new-audio exit: a show that
      // came back unchanged is still a show that came back.
      if (existing.missingAt) await this.catalog.setLocalPodcastMissing(existing.id, false);
      if (!(await this.folderHasUnadoptedAudio(absolutePath, existing.id))) return skipped;
      const jobId = await this.jobs.enqueue({
        type: 'local_import',
        dedupeKey: `local_import:${existing.id}`,
        libraryId,
        podcastId: existing.id,
        payload: { folderPath: absolutePath, applyShowMetadata: false },
      });
      return { outcome: jobId ? 'rescan' : 'deferred', jobId };
    }

    let folder: LocalShowFolder;
    try {
      folder = await this.resolveLocalShowFolder(libraryId, absolutePath);
    } catch {
      return skipped;
    }
    const { podcast, created } = await this.catalog.createLocalPodcast(libraryId, folder.absolutePath, folder.metadata);
    const jobId = await this.jobs.enqueue({
      type: 'local_import',
      dedupeKey: `local_import:${podcast.id}`,
      libraryId,
      podcastId: podcast.id,
      payload: { folderPath: folder.absolutePath, applyShowMetadata: created },
    });
    if (created) {
      this.logger.log(
        `[podcast.local_discovery_create] [end] libraryId=${libraryId} podcastId=${podcast.id} jobId=${jobId ?? 'none'} - local show registered from watched folder`,
      );
    }
    return { outcome: created ? 'created' : 'rescan', jobId };
  }

  /**
   * Checks that a folder the client named is a real directory inside this library and holds audio,
   * and reads what the show it would become should be called.
   *
   * The path arrives from a client, so it is treated as untrusted: it is resolved against the
   * library's own roots and the resolved target has to still be inside one of them, which is what
   * stops a traversal or a symlink from pointing the import somewhere else.
   */
  async resolveLocalShowFolder(libraryId: number, folderPath: string): Promise<LocalShowFolder> {
    const roots = await this.resolveLibraryRoots(libraryId);
    if (roots.all.length === 0) throw new NotFoundException('Podcast library storage folder not found');
    const absolutePath = await this.resolveFolderWithinRoots(roots, folderPath);
    const info = await stat(absolutePath).catch(() => null);
    if (!info?.isDirectory()) throw new BadRequestException('Local podcast source must be a folder');

    const folder = await this.readLocalFolderContext(absolutePath);
    const candidates = await this.listLocalAudioFiles(absolutePath);
    if (candidates.length === 0) {
      throw new BadRequestException({ message: 'This folder holds no importable audio', errorCode: PODCAST_ERROR_CODES.localFolderEmpty });
    }
    folder.fileCount = candidates.length;
    const owningRoot = roots.all.find((root) => isPathInsideRoot(root, absolutePath)) ?? roots.all[0]!;
    return { absolutePath, relativePath: relative(owningRoot, absolutePath), metadata: await this.deriveShowMetadata(folder) };
  }

  /**
   * Resolves a folder a caller named against this library's roots.
   *
   * An absolute path has to land inside one of them; a relative one is taken against the downloads
   * root, which is what the import report's folder paths are relative to. Either way the check runs
   * on the realpath, so a symlink cannot be used to walk the import out of the library.
   */
  private async resolveFolderWithinRoots(roots: PodcastLibraryRoots, folderPath: string): Promise<string> {
    if (folderPath.split(/[\\/]/).includes('..')) throw new BadRequestException('Folder is outside the library folders');
    const target = isAbsolute(folderPath) ? folderPath : roots.downloads ? join(roots.downloads, folderPath) : null;
    if (!target) throw new NotFoundException('Podcast library storage folder not found');
    let absolutePath: string;
    try {
      absolutePath = await realpath(target);
    } catch {
      throw new NotFoundException('Folder not found in this library');
    }
    if (!isInsideAnyRoot(roots.all, absolutePath)) throw new BadRequestException('Folder is outside the library folders');
    return absolutePath;
  }

  /**
   * Turns every audio file in a local show's folder into an episode of it.
   *
   * Identity comes from the file's own bytes, so a run over an unchanged folder writes nothing and
   * a run after one file was added writes exactly one episode. That is deliberately the whole
   * refresh story for a show with no feed: there is nothing to poll, only the folder to re-read.
   */
  async processLocalImport(job: PodcastJob): Promise<{ added: number; scanned: number }> {
    const event = 'podcast.local_import';
    const startedAt = Date.now();
    const podcastId = job.podcastId;
    if (!podcastId) throw new BadRequestException('Podcast local import job is missing podcastId');
    const applyShowMetadata = job.payload.applyShowMetadata === true;
    this.logger.log(
      `[${event}] [start] jobId=${job.id} libraryId=${job.libraryId} podcastId=${podcastId} applyShowMetadata=${applyShowMetadata} - local podcast import started`,
    );
    try {
      const result = await this.runLocalImport(job, podcastId, applyShowMetadata);
      this.logger.log(
        `[${event}] [end] jobId=${job.id} podcastId=${podcastId} durationMs=${Date.now() - startedAt} scanned=${result.scanned} added=${result.added} - local podcast import completed`,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${event}] [fail] jobId=${job.id} podcastId=${podcastId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - local podcast import failed`,
      );
      throw error;
    }
  }

  private async runLocalImport(job: PodcastJob, podcastId: number, applyShowMetadata: boolean): Promise<{ added: number; scanned: number }> {
    const podcast = await this.catalog.findPodcast(podcastId);
    if (!podcast || podcast.origin !== 'local' || !podcast.localFolderPath) throw new NotFoundException('Local podcast not found');
    const roots = await this.resolveLibraryRoots(job.libraryId);
    if (roots.all.length === 0) throw new NotFoundException('Podcast library storage folder not found');
    const folderPath = await realpath(podcast.localFolderPath).catch(() => null);
    if (!folderPath) throw new NotFoundException('Local podcast folder no longer exists');
    if (!isInsideAnyRoot(roots.all, folderPath)) throw new BadRequestException('Local podcast folder is outside the library folders');
    const root = roots.all.find((candidate) => isPathInsideRoot(candidate, folderPath))!;

    const candidates = await this.listLocalAudioFiles(folderPath);
    const adopted = await this.loadShowMediaPaths(podcastId);
    const pending = candidates.filter((candidate) => !adopted.has(candidate.absolutePath));
    await this.jobs.updateProgress(job.id, 0, pending.length);

    // Adoption counts against the quota exactly as a download does, so a folder that does not fit
    // is refused outright rather than being allowed to trigger eviction of somebody else's episode.
    const settings = await this.catalog.getLibrarySettings(job.libraryId);
    const headroomBytes = settings.storageQuotaBytes > settings.usedStorageBytes ? settings.storageQuotaBytes - settings.usedStorageBytes : 0n;
    const adoptBytes = pending.reduce((total, candidate) => total + BigInt(candidate.sizeBytes), 0n);
    if (adoptBytes > headroomBytes) {
      throw new BadRequestException('Importing this folder would exceed the podcast library storage quota. Raise the quota or import fewer files.');
    }

    let added = 0;
    let processed = 0;
    let lastReported = 0;
    const probes: Array<{ candidate: LocalCandidateFile; probe: Awaited<ReturnType<PodcastTagReaderService['readForImport']>> }> = [];
    for (const candidate of pending) {
      if (await this.jobs.isCancellationRequested(job.id)) throw new PodcastImportCancelledError();
      // The watcher fires while a file is still being copied in. Identity is the file's own bytes,
      // so adopting mid-copy would store a checksum the finished file will not have; wait for the
      // size to settle, and let a file that vanished during the wait fall to the next run.
      await waitForStability(candidate.absolutePath, candidate.modifiedAt.getTime());
      const current = await stat(candidate.absolutePath).catch(() => null);
      if (current?.isFile()) {
        const probe = await this.tagReader.readForImport(candidate.absolutePath);
        if (applyShowMetadata && probes.length < SHOW_METADATA_SAMPLE_SIZE) probes.push({ candidate, probe });
        if (await this.adoptLocalFile(root, podcastId, candidate, probe)) added++;
      }
      processed++;
      if (processed - lastReported >= PROGRESS_INTERVAL || processed === pending.length) {
        lastReported = processed;
        await this.jobs.updateProgress(job.id, processed, pending.length);
        // Announced as the show grows rather than only at the end, so a folder of hundreds of files
        // appears in the library while it is still being read.
        this.announceShow(job.libraryId, podcastId, podcast.title, adopted.size + added, applyShowMetadata);
      }
    }

    if (applyShowMetadata) await this.applyLocalShowMetadata(podcast.id, folderPath, probes);
    // The sidecar is the folder's copy of what BookOrbit knows, so it is only worth rewriting when
    // this run actually changed something. A rescan that adopted nothing leaves the file alone.
    if (added > 0 || applyShowMetadata) {
      const current = (await this.catalog.findPodcast(podcastId)) ?? podcast;
      await this.sidecars.writeShowSidecar(podcastId, folderPath, {
        title: current.title,
        author: current.author,
        description: current.description,
      });
      // The title is only settled once the metadata pass has run, so the last announcement is the
      // one that carries the name the show will actually be listed under.
      this.announceShow(job.libraryId, podcastId, current.title, adopted.size + added, applyShowMetadata);
    }
    return { added, scanned: pending.length };
  }

  /** Never throws: a show that could not be announced is still imported, just not shown early. */
  private announceShow(libraryId: number, podcastId: number, title: string, episodes: number, created: boolean): void {
    try {
      this.gateway.emitShowDiscovered({ libraryId, podcastId, title, episodes, created });
    } catch (error) {
      this.logger.debug(
        `[podcast.show_discovered] [fail] podcastId=${podcastId} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - show announcement failed`,
      );
    }
  }

  /**
   * Adopts one file as an episode. The file stays exactly where it is - the media row points at it
   * rather than at a copy, which is what makes the whole thing reversible by deleting the show.
   */
  private async adoptLocalFile(
    root: string,
    podcastId: number,
    candidate: LocalCandidateFile,
    probe: Awaited<ReturnType<PodcastTagReaderService['readForImport']>>,
  ): Promise<boolean> {
    const mediaType = resolveAudioMediaType(pathToFileURL(candidate.absolutePath), null);
    if (!mediaType) return false;
    const opened = await openRegularFileWithinRoot(root, candidate.absolutePath);
    let checksum: string;
    let sizeBytes: number;
    try {
      checksum = await hashFileHandle(opened.handle);
      sizeBytes = opened.size;
    } finally {
      await opened.handle.close();
    }
    const media = {
      status: 'local' as const,
      localPath: candidate.absolutePath,
      fileName: candidate.fileName,
      format: mediaType.extension.slice(1),
      mimeType: mediaType.contentType,
      sizeBytes,
      checksum,
      downloadedAt: new Date(),
      lastError: null,
    };
    const identityHash = localIdentityHash(checksum);
    const hints = parsePodcastFileNameHints(candidate.fileName);
    const inserted = await this.episodes.insertLocalEpisode(
      podcastId,
      {
        identityHash,
        title: (probe?.title ?? hints.title ?? basename(candidate.fileName, extname(candidate.fileName))).slice(0, 2000),
        description: probe?.description ?? null,
        // A numbered show writes its own ordering into the track tag. The sorts stay driven by
        // `published_at`, but the number the files agree on is worth keeping and showing.
        episode: probe?.trackNumber ?? null,
        // Every existing sort is by published date, so a file with no date signal at all falls back
        // to its own mtime rather than sorting as undated and losing the folder's natural order.
        publishedAt: probe?.publishedAt ?? hints.publishedAt ?? candidate.modifiedAt,
        durationSeconds: probe?.durationSeconds ?? null,
        chapters: probe?.chapters ?? [],
        lastSeenAt: new Date(),
      },
      media,
    );
    // Bytes that reappear after their file was removed make the episode playable again rather than
    // arriving as a second copy of an episode that is already there.
    if (!inserted) await this.episodes.restoreLocalEpisodeMedia(podcastId, identityHash, media);
    return inserted;
  }

  /**
   * Names the show and gives it artwork, once, when it is created. A later run never touches this:
   * a local show has no feed to re-derive from, so whatever is stored is either what the import
   * concluded or what the user edited afterwards, and neither should be overwritten.
   */
  private async applyLocalShowMetadata(
    podcastId: number,
    folderPath: string,
    probes: Array<{ candidate: LocalCandidateFile; probe: Awaited<ReturnType<PodcastTagReaderService['readForImport']>> }>,
  ): Promise<void> {
    const folder = await this.readLocalFolderContext(folderPath);
    for (const { probe } of probes) {
      if (probe?.album) folder.albumTags.add(probe.album);
      if (probe?.artist) folder.artistTags.add(probe.artist);
    }
    const metadata = await this.deriveShowMetadata(folder);
    await this.catalog.updatePodcast(podcastId, metadata);
    const artwork = await this.readFolderArtwork(folderPath, probes);
    if (!artwork) return;
    try {
      await this.artwork.saveCustomArtwork(podcastId, artwork);
      await this.catalog.updatePodcast(podcastId, { customArtworkAt: new Date() });
    } catch (error) {
      // Artwork the folder happened to carry is a bonus, never a reason to fail the whole import.
      this.logger.warn(
        `[podcast.local_import_artwork] [fail] podcastId=${podcastId} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - local podcast artwork could not be stored`,
      );
    }
  }

  /** A `cover`-family sidecar first, then the first embedded image any of the sampled files carries. */
  private async readFolderArtwork(
    folderPath: string,
    probes: Array<{ candidate: LocalCandidateFile; probe: Awaited<ReturnType<PodcastTagReaderService['readForImport']>> }>,
  ): Promise<Buffer | null> {
    for (const name of ARTWORK_SIDECAR_NAMES) {
      const data = await readBoundedBinaryFile(join(folderPath, name), MAX_ARTWORK_BYTES);
      if (data) return data;
    }
    for (const { candidate, probe } of probes) {
      if (!probe?.hasEmbeddedCover) continue;
      const embedded = await this.tagReader.extractEmbeddedCover(candidate.absolutePath);
      if (embedded) return embedded;
    }
    return null;
  }

  /**
   * The audio inside one show's folder, including the subfolders archives file episodes under such
   * as `Season 01` or `2023`. Depth is capped and so is the file count, so a show folder someone
   * pointed at half a drive still costs a bounded walk.
   *
   * Where in the tree a file sits carries no meaning: identity is the file's own bytes, so moving an
   * episode between subfolders reaches the same episode row rather than creating a second one.
   */
  private async listLocalAudioFiles(folderPath: string): Promise<LocalCandidateFile[]> {
    const shouldExclude = buildNameExcludeMatcher(EXCLUDED_NAMES);
    const candidates: LocalCandidateFile[] = [];
    const visit = async (dir: string, depth: number): Promise<void> => {
      if (candidates.length >= MAX_LOCAL_SHOW_FILES) return;
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        if (dir === folderPath) throw new NotFoundException('Local podcast folder could not be read');
        return;
      }
      const sorted = entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of sorted) {
        if (candidates.length >= MAX_LOCAL_SHOW_FILES) return;
        // A symlink is not followed here for the same reason the walk does not follow one: the
        // target can be moved outside the library after the check and before the read.
        if (entry.isSymbolicLink() || shouldExclude(entry.name)) continue;
        if (entry.isDirectory()) {
          if (depth < MAX_LOCAL_SHOW_DEPTH && !entry.name.startsWith('.')) await visit(join(dir, entry.name), depth + 1);
          continue;
        }
        if (!entry.isFile() || !AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
        const absolutePath = join(dir, entry.name);
        const info = await stat(absolutePath).catch(() => null);
        if (!info?.isFile() || info.size === 0) continue;
        candidates.push({ absolutePath, fileName: entry.name, sizeBytes: info.size, modifiedAt: info.mtime });
      }
    };
    await visit(folderPath, 0);
    return candidates;
  }

  /**
   * Whether a show's folder holds audio no media row claims yet. This is the pre-check that keeps
   * the periodic rescan from enqueueing a job for every unchanged folder, so it walks the same tree
   * the import would and only reaches for the adopted-path set once the folder holds audio at all.
   */
  private async folderHasUnadoptedAudio(folderPath: string, podcastId: number): Promise<boolean> {
    const candidates = await this.listLocalAudioFiles(folderPath).catch(() => [] as LocalCandidateFile[]);
    if (candidates.length === 0) return false;
    const adopted = await this.loadShowMediaPaths(podcastId);
    return candidates.some((candidate) => !adopted.has(candidate.absolutePath));
  }

  /** Absolute paths this show's media rows already claim, so a re-run only hashes what is new. */
  private async loadShowMediaPaths(podcastId: number): Promise<Set<string>> {
    const paths = new Set<string>();
    let afterEpisodeId = 0;
    for (;;) {
      const rows = await this.episodes.listPodcastMediaPaths(podcastId, afterEpisodeId, ADOPTED_PATH_PAGE_SIZE);
      if (rows.length === 0) break;
      for (const row of rows) {
        afterEpisodeId = row.episodeId;
        if (row.localPath) paths.add(row.localPath);
      }
      if (rows.length < ADOPTED_PATH_PAGE_SIZE) break;
    }
    return paths;
  }

  /** A folder context carrying only what the show-metadata derivation reads. */
  private async readLocalFolderContext(folderPath: string): Promise<FolderContext> {
    const folderName = basename(folderPath);
    const entries = await readdir(folderPath).catch(() => [] as string[]);
    return {
      path: folderPath,
      folderPodcastId: null,
      folderTitle: folderName.replace(/\s*\[\d+\]$/, '').trim() || folderName,
      feedSidecarPath: null,
      metadataSidecarPath: entries.some((name) => name.toLowerCase() === METADATA_SIDECAR_NAME) ? join(folderPath, METADATA_SIDECAR_NAME) : null,
      sidecar: null,
      fileCount: 0,
      resolvedShow: false,
      tagFeedUrls: new Set(),
      tagFeedUrlsIncomplete: false,
      albumTags: new Set(),
      artistTags: new Set(),
    };
  }
}

function isInsideAnyRoot(roots: string[], target: string): boolean {
  return roots.some((root) => isPathInsideRoot(root, target));
}
