import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';

import { Permission } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { resolveUserAvatarUrl } from '../../common/utils/user-avatar-url';
import { UserAvatarStorageService } from './user-avatar-storage.service';
import { UserRepository } from './user.repository';

export const MAX_USER_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE_PX = 512;

@Injectable()
export class UserAvatarService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly avatarStorage: UserAvatarStorageService,
  ) {}

  async uploadOwnAvatar(user: RequestUser, bytes: Buffer, mimeType: string): Promise<{ avatarUrl: string | null }> {
    if (!mimeType.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }
    if (bytes.length === 0) {
      throw new BadRequestException('File is empty');
    }
    if (bytes.length > MAX_USER_AVATAR_BYTES) {
      throw new BadRequestException('Image exceeds 5 MB limit');
    }

    const transformed = await this.normalizeAvatar(bytes);
    await this.avatarStorage.saveAvatar(user.id, transformed);
    await this.userRepo.setAvatarSourceAndBumpVersion(user.id, 'uploaded');

    const state = await this.userRepo.findAvatarStateById(user.id);
    if (!state) throw new NotFoundException('User not found');
    return { avatarUrl: resolveUserAvatarUrl(state) };
  }

  async removeOwnAvatar(user: RequestUser): Promise<{ avatarUrl: string | null }> {
    const state = await this.userRepo.findAvatarStateById(user.id);
    if (!state) throw new NotFoundException('User not found');

    await this.avatarStorage.deleteAvatar(user.id);
    const nextSource = state.avatarUrl ? 'external' : 'none';
    await this.userRepo.setAvatarSourceAndBumpVersion(user.id, nextSource);

    const nextState = await this.userRepo.findAvatarStateById(user.id);
    if (!nextState) throw new NotFoundException('User not found');
    return { avatarUrl: resolveUserAvatarUrl(nextState) };
  }

  async getAvatarPath(requestingUser: RequestUser, targetUserId: number): Promise<string | null> {
    this.assertReadAccess(requestingUser, targetUserId);

    const target = await this.userRepo.findAvatarStateById(targetUserId);
    if (!target) throw new NotFoundException('User not found');
    if (target.avatarSource !== 'uploaded') return null;

    return this.avatarStorage.getAvatarPathIfExists(targetUserId);
  }

  private assertReadAccess(requestingUser: RequestUser, targetUserId: number): void {
    if (requestingUser.id === targetUserId) return;
    if (requestingUser.isSuperuser) return;
    if (requestingUser.permissions.includes(Permission.ManageUsers)) return;
    throw new ForbiddenException('Insufficient permissions to access this avatar');
  }

  private async normalizeAvatar(bytes: Buffer): Promise<Buffer> {
    try {
      return await sharp(bytes)
        .rotate()
        .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
    } catch {
      throw new BadRequestException('Invalid image file');
    }
  }
}
