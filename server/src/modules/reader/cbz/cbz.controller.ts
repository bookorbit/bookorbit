import { Controller, Get, Headers, Param, ParseIntPipe, Res } from '@nestjs/common';
import type { ComicPageCountResponse } from '@bookorbit/types';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../../common/types/request-user';
import { CbzService } from './cbz.service';

/** Page URLs carry no version, so a page is revalidated on every use rather than trusted. */
const PAGE_CACHE_CONTROL = 'private, no-cache';

@Controller('cbz')
export class CbzController {
  constructor(private readonly cbzService: CbzService) {}

  @Get('files/:fileId/pages')
  async getPageCount(@Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() user: RequestUser): Promise<ComicPageCountResponse> {
    return { pageCount: await this.cbzService.getPageCount(fileId, user) };
  }

  @Get('files/:fileId/pages/:pageIndex')
  async getPage(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Param('pageIndex', ParseIntPipe) pageIndex: number,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const page = await this.cbzService.streamPage(fileId, pageIndex, user, ifNoneMatch);
    reply.header('Cache-Control', PAGE_CACHE_CONTROL);
    reply.header('ETag', page.etag);
    if (page.notModified) {
      reply.status(304).send();
      return;
    }
    reply.type(page.mimeType);
    reply.send(page.stream);
  }
}
