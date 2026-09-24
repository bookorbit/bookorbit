import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, realpath, rm, stat } from 'fs/promises';
import { dirname, isAbsolute, join, relative } from 'path';

import { APP_FEATURES, DEFAULT_FORMAT_PRIORITY } from '@bookorbit/types';
import type { AccessLevel, LibraryFileSyncProgressEvent, LibraryOverviewEntry, OrganizationMode, WriteResult } from '@bookorbit/types';
import { podcastArtworkDirPath } from '../../common/podcast-artwork-storage';
import { podcastFeedSnapshotPath } from '../../common/podcast-feed-snapshot-storage';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizeIconValue } from '../../common/utils/icon-value.utils';
import type { RequestUser } from '../../common/types/request-user';
import type { LibraryFolder } from '../../db/schema/libraries';
import { AchievementEventsService, ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED } from '../achievement/achievement-events.service';
import { FileWriteService } from '../file-write/file-write.service';
import { PathPolicyService } from '../path/path-policy.service';
import { isPrimaryFormat } from '../scanner/lib/classify';
import { FileWatcherService } from '../scanner/file-watcher.service';
import { ScannerService } from '../scanner/scanner.service';
import { CreateLibraryDto } from './dto/create-library.dto';
import { GrantLibraryAccessDto } from './dto/grant-library-access.dto';
import { PrescanLibraryDto } from './dto/prescan-library.dto';
import { ReorderLibrariesDto } from './dto/reorder-libraries.dto';
import { UpdateLibraryDto } from './dto/update-library.dto';
import {
  DEFAULT_LIBRARY_ADDED_AT_SOURCE,
  DEFAULT_LIBRARY_COVER_ASPECT_RATIO,
  DEFAULT_LIBRARY_ORGANIZATION_MODE,
  LIBRARY_METADATA_PRECEDENCE_DEFAULT,
} from './library.constants';
import { resolveLibraryFolderRoles, type LibraryFolderInput } from './library-folder-roles.utils';
import { LibraryRepository } from './library.repository';
import { LibraryScanSchedulerService } from './library-scan-scheduler.service';

interface LibraryMetadataWriteStreamOptions {
  onProgress?: (event: LibraryFileSyncProgressEvent) => void;
  isCancelled?: () => boolean;
}

interface LibraryMetadataWriteSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
}

const BOOK_ONLY_LIBRARY_FIELDS = [
  'watch',
  'autoScanCronExpression',
  'metadataPrecedence',
  'formatPriority',
  'allowedFormats',
  'organizationMode',
  'deriveSeriesFromFolder',
  'excludePatterns',
  'readingThreshold',
  'markAsFinishedPercentComplete',
  'fileNamingPattern',
  'fileWriteEnabled',
  'fileWriteWriteCover',
  'fileWriteEpubEnabled',
  'fileWriteEpubMaxFileSizeMb',
  'fileWriteFb2Enabled',
  'fileWriteFb2MaxFileSizeMb',
  'fileWritePdfEnabled',
  'fileWritePdfMaxFileSizeMb',
  'fileWriteCbxEnabled',
  'fileWriteCbxMaxFileSizeMb',
  'fileWriteKindleEnabled',
  'fileWriteKindleMaxFileSizeMb',
  'fileWriteAudioEnabled',
  'fileWriteAudioMaxFileSizeMb',
  'fileRenameEnabled',
] as const;

