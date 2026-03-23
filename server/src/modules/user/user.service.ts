import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Permission } from '@projectx/types';

import type { RequestUser } from '../../common/types/request-user';
import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { CreateUserDto } from './dto/create-user.dto';
import { SetPermissionsDto } from './dto/set-permissions.dto';
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

  generatePasswordResetToken(userId: number): Promise<string> {
    return this.userRepo.generateResetToken(userId);
  }

  incrementTokenVersion(userId: number) {
    return this.userRepo.incrementTokenVersion(userId);
  }

  findByIdWithPermissions(id: number): Promise<RequestUser | null> {
    return this.userRepo.findByIdWithPermissions(id);
  }

  create(data: Parameters<UserRepository['create']>[0]) {
    return this.userRepo.create(data);
  }

  findAll(page = 0, pageSize = 50) {
    return this.userRepo.findAll(page, pageSize);
  }

  findAssignable() {
    return this.userRepo.findAssignable();
  }

  async findById(id: number) {
    const user = await this.userRepo.findByIdWithPermissions(id);
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

    if (dto.permissionNames?.length) {
      await this.userRepo.setPermissions(user.id, dto.permissionNames as Permission[]);
    }

    if (dto.libraryIds?.length) {
      for (const libraryId of dto.libraryIds) {
        await this.db.insert(schema.userLibraryAccess).values({ userId: user.id, libraryId, accessLevel: 'viewer' }).onConflictDoNothing();
      }
    }

    const appUrl = this.config.get<string>('app.appUrl') ?? 'http://localhost:5173';
    const rawToken = await this.userRepo.generateResetToken(user.id);
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

    return { id: user.id, username: user.username, name: user.name, resetUrl };
  }

  async updateUser(id: number, dto: UpdateUserDto, requestingUser: RequestUser) {
    if (id === requestingUser.id && dto.active === false) {
      throw new ConflictException('You cannot deactivate your own account');
    }

    const target = await this.userRepo.findByIdWithPermissions(id);
    if (!target) throw new NotFoundException('User not found');

    if (target.isSuperuser && !requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can edit administrator accounts');
    }

    if (dto.active === false && target.isSuperuser) {
      const otherSuperusers = await this.userRepo.countOtherSuperusers(id);
      if (otherSuperusers === 0) {
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
    const [target, otherSuperusers] = await Promise.all([this.userRepo.findByIdWithPermissions(id), this.userRepo.countOtherSuperusers(id)]);
    if (target?.isSuperuser) {
      if (!requestingUser.isSuperuser) throw new ForbiddenException('Only administrators can delete administrator accounts');
      if (otherSuperusers === 0) throw new ConflictException('Cannot delete the last administrator');
    }
    await this.userRepo.delete(id);
  }

  setPermissionsDirectly(userId: number, permissionNames: Permission[]) {
    return this.userRepo.setPermissions(userId, permissionNames);
  }

  async setPermissions(targetUserId: number, dto: SetPermissionsDto, requestingUser: RequestUser) {
    if (targetUserId === requestingUser.id) {
      throw new ConflictException('You cannot modify your own permissions');
    }
    const target = await this.userRepo.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');

    if (target.isSuperuser && !requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can modify administrator permissions');
    }

    await this.userRepo.setPermissions(targetUserId, dto.permissionNames as Permission[]);
  }

  async setSuperuser(targetUserId: number, isSuperuser: boolean, requestingUser: RequestUser) {
    if (!requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can change superuser status');
    }
    if (targetUserId === requestingUser.id) {
      throw new ConflictException('You cannot change your own superuser status');
    }
    if (!isSuperuser) {
      const otherSuperusers = await this.userRepo.countOtherSuperusers(targetUserId);
      if (otherSuperusers === 0) {
        throw new ConflictException('Cannot remove the last administrator');
      }
    }
    await this.userRepo.setSuperuser(targetUserId, isSuperuser);
  }

  async getLibraryIds(userId: number): Promise<number[]> {
    const rows = await this.db
      .select({ libraryId: schema.userLibraryAccess.libraryId })
      .from(schema.userLibraryAccess)
      .where(eq(schema.userLibraryAccess.userId, userId));
    return rows.map((r) => r.libraryId);
  }

  async setLibraries(targetUserId: number, libraryIds: number[], requestingUser: RequestUser): Promise<void> {
    const target = await this.userRepo.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    if (target.isSuperuser && !requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can edit administrator accounts');
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(schema.userLibraryAccess).where(eq(schema.userLibraryAccess.userId, targetUserId));
      if (libraryIds.length) {
        await tx
          .insert(schema.userLibraryAccess)
          .values(libraryIds.map((libraryId) => ({ userId: targetUserId, libraryId, accessLevel: 'viewer' as const })));
      }
    });
  }

  async adminResetPassword(targetUserId: number, requestingUser: RequestUser) {
    const target = await this.userRepo.findByIdWithPermissions(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    if (target.isSuperuser && !requestingUser.isSuperuser) {
      throw new ForbiddenException('Only administrators can reset administrator passwords');
    }
    const appUrl = this.config.get<string>('app.appUrl') ?? 'http://localhost:5173';
    const rawToken = await this.userRepo.generateResetToken(targetUserId);
    return { resetUrl: `${appUrl}/reset-password?token=${rawToken}` };
  }
}
