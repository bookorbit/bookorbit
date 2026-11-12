import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { Permission, type StoryGuideFix, type StoryGuideFixesPage } from '@bookorbit/types';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../../common/types/request-user';
import { RequireAppAttest } from '../../app-attest/app-attest.guard';
import { PutStoryGuideFixDto, StoryGuideFixesQueryDto } from '../dto/story-guide-fix.dto';
import { StoryGuideFixesService } from './story-guide-fixes.service';

/**
 * Fixes to a book file's story guide, shared by every file with the same text. Outside production
 * the routes also accept a request with no App Attest assertion; a request that carries one is
 * verified everywhere.
 */
@Controller('mobile/books/files/:fileId/story-guide/fixes')
@RequireAppAttest({ unsignedOutsideProduction: true })
@RequirePermission(Permission.LibraryGenerateStoryGuide)
export class StoryGuideFixesController {
  constructor(private readonly fixes: StoryGuideFixesService) {}

  /** Fixes changed after the `since` cursor, tombstones included, with `orphans` and `rematched` for the guide served now. */
  @Get()
  list(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Query() query: StoryGuideFixesQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<StoryGuideFixesPage> {
    return this.fixes.list(fileId, user, query);
  }

  /** Upsert by client id; the later `updatedAt` wins. A delete is a write with `deleted: true`, kept as a tombstone. */
  @Put(':id')
  put(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PutStoryGuideFixDto,
    @CurrentUser() user: RequestUser,
  ): Promise<StoryGuideFix> {
    return this.fixes.put(fileId, id, user, dto);
  }
}
