import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Permission, type StoryGuideStatus } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { StoryGuideBuildDto, StoryGuideDeleteQueryDto, StoryGuideFileDto, StoryGuideFileQueryDto } from './dto/story-guide.dto';
import { StoryGuidesService } from './story-guides.service';

/**
 * A book's story guide: its status for anyone who can see the book, and building, retrying,
 * cancelling and deleting for those who may build guides. Each is per book file; without
 * `fileId` the book's first file in a format a guide reads is used.
 */
@Controller('books/:bookId/story-guide')
export class StoryGuidesController {
  constructor(private readonly service: StoryGuidesService) {}

  /** A cache read: it never reads the book. `304` when `If-None-Match` matches. */
  @Get()
  async status(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Query() query: StoryGuideFileQueryDto,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ): Promise<void> {
    const { status, etag } = await this.service.status(bookId, query.fileId, user);
    reply.header('ETag', etag).header('Cache-Control', 'private, no-cache');
    if (ifNoneMatch === etag) {
      reply.status(HttpStatus.NOT_MODIFIED).send();
      return;
    }
    reply.send(status);
  }

  /** `202` with the status once queued; `409` with the status when a job is unfinished or the build is refused. */
  @Post()
  @RequirePermission(Permission.LibraryGenerateStoryGuide)
  async build(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Body() dto: StoryGuideBuildDto,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.service.build(bookId, dto.fileId, dto.kind, user);
    reply.status(result.kind === 'queued' ? HttpStatus.ACCEPTED : HttpStatus.CONFLICT).send(result.status);
  }

  /** Try again on a failed or paused job, or Continue past an estimate. */
  @Post('retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.LibraryGenerateStoryGuide)
  retry(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: StoryGuideFileDto, @CurrentUser() user: RequestUser): Promise<StoryGuideStatus> {
    return this.service.retry(bookId, dto.fileId, user);
  }

  /** Ends an unfinished job; dismisses a failed one. */
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.LibraryGenerateStoryGuide)
  cancel(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: StoryGuideFileDto, @CurrentUser() user: RequestUser): Promise<StoryGuideStatus> {
    return this.service.cancel(bookId, dto.fileId, user);
  }

  /** Cancels any unfinished job, then removes the guide. Its fixes for everyone are kept unless `fixes=delete`. */
  @Delete()
  @RequirePermission(Permission.LibraryGenerateStoryGuide)
  remove(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Query() query: StoryGuideDeleteQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<StoryGuideStatus> {
    return this.service.remove(bookId, query.fileId, query.fixes ?? 'keep', user);
  }
}
