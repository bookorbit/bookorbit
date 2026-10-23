import { Controller, Get, Header, Headers, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { ComicPageCountResponse, DjvuPageTextResponse } from '@bookorbit/types';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../../common/types/request-user';
import { DjvuPageQuery } from './dto/djvu-page-query.dto';
import { DjvuService } from './djvu.service';

@Controller('djvu')
export class DjvuController {
  constructor(private readonly djvuService: DjvuService) {}

  @Get('files/:fileId/pages')
  @Header('Cache-Control', 'private, no-store')
  async getPageCount(@Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() user: RequestUser): Promise<ComicPageCountResponse> {
    return { pageCount: await this.djvuService.getPageCount(fileId, user) };
  }

  @Get('files/:fileId/pages/:pageIndex')
  async getPage(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Param('pageIndex', ParseIntPipe) pageIndex: number,
    @Query() query: DjvuPageQuery,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ): Promise<void> {
    const page = await this.djvuService.getPage(fileId, pageIndex, query.size, user, ifNoneMatch);
    reply.header('Cache-Control', 'private, no-cache');
    reply.header('ETag', page.etag);
    reply.header('X-Content-Type-Options', 'nosniff');
    if (page.notModified) reply.status(304).send();
    else reply.type('image/webp').send(page.buffer);
  }

  @Get('files/:fileId/pages/:pageIndex/text')
  @Header('Cache-Control', 'private, no-store')
  getPageText(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Param('pageIndex', ParseIntPipe) pageIndex: number,
    @CurrentUser() user: RequestUser,
  ): Promise<DjvuPageTextResponse> {
    return this.djvuService.getPageText(fileId, pageIndex, user);
  }
}
