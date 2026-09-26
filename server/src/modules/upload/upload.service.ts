import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { access as fsAccess, stat } from 'fs/promises';
import { basename, dirname, extname, join, relative } from 'path';
import { Readable } from 'stream';
import { and, asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { buildPatternTokens } from '../../common/utils/pattern-tokens.utils';
import { selectPrimaryFileKeepingCurrent } from '../../common/utils/primary-file-selection.utils';

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
import { isAudioFormat, resolveUploadPath } from '@bookorbit/types';
import type { AddBookFileResult, UploadResult } from '@bookorbit/types';
import { extractEpubMetadata } from '../metadata/lib/epub';
import { extractCbzMetadata, extractCbrMetadata, extractCb7Metadata } from '../metadata/lib/cbz-metadata';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { parsePdfFile, type PdfParseWarning } from '../metadata/lib/pdf-parser';
import { extractAudioMetadata } from '../metadata/extractors/audio.extractor';
import { computeFileHash } from '../scanner/lib/hash';
import { resolveExistingPathSpelling } from '../../common/utils/path-identity.utils';
import { inspectEpubMediaOverlayFields, mediaOverlayCapabilityFromFields } from '../reader/epub/epub-media-overlay-capability';
import { PathPolicyService } from '../path/path-policy.service';
import { FORMATS_WITH_UNBOUNDED_METADATA_READS, MAX_BUFFERED_METADATA_BYTES } from '../../common/constants/upload.constants';
import { UploadDestinationExistsError } from './upload-storage.service';
import { uploadError } from './upload-errors';

type Db = NodePgDatabase<typeof schema>;
type StoredUploadResult = UploadResult & { absolutePath: string; created: boolean; libraryId: number };

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
    private readonly pathPolicy: PathPolicyService,
  ) {}

  private resolveFileRenameService(): FileRenameService | null {
    try {
      return this.moduleRef.get(FileRenameService, { strict: false });
    } catch {
      return null;
    }
  }

  private async inspectMediaOverlayFields(absolutePath: string, format: string | null) {
    return inspectEpubMediaOverlayFields(absolutePath, format, (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `[upload.media_overlay_capability] [fail] path="${sanitizeLogValue(absolutePath)}" errorClass=${error.constructor.name} error="${sanitizeLogValue(error.message)}" - EPUB media-overlay inspection failed`,
      );
    });
  }

  async upload(libraryId: number, folderId: number | undefined, rawFilename: string, fileStream: Readable, user: RequestUser): Promise<UploadResult> {
    const stored = await this.storeUpload(libraryId, folderId, rawFilename, fileStream, user);
    if (stored.created) {
      this.processor.processNewBookImportAsync(stored.bookId, stored.libraryId, stored.absolutePath, stored.format);
    } else {
      this.processor.extractMetadataAsync(stored.bookId, stored.absolutePath, stored.format);
    }
    return { bookId: stored.bookId, filename: stored.filename, format: stored.format, sizeBytes: stored.sizeBytes };
  }

  uploadForSession(
    libraryId: number,
    folderId: number | undefined,
    rawFilename: string,
    fileStream: Readable,
    user: RequestUser,
    uploadSessionId: string,
  ): Promise<StoredUploadResult> {
    return this.storeUpload(libraryId, folderId, rawFilename, fileStream, user, uploadSessionId);
  }

  async processStoredUpload(stored: StoredUploadResult): Promise<void> {
    if (stored.created) {
      await this.processor.processNewBookImport(stored.bookId, stored.libraryId, stored.absolutePath, stored.format);
    } else {
      await this.processor.extractMetadata(stored.bookId, stored.absolutePath, stored.format);
    }
  }

  private async storeUpload(
    libraryId: number,
    folderId: number | undefined,
    rawFilename: string,
    fileStream: Readable,
    user: RequestUser,
    uploadSessionId?: string,
  ): Promise<StoredUploadResult> {
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
    if (sizeBytes === 0) {
      await this.storage.cleanup(tempPath);
      throw uploadError.empty();
    }
    let destinationPath: string | null = null;
    let shouldCleanupDestination = false;

    try {
      await this.validator.validateContent(tempPath, format);
      const { absolutePath, bookFolderPath } = await this.resolveDestination(library, folder.path, tempPath, filename, format);
      await this.pathPolicy.assertWithinRoot(absolutePath, folder.path);
      destinationPath = absolutePath;

      if (await this.destinationExists(absolutePath)) {
        throw uploadError.destinationConflict(`A file named "${basename(absolutePath)}" already exists at the target location`);
      }

      shouldCleanupDestination = true;
      await this.storage.moveToPath(tempPath, absolutePath);

      const persistedAbsolutePath = (await resolveExistingPathSpelling(absolutePath, folder.path)) ?? absolutePath;
      const persistedBookFolderPath = bookFolderPath === absolutePath ? persistedAbsolutePath : dirname(persistedAbsolutePath);
      const persistedRelPath = relative(folder.path, persistedAbsolutePath);
      destinationPath = persistedAbsolutePath;

      const createArgs = [libraryId, folder.id, persistedBookFolderPath, persistedAbsolutePath, persistedRelPath, format, sizeBytes] as const;
      const { bookId, created } = uploadSessionId
        ? await this.processor.createBookRecord(...createArgs, { uploadSessionId })
        : await this.processor.createBookRecord(...createArgs);

      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} userId=${user.id} folderId=${folder.id} bookId=${bookId} format=${format} sizeBytes=${sizeBytes} durationMs=${Date.now() - startedAt} - upload completed`,
      );
      return {
        bookId,
        filename: basename(persistedAbsolutePath),
        format,
        sizeBytes,
        absolutePath: persistedAbsolutePath,
        created,
        libraryId,
      };
    } catch (caught) {
      let err = caught;
      if (err instanceof UploadDestinationExistsError) {
        err = uploadError.destinationConflict(
          `A file named "${destinationPath ? basename(destinationPath) : filename}" already exists at the target location`,
        );
      }
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
      throw uploadError.empty();
    }

    let destination: string | null = null;
    let shouldCleanupDestination = false;

    try {
      await this.validator.validateContent(tempPath, format);
      const fileHash = await computeFileHash(tempPath);

      const [existingWithHash] = await this.db
        .select({ id: bookFiles.id })
        .from(bookFiles)
        .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.fileHash, fileHash)))
        .limit(1);

      if (existingWithHash) {
        throw uploadError.duplicate('This file is already attached to this book');
      }

      destination = join(bookRow.folderPath, filename);
      await this.pathPolicy.assertWithinRoot(destination, bookRow.folderPath);

      if (await this.destinationExists(destination)) {
        throw uploadError.destinationConflict(`A file named "${filename}" already exists in this book's folder`);
      }

      shouldCleanupDestination = true;
      await this.storage.moveToPath(tempPath, destination);
      // File is on disk. Do not delete it on any subsequent failure — the scanner
      // will reconcile any orphan. This also prevents the catch block from deleting
      // a file that a concurrent upload may have written to the same path.
      shouldCleanupDestination = false;

      const fileStat = await stat(destination, { bigint: true });
      const ino = fileStat.ino;
      const relPath = relative(bookRow.libraryFolderPath, destination);
      const mediaOverlayFields = await this.inspectMediaOverlayFields(destination, format);

      const { inserted, isPrimary, finalStatus } = await this.db.transaction(async (tx) => {
        const [lockedBook] = await tx
          .select({
            primaryFileId: books.primaryFileId,
            status: books.status,
            formatPriority: libraries.formatPriority,
          })
          .from(books)
          .innerJoin(libraries, eq(books.libraryId, libraries.id))
          .where(eq(books.id, bookId))
          .for('update', { of: books })
          .limit(1);

        if (!lockedBook) throw new NotFoundException(`Book ${bookId} not found`);

        const [inserted] = await tx
          .insert(bookFiles)
          .values({
            bookId,
            libraryFolderId: bookRow.libraryFolderId,
            absolutePath: destination,
            relPath,
            ino,
            sizeBytes,
            mtime: fileStat.mtime,
            fileHash,
            format,
            role: 'content',
            ...mediaOverlayFields,
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

        const contentFiles = await tx
          .select({
            id: bookFiles.id,
            format: bookFiles.format,
            sizeBytes: bookFiles.sizeBytes,
            mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
          })
          .from(bookFiles)
          .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.role, 'content')))
          .orderBy(asc(bookFiles.id));

        const winner = selectPrimaryFileKeepingCurrent(contentFiles, lockedBook.primaryFileId, lockedBook.formatPriority);
        const nextPrimaryFileId = winner?.id ?? null;
        const needsPrimaryUpdate = nextPrimaryFileId !== lockedBook.primaryFileId;
        const needsStatusUpdate = lockedBook.status === 'missing';

        if (needsPrimaryUpdate || needsStatusUpdate) {
          await tx
            .update(books)
            .set({
              ...(needsPrimaryUpdate ? { primaryFileId: nextPrimaryFileId } : {}),
              ...(needsStatusUpdate ? { status: 'present' } : {}),
              updatedAt: new Date(),
            })
            .where(eq(books.id, bookId));
        }

        return {
          inserted,
          isPrimary: inserted.id === nextPrimaryFileId,
          finalStatus: needsStatusUpdate ? 'present' : lockedBook.status,
        };
      });

      this.processor.extractAudioDurationAsync(bookId, destination, format);
      this.processor.extractAddedAudioChaptersAsync(bookId, format);
      this.processor.reconcileCoversAsync([bookId]);

      this.logger.log(
        `[${event}] [end] bookId=${bookId} userId=${user.id} fileId=${inserted.id} format=${format} sizeBytes=${sizeBytes} durationMs=${Date.now() - startedAt} - add file to book completed`,
      );

      return {
        id: inserted.id,
        format: inserted.format,
        role: isPrimary ? 'primary' : inserted.role,
        sizeBytes: inserted.sizeBytes,
        absolutePath: inserted.absolutePath,
        createdAt: inserted.createdAt.toISOString(),
        filename: basename(destination),
        durationSeconds: inserted.durationSeconds,
        mediaOverlay: mediaOverlayCapabilityFromFields({ format: inserted.format, ...mediaOverlayFields }),
        bookStatus: finalStatus,
      };
    } catch (caught) {
      let err = caught;
      if (err instanceof UploadDestinationExistsError) {
        err = uploadError.destinationConflict(`A file named "${filename}" already exists in this book's folder`);
      }
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

  /**
   * Both organization modes keep the pattern's folder segments, so an upload lands where the
   * rename and move services would put the same book. The modes differ only in what counts as
   * the book: in `book_per_file` the file itself is the book key, not the folder holding it.
   */
  private async resolveDestination(
    library: { name?: string | null; fileNamingPattern?: string | null; organizationMode?: string | null },
    libraryFolderPath: string,
    tempPath: string,
    filename: string,
    format: string,
  ): Promise<{ absolutePath: string; bookFolderPath: string }> {
    const pattern =
      library.fileNamingPattern ??
      (library.organizationMode === 'book_per_folder'
        ? await this.appSettings.getUploadPatternBookPerFolder()
        : await this.appSettings.getUploadPattern());
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();
    const isBookPerFile = library.organizationMode === 'book_per_file';

    if (pattern) {
      const stem = basename(filename, extname(filename));
      const tokens = await this.buildUploadPatternTokens(tempPath, format, stem, library.name);
      const resolved = resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });

      if (resolved) {
        const absolutePath = join(libraryFolderPath, resolved);
        return { absolutePath, bookFolderPath: isBookPerFile ? absolutePath : dirname(absolutePath) };
      }
    }

    if (isBookPerFile) {
      const absolutePath = join(libraryFolderPath, filename);
      return { absolutePath, bookFolderPath: absolutePath };
    }

    const stem = basename(filename, extname(filename));
    const bookFolderPath = join(libraryFolderPath, stem);
    return { absolutePath: join(bookFolderPath, filename), bookFolderPath };
  }

  private async buildUploadPatternTokens(
    tempPath: string,
    format: string,
    stem: string,
    libraryName?: string | null,
  ): Promise<Record<string, string>> {
    const fallback = buildPatternTokens({ metadata: {}, originalStem: stem, format, libraryName });
    const event = 'upload.pattern_tokens';
    const startedAt = Date.now();

    try {
      const fileSize = (await stat(tempPath)).size;
      if (FORMATS_WITH_UNBOUNDED_METADATA_READS.has(format) && fileSize > MAX_BUFFERED_METADATA_BYTES) return fallback;
      let parsed: {
        title?: string | null;
        subtitle?: string | null;
        publisher?: string | null;
        publishedYear?: number | null;
        language?: string | null;
        seriesName?: string | null;
        seriesIndex?: string | null;
        isbn13?: string | null;
        authors: { name: string }[];
        narrators?: string[];
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
      } else if (isAudioFormat(format)) {
        parsed = await extractAudioMetadata(tempPath);
      }

      if (!parsed) return fallback;

      return buildPatternTokens({
        metadata: parsed,
        authors: parsed.authors.map((author) => author.name),
        narrators: parsed.narrators,
        originalStem: stem,
        format,
        libraryName,
      });
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.warn(
        `[${event}] [fail] format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - token extraction failed, using filename tokens`,
      );
    }

    return fallback;
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
