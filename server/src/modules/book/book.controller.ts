import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { createReadStream } from 'fs';
import type { FastifyReply } from 'fastify';
import { BookService } from './book.service';
import { GetBooksDto } from './dto/get-books.dto';
import { SaveProgressDto } from './dto/save-progress.dto';

@Controller('books')
export class BookController {
  constructor(private readonly bookService: BookService) {}

  @Get()
  getCards(@Query() dto: GetBooksDto) {
    return this.bookService.getCards(dto);
  }

  @Get(':id/cover')
  async getCover(@Param('id', ParseIntPipe) id: number, @Res() reply: FastifyReply) {
    const coverPath = await this.bookService.getCoverPath(id);
    if (!coverPath) throw new NotFoundException(`No cover for book ${id}`);

    const ext = coverPath.split('.').pop()?.toLowerCase();
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    reply.type(contentType);
    reply.send(createReadStream(coverPath));
  }

  // Flat file routes — no bookId needed since fileId is globally unique.
  // These MUST come before `:id/*` routes to avoid NestJS matching 'files' as :id.

  @Get('files/:fileId/serve')
  async serveFile(@Param('fileId', ParseIntPipe) fileId: number, @Res() reply: FastifyReply) {
    const { stream, size, format } = await this.bookService.getFileStream(fileId);
    const mimeType = format === 'pdf' ? 'application/pdf' : format === 'cbz' ? 'application/zip' : 'application/epub+zip';
    reply.header('Content-Length', size);
    reply.header('Content-Disposition', 'inline');
    reply.header('Accept-Ranges', 'bytes');
    reply.type(mimeType);
    reply.send(stream);
  }

  @Get('files/:fileId/progress')
  async getFileProgress(@Param('fileId', ParseIntPipe) fileId: number) {
    return (await this.bookService.getProgress(fileId)) ?? { cfi: null, pageNumber: null, percentage: 0 };
  }

  @Post('files/:fileId/progress')
  async saveFileProgress(@Param('fileId', ParseIntPipe) fileId: number, @Body() dto: SaveProgressDto) {
    await this.bookService.saveProgress(fileId, dto.cfi, dto.pageNumber, dto.percentage);
  }

  @Get(':id')
  getDetail(@Param('id', ParseIntPipe) id: number) {
    return this.bookService.getDetail(id);
  }
}
