import type {
  CreateFolderResult,
  DirectoryEntry,
  FolderListing,
  FolderListingEntry,
  FolderPlaces,
  FolderPickerLibrary,
  FolderSearchResult,
  PathConfig,
} from '@bookorbit/types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Dirent } from 'fs';
import { lstat, mkdir, readdir, realpath, stat } from 'fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'path';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import {
  hasListableChild,
  isBlockedPath,
  isBlockedTarget,
  isInsideOrAt,
  isListableDirectory,
  mapLimit,
  realTarget,
  stateForError,
  SYSTEM_FOLDERS,
} from './folder-walk';
import { PathPolicyService } from './path-policy.service';
import { PathRepository } from './path.repository';

/** Past this many folders, children are not opened to learn whether they have their own. */
const HAS_CHILDREN_CHECK_LIMIT = 400;
/** Folders listed from one folder; the rest are reached by typing a path or finding by name. */
const LISTING_MAX_ENTRIES = 5_000;
const SEARCH_MAX_DEPTH = 6;
const SEARCH_MAX_RESULTS = 200;
const SEARCH_MAX_ENTRIES = 20_000;
const SEARCH_BUDGET_MS = 2_000;
const MOUNT_SCAN_FOLDERS_PER_LEVEL = 50;
const MOUNT_SCAN_MAX_STATS = 400;
const MOUNT_CACHE_TTL_MS = 5 * 60_000;

@Injectable()
export class PathService {
  private readonly logger = new Logger(PathService.name);
  private mountCache: { root: string; mounts: string[]; expires: number } | null = null;

  constructor(
    private readonly pathPolicy: PathPolicyService,
    private readonly pathRepository?: PathRepository,
  ) {}

  getConfig(): PathConfig {
    return { root: this.pathPolicy.getBrowseRoot() };
  }

  async listDirectories(rawPath?: string): Promise<DirectoryEntry[]> {
    const browseRoot = resolve(this.pathPolicy.getBrowseRoot());
    const resolved = resolve(await this.pathPolicy.resolveBrowsePath(rawPath));
    const relativePath = relative(browseRoot, resolved);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return [];

    if (await this.isBlocked(resolved)) {
      return [];
    }
    try {
      const rootStat = await lstat(resolved);
      if (rootStat.isSymbolicLink()) return [];

      const entries = await readdir(resolved, { withFileTypes: true });
      const dirs: DirectoryEntry[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('.')) continue;
        const full = join(resolved, entry.name);
        dirs.push({ name: entry.name, path: full });
      }
      return dirs.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  async createDirectory(rawParent: string, rawName: string): Promise<CreateFolderResult> {
    const name = this.assertSafeName(rawName);
    const browseRoot = resolve(this.pathPolicy.getBrowseRoot());
    const parent = resolve(await this.pathPolicy.resolveBrowsePath(rawParent));
    const relativeParent = relative(browseRoot, parent);
    if (relativeParent === '..' || relativeParent.startsWith(`..${sep}`) || isAbsolute(relativeParent)) {
      throw new ForbiddenException('Cannot create a folder outside the configured library browse root');
    }

    if (await this.isBlocked(parent)) {
      throw new ForbiddenException('Cannot create a folder in this location');
    }

    const startedAt = Date.now();
    this.logger.log(`[path.create_folder] [start] parentPath="${sanitizeLogValue(parent)}" name="${sanitizeLogValue(name)}" - create folder started`);
    try {
      const parentStat = await lstat(parent);
      if (parentStat.isSymbolicLink()) throw new ForbiddenException('Cannot create a folder under a symbolic link');
      if (!parentStat.isDirectory()) throw new BadRequestException('Parent path is not a directory');

      const target = join(parent, name);
      const resolvedTarget = resolve(target);
      const relativeTarget = relative(parent, resolvedTarget);
      if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
        throw new BadRequestException('Invalid folder name');
      }
      await this.pathPolicy.assertWithinBrowseRoot(resolvedTarget);

      await mkdir(resolvedTarget);
      this.logger.log(
        `[path.create_folder] [end] path="${sanitizeLogValue(resolvedTarget)}" durationMs=${Date.now() - startedAt} - create folder completed`,
      );
      return { name, path: resolvedTarget };
    } catch (error) {
      this.logger.warn(
        `[path.create_folder] [fail] parentPath="${sanitizeLogValue(parent)}" name="${sanitizeLogValue(name)}" durationMs=${Date.now() - startedAt} errorClass=${getErrorClass(error)} error="${sanitizeLogValue(getErrorMessage(error))}" - create folder failed`,
      );
      throw this.mapCreateError(error);
    }
  }

