import { Body, Controller, Get, Header, Headers, Param, ParseIntPipe, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderCatalogService } from './koreader-catalog.service';
import {
  KoreaderCatalogBooksQueryDto,
  KoreaderCatalogSectionQueryDto,
  KoreaderCatalogSetRatingDto,
  KoreaderCatalogSetReadStatusDto,
} from './dto/koreader-catalog-query.dto';

@Public()
@UseGuards(KoreaderAuthGuard)
@Controller('koreader/plugin/catalog')
export class KoreaderCatalogController {
  constructor(private readonly catalogService: KoreaderCatalogService) {}

  @Get('root')
  @Header('Cache-Control', 'private, max-age=30')
  root() {
    return this.catalogService.getRoot();
  }

  @Get('sections/:section')
  @Header('Cache-Control', 'private, max-age=30')
  sections(@CurrentUser() user: RequestUser, @Param('section') section: string, @Query() query: KoreaderCatalogSectionQueryDto) {
    return this.catalogService.getSectionEntries(user, section, query);
  }

  @Get('books')
  @Header('Cache-Control', 'private, max-age=30')
  books(@CurrentUser() user: RequestUser, @Query() query: KoreaderCatalogBooksQueryDto) {
    return this.catalogService.getBooksPage(user, query);
  }

  @Get('books/:bookId')
  @Header('Cache-Control', 'private, max-age=30')
  bookDetail(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number) {
    return this.catalogService.getBookDetail(user, bookId);
  }

  @Put('books/:bookId/read-status')
  setReadStatus(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number, @Body() body: KoreaderCatalogSetReadStatusDto) {
    return this.catalogService.setReadStatus(user, bookId, body.status);
  }

  @Put('books/:bookId/rating')
  setRating(@CurrentUser() user: RequestUser, @Param('bookId', ParseIntPipe) bookId: number, @Body() body: KoreaderCatalogSetRatingDto) {
    return this.catalogService.setRating(user, bookId, body.rating ?? null);
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
