import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

vi.mock('bcryptjs', () => ({
  hash: vi.fn((value: string) => Promise.resolve(`mock-hash:${value}`)),
  compare: vi.fn((plain: string, hashed: string) => Promise.resolve(hashed === `mock-hash:${plain}`)),
}));

import { DB } from '../../../db';
import { OpdsUserService } from '../opds-user.service';

const mockReturning = vi.fn();
const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
const mockValues = vi.fn();

function makeMockDb() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: mockValues,
    }),
    update: vi.fn().mockReturnValue({
      set: mockSet,
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    query: {
      opdsUsers: { findFirst: vi.fn() },
      users: { findFirst: vi.fn() },
    },
  };
}

describe('OpdsUserService', () => {
  let service: OpdsUserService;
  let db: ReturnType<typeof makeMockDb>;

  beforeEach(async () => {
    db = makeMockDb();
    const module = await Test.createTestingModule({
      providers: [OpdsUserService, { provide: DB, useValue: db }],
    }).compile();
    service = module.get(OpdsUserService);
  });

  describe('findAllForUser', () => {
    it('returns OPDS users for the given userId', async () => {
      const expected = [{ id: 1, userId: 5, username: 'reader', sortOrder: 'recent', createdAt: new Date() }];
      db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(expected),
          }),
        }),
      });

      const result = await service.findAllForUser(5);
      expect(result).toEqual(expected);
    });
  });

  describe('create', () => {
    it('creates an OPDS user with hashed password', async () => {
      const created = { id: 1, userId: 5, username: 'newuser', sortOrder: 'recent', createdAt: new Date() };
      mockValues.mockReturnValue({
        returning: vi.fn().mockResolvedValue([created]),
      });

      const result = await service.create(5, { username: 'newuser', password: 'password123' });
      expect(result).toEqual(created);
    });

    it('throws ConflictException on duplicate username', async () => {
      const pgError: Error & { code?: string } = new Error('unique violation');
      pgError.code = '23505';
      mockValues.mockReturnValue({
        returning: vi.fn().mockRejectedValue(pgError),
      });

      await expect(service.create(5, { username: 'duplicate', password: 'password123' })).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when duplicate violation is wrapped by DrizzleQueryError', async () => {
      const wrapped = new Error('failed query', {
        cause: { code: '23505' },
      });
      mockValues.mockReturnValue({
        returning: vi.fn().mockRejectedValue(wrapped),
      });

      await expect(service.create(5, { username: 'duplicate', password: 'password123' })).rejects.toThrow(ConflictException);
    });

    it('rethrows non-unique-violation errors', async () => {
      const genericError = new Error('connection lost');
      mockValues.mockReturnValue({
        returning: vi.fn().mockRejectedValue(genericError),
      });

      await expect(service.create(5, { username: 'user', password: 'password123' })).rejects.toThrow('connection lost');
    });
  });

  describe('update', () => {
    it('updates sort order for owned OPDS user', async () => {
      const existing = { id: 10, userId: 5 };
      db.query.opdsUsers.findFirst.mockResolvedValue(existing);

      const updated = { id: 10, userId: 5, username: 'reader', sortOrder: 'title_asc', createdAt: new Date() };
      mockReturning.mockResolvedValue([updated]);

      const result = await service.update(5, 10, { sortOrder: 'title_asc' });
      expect(result).toEqual(updated);
    });

    it('throws ForbiddenException when user does not own the OPDS user', async () => {
      db.query.opdsUsers.findFirst.mockResolvedValue(undefined);

      await expect(service.update(5, 10, { sortOrder: 'title_asc' })).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if update returns no row', async () => {
      db.query.opdsUsers.findFirst.mockResolvedValue({ id: 10, userId: 5 });
      mockReturning.mockResolvedValue([]);

      await expect(service.update(5, 10, { sortOrder: 'title_asc' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes an owned OPDS user', async () => {
      db.query.opdsUsers.findFirst.mockResolvedValue({ id: 10, userId: 5 });

      await expect(service.delete(5, 10)).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when user does not own the OPDS user', async () => {
      db.query.opdsUsers.findFirst.mockResolvedValue(undefined);

      await expect(service.delete(5, 10)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('validateCredentials', () => {
    it('returns null when OPDS user not found', async () => {
      db.query.opdsUsers.findFirst.mockResolvedValue(undefined);

      const result = await service.validateCredentials('nobody', 'pass');
      expect(result).toBeNull();
    });

    it('returns null when password does not match', async () => {
      db.query.opdsUsers.findFirst.mockResolvedValue({
        id: 1,
        userId: 5,
        username: 'reader',
        passwordHash: '$2a$12$invalidhashthatshouldnotmatch000000000000000000',
      });

      const result = await service.validateCredentials('reader', 'wrongpass');
      expect(result).toBeNull();
    });

    it('returns null when parent user not found', async () => {
      const { hash } = await import('bcryptjs');
      const passwordHash = await hash('correctpass', 4);

      db.query.opdsUsers.findFirst.mockResolvedValue({
        id: 1,
        userId: 999,
        username: 'reader',
        passwordHash,
      });
      db.query.users.findFirst.mockResolvedValue(undefined);

      const result = await service.validateCredentials('reader', 'correctpass');
      expect(result).toBeNull();
    });

    it('returns opdsUser and parentUser on valid credentials', async () => {
      const { hash } = await import('bcryptjs');
      const passwordHash = await hash('correctpass', 4);

      const opdsUser = { id: 1, userId: 5, username: 'reader', passwordHash, sortOrder: 'recent' };
      const parentUser = { id: 5, username: 'admin', active: true };

      db.query.opdsUsers.findFirst.mockResolvedValue(opdsUser);
      db.query.users.findFirst.mockResolvedValue(parentUser);

      const result = await service.validateCredentials('reader', 'correctpass');
      expect(result).not.toBeNull();
      expect(result!.opdsUser).toEqual(opdsUser);
      expect(result!.parentUser).toEqual(parentUser);
    });
  });
});
