jest.mock('drizzle-orm', () => ({
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  count: jest.fn(() => ({ op: 'count' })),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  inArray: jest.fn((left: unknown, right: unknown) => ({ op: 'inArray', left, right })),
  isNull: jest.fn((value: unknown) => ({ op: 'isNull', value })),
  ne: jest.fn((left: unknown, right: unknown) => ({ op: 'ne', left, right })),
  sql: Object.assign(
    jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
    {
      raw: jest.fn((value: string) => ({ op: 'raw', value })),
    },
  ),
}));

jest.mock('crypto', () => ({
  createHash: jest.fn(),
  randomBytes: jest.fn(),
  randomUUID: jest.fn().mockReturnValue('oidc-uuid'),
}));

jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

import { hash } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';

import * as schema from '../../db/schema';
import { UserRepository } from './user.repository';

const mockHash = hash as jest.MockedFunction<typeof hash>;
const mockCreateHash = createHash as jest.MockedFunction<typeof createHash>;
const mockRandomBytes = randomBytes as jest.MockedFunction<typeof randomBytes>;
const mockRandomUUID = randomUUID as jest.MockedFunction<typeof randomUUID>;
const mockSql = sql as jest.Mock;

describe('UserRepository', () => {
  const updateReturning = jest.fn();
  const updateWhere = jest.fn();
  const updateSet = jest.fn();
  const insertReturning = jest.fn();
  const insertValues = jest.fn();
  const select = jest.fn();

  const db = {
    select,
    update: jest.fn(() => ({ set: updateSet })),
    insert: jest.fn(() => ({ values: insertValues })),
    delete: jest.fn(),
    transaction: jest.fn(),
    query: {
      users: {
        findFirst: jest.fn(),
      },
    },
  };

  let repo: UserRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    repo = new UserRepository(db as any);

    db.update.mockImplementation(() => ({ set: updateSet }));
    db.insert.mockImplementation(() => ({ values: insertValues }));
    mockSql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values }));

    updateSet.mockReturnValue({ where: updateWhere });
    updateWhere.mockReturnValue({ returning: updateReturning });
    updateReturning.mockResolvedValue([
      {
        id: 1,
        username: 'u',
        name: 'n',
        email: null,
        active: true,
        isDefaultPassword: false,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    insertValues.mockReturnValue({ returning: insertReturning });
    insertReturning.mockResolvedValue([{ id: 2 }]);

    mockRandomBytes.mockReturnValue(Buffer.from('abcd', 'hex'));
    mockRandomUUID.mockReturnValue('oidc-uuid');
    const hashState = { update: jest.fn().mockReturnThis(), digest: jest.fn().mockReturnValue('token-hash') };
    mockCreateHash.mockReturnValue(hashState as any);
    mockHash.mockResolvedValue('oidc-password-hash');
  });

  it('findAll returns normalized count and skips role query when no ids are on the page', async () => {
    const idOffset = jest.fn().mockResolvedValue([]);
    const idLimit = jest.fn().mockReturnValue({ offset: idOffset });
    const idOrderBy = jest.fn().mockReturnValue({ limit: idLimit });
    const idFrom = jest.fn().mockReturnValue({ orderBy: idOrderBy });

    const countFrom = jest.fn().mockResolvedValue([{ total: '7' }]);

    select.mockReturnValueOnce({ from: idFrom }).mockReturnValueOnce({ from: countFrom });

    const result = await repo.findAll(0, 25);

    expect(result).toEqual({ users: [], total: 7 });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('findAll preserves page order, aggregates roles, and tolerates missing join rows', async () => {
    const idOffset = jest.fn().mockResolvedValue([{ id: 20 }, { id: 10 }]);
    const idLimit = jest.fn().mockReturnValue({ offset: idOffset });
    const idOrderBy = jest.fn().mockReturnValue({ limit: idLimit });
    const idFrom = jest.fn().mockReturnValue({ orderBy: idOrderBy });

    const countFrom = jest.fn().mockResolvedValue([{ total: 2 }]);

    const rowsOrderBy = jest.fn().mockResolvedValue([
      {
        id: 10,
        username: 'alice',
        name: 'Alice',
        email: null,
        active: true,
        isDefaultPassword: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        roleId: 1,
        roleName: 'admin',
        roleIsSuperuser: true,
        roleIsSystem: true,
      },
      {
        id: 10,
        username: 'alice',
        name: 'Alice',
        email: null,
        active: true,
        isDefaultPassword: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        roleId: 2,
        roleName: 'editor',
        roleIsSuperuser: false,
        roleIsSystem: false,
      },
    ]);
    const rowsWhere = jest.fn().mockReturnValue({ orderBy: rowsOrderBy });
    const rowsJoin2 = jest.fn().mockReturnValue({ where: rowsWhere });
    const rowsJoin1 = jest.fn().mockReturnValue({ leftJoin: rowsJoin2 });
    const rowsFrom = jest.fn().mockReturnValue({ leftJoin: rowsJoin1 });

    select.mockReturnValueOnce({ from: idFrom }).mockReturnValueOnce({ from: countFrom }).mockReturnValueOnce({ from: rowsFrom });

    const result = await repo.findAll(0, 25);

    expect(result.total).toBe(2);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toMatchObject({
      id: 10,
      username: 'alice',
      roles: [
        { id: 1, name: 'admin', isSuperuser: true, isSystem: true },
        { id: 2, name: 'editor', isSuperuser: false, isSystem: false },
      ],
    });
  });

  it('findByIdWithRolesAndPermissions returns null when user is missing', async () => {
    const where = jest.fn().mockResolvedValue([]);
    const join4 = jest.fn().mockReturnValue({ where });
    const join3 = jest.fn().mockReturnValue({ leftJoin: join4 });
    const join2 = jest.fn().mockReturnValue({ leftJoin: join3 });
    const join1 = jest.fn().mockReturnValue({ leftJoin: join2 });
    const from = jest.fn().mockReturnValue({ leftJoin: join1 });
    select.mockReturnValue({ from });

    await expect(repo.findByIdWithRolesAndPermissions(99)).resolves.toBeNull();
  });

  it('findByIdWithRolesAndPermissions deduplicates permissions and ignores null role rows', async () => {
    const where = jest.fn().mockResolvedValue([
      {
        id: 3,
        username: 'sam',
        name: 'Sam',
        email: 'sam@example.com',
        active: true,
        isDefaultPassword: false,
        tokenVersion: 2,
        settings: { locale: 'en' },
        avatarUrl: null,
        provisioningMethod: 'local',
        roleId: 1,
        roleName: 'admin',
        roleDescription: 'Admin role',
        roleIsSuperuser: true,
        roleIsSystem: true,
        permId: 10,
        permName: 'books.read',
      },
      {
        id: 3,
        username: 'sam',
        name: 'Sam',
        email: 'sam@example.com',
        active: true,
        isDefaultPassword: false,
        tokenVersion: 2,
        settings: { locale: 'en' },
        avatarUrl: null,
        provisioningMethod: 'local',
        roleId: 1,
        roleName: 'admin',
        roleDescription: 'Admin role',
        roleIsSuperuser: true,
        roleIsSystem: true,
        permId: 10,
        permName: 'books.read',
      },
      {
        id: 3,
        username: 'sam',
        name: 'Sam',
        email: 'sam@example.com',
        active: true,
        isDefaultPassword: false,
        tokenVersion: 2,
        settings: { locale: 'en' },
        avatarUrl: null,
        provisioningMethod: 'local',
        roleId: 2,
        roleName: 'editor',
        roleDescription: null,
        roleIsSuperuser: false,
        roleIsSystem: false,
        permId: null,
        permName: null,
      },
      {
        id: 3,
        username: 'sam',
        name: 'Sam',
        email: 'sam@example.com',
        active: true,
        isDefaultPassword: false,
        tokenVersion: 2,
        settings: { locale: 'en' },
        avatarUrl: null,
        provisioningMethod: 'local',
        roleId: null,
        roleName: null,
        roleDescription: null,
        roleIsSuperuser: null,
        roleIsSystem: null,
        permId: null,
        permName: null,
      },
    ]);
    const join4 = jest.fn().mockReturnValue({ where });
    const join3 = jest.fn().mockReturnValue({ leftJoin: join4 });
    const join2 = jest.fn().mockReturnValue({ leftJoin: join3 });
    const join1 = jest.fn().mockReturnValue({ leftJoin: join2 });
    const from = jest.fn().mockReturnValue({ leftJoin: join1 });
    select.mockReturnValue({ from });

    const user = await repo.findByIdWithRolesAndPermissions(3);

    expect(user).toMatchObject({
      id: 3,
      username: 'sam',
      roles: [
        {
          id: 1,
          name: 'admin',
          permissions: [{ id: 10, name: 'books.read' }],
        },
        {
          id: 2,
          name: 'editor',
          permissions: [],
        },
      ],
    });
  });

  it('update merges partial settings into jsonb and always bumps updatedAt', async () => {
    await repo.update(10, { settings: { theme: 'dark' } });

    expect(db.update).toHaveBeenCalledWith(schema.users);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: expect.any(Date), settings: expect.objectContaining({ op: 'sql' }) }),
    );
    expect(mockSql).toHaveBeenCalled();
  });

  it('update omits settings merge sql when settings are not provided', async () => {
    await repo.update(10, { name: 'New Name' });

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: expect.any(Date), name: 'New Name' }));
    expect(updateSet.mock.calls[0][0]).not.toHaveProperty('settings');
  });

  it('countOtherSuperusers normalizes db count values to a number', async () => {
    const where = jest.fn().mockResolvedValue([{ total: '3' }]);
    const innerJoin = jest.fn().mockReturnValue({ where });
    const from = jest.fn().mockReturnValue({ innerJoin });
    select.mockReturnValue({ from });

    await expect(repo.countOtherSuperusers(7)).resolves.toBe(3);
  });

  it('generateResetToken revokes previous active tokens and inserts a new hashed token in one transaction', async () => {
    const tx = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue(undefined),
    };

    db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<void>) => cb(tx));
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01T00:00:00.000Z').getTime());

    const token = await repo.generateResetToken(22);

    expect(token).toBe('abcd');
    expect(tx.update).toHaveBeenCalledWith(schema.passwordResetTokens);
    expect(tx.insert).toHaveBeenCalledWith(schema.passwordResetTokens);
    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 22, tokenHash: 'token-hash', expiresAt: new Date('2026-01-01T00:15:00.000Z') }),
    );
  });

  it('linkOidcIdentity updates subject and issuer without overwriting avatar when omitted', async () => {
    await repo.linkOidcIdentity(5, 'sub-1', 'issuer-1');

    expect(updateSet).toHaveBeenCalledWith({ oidcSubject: 'sub-1', oidcIssuer: 'issuer-1' });
  });

  it('createOidcUser stores OIDC identity and generated password hash', async () => {
    await repo.createOidcUser({
      username: 'oidc-user',
      name: 'OIDC User',
      email: 'oidc@example.com',
      oidcSubject: 'sub',
      oidcIssuer: 'iss',
      avatarUrl: 'https://img',
    });

    expect(mockHash).toHaveBeenCalledWith(expect.stringContaining('OIDC_USER_oidc-uuid'), 12);
    expect(db.insert).toHaveBeenCalledWith(schema.users);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'oidc-user',
        name: 'OIDC User',
        email: 'oidc@example.com',
        oidcSubject: 'sub',
        oidcIssuer: 'iss',
        avatarUrl: 'https://img',
        provisioningMethod: 'oidc',
        passwordHash: 'oidc-password-hash',
        isDefaultPassword: false,
      }),
    );
  });
});
