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

  @Get(':id/file')
  async getFile(@Param('id', ParseIntPipe) id: number, @Res() reply: FastifyReply) {
    const { stream, size, format } = await this.bookService.getFileStream(id);
    reply.header('Content-Length', size);
    reply.header('Content-Disposition', 'inline');
    reply.header('Accept-Ranges', 'bytes');
    reply.type(format === 'pdf' ? 'application/pdf' : 'application/epub+zip');
    reply.send(stream);
  }

  @Get(':id/progress')
  async getProgress(@Param('id', ParseIntPipe) id: number) {
    return (await this.bookService.getProgress(id)) ?? { cfi: null, percentage: 0 };
  }

  @Post(':id/progress')
  async saveProgress(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveProgressDto) {
    await this.bookService.saveProgress(id, dto.cfi, dto.percentage);
  }

  @Get(':id')
  getDetail(@Param('id', ParseIntPipe) id: number) {
    return this.bookService.getDetail(id);
  }
}
