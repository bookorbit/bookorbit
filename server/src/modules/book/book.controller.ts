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
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from './book.service';
import { BookQueryPipe } from './pipes/book-query.pipe';
import { BulkBookIdsDto } from './dto/bulk-book-ids.dto';
import { DeleteBooksDto } from './dto/delete-books.dto';
import { ExportBooksDto } from './dto/export-books.dto';
import { SaveProgressDto } from './dto/save-progress.dto';
import { UpdateBookMetadataDto } from './dto/update-book-metadata.dto';
import { SearchBooksDto } from './dto/search-books.dto';
import type { BookQuery } from '@projectx/types';

@Controller('books')
export class BookController {
  constructor(private readonly bookService: BookService) {}

  @Post('embed-all')
  @RequirePermission('manage_app_settings')
  embedAll() {
    return this.bookService.embedAll();
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_delete_books')
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
  @RequirePermission('library_edit_metadata')
  async bulkRefreshMetadata(@Body() dto: BulkBookIdsDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const result = await this.bookService.bulkRefreshMetadata(dto.bookIds, user, (bookId) => {
      reply.raw.write(`data: ${JSON.stringify({ bookId })}\n\n`);
    });
    reply.raw.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
    reply.raw.end();
  }

  @Post('bulk-re-extract-cover')
  @RequirePermission('library_edit_metadata')
  async bulkReExtractCover(@Body() dto: BulkBookIdsDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const result = await this.bookService.bulkReExtractCover(dto.bookIds, user, (bookId) => {
      reply.raw.write(`data: ${JSON.stringify({ bookId })}\n\n`);
    });
    reply.raw.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
    reply.raw.end();
  }

  @Post(':id/re-extract-cover')
  @RequirePermission('library_edit_metadata')
  reExtractCover(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.bookService.bulkReExtractCover([id], user);
  }

  @Post('export')
  @RequirePermission('library_download')
  async exportBooks(@Body() dto: ExportBooksDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const files = await this.bookService.getExportFiles(dto.bookIds, user, dto.allFormats ?? false);
    const archive = archiver('zip', { zlib: { level: 0 } });
    reply.raw.setHeader('Content-Type', 'application/zip');
    reply.raw.setHeader('Content-Disposition', 'attachment; filename="books.zip"');
    archive.pipe(reply.raw);
    for (const file of files) {
      archive.file(file.absolutePath, { name: file.zipPath });
    }
    await archive.finalize();
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
  @RequirePermission('library_download')
  async serveFile(
    @Param('fileId', ParseIntPipe) fileId: number,
    @CurrentUser() user: RequestUser,
    @Headers('range') rangeHeader: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const { path, size, format } = await this.bookService.getFileInfo(fileId, user);
    const mimeType = format === 'pdf' ? 'application/pdf' : format === 'cbz' ? 'application/zip' : 'application/epub+zip';
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Disposition', 'inline');
    reply.type(mimeType);

    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (match) {
        const start = parseInt(match[1]);
        const end = match[2] ? parseInt(match[2]) : size - 1;
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

  @Patch(':id/metadata')
  @RequirePermission('library_edit_metadata')
  updateMetadata(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookMetadataDto, @CurrentUser() user: RequestUser) {
    return this.bookService.updateMetadata(id, dto, user);
  }

  @Post(':id/refresh-metadata')
  @RequirePermission('library_edit_metadata')
  refreshMetadata(@Param('id', ParseIntPipe) id: number, @Query('preview') preview: string | undefined, @CurrentUser() user: RequestUser) {
    return this.bookService.refreshMetadata(id, preview === 'true', user);
  }

  @Get(':id')
  getDetail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.bookService.getDetail(id, user);
  }
}
