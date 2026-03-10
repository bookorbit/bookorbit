import { Permission } from '@projectx/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
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
  create(@Body() dto: CreateEmailRecipientGroupDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmailRecipientGroupDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/members')
  addMember(@Param('id', ParseIntPipe) id: number, @Body() dto: AddGroupMemberDto, @CurrentUser() user: RequestUser) {
    return this.service.addMember(id, dto.recipientId, user);
  }

  @Delete(':id/members/:recipientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @Param('id', ParseIntPipe) groupId: number,
    @Param('recipientId', ParseIntPipe) recipientId: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.removeMember(groupId, recipientId, user);
  }
}
