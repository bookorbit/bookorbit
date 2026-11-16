import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lstat, mkdir, readdir, realpath, rename, rmdir } from 'fs/promises';
import { join, resolve, sep } from 'path';

import type {
  BookDockSettings,
  BookDockUploadTargets,
  LibraryDock,
  LibraryDockAdminEntry,
  LibraryDockErrorCode,
  LibraryDockFilingCheck,
  LibraryDockFilingChecks,
  LibraryDocksAdmin,
  MoveLibraryDockFolderResult,
  UpdateLibraryDockRequest,
} from '@bookorbit/types';

import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { isUniqueViolation } from '../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import type { LibraryDockRow, NewLibraryDockRow } from '../../db/schema';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryLifecycleService, type LibraryLifecycleFollowUp, type LibraryLifecycleListener } from '../library/library-lifecycle.service';
import { LibraryService } from '../library/library.service';
import { uploadError } from '../upload/upload-errors';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { BookDockFinalizeService } from './book-dock-finalize.service';
import { BookDockGateway } from './book-dock.gateway';
import type { BookDockUploadDock } from './book-dock-ingest.service';
import { BookDockRepository } from './book-dock.repository';
import { BookDockWatcherService } from './book-dock-watcher.service';
import { isIgnoredDockEntryName } from './book-dock-ignored-entries';
import { cleanDockFolderName, sanitizeDockFolderName } from './library-dock-folder-name';
import {
  errnoCode,
  findLibrariesDir,
  isSameOrInside,
  listLibrariesDir,
  moveWithoutOverwrite,
  probeFiling,
  removeFolderIfEmpty,
} from './library-dock-fs';
import { LIBRARIES_DIR } from './library-dock-paths';
import { LibraryDockRegistry } from './library-dock-registry.service';
import { isMetadataMode, resolveDockSettings, type LibraryDockSettingsSource } from './library-dock-settings';
import { LibraryDockRepository, type LibraryDockWithLibrary } from './library-dock.repository';

/** Most stray files the settings page lists; there is a flag when there are more. */
const MAX_LISTED_STRAY_FILES = 100;

/** Unchanged settings for a library that has no dock yet: it would inherit everything. */
const NEW_DOCK_SETTINGS: LibraryDockSettingsSource = {
  autoFetchMetadata: null,
  autoFinalizeEnabled: null,
  autoFinalizeThreshold: null,
  autoFinalizeMetadataMode: null,
  autoJoin: false,
  keepOriginal: false,
};

const UNWRITABLE_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

/** Filing checks run at once; each writes and removes one empty file. */
const FILING_CHECK_CONCURRENCY = 4;

type LibraryWithFolders = Awaited<ReturnType<LibraryService['findOne']>>;

type DockSettingsChanges = Partial<Omit<NewLibraryDockRow, 'id' | 'libraryId' | 'folderName' | 'createdAt'>>;

/**
 * Turns library docks on and off, edits their settings, and manages the folders under `_libraries`:
 * renaming a dock's folder, and adopting, emptying or removing a folder no dock owns. Never deletes
 * a file that might hold a book. Also listens to the library module, so a deleted library or a
 * removed folder leaves its dock files in a clear state.
 */
@Injectable()
export class LibraryDockService implements OnModuleInit, LibraryLifecycleListener {
  private readonly logger = new Logger(LibraryDockService.name);
  private readonly configuredRoot: string;
  private canonicalRoot: string | null = null;

  constructor(
    config: ConfigService,
    private readonly dockRepo: LibraryDockRepository,
    private readonly fileRepo: BookDockRepository,
    private readonly registry: LibraryDockRegistry,
    private readonly watcher: BookDockWatcherService,
    private readonly libraryService: LibraryService,
    private readonly appSettings: AppSettingsService,
    private readonly lifecycle: LibraryLifecycleService,
    private readonly gateway: BookDockGateway,
    private readonly finalize: BookDockFinalizeService,
    private readonly validator: UploadValidatorService,
  ) {
    const appDataPath = config.get<string>('storage.appDataPath') ?? '/data';
    this.configuredRoot = config.get<string>('storage.bookDockPath') ?? join(appDataPath, 'book-dock');
  }

