import { Controller, Get, Headers, HttpStatus, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { StoryGuideContentMissing } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RequireAppAttest } from '../app-attest/app-attest.guard';
import { StoryGuideContentQueryDto } from './dto/story-guide.dto';
import { StoryGuidesService } from './story-guides.service';

/**
 * A book file's story guide. Outside production the route also accepts a request with no App
 * Attest assertion; a request that carries one is verified everywhere.
 */
@Controller('mobile/books/files/:fileId/story-guide')
@RequireAppAttest({ unsignedOutsideProduction: true })
export class StoryGuideContentController {
  constructor(private readonly service: StoryGuidesService) {}

  /**
   * The guide with its fixes for everyone applied. `304` when `If-None-Match` matches; `404 { reason }`
   * with no guide, or none in an asked format.
   */
  @Get()
  async read(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Query() query: StoryGuideContentQueryDto,
    @CurrentUser() user: RequestUser,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ): Promise<void> {
    const formats = [...new Set((query.format ?? '1').split(',').map(Number))];
    const content = await this.service.content(fileId, formats, user, ifNoneMatch);
    if (content.kind === 'missing') {
      const body: StoryGuideContentMissing = { reason: content.reason };
      reply.status(HttpStatus.NOT_FOUND).header('Cache-Control', 'private, no-cache').send(body);
      return;
    }
    reply.header('ETag', content.etag).header('Cache-Control', 'private, no-cache');
    if (content.kind === 'not-modified') {
      reply.status(HttpStatus.NOT_MODIFIED).send();
      return;
    }
    reply.send(content.body);
  }
}
