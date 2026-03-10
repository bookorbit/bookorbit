import { Permission } from '@projectx/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseBoolPipe, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateUserDto } from './dto/create-user.dto';
import { SetPermissionsDto } from './dto/set-permissions.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequirePermission(Permission.ManageUsers)
  findAll(
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ) {
    return this.userService.findAll(page, pageSize);
  }

  // Must be before :id routes to avoid "me" being parsed as an int
  @Patch('me')
  updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateMeDto) {
    return this.userService.updateMe(user.id, dto);
  }

  @Get(':id')
  @RequirePermission(Permission.ManageUsers)
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findById(id);
  }

  @Post()
  @RequirePermission(Permission.ManageUsers)
  createUser(@Body() dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  @Patch(':id')
  @RequirePermission(Permission.ManageUsers)
  updateUser(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.updateUser(id, dto, requestingUser);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageUsers)
  deleteUser(@Param('id', ParseIntPipe) id: number, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.deleteUser(id, requestingUser);
  }

  @Put(':id/permissions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageUsers)
  setPermissions(@Param('id', ParseIntPipe) id: number, @Body() dto: SetPermissionsDto, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.setPermissions(id, dto, requestingUser);
  }

  @Put(':id/superuser')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageUsers)
  setSuperuser(
    @Param('id', ParseIntPipe) id: number,
    @Body('isSuperuser', ParseBoolPipe) isSuperuser: boolean,
    @CurrentUser() requestingUser: RequestUser,
  ) {
    return this.userService.setSuperuser(id, isSuperuser, requestingUser);
  }

  @Post(':id/reset-password')
  @RequirePermission(Permission.ManageUsers)
  adminResetPassword(@Param('id', ParseIntPipe) id: number, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.adminResetPassword(id, requestingUser);
  }
}