  onModuleInit(): void {
    this.lifecycle.register(this);
  }

  async getAdmin(user: RequestUser): Promise<LibraryDocksAdmin> {
    const root = await this.root();
    const [libraries, docks, global, librariesPath] = await Promise.all([
      this.libraryService.findAll(user),
      this.dockRepo.listAll(),
      this.appSettings.getBookDockSettings(),
      findLibrariesDir(root),
    ]);
    const listing = await listLibrariesDir(librariesPath, MAX_LISTED_STRAY_FILES);
    const onDisk = new Set(listing.folders.map(folderKey));
    const docksByLibrary = new Map(docks.map((dock) => [dock.libraryId, dock]));
    const dockFolders = new Set(docks.map((dock) => folderKey(dock.folderName)));
    const withoutDock = libraries.filter((library) => !docksByLibrary.has(library.id));

    return {
      librariesPath: librariesPath ?? join(root, LIBRARIES_DIR),
      libraries: libraries.map((library) =>
        this.toAdminEntry(library, docksByLibrary.get(library.id), docks, global, (dock) => onDisk.has(folderKey(dock.folderName))),
      ),
      unrecognisedFolders: listing.folders
        .filter((name) => !dockFolders.has(folderKey(name)))
        .map((name) => ({
          name,
          matchesLibraryId: withoutDock.find((library) => folderKey(defaultFolderName(library)) === folderKey(name))?.id ?? null,
        })),
      strayFiles: listing.files,
      strayFilesTruncated: listing.filesTruncated,
      librariesFolderIsBook: librariesPath !== null && (await this.fileRepo.findByUnitDirectory(librariesPath)) !== undefined,
    };
  }

