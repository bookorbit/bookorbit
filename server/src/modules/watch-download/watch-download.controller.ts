import { Body, Controller, Get, Headers, NotFoundException, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { imageContentTypeFromPath } from '../../common/image-content-type';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { EpubService } from '../reader/epub/epub.service';
import { CreateWatchDownloadDto } from './dto/create-watch-download.dto';
import { CreateWatchMediaOverlayDownloadDto } from './dto/create-watch-media-overlay-download.dto';
import { WatchDownloadService } from './watch-download.service';

const AUDIO_MIME_TYPES: Record<string, string> = {
  m4b: 'audio/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

@Controller('watch-downloads')
export class WatchDownloadController {
  constructor(
    private readonly watchDownloads: WatchDownloadService,
    private readonly bookService: BookService,
    private readonly epubService: EpubService,
  ) {}

  @Post()
  @RequirePermission(Permission.LibraryDownload)
  create(@Body() dto: CreateWatchDownloadDto, @CurrentUser() user: RequestUser) {
    return this.watchDownloads.issue(dto.bookId, dto.fileIds, user);
  }

  @Post('media-overlay')
  @RequirePermission(Permission.LibraryDownload)
  createMediaOverlay(@Body() dto: CreateWatchMediaOverlayDownloadDto, @CurrentUser() user: RequestUser) {
    return this.watchDownloads.issueMediaOverlay(dto.bookId, dto.fileId, dto.hrefs, user);
  }

  @Get('media-overlay/files/:index')
  @Public()
  async downloadMediaOverlayFile(
    @Param('index', ParseIntPipe) index: number,
    @Headers('authorization') authorization: string | undefined,
    @Headers('range') rangeHeader: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const resource = await this.watchDownloads.authorizeMediaOverlay(authorization, index);
    const { data, contentType, size, status, contentRange } = await this.epubService.streamMediaOverlayFile(
      resource.bookId,
      resource.href,
      resource.fileId,
      rangeHeader,
      resource.user,
    );

    reply.code(status);
    reply.header('Content-Type', contentType);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', data.length);
    if (contentRange) reply.header('Content-Range', contentRange);
    if (!contentRange && size > 0) reply.header('X-Content-Length-Full', size);
    reply.header('Cache-Control', 'private, no-store');
    reply.send(data);
  }

  @Get('files/:fileId')
  @Public()
  async downloadFile(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Headers('authorization') authorization: string | undefined,
    @Headers('range') rangeHeader: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const user = await this.watchDownloads.authorize(authorization, undefined, fileId);
    const file = await this.bookService.getFileInfo(fileId, user);
    this.sendRange(file.path, file.size, AUDIO_MIME_TYPES[file.format.toLowerCase()] ?? 'application/octet-stream', rangeHeader, reply);
  }

  @Get('books/:bookId/cover')
  @Public()
  async downloadCover(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Headers('authorization') authorization: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const user = await this.watchDownloads.authorize(authorization, bookId);
    const path = await this.bookService.getCoverPath(bookId, user, { medium: 'audio' });
    if (!path) throw new NotFoundException(`No cover for book ${bookId}`);
    const info = await stat(path);
    reply.header('Content-Length', info.size);
    reply.header('Cache-Control', 'private, no-store');
    reply.type(imageContentTypeFromPath(path));
    reply.send(createReadStream(path));
  }

  private sendRange(path: string, size: number, contentType: string, rangeHeader: string | undefined, reply: FastifyReply) {
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'private, no-store');
    reply.type(contentType);
    if (rangeHeader) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
      if (match) {
        const start = Number.parseInt(match[1], 10);
        const end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
        if (start >= size || end < start || end >= size) {
          reply.status(416).header('Content-Range', `bytes */${size}`).send();
          return;
        }
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
}
