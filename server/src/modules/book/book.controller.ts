import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import archiver from 'archiver';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { ForbidPermission } from '../../common/decorators/forbid-permission.decorator';
import { imageContentTypeFromPath } from '../../common/image-content-type';
import type { RequestUser } from '../../common/types/request-user';
import { FileWriteService } from '../file-write/file-write.service';
import { BookService } from './book.service';
import { BookQueryPipe } from './pipes/book-query.pipe';
import { BulkBookIdsDto } from './dto/bulk-book-ids.dto';
import { BulkSetStatusDto } from './dto/bulk-set-status.dto';
import { BulkSetRatingDto } from './dto/bulk-set-rating.dto';
import { BulkSetMetadataDto } from './dto/bulk-set-metadata.dto';
import { BulkUpdateTagsDto } from './dto/bulk-update-tags.dto';
import { BulkSetMetadataLockDto } from './dto/bulk-set-metadata-lock.dto';
import { BulkEditMetadataDto } from './dto/bulk-edit-metadata.dto';
import { DeleteBooksDto } from './dto/delete-books.dto';
import { ExportBooksDto } from './dto/export-books.dto';
import { MetadataExportDto } from './dto/metadata-export.dto';
import { SaveProgressDto } from './dto/save-progress.dto';
import { UpsertAudioProgressDto } from './dto/upsert-audio-progress.dto';
import { UpdateBookMetadataAndLocksDto } from './dto/update-book-metadata-and-locks.dto';
import { UpdateBookMetadataDto } from './dto/update-book-metadata.dto';
import { SearchBooksDto } from './dto/search-books.dto';
import { UpdateBookFileDto } from './dto/update-book-file.dto';
import { SetStatusDto } from '../user-book-status/dto/set-status.dto';
import { Permission, AuditAction, AuditResource } from '@bookorbit/types';
import type { BookQuery } from '@bookorbit/types';
import { UpdateBookMetadataLocksDto } from '../book-metadata-lock/dto/update-book-metadata-locks.dto';

function stripLoneSurrogates(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[i + 1];
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += value[i];
  }
  return out;
}

function shouldSyncFileWrite(value: string | undefined): boolean {
  return value === 'true';
}

function encodeFilenameStar(value: string): string | null {
  try {
    const cleaned = stripLoneSurrogates(value);
    if (!cleaned) return null;
    return encodeURIComponent(cleaned).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    return null;
  }
}

