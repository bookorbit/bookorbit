import { Controller, Param, ParseIntPipe, Post } from '@nestjs/common';

import { AuditAction, AuditResource } from '@bookorbit/types';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ReadingStateService } from './reading-state.service';

@Controller('books')
export class ReadingStateController {
  constructor(private readonly service: ReadingStateService) {}

  /**
   * Clears only the caller's own sessions, progress and Kobo state, scoped by `user.id` in the
   * repository. It therefore takes no permission beyond access to the book: requiring
   * `LibraryEditMetadata` stopped read-only accounts from clearing their own reading history.
   */
  @Post(':bookId/reset-reading-state')
  @Auditable({
    action: AuditAction.BookReadingStateReset,
    resource: AuditResource.Book,
    getResourceId: (req) => parseInt(req.params['bookId'] as string, 10),
    description: (req) => `Reset reading state for book #${req.params['bookId']}`,
  })
  resetBookReadingState(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.service.resetBookReadingState(bookId, user);
  }
}
