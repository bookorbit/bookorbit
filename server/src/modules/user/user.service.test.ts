vi.mock('bcryptjs', () => ({ hash: vi.fn() }));
vi.mock('crypto', () => ({ randomBytes: vi.fn() }));

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Permission } from '@projectx/types';

import { UserService } from './user.service';

const mockHash = hash as MockedFunction<typeof hash>;
const mockRandomBytes = randomBytes as MockedFunction<typeof randomBytes>;

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
    findByUsername: vi.fn(),
    findByEmail: vi.fn(),
    findByOidcSubject: vi.fn(),
    linkOidcIdentity: vi.fn(),
    createOidcUser: vi.fn(),
    setPermissions: vi.fn(),
    generateResetToken: vi.fn(),
    incrementTokenVersion: vi.fn(),
    findByIdWithPermissions: vi.fn(),
    create: vi.fn(),
    findAll: vi.fn(),
    findAssignable: vi.fn(),
    update: vi.fn(),
    countOtherSuperusers: vi.fn(),
    delete: vi.fn(),
    setSuperuser: vi.fn(),
    assignViewerLibraries: vi.fn(),
    findLibraryIdsByUserId: vi.fn(),
    replaceViewerLibraries: vi.fn(),
    findExistingLibraryIds: vi.fn(),
  };

  const config = { get: vi.fn() };

  let service: UserService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new UserService(userRepo as any, config as any);

    mockHash.mockResolvedValue('hashed-secret');
    mockRandomBytes.mockReturnValue(Buffer.from('abcd', 'hex'));
    config.get.mockReturnValue('https://app.example.com');

    userRepo.create.mockResolvedValue({ id: 10, username: 'newuser', name: 'New User' });
    userRepo.findByEmail.mockResolvedValue(null);
    userRepo.generateResetToken.mockResolvedValue('reset-token');
    userRepo.findExistingLibraryIds.mockImplementation((ids: number[]) => Promise.resolve(ids));
  });

  it('createUser rejects duplicate usernames', async () => {
    userRepo.findByUsername.mockResolvedValue({ id: 2 });

    await expect(service.createUser({ username: 'taken', name: 'Name', email: 'taken@example.com' } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('delegates basic repository passthrough methods', async () => {
    await service.findByUsername('alice');
    await service.findByEmail('alice@example.com');
    await service.findByOidcSubject('subject', 'issuer');
    await service.linkOidcIdentity(7, 'subject', 'issuer', 'https://img.example/a.jpg');
    await service.createOidcUser({ username: 'oidc', name: 'OIDC', email: 'oidc@example.com', oidcSubject: 'sub', oidcIssuer: 'iss' });
    await service.generatePasswordResetToken(7);
    await service.incrementTokenVersion(7);
    await service.findByIdWithPermissions(7);
    await service.create({ username: 'new' } as any);
    await service.findAll(1, 20);
    await service.findAssignable();
    await service.setPermissionsDirectly(7, [Permission.LibraryDownload]);

    expect(userRepo.findByUsername).toHaveBeenCalledWith('alice');
    expect(userRepo.findByEmail).toHaveBeenCalledWith('alice@example.com');
    expect(userRepo.findByOidcSubject).toHaveBeenCalledWith('subject', 'issuer');
    expect(userRepo.linkOidcIdentity).toHaveBeenCalledWith(7, 'subject', 'issuer', 'https://img.example/a.jpg');
    expect(userRepo.createOidcUser).toHaveBeenCalled();
    expect(userRepo.generateResetToken).toHaveBeenCalledWith(7);
    expect(userRepo.incrementTokenVersion).toHaveBeenCalledWith(7);
    expect(userRepo.findByIdWithPermissions).toHaveBeenCalledWith(7);
    expect(userRepo.create).toHaveBeenCalledWith({ username: 'new' });
    expect(userRepo.findAll).toHaveBeenCalledWith(1, 20);
    expect(userRepo.findAssignable).toHaveBeenCalled();
    expect(userRepo.setPermissions).toHaveBeenCalledWith(7, [Permission.LibraryDownload]);
  });

  it('createUser rejects duplicate emails', async () => {
    userRepo.findByUsername.mockResolvedValue(null);
    userRepo.findByEmail.mockResolvedValue({ id: 3 });

    await expect(service.createUser({ username: 'newuser', name: 'Name', email: 'taken@example.com' } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('createUser creates user, deduplicates permission/library lists, and returns reset URL', async () => {
    userRepo.findByUsername.mockResolvedValue(null);

    const result = await service.createUser({
      username: 'newuser',
      name: 'New User',
      email: 'x@y.com',
      permissionNames: [Permission.LibraryDownload, Permission.KoboSync, Permission.LibraryDownload],
      libraryIds: [3, 5, 3],
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
    expect(userRepo.assignViewerLibraries).toHaveBeenCalledWith(10, [3, 5]);
    expect(result).toEqual({ id: 10, username: 'newuser', name: 'New User', resetUrl: 'https://app.example.com/reset-password?token=reset-token' });
  });

  it('createUser rejects unknown library IDs', async () => {
    userRepo.findByUsername.mockResolvedValue(null);
    userRepo.findExistingLibraryIds.mockResolvedValue([7]);

    await expect(
      service.createUser({
        username: 'newuser',
        name: 'New User',
        email: 'x@y.com',
        libraryIds: [7, 9],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createUser skips permission/library writes when lists are empty', async () => {
    userRepo.findByUsername.mockResolvedValue(null);
    config.get.mockReturnValue(undefined);

    const result = await service.createUser({
      username: 'newuser',
      name: 'New User',
      email: 'new@example.com',
      permissionNames: [],
      libraryIds: [],
    } as any);

    expect(userRepo.setPermissions).not.toHaveBeenCalled();
    expect(userRepo.assignViewerLibraries).not.toHaveBeenCalled();
    expect(result.resetUrl).toBe('http://localhost:5173/reset-password?token=reset-token');
  });

  it('findById returns user and throws when missing', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValueOnce({ id: 4 }).mockResolvedValueOnce(null);

    await expect(service.findById(4)).resolves.toEqual({ id: 4 });
    await expect(service.findById(99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateUser blocks self-deactivation', async () => {
    await expect(service.updateUser(1, { active: false }, reqUser({ id: 1 }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateUser blocks non-superuser editing a superuser account', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });

    await expect(service.updateUser(2, { name: 'x' }, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateUser throws when target user does not exist', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue(null);

    await expect(service.updateUser(2, { name: 'x' }, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateUser prevents deactivating the last administrator', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });
    userRepo.countOtherSuperusers.mockResolvedValue(0);

    await expect(service.updateUser(2, { active: false }, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateUser rejects duplicate email conflicts explicitly', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false });
    userRepo.findByEmail.mockResolvedValue({ id: 9 });

    await expect(service.updateUser(2, { email: 'dup@example.com' }, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateUser throws if repository update returns null after checks', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false });
    userRepo.update.mockResolvedValue(null);

    await expect(service.updateUser(2, { name: 'x' }, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateMe rejects duplicate email conflicts explicitly', async () => {
    userRepo.findByEmail.mockResolvedValue({ id: 9 });

    await expect(service.updateMe(2, { email: 'dup@example.com' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateMe throws when repository update returns null', async () => {
    userRepo.findByEmail.mockResolvedValue(null);
    userRepo.update.mockResolvedValue(null);

    await expect(service.updateMe(2, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleteUser blocks deleting your own account', async () => {
    await expect(service.deleteUser(1, reqUser({ id: 1, isSuperuser: true }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('deleteUser throws when target user does not exist', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue(null);
    userRepo.countOtherSuperusers.mockResolvedValue(0);

    await expect(service.deleteUser(88, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleteUser blocks non-superusers from deleting superuser accounts', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });
    userRepo.countOtherSuperusers.mockResolvedValue(1);

    await expect(service.deleteUser(2, reqUser({ isSuperuser: false }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deleteUser blocks deleting the last superuser', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });
    userRepo.countOtherSuperusers.mockResolvedValue(0);

    await expect(service.deleteUser(2, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('deleteUser deletes non-superuser targets', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false });
    userRepo.countOtherSuperusers.mockResolvedValue(3);

    await expect(service.deleteUser(2, reqUser({ isSuperuser: false }))).resolves.toBeUndefined();
    expect(userRepo.delete).toHaveBeenCalledWith(2);
  });

  it('setPermissions blocks modifying own permissions', async () => {
    await expect(service.setPermissions(1, { permissionNames: [] }, reqUser({ id: 1 }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('setPermissions blocks non-superuser modifying a superuser account', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });

    await expect(service.setPermissions(2, { permissionNames: [Permission.LibraryDownload] }, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('setPermissions throws when target user does not exist', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue(null);

    await expect(service.setPermissions(2, { permissionNames: [Permission.LibraryDownload] }, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('setPermissions deduplicates permission names', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false });

    await service.setPermissions(
      2,
      { permissionNames: [Permission.LibraryDownload, Permission.KoboSync, Permission.LibraryDownload] },
      reqUser({ isSuperuser: true }),
    );

    expect(userRepo.setPermissions).toHaveBeenCalledWith(2, [Permission.LibraryDownload, Permission.KoboSync]);
  });

  it('setSuperuser blocks non-superuser from changing superuser status', async () => {
    await expect(service.setSuperuser(2, true, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('setSuperuser blocks changing own superuser status', async () => {
    await expect(service.setSuperuser(1, false, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('setSuperuser throws when target user does not exist', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue(null);

    await expect(service.setSuperuser(22, false, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setSuperuser prevents removing the last administrator', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });
    userRepo.countOtherSuperusers.mockResolvedValue(0);

    await expect(service.setSuperuser(2, false, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('setSuperuser writes the target superuser flag when allowed', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false });

    await expect(service.setSuperuser(2, true, reqUser({ isSuperuser: true }))).resolves.toBeUndefined();
    expect(userRepo.setSuperuser).toHaveBeenCalledWith(2, true);
  });

  it('setSuperuser skips last-admin check when target is already non-superuser', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false });

    await service.setSuperuser(2, false, reqUser({ isSuperuser: true }));

    expect(userRepo.countOtherSuperusers).not.toHaveBeenCalled();
    expect(userRepo.setSuperuser).toHaveBeenCalledWith(2, false);
  });

  it('getLibraryIds throws when target user does not exist', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue(null);

    await expect(service.getLibraryIds(4)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getLibraryIds delegates to repository when user exists', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 4, isSuperuser: false });
    userRepo.findLibraryIdsByUserId.mockResolvedValue([11, 12]);

    await expect(service.getLibraryIds(4)).resolves.toEqual([11, 12]);
  });

  it('setLibraries rejects unknown libraries', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false });
    userRepo.findExistingLibraryIds.mockResolvedValue([3]);

    await expect(service.setLibraries(2, [3, 7], reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setLibraries blocks non-superuser updates to superuser targets', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true });

    await expect(service.setLibraries(2, [3], reqUser({ isSuperuser: false }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('setLibraries deduplicates IDs before replacing access rows', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false });
    userRepo.findExistingLibraryIds.mockResolvedValue([3, 7]);

    await service.setLibraries(2, [3, 7, 3], reqUser({ isSuperuser: true }));

    expect(userRepo.replaceViewerLibraries).toHaveBeenCalledWith(2, [3, 7]);
  });

  it('adminResetPassword forbids non-superuser reset of superuser account', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: true, provisioningMethod: 'local' });

    await expect(service.adminResetPassword(2, reqUser())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('adminResetPassword throws when target user does not exist', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue(null);

    await expect(service.adminResetPassword(9, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adminResetPassword rejects OIDC users', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false, provisioningMethod: 'oidc' });

    await expect(service.adminResetPassword(2, reqUser({ isSuperuser: true }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adminResetPassword returns default app URL when config is missing', async () => {
    userRepo.findByIdWithPermissions.mockResolvedValue({ id: 2, isSuperuser: false, provisioningMethod: 'local' });
    userRepo.generateResetToken.mockResolvedValue('token-2');
    config.get.mockReturnValue(undefined);

    await expect(service.adminResetPassword(2, reqUser({ isSuperuser: true }))).resolves.toEqual({
      resetUrl: 'http://localhost:5173/reset-password?token=token-2',
    });
  });
});
