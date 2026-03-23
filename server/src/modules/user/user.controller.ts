import { Permission } from '@projectx/types';
import { AuditAction, AuditResource } from '@projectx/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseBoolPipe, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateUserDto } from './dto/create-user.dto';
import { SetLibrariesDto } from './dto/set-libraries.dto';
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

  // Must be before :id routes to avoid named segments being parsed as ints
  @Get('assignable')
  @RequirePermission(Permission.ManageLibraries)
  findAssignable() {
    return this.userService.findAssignable();
  }

  @Patch('me')
  @Auditable({
    action: AuditAction.UserSelfUpdate,
    resource: AuditResource.User,
    getResourceId: (req) => (req as unknown as { user?: { id: number } }).user?.id,
    description: () => `User updated their own profile`,
  })
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
  @Auditable({
    action: AuditAction.UserCreate,
    resource: AuditResource.User,
    getResourceId: (_, res: unknown) => (res as { id?: number })?.id,
    description: (_, res: unknown) => `Created user '${(res as { username?: string })?.username ?? 'unknown'}'`,
  })
  createUser(@Body() dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  @Patch(':id')
  @RequirePermission(Permission.ManageUsers)
  @Auditable({
    action: AuditAction.UserUpdate,
    resource: AuditResource.User,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Updated user #${req.params['id']}`,
  })
  updateUser(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.updateUser(id, dto, requestingUser);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageUsers)
  @Auditable({
    action: AuditAction.UserDelete,
    resource: AuditResource.User,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Deleted user #${req.params['id']}`,
  })
  deleteUser(@Param('id', ParseIntPipe) id: number, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.deleteUser(id, requestingUser);
  }

  @Put(':id/permissions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageUsers)
  @Auditable({
    action: AuditAction.UserPermissionSet,
    resource: AuditResource.User,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Updated permissions for user #${req.params['id']}`,
  })
  setPermissions(@Param('id', ParseIntPipe) id: number, @Body() dto: SetPermissionsDto, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.setPermissions(id, dto, requestingUser);
  }

  @Put(':id/superuser')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageUsers)
  @Auditable({
    action: AuditAction.UserSuperuserEnable,
    resource: AuditResource.User,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => {
      const body = req.body as { isSuperuser?: boolean };
      const action = body?.isSuperuser ? 'Enabled' : 'Disabled';
      return `${action} superuser for user #${req.params['id']}`;
    },
  })
  setSuperuser(
    @Param('id', ParseIntPipe) id: number,
    @Body('isSuperuser', ParseBoolPipe) isSuperuser: boolean,
    @CurrentUser() requestingUser: RequestUser,
  ) {
    return this.userService.setSuperuser(id, isSuperuser, requestingUser);
  }

  @Get(':id/libraries')
  @RequirePermission(Permission.ManageUsers)
  getLibraries(@Param('id', ParseIntPipe) id: number) {
    return this.userService.getLibraryIds(id);
  }

  @Put(':id/libraries')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageUsers)
  @Auditable({
    action: AuditAction.UserUpdate,
    resource: AuditResource.User,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Updated library access for user #${req.params['id']}`,
  })
  setLibraries(@Param('id', ParseIntPipe) id: number, @Body() dto: SetLibrariesDto, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.setLibraries(id, dto.libraryIds, requestingUser);
  }

  @Post(':id/reset-password')
  @RequirePermission(Permission.ManageUsers)
  @Auditable({
    action: AuditAction.AuthPasswordAdminReset,
    resource: AuditResource.User,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Admin reset password for user #${req.params['id']}`,
  })
  adminResetPassword(@Param('id', ParseIntPipe) id: number, @CurrentUser() requestingUser: RequestUser) {
    return this.userService.adminResetPassword(id, requestingUser);
  }
}
