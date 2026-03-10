import { Permission } from '@projectx/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { PreviewTemplateDto } from './dto/preview-template.dto';
import { EmailTemplateService } from './email-template.service';

@Controller('email/templates')
@RequirePermission(Permission.EmailSend)
export class EmailTemplateController {
  constructor(private readonly service: EmailTemplateService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateEmailTemplateDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmailTemplateDto, @CurrentUser() user: RequestUser) {
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

  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  preview(@Param('id', ParseIntPipe) id: number, @Body() dto: PreviewTemplateDto, @CurrentUser() user: RequestUser) {
    return this.service.preview(id, dto.bookId, null, user);
  }
}
