import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { CreatePermissionDto } from './dto/create-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleRepository } from './role.repository';

@Injectable()
export class RoleService {
  constructor(private readonly roleRepo: RoleRepository) {}

  findAll() {
    return this.roleRepo.findAllWithPermissions();
  }

  async findById(id: number) {
    const role = await this.roleRepo.findWithPermissions(id);
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async createRole(dto: CreateRoleDto) {
    const role = await this.roleRepo.create({ name: dto.name, description: dto.description });
    if (dto.permissionIds?.length) {
      await Promise.all(dto.permissionIds.map((permissionId) => this.roleRepo.assignPermission(role.id, permissionId)));
    }
    return role;
  }

  async updateRole(id: number, dto: UpdateRoleDto) {
    const role = await this.roleRepo.findById(id);
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem && dto.name && dto.name !== role.name) {
      throw new ConflictException('Cannot rename system roles');
    }
    return this.roleRepo.update(id, dto);
  }

  async deleteRole(id: number) {
    const role = await this.roleRepo.findById(id);
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ConflictException('System roles cannot be deleted');
    await this.roleRepo.delete(id);
  }

  async assignPermission(roleId: number, permissionId: number) {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new NotFoundException('Role not found');
    await this.roleRepo.assignPermission(roleId, permissionId);
  }

  async revokePermission(roleId: number, permissionId: number) {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new NotFoundException('Role not found');
    await this.roleRepo.revokePermission(roleId, permissionId);
  }

  findAllPermissions() {
    return this.roleRepo.findAllPermissions();
  }

  createPermission(dto: CreatePermissionDto) {
    return this.roleRepo.createPermission(dto);
  }

  async deletePermission(id: number) {
    const perm = await this.roleRepo.findPermissionById(id);
    if (!perm) throw new NotFoundException('Permission not found');
    if (perm.isSystem) throw new ConflictException('System permissions cannot be deleted');
    await this.roleRepo.deletePermission(id);
  }
}
