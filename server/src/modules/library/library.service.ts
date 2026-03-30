import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, rm, stat } from 'fs/promises';
import { join } from 'path';

import { DEFAULT_FORMAT_PRIORITY } from '@projectx/types';
import type { RequestUser } from '../../common/types/request-user';
import { isPrimaryFormat } from '../scanner/lib/classify';
import { FileWatcherService } from '../scanner/file-watcher.service';
import { ScannerService } from '../scanner/scanner.service';
import { CreateLibraryDto } from './dto/create-library.dto';
import { GrantLibraryAccessDto } from './dto/grant-library-access.dto';
import { PrescanLibraryDto } from './dto/prescan-library.dto';
import { ReorderLibrariesDto } from './dto/reorder-libraries.dto';
import { UpdateLibraryDto } from './dto/update-library.dto';
import { LibraryRepository } from './library.repository';

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);
  private readonly booksPath: string;

  constructor(
    private readonly libraryRepo: LibraryRepository,
    private readonly config: ConfigService,
    private readonly scannerService: ScannerService,
    private readonly fileWatcherService: FileWatcherService,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  async verifyUserAccess(userId: number, libraryId: number, isSuperuser: boolean): Promise<void> {
    if (isSuperuser) return;
    const hasAccess = await this.libraryRepo.hasUserAccess(userId, libraryId);
    if (!hasAccess) throw new ForbiddenException('No access to this library');
  }

  async findAll(user: RequestUser) {
    const isSuperuser = user.isSuperuser;
    const libs = isSuperuser ? await this.libraryRepo.findAll() : await this.libraryRepo.findAllForUser(user.id);
    const allFolders = await this.libraryRepo.findAllFolders();
    const foldersByLibrary = new Map<number, typeof allFolders>();
    for (const f of allFolders) {
      const arr = foldersByLibrary.get(f.libraryId);
      if (arr) arr.push(f);
      else foldersByLibrary.set(f.libraryId, [f]);
    }
    return libs.map((lib) => ({
      ...normalizeLibraryOrganizationMode(lib),
      folders: (foldersByLibrary.get(lib.id) ?? []).map(({ id, path, createdAt }) => ({ id, path, createdAt })),
    }));
  }

  async findOne(id: number) {
    const [library] = await this.libraryRepo.findById(id);
    if (!library) throw new NotFoundException('Library not found');
    const folders = await this.libraryRepo.findFoldersByLibrary(id);
    return { ...normalizeLibraryOrganizationMode(library), folders };
  }

  async create(dto: CreateLibraryDto) {
    await this.assertNameAvailable(dto.name);

    const [library] = await this.libraryRepo.insert({
      name: dto.name,
      icon: dto.icon ?? null,
      displayOrder: dto.displayOrder ?? 0,
      watch: dto.watch ?? false,
      autoScanCronExpression: dto.autoScanCronExpression ?? null,
      metadataPrecedence: dto.metadataPrecedence ?? ['folderStructure', 'embedded', 'nfoFile', 'opfFile', 'sidecar'],
      formatPriority: dto.formatPriority ?? [...DEFAULT_FORMAT_PRIORITY],
      allowedFormats: dto.allowedFormats ?? [],
      organizationMode: dto.organizationMode ?? 'book_per_folder',
      excludePatterns: dto.excludePatterns ?? [],
      coverAspectRatio: dto.coverAspectRatio ?? '2/3',
      readingThreshold: dto.readingThreshold ?? 0.25,
      markAsFinishedPercentComplete: dto.markAsFinishedPercentComplete ?? 98,
      fileNamingPattern: dto.fileNamingPattern ?? null,
    });

    const folders = await Promise.all(dto.folders.map((path) => this.libraryRepo.insertFolder({ libraryId: library.id, path })));

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

    if (dto.name && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name, id);
    }

    const { folders: folderPaths, ...fields } = dto;

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
      dto.formatPriority !== undefined ||
      dto.allowedFormats !== undefined ||
      dto.excludePatterns !== undefined ||
      dto.organizationMode !== undefined ||
      folderPaths !== undefined;
    if (shouldRescan) this.scannerService.startScanAsync(id);

    return { ...normalizeLibraryOrganizationMode(updated), folders };
  }

  async remove(id: number) {
    const [existing] = await this.libraryRepo.findById(id);
    if (!existing) throw new NotFoundException('Library not found');

    await this.fileWatcherService.stopWatcher(id);

    const bookRows = await this.libraryRepo.findBookIdsByLibrary(id);
    await this.libraryRepo.delete(id);

    // Clean up cover/thumbnail directories for all deleted books (best-effort, non-blocking)
    for (const { id: bookId } of bookRows) {
      const coverDir = join(this.booksPath, 'covers', String(bookId));
      rm(coverDir, { recursive: true, force: true }).catch((err: Error) =>
        this.logger.warn(`Failed to delete cover dir ${coverDir}: ${err.message}`),
      );
    }
  }

  async prescan(dto: PrescanLibraryDto) {
    const allFolderPaths = await this.libraryRepo.findAllFolderPaths();

    const results = await Promise.all(
      dto.paths.map(async (inputPath) => {
        let accessible: boolean;
        let fileCount = 0;
        let overlapLibrary: string | undefined;

        const s = await stat(inputPath).catch(() => null);
        if (s === null) {
          accessible = false;
        } else if (!s.isDirectory()) {
          return { path: inputPath, accessible: false, fileCount: 0, error: 'Not a directory' };
        } else {
          accessible = true;
          try {
            fileCount = await countPrimaryFiles(inputPath);
          } catch {
            accessible = false;
            fileCount = 0;
          }
        }

        // Check if this path overlaps an existing library folder
        for (const existing of allFolderPaths) {
          if (pathsOverlap(inputPath, existing.path)) {
            overlapLibrary = existing.libraryName;
            break;
          }
        }

        return { path: inputPath, accessible, fileCount, overlapLibrary };
      }),
    );

    const totalFiles = results.reduce((sum, r) => sum + r.fileCount, 0);
    return { paths: results, totalFiles };
  }

  async getStats(libraryId: number) {
    const [existing] = await this.libraryRepo.findById(libraryId);
    if (!existing) throw new NotFoundException('Library not found');
    return this.libraryRepo.getStats(libraryId);
  }

  async reorder(dto: ReorderLibrariesDto) {
    await this.libraryRepo.updateDisplayOrders(dto.order);
  }

  getAccess(libraryId: number) {
    return this.libraryRepo.getAccessWithUsers(libraryId);
  }

  grantAccess(libraryId: number, dto: GrantLibraryAccessDto) {
    return this.libraryRepo.grantAccess(libraryId, dto.userId, dto.accessLevel);
  }

  updateAccess(libraryId: number, userId: number, accessLevel: 'viewer' | 'editor' | 'owner') {
    return this.libraryRepo.updateAccess(libraryId, userId, accessLevel);
  }

  revokeAccess(libraryId: number, userId: number) {
    return this.libraryRepo.revokeAccess(libraryId, userId);
  }

  private async assertNameAvailable(name: string, excludeId?: number) {
    const existing = await this.libraryRepo.findByName(name, excludeId);
    if (existing.length > 0) throw new ConflictException('A library with this name already exists');
  }
}

// Count primary-format files recursively in a directory (non-throwing)
async function countPrimaryFiles(dir: string): Promise<number> {
  let count = 0;
  try {
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
  } catch {
    // Unreadable sub-directory — skip
  }
  return count;
}

// True if one path is a prefix of the other (i.e. they overlap in the file tree)
function pathsOverlap(a: string, b: string): boolean {
  const normalize = (p: string) => (p.endsWith('/') ? p : p + '/');
  const na = normalize(a);
  const nb = normalize(b);
  return na.startsWith(nb) || nb.startsWith(na);
}

function normalizeOrganizationMode(mode: string | null | undefined): 'book_per_file' | 'book_per_folder' {
  return mode === 'book_per_file' ? 'book_per_file' : 'book_per_folder';
}

function normalizeLibraryOrganizationMode<T extends Record<string, unknown>>(library: T): T {
  if (!Object.prototype.hasOwnProperty.call(library, 'organizationMode')) {
    return library;
  }
  return {
    ...library,
    organizationMode: normalizeOrganizationMode((library as { organizationMode?: string | null }).organizationMode),
  };
}
