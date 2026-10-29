import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ChapterHealthService } from './chapter-health.service';
import { ChapterHealthListDto, ChapterHealthScopeDto, EnqueueChapterLookupDto } from './dto/chapter-health.dto';

@Controller('chapter-health')
@RequirePermission(Permission.LibraryEditMetadata)
export class ChapterHealthController {
  constructor(private readonly service: ChapterHealthService) {}

  @Get('summary')
  summary(@Query() dto: ChapterHealthScopeDto, @CurrentUser() user: RequestUser) {
    return this.service.summary(user, dto.libraryId);
  }

  @Get('books')
  list(@Query() dto: ChapterHealthListDto, @CurrentUser() user: RequestUser) {
    return this.service.list(user, dto);
  }

  @Post('lookups')
  @HttpCode(HttpStatus.OK)
  enqueue(@Body() dto: EnqueueChapterLookupDto, @CurrentUser() user: RequestUser) {
    return this.service.enqueue(user, dto);
  }

  @Get('lookups/state')
  state(@CurrentUser() user: RequestUser) {
    return this.service.state(user);
  }

  @Delete('lookups/queued')
  cancel(@CurrentUser() user: RequestUser) {
    return this.service.cancel(user);
  }

  @Delete('lookups/finished')
  clearFinished(@CurrentUser() user: RequestUser) {
    return this.service.clearFinished(user);
  }

  @Delete('lookups/:bookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  dismissReview(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.service.dismissReview(user, bookId);
  }
}
