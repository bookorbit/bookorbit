import { Permission } from '@projectx/types';
import { BadRequestException } from '@nestjs/common';

import { UserController } from './user.controller';
import { MAX_USER_AVATAR_BYTES } from './user-avatar.service';

describe('UserController', () => {
  const userService = {
    findAll: vi.fn(),
    updateMe: vi.fn(),
    findById: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    setPermissions: vi.fn(),
    setSuperuser: vi.fn(),
    adminResetPassword: vi.fn(),
  };
  const userAvatarService = {
    uploadOwnAvatar: vi.fn(),
    removeOwnAvatar: vi.fn(),
    getAvatarPath: vi.fn(),
  };

  const controller = new UserController(userService as any, userAvatarService as any);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes optional pagination args to service', async () => {
    await controller.findAll(undefined, 25);
    expect(userService.findAll).toHaveBeenCalledWith(undefined, 25);
  });

  it('routes updateMe to current user id', async () => {
    const user = { id: 7 } as any;
    const dto = { name: 'Updated' };

    await controller.updateMe(user, dto as any);

    expect(userService.updateMe).toHaveBeenCalledWith(7, dto);
  });

  it('uploads avatar bytes with multipart file limits', async () => {
    const user = { id: 7 } as any;
    const buffer = Buffer.from('img');
    const req = {
      file: vi.fn().mockResolvedValue({
        mimetype: 'image/png',
        toBuffer: vi.fn().mockResolvedValue(buffer),
      }),
    } as any;

    await controller.uploadMyAvatar(user, req);

    expect(req.file).toHaveBeenCalledWith({ limits: { fileSize: MAX_USER_AVATAR_BYTES } });
    expect(userAvatarService.uploadOwnAvatar).toHaveBeenCalledWith(user, buffer, 'image/png');
  });

  it('maps multipart file-size errors to a bad request response', async () => {
    const tooLargeError = Object.assign(new Error('request file too large'), {
      code: 'FST_REQ_FILE_TOO_LARGE',
      statusCode: 413,
    });
    const req = {
      file: vi.fn().mockResolvedValue({
        mimetype: 'image/jpeg',
        toBuffer: vi.fn().mockRejectedValue(tooLargeError),
      }),
    } as any;

    await expect(controller.uploadMyAvatar({ id: 7 } as any, req)).rejects.toThrow(BadRequestException);
    await expect(controller.uploadMyAvatar({ id: 7 } as any, req)).rejects.toThrow('Image exceeds 5 MB limit');
    expect(userAvatarService.uploadOwnAvatar).not.toHaveBeenCalled();
  });

  it('delegates permission and superuser management and admin reset', async () => {
    const requester = { id: 1 } as any;
    const dto = { permissionNames: [Permission.LibraryDownload] };

    await controller.setPermissions(8, dto as any, requester);
    await controller.setSuperuser(8, true, requester);
    await controller.adminResetPassword(8, requester);

    expect(userService.setPermissions).toHaveBeenCalledWith(8, dto, requester);
    expect(userService.setSuperuser).toHaveBeenCalledWith(8, true, requester);
    expect(userService.adminResetPassword).toHaveBeenCalledWith(8, requester);
  });
});
