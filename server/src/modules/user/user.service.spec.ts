jest.mock('bcryptjs', () => ({ hash: jest.fn() }));
jest.mock('crypto', () => ({ randomBytes: jest.fn() }));

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Permission } from '@projectx/types';

import { UserService } from './user.service';

const mockHash = hash as jest.MockedFunction<typeof hash>;
const mockRandomBytes = randomBytes as jest.MockedFunction<typeof randomBytes>;

function reqUser(overrides: Partial<{ id: number; isSuperuser: boolean; permissions: Permission[] }> = {}) {
  return {
    id: 1,
    isSuperuser: false,
    permissions: [],
    ...overrides,
  } as any;
}

describe('UserService', () => {
  const userRepo = {
    findByUsername: jest.fn(),
    findByEmail: jest.fn(),
    findByOidcSubject: jest.fn(),
    linkOidcIdentity: jest.fn(),
    createOidcUser: jest.fn(),
    setPermissions: jest.fn(),
    generateResetToken: jest.fn(),
    incrementTokenVersion: jest.fn(),
    findByIdWithPermissions: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    countOtherSuperusers: jest.fn(),
    delete: jest.fn(),
    setSuperuser: jest.fn(),
  };

  const config = { get: jest.fn() };
  const db = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
  };

  let service: UserService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new UserService(userRepo as any, config as any, db as any);

    mockHash.mockResolvedValue('hashed-secret');
    mockRandomBytes.mockReturnValue(Buffer.from('abcd', 'hex'));
    config.get.mockReturnValue('https://app.example.com');
    userRepo.create.mockResolvedValue({ id: 10, username: 'newuser', name: 'New User' });
    userRepo.generateResetToken.mockResolvedValue('reset-token');
  });

  it('createUser rejects duplicate usernames', async () => {
    userRepo.findByUsername.mockResolvedValue({ id: 2 });

    await expect(service.createUser({ username: 'taken', name: 'Name' } as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('createUser creates user, assigns requested permissions, and returns reset URL', async () => {
    userRepo.findByUsername.mockResolvedValue(null);

    const result = await service.createUser({
      username: 'newuser',
      name: 'New User',
      email: 'x@y.com',
      permissionNames: [Permission.LibraryDownload, Permission.KoboSync],
    } as any);

    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'newuser',
        name: 'New User',
        email: 'x@y.com',
        passwordHash: 'hashed-secret',
        isDefaultPassword: true,
      }),
    );
    expect(userRepo.setPermissions).toHaveBeenCalledWith(10, [Permission.LibraryDownload, Permission.KoboSync]);
    expect(result).toEqual({ id: 10, username: 'newuser', name: 'New User', resetUrl: 'https://app.example.com/reset-password?token=reset-token' });
  });

  it('updateUser blocks self-deactivation', async () => {
    await expect(service.updateUser(1, { active: false }, reqUser({ id: 1 }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateUser blocks non-superuser editing a superuser account', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });

    await expect(service.updateUser(2, { name: 'x' }, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateUser prevents deactivating the last administrator', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });
    userRepo.countOtherSuperusers.mockResolvedValue(0);

    await expect(service.updateUser(2, { active: false }, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('setPermissions blocks modifying own permissions', async () => {
    await expect(service.setPermissions(1, { permissionNames: [] }, reqUser({ id: 1 }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('setPermissions blocks non-superuser modifying a superuser account', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });

    await expect(service.setPermissions(2, { permissionNames: [Permission.LibraryDownload] }, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('setPermissions succeeds for superuser modifying another user', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false });

    await service.setPermissions(2, { permissionNames: [Permission.LibraryDownload] }, reqUser({ isSuperuser: true }));

    expect(userRepo.setPermissions).toHaveBeenCalledWith(2, [Permission.LibraryDownload]);
  });

  it('setSuperuser blocks non-superuser from changing superuser status', async () => {
    await expect(service.setSuperuser(2, true, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('setSuperuser blocks changing own superuser status', async () => {
    await expect(service.setSuperuser(1, false, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('setSuperuser prevents removing the last administrator', async () => {
    userRepo.countOtherSuperusers.mockResolvedValue(0);

    await expect(service.setSuperuser(2, false, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('adminResetPassword forbids non-superuser reset of superuser account', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });

    await expect(service.adminResetPassword(2, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('adminResetPassword throws when target user does not exist', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue(null);

    await expect(service.adminResetPassword(9, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(NotFoundException);
  });
});
