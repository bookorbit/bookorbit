import { Permission, AuditAction, AuditResource } from '@bookorbit/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateEmailRecipientDto } from './dto/create-email-recipient.dto';
import { UpdateEmailRecipientDto } from './dto/update-email-recipient.dto';
import { EmailRecipientService } from './email-recipient.service';

@Controller('email/recipients')
@RequirePermission(Permission.EmailSend)
export class EmailRecipientController {
  constructor(private readonly service: EmailRecipientService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @Auditable({
    action: AuditAction.EmailRecipientCreate,
    resource: AuditResource.EmailRecipient,
    getResourceId: (_, res: unknown) => (res as { id?: number })?.id,
    description: (_, res: unknown) => `Created email recipient '${(res as { email?: string })?.email ?? 'unknown'}'`,
  })
  create(@Body() dto: CreateEmailRecipientDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @Auditable({
    action: AuditAction.EmailRecipientUpdate,
    resource: AuditResource.EmailRecipient,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Updated email recipient #${req.params['id']}`,
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmailRecipientDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.EmailRecipientDelete,
    resource: AuditResource.EmailRecipient,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Deleted email recipient #${req.params['id']}`,
  })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }

  @Patch(':id/default')
  setDefault(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.setDefault(id, user);
  }
}
