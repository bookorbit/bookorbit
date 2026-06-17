import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { access as fsAccess, stat } from 'fs/promises';
import { basename, dirname, extname, join, relative } from 'path';
import { Readable } from 'stream';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { formatSeriesIndex } from '../../common/utils/series-index-format.utils';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { books, bookFiles, libraries, libraryFolders } from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import { UploadValidatorService } from './upload-validator.service';
import { UploadStorageService } from './upload-storage.service';
import { UploadProcessorService } from './upload-processor.service';
import { FileRenameService } from '../file-write/file-rename.service';
import { resolveDownloadFilename, resolveUploadPath } from '@bookorbit/types';
import type { AddBookFileResult, UploadResult } from '@bookorbit/types';
import { extractEpubMetadata } from '../metadata/lib/epub';
import { extractCbzMetadata, extractCbrMetadata, extractCb7Metadata } from '../metadata/lib/cbz-metadata';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { parsePdfFile, type PdfParseWarning } from '../metadata/lib/pdf-parser';
import { computeFileHash } from '../scanner/lib/hash';
import { clampIno } from '../scanner/lib/walk';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly appSettings: AppSettingsService,
    private readonly libraryService: LibraryService,
    private readonly validator: UploadValidatorService,
    private readonly storage: UploadStorageService,
    private readonly processor: UploadProcessorService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private resolveFileRenameService(): FileRenameService | null {
    try {
      return this.moduleRef.get(FileRenameService, { strict: false });
    } catch {
      return null;
    }
  }

  async upload(libraryId: number, folderId: number | undefined, rawFilename: string, fileStream: Readable, user: RequestUser): Promise<UploadResult> {
    const event = 'upload.book';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] libraryId=${libraryId} userId=${user.id} folderId=${folderId ?? 'auto'} rawFilename="${rawFilename}" - upload started`,
    );
    const isSuperuser = user.isSuperuser;

    const library = await this.findLibraryOrFail(libraryId);
    await this.libraryService.verifyUserAccess(user.id, libraryId, isSuperuser);

    const folder = await this.resolveFolder(libraryId, folderId);

    const filename = this.validator.sanitizeFilename(rawFilename);
    const format = this.validator.validateFormat(filename, library.allowedFormats);

    const { tempPath, sizeBytes } = await this.storage.streamToTemp(fileStream);
    let destinationPath: string | null = null;
    let shouldCleanupDestination = false;

    try {
      const { absolutePath, bookFolderPath, relPath } = await this.resolveDestination(library, folder.path, tempPath, filename, format);
      destinationPath = absolutePath;

      if (await this.destinationExists(absolutePath)) {
        throw new ConflictException(`A file named "${basename(absolutePath)}" already exists at the target location`);
      }

      shouldCleanupDestination = true;
      await this.storage.moveToPath(tempPath, absolutePath);

      const { bookId } = await this.processor.createBookRecord(libraryId, folder.id, bookFolderPath, absolutePath, relPath, format, sizeBytes);

      this.processor.extractMetadataAsync(bookId, absolutePath, format);

      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} userId=${user.id} folderId=${folder.id} bookId=${bookId} format=${format} sizeBytes=${sizeBytes} durationMs=${Date.now() - startedAt} - upload completed`,
      );
      return { bookId, filename: basename(absolutePath), format, sizeBytes };
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.error(
        `[${event}] [fail] libraryId=${libraryId} userId=${user.id} folderId=${folder.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - upload failed`,
      );
      await Promise.allSettled([
        this.storage.cleanup(tempPath),
        shouldCleanupDestination && destinationPath ? this.storage.cleanup(destinationPath) : Promise.resolve(),
      ]);
      throw err;
    }
  }

  async addFileToBook(bookId: number, rawFilename: string, fileStream: Readable, user: RequestUser): Promise<AddBookFileResult> {
    const event = 'book.add_file';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] bookId=${bookId} userId=${user.id} rawFilename="${sanitizeLogValue(rawFilename)}" - add file to book started`,
    );

    const [bookRow] = await this.db
      .select({
        id: books.id,
        folderPath: books.folderPath,
        libraryId: books.libraryId,
        libraryFolderId: books.libraryFolderId,
        primaryFileId: books.primaryFileId,
        status: books.status,
        allowedFormats: libraries.allowedFormats,
        organizationMode: libraries.organizationMode,
        libraryFolderPath: libraryFolders.path,
      })
      .from(books)
      .innerJoin(libraries, eq(books.libraryId, libraries.id))
      .innerJoin(libraryFolders, eq(books.libraryFolderId, libraryFolders.id))
      .where(eq(books.id, bookId))
      .limit(1);

    if (!bookRow) throw new NotFoundException(`Book ${bookId} not found`);

    await this.libraryService.verifyUserAccess(user.id, bookRow.libraryId, user.isSuperuser);

    if (bookRow.organizationMode === 'book_per_file') {
      throw new BadRequestException('Cannot add files to a book in a single-file library. Upload a new book instead.');
    }

    const filename = this.validator.sanitizeFilename(rawFilename);
    const format = this.validator.validateFormat(filename, bookRow.allowedFormats);

    const { tempPath, sizeBytes } = await this.storage.streamToTemp(fileStream);

    if (sizeBytes === 0) {
      await this.storage.cleanup(tempPath);
      throw new BadRequestException('File must not be empty');
    }

    let destination: string | null = null;
    let shouldCleanupDestination = false;

    try {
      const fileHash = await computeFileHash(tempPath);

      const [existingWithHash] = await this.db
        .select({ id: bookFiles.id })
        .from(bookFiles)
        .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.fileHash, fileHash)))
        .limit(1);

      if (existingWithHash) {
        throw new ConflictException('This file is already attached to this book');
      }

      destination = join(bookRow.folderPath, filename);

      if (await this.destinationExists(destination)) {
        throw new ConflictException(`A file named "${filename}" already exists in this book's folder`);
      }

      shouldCleanupDestination = true;
      await this.storage.moveToPath(tempPath, destination);
      // File is on disk. Do not delete it on any subsequent failure — the scanner
      // will reconcile any orphan. This also prevents the catch block from deleting
      // a file that a concurrent upload may have written to the same path.
      shouldCleanupDestination = false;

      const fileStat = await stat(destination, { bigint: true });
      const safeIno = clampIno(fileStat.ino);
      const relPath = relative(bookRow.libraryFolderPath, destination);

      const [inserted] = await this.db
        .insert(bookFiles)
        .values({
          bookId,
          libraryFolderId: bookRow.libraryFolderId,
          absolutePath: destination,
          relPath,
          ino: safeIno,
          sizeBytes,
          mtime: fileStat.mtime,
          fileHash,
          format,
          role: 'content',
        })
        .returning({
          id: bookFiles.id,
          format: bookFiles.format,
          role: bookFiles.role,
          sizeBytes: bookFiles.sizeBytes,
          absolutePath: bookFiles.absolutePath,
          createdAt: bookFiles.createdAt,
          durationSeconds: bookFiles.durationSeconds,
        });

      if (!inserted) throw new Error('Failed to insert book file record');

      let finalStatus = bookRow.status;
      const needsPrimaryPromotion = bookRow.primaryFileId === null;
      const needsStatusUpdate = bookRow.status === 'missing';

      if (needsPrimaryPromotion || needsStatusUpdate) {
        await this.db
          .update(books)
          .set({
            ...(needsPrimaryPromotion ? { primaryFileId: inserted.id } : {}),
            ...(needsStatusUpdate ? { status: 'present' } : {}),
            updatedAt: new Date(),
          })
          .where(eq(books.id, bookId));

        if (needsStatusUpdate) finalStatus = 'present';
      }

      this.processor.extractAudioDurationAsync(bookId, destination, format);

      this.logger.log(
        `[${event}] [end] bookId=${bookId} userId=${user.id} fileId=${inserted.id} format=${format} sizeBytes=${sizeBytes} durationMs=${Date.now() - startedAt} - add file to book completed`,
      );

      return {
        id: inserted.id,
        format: inserted.format,
        role: needsPrimaryPromotion ? 'primary' : inserted.role,
        sizeBytes: inserted.sizeBytes,
        absolutePath: inserted.absolutePath,
        createdAt: inserted.createdAt.toISOString(),
        filename: basename(destination),
        durationSeconds: inserted.durationSeconds,
        bookStatus: finalStatus,
      };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - add file to book failed`,
      );
      await Promise.allSettled([
        this.storage.cleanup(tempPath),
        shouldCleanupDestination && destination ? this.storage.cleanup(destination) : Promise.resolve(),
      ]);
      throw err;
    }
  }

  async renameBookFiles(bookId: number, user: RequestUser): Promise<void> {
    const event = 'book.rename_files';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] bookId=${bookId} userId=${user.id} - rename book files started`);

    const [bookRow] = await this.db.select({ id: books.id, libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);

    if (!bookRow) throw new NotFoundException(`Book ${bookId} not found`);

    await this.libraryService.verifyUserAccess(user.id, bookRow.libraryId, user.isSuperuser);

    const fileRenameService = this.resolveFileRenameService();
    if (!fileRenameService) {
      throw new ServiceUnavailableException('File rename service is not available');
    }

    await fileRenameService.performRename(bookId, user.id, true, false);

    this.logger.log(`[${event}] [end] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} - rename book files completed`);
  }

  private async resolveDestination(
    library: { fileNamingPattern?: string | null; organizationMode?: string | null },
    libraryFolderPath: string,
    tempPath: string,
    filename: string,
    format: string,
  ): Promise<{ absolutePath: string; bookFolderPath: string; relPath: string }> {
    const pattern =
      library.fileNamingPattern ??
      (library.organizationMode === 'book_per_folder'
        ? await this.appSettings.getUploadPatternBookPerFolder()
        : await this.appSettings.getUploadPattern());
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();

    if (pattern) {
      const stem = basename(filename, extname(filename));
      const tokens = await this.buildPatternTokens(tempPath, format, stem);
      if (library.organizationMode === 'book_per_file') {
        const resolvedFilename = resolveDownloadFilename(pattern, tokens, format, { sanitizeForCrossPlatform });
        if (resolvedFilename) {
          const absolutePath = join(libraryFolderPath, resolvedFilename);
          return {
            absolutePath,
            bookFolderPath: absolutePath,
            relPath: resolvedFilename,
          };
        }
      } else {
        const resolved = resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });

        if (resolved) {
          const absolutePath = join(libraryFolderPath, resolved);
          const relPath = resolved;
          const bookFolderPath = dirname(absolutePath);
          return { absolutePath, bookFolderPath, relPath };
        }
      }
    }

    if (library.organizationMode === 'book_per_file') {
      const absolutePath = join(libraryFolderPath, filename);
      return {
        absolutePath,
        bookFolderPath: absolutePath,
        relPath: filename,
      };
    }

    const stem = basename(filename, extname(filename));
    const bookFolderPath = join(libraryFolderPath, stem);
    const absolutePath = join(bookFolderPath, filename);
    const relPath = join(stem, filename);
    return { absolutePath, bookFolderPath, relPath };
  }

  private async buildPatternTokens(tempPath: string, format: string, stem: string): Promise<Record<string, string>> {
    const base: Record<string, string> = { originalFilename: stem, extension: format };
    const event = 'upload.pattern_tokens';
    const startedAt = Date.now();

    try {
      let parsed: {
        title?: string | null;
        subtitle?: string | null;
        publisher?: string | null;
        publishedYear?: number | null;
        language?: string | null;
        seriesName?: string | null;
        seriesIndex?: number | null;
        isbn13?: string | null;
        authors: { name: string }[];
      } | null = null;

      if (format === 'epub') {
        parsed = await extractEpubMetadata(tempPath);
      } else if (format === 'cbz') {
        parsed = await extractCbzMetadata(tempPath);
      } else if (format === 'cbr') {
        parsed = await extractCbrMetadata(tempPath);
      } else if (format === 'cb7') {
        parsed = await extractCb7Metadata(tempPath);
      } else if (format === 'mobi' || format === 'azw3' || format === 'azw') {
        const mobi = await parseMobiFile(tempPath);
        if (mobi) {
          const year = mobi.publishedDate ? parseInt(mobi.publishedDate.substring(0, 4), 10) || null : null;
          parsed = {
            title: mobi.title,
            publisher: mobi.publisher,
            publishedYear: year,
            language: mobi.language,
            isbn13: mobi.isbn,
            seriesName: null,
            seriesIndex: null,
            authors: mobi.authors.map((name) => ({ name })),
          };
        }
      } else if (format === 'pdf') {
        const pdf = await parsePdfFile(tempPath, {
          extractCover: false,
          onWarning: (warning) => this.logPdfPatternTokenWarning(warning),
        });
        if (pdf) {
          parsed = { title: pdf.title, publisher: pdf.publisher, authors: pdf.authors, seriesName: null, seriesIndex: null };
        }
      }

      if (!parsed) return base;

      if (parsed.title) base['title'] = parsed.title;
      if (parsed.subtitle) base['subtitle'] = parsed.subtitle;
      if (parsed.publisher) base['publisher'] = parsed.publisher;
      if (parsed.language) base['language'] = parsed.language;
      if (parsed.isbn13) base['isbn'] = parsed.isbn13;
      if (parsed.publishedYear) base['year'] = String(parsed.publishedYear);
      if (parsed.seriesName) base['series'] = parsed.seriesName;
      const seriesIndex = formatSeriesIndex(parsed.seriesIndex ?? null);
      if (seriesIndex) base['seriesIndex'] = seriesIndex;
      if (parsed.authors.length > 0) {
        base['authors'] = parsed.authors.map((a) => a.name).join(', ');
      }
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.warn(
        `[${event}] [fail] format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - token extraction failed, using filename tokens`,
      );
    }

    return base;
  }

  private parseError(err: unknown): { errorClass: string; errorMessage: string } {
    const errorClass = err instanceof Error ? err.name : 'Error';
    const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
    return { errorClass, errorMessage };
  }

  private logPdfPatternTokenWarning(warning: PdfParseWarning): void {
    if (warning.code === 'buffered-large-pdf') {
      this.logger.warn(
        `[upload.pattern_tokens_pdf] [end] path="${warning.absolutePath}" code=${warning.code} sizeBytes=${warning.sizeBytes ?? 0} thresholdBytes=${warning.thresholdBytes ?? 0} - large pdf buffered in memory`,
      );
      return;
    }
    this.logger.warn(
      `[upload.pattern_tokens_pdf] [fail] path="${warning.absolutePath}" code=${warning.code} errorClass=${warning.errorClass} error="${warning.errorMessage}" - pdf token extraction warning emitted`,
    );
  }

  private async destinationExists(absolutePath: string): Promise<boolean> {
    try {
      await fsAccess(absolutePath);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  private async findLibraryOrFail(libraryId: number) {
    const [library] = await this.db.select().from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    if (!library) throw new NotFoundException('Library not found');
    return library;
  }

  private async resolveFolder(libraryId: number, folderId?: number) {
    if (folderId !== undefined) {
      const [folder] = await this.db.select().from(libraryFolders).where(eq(libraryFolders.id, folderId)).limit(1);
      if (!folder || folder.libraryId !== libraryId) throw new BadRequestException('Folder does not belong to this library');
      return folder;
    }

    const folders = await this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, libraryId));
    if (folders.length === 0) throw new BadRequestException('Library has no folders configured');
    return folders.toSorted((a, b) => a.id - b.id)[0];
  }
}
