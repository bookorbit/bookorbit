import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';

import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import { AudiobookService } from './audiobook.service';
import { CreateAudiobookBookmarkDto } from './dto/create-audiobook-bookmark.dto';
import { PutAudiobookPlaybackStateDto } from './dto/put-audiobook-playback-state.dto';
import { UpdateAudiobookBookmarkDto } from './dto/update-audiobook-bookmark.dto';

const AUDIO_MIME_TYPES: Record<string, string> = {
  m4b: 'audio/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

@Controller('audiobooks')
export class AudiobookController {
  constructor(private readonly service: AudiobookService) {}

  @Get(':bookId/manifest')
  getManifest(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.service.getManifest(bookId, user);
  }

  @Get(':bookId/assets/:assetId/content')
  async serveAsset(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('assetId') assetId: string,
    @CurrentUser() user: RequestUser,
    @Headers('range') rangeHeader: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const asset = await this.service.getAsset(bookId, assetId, user);
    const size = asset.sizeBytes;
    const mimeType = AUDIO_MIME_TYPES[asset.format.toLowerCase()] ?? 'application/octet-stream';
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Disposition', contentDispositionHeader('inline', basename(asset.absolutePath), 'audiobook'));
    reply.type(mimeType);

    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (match) {
        const start = Number.parseInt(match[1]!, 10);
        const end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
        if (start >= size || end < start || end >= size) {
          reply.status(416).header('Content-Range', `bytes */${size}`).send();
          return;
        }
        reply.status(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
        reply.header('Content-Length', end - start + 1);
        reply.send(createReadStream(asset.absolutePath, { start, end }));
        return;
      }
    }

    reply.header('Content-Length', size);
    reply.send(createReadStream(asset.absolutePath));
  }

  @Get(':bookId/playback-state')
  getPlaybackState(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.service.getPlaybackState(bookId, user);
  }

  @Put(':bookId/playback-state')
  putPlaybackState(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: PutAudiobookPlaybackStateDto, @CurrentUser() user: RequestUser) {
    return this.service.putPlaybackState(bookId, dto, user);
  }

  @Delete(':bookId/playback-state')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePlaybackState(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.service.deletePlaybackState(bookId, user);
  }

  @Get(':bookId/bookmarks')
  listBookmarks(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.service.listBookmarks(bookId, user);
  }

  @Post(':bookId/bookmarks')
  createBookmark(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: CreateAudiobookBookmarkDto, @CurrentUser() user: RequestUser) {
    return this.service.createBookmark(bookId, dto, user);
  }

  @Patch(':bookId/bookmarks/:bookmarkId')
  updateBookmark(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('bookmarkId', ParseUUIDPipe) bookmarkId: string,
    @Body() dto: UpdateAudiobookBookmarkDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.updateBookmark(bookId, bookmarkId, dto, user);
  }

  @Delete(':bookId/bookmarks/:bookmarkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBookmark(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('bookmarkId', ParseUUIDPipe) bookmarkId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.deleteBookmark(bookId, bookmarkId, user);
  }
}
