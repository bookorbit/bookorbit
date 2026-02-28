import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateOpdsUserDto } from './dto/create-opds-user.dto';
import { UpdateOpdsUserDto } from './dto/update-opds-user.dto';
import { OpdsUserService } from './opds-user.service';

@Controller('opds-users')
@RequirePermission('opds_access')
export class OpdsUserController {
  constructor(private readonly opdsUserService: OpdsUserService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.opdsUserService.findAllForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateOpdsUserDto) {
    return this.opdsUserService.create(user.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOpdsUserDto) {
    return this.opdsUserService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.opdsUserService.delete(user.id, id);
  }
}
