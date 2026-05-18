import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { access as fsAccess } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { Readable } from 'stream';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { libraries, libraryFolders } from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import { UploadValidatorService } from './upload-validator.service';
import { UploadStorageService } from './upload-storage.service';
import { UploadProcessorService } from './upload-processor.service';
import { resolveDownloadFilename, resolveUploadPath } from '@bookorbit/types';
import type { UploadResult } from '@bookorbit/types';
import { extractEpubMetadata } from '../metadata/lib/epub';
import { extractCbzMetadata, extractCbrMetadata, extractCb7Metadata } from '../metadata/lib/cbz-metadata';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { parsePdfFile, type PdfParseWarning } from '../metadata/lib/pdf-parser';

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
  ) {}

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

    if (pattern) {
      const stem = basename(filename, extname(filename));
      const tokens = await this.buildPatternTokens(tempPath, format, stem);
      if (library.organizationMode === 'book_per_file') {
        const resolvedFilename = resolveDownloadFilename(pattern, tokens, format);
        if (resolvedFilename) {
          const absolutePath = join(libraryFolderPath, resolvedFilename);
          return {
            absolutePath,
            bookFolderPath: absolutePath,
            relPath: resolvedFilename,
          };
        }
      } else {
        const resolved = resolveUploadPath(pattern, tokens, format);

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
      if (parsed.seriesIndex != null) {
        const whole = Math.floor(parsed.seriesIndex);
        const fraction = parsed.seriesIndex - whole;
        const padded = String(whole).padStart(2, '0');
        base['seriesIndex'] = fraction > 0 ? `${padded}.${String(fraction).split('.')[1]}` : padded;
      }
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
