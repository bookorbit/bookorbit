import { Controller, Get, Query } from '@nestjs/common';

import type {
  NotebookBooksResponse,
  NotebookEntriesResponse,
  NotebookOnThisDayResponse,
  NotebookOverview,
  NotebookReviewResponse,
  NotebookTrashResponse,
} from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import {
  NotebookBooksQueryDto,
  NotebookEntriesQueryDto,
  NotebookOnThisDayQueryDto,
  NotebookOverviewQueryDto,
  NotebookReviewQueryDto,
  NotebookTrashQueryDto,
} from './dto/notebook-query.dto';
import { NotebookService } from './notebook.service';

/** The library-wide Notebook. Read only: edits go through each kind's own per-book routes. */
@Controller('notebook')
export class NotebookController {
  constructor(private readonly notebookService: NotebookService) {}

  @Get('entries')
  entries(@CurrentUser() user: RequestUser, @Query() query: NotebookEntriesQueryDto): Promise<NotebookEntriesResponse> {
    return this.notebookService.entries(user, query);
  }

  @Get('overview')
  overview(@CurrentUser() user: RequestUser, @Query() query: NotebookOverviewQueryDto): Promise<NotebookOverview> {
    return this.notebookService.overview(user, query);
  }

  @Get('books')
  books(@CurrentUser() user: RequestUser, @Query() query: NotebookBooksQueryDto): Promise<NotebookBooksResponse> {
    return this.notebookService.books(user, query);
  }

  @Get('review')
  review(@CurrentUser() user: RequestUser, @Query() query: NotebookReviewQueryDto): Promise<NotebookReviewResponse> {
    return this.notebookService.review(user, query);
  }

  @Get('on-this-day')
  onThisDay(@CurrentUser() user: RequestUser, @Query() query: NotebookOnThisDayQueryDto): Promise<NotebookOnThisDayResponse> {
    return this.notebookService.onThisDay(user, query);
  }

  @Get('trash')
  trash(@CurrentUser() user: RequestUser, @Query() query: NotebookTrashQueryDto): Promise<NotebookTrashResponse> {
    return this.notebookService.trash(user, query);
  }
}
