import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { EpubService } from './epub.service';

@Controller('epub')
export class EpubController {
  constructor(private readonly epubService: EpubService) {}

  @Get(':bookId/info')
  getBookInfo(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.epubService.getBookInfo(bookId, user);
  }

  @Get(':bookId/file/*')
  async getFile(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('*') encodedPath: string,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
  ) {
    const filePath = encodedPath
      .split('/')
      .map((s) => decodeURIComponent(s))
      .join('/');

    const { stream, contentType, size } = await this.epubService.streamFile(bookId, filePath, user);

    reply.header('Content-Type', contentType);
    if (size > 0) reply.header('Content-Length', size);
    reply.header('Cache-Control', 'public, max-age=3600');
    reply.send(stream);
  }
}
