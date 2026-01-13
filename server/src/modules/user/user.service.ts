import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { RequestUser } from '../../common/types/request-user';
import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRepository } from './user.repository';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  findByUsername(username: string) {
    return this.userRepo.findByUsername(username);
  }

  findByEmail(email: string) {
    return this.userRepo.findByEmail(email);
  }

  findByOidcSubject(subject: string, issuer: string) {
    return this.userRepo.findByOidcSubject(subject, issuer);
  }

  linkOidcIdentity(userId: number, oidcSubject: string, oidcIssuer: string, avatarUrl?: string) {
    return this.userRepo.linkOidcIdentity(userId, oidcSubject, oidcIssuer, avatarUrl);
  }

  createOidcUser(data: Parameters<UserRepository['createOidcUser']>[0]) {
    return this.userRepo.createOidcUser(data);
  }

  assignRoleDirectly(userId: number, roleId: number) {
    return this.userRepo.assignRole(userId, roleId);
  }

  generatePasswordResetToken(userId: number): Promise<string> {
    return this.userRepo.generateResetToken(userId);
  }

  incrementTokenVersion(userId: number) {
    return this.userRepo.incrementTokenVersion(userId);
  }

  findByIdWithRolesAndPermissions(id: number): Promise<RequestUser | null> {
    return this.userRepo.findByIdWithRolesAndPermissions(id);
  }

  create(data: Parameters<UserRepository['create']>[0]) {
    return this.userRepo.create(data);
  }

  findAll(page = 0, pageSize = 50) {
    return this.userRepo.findAll(page, pageSize);
  }

  async findById(id: number) {
    const user = await this.userRepo.findByIdWithRolesAndPermissions(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async createUser(dto: CreateUserDto) {
    const existing = await this.userRepo.findByUsername(dto.username);
    if (existing) throw new ConflictException('Username already taken');

    const passwordHash = await hash(randomBytes(16).toString('hex'), 12);
    const user = await this.userRepo.create({
      username: dto.username,
      name: dto.name,
      email: dto.email,
      passwordHash,
      isDefaultPassword: true,
    });

    if (dto.roleIds?.length) {
      await Promise.all(dto.roleIds.map((roleId) => this.userRepo.assignRole(user.id, roleId)));
    }

    const appUrl = this.config.get<string>('mailer.appUrl') ?? 'http://localhost:5173';
    const rawToken = await this.userRepo.generateResetToken(user.id);
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

    return { id: user.id, username: user.username, name: user.name, resetUrl };
  }

  async updateUser(id: number, dto: UpdateUserDto, requestingUser: RequestUser) {
    if (id === requestingUser.id && dto.active === false) {
      throw new ConflictException('You cannot deactivate your own account');
    }

    const requestingIsSuperuser = requestingUser.roles.some((r) => r.isSuperuser);
    const target = await this.userRepo.findByIdWithRolesAndPermissions(id);
    if (!target) throw new NotFoundException('User not found');

    if (target.roles.some((r) => r.isSuperuser) && !requestingIsSuperuser) {
      throw new ForbiddenException('Only administrators can edit administrator accounts');
    }

    if (dto.active === false) {
      const otherSuperusers = await this.userRepo.countOtherSuperusers(id);
      if (target.roles.some((r) => r.isSuperuser) && otherSuperusers === 0) {
        throw new ConflictException('Cannot deactivate the last administrator');
      }
    }

    const user = await this.userRepo.update(id, dto);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: number, dto: UpdateMeDto) {
    const user = await this.userRepo.update(userId, dto);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async deleteUser(id: number, requestingUser: RequestUser) {
    if (id === requestingUser.id) {
      throw new ConflictException('You cannot delete your own account');
    }
    const requestingIsSuperuser = requestingUser.roles.some((r) => r.isSuperuser);
    const [target, otherSuperusers] = await Promise.all([this.userRepo.findByIdWithRolesAndPermissions(id), this.userRepo.countOtherSuperusers(id)]);
    if (target?.roles.some((r) => r.isSuperuser)) {
      if (!requestingIsSuperuser) throw new ForbiddenException('Only administrators can delete administrator accounts');
      if (otherSuperusers === 0) throw new ConflictException('Cannot delete the last administrator');
    }
    await this.userRepo.delete(id);
  }

  async assignRole(targetUserId: number, roleId: number, requestingUser: RequestUser) {
    await this.guardSuperuserRoleOp(roleId, requestingUser);
    await this.userRepo.assignRole(targetUserId, roleId);
  }

  async revokeRole(targetUserId: number, roleId: number, requestingUser: RequestUser) {
    if (targetUserId === requestingUser.id) {
      throw new ConflictException('You cannot revoke roles from your own account');
    }
    await this.guardSuperuserRoleOp(roleId, requestingUser);

    const [target, otherSuperusers] = await Promise.all([
      this.userRepo.findByIdWithRolesAndPermissions(targetUserId),
      this.userRepo.countOtherSuperusers(targetUserId),
    ]);
    const roleBeingRevoked = target?.roles.find((r) => r.id === roleId);
    if (roleBeingRevoked?.isSuperuser && otherSuperusers === 0) {
      throw new ConflictException('Cannot remove the last administrator');
    }

    await this.userRepo.revokeRole(targetUserId, roleId);
  }

  async adminResetPassword(targetUserId: number, requestingUser: RequestUser) {
    const target = await this.userRepo.findByIdWithRolesAndPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    const requestingIsSuperuser = requestingUser.roles.some((r) => r.isSuperuser);
    if (target.roles.some((r) => r.isSuperuser) && !requestingIsSuperuser) {
      throw new ForbiddenException('Only administrators can reset administrator passwords');
    }
    const appUrl = this.config.get<string>('mailer.appUrl') ?? 'http://localhost:5173';
    const rawToken = await this.userRepo.generateResetToken(targetUserId);
    return { resetUrl: `${appUrl}/reset-password?token=${rawToken}` };
  }

  // If the role being assigned/revoked is a superuser role, the requesting user
  // must also have manage_roles permission (not just manage_users).
  private async guardSuperuserRoleOp(roleId: number, requestingUser: RequestUser) {
    const role = await this.db.query.roles.findFirst({ where: eq(schema.roles.id, roleId) });
    if (!role) throw new NotFoundException('Role not found');

    if (role.isSuperuser) {
      const hasManageRoles =
        requestingUser.roles.some((r) => r.isSuperuser) || requestingUser.roles.flatMap((r) => r.permissions).some((p) => p.name === 'manage_roles');
      if (!hasManageRoles) {
        throw new ForbiddenException('Assigning or revoking superuser roles requires manage_roles permission');
      }
    }
  }
}
