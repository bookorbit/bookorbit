vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

import { AuditAction, Permission } from '@projectx/types';
import { BadRequestException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import { UserController } from './user.controller';
import { MAX_USER_AVATAR_BYTES } from './user-avatar.service';

const statMock = vi.mocked(stat);
const createReadStreamMock = vi.mocked(createReadStream);

describe('UserController', () => {
  const userService = {
    findAll: vi.fn(),
    findAssignable: vi.fn(),
    updateMe: vi.fn(),
    findById: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    setPermissions: vi.fn(),
    setSuperuser: vi.fn(),
    getLibraryIds: vi.fn(),
    setLibraries: vi.fn(),
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

  it('delegates list and profile update operations', async () => {
    await controller.findAll(undefined, 25);
    await controller.findAssignable();
    await controller.updateMe({ id: 7 } as any, { name: 'Updated' } as any);

    expect(userService.findAll).toHaveBeenCalledWith(undefined, 25);
    expect(userService.findAssignable).toHaveBeenCalled();
    expect(userService.updateMe).toHaveBeenCalledWith(7, { name: 'Updated' });
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

  it('maps req.file size-limit errors to bad request', async () => {
    const tooLargeError = Object.assign(new Error('request file too large'), {
      code: 'FST_REQ_FILE_TOO_LARGE',
      statusCode: 413,
    });
    const req = {
      file: vi.fn().mockRejectedValue(tooLargeError),
    } as any;

    await expect(controller.uploadMyAvatar({ id: 7 } as any, req)).rejects.toThrow(BadRequestException);
    await expect(controller.uploadMyAvatar({ id: 7 } as any, req)).rejects.toThrow('Image exceeds 5 MB limit');
  });

  it('maps multipart toBuffer size-limit errors to bad request', async () => {
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

  it('rethrows unknown multipart errors and validates missing file', async () => {
    const reqFileError = new Error('unexpected req.file failure');
    const req = { file: vi.fn().mockRejectedValue(reqFileError) } as any;
    await expect(controller.uploadMyAvatar({ id: 7 } as any, req)).rejects.toBe(reqFileError);

    const reqWithoutFile = { file: vi.fn().mockResolvedValue(null) } as any;
    await expect(controller.uploadMyAvatar({ id: 7 } as any, reqWithoutFile)).rejects.toThrow('No file provided');
  });

  it('delegates avatar delete and returns avatar content with cache handling', async () => {
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
    };

    await controller.deleteMyAvatar({ id: 7 } as any);
    expect(userAvatarService.removeOwnAvatar).toHaveBeenCalledWith({ id: 7 });

    userAvatarService.getAvatarPath.mockResolvedValueOnce(null);
    await controller.getAvatar({ id: 7 } as any, 2, reply as any);
    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ message: 'No avatar for user 2' });

    userAvatarService.getAvatarPath.mockResolvedValueOnce('/avatars/u2.jpg');
    statMock.mockResolvedValueOnce({ mtimeMs: 1234.56 } as any);
    await controller.getAvatar({ id: 7 } as any, 2, reply as any, '"1234"');
    expect(reply.status).toHaveBeenCalledWith(304);

    const stream = {} as any;
    createReadStreamMock.mockReturnValue(stream);
    userAvatarService.getAvatarPath.mockResolvedValueOnce('/avatars/u2.jpg');
    statMock.mockResolvedValueOnce({ mtimeMs: 5678.9 } as any);
    await controller.getAvatar({ id: 7 } as any, 2, reply as any);

    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"5678"');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('delegates user management operations', async () => {
    const requester = { id: 1 } as any;
    const dto = { permissionNames: [Permission.LibraryDownload] };
    const setLibrariesDto = { libraryIds: [1, 2] };

    await controller.findById(8);
    await controller.createUser({ username: 'new' } as any);
    await controller.updateUser(8, { name: 'updated' } as any, requester);
    await controller.deleteUser(8, requester);
    await controller.setPermissions(8, dto as any, requester);
    await controller.setSuperuser(8, true, requester);
    await controller.getLibraries(8);
    await controller.setLibraries(8, setLibrariesDto as any, requester);
    await controller.adminResetPassword(8, requester);

    expect(userService.findById).toHaveBeenCalledWith(8);
    expect(userService.createUser).toHaveBeenCalledWith({ username: 'new' });
    expect(userService.updateUser).toHaveBeenCalledWith(8, { name: 'updated' }, requester);
    expect(userService.deleteUser).toHaveBeenCalledWith(8, requester);
    expect(userService.setPermissions).toHaveBeenCalledWith(8, dto, requester);
    expect(userService.setSuperuser).toHaveBeenCalledWith(8, true, requester);
    expect(userService.getLibraryIds).toHaveBeenCalledWith(8);
    expect(userService.setLibraries).toHaveBeenCalledWith(8, [1, 2], requester);
    expect(userService.adminResetPassword).toHaveBeenCalledWith(8, requester);
  });

  it('defines auditable metadata for create/update/delete/superuser operations', () => {
    const createAudit = Reflect.getMetadata(AUDITABLE_KEY, UserController.prototype.createUser) as {
      action: AuditAction;
      getResourceId: (req: unknown, responseBody: { id?: number }) => number | undefined;
      description: (req: unknown, responseBody: { username?: string }) => string;
    };
    expect(createAudit.action).toBe(AuditAction.UserCreate);
    expect(createAudit.getResourceId({} as never, { id: 9 })).toBe(9);
    expect(createAudit.description({} as never, { username: 'alice' })).toBe("Created user 'alice'");

    const updateAudit = Reflect.getMetadata(AUDITABLE_KEY, UserController.prototype.updateUser) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }, responseBody: unknown) => string;
    };
    expect(updateAudit.getResourceId({ params: { id: '15' } })).toBe(15);
    expect(updateAudit.description({ params: { id: '15' } }, null)).toBe('Updated user #15');

    const deleteAudit = Reflect.getMetadata(AUDITABLE_KEY, UserController.prototype.deleteUser) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }, responseBody: unknown) => string;
    };
    expect(deleteAudit.getResourceId({ params: { id: '16' } })).toBe(16);
    expect(deleteAudit.description({ params: { id: '16' } }, null)).toBe('Deleted user #16');

    const superuserAudit = Reflect.getMetadata(AUDITABLE_KEY, UserController.prototype.setSuperuser) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string>; body: { isSuperuser?: boolean } }, responseBody: unknown) => string;
    };
    expect(superuserAudit.getResourceId({ params: { id: '17' } })).toBe(17);
    expect(superuserAudit.description({ params: { id: '17' }, body: { isSuperuser: true } }, null)).toBe('Enabled superuser for user #17');
    expect(superuserAudit.description({ params: { id: '17' }, body: { isSuperuser: false } }, null)).toBe('Disabled superuser for user #17');
  });
});
