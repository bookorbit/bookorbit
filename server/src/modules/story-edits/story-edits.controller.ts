import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Put, Query } from '@nestjs/common';

import type { StoryEdit, StoryEditsPage } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResolvesMergedBook } from '../../common/decorators/resolves-merged-book.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RequireAppAttest } from '../app-attest/app-attest.guard';
import { PutStoryEditDto } from './dto/put-story-edit.dto';
import { StoryEditsQueryDto } from './dto/story-edits-query.dto';
import { StoryEditsService } from './story-edits.service';

@Controller('mobile/books/:bookId/story-edits')
@RequireAppAttest()
export class StoryEditsController {
  constructor(private readonly storyEdits: StoryEditsService) {}

  @Get()
  @ResolvesMergedBook({ params: ['bookId'] })
  list(@Param('bookId', ParseIntPipe) bookId: number, @Query() query: StoryEditsQueryDto, @CurrentUser() user: RequestUser): Promise<StoryEditsPage> {
    return this.storyEdits.list(bookId, user, query);
  }

  /** Upsert; a delete is a write with `deleted: true`, kept as a tombstone. */
  @Put(':id')
  @ResolvesMergedBook({ params: ['bookId'] })
  put(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PutStoryEditDto,
    @CurrentUser() user: RequestUser,
  ): Promise<StoryEdit> {
    return this.storyEdits.put(bookId, id, user, dto);
  }
}
