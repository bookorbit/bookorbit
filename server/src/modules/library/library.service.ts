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
import { readdir, rm, stat } from 'fs/promises';
import { join } from 'path';

import { DEFAULT_FORMAT_PRIORITY } from '@bookorbit/types';
import type {
  AccessLevel,
  AddedAtSource,
  LibraryFileSyncProgressEvent,
  OrganizationMode,
  RecomputeAddedAtResult,
  WriteResult,
} from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizeIconValue } from '../../common/utils/icon-value.utils';
import type { RequestUser } from '../../common/types/request-user';
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
import { LibraryRepository } from './library.repository';

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
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async verifyUserAccess(userId: number, libraryId: number, isSuperuser: boolean): Promise<void> {
    if (isSuperuser) return;
    const hasAccess = await this.libraryRepo.hasUserAccess(userId, libraryId);
    if (!hasAccess) throw new ForbiddenException('No access to this library');
  }

  async findAll(user: RequestUser) {
    const librariesForUser = user.isSuperuser
      ? await this.libraryRepo.findAll()
      : await this.libraryRepo.findAllForUser(user.id, user.contentFilters);
    const folders = user.isSuperuser
      ? await this.libraryRepo.findAllFolders()
      : await this.libraryRepo.findFoldersByLibraryIds(librariesForUser.map((library) => library.id));

    const foldersByLibraryId = new Map<number, typeof folders>();
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
      folders: (foldersByLibraryId.get(library.id) ?? []).map(({ id, path, createdAt }) => ({ id, path, createdAt })),
    }));
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
    await this.assertNameAvailable(dto.name);
    const folderPaths = await this.assertFolderPathsWithinBrowseRoot(dto.folders);
    const icon = normalizeIconValue(dto.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }

    const [library] = await this.libraryRepo.insert({
      name: dto.name,
      icon,
      displayOrder: dto.displayOrder ?? 0,
      watch: dto.watch ?? false,
      autoScanCronExpression: dto.autoScanCronExpression ?? null,
      metadataPrecedence: dto.metadataPrecedence ?? [...LIBRARY_METADATA_PRECEDENCE_DEFAULT],
      formatPriority: dto.formatPriority ?? [...DEFAULT_FORMAT_PRIORITY],
      allowedFormats: dto.allowedFormats ?? [],
      organizationMode: dto.organizationMode ?? DEFAULT_LIBRARY_ORGANIZATION_MODE,
      excludePatterns: dto.excludePatterns ?? [],
      coverAspectRatio: dto.coverAspectRatio ?? DEFAULT_LIBRARY_COVER_ASPECT_RATIO,
      readingThreshold: dto.readingThreshold ?? 0.25,
      markAsFinishedPercentComplete: dto.markAsFinishedPercentComplete ?? 98,
      fileNamingPattern: dto.fileNamingPattern ?? null,
      fileWriteEnabled: dto.fileWriteEnabled ?? false,
      fileWriteWriteCover: dto.fileWriteWriteCover ?? true,
      fileWriteEpubEnabled: dto.fileWriteEpubEnabled ?? true,
      fileWriteEpubMaxFileSizeMb: dto.fileWriteEpubMaxFileSizeMb ?? 100,
      fileWritePdfEnabled: dto.fileWritePdfEnabled ?? true,
      fileWritePdfMaxFileSizeMb: dto.fileWritePdfMaxFileSizeMb ?? 100,
      fileWriteCbxEnabled: dto.fileWriteCbxEnabled ?? false,
      fileWriteCbxMaxFileSizeMb: dto.fileWriteCbxMaxFileSizeMb ?? 500,
      fileWriteAudioEnabled: dto.fileWriteAudioEnabled ?? true,
      fileWriteAudioMaxFileSizeMb: dto.fileWriteAudioMaxFileSizeMb ?? 500,
      fileRenameEnabled: dto.fileRenameEnabled ?? false,
    });

    const folders = await Promise.all(folderPaths.map((path) => this.libraryRepo.insertFolder({ libraryId: library.id, path })));

    if (library.watch) {
      await this.fileWatcherService.startWatcher(
        library.id,
        folders.map(([f]) => f.path),
      );
    }

    this.scannerService.startScanAsync(library.id);

    return { ...normalizeLibraryOrganizationMode(library), folders: folders.map(([f]) => f) };
  }

  async update(id: number, dto: UpdateLibraryDto) {
    const [existing] = await this.libraryRepo.findById(id);
    if (!existing) throw new NotFoundException('Library not found');

    const existingOrganizationMode = normalizeOrganizationMode(existing.organizationMode);
    if (dto.organizationMode !== undefined && dto.organizationMode !== existingOrganizationMode) {
      throw new BadRequestException(
        'Library organization mode cannot be changed after creation. Create a new library to use a different organization mode.',
      );
    }

    if (dto.name && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name, id);
    }

    const { folders: rawFolderPaths, ...fields } = dto;
    const folderPaths = rawFolderPaths === undefined ? undefined : await this.assertFolderPathsWithinBrowseRoot(rawFolderPaths);
    const icon = fields.icon !== undefined ? normalizeIconValue(fields.icon) : normalizeIconValue(existing.icon);
    if (!icon) {
      throw new BadRequestException('Icon is required');
    }
    if (fields.icon !== undefined) {
      fields.icon = icon;
    }

    const [updated] = await this.libraryRepo.update(id, fields);

    if (folderPaths !== undefined) {
      const existingFolders = await this.libraryRepo.findFoldersByLibrary(id);
      const existingByPath = new Map(existingFolders.map((f) => [f.path, f]));
      const newPathSet = new Set(folderPaths);

      const toRemove = existingFolders.filter((f) => !newPathSet.has(f.path));
      await Promise.all(toRemove.map((f) => this.libraryRepo.deleteFolder(f.id)));

      const toAdd = folderPaths.filter((p) => !existingByPath.has(p));
      await Promise.all(toAdd.map((path) => this.libraryRepo.insertFolder({ libraryId: id, path })));
    }

    const folders = await this.libraryRepo.findFoldersByLibrary(id);

    const watchChanged = dto.watch !== undefined && dto.watch !== existing.watch;
    const nextWatch = dto.watch ?? existing.watch;
    if (watchChanged) {
      if (nextWatch) {
        await this.fileWatcherService.startWatcher(
          id,
          folders.map((f) => f.path),
        );
      } else {
        await this.fileWatcherService.stopWatcher(id);
      }
    } else if (nextWatch && folderPaths !== undefined) {
      await this.fileWatcherService.startWatcher(
        id,
        folders.map((f) => f.path),
      );
    }

    const shouldRescan =
      dto.formatPriority !== undefined || dto.allowedFormats !== undefined || dto.excludePatterns !== undefined || folderPaths !== undefined;
    if (shouldRescan) this.scannerService.startScanAsync(id);

    return { ...normalizeLibraryOrganizationMode(updated), folders };
  }

  async remove(id: number) {
    const [existing] = await this.libraryRepo.findById(id);
    if (!existing) throw new NotFoundException('Library not found');

    await this.fileWatcherService.stopWatcher(id);

    const bookRows = await this.libraryRepo.findBookIdsByLibrary(id);
    await this.libraryRepo.delete(id);
    await this.cleanupCoverDirectories(bookRows.map(({ id: bookId }) => bookId));
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
    await this.libraryRepo.updateDisplayOrders(dto.order);
  }

  getAccess(libraryId: number) {
    return this.libraryRepo.getAccessWithUsers(libraryId);
  }

  async grantAccess(libraryId: number, dto: GrantLibraryAccessDto) {
    const result = await this.libraryRepo.grantAccess(libraryId, dto.userId, dto.accessLevel);
    this.achievementEvents.emit(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId: dto.userId, libraryId });
    return result;
  }

  updateAccess(libraryId: number, userId: number, accessLevel: AccessLevel) {
    return this.libraryRepo.updateAccess(libraryId, userId, accessLevel);
  }

  async revokeAccess(libraryId: number, userId: number) {
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

  async recomputeAddedAt(libraryId: number): Promise<RecomputeAddedAtResult> {
    const [library] = await this.libraryRepo.findById(libraryId);
    if (!library) throw new NotFoundException('Library not found');

    const source = normalizeAddedAtSource(library.addedAtSource);
    const event = 'library.recompute_added_at';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} source=${source} - recompute added_at started`);

    if (source === 'imported') {
      this.logger.log(`[${event}] [end] libraryId=${libraryId} source=imported durationMs=${Date.now() - startedAt} updated=0 - recompute skipped`);
      return { source, total: 0, updated: 0, skipped: 'source is imported' };
    }

    const [countRow] = await this.libraryRepo.countBooksByLibrary(libraryId);
    const total = countRow?.count ?? 0;

    if (source === 'file_modified') {
      const updated = await this.libraryRepo.recomputeAddedAtFromMtime(libraryId);
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} source=file_modified durationMs=${Date.now() - startedAt} total=${total} updated=${updated} - recompute completed`,
      );
      return { source, total, updated };
    }

    const updated = await this.recomputeAddedAtFromBirthtime(libraryId);
    this.logger.log(
      `[${event}] [end] libraryId=${libraryId} source=file_created durationMs=${Date.now() - startedAt} total=${total} updated=${updated} - recompute completed`,
    );
    return { source, total, updated };
  }

  private async recomputeAddedAtFromBirthtime(libraryId: number): Promise<number> {
    const rows = await this.libraryRepo.findContentFilePathsByLibrary(libraryId);

    const pathsByBook = new Map<number, string[]>();
    for (const row of rows) {
      const paths = pathsByBook.get(row.bookId);
      if (paths) paths.push(row.absolutePath);
      else pathsByBook.set(row.bookId, [row.absolutePath]);
    }

    let updated = 0;
    const bookIds = [...pathsByBook.keys()];
    const batchSize = 50;

    for (let i = 0; i < bookIds.length; i += batchSize) {
      const batch = bookIds.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (bookId) => {
          const paths = pathsByBook.get(bookId)!;
          let earliest: Date | undefined;
          for (const path of paths) {
            const s = await stat(path).catch(() => null);
            if (!s) continue;
            const candidate = usableTime(s.birthtime) ?? usableTime(s.mtime);
            if (candidate === undefined) continue;
            if (earliest === undefined || candidate < earliest) earliest = candidate;
          }
          if (earliest !== undefined) {
            await this.libraryRepo.updateBookAddedAt(bookId, earliest);
            updated++;
          }
        }),
      );
    }

    return updated;
  }

  private async assertNameAvailable(name: string, excludeId?: number) {
    const existing = await this.libraryRepo.findByName(name, excludeId);
    if (existing.length > 0) throw new ConflictException('A library with this name already exists');
  }

  private async assertFolderPathsWithinBrowseRoot(paths: string[]): Promise<string[]> {
    return Promise.all(paths.map((path) => this.pathPolicy.assertWithinBrowseRoot(path)));
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeOrganizationMode(mode: string | null | undefined): OrganizationMode {
  if (mode === 'book_per_file') return 'book_per_file';
  return DEFAULT_LIBRARY_ORGANIZATION_MODE;
}

function normalizeAddedAtSource(source: string | null | undefined): AddedAtSource {
  return source === 'file_modified' || source === 'file_created' ? source : DEFAULT_LIBRARY_ADDED_AT_SOURCE;
}

// Mirrors the scanner's usable-time guard: some filesystems report birthtime as
// epoch 0 when they do not track creation time, so anything at or below this is
// treated as unavailable.
const MIN_VALID_TIME_MS = 1000;

function usableTime(date: Date | undefined): Date | undefined {
  if (!(date instanceof Date)) return undefined;
  const ms = date.getTime();
  if (Number.isNaN(ms) || ms <= MIN_VALID_TIME_MS) return undefined;
  return date;
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
