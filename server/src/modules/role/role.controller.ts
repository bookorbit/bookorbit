import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleService } from './role.service';

@Controller()
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  // ── Roles ────────────────────────────────────────────────────────────────

  @Get('roles')
  findAllRoles() {
    return this.roleService.findAll();
  }

  @Get('roles/:id')
  findRole(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.findById(id);
  }

  @Post('roles')
  @RequirePermission('manage_roles')
  createRole(@Body() dto: CreateRoleDto) {
    return this.roleService.createRole(dto);
  }

  @Patch('roles/:id')
  @RequirePermission('manage_roles')
  updateRole(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    return this.roleService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('manage_roles')
  deleteRole(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.deleteRole(id);
  }

  @Post('roles/:id/permissions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('manage_roles')
  assignPermission(@Param('id', ParseIntPipe) id: number, @Body('permissionId', ParseIntPipe) permissionId: number) {
    return this.roleService.assignPermission(id, permissionId);
  }

  @Delete('roles/:id/permissions/:permId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('manage_roles')
  revokePermission(@Param('id', ParseIntPipe) id: number, @Param('permId', ParseIntPipe) permId: number) {
    return this.roleService.revokePermission(id, permId);
  }

  // ── Permissions ───────────────────────────────────────────────────────────

  @Get('permissions')
  findAllPermissions() {
    return this.roleService.findAllPermissions();
  }

  @Post('permissions')
  @RequirePermission('manage_roles')
  createPermission(@Body() dto: CreatePermissionDto) {
    return this.roleService.createPermission(dto);
  }

  @Delete('permissions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('manage_roles')
  deletePermission(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.deletePermission(id);
  }
}
