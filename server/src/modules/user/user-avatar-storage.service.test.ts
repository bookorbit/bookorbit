vi.mock('fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

import { Logger } from '@nestjs/common';
import { access, mkdir, unlink, writeFile } from 'fs/promises';

import { UserAvatarStorageService } from './user-avatar-storage.service';

const accessMock = vi.mocked(access);
const mkdirMock = vi.mocked(mkdir);
const unlinkMock = vi.mocked(unlink);
const writeFileMock = vi.mocked(writeFile);

describe('UserAvatarStorageService', () => {
  const loggerWarn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  const config = {
    get: vi.fn().mockReturnValue('/app-data'),
  };

  let service: UserAvatarStorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockReturnValue('/app-data');
    service = new UserAvatarStorageService(config as never);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('saves avatar bytes under the per-user directory', async () => {
    const bytes = Buffer.from('avatar');

    await service.saveAvatar(42, bytes);

    expect(mkdirMock).toHaveBeenCalledWith('/app-data/users/42', { recursive: true });
    expect(writeFileMock).toHaveBeenCalledWith('/app-data/users/42/avatar.jpg', bytes);
  });

  it('silently ignores missing avatar files on delete', async () => {
    unlinkMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    await expect(service.deleteAvatar(42)).resolves.toBeUndefined();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('logs a warning when delete fails for reasons other than missing file', async () => {
    unlinkMock.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

    await expect(service.deleteAvatar(42)).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith('Failed to delete avatar for userId=42: permission denied');
  });

  it('returns the avatar path only when file is readable', async () => {
    accessMock.mockResolvedValue(undefined);
    await expect(service.getAvatarPathIfExists(9)).resolves.toBe('/app-data/users/9/avatar.jpg');

    accessMock.mockRejectedValue(new Error('not readable'));
    await expect(service.getAvatarPathIfExists(9)).resolves.toBeNull();
  });
});
