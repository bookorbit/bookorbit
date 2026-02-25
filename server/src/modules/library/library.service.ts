import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, readdir, rm, stat } from 'fs/promises';
import { join } from 'path';

import type { RequestUser } from '../../common/types/request-user';
import { isPrimaryFormat } from '../scanner/lib/classify';
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
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  async verifyUserAccess(userId: number, libraryId: number, isSuperuser: boolean): Promise<void> {
    if (isSuperuser) return;
    const hasAccess = await this.libraryRepo.hasUserAccess(userId, libraryId);
    if (!hasAccess) throw new ForbiddenException('No access to this library');
  }

  async findAll(user: RequestUser): Promise<{ id: number }[]> {
    const isSuperuser = user.roles.some((r) => r.isSuperuser);
    return isSuperuser ? this.libraryRepo.findAll() : this.libraryRepo.findAllForUser(user.id);
  }

  async findOne(id: number) {
    const [library] = await this.libraryRepo.findById(id);
    if (!library) throw new NotFoundException('Library not found');
    const folders = await this.libraryRepo.findFoldersByLibrary(id);
    return { ...library, folders };
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
      formatPriority: dto.formatPriority ?? ['epub', 'pdf', 'cbz', 'cbr', 'mobi', 'azw3', 'fb2'],
      allowedFormats: dto.allowedFormats ?? [],
      organizationMode: dto.organizationMode ?? 'auto',
      excludePatterns: dto.excludePatterns ?? [],
      markAsFinishedSecondsRemaining: dto.markAsFinishedSecondsRemaining ?? null,
      markAsFinishedPercentComplete: dto.markAsFinishedPercentComplete ?? null,
      fileNamingPattern: dto.fileNamingPattern ?? null,
    });

    const folders = await Promise.all(dto.folders.map((path) => this.libraryRepo.insertFolder({ libraryId: library.id, path })));

    this.scannerService.startScanAsync(library.id);

    return { ...library, folders: folders.map(([f]) => f) };
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
    return { ...updated, folders };
  }

  async remove(id: number) {
    const [existing] = await this.libraryRepo.findById(id);
    if (!existing) throw new NotFoundException('Library not found');

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
        let accessible = false;
        let fileCount = 0;
        let overlapLibrary: string | undefined;

        try {
          await access(inputPath);
          const s = await stat(inputPath);
          if (!s.isDirectory()) {
            return { path: inputPath, accessible: false, fileCount: 0, error: 'Not a directory' };
          }
          accessible = true;
          fileCount = await countPrimaryFiles(inputPath);
        } catch {
          accessible = false;
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