  /** The docks this user may upload into: turned on, in a library they can see (D26, D27). */
  async listUploadTargets(user: RequestUser): Promise<BookDockUploadTargets> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return { docks: await this.dockRepo.listUploadTargets(libraryIds) };
  }

  /**
   * Checks an upload into a library's dock before any bytes move (D26): the user can see the
   * library, its dock is on, and the library takes this format. Book Dock access is the caller's
   * guard. Throws a coded upload error otherwise.
   */
  async resolveUploadDock(user: RequestUser, libraryId: number, filename: string): Promise<BookDockUploadDock> {
    await this.libraryService.verifyAccess(user, libraryId);
    const dock = (await this.registry.all()).find((candidate) => candidate.libraryId === libraryId && candidate.enabled);
    if (!dock) throw uploadError.invalidTarget('This library has no Library Dock turned on');
    const library = await this.fileRepo.findLibraryFormats(libraryId);
    if (!library) throw uploadError.invalidTarget('Library not found');
    this.validator.validateFormat(this.validator.sanitizeFilename(filename), library.allowedFormats);
    await this.assertLibrariesFolderUsable();
    return { dockId: dock.id, libraryId, folderId: dock.targetFolderId, folderName: dock.folderName };
  }

  /**
   * Whether filing from each library's dock is an instant move or a copy (D7), tried for real with
   * a throwaway file. A library without a dock is checked from `_libraries`, as it would start.
   */
  async checkFiling(user: RequestUser): Promise<LibraryDockFilingChecks> {
    const root = await this.root();
    const [libraries, docks, global, librariesPath] = await Promise.all([
      this.libraryService.findAll(user),
      this.dockRepo.listAll(),
      this.appSettings.getBookDockSettings(),
      findLibrariesDir(root),
    ]);
    const docksByLibrary = new Map(docks.map((dock) => [dock.libraryId, dock]));
    const checks = await mapWithConcurrency(libraries, FILING_CHECK_CONCURRENCY, async (library): Promise<LibraryDockFilingCheck> => {
      const dock = docksByLibrary.get(library.id);
      const target = dock ? library.folders.find((folder) => folder.id === dock.targetFolderId) : library.folders[0];
      if (!target) return { libraryId: library.id, filing: 'unknown' };
      const source = dock && librariesPath ? join(librariesPath, dock.folderName) : (librariesPath ?? root);
      const placement = resolveDockSettings(dock ?? NEW_DOCK_SETTINGS, global).keepOriginal ? 'link' : 'rename';
      return { libraryId: library.id, ...(await probeFiling(source, target.path, placement)) };
    });
    return { checks };
  }

  /** Turns a library's dock on or off and changes its settings or folder name. */
  async updateDock(user: RequestUser, libraryId: number, dto: UpdateLibraryDockRequest): Promise<LibraryDockAdminEntry> {
    await this.libraryService.verifyAccess(user, libraryId);
    const library = await this.libraryService.findOne(libraryId);
    const existing = await this.dockRepo.findByLibraryId(libraryId);
    if (!existing) {
      if (dto.enabled !== true) throw dockError(BadRequestException, 'LIBRARY_DOCK_NOT_ENABLED', 'Turn the dock on before changing its settings.');
      const dock = await this.enable(library, dto);
      await this.afterDockChange(dock.enabled ? dock : null);
      return this.adminEntry(library);
    }

    const changes = settingsChanges(dto, library);
    const folderName = dto.folderName === undefined ? undefined : validTypedFolderName(dto.folderName);
    const turningOn = dto.enabled === true && !existing.enabled;
    if (turningOn) {
      await this.assertLibrariesFolderUsable();
      await this.ensureDockFolder(existing.folderName);
    }
    if (folderName !== undefined && folderName !== existing.folderName) await this.renameDockFolder(existing, folderName);
    if (Object.keys(changes).length > 0) await this.dockRepo.update(existing.id, changes);
    if (changes.targetFolderId != null) await this.fileRepo.fillMissingFolder(existing.id, libraryId, changes.targetFolderId);

    const dock = (await this.dockRepo.findById(existing.id))!;
    await this.afterDockChange(turningOn ? dock : null);
    // What the dock's files wait on can change with any setting, so each is checked again.
    if (Object.keys(changes).length > 0) this.finalize.recheckAfterSettingsChange(existing.id);
    return this.adminEntry(library);
  }

  /** Renames a dock's folder on disk, to `folderName` or to the name the library's current name gives. */
  async renameFolder(user: RequestUser, libraryId: number, folderName?: string): Promise<LibraryDockAdminEntry> {
    await this.libraryService.verifyAccess(user, libraryId);
    const library = await this.libraryService.findOne(libraryId);
    const dock = await this.dockRepo.findByLibraryId(libraryId);
    if (!dock) throw dockError(NotFoundException, 'LIBRARY_DOCK_NOT_FOUND', 'This library has no dock.');
    const others = (await this.dockRepo.listAll()).filter((other) => other.id !== dock.id).map((other) => other.folderName);
    const target = folderName === undefined ? sanitizeDockFolderName(library.name, library.id, others) : validTypedFolderName(folderName);
    if (target !== dock.folderName) {
      await this.renameDockFolder(dock, target);
      await this.afterDockChange(dock.enabled ? { ...dock, folderName: target } : null);
    }
    return this.adminEntry(library);
  }

  /** Gives a library without a dock the folder already sitting in `_libraries`, files and all. */
  async adoptFolder(user: RequestUser, folderName: string, libraryId: number): Promise<LibraryDockAdminEntry> {
    await this.libraryService.verifyAccess(user, libraryId);
    const library = await this.libraryService.findOne(libraryId);
    if (await this.dockRepo.findByLibraryId(libraryId)) throw dockError(ConflictException, 'LIBRARY_DOCK_EXISTS', 'This library already has a dock.');
    await this.assertLibrariesFolderUsable();
    const path = await this.unownedFolderPath(folderName);
    const startedAt = Date.now();
    const name = path.slice(path.lastIndexOf(sep) + 1);
    const dock = await this.createDockRow({ libraryId, folderName: name, enabled: true, targetFolderId: library.folders[0]?.id ?? null });
    this.logger.log(
      `[library_dock.adopt] [end] dockId=${dock.id} libraryId=${libraryId} folder="${sanitizeLogValue(name)}" durationMs=${Date.now() - startedAt} - folder adopted as library dock`,
    );
    await this.afterDockChange(dock);
    return this.adminEntry(library);
  }

  /**
   * Moves everything in a folder no dock owns into the Book Dock root, where Unsorted takes it in,
   * then removes the folder when nothing but clutter is left. Names that are taken get a number.
   */
  async moveFolderToUnsorted(folderName: string): Promise<MoveLibraryDockFolderResult> {
    const root = await this.root();
    const path = await this.unownedFolderPath(folderName);
    if ((await this.fileRepo.countWorkingUnder(path)) > 0) {
      throw dockError(ConflictException, 'LIBRARY_DOCK_BUSY', 'Files in this folder are still being read. Try again when they finish.');
    }
    const startedAt = Date.now();
    const folder = sanitizeLogValue(folderName);
    this.logger.log(`[library_dock.folder_move] [start] folder="${folder}" - moving folder contents to Unsorted`);
    let moved = 0;
    // The whole root, because a taken name sends an entry to `name (2)`: nothing the move does may
    // read as a fresh arrival. Anything dropped meanwhile is found by the rescan afterwards.
    const release = this.watcher.holdPaths([root]);
    try {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (isIgnoredDockEntryName(entry.name) || (!entry.isFile() && !entry.isDirectory())) continue;
        await this.moveEntry(join(path, entry.name), root, entry.name, entry.isDirectory());
        moved++;
      }
      const { removed } = await removeFolderIfEmpty(path);
      this.logger.log(
        `[library_dock.folder_move] [end] folder="${folder}" moved=${moved} folderRemoved=${removed} durationMs=${Date.now() - startedAt} - folder contents moved to Unsorted`,
      );
      return { moved, folderRemoved: removed };
    } catch (error) {
      this.logger.warn(
        `[library_dock.folder_move] [fail] folder="${folder}" moved=${moved} durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${sanitizeLogValue(errorMessage(error))}" - folder contents not all moved`,
      );
      throw mapFsError(error, { moved });
    } finally {
      release();
      if (moved > 0) this.scanInBackground(root);
      this.gateway.emitChanged();
    }
  }

  /** Removes a folder no dock owns, only when nothing but operating-system clutter is in it. */
  async removeFolder(folderName: string): Promise<void> {
    const path = await this.unownedFolderPath(folderName);
    const result = await removeFolderIfEmpty(path).catch((error: unknown) => {
      throw mapFsError(error);
    });
    if (!result.removed) {
      throw dockError(ConflictException, 'LIBRARY_DOCK_FOLDER_NOT_EMPTY', 'Only an empty folder can be removed. Move its files to Unsorted first.', {
        entries: result.remaining,
      });
    }
    this.logger.log(`[library_dock.folder_remove] [end] folder="${sanitizeLogValue(folderName)}" - empty folder removed`);
    this.gateway.emitChanged();
  }

  async assertFolderPathsAllowed(paths: string[]): Promise<void> {
    const root = await this.root();
    for (const path of paths) {
      if (!isSameOrInside(path, root) && !isSameOrInside(root, path)) continue;
      throw new ConflictException({
        message: 'Library folders cannot sit inside the Library Dock folder or contain it.',
        errorCode: 'LIBRARY_FOLDER_OVERLAPS_BOOK_DOCK',
        errorMeta: { path, overlapPath: root },
      });
    }
  }

  /** Files headed for a deleted library go to Unsorted, marked with the library they were headed for. */
  async prepareLibraryDelete(library: { id: number; name: string }): Promise<LibraryLifecycleFollowUp> {
    const ids = await this.fileRepo.findIdsByTargetLibrary(library.id);
    const hadDock = (await this.dockRepo.findByLibraryId(library.id)) !== undefined;
    return async () => {
      await this.fileRepo.markFromDeletedLibrary(ids, library.name);
      if (hadDock) await this.registry.refresh();
      if (ids.length > 0 || hadDock) this.gateway.emitChanged();
      this.logger.log(
        `[library_dock.library_deleted] [end] libraryId=${library.id} files=${ids.length} hadDock=${hadDock} - dock files moved to Unsorted`,
      );
    };
  }

  /** Files headed for a removed folder wait until someone chooses another one. */
  async prepareFoldersRemove(libraryId: number, folderIds: number[]): Promise<LibraryLifecycleFollowUp> {
    const ids = await this.fileRepo.findIdsByTargetFolders(folderIds);
    const dock = await this.dockRepo.findByLibraryId(libraryId);
    const losesDockFolder = dock?.targetFolderId != null && folderIds.includes(dock.targetFolderId);
    return async () => {
      if (ids.length > 0) {
        const library = await this.fileRepo.findLibraryFormats(libraryId);
        await this.fileRepo.holdForRemovedFolder(ids, libraryId, library?.name ?? '');
      }
      if (losesDockFolder) await this.registry.refresh();
      if (ids.length > 0 || losesDockFolder) this.gateway.emitChanged();
    };
  }

  private async enable(library: LibraryWithFolders, dto: UpdateLibraryDockRequest): Promise<LibraryDockRow> {
    const startedAt = Date.now();
    const taken = (await this.dockRepo.listAll()).map((dock) => dock.folderName);
    let folderName: string;
    if (dto.folderName === undefined) {
      folderName = sanitizeDockFolderName(library.name, library.id, taken);
    } else {
      folderName = validTypedFolderName(dto.folderName);
      if (taken.some((name) => folderKey(name) === folderKey(folderName))) throw folderNameTaken();
    }
    const changes = settingsChanges(dto, library);
    this.logger.log(`[library_dock.enable] [start] libraryId=${library.id} folder="${sanitizeLogValue(folderName)}" - turning library dock on`);
    try {
      await this.assertLibrariesFolderUsable();
      const created = await this.ensureDockFolder(folderName);
      let dock: LibraryDockRow;
      try {
        dock = await this.createDockRow({
          targetFolderId: library.folders[0]?.id ?? null,
          ...changes,
          libraryId: library.id,
          folderName,
          enabled: true,
        });
      } catch (error) {
        if (created) await rmdir(created).catch(() => undefined);
        throw error;
      }
      this.logger.log(
        `[library_dock.enable] [end] dockId=${dock.id} libraryId=${library.id} folder="${sanitizeLogValue(folderName)}" durationMs=${Date.now() - startedAt} - library dock on`,
      );
      return dock;
    } catch (error) {
      this.logger.warn(
        `[library_dock.enable] [fail] libraryId=${library.id} folder="${sanitizeLogValue(folderName)}" durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${sanitizeLogValue(errorMessage(error))}" - library dock not turned on`,
      );
      throw error;
    }
  }

  private async createDockRow(data: NewLibraryDockRow): Promise<LibraryDockRow> {
    try {
      return await this.dockRepo.create(data);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (await this.dockRepo.findByLibraryId(data.libraryId)) {
        throw dockError(ConflictException, 'LIBRARY_DOCK_EXISTS', 'This library already has a dock.');
      }
      throw folderNameTaken();
    }
  }

  /**
   * Renames the folder on disk and repoints every row under it, as one step: the watcher ignores
   * both paths meanwhile, and a failed database update puts the folder back. Refused while files
   * in it are still being read (plan choice P3).
   */
  private async renameDockFolder(dock: LibraryDockRow, folderName: string): Promise<void> {
    const others = (await this.dockRepo.listAll()).filter((other) => other.id !== dock.id);
    if (others.some((other) => folderKey(other.folderName) === folderKey(folderName))) throw folderNameTaken();

    const librariesPath = await this.ensureLibrariesDir();
    const from = join(librariesPath, dock.folderName);
    const to = join(librariesPath, folderName);
    const fromInfo = await lstat(from).catch(() => null);
    const toInfo = await lstat(to).catch(() => null);
    const sameFolder = fromInfo !== null && toInfo !== null && fromInfo.dev === toInfo.dev && fromInfo.ino === toInfo.ino;
    if (toInfo && !sameFolder) {
      throw dockError(ConflictException, 'LIBRARY_DOCK_FOLDER_EXISTS', 'Something with that name is already in the library docks folder.');
    }
    if (!fromInfo?.isDirectory()) {
      // Nothing on disk to carry over: the name alone changes, and an enabled dock gets its folder back.
      if (dock.enabled) await this.ensureDockFolder(folderName);
      await this.dockRepo.update(dock.id, { folderName });
      return;
    }
    if ((await this.fileRepo.countWorkingUnder(from)) > 0) {
      throw dockError(ConflictException, 'LIBRARY_DOCK_BUSY', 'Files in this dock are still being read. Try again when they finish.');
    }

    const startedAt = Date.now();
    const keys = `dockId=${dock.id} from="${sanitizeLogValue(dock.folderName)}" to="${sanitizeLogValue(folderName)}"`;
    this.logger.log(`[library_dock.rename] [start] ${keys} - renaming dock folder`);
    const release = this.watcher.holdPaths([from, to]);
    try {
      await rename(from, to);
      let moved: number;
      try {
        moved = await this.dockRepo.renameFolder(dock.id, folderName, from, to);
      } catch (error) {
        await rename(to, from).catch((restoreError: unknown) =>
          this.logger.error(
            `[library_dock.rename] [fail] ${keys} errorClass=${errorClass(restoreError)} error="${sanitizeLogValue(errorMessage(restoreError))}" - folder renamed but not restored; rename it back by hand`,
          ),
        );
        throw error;
      }
      this.logger.log(`[library_dock.rename] [end] ${keys} files=${moved} durationMs=${Date.now() - startedAt} - dock folder renamed`);
    } catch (error) {
      this.logger.warn(
        `[library_dock.rename] [fail] ${keys} durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${sanitizeLogValue(errorMessage(error))}" - dock folder not renamed`,
      );
      throw mapFsError(error);
    } finally {
      release();
    }
  }

  /** Moves one entry out of a folder no dock owns and repoints its rows; puts it back if the rows cannot follow. */
  private async moveEntry(source: string, root: string, name: string, isDirectory: boolean): Promise<void> {
    const destination = await moveWithoutOverwrite(source, root, name, isDirectory);
    try {
      await this.dockRepo.movePaths(source, destination);
    } catch (error) {
      await rename(destination, source).catch((restoreError: unknown) =>
        this.logger.error(
          `[library_dock.folder_move] [fail] path="${sanitizeLogValue(destination)}" errorClass=${errorClass(restoreError)} error="${sanitizeLogValue(errorMessage(restoreError))}" - entry moved but its rows were not updated and it could not be put back`,
        ),
      );
      throw error;
    }
  }

  private async afterDockChange(scan: Pick<LibraryDockRow, 'folderName'> | null): Promise<void> {
    await this.registry.refresh();
    if (scan) {
      const librariesPath = await findLibrariesDir(await this.root());
      if (librariesPath) this.scanInBackground(join(librariesPath, scan.folderName));
    }
    this.gateway.emitChanged();
  }

  private scanInBackground(path: string): void {
    this.watcher
      .scanFolder(path)
      .catch((error: unknown) =>
        this.logger.warn(
          `[library_dock.scan] [fail] path="${sanitizeLogValue(path)}" errorClass=${errorClass(error)} error="${sanitizeLogValue(errorMessage(error))}" - background scan failed`,
        ),
      );
  }

  /** A folder directly in `_libraries` that no dock owns, as a real directory rather than a link. */
  private async unownedFolderPath(folderName: string): Promise<string> {
    if (!isSingleSegment(folderName)) throw folderNotFound();
    const librariesPath = await findLibrariesDir(await this.root());
    if (!librariesPath) throw folderNotFound();
    const path = join(librariesPath, folderName);
    const info = await lstat(path).catch(() => null);
    if (!info?.isDirectory()) throw folderNotFound();
    if ((await realpath(path).catch(() => null)) !== path) throw folderNotFound();
    if (await this.registry.findByFolderName(folderName)) {
      throw dockError(ConflictException, 'LIBRARY_DOCK_FOLDER_OWNED', 'This folder belongs to a library dock.');
    }
    return path;
  }

  /** Refuses while `_libraries` is a book an earlier version took in: adopting it would take that book apart. */
  private async assertLibrariesFolderUsable(): Promise<void> {
    const librariesPath = await findLibrariesDir(await this.root());
    if (librariesPath && (await this.fileRepo.findByUnitDirectory(librariesPath))) {
      throw dockError(
        ConflictException,
        'LIBRARY_DOCKS_FOLDER_IS_BOOK',
        'The _libraries folder is a book in the Library Dock. File or move it before turning library docks on.',
      );
    }
  }

  private async ensureLibrariesDir(): Promise<string> {
    const root = await this.root();
    const existing = await findLibrariesDir(root);
    if (existing) return existing;
    const path = join(root, LIBRARIES_DIR);
    await makeFolder(path);
    return path;
  }

  /** Creates the dock's folder when it is missing. Returns its path when this call created it. */
  private async ensureDockFolder(folderName: string): Promise<string | null> {
    const path = join(await this.ensureLibrariesDir(), folderName);
    return (await makeFolder(path)) ? path : null;
  }

  private async adminEntry(library: LibraryWithFolders): Promise<LibraryDockAdminEntry> {
    const [docks, global, librariesPath] = await Promise.all([
      this.dockRepo.listAll(),
      this.appSettings.getBookDockSettings(),
      findLibrariesDir(await this.root()),
    ]);
    const dock = docks.find((candidate) => candidate.libraryId === library.id);
    const present = dock && librariesPath ? await isRealDirectory(join(librariesPath, dock.folderName)) : false;
    return this.toAdminEntry(library, dock, docks, global, () => present);
  }

  private toAdminEntry(
    library: { id: number; name: string; folders: { id: number; path: string }[] },
    dock: LibraryDockWithLibrary | undefined,
    docks: LibraryDockWithLibrary[],
    global: BookDockSettings,
    isPresent: (dock: LibraryDockWithLibrary) => boolean,
  ): LibraryDockAdminEntry {
    const others = docks.filter((other) => other.libraryId !== library.id).map((other) => other.folderName);
    const suggested = sanitizeDockFolderName(library.name, library.id, others);
    return {
      libraryId: library.id,
      libraryName: library.name,
      folders: library.folders.map(({ id, path }) => ({ id, path })),
      dock: dock ? toLibraryDock(dock, library.name) : null,
      effective: resolveDockSettings(dock ?? NEW_DOCK_SETTINGS, global),
      suggestedFolderName: dock?.folderName === suggested ? null : suggested,
      folderPresent: dock ? isPresent(dock) : false,
    };
  }

  /** The dock root as the watcher sees it, so paths compare with the ones stored on rows. */
  private async root(): Promise<string> {
    if (this.canonicalRoot) return this.canonicalRoot;
    try {
      this.canonicalRoot = await realpath(this.configuredRoot);
      return this.canonicalRoot;
    } catch {
      return resolve(this.configuredRoot);
    }
  }
}