const PODCAST_ONLY_LIBRARY_FIELDS = ['localFolders', 'watchLocalFolders'] as const;

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);
  private readonly appDataPath: string;

  constructor(
    private readonly libraryRepo: LibraryRepository,
    private readonly config: ConfigService,
    private readonly scannerService: ScannerService,
    private readonly fileWatcherService: FileWatcherService,
    private readonly fileWriteService: FileWriteService,
    private readonly achievementEvents: AchievementEventsService,
    private readonly pathPolicy: PathPolicyService,
    private readonly scanScheduler: LibraryScanSchedulerService,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async verifyUserAccess(userId: number, libraryId: number, isSuperuser: boolean): Promise<void> {
    if (isSuperuser) return;
    const hasAccess = await this.libraryRepo.hasUserAccess(userId, libraryId);
    if (!hasAccess) throw new ForbiddenException('No access to this library');
  }

  async verifyUserAccessLevel(userId: number, libraryId: number, isSuperuser: boolean, required: AccessLevel): Promise<void> {
    if (isSuperuser) return;
    const accessLevel = await this.libraryRepo.findUserAccessLevel(userId, libraryId);
    const rank: Record<AccessLevel, number> = { viewer: 1, editor: 2, owner: 3 };
    if (!accessLevel) throw new ForbiddenException('No access to this library');
    if (rank[accessLevel] < rank[required]) throw new ForbiddenException('Insufficient library access level');
  }

  async findAll(user: RequestUser) {
    const librariesForUser = user.isSuperuser
      ? await this.libraryRepo.findAll()
      : await this.libraryRepo.findAllForUser(user.id, user.contentFilters);
    const folders = await this.libraryRepo.findFoldersByLibraryIds(librariesForUser.map((library) => library.id));

    const foldersByLibraryId = new Map<number, LibraryFolder[]>();
    for (const folder of folders) {
      const currentFolders = foldersByLibraryId.get(folder.libraryId);
      if (currentFolders) {
        currentFolders.push(folder);
      } else {
        foldersByLibraryId.set(folder.libraryId, [folder]);
      }
    }

    return librariesForUser.map((library) => ({
      ...normalizeLibraryOrganizationMode(library),
      folders: (foldersByLibraryId.get(library.id) ?? []).map(({ id, path, role, createdAt }) => ({ id, path, role, createdAt })),
    }));
  }

  /**
   * Which of these users can open this library. Callers that hold user ids rather than whole
   * users - a notifier resolving one link per recipient, for instance - cannot ask
   * `verifyUserAccess`, which needs the superuser flag handed to it.
   */
  async findUserIdsWithAccess(libraryId: number, userIds: number[]): Promise<Set<number>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.libraryRepo.findUserIdsWithAccess(libraryId, userIds);
    return new Set(rows.map(({ id }) => id));
  }

  async findAccessibleLibraryIds(user: RequestUser): Promise<number[]> {
    const ids = user.isSuperuser ? await this.libraryRepo.findAllIds() : await this.libraryRepo.findAccessibleIdsForUser(user.id);
    return ids.map(({ id }) => id);
  }

  async findOne(id: number) {
    const [library] = await this.libraryRepo.findById(id);
    if (!library) throw new NotFoundException('Library not found');
    const folders = await this.libraryRepo.findFoldersByLibrary(id);
    return { ...normalizeLibraryOrganizationMode(library), folders };
  }

  async create(dto: CreateLibraryDto) {
    const libraryType = dto.type ?? 'books';
    if (libraryType === 'podcasts' && !APP_FEATURES.podcasts) {
      throw new BadRequestException('Podcast libraries are not available');
    }
    if (libraryType === 'podcasts') this.assertNoBookOnlyFields(dto);
    else this.assertNoPodcastOnlyFields(dto);
    await this.assertNameAvailable(dto.name);
    const folderInputs = resolveLibraryFolderRoles(
      libraryType,
      await this.assertFolderPathsWithinBrowseRoot(dto.folders),
      await this.assertFolderPathsWithinBrowseRoot(dto.localFolders ?? []),
    );
    const icon = normalizeIconValue(dto.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }

    const organizationMode =
      libraryType === 'books' ? (dto.organizationMode ?? DEFAULT_LIBRARY_ORGANIZATION_MODE) : DEFAULT_LIBRARY_ORGANIZATION_MODE;
    assertSeriesFromFolderAllowed(dto.deriveSeriesFromFolder, organizationMode);

    const [library] = await this.libraryRepo.insert({
      type: libraryType,
      name: dto.name,
      icon,
      displayOrder: dto.displayOrder ?? 0,
      watch: libraryType === 'books' ? (dto.watch ?? false) : false,
      watchLocalFolders: libraryType === 'podcasts' ? (dto.watchLocalFolders ?? true) : false,
      autoScanCronExpression: libraryType === 'books' ? (dto.autoScanCronExpression ?? null) : null,
      metadataPrecedence: libraryType === 'books' ? (dto.metadataPrecedence ?? [...LIBRARY_METADATA_PRECEDENCE_DEFAULT]) : [],
      formatPriority: libraryType === 'books' ? (dto.formatPriority ?? [...DEFAULT_FORMAT_PRIORITY]) : [],
      allowedFormats: libraryType === 'books' ? (dto.allowedFormats ?? []) : [],
      organizationMode,
      deriveSeriesFromFolder: dto.deriveSeriesFromFolder ?? false,
      addedAtSource: dto.addedAtSource ?? DEFAULT_LIBRARY_ADDED_AT_SOURCE,
      excludePatterns: libraryType === 'books' ? (dto.excludePatterns ?? []) : [],
      coverAspectRatio: dto.coverAspectRatio ?? (libraryType === 'podcasts' ? '1/1' : DEFAULT_LIBRARY_COVER_ASPECT_RATIO),
      readingThreshold: libraryType === 'books' ? (dto.readingThreshold ?? 0.25) : 0.25,
      markAsFinishedPercentComplete: libraryType === 'books' ? (dto.markAsFinishedPercentComplete ?? 98) : 98,
      fileNamingPattern: libraryType === 'books' ? (dto.fileNamingPattern ?? null) : null,
      fileWriteEnabled: libraryType === 'books' ? (dto.fileWriteEnabled ?? false) : false,
      fileWriteWriteCover: libraryType === 'books' ? (dto.fileWriteWriteCover ?? true) : false,
      fileWriteEpubEnabled: libraryType === 'books' ? (dto.fileWriteEpubEnabled ?? true) : false,
      fileWriteEpubMaxFileSizeMb: libraryType === 'books' ? (dto.fileWriteEpubMaxFileSizeMb ?? 100) : 100,
      fileWriteFb2Enabled: libraryType === 'books' ? (dto.fileWriteFb2Enabled ?? false) : false,
      fileWriteFb2MaxFileSizeMb: libraryType === 'books' ? (dto.fileWriteFb2MaxFileSizeMb ?? 100) : 100,
      fileWritePdfEnabled: libraryType === 'books' ? (dto.fileWritePdfEnabled ?? true) : false,
      fileWritePdfMaxFileSizeMb: libraryType === 'books' ? (dto.fileWritePdfMaxFileSizeMb ?? 100) : 100,
      fileWriteCbxEnabled: libraryType === 'books' ? (dto.fileWriteCbxEnabled ?? false) : false,
      fileWriteCbxMaxFileSizeMb: libraryType === 'books' ? (dto.fileWriteCbxMaxFileSizeMb ?? 500) : 500,
      fileWriteKindleEnabled: libraryType === 'books' ? (dto.fileWriteKindleEnabled ?? false) : false,
      fileWriteKindleMaxFileSizeMb: libraryType === 'books' ? (dto.fileWriteKindleMaxFileSizeMb ?? 100) : 100,
      fileWriteAudioEnabled: libraryType === 'books' ? (dto.fileWriteAudioEnabled ?? true) : false,
      fileWriteAudioMaxFileSizeMb: libraryType === 'books' ? (dto.fileWriteAudioMaxFileSizeMb ?? 500) : 500,
      fileRenameEnabled: libraryType === 'books' ? (dto.fileRenameEnabled ?? false) : false,
    });

    const folders = await this.libraryRepo.insertFolders(folderInputs.map(({ path, role }) => ({ libraryId: library.id, path, role })));

    if (library.type === 'podcasts') await this.libraryRepo.insertPodcastSettings(library.id);

    if (library.watch && library.type === 'books') {
      await this.fileWatcherService.startWatcher(
        library.id,
        folders.map((folder) => folder.path),
      );
    }

    this.scanScheduler.syncSchedule(library.id, dto.autoScanCronExpression ?? null);
    if (library.type === 'books') this.scannerService.startScanAsync(library.id);

    return { ...normalizeLibraryOrganizationMode(library), folders };
  }

  async update(id: number, dto: UpdateLibraryDto) {
    const [existing] = await this.libraryRepo.findById(id);
    if (!existing) throw new NotFoundException('Library not found');
    if (existing.type === 'podcasts') this.assertNoBookOnlyFields(dto);
    else this.assertNoPodcastOnlyFields(dto);

    const existingOrganizationMode = normalizeOrganizationMode(existing.organizationMode);
    if (dto.organizationMode !== undefined && dto.organizationMode !== existingOrganizationMode) {
      throw new BadRequestException(
        'Library organization mode cannot be changed after creation. Create a new library to use a different organization mode.',
      );
    }
    assertSeriesFromFolderAllowed(dto.deriveSeriesFromFolder, existingOrganizationMode);

    if (dto.name && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name, id);
    }

    const { folders: rawFolderPaths, localFolders: rawLocalFolderPaths, ...fields } = dto;
    let existingFolders: Awaited<ReturnType<LibraryRepository['findFoldersByLibrary']>> | undefined;
    let folderInputs: LibraryFolderInput[] | undefined;
    if (rawFolderPaths !== undefined || rawLocalFolderPaths !== undefined) {
      existingFolders = await this.libraryRepo.findFoldersByLibrary(id);
      const downloads =
        rawFolderPaths === undefined
          ? existingFolders.filter((folder) => folder.role !== 'local').map((folder) => folder.path)
          : await this.assertFolderPathsWithinBrowseRoot(rawFolderPaths);
      const local =
        rawLocalFolderPaths === undefined
          ? existingFolders.filter((folder) => folder.role === 'local').map((folder) => folder.path)
          : await this.assertFolderPathsWithinBrowseRoot(rawLocalFolderPaths);
      folderInputs = resolveLibraryFolderRoles(existing.type, downloads, local);

      // Only the downloads root is BookOrbit's to move: it holds the files retention and playback
      // resolve by path. Local roots can come and go freely, since nothing was ever written there.
      if (existing.type === 'podcasts') {
        const currentDownloads = existingFolders.filter((folder) => folder.role !== 'local').map((folder) => folder.path);
        const nextDownloads = folderInputs.filter((folder) => folder.role === 'downloads').map((folder) => folder.path);
        const storageFolderChanged =
          currentDownloads.length !== nextDownloads.length || currentDownloads.some((path) => !nextDownloads.includes(path));
        if (storageFolderChanged) {
          if (await this.libraryRepo.hasPodcastMediaFiles(id)) {
            throw new ConflictException('Remove downloaded podcast files before changing the podcast storage folder.');
          }
          if (await this.libraryRepo.hasBlockingPodcastStorageJobs(id)) {
            throw new ConflictException('Podcast storage work is in progress. Retry the storage folder change shortly.');
          }
        }
      }
    }
    const icon = fields.icon !== undefined ? normalizeIconValue(fields.icon) : normalizeIconValue(existing.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    if (fields.icon !== undefined) {
      fields.icon = icon;
    }

    const [updated] = await this.libraryRepo.update(id, fields);
    if (dto.autoScanCronExpression !== undefined) this.scanScheduler.syncSchedule(id, dto.autoScanCronExpression);

    if (folderInputs !== undefined) {
      existingFolders ??= await this.libraryRepo.findFoldersByLibrary(id);
      const keyOf = (folder: { path: string; role: string }) => `${folder.role}:${folder.path}`;
      const nextKeys = new Set(folderInputs.map(keyOf));
      const existingKeys = new Set(existingFolders.map(keyOf));

      const toRemove = existingFolders.filter((f) => !nextKeys.has(keyOf(f)));
      await Promise.all(toRemove.map((f) => this.libraryRepo.deleteFolder(f.id)));

      const toAdd = folderInputs.filter((f) => !existingKeys.has(keyOf(f)));
      if (toAdd.length > 0) {
        await this.libraryRepo.insertFolders(toAdd.map(({ path, role }) => ({ libraryId: id, path, role })));
      }
    }

    const folders = await this.libraryRepo.findFoldersByLibrary(id);

    const watchChanged = existing.type === 'books' && dto.watch !== undefined && dto.watch !== existing.watch;
    const nextWatch = existing.type === 'books' && (dto.watch ?? existing.watch);
    if (watchChanged) {
      if (nextWatch) {
        await this.fileWatcherService.startWatcher(
          id,
          folders.map((f) => f.path),
        );
      } else {
        await this.fileWatcherService.stopWatcher(id);
      }
    } else if (nextWatch && folderInputs !== undefined) {
      await this.fileWatcherService.startWatcher(
        id,
        folders.map((f) => f.path),
      );
    }

    const seriesFromFolderChanged =
      dto.deriveSeriesFromFolder !== undefined && dto.deriveSeriesFromFolder !== (existing.deriveSeriesFromFolder ?? false);
    const shouldRescan =
      dto.formatPriority !== undefined ||
      dto.allowedFormats !== undefined ||
      dto.excludePatterns !== undefined ||
      folderInputs !== undefined ||
      seriesFromFolderChanged;
    if (shouldRescan && existing.type === 'books') this.scannerService.startScanAsync(id);

    return { ...normalizeLibraryOrganizationMode(updated), folders };
  }

  async remove(id: number) {
    const [existing] = await this.libraryRepo.findById(id);
    if (!existing) throw new NotFoundException('Library not found');
    const event = 'library.delete';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${id} type=${existing.type} - library deletion started`);
    try {
      if (existing.type === 'podcasts') {
        const activeJobs = await this.libraryRepo.cancelPodcastJobs(id);
        if (activeJobs > 0) throw new ConflictException('Podcast jobs are still stopping. Retry library deletion shortly.');
      }
      await this.fileWatcherService.stopWatcher(id);
      const bookRows = await this.libraryRepo.findBookIdsByLibrary(id);
      const removedPodcastFiles = existing.type === 'podcasts' ? await this.removePodcastFiles(id) : 0;
      if (existing.type === 'podcasts') await this.removePodcastAppDataFiles(id);
      await this.libraryRepo.delete(id);
      this.scanScheduler.removeSchedule(id);
      await this.cleanupCoverDirectories(bookRows.map(({ id: bookId }) => bookId));
      this.logger.log(
        `[${event}] [end] libraryId=${id} durationMs=${Date.now() - startedAt} books=${bookRows.length} podcastFiles=${removedPodcastFiles} - library deletion completed`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${event}] [fail] libraryId=${id} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - library deletion failed`,
      );
      throw error;
    }
  }

  async prescan(dto: PrescanLibraryDto) {
    const allFolderPaths = await this.libraryRepo.findAllFolderPaths();

    const results = await Promise.all(
      dto.paths.map(async (inputPath) => {
        let accessible: boolean;
        let fileCount = 0;
        let error: string | undefined;
        let overlapLibrary: string | undefined;

        const resolvedInputPath = await this.pathPolicy.resolveBrowsePath(inputPath).catch(() => null);
        if (resolvedInputPath === null) {
          return {
            path: inputPath,
            accessible: false,
            fileCount: 0,
            error: 'Path is outside the configured library browse root',
          };
        }

        let inputStat: Awaited<ReturnType<typeof stat>> | null = null;
        try {
          inputStat = await stat(resolvedInputPath);
        } catch (err) {
          error = formatPrescanError(err);
        }

        if (inputStat === null) {
          accessible = false;
        } else if (!inputStat.isDirectory()) {
          return { path: resolvedInputPath, accessible: false, fileCount: 0, error: 'Not a directory' };
        } else {
          accessible = true;
          try {
            fileCount = await countPrimaryFiles(resolvedInputPath);
          } catch (err) {
            accessible = false;
            fileCount = 0;
            error = formatPrescanError(err);
          }
        }

        for (const existing of allFolderPaths) {
          if (dto.libraryId !== undefined && existing.libraryId === dto.libraryId) continue;
          if (pathsOverlap(resolvedInputPath, existing.path)) {
            overlapLibrary = existing.libraryName;
            break;
          }
        }

        return { path: resolvedInputPath, accessible, fileCount, overlapLibrary, error };
      }),
    );

    const totalFiles = results.reduce((sum, r) => sum + r.fileCount, 0);
    return { paths: results, totalFiles };
  }

  /**
   * Everything the libraries settings page needs about every library the caller can reach, in one
   * request: the stats that used to cost a fan-out of one call per library, plus each library's
   * most recent scan.
   */
  async getOverview(user: RequestUser): Promise<LibraryOverviewEntry[]> {
    const libraryIds = await this.findAccessibleLibraryIds(user);
    if (libraryIds.length === 0) return [];

    let stats: Awaited<ReturnType<LibraryRepository['getStatsForLibraries']>>;
    try {
      stats = await this.libraryRepo.getStatsForLibraries(libraryIds);
    } catch (err) {
      if (err instanceof RangeError) {
        throw new InternalServerErrorException('Library stats exceed supported size range');
      }
      throw err;
    }
    const lastScans = await this.scannerService.getLatestScans(libraryIds);

    return libraryIds.map((libraryId) => ({
      libraryId,
      totalBooks: stats.get(libraryId)?.totalBooks ?? 0,
      totalSizeBytes: stats.get(libraryId)?.totalSizeBytes ?? 0,
      formatCounts: stats.get(libraryId)?.formatCounts ?? {},
      lastScan: lastScans.get(libraryId) ?? null,
    }));
  }

  async getStats(libraryId: number) {
    const [existing] = await this.libraryRepo.findById(libraryId);
    if (!existing) throw new NotFoundException('Library not found');
    try {
      return await this.libraryRepo.getStats(libraryId);
    } catch (err) {
      if (err instanceof RangeError) {
        throw new InternalServerErrorException('Library stats exceed supported size range');
      }
      throw err;
    }
  }

  async reorder(dto: ReorderLibrariesDto) {
    const requestedIds = [...new Set(dto.order.map(({ id }) => id))];
    const visible = await this.libraryRepo.findByIds(requestedIds);
    if (visible.length !== requestedIds.length) throw new NotFoundException('Library not found');
    await this.libraryRepo.updateDisplayOrders(dto.order);
  }

  async getAccess(libraryId: number) {
    await this.assertLibraryAvailable(libraryId);
    return this.libraryRepo.getAccessWithUsers(libraryId);
  }

  async grantAccess(libraryId: number, dto: GrantLibraryAccessDto) {
    await this.assertLibraryAvailable(libraryId);
    const result = await this.libraryRepo.grantAccess(libraryId, dto.userId, dto.accessLevel);
    this.achievementEvents.emit(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId: dto.userId, libraryId });
    return result;
  }

  async updateAccess(libraryId: number, userId: number, accessLevel: AccessLevel) {
    await this.assertLibraryAvailable(libraryId);
    return this.libraryRepo.updateAccess(libraryId, userId, accessLevel);
  }

  async revokeAccess(libraryId: number, userId: number) {
    await this.assertLibraryAvailable(libraryId);
    const result = await this.libraryRepo.revokeAccess(libraryId, userId);
    this.achievementEvents.emit(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId, libraryId });
    return result;
  }

  async writeMetadataToFiles(
    libraryId: number,
    userId: number,
    dryRun: boolean,
    options: LibraryMetadataWriteStreamOptions = {},
  ): Promise<LibraryMetadataWriteSummary> {
    const [library] = await this.libraryRepo.findById(libraryId);
    if (!library) throw new NotFoundException('Library not found');

    if (!dryRun && !library.fileWriteEnabled) {
      throw new BadRequestException('Metadata file write is not enabled for this library.');
    }

    const rows = await this.fileWriteService.findNonMissingPrimaryFilesByLibrary(libraryId);
    const onProgress = options.onProgress ?? (() => undefined);
    const isCancelled = options.isCancelled ?? (() => false);

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      if (isCancelled()) break;

      let result: WriteResult;
      try {
        result = await this.fileWriteService.writeToFile(row.bookId, 'sync', userId, dryRun);
      } catch (err) {
        result = { status: 'failed', fieldsWritten: [], durationMs: 0, reason: getErrorMessage(err) };
      }

      if (result.status === 'success') succeeded++;
      else if (result.status === 'failed') failed++;
      else skipped++;

      onProgress({ bookId: row.bookId, status: result.status, reason: result.reason });
    }

    return {
      processed: succeeded + failed + skipped,
      succeeded,
      failed,
      skipped,
      cancelled: isCancelled(),
    };
  }

  private async assertNameAvailable(name: string, excludeId?: number) {
    const existing = await this.libraryRepo.findByName(name, excludeId);
    if (existing.length > 0) throw new ConflictException('A library with this name already exists');
  }

  private async assertLibraryAvailable(libraryId: number): Promise<void> {
    const [library] = await this.libraryRepo.findById(libraryId);
    if (!library) throw new NotFoundException('Library not found');
  }

  private async assertFolderPathsWithinBrowseRoot(paths: string[]): Promise<string[]> {
    return Promise.all(paths.map((path) => this.pathPolicy.assertWithinBrowseRoot(path)));
  }

  private assertNoBookOnlyFields(dto: object): void {
    const field = BOOK_ONLY_LIBRARY_FIELDS.find((key) => (dto as Record<string, unknown>)[key] !== undefined);
    if (field) throw new BadRequestException(`${field} is only supported for book libraries`);
  }

  private assertNoPodcastOnlyFields(dto: object): void {
    const field = PODCAST_ONLY_LIBRARY_FIELDS.find((key) => (dto as Record<string, unknown>)[key] !== undefined);
    if (field) throw new BadRequestException(`${field} is only supported for podcast libraries`);
  }

  private async removePodcastFiles(libraryId: number): Promise<number> {
    const folders = await this.libraryRepo.findFoldersByLibrary(libraryId);
    // Only the downloads root is swept. Local roots hold the user's own files, which BookOrbit
    // adopted where they lay and must leave behind when the library goes.
    const folder = folders.find((candidate) => candidate.role !== 'local');
    // A downloads root that is gone from disk, an unmounted drive or a renamed folder, resolves the
    // same way as a library that never had one: there is nothing inside it left to sweep. Letting
    // `realpath` throw here instead made the library undeletable behind a 500, because the raw ENOENT
    // escaped as something other than an HTTP failure. A null root still refuses further down if
    // media rows do exist, which is a 409 naming the missing folder rather than a crash.
    const root = folder ? await resolveExistingRoot(folder.path) : null;
    let removed = 0;
    let afterEpisodeId = 0;
    const removedPaths = new Set<string>();
    for (;;) {
      const files = await this.libraryRepo.findPodcastMediaFiles(libraryId, afterEpisodeId, 200);
      if (files.length === 0) break;
      for (const file of files) {
        afterEpisodeId = file.episodeId;
        if (!file.localPath) continue;
        removed += await this.removePodcastFileWithinRoot(root, file.localPath, removedPaths);
      }
      if (files.length < 200) break;
    }

    let afterJobId = 0;
    for (;;) {
      const jobs = await this.libraryRepo.findPodcastCleanupJobs(libraryId, afterJobId, 200);
      if (jobs.length === 0) break;
      for (const job of jobs) {
        afterJobId = job.id;
        const path = job.payload.path;
        if (typeof path !== 'string' || !path) continue;
        removed += await this.removePodcastFileWithinRoot(root, path, removedPaths);
      }
      if (jobs.length < 200) break;
    }
    return removed;
  }

  /** Custom show artwork and stored feed copies live in app data rather than the library folder, so the media sweep never reaches them. */
  private async removePodcastAppDataFiles(libraryId: number): Promise<number> {
    const event = 'library.remove_podcast_app_data';
    const startedAt = Date.now();
    let removed = 0;
    let afterPodcastId = 0;
    for (;;) {
      const rows = await this.libraryRepo.findPodcastIds(libraryId, afterPodcastId, 200);
      if (rows.length === 0) break;
      for (const row of rows) {
        afterPodcastId = row.id;
        try {
          await rm(podcastArtworkDirPath(this.appDataPath, row.id), { recursive: true, force: true });
          await rm(podcastFeedSnapshotPath(this.appDataPath, row.id), { force: true });
          removed++;
        } catch (error) {
          this.logger.warn(
            `[${event}] [fail] libraryId=${libraryId} podcastId=${row.id} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(getErrorMessage(error))}" - podcast app data cleanup failed`,
          );
        }
      }
      if (rows.length < 200) break;
    }
    return removed;
  }

  private async removePodcastFileWithinRoot(root: string | null, path: string, removedPaths: Set<string>): Promise<number> {
    if (!root) throw new ConflictException('Podcast library storage folder is missing');
    let target: string;
    try {
      target = await realpath(path);
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') return 0;
      throw error;
    }
    const relativePath = relative(root, target);
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
      isAbsolute(relativePath)
    ) {
      throw new BadRequestException('Podcast media path is outside its library storage folder');
    }
    if (removedPaths.has(target)) return 0;
    const info = await stat(target);
    if (!info.isFile()) throw new BadRequestException('Podcast media path is not a regular file');
    await rm(target, { force: true });
    await rm(dirname(target), { recursive: false }).catch(() => undefined);
    removedPaths.add(target);
    return 1;
  }

  private async cleanupCoverDirectories(bookIds: number[]): Promise<void> {
    const event = 'library.remove_cover_dirs';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] bookCount=${bookIds.length} - cover directory cleanup started`);

    let deletedCount = 0;
    let failedCount = 0;
    const concurrency = 10;

    for (let index = 0; index < bookIds.length; index += concurrency) {
      const chunk = bookIds.slice(index, index + concurrency);
      await Promise.all(
        chunk.map(async (bookId) => {
          const coverDir = join(this.appDataPath, 'covers', String(bookId));
          try {
            await rm(coverDir, { recursive: true, force: true });
            deletedCount++;
          } catch (err) {
            failedCount++;
            const errorClass = err instanceof Error ? err.name : 'Error';
            const errorMessage = sanitizeLogValue(getErrorMessage(err));
            this.logger.warn(
              `[${event}] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - cover directory cleanup failed`,
            );
          }
        }),
      );
    }

    this.logger.log(
      `[${event}] [end] bookCount=${bookIds.length} durationMs=${Date.now() - startedAt} deletedCount=${deletedCount} failedCount=${failedCount} - cover directory cleanup completed`,
    );
  }
}

async function countPrimaryFiles(dir: string): Promise<number> {
  let count = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countPrimaryFiles(full);
    } else if (entry.isFile() && isPrimaryFormat(full)) {
      count++;
    }
  }
  return count;
}

function formatPrescanError(error: unknown): string {
  const errorCode = getErrorCode(error);
  if (errorCode === 'ENOENT') return 'Path does not exist';
  if (errorCode === 'EACCES' || errorCode === 'EPERM') return 'Permission denied';
  return 'Directory is not readable';
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** The resolved root, or null when it is not on disk at all. Anything else still raises. */
async function resolveExistingRoot(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function assertSeriesFromFolderAllowed(deriveSeriesFromFolder: boolean | undefined, organizationMode: OrganizationMode): void {
  if (deriveSeriesFromFolder === true && organizationMode !== 'book_per_file') {
    throw new BadRequestException('Series from folders is only available when each file is its own book (book_per_file).');
  }
}

function normalizeOrganizationMode(mode: string | null | undefined): OrganizationMode {
  if (mode === 'book_per_file') return 'book_per_file';
  return DEFAULT_LIBRARY_ORGANIZATION_MODE;
}

function normalizeLibraryOrganizationMode<T extends Record<string, unknown>>(library: T): T {
  if (!Object.prototype.hasOwnProperty.call(library, 'organizationMode')) return library;
  return {
    ...library,
    organizationMode: normalizeOrganizationMode((library as { organizationMode?: string | null }).organizationMode),
  };
}

function pathsOverlap(a: string, b: string): boolean {
  const normalize = (path: string) => (path.endsWith('/') ? path : `${path}/`);
  const left = normalize(a);
  const right = normalize(b);
  return left.startsWith(right) || right.startsWith(left);
}
