import { Body, Controller, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { KeyReadSafe } from '../../common/decorators/api-key-policy.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbidPermission } from '../../common/decorators/forbid-permission.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BulkRunsService } from '../bulk-runs/bulk-runs.service';
import { BookMoveService } from './book-move.service';
import { MoveBooksDto, MovePreviewDto } from './dto/move-books.dto';

/**
 * Editor access on every source library and on the target is enforced per book in
 * the service: the target is named in the body rather than a route param, so the
 * library-access guard cannot see it, and a selection can span several sources.
 */
@Controller('books/move')
export class BookMoveController {
  constructor(
    private readonly bookMoveService: BookMoveService,
    private readonly bulkRuns: BulkRunsService,
  ) {}

  @Post('preview')
  @KeyReadSafe()
  @RequirePermission(Permission.LibraryEditMetadata)
  preview(@Body() dto: MovePreviewDto, @CurrentUser() user: RequestUser) {
    return this.bookMoveService.preview(dto, user);
  }

  /**
   * Queues the move as a bulk run and streams its per-book progress. Every check that can refuse
   * the move (missing target, no access, a scan already running) answers as a normal JSON error
   * before the stream starts. Closing the stream leaves the move running; it is cancelled from Jobs.
   */
  @Post()
  @RequirePermission(Permission.LibraryEditMetadata)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot move books')
  async move(@Body() dto: MoveBooksDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const plan = await this.bookMoveService.planRun(dto, user);
    await this.bulkRuns.startAndStream(reply, {
      kind: 'book-move',
      subjectIds: plan.subjectIds,
      options: plan.options,
      actor: user,
      audit: {
        action: AuditAction.BookBulkMoveLibrary,
        resource: AuditResource.Book,
        description: (count) => `Moved ${count} book${count !== 1 ? 's' : ''} to library #${plan.options.targetLibraryId}`,
        meta: { targetLibraryId: plan.options.targetLibraryId, targetFolderId: plan.options.targetFolderId },
      },
    });
  }
}