export function toLibraryDock(dock: LibraryDockRow, libraryName: string): LibraryDock {
  return {
    id: dock.id,
    libraryId: dock.libraryId,
    libraryName,
    folderName: dock.folderName,
    enabled: dock.enabled,
    targetFolderId: dock.targetFolderId,
    overrides: {
      autoFetchMetadata: dock.autoFetchMetadata,
      autoFinalizeEnabled: dock.autoFinalizeEnabled,
      autoFinalizeThreshold: dock.autoFinalizeThreshold,
      autoFinalizeMetadataMode: isMetadataMode(dock.autoFinalizeMetadataMode) ? dock.autoFinalizeMetadataMode : null,
    },
    autoJoin: dock.autoJoin,
    keepOriginal: dock.keepOriginal,
  };
}

/** The settings a request changes, validated against the library. Folder name and `enabled` are handled by the caller. */
function settingsChanges(dto: UpdateLibraryDockRequest, library: LibraryWithFolders): DockSettingsChanges {
  const changes: DockSettingsChanges = {};
  if (dto.enabled !== undefined) changes.enabled = dto.enabled;
  if (dto.targetFolderId !== undefined) {
    if (!library.folders.some((folder) => folder.id === dto.targetFolderId)) {
      throw dockError(BadRequestException, 'LIBRARY_DOCK_TARGET_FOLDER_INVALID', "That folder is not one of this library's folders.");
    }
    changes.targetFolderId = dto.targetFolderId;
  }
  if (dto.autoFetchMetadata !== undefined) changes.autoFetchMetadata = dto.autoFetchMetadata;
  if (dto.autoFinalizeEnabled !== undefined) changes.autoFinalizeEnabled = dto.autoFinalizeEnabled;
  if (dto.autoFinalizeThreshold !== undefined) changes.autoFinalizeThreshold = dto.autoFinalizeThreshold;
  if (dto.autoFinalizeMetadataMode !== undefined) changes.autoFinalizeMetadataMode = dto.autoFinalizeMetadataMode;
  if (dto.autoJoin !== undefined) changes.autoJoin = dto.autoJoin;
  if (dto.keepOriginal !== undefined) changes.keepOriginal = dto.keepOriginal;
  return changes;
}

