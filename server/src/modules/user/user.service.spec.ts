jest.mock('bcryptjs', () => ({ hash: jest.fn() }));
jest.mock('crypto', () => ({ randomBytes: jest.fn() }));

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';

import { UserService } from './user.service';

const mockHash = hash as jest.MockedFunction<typeof hash>;
const mockRandomBytes = randomBytes as jest.MockedFunction<typeof randomBytes>;

function reqUser(overrides: Partial<{ id: number; roles: Array<{ isSuperuser: boolean; permissions: Array<{ name: string }> }> }> = {}) {
  return {
    id: 1,
    roles: [{ isSuperuser: false, permissions: [] }],
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
    assignRole: jest.fn(),
    generateResetToken: jest.fn(),
    incrementTokenVersion: jest.fn(),
    findByIdWithRolesAndPermissions: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    countOtherSuperusers: jest.fn(),
    delete: jest.fn(),
    revokeRole: jest.fn(),
  };

  const config = { get: jest.fn() };
  const db = {
    query: {
      roles: {
        findFirst: jest.fn(),
      },
    },
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

  it('createUser creates user, assigns requested roles, and returns reset URL', async () => {
    userRepo.findByUsername.mockResolvedValue(null);

    const result = await service.createUser({ username: 'newuser', name: 'New User', email: 'x@y.com', roleIds: [3, 4] } as any);

    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'newuser',
        name: 'New User',
        email: 'x@y.com',
        passwordHash: 'hashed-secret',
        isDefaultPassword: true,
      }),
    );
    expect(userRepo.assignRole).toHaveBeenCalledWith(10, 3);
    expect(userRepo.assignRole).toHaveBeenCalledWith(10, 4);
    expect(result).toEqual({ id: 10, username: 'newuser', name: 'New User', resetUrl: 'https://app.example.com/reset-password?token=reset-token' });
  });

  it('updateUser blocks self-deactivation', async () => {
    await expect(service.updateUser(1, { active: false }, reqUser({ id: 1 }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateUser blocks non-superuser editing a superuser account', async () => {
    userRepo.findByIdWithRolesAndPermissions.mockResolvedValue({ id: 2, roles: [{ isSuperuser: true }] });

    await expect(service.updateUser(2, { name: 'x' }, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateUser prevents deactivating the last administrator', async () => {
    userRepo.findByIdWithRolesAndPermissions.mockResolvedValue({ id: 2, roles: [{ isSuperuser: true }] });
    userRepo.countOtherSuperusers.mockResolvedValue(0);

    await expect(service.updateUser(2, { active: false }, reqUser({ roles: [{ isSuperuser: true, permissions: [] }] }))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('assignRole requires manage_roles permission for superuser roles', async () => {
    (db.query.roles.findFirst as jest.Mock).mockResolvedValue({ id: 9, isSuperuser: true });

    await expect(service.assignRole(2, 9, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepo.assignRole).not.toHaveBeenCalled();
  });

  it('assignRole allows superuser-role assignment for manage_roles users', async () => {
    (db.query.roles.findFirst as jest.Mock).mockResolvedValue({ id: 9, isSuperuser: true });

    await service.assignRole(
      2,
      9,
      reqUser({ roles: [{ isSuperuser: false, permissions: [{ name: 'manage_roles' }] }] }),
    );

    expect(userRepo.assignRole).toHaveBeenCalledWith(2, 9);
  });

  it('revokeRole blocks self-role-revocation', async () => {
    await expect(service.revokeRole(1, 7, reqUser({ id: 1 }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('revokeRole prevents removing the last superuser role from target', async () => {
    (db.query.roles.findFirst as jest.Mock).mockResolvedValue({ id: 11, isSuperuser: true });
    userRepo.findByIdWithRolesAndPermissions.mockResolvedValue({ id: 2, roles: [{ id: 11, isSuperuser: true }] });
    userRepo.countOtherSuperusers.mockResolvedValue(0);

    await expect(service.revokeRole(2, 11, reqUser({ roles: [{ isSuperuser: true, permissions: [] }] }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('adminResetPassword forbids non-superuser reset of superuser account', async () => {
    userRepo.findByIdWithRolesAndPermissions.mockResolvedValue({ id: 2, roles: [{ isSuperuser: true }] });

    await expect(service.adminResetPassword(2, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('adminResetPassword throws when target user does not exist', async () => {
    userRepo.findByIdWithRolesAndPermissions.mockResolvedValue(null);

    await expect(service.adminResetPassword(9, reqUser({ roles: [{ isSuperuser: true, permissions: [] }] }))).rejects.toBeInstanceOf(NotFoundException);
  });
});
