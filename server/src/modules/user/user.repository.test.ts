vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  count: vi.fn(() => ({ op: 'count' })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ op: 'inArray', left, right })),
  isNull: vi.fn((value: unknown) => ({ op: 'isNull', value })),
  ne: vi.fn((left: unknown, right: unknown) => ({ op: 'ne', left, right })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
    {
      raw: vi.fn((value: string) => ({ op: 'raw', value })),
    },
  ),
}));

vi.mock('crypto', () => ({
  createHash: vi.fn(),
  randomBytes: vi.fn(),
  randomUUID: vi.fn().mockReturnValue('oidc-uuid'),
}));

vi.mock('bcryptjs', () => ({ hash: vi.fn() }));

import { hash } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';

import * as schema from '../../db/schema';
import { UserRepository } from './user.repository';

const mockHash = hash as MockedFunction<typeof hash>;
const mockCreateHash = createHash as MockedFunction<typeof createHash>;
const mockRandomBytes = randomBytes as MockedFunction<typeof randomBytes>;
const mockRandomUUID = randomUUID as MockedFunction<typeof randomUUID>;
const mockSql = sql as vi.Mock;

describe('UserRepository', () => {
  const updateReturning = vi.fn();
  const updateWhere = vi.fn();
  const updateSet = vi.fn();
  const insertReturning = vi.fn();
  const insertValues = vi.fn();
  const select = vi.fn();

  const db = {
    select,
    update: vi.fn(() => ({ set: updateSet })),
    insert: vi.fn(() => ({ values: insertValues })),
    delete: vi.fn(),
    transaction: vi.fn(),
    query: {
      users: {
        findFirst: vi.fn(),
      },
    },
  };

  let repo: UserRepository;

  beforeEach(() => {
    vi.resetAllMocks();
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
    const hashState = { update: vi.fn().mockReturnThis(), digest: vi.fn().mockReturnValue('token-hash') };
    mockCreateHash.mockReturnValue(hashState as any);
    mockHash.mockResolvedValue('oidc-password-hash');
  });

  it('findAll returns normalized count and skips user query when no ids are on the page', async () => {
    const idOffset = vi.fn().mockResolvedValue([]);
    const idLimit = vi.fn().mockReturnValue({ offset: idOffset });
    const idOrderBy = vi.fn().mockReturnValue({ limit: idLimit });
    const idFrom = vi.fn().mockReturnValue({ orderBy: idOrderBy });

    const countFrom = vi.fn().mockResolvedValue([{ total: '7' }]);

    select.mockReturnValueOnce({ from: idFrom }).mockReturnValueOnce({ from: countFrom });

    const result = await repo.findAll(0, 25);

    expect(result).toEqual({ users: [], total: 7 });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('findAll preserves page order, aggregates permissions, and tolerates missing join rows', async () => {
    const idOffset = vi.fn().mockResolvedValue([{ id: 20 }, { id: 10 }]);
    const idLimit = vi.fn().mockReturnValue({ offset: idOffset });
    const idOrderBy = vi.fn().mockReturnValue({ limit: idLimit });
    const idFrom = vi.fn().mockReturnValue({ orderBy: idOrderBy });

    const countFrom = vi.fn().mockResolvedValue([{ total: 2 }]);

    const rowsOrderBy = vi.fn().mockResolvedValue([
      {
        id: 10,
        username: 'alice',
        name: 'Alice',
        email: null,
        active: true,
        isSuperuser: false,
        isDefaultPassword: false,
        provisioningMethod: 'local',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        permissionName: 'library_download',
      },
      {
        id: 10,
        username: 'alice',
        name: 'Alice',
        email: null,
        active: true,
        isSuperuser: false,
        isDefaultPassword: false,
        provisioningMethod: 'local',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        permissionName: 'kobo_sync',
      },
    ]);
    const rowsWhere = vi.fn().mockReturnValue({ orderBy: rowsOrderBy });
    const rowsJoin = vi.fn().mockReturnValue({ where: rowsWhere });
    const rowsFrom = vi.fn().mockReturnValue({ leftJoin: rowsJoin });

    select.mockReturnValueOnce({ from: idFrom }).mockReturnValueOnce({ from: countFrom }).mockReturnValueOnce({ from: rowsFrom });

    const result = await repo.findAll(0, 25);

    expect(result.total).toBe(2);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toMatchObject({
      id: 10,
      username: 'alice',
      provisioningMethod: 'local',
      permissions: ['library_download', 'kobo_sync'],
    });
  });

  it('findByIdWithPermissions returns null when user is missing', async () => {
    const where = vi.fn().mockResolvedValue([]);
    const join = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ leftJoin: join });
    select.mockReturnValue({ from });

    await expect(repo.findByIdWithPermissions(99)).resolves.toBeNull();
  });

  it('findByIdWithPermissions deduplicates permissions and ignores null rows', async () => {
    const where = vi.fn().mockResolvedValue([
      {
        id: 3,
        username: 'sam',
        name: 'Sam',
        email: 'sam@example.com',
        active: true,
        isSuperuser: false,
        isDefaultPassword: false,
        tokenVersion: 2,
        settings: { locale: 'en' },
        avatarUrl: null,
        provisioningMethod: 'local',
        permissionName: 'library_download',
      },
      {
        id: 3,
        username: 'sam',
        name: 'Sam',
        email: 'sam@example.com',
        active: true,
        isSuperuser: false,
        isDefaultPassword: false,
        tokenVersion: 2,
        settings: { locale: 'en' },
        avatarUrl: null,
        provisioningMethod: 'local',
        permissionName: 'library_download',
      },
      {
        id: 3,
        username: 'sam',
        name: 'Sam',
        email: 'sam@example.com',
        active: true,
        isSuperuser: false,
        isDefaultPassword: false,
        tokenVersion: 2,
        settings: { locale: 'en' },
        avatarUrl: null,
        provisioningMethod: 'local',
        permissionName: null,
      },
    ]);
    const join = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ leftJoin: join });
    select.mockReturnValue({ from });

    const user = await repo.findByIdWithPermissions(3);

    expect(user).toMatchObject({
      id: 3,
      username: 'sam',
      permissions: ['library_download'],
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
    const where = vi.fn().mockResolvedValue([{ total: '3' }]);
    const from = vi.fn().mockReturnValue({ where });
    select.mockReturnValue({ from });

    await expect(repo.countOtherSuperusers(7)).resolves.toBe(3);
  });

  it('findExistingLibraryIds returns known IDs only', async () => {
    const where = vi.fn().mockResolvedValue([{ id: 3 }, { id: 7 }]);
    const from = vi.fn().mockReturnValue({ where });
    select.mockReturnValue({ from });

    await expect(repo.findExistingLibraryIds([3, 7, 9])).resolves.toEqual([3, 7]);
  });

  it('generateResetToken revokes previous active tokens and inserts a new hashed token in one transaction', async () => {
    const tx = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };

    db.transaction.mockImplementation(async (cb: (tx: typeof tx) => Promise<void>) => cb(tx));
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01T00:00:00.000Z').getTime());

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