/** A typed folder name must already be one the dock would generate: nothing is silently changed. */
function validTypedFolderName(input: string): string {
  const name = input.normalize('NFC');
  if (!name || cleanDockFolderName(name) !== name) {
    throw dockError(
      BadRequestException,
      'LIBRARY_DOCK_FOLDER_NAME_INVALID',
      'Folder names cannot contain / \\ : * ? " < > |, start with a dot, end with a dot or space, or be a reserved name.',
    );
  }
  return name;
}

function defaultFolderName(library: { id: number; name: string }): string {
  return cleanDockFolderName(library.name) || `library-${library.id}`;
}

function folderKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

function isSingleSegment(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !/[/\\\0]/.test(name) && !isIgnoredDockEntryName(name);
}

async function isRealDirectory(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null);
  return info?.isDirectory() ?? false;
}

/** Creates a folder. Returns whether it was created; an existing folder is fine, anything else there is not. */
async function makeFolder(path: string): Promise<boolean> {
  try {
    await mkdir(path);
    return true;
  } catch (error) {
    if (errnoCode(error) === 'EEXIST') {
      if (await isRealDirectory(path)) return false;
      throw dockError(ConflictException, 'LIBRARY_DOCK_FOLDER_EXISTS', 'A file with that name is already in the library docks folder.');
    }
    throw mapFsError(error);
  }
}

