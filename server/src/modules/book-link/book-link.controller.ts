import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';

import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookLinkService } from './book-link.service';
import { BookLinkDto, BookLinkLeadDto } from './dto/book-link.dto';

@Controller('books')
export class BookLinkController {
  constructor(private readonly bookLinkService: BookLinkService) {}

  @Post('links')
  @RequirePermission(Permission.LibraryMergeBooks)
  @Auditable({
    action: AuditAction.BookLink,
    resource: AuditResource.Book,
    getResourceId: (req) => (req.body as { bookIds?: number[] })?.bookIds?.[0],
    getMeta: (req, response) => ({ bookIds: (req.body as { bookIds?: number[] })?.bookIds, groupId: (response as { groupId?: number })?.groupId }),
    description: (req) => `Linked books ${((req.body as { bookIds?: number[] })?.bookIds ?? []).join(', ')}`,
  })
  link(@Body() dto: BookLinkDto, @CurrentUser() user: RequestUser) {
    return this.bookLinkService.link(dto, user);
  }

  @Patch('links/:groupId')
  @RequirePermission(Permission.LibraryMergeBooks)
  setLead(@Param('groupId', ParseIntPipe) groupId: number, @Body() dto: BookLinkLeadDto, @CurrentUser() user: RequestUser) {
    return this.bookLinkService.setLead(groupId, dto, user);
  }

  @Delete(':id/link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.LibraryMergeBooks)
  @Auditable({
    action: AuditAction.BookUnlink,
    resource: AuditResource.Book,
    getResourceId: (req) => Number((req.params as { id?: string })?.id),
    description: (req) => `Unlinked book #${(req.params as { id?: string })?.id}`,
  })
  unlink(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.bookLinkService.unlink(id, user);
  }
}
