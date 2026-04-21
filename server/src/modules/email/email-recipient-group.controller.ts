import { Permission, AuditAction, AuditResource } from '@bookorbit/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AddGroupMemberDto } from './dto/add-group-member.dto';
import { CreateEmailRecipientGroupDto } from './dto/create-email-recipient-group.dto';
import { UpdateEmailRecipientGroupDto } from './dto/update-email-recipient-group.dto';
import { EmailRecipientGroupService } from './email-recipient-group.service';

@Controller('email/recipient-groups')
@RequirePermission(Permission.EmailSend)
export class EmailRecipientGroupController {
  constructor(private readonly service: EmailRecipientGroupService) {}

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
    action: AuditAction.EmailRecipientGroupCreate,
    resource: AuditResource.EmailRecipientGroup,
    getResourceId: (_, res: unknown) => (res as { id?: number })?.id,
    description: (_, res: unknown) => `Created email recipient group '${(res as { name?: string })?.name ?? 'unknown'}'`,
  })
  create(@Body() dto: CreateEmailRecipientGroupDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @Auditable({
    action: AuditAction.EmailRecipientGroupUpdate,
    resource: AuditResource.EmailRecipientGroup,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Updated email recipient group #${req.params['id']}`,
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmailRecipientGroupDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.EmailRecipientGroupDelete,
    resource: AuditResource.EmailRecipientGroup,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Deleted email recipient group #${req.params['id']}`,
  })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/members')
  @Auditable({
    action: AuditAction.EmailRecipientGroupMemberAdd,
    resource: AuditResource.EmailRecipientGroup,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Added recipient #${(req.body as { recipientId?: number })?.recipientId ?? 'unknown'} to group #${req.params['id']}`,
  })
  addMember(@Param('id', ParseIntPipe) id: number, @Body() dto: AddGroupMemberDto, @CurrentUser() user: RequestUser) {
    return this.service.addMember(id, dto.recipientId, user);
  }

  @Delete(':id/members/:recipientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.EmailRecipientGroupMemberRemove,
    resource: AuditResource.EmailRecipientGroup,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Removed recipient #${req.params['recipientId']} from group #${req.params['id']}`,
  })
  removeMember(
    @Param('id', ParseIntPipe) groupId: number,
    @Param('recipientId', ParseIntPipe) recipientId: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.removeMember(groupId, recipientId, user);
  }
}
