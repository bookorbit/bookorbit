import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { createReadStream } from 'fs';
import type { FastifyReply } from 'fastify';
import { BookService } from './book.service';
import { GetBooksDto } from './dto/get-books.dto';

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

  @Get(':id')
  getDetail(@Param('id', ParseIntPipe) id: number) {
    return this.bookService.getDetail(id);
  }
}
