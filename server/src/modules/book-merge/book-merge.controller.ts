import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';

import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { KeyReadSafe } from '../../common/decorators/api-key-policy.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookMergeService } from './book-merge.service';
import { BookMergeDto, BookMergePreviewDto } from './dto/book-merge.dto';

/**
 * Editor access on the books' library is enforced per book in the planner: the ids are in the
 * body, where the library-access guard cannot see them.
 */
@Controller('books/merge')
export class BookMergeController {
  constructor(private readonly bookMergeService: BookMergeService) {}

  @Post('preview')
  @KeyReadSafe()
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.LibraryMergeBooks)
  preview(@Body() dto: BookMergePreviewDto, @CurrentUser() user: RequestUser) {
    return this.bookMergeService.preview(dto, user);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(Permission.LibraryMergeBooks)
  @Auditable({
    action: AuditAction.BookMerge,
    resource: AuditResource.Book,
    getResourceId: (req) => (req.body as { targetBookId?: number })?.targetBookId,
    getMeta: (req, response) => {
      const body = req.body as { targetBookId?: number; sourceBookIds?: number[] };
      const started = response as { jobId?: number; libraryIds?: number[] } | undefined;
      return { targetBookId: body?.targetBookId, sourceBookIds: body?.sourceBookIds, jobId: started?.jobId, libraryIds: started?.libraryIds };
    },
    description: (req) => {
      const body = req.body as { targetBookId?: number; sourceBookIds?: number[] };
      return `Merged books ${(body?.sourceBookIds ?? []).join(', ')} into book #${body?.targetBookId}`;
    },
  })
  merge(@Body() dto: BookMergeDto, @CurrentUser() user: RequestUser) {
    return this.bookMergeService.start(dto, user);
  }

  @Get('jobs/:jobId')
  @RequirePermission(Permission.LibraryMergeBooks)
  getJob(@Param('jobId', ParseIntPipe) jobId: number, @CurrentUser() user: RequestUser) {
    return this.bookMergeService.getJob(jobId, user);
  }
}
