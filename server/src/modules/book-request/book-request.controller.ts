import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../common/decorators/require-any-permission.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookRequestService } from './book-request.service';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { CreateBookRequestDto } from './dto/create-book-request.dto';
import { BulkBookRequestsDto } from './dto/bulk-book-requests.dto';
import { ListBookRequestsDto } from './dto/list-book-requests.dto';
import { UpdateBookRequestLanguageDto } from './dto/update-book-request-language.dto';

@Controller('book-requests')
@RequirePermission(Permission.BookRequestAccess)
export class BookRequestController {
  constructor(private readonly service: BookRequestService) {}

  @Post()
  @Auditable({
    action: AuditAction.BookRequestCreate,
    resource: AuditResource.BookRequest,
    getResourceId: (_req, body) => (body as { request?: { id?: number } })?.request?.id,
    description: 'Created a book request',
  })
  submit(@Body() dto: CreateBookRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.submit(dto, user);
  }

  @Get()
  listMine(@Query() query: ListBookRequestsDto, @CurrentUser() user: RequestUser) {
    return this.service.listMine(query, user);
  }

  @Get('summary')
  getSummary(@CurrentUser() user: RequestUser) {
    return this.service.getSummary(user);
  }

  /**
   * Counts only, for the same reason `default-destinations` is here: it is instance configuration
   * a requester has to be told about, and the indexer list it comes from is admin-only. Without
   * it a request queued against nothing looks identical to one waiting its turn.
   *
   * Also answers to `ManageAppSettings`, which is the permission the automation tab requires: the
   * one warning that tab exists for is "auto-grab is on and there is nothing to search", and an
   * operator who is not also a requester was silently never shown it.
   */
  @Get('source-status')
  @RequireAnyPermission(Permission.BookRequestAccess, Permission.ManageAppSettings)
  getSourceStatus() {
    return this.service.getSourceStatus();
  }

  /**
   * Instance configuration rather than anything of this user's, but read from the request form,
   * so it is gated on requesting rather than on managing settings.
   */
  @Get('default-destinations')
  getDefaultDestinations() {
    return this.service.getDefaultDestinations();
  }

  /**
   * POST because the payload is a batch of candidates, not an addressable resource. Read-only,
   * so it is not audited.
   */
  @Post('availability')
  @HttpCode(HttpStatus.OK)
  checkAvailability(@Body() dto: CheckAvailabilityDto, @CurrentUser() user: RequestUser) {
    return this.service.checkAvailability(dto.items, user);
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.getOne(id, user);
  }

  /**
   * Not audited alongside the decisions: this changes what the request is asking for, not whether
   * it was allowed, and the service logs the before and after either way.
   */
  @Post(':id/language')
  @HttpCode(HttpStatus.OK)
  setLanguage(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookRequestLanguageDto, @CurrentUser() user: RequestUser) {
    return this.service.setLanguage(id, dto.language, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.BookRequestCancel,
    resource: AuditResource.BookRequest,
    getResourceId: (req) => Number(req.params.id),
    description: 'Cancelled a book request',
  })
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.cancel(id, user);
  }

  /**
   * Leaving a request somebody else made, which is the way back out of joining one. Not audited
   * for the same reason dismissal is not: it changes nothing anybody else can see.
   */
  @Delete(':id/subscription')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.unsubscribe(id, user);
  }

  /**
   * Bulk hiding, declared before `:id/dismiss` for readability; the two paths never collide.
   * Not audited: what one person keeps on their own list is not a moderation event.
   */
  @Post('dismiss')
  @HttpCode(HttpStatus.OK)
  dismissMany(@Body() dto: BulkBookRequestsDto, @CurrentUser() user: RequestUser) {
    return this.service.dismissMany(dto, user);
  }

  /**
   * Hiding a settled request from your own list. Not audited: it changes nothing anybody else can
   * see, and a log of who stopped looking at what is noise.
   */
  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.dismiss(id, user);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.restore(id, user);
  }
}
