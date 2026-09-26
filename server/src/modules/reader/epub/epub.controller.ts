import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../../common/types/request-user';
import { EpubService } from './epub.service';

@Controller('epub')
export class EpubController {
  constructor(private readonly epubService: EpubService) {}

  @Get(':bookId/info')
  getBookInfo(@Param('bookId', ParseIntPipe) bookId: number, @Query('fileId') fileId: string | undefined, @CurrentUser() user: RequestUser) {
    return this.epubService.getBookInfo(bookId, this.parseFileId(fileId), user);
  }

  @Get(':bookId/media-overlay')
  getMediaOverlay(@Param('bookId', ParseIntPipe) bookId: number, @Query('fileId') fileId: string | undefined, @CurrentUser() user: RequestUser) {
    return this.epubService.getMediaOverlayPlaylist(bookId, this.parseFileId(fileId), user);
  }

  @Get(':bookId/media-overlay/file/*')
  async getMediaOverlayFile(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('*') encodedPath: string,
    @Query('fileId') fileId: string | undefined,
    @CurrentUser() user: RequestUser,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const filePath = this.decodePathParam(encodedPath);
    const range = typeof request.headers.range === 'string' ? request.headers.range : undefined;
    const { data, contentType, size, status, contentRange } = await this.epubService.streamMediaOverlayFile(
      bookId,
      filePath,
      this.parseFileId(fileId),
      range,
      user,
    );

    reply.code(status);
    reply.header('Content-Type', contentType);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', data.length);
    if (contentRange) reply.header('Content-Range', contentRange);
    if (!contentRange && size > 0) reply.header('X-Content-Length-Full', size);
    reply.header('Cache-Control', 'private, max-age=3600');
    reply.send(data);
  }

  @Get(':bookId/file/*')
  async getFile(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('*') encodedPath: string,
    @Query('fileId') fileId: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
  ) {
    const filePath = this.decodePathParam(encodedPath);

    const { stream, contentType, size } = await this.epubService.streamFile(bookId, filePath, this.parseFileId(fileId), user);

    reply.header('Content-Type', contentType);
    if (size > 0) reply.header('Content-Length', size);
    reply.header('Cache-Control', 'public, max-age=3600');
    reply.send(stream);
  }

  private parseFileId(fileId: string | undefined): number | undefined {
    if (fileId === undefined) return undefined;
    const value = fileId.trim();
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException('Invalid fileId');
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new BadRequestException('Invalid fileId');
    }
    return parsed;
  }

  private decodePathParam(encodedPath: string): string {
    try {
      return encodedPath
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/');
    } catch {
      throw new BadRequestException('Invalid file path');
    }
  }
}
