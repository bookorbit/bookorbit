import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequirePermission('manage_users')
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
  @RequirePermission('manage_users')
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findById(id);
  }

  @Post()
  @RequirePermission('manage_users')
  createUser(@Body() dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  @Patch(':id')
  @RequirePermission('manage_users')
  updateUser(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.updateUser(id, dto, requestingUser);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('manage_users')
  deleteUser(@Param('id', ParseIntPipe) id: number, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.deleteUser(id, requestingUser);
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('manage_users')
  assignRole(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignRoleDto, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.assignRole(id, dto.roleId, requestingUser);
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('manage_users')
  revokeRole(@Param('id', ParseIntPipe) id: number, @Param('roleId', ParseIntPipe) roleId: number, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.revokeRole(id, roleId, requestingUser);
  }

  @Post(':id/reset-password')
  @RequirePermission('manage_users')
  adminResetPassword(@Param('id', ParseIntPipe) id: number, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.adminResetPassword(id, requestingUser);
  }
}
