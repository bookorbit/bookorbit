import { Permission, AuditAction, AuditResource } from '@projectx/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateEmailProviderDto } from './dto/create-email-provider.dto';
import { UpdateEmailProviderDto } from './dto/update-email-provider.dto';
import { EmailProviderService } from './email-provider.service';

@Controller('email/providers')
export class EmailProviderController {
  constructor(private readonly service: EmailProviderService) {}

  @Get()
  @RequirePermission(Permission.EmailSend)
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAll(user);
  }

  @Get(':id')
  @RequirePermission(Permission.EmailSend)
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermission(Permission.ManageEmail)
  @Auditable({
    action: AuditAction.EmailProviderCreate,
    resource: AuditResource.EmailProvider,
    getResourceId: (_, res: unknown) => (res as { id?: number })?.id,
    description: (_, res: unknown) => `Created email provider '${(res as { name?: string })?.name ?? 'unknown'}'`,
  })
  create(@Body() dto: CreateEmailProviderDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermission(Permission.ManageEmail)
  @Auditable({
    action: AuditAction.EmailProviderUpdate,
    resource: AuditResource.EmailProvider,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Updated email provider #${req.params['id']}`,
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmailProviderDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageEmail)
  @Auditable({
    action: AuditAction.EmailProviderDelete,
    resource: AuditResource.EmailProvider,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Deleted email provider #${req.params['id']}`,
  })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }

  @Patch(':id/default')
  @RequirePermission(Permission.EmailSend)
  @Auditable({
    action: AuditAction.EmailProviderSetDefault,
    resource: AuditResource.EmailProvider,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Set email provider #${req.params['id']} as default`,
  })
  setDefault(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.setDefault(id, user);
  }

  @Patch(':id/share')
  @RequirePermission(Permission.ManageEmail)
  @Auditable({
    action: AuditAction.EmailProviderUpdate,
    resource: AuditResource.EmailProvider,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Toggled sharing for email provider #${req.params['id']}`,
  })
  toggleShared(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.toggleShared(id, user);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ManageEmail)
  testConnection(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.testConnection(id, user);
  }

  @Patch(':id/system')
  @RequirePermission(Permission.ManageEmail)
  @Auditable({
    action: AuditAction.EmailProviderSetSystem,
    resource: AuditResource.EmailProvider,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Set email provider #${req.params['id']} as system mail provider`,
  })
  setSystemProvider(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.setSystemProvider(id, user);
  }

  @Delete('system')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageEmail)
  @Auditable({
    action: AuditAction.EmailProviderClearSystem,
    resource: AuditResource.EmailProvider,
    description: () => 'Cleared system mail provider',
  })
  clearSystemProvider(@CurrentUser() user: RequestUser) {
    return this.service.clearSystemProvider(user);
  }
}
