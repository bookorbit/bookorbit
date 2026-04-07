import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { UserAvatarService } from './user-avatar.service';

const ONE_BY_ONE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lmL8AAAAASUVORK5CYII=', 'base64');

describe('UserAvatarService', () => {
  const userRepo = {
    findAvatarStateById: vi.fn(),
    setAvatarSourceAndBumpVersion: vi.fn(),
  };
  const avatarStorage = {
    saveAvatar: vi.fn(),
    deleteAvatar: vi.fn(),
    getAvatarPathIfExists: vi.fn(),
  };

  let service: UserAvatarService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new UserAvatarService(userRepo as any, avatarStorage as any);
  });

  it('rejects non-image uploads', async () => {
    await expect(service.uploadOwnAvatar({ id: 1 } as any, Buffer.from('abc'), 'text/plain')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores normalized avatar and returns uploaded avatar URL', async () => {
    userRepo.findAvatarStateById.mockResolvedValue({ id: 1, avatarUrl: null, avatarSource: 'uploaded', avatarVersion: 1 });

    const result = await service.uploadOwnAvatar({ id: 1 } as any, ONE_BY_ONE_PNG, 'image/png');

    expect(avatarStorage.saveAvatar).toHaveBeenCalledWith(1, expect.any(Buffer));
    expect(userRepo.setAvatarSourceAndBumpVersion).toHaveBeenCalledWith(1, 'uploaded');
    expect(result).toEqual({ avatarUrl: '/api/v1/users/1/avatar?v=1' });
  });

  it('falls back to external avatar after removing uploaded avatar', async () => {
    userRepo.findAvatarStateById
      .mockResolvedValueOnce({ id: 1, avatarUrl: 'https://example.com/avatar.jpg', avatarSource: 'uploaded', avatarVersion: 4 })
      .mockResolvedValueOnce({ id: 1, avatarUrl: 'https://example.com/avatar.jpg', avatarSource: 'external', avatarVersion: 5 });

    const result = await service.removeOwnAvatar({ id: 1 } as any);

    expect(avatarStorage.deleteAvatar).toHaveBeenCalledWith(1);
    expect(userRepo.setAvatarSourceAndBumpVersion).toHaveBeenCalledWith(1, 'external');
    expect(result).toEqual({ avatarUrl: 'https://example.com/avatar.jpg' });
  });

  it('blocks reading other users avatar without permission', async () => {
    await expect(service.getAvatarPath({ id: 1, isSuperuser: false, permissions: [] } as any, 2)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects empty file (0 bytes)', async () => {
    await expect(service.uploadOwnAvatar({ id: 1 } as any, Buffer.alloc(0), 'image/png')).rejects.toThrow('File is empty');
  });

  it('rejects file exceeding MAX_USER_AVATAR_BYTES', async () => {
    await expect(service.uploadOwnAvatar({ id: 1 } as any, Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png')).rejects.toThrow(
      'Image exceeds 5 MB limit',
    );
  });

  it('rejects corrupt image data with Invalid image file', async () => {
    await expect(service.uploadOwnAvatar({ id: 1 } as any, Buffer.from('not-an-image'), 'image/png')).rejects.toThrow('Invalid image file');
  });
});
