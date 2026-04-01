import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import archiver from 'archiver';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { FileWriteService } from '../file-write/file-write.service';
import { BookService } from './book.service';
import { BookQueryPipe } from './pipes/book-query.pipe';
import { BulkBookIdsDto } from './dto/bulk-book-ids.dto';
import { DeleteBooksDto } from './dto/delete-books.dto';
import { ExportBooksDto } from './dto/export-books.dto';
import { SaveProgressDto } from './dto/save-progress.dto';
import { UpsertAudioProgressDto } from './dto/upsert-audio-progress.dto';
import { UpdateBookMetadataDto } from './dto/update-book-metadata.dto';
import { SearchBooksDto } from './dto/search-books.dto';
import { SetStatusDto } from '../user-book-status/dto/set-status.dto';
import { Permission, AuditAction, AuditResource } from '@projectx/types';
import type { BookQuery } from '@projectx/types';

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

function resolveAudioMimeType(format: string | null): string | null {
  return format ? (AUDIO_MIME_TYPES[format.toLowerCase()] ?? null) : null;
}

@Controller('books')
export class BookController {
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
  deleteBooks(@Body() dto: DeleteBooksDto, @CurrentUser() user: RequestUser) {
    return this.bookService.deleteBooks(dto.bookIds, user);
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
  @Auditable({
    action: AuditAction.BookBulkMetadataRefresh,
    resource: AuditResource.Book,
    description: (req) => {
      const count = (req.body as { bookIds?: number[] })?.bookIds?.length ?? 0;
      return `Bulk refreshed metadata for ${count} book${count !== 1 ? 's' : ''}`;
    },
  })
  async bulkRefreshMetadata(@Body() dto: BulkBookIdsDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const stream = this.createSseStream(reply);
    try {
      const result = await this.bookService.bulkRefreshMetadata(
        dto.bookIds,
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

  @Post('bulk-re-extract-cover')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookBulkCoverReextract,
    resource: AuditResource.Book,
    description: (req) => {
      const count = (req.body as { bookIds?: number[] })?.bookIds?.length ?? 0;
      return `Bulk re-extracted covers for ${count} book${count !== 1 ? 's' : ''}`;
    },
  })
  async bulkReExtractCover(@Body() dto: BulkBookIdsDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const stream = this.createSseStream(reply);
    try {
      const result = await this.bookService.bulkReExtractCover(
        dto.bookIds,
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
  async exportBooks(@Body() dto: ExportBooksDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const files = await this.bookService.getExportFiles(dto.bookIds, user, dto.allFormats ?? false);
    const archive = archiver('zip', { zlib: { level: 0 } });
    let clientDisconnected = false;
    const handleDisconnect = () => {
      clientDisconnected = true;
      archive.abort();
    };
    reply.raw.on('close', handleDisconnect);
    reply.raw.on('aborted', handleDisconnect);
    reply.raw.setHeader('Content-Type', 'application/zip');
    reply.raw.setHeader('Content-Disposition', 'attachment; filename="books.zip"');
    const archiveFailure = new Promise<never>((_, reject) => {
      archive.on('warning', reject);
      archive.on('error', reject);
    });
    try {
      archive.pipe(reply.raw);
      for (const file of files) {
        archive.file(file.absolutePath, { name: file.zipPath });
      }
      await Promise.race([archive.finalize(), archiveFailure]);
    } catch (err) {
      if (!clientDisconnected) {
        throw err;
      }
    } finally {
      reply.raw.off('close', handleDisconnect);
      reply.raw.off('aborted', handleDisconnect);
    }
  }

  @Get(':id/cover')
  async getCover(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const coverPath = await this.bookService.getCoverPath(id, user);
    if (!coverPath) throw new NotFoundException(`No cover for book ${id}`);

    const { mtimeMs } = await stat(coverPath);
    const etag = `"${Math.floor(mtimeMs)}"`;
    if (ifNoneMatch === etag) {
      reply.status(304).send();
      return;
    }

    const ext = coverPath.split('.').pop()?.toLowerCase();
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    reply.header('Cache-Control', 'no-cache');
    reply.header('ETag', etag);
    reply.type(contentType);
    reply.send(createReadStream(coverPath));
  }

  @Get(':id/thumbnail')
  async getThumbnail(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const thumbnailPath = await this.bookService.getThumbnailPath(id, user);
    if (!thumbnailPath) throw new NotFoundException(`No thumbnail for book ${id}`);

    const { mtimeMs } = await stat(thumbnailPath);
    const etag = `"${Math.floor(mtimeMs)}"`;
    if (ifNoneMatch === etag) {
      reply.status(304).send();
      return;
    }

    reply.header('Cache-Control', 'no-cache');
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
    @Query('download') download: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const { path, size, format, bookId, originalFilename } = await this.bookService.getFileInfo(fileId, user);
    const mimeType =
      resolveAudioMimeType(format) ?? (format === 'pdf' ? 'application/pdf' : format === 'cbz' ? 'application/zip' : 'application/epub+zip');
    const isDownload = download === '1' || download === 'true';
    const filename = isDownload
      ? await this.bookService.resolveDownloadFilename({ bookId, absolutePath: path, format: format === 'unknown' ? null : format })
      : originalFilename;
    const asciiFilename = filename.replace(/[^\x20-\x7E]|["\\]/g, '_') || 'download';
    const encodedFilename = encodeFilenameStar(filename);

    reply.header('Accept-Ranges', 'bytes');
    const disposition = `${isDownload ? 'attachment' : 'inline'}; filename="${asciiFilename}"`;
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

  @Get('files/:fileId/progress')
  async getFileProgress(@Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() user: RequestUser) {
    return (await this.bookService.getProgress(user.id, fileId, user)) ?? { cfi: null, pageNumber: null, percentage: 0 };
  }

  @Post('files/:fileId/progress')
  async saveFileProgress(@Param('fileId', ParseIntPipe) fileId: number, @Body() dto: SaveProgressDto, @CurrentUser() user: RequestUser) {
    await this.bookService.saveProgress(user.id, fileId, dto, user);
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
  updateMetadata(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookMetadataDto, @CurrentUser() user: RequestUser) {
    return this.bookService.updateMetadata(id, dto, user);
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
  @HttpCode(HttpStatus.NO_CONTENT)
  setReadStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: SetStatusDto, @CurrentUser() user: RequestUser) {
    return this.bookService.setReadStatus(id, dto.status, user);
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
}