  /**
   * One folder's subfolders with what the picker shows beside them. Unlike `listDirectories`, a folder
   * that cannot be read says so instead of looking empty.
   */
  async listFolder(rawPath?: string): Promise<FolderListing> {
    const resolved = resolve(await this.pathPolicy.resolveBrowsePath(rawPath));
    const blocked: FolderListing = { path: resolved, state: 'blocked', entries: [], truncated: false };
    if (await this.isBlocked(resolved)) return blocked;

    let dirents: Dirent[];
    let parentDev: number;
    let realDir: string;
    try {
      const rootStat = await lstat(resolved);
      if (rootStat.isSymbolicLink()) return blocked;
      if (!rootStat.isDirectory()) return { ...blocked, state: 'missing' };
      parentDev = rootStat.dev;
      dirents = await readdir(resolved, { withFileTypes: true });
      realDir = await realpath(resolved);
    } catch (error) {
      return { ...blocked, state: stateForError(error) };
    }

    const rawAppData = this.pathPolicy.getAppDataPath();
    const appDataPath = await this.pathPolicy.getCanonicalAppDataPath();
    // The data folder may be reached through a symlink in either path, so both spellings are compared.
    const isAppData = (full: string, name: string) =>
      (!!rawAppData && isInsideOrAt(full, rawAppData)) ||
      (!!appDataPath && (isInsideOrAt(full, appDataPath) || isInsideOrAt(join(realDir, name), appDataPath)));
    const listable = dirents.filter((entry) => isListableDirectory(entry, join(resolved, entry.name)) && !isBlockedPath(join(realDir, entry.name)));
    const truncated = listable.length > LISTING_MAX_ENTRIES;
    const dirs = truncated ? listable.sort((a, b) => a.name.localeCompare(b.name)).slice(0, LISTING_MAX_ENTRIES) : listable;
    // A folder of thousands of author folders is listed by name alone: no per-child stat or peek.
    const inspectChildren = dirs.length <= HAS_CHILDREN_CHECK_LIMIT;
    const entries = await mapLimit(dirs, 16, async (entry): Promise<FolderListingEntry> => {
      const full = join(resolved, entry.name);
      let mount = false;
      if (inspectChildren) {
        try {
          mount = (await stat(full)).dev !== parentDev;
        } catch {
          // An unreadable folder is still listed; opening it reports why.
        }
      }
      return {
        name: entry.name,
        path: full,
        mount,
        system: resolved === sep && SYSTEM_FOLDERS.has(entry.name),
        appData: isAppData(full, entry.name),
        hasChildren: inspectChildren ? await hasListableChild(full) : null,
      };
    });
    return { path: resolved, state: 'ok', entries: entries.sort((a, b) => a.name.localeCompare(b.name)), truncated };
  }

  /** Folders whose name contains `query`, breadth-first below `rawPath`, within fixed bounds. */
  async searchFolders(query: string, rawPath?: string, includeSystem = false): Promise<FolderSearchResult> {
    const root = resolve(await this.pathPolicy.resolveBrowsePath(rawPath));
    // Names are compared composed and case-folded the same way on every server, whatever its locale.
    const fold = (name: string) => name.normalize('NFC').toLowerCase();
    const needle = fold(query.trim());
    const results: string[] = [];
    if (!needle || (await this.isBlocked(root))) return { results, truncated: false };

    const deadline = Date.now() + SEARCH_BUDGET_MS;
    // Each folder travels with its real path, so a symlink in the start path cannot lead into a blocked folder.
    let queue = [{ dir: root, real: await realTarget(root) }];
    let entries = 0;
    for (let depth = 0; depth < SEARCH_MAX_DEPTH && queue.length > 0; depth++) {
      const next: typeof queue = [];
      for (const { dir, real } of queue) {
        if (results.length >= SEARCH_MAX_RESULTS || entries >= SEARCH_MAX_ENTRIES || Date.now() > deadline) return { results, truncated: true };
        let dirents: Dirent[];
        try {
          dirents = await readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        entries += dirents.length;
        dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of dirents) {
          const full = join(dir, entry.name);
          const childReal = join(real, entry.name);
          if (!isListableDirectory(entry, full) || isBlockedPath(childReal)) continue;
          if (!includeSystem && dir === sep && SYSTEM_FOLDERS.has(entry.name)) continue;
          if (fold(entry.name).includes(needle)) {
            results.push(full);
            if (results.length >= SEARCH_MAX_RESULTS) return { results, truncated: true };
          }
          next.push({ dir: full, real: childReal });
        }
      }
      queue = next;
    }
    // Folders deeper than the search goes were never looked at.
    return { results, truncated: queue.length > 0 };
  }