function folderNameTaken(): HttpException {
  return dockError(ConflictException, 'LIBRARY_DOCK_FOLDER_NAME_TAKEN', 'Another library dock already uses that folder name.');
}

function folderNotFound(): HttpException {
  return dockError(NotFoundException, 'LIBRARY_DOCK_FOLDER_NOT_FOUND', 'That folder is not in the library docks folder.');
}

/** Filesystem refusals the person can act on become stable codes; anything else stays an error. */
function mapFsError(error: unknown, errorMeta?: Record<string, unknown>): unknown {
  if (error instanceof HttpException) return error;
  const code = errnoCode(error);
  if (code && UNWRITABLE_CODES.has(code)) {
    return dockError(
      ConflictException,
      'LIBRARY_DOCK_FOLDER_UNWRITABLE',
      'The server cannot change the library docks folder. Check that the user BookOrbit runs as can write to the Library Dock folder.',
      errorMeta,
    );
  }
  if (code === 'EXDEV') {
    return dockError(
      ConflictException,
      'LIBRARY_DOCK_OTHER_FILESYSTEM',
      'That folder is on another drive or share, so it cannot be moved.',
      errorMeta,
    );
  }
  return error;
}

function dockError(
  Exception: new (body: Record<string, unknown>) => HttpException,
  errorCode: LibraryDockErrorCode,
  message: string,
  errorMeta?: Record<string, unknown>,
): HttpException {
  return new Exception({ message, errorCode, ...(errorMeta ? { errorMeta } : {}) });
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