const AUDIO_MIME_TYPES: Record<string, string> = {
  m4b: 'audio/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

const BOOK_MIME_TYPES: Record<string, string> = {
  epub: 'application/epub+zip',
  kepub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/vnd.amazon.ebook',
  azw3: 'application/vnd.amazon.ebook',
  fb2: 'application/x-fictionbook+xml',
  cbz: 'application/vnd.comicbook+zip',
  cbr: 'application/vnd.comicbook-rar',
  cb7: 'application/x-cb7',
};

function resolveAudioMimeType(format: string | null): string | null {
  return format ? (AUDIO_MIME_TYPES[format.toLowerCase()] ?? null) : null;
}

function resolveBookMimeType(format: string): string {
  return resolveAudioMimeType(format) ?? BOOK_MIME_TYPES[format.toLowerCase()] ?? 'application/octet-stream';
}

@Controller('books')
export class BookController {
  private readonly logger = new Logger(BookController.name);

  constructor(
    private readonly bookService: BookService,
    private readonly fileWriteService: FileWriteService,
  ) {}

  @Post('embed-all')
  @RequirePermission(Permission.ManageAppSettings)
  embedAll() {
    return this.bookService.embedAll();
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.LibraryDeleteBooks)
  @Auditable({
    action: AuditAction.BookBulkDelete,
    resource: AuditResource.Book,
    description: (req) => {
      const count = (req.body as { bookIds?: number[] })?.bookIds?.length ?? 0;
      return `Deleted ${count} book${count !== 1 ? 's' : ''}`;
    },
  })
  async deleteBooks(@Body() dto: DeleteBooksDto, @CurrentUser() user: RequestUser) {
    const ids = await this.bookService.resolveSelectionToIds(dto, user);
    return this.bookService.deleteBooks(ids, user);
  }

  // Must be before @Get(':id') so NestJS does not treat 'search' as an :id param
  @Get('search')
  searchBooks(@Query() dto: SearchBooksDto, @CurrentUser() user: RequestUser) {
    return this.bookService.searchAcrossLibraries(dto.q, dto.limit ?? 10, user);
  }

  @Post('query')
  globalQuery(@Body(BookQueryPipe) query: BookQuery, @CurrentUser() user: RequestUser) {
    return this.bookService.globalQuery(user, query);
  }

  @Post('bulk-refresh-metadata')
  @RequirePermission(Permission.LibraryEditMetadata)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk edits')
  @Auditable({
    action: AuditAction.BookBulkMetadataRefresh,
    resource: AuditResource.Book,
    description: (req) => {
      const count = (req.body as { bookIds?: number[] })?.bookIds?.length ?? 0;
      return `Bulk refreshed metadata for ${count} book${count !== 1 ? 's' : ''}`;
    },
  })
  async bulkRefreshMetadata(@Body() dto: BulkBookIdsDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const ids = await this.bookService.resolveSelectionToIds(dto, user);
    const stream = this.createSseStream(reply);
    try {
      const result = await this.bookService.bulkRefreshMetadata(
        ids,
        user,
        (event) => {
          stream.send(event);
        },
        { isCancelled: stream.isClosed },
      );
      if (!stream.isClosed()) {
        stream.send({ done: true, ...result });
      }
    } finally {
      stream.close();
    }
  }

  @Post('bulk-re-extract-cover')
  @RequirePermission(Permission.LibraryEditMetadata)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk edits')
  @Auditable({
    action: AuditAction.BookBulkCoverReextract,
    resource: AuditResource.Book,
    description: (req) => {
      const count = (req.body as { bookIds?: number[] })?.bookIds?.length ?? 0;
      return `Bulk re-extracted covers for ${count} book${count !== 1 ? 's' : ''}`;
    },
  })
  async bulkReExtractCover(@Body() dto: BulkBookIdsDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const ids = await this.bookService.resolveSelectionToIds(dto, user);
    const stream = this.createSseStream(reply);
    try {
      const result = await this.bookService.bulkReExtractCover(
        ids,
        user,
        (bookId) => {
          stream.send({ bookId });
        },
        { isCancelled: stream.isClosed },
      );
      if (!stream.isClosed()) {
        stream.send({ done: true, ...result });
      }
    } finally {
      stream.close();
    }
  }

  @Post(':id/re-extract-cover')
  @RequirePermission(Permission.LibraryEditMetadata)
  reExtractCover(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.bookService.bulkReExtractCover([id], user);
  }

  @Post('export')
  @RequirePermission(Permission.LibraryDownload)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk downloads')
  async exportBooks(@Body() dto: ExportBooksDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const scope = dto.audioOnly ? 'audio' : dto.allFormats ? 'all' : 'primary';
    await this.streamBookExport(dto.bookIds, scope, user, reply);
  }

  @Get('export/download')
  @RequirePermission(Permission.LibraryDownload)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk downloads')
  async exportBooksDownload(
    @Query('bookIds') bookIdsQuery: string | undefined,
    @Query('scope') scopeQuery: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
  ) {
    const bookIds = this.parseBookIdsQuery(bookIdsQuery);
    const scope = this.parseExportScopeQuery(scopeQuery);
    await this.streamBookExport(bookIds, scope, user, reply);
  }

  @Post('metadata-export/preflight')
  @RequirePermission(Permission.LibraryDownload)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk downloads')
  metadataExportPreflight(@Body() dto: MetadataExportDto, @CurrentUser() user: RequestUser) {
    return this.bookService.getMetadataExportPreflight(dto, user);
  }

  @Post('metadata-export/download')
  @RequirePermission(Permission.LibraryDownload)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk downloads')
  async downloadMetadataExport(@Body() dto: MetadataExportDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const event = 'book.export_metadata';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} format=${dto.format} scope=${dto.query ? 'all-matching' : 'selected'} - export started`);
    const releaseExportSlot = this.bookService.acquireExportSlot(user.id);
    try {
      const exported = await this.bookService.buildMetadataExport(dto, user);
      const asciiFilename = exported.fileName.replace(/[^\x20-\x7E]|["\\]/g, '_') || 'book-metadata-export';
      const encodedFilename = encodeFilenameStar(exported.fileName);
      const disposition = `attachment; filename="${asciiFilename}"`;

      reply.raw.setHeader('Content-Type', exported.contentType);
      reply.raw.setHeader('Content-Disposition', encodedFilename ? `${disposition}; filename*=UTF-8''${encodedFilename}` : disposition);
      reply.send(exported.content);

      this.logger.log(
        `[${event}] [end] userId=${user.id} format=${dto.format} scope=${exported.preflight.scope} rows=${exported.preflight.rowCount} durationMs=${Date.now() - startedAt} - export completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} format=${dto.format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - export failed`,
      );
      throw err;
    } finally {
      releaseExportSlot();
    }
  }

  private async streamBookExport(bookIds: number[], scope: 'primary' | 'all' | 'audio', user: RequestUser, reply: FastifyReply) {
    const event = 'book.export_books';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} count=${bookIds.length} scope=${scope} - export books started`);
    const releaseExportSlot = this.bookService.acquireExportSlot(user.id);
    let plannedFiles = 0;
    let projectedBytes = 0;
    const archive = archiver('zip', { zlib: { level: 0 } });
    let clientDisconnected = false;
    const handleDisconnect = () => {
      clientDisconnected = true;
      archive.abort();
    };
    reply.raw.on('close', handleDisconnect);
    reply.raw.on('aborted', handleDisconnect);
    const archiveFailure = new Promise<never>((_, reject) => {
      archive.on('warning', reject);
      archive.on('error', reject);
    });
    try {
      const plan = await this.bookService.getExportFiles(bookIds, user, scope);
      plannedFiles = plan.files.length;
      projectedBytes = plan.projectedBytes;

      reply.raw.setHeader('Content-Type', 'application/zip');
      reply.raw.setHeader('Content-Disposition', 'attachment; filename="books.zip"');
      archive.pipe(reply.raw);
      for (const file of plan.files) {
        archive.file(file.absolutePath, { name: file.zipPath });
      }
      await Promise.race([archive.finalize(), archiveFailure]);

      if (!clientDisconnected) {
        this.logger.log(
          `[${event}] [end] userId=${user.id} count=${bookIds.length} scope=${scope} files=${plannedFiles} projectedBytes=${projectedBytes} durationMs=${Date.now() - startedAt} - export books completed`,
        );
      }
    } catch (err) {
      if (clientDisconnected) {
        this.logger.log(
          `[${event}] [end] userId=${user.id} count=${bookIds.length} scope=${scope} files=${plannedFiles} projectedBytes=${projectedBytes} durationMs=${Date.now() - startedAt} disconnected=true - export books disconnected`,
        );
        return;
      }

      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] userId=${user.id} count=${bookIds.length} scope=${scope} files=${plannedFiles} projectedBytes=${projectedBytes} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - export books failed`,
      );
      throw err;
    } finally {
      releaseExportSlot();
      reply.raw.off('close', handleDisconnect);
      reply.raw.off('aborted', handleDisconnect);
    }
  }

  @SkipThrottle()
  @Get(':id/cover')
  async getCover(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
    @Query('t') t?: string,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const coverPath = await this.bookService.getCoverPath(id, user);
    if (!coverPath) throw new NotFoundException(`No cover for book ${id}`);

    const { mtimeMs } = await stat(coverPath);
    const etag = `"${Math.floor(mtimeMs)}"`;
    const cacheControl = t ? 'public, max-age=31536000, immutable' : 'private, max-age=86400';

    if (ifNoneMatch === etag) {
      reply.status(304).header('Cache-Control', cacheControl).header('ETag', etag).send();
      return;
    }

    const contentType = imageContentTypeFromPath(coverPath);
    reply.header('Cache-Control', cacheControl);
    reply.header('ETag', etag);
    reply.type(contentType);
    reply.send(createReadStream(coverPath));
  }

  @SkipThrottle()
  @Get(':id/thumbnail')
  async getThumbnail(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
    @Query('t') t?: string,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const thumbnailPath = await this.bookService.getThumbnailPath(id, user);
    if (!thumbnailPath) throw new NotFoundException(`No thumbnail for book ${id}`);

    const { mtimeMs } = await stat(thumbnailPath);
    const etag = `"${Math.floor(mtimeMs)}"`;
    const cacheControl = t ? 'public, max-age=31536000, immutable' : 'private, max-age=86400';

    if (ifNoneMatch === etag) {
      reply.status(304).header('Cache-Control', cacheControl).header('ETag', etag).send();
      return;
    }

    reply.header('Cache-Control', cacheControl);
    reply.header('ETag', etag);
    reply.type('image/jpeg');
    reply.send(createReadStream(thumbnailPath));
  }

  // Flat file routes — no bookId needed since fileId is globally unique.
  // These MUST come before `:id/*` routes to avoid NestJS matching 'files' as :id.

  @Get('files/:fileId/serve')
  async serveFile(
    @Param('fileId', ParseIntPipe) fileId: number,
    @CurrentUser() user: RequestUser,
    @Headers('range') rangeHeader: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const { path, size, format, originalFilename } = await this.bookService.getFileInfo(fileId, user);
    const mimeType = resolveBookMimeType(format);
    const filename = originalFilename;
    const asciiFilename = filename.replace(/[^\x20-\x7E]|["\\]/g, '_') || 'download';
    const encodedFilename = encodeFilenameStar(filename);

    reply.header('Accept-Ranges', 'bytes');
    const disposition = `inline; filename="${asciiFilename}"`;
    reply.header('Content-Disposition', encodedFilename ? `${disposition}; filename*=UTF-8''${encodedFilename}` : disposition);
    reply.type(mimeType);

    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : size - 1;
        if (start >= size || end < start || end >= size) {
          reply.status(416);
          reply.header('Content-Range', `bytes */${size}`);
          reply.send();
          return;
        }
        reply.status(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
        reply.header('Content-Length', end - start + 1);
        reply.send(createReadStream(path, { start, end }));
        return;
      }
    }

    reply.header('Content-Length', size);
    reply.send(createReadStream(path));
  }

  @Get('files/:fileId/download')
  @RequirePermission(Permission.LibraryDownload)
  async downloadFile(@Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const event = 'book.download_file';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] fileId=${fileId} userId=${user.id} - download file started`);
    try {
      const { path, size, format, bookId } = await this.bookService.getFileInfo(fileId, user);
      const mimeType = resolveBookMimeType(format);
      const filename = await this.bookService.resolveDownloadFilename({ bookId, absolutePath: path, format: format === 'unknown' ? null : format });
      const asciiFilename = filename.replace(/[^\x20-\x7E]|["\\]/g, '_') || 'download';
      const encodedFilename = encodeFilenameStar(filename);

      reply.header('Accept-Ranges', 'bytes');
      const disposition = `attachment; filename="${asciiFilename}"`;
      reply.header('Content-Disposition', encodedFilename ? `${disposition}; filename*=UTF-8''${encodedFilename}` : disposition);
      reply.type(mimeType);
      reply.header('Content-Length', size);
      reply.send(createReadStream(path));
      this.logger.log(
        `[${event}] [end] fileId=${fileId} userId=${user.id} durationMs=${Date.now() - startedAt} sizeBytes=${size} - download file completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] fileId=${fileId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - download file failed`,
      );
      throw err;
    }
  }

  @Get('files/:fileId/progress')
  async getFileProgress(@Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() user: RequestUser) {
    return (
      (await this.bookService.getProgress(user.id, fileId, user)) ?? {
        cfi: null,
        pageNumber: null,
        percentage: 0,
        koboLocationSource: null,
        koboLocationType: null,
        koboLocationValue: null,
        koboContentSourceProgressPercent: null,
        koreaderProgress: null,
      }
    );
  }

  @Post('files/:fileId/progress')
  async saveFileProgress(@Param('fileId', ParseIntPipe) fileId: number, @Body() dto: SaveProgressDto, @CurrentUser() user: RequestUser) {
    await this.bookService.saveProgress(user.id, fileId, dto, user);
  }

  @Delete('files/:fileId/progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearFileProgress(@Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() user: RequestUser) {
    await this.bookService.clearFileProgress(user.id, fileId, user);
  }

  @Patch('files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async renameFile(@Param('fileId', ParseIntPipe) fileId: number, @Body() dto: UpdateBookFileDto, @CurrentUser() user: RequestUser) {
    await this.bookService.renameFile(fileId, dto, user);
  }

  @Delete('files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFile(@Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() user: RequestUser) {
    await this.bookService.deleteFile(fileId, user);
  }

  @Get(':id/audio-progress')
  async getAudioProgress(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return (await this.bookService.getAudioProgress(user.id, id, user)) ?? null;
  }

  @Patch(':id/audio-progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveAudioProgress(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertAudioProgressDto, @CurrentUser() user: RequestUser) {
    await this.bookService.saveAudioProgress(user.id, id, dto, user);
  }

  @Patch(':id/metadata')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookMetadataUpdate,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Updated metadata for book #${req.params['id']}`,
  })
  async updateMetadata(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBookMetadataDto,
    @CurrentUser() user: RequestUser,
    @Query('syncFileWrite') syncFileWrite?: string,
  ) {
    const sync = shouldSyncFileWrite(syncFileWrite);
    const result = await this.bookService.updateMetadata(id, dto, user, { postSaveMode: sync ? 'sync' : 'schedule' });
    return sync ? result : result.book;
  }

  @Patch(':id/metadata-and-locks')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookMetadataUpdate,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Updated metadata and locks for book #${req.params['id']}`,
  })
  async updateMetadataAndLocks(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBookMetadataAndLocksDto,
    @CurrentUser() user: RequestUser,
    @Query('syncFileWrite') syncFileWrite?: string,
  ) {
    const sync = shouldSyncFileWrite(syncFileWrite);
    const result = await this.bookService.updateMetadataAndLocks(id, dto, user, { postSaveMode: sync ? 'sync' : 'schedule' });
    return sync ? result : result.book;
  }

  @Patch(':id/metadata-locks')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookMetadataLocksUpdate,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Updated metadata locks for book #${req.params['id']}`,
  })
  updateMetadataLocks(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookMetadataLocksDto, @CurrentUser() user: RequestUser) {
    return this.bookService.updateMetadataLocks(id, dto.lockedFields, user);
  }

  @Post(':id/refresh-metadata')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookMetadataUpdate,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Refreshed metadata for book #${req.params['id']}`,
  })
  refreshMetadata(@Param('id', ParseIntPipe) id: number, @Query('preview') preview: string | undefined, @CurrentUser() user: RequestUser) {
    return this.bookService.refreshMetadata(id, preview === 'true', user);
  }

  @Get(':id/metadata-from-file')
  @RequirePermission(Permission.LibraryEditMetadata)
  getMetadataFromFile(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.bookService.getMetadataFromFile(id, user);
  }

  @Post(':id/write-and-rename')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookWriteAndRename,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Wrote metadata to file and renamed book #${req.params['id']}`,
  })
  writeAndRename(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.bookService.writeAndRename(id, user);
  }

  @Get(':id/write-log')
  @RequirePermission(Permission.LibraryEditMetadata)
  async getWriteLog(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    await this.bookService.verifyBookAccess(id, user);
    const entries = await this.fileWriteService.findWriteLog(id);
    return { entries };
  }

  @Get(':id/kobo-state')
  @RequirePermission(Permission.KoboSync)
  getKoboState(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.bookService.getKoboState(id, user);
  }

  @Get(':id/progress')
  async getBookProgress(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.bookService.getBookProgress(user.id, id, user);
  }

  @Patch(':id/status')
  setReadStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: SetStatusDto, @CurrentUser() user: RequestUser) {
    return this.bookService.setReadStatus(id, dto, user);
  }

  @Post('bulk-set-status')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk edits')
  @Auditable({
    action: AuditAction.BookBulkSetStatus,
    resource: AuditResource.Book,
    description: (req) => {
      const body = req.body as { bookIds?: number[]; status?: string };
      const count = body?.bookIds?.length ?? 0;
      return `Bulk set status to ${body?.status ?? 'unknown'} for ${count} book${count !== 1 ? 's' : ''}`;
    },
  })
  async bulkSetStatus(@Body() dto: BulkSetStatusDto, @CurrentUser() user: RequestUser) {
    const ids = await this.bookService.resolveSelectionToIds(dto, user);
    return this.bookService.bulkSetStatus(ids, dto.status, user);
  }

  @Post('bulk-set-rating')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.LibraryEditMetadata)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk edits')
  @Auditable({
    action: AuditAction.BookBulkSetRating,
    resource: AuditResource.Book,
    description: (req) => {
      const body = req.body as { bookIds?: number[]; rating?: number | null };
      const count = body?.bookIds?.length ?? 0;
      return `Bulk set rating to ${body?.rating ?? 'null'} for ${count} book${count !== 1 ? 's' : ''}`;
    },
  })
  async bulkSetRating(@Body() dto: BulkSetRatingDto, @CurrentUser() user: RequestUser) {
    const ids = await this.bookService.resolveSelectionToIds(dto, user);
    return this.bookService.bulkSetRating(ids, dto.rating ?? null, user);
  }

  @Post('bulk-set-metadata')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.LibraryEditMetadata)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk edits')
  @Auditable({
    action: AuditAction.BookBulkSetMetadata,
    resource: AuditResource.Book,
    description: (req) => {
      const body = req.body as { bookIds?: number[]; field?: string };
      const count = body?.bookIds?.length ?? 0;
      return `Bulk set ${body?.field ?? 'metadata'} for ${count} book${count !== 1 ? 's' : ''}`;
    },
  })
  async bulkSetMetadata(@Body() dto: BulkSetMetadataDto, @CurrentUser() user: RequestUser) {
    const ids = await this.bookService.resolveSelectionToIds(dto, user);
    return this.bookService.bulkSetMetadata(ids, dto.field, dto.value ?? null, user);
  }

  @Post('bulk-update-tags')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.LibraryEditMetadata)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk edits')
  @Auditable({
    action: AuditAction.BookBulkUpdateTags,
    resource: AuditResource.Book,
    description: (req) => {
      const body = req.body as { bookIds?: number[]; mode?: string };
      const count = body?.bookIds?.length ?? 0;
      return `Bulk ${body?.mode ?? 'update'} tags for ${count} book${count !== 1 ? 's' : ''}`;
    },
  })
  async bulkUpdateTags(@Body() dto: BulkUpdateTagsDto, @CurrentUser() user: RequestUser) {
    const ids = await this.bookService.resolveSelectionToIds(dto, user);
    return this.bookService.bulkUpdateTags(ids, dto.mode, dto.tags, user);
  }

  @Post('bulk-set-metadata-lock')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.LibraryEditMetadata)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk edits')
  @Auditable({
    action: AuditAction.BookBulkSetMetadataLock,
    resource: AuditResource.Book,
    description: (req) => {
      const body = req.body as { bookIds?: number[]; locked?: boolean };
      const count = body?.bookIds?.length ?? 0;
      return `Bulk ${body?.locked ? 'locked' : 'unlocked'} metadata for ${count} book${count !== 1 ? 's' : ''}`;
    },
  })
  async bulkSetMetadataLock(@Body() dto: BulkSetMetadataLockDto, @CurrentUser() user: RequestUser) {
    const ids = await this.bookService.resolveSelectionToIds(dto, user);
    return this.bookService.bulkSetMetadataLock(ids, dto.locked, user);
  }

  @Post('bulk-edit-metadata')
  @RequirePermission(Permission.LibraryEditMetadata)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot perform bulk edits')
  @Auditable({
    action: AuditAction.BookBulkEditMetadata,
    resource: AuditResource.Book,
    description: (req) => {
      const body = req.body as { bookIds?: number[]; query?: unknown };
      const count = body?.bookIds?.length ?? 0;
      const via = body?.query ? 'query' : `${count} id${count !== 1 ? 's' : ''}`;
      return `Bulk edit metadata for ${via}`;
    },
  })
  async bulkEditMetadata(@Body() dto: BulkEditMetadataDto, @CurrentUser() user: RequestUser) {
    const ids = await this.bookService.resolveSelectionToIds(dto, user);
    return this.bookService.bulkEditMetadata(ids, dto.fields, user);
  }

  @Get(':id')
  getDetail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.bookService.getDetail(id, user);
  }

  private createSseStream(reply: FastifyReply): {
    send: (event: object) => void;
    isClosed: () => boolean;
    close: () => void;
  } {
    let disconnected = false;
    const markDisconnected = () => {
      disconnected = true;
    };

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.on('close', markDisconnected);
    reply.raw.on('aborted', markDisconnected);

    const isClosed = () => disconnected || reply.raw.destroyed || reply.raw.writableEnded;
    const send = (event: object) => {
      if (isClosed()) {
        throw new Error('SSE stream closed');
      }
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const close = () => {
      reply.raw.off('close', markDisconnected);
      reply.raw.off('aborted', markDisconnected);
      if (!isClosed()) {
        reply.raw.end();
      }
    };

    return { send, isClosed, close };
  }

  private parseBookIdsQuery(raw: string | undefined): number[] {
    if (!raw) {
      throw new BadRequestException('bookIds query parameter is required');
    }

    const parsed = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => Number.parseInt(part, 10));
    if (parsed.length === 0 || parsed.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new BadRequestException('bookIds must be a comma-separated list of positive integers');
    }
    return parsed;
  }

  private parseExportScopeQuery(raw: string | undefined): 'primary' | 'all' | 'audio' {
    if (!raw) return 'primary';
    if (raw === 'primary' || raw === 'all' || raw === 'audio') return raw;
    throw new BadRequestException('scope must be one of: primary, all, audio');
  }
}