  /** Where a picker starts: mounted folders near the browse root, the data folder, every library's folders. */
  async getPlaces(): Promise<FolderPlaces> {
    const root = resolve(this.pathPolicy.getBrowseRoot());
    const appDataPath = await this.pathPolicy.getCanonicalAppDataPath();
    const mounts = await this.findMounts(root);
    const rows = (await this.pathRepository?.findLibraryFolders()) ?? [];
    const libraries = new Map<number, FolderPickerLibrary>();
    for (const row of rows) {
      const library = libraries.get(row.libraryId) ?? { id: row.libraryId, name: row.name, icon: row.icon, folders: [] };
      library.folders.push(row.path);
      libraries.set(row.libraryId, library);
    }

    return {
      root,
      mounts: mounts.length > 0 || root === sep ? mounts : [root],
      appDataPath: appDataPath && isInsideOrAt(appDataPath, root) ? appDataPath : null,
      libraries: [...libraries.values()],
    };
  }

  /**
   * Folders on their own filesystem within two levels of the root. Mounts change with a container
   * restart, not between picker opens, so the answer is cached; the walk reads only the first folders
   * of each level, so a root holding thousands of author folders costs the same as `/`.
   */
  private async findMounts(root: string): Promise<string[]> {
    if (this.mountCache && this.mountCache.root === root && this.mountCache.expires > Date.now()) return this.mountCache.mounts;
    const mounts: string[] = [];
    let stats = 0;
    const visit = async (dir: string, dev: number, depth: number) => {
      let dirents: Dirent[];
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const dirs = dirents.filter((entry) => isListableDirectory(entry, join(dir, entry.name)) && !(dir === sep && SYSTEM_FOLDERS.has(entry.name)));
      for (const entry of dirs.slice(0, MOUNT_SCAN_FOLDERS_PER_LEVEL)) {
        if (stats++ >= MOUNT_SCAN_MAX_STATS) return;
        const full = join(dir, entry.name);
        let childDev: number;
        try {
          childDev = (await stat(full)).dev;
        } catch {
          continue;
        }
        if (childDev !== dev) mounts.push(full);
        else if (depth < 2) await visit(full, dev, depth + 1);
      }
    };
    try {
      await visit(root, (await stat(root)).dev, 1);
    } catch {
      // An unreadable root has no places to offer.
    }
    this.mountCache = { root, mounts, expires: Date.now() + MOUNT_CACHE_TTL_MS };
    return mounts;
  }

  private isBlocked(resolved: string): Promise<boolean> {
    return isBlockedTarget(resolved);
  }

  private assertSafeName(rawName: string): string {
    const name = (rawName ?? '').trim();
    const safeName = basename(name);
    if (!name) throw new BadRequestException('Folder name is required');
    if (safeName !== name || safeName.includes('/') || safeName.includes('\\') || safeName.includes(sep)) {
      throw new BadRequestException('Folder name cannot contain path separators');
    }
    if (safeName === '.' || safeName === '..' || safeName.startsWith('.')) {
      throw new BadRequestException('Folder name cannot start with a dot');
    }
    if (safeName.includes('\0')) throw new BadRequestException('Folder name contains invalid characters');
    return safeName;
  }

  private mapCreateError(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    switch (getErrorCode(error)) {
      case 'EEXIST':
        return new ConflictException('A folder with that name already exists');
      case 'EACCES':
      case 'EPERM':
        return new ForbiddenException('Permission denied');
      case 'EROFS':
        return new BadRequestException('The filesystem is read-only');
      case 'ENOENT':
        return new BadRequestException('Parent folder no longer exists');
      default:
        return new InternalServerErrorException('Could not create the folder');
    }
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function getErrorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'Error';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
