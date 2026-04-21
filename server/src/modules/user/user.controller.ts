import { Permission } from '@bookorbit/types';
import { AuditAction, AuditResource } from '@bookorbit/types';
import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { CreateUserDto } from './dto/create-user.dto';
import { SetLibrariesDto } from './dto/set-libraries.dto';
import { SetPermissionsDto } from './dto/set-permissions.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSeriesCollapsePreferencesDto } from './dto/update-series-collapse-preferences.dto';
import { MAX_USER_AVATAR_BYTES } from './user-avatar.service';
import { UserAvatarService } from './user-avatar.service';
import { UserService } from './user.service';

@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userAvatarService: UserAvatarService,
  ) {}

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

  @Patch('me/series-collapse-preferences')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateSeriesCollapsePreferences(@CurrentUser() user: RequestUser, @Body() dto: UpdateSeriesCollapsePreferencesDto) {
    return this.userService.updateSeriesCollapsePreferences(user.id, dto);
  }

  @Post('me/avatar')
  @Auditable({
    action: AuditAction.UserSelfUpdate,
    resource: AuditResource.User,
    getResourceId: (req) => (req as unknown as { user?: { id: number } }).user?.id,
    description: () => 'User uploaded a profile picture',
  })
  async uploadMyAvatar(@CurrentUser() user: RequestUser, @Req() req: MultipartRequest) {
    let data;
    try {
      data = await req.file({ limits: { fileSize: MAX_USER_AVATAR_BYTES } });
    } catch (error) {
      if (isMultipartFileTooLargeError(error)) {
        throw new BadRequestException('Image exceeds 5 MB limit');
      }
      throw error;
    }
    if (!data) throw new BadRequestException('No file provided');
    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (error) {
      if (isMultipartFileTooLargeError(error)) {
        throw new BadRequestException('Image exceeds 5 MB limit');
      }
      throw error;
    }
    return this.userAvatarService.uploadOwnAvatar(user, buffer, data.mimetype);
  }

  @Delete('me/avatar')
  @Auditable({
    action: AuditAction.UserSelfUpdate,
    resource: AuditResource.User,
    getResourceId: (req) => (req as unknown as { user?: { id: number } }).user?.id,
    description: () => 'User removed their profile picture',
  })
  deleteMyAvatar(@CurrentUser() user: RequestUser) {
    return this.userAvatarService.removeOwnAvatar(user);
  }

  @Get(':id')
  @RequirePermission(Permission.ManageUsers)
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findById(id);
  }

  @Get(':id/avatar')
  async getAvatar(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const avatarPath = await this.userAvatarService.getAvatarPath(user, id);
    if (!avatarPath) {
      reply.status(404).send({ message: `No avatar for user ${id}` });
      return;
    }

    const { mtimeMs } = await stat(avatarPath);
    const etag = `"${Math.floor(mtimeMs)}"`;
    if (ifNoneMatch === etag) {
      reply.status(304).send();
      return;
    }

    reply.header('Cache-Control', 'no-cache');
    reply.header('ETag', etag);
    reply.type('image/jpeg');
    reply.send(createReadStream(avatarPath));
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

function isMultipartFileTooLargeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const value = error as { code?: unknown; statusCode?: unknown; message?: unknown };
  if (value.code === 'FST_REQ_FILE_TOO_LARGE') {
    return true;
  }
  return value.statusCode === 413 && typeof value.message === 'string' && value.message.toLowerCase().includes('file too large');
}
