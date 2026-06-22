import { Controller, Get, Headers, Param, ParseIntPipe, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderCatalogService } from './koreader-catalog.service';
import { KoreaderCatalogBooksQueryDto } from './dto/koreader-catalog-query.dto';

@Public()
@UseGuards(KoreaderAuthGuard)
@Controller('koreader/plugin/catalog')
export class KoreaderCatalogController {
  constructor(private readonly catalogService: KoreaderCatalogService) {}

  @Get('root')
  root() {
    return this.catalogService.getRoot();
  }

  @Get('sections/:section')
  sections(@CurrentUser() user: RequestUser, @Param('section') section: string) {
    return this.catalogService.getSectionEntries(user, section);
  }

  @Get('books')
  books(@CurrentUser() user: RequestUser, @Query() query: KoreaderCatalogBooksQueryDto) {
    return this.catalogService.getBooksPage(user, query);
  }

  @Get('books/:bookId')
  bookDetail(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number) {
    return this.catalogService.getBookDetail(user, bookId);
  }

  @Get('books/:bookId/thumbnail')
  thumbnail(
    @CurrentUser() user: RequestUser,
    @Param('bookId', ParseIntPipe) bookId: number,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    return this.catalogService.streamThumbnail(user, bookId, reply, ifNoneMatch);
  }

  @Get('files/:fileId/download')
  download(@CurrentUser() user: RequestUser, @Param('fileId', ParseIntPipe) fileId: number, @Res() reply: FastifyReply) {
    return this.catalogService.streamFile(user, fileId, reply);
  }
}
