import { Permission } from '@projectx/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateEmailProviderDto } from './dto/create-email-provider.dto';
import { UpdateEmailProviderDto } from './dto/update-email-provider.dto';
import { EmailProviderService } from './email-provider.service';

@Controller('email/providers')
@RequirePermission(Permission.EmailSend)
export class EmailProviderController {
  constructor(private readonly service: EmailProviderService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateEmailProviderDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmailProviderDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }

  @Patch(':id/default')
  setDefault(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.setDefault(id, user);
  }

  @Patch(':id/share')
  toggleShared(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.toggleShared(id, user);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  testConnection(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.testConnection(id, user);
  }
}
