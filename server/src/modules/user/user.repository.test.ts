vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: vi.fn((value: unknown) => ({ op: 'asc', value })),
  count: vi.fn(() => ({ op: 'count' })),
  desc: vi.fn((value: unknown) => ({ op: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  ilike: vi.fn((left: unknown, right: unknown) => ({ op: 'ilike', left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ op: 'inArray', left, right })),
  isNull: vi.fn((value: unknown) => ({ op: 'isNull', value })),
  ne: vi.fn((left: unknown, right: unknown) => ({ op: 'ne', left, right })),
  or: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
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
import { eq, ilike, sql } from 'drizzle-orm';
import { Permission } from '@bookorbit/types';

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

    db.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    db.query.users.findFirst.mockResolvedValue(null);
  });

  it('findAll returns normalized count and skips user query when no ids are on the page', async () => {
    const idOffset = vi.fn().mockResolvedValue([]);
    const idLimit = vi.fn().mockReturnValue({ offset: idOffset });
    const idOrderBy = vi.fn().mockReturnValue({ limit: idLimit });
    const idWhere = vi.fn().mockReturnValue({ orderBy: idOrderBy });
    const idFrom = vi.fn().mockReturnValue({ where: idWhere });

    const countWhere = vi.fn().mockResolvedValue([{ total: '7' }]);
    const countFrom = vi.fn().mockReturnValue({ where: countWhere });

    select.mockReturnValueOnce({ from: idFrom }).mockReturnValueOnce({ from: countFrom });

    const result = await repo.findAll({ page: 0, pageSize: 25, sortBy: 'username', sortDir: 'asc' });

    expect(result).toEqual({ users: [], total: 7 });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('findAll preserves page order, aggregates permissions, and tolerates missing join rows', async () => {
    const idOffset = vi.fn().mockResolvedValue([{ id: 20 }, { id: 10 }]);
    const idLimit = vi.fn().mockReturnValue({ offset: idOffset });
    const idOrderBy = vi.fn().mockReturnValue({ limit: idLimit });
    const idWhere = vi.fn().mockReturnValue({ orderBy: idOrderBy });
    const idFrom = vi.fn().mockReturnValue({ where: idWhere });

    const countWhere = vi.fn().mockResolvedValue([{ total: 2 }]);
    const countFrom = vi.fn().mockReturnValue({ where: countWhere });

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

    const tagFilterWhere = vi.fn().mockResolvedValue([]);
    const tagFilterFrom = vi.fn().mockReturnValue({ where: tagFilterWhere });

    const genreFilterWhere = vi.fn().mockResolvedValue([]);
    const genreFilterFrom = vi.fn().mockReturnValue({ where: genreFilterWhere });

    const libraryAccessGroupBy = vi.fn().mockResolvedValue([{ userId: 10, granted: 3 }]);
    const libraryAccessWhere = vi.fn().mockReturnValue({ groupBy: libraryAccessGroupBy });
    const libraryAccessFrom = vi.fn().mockReturnValue({ where: libraryAccessWhere });

    select
      .mockReturnValueOnce({ from: idFrom })
      .mockReturnValueOnce({ from: countFrom })
      .mockReturnValueOnce({ from: rowsFrom })
      .mockReturnValueOnce({ from: tagFilterFrom })
      .mockReturnValueOnce({ from: genreFilterFrom })
      .mockReturnValueOnce({ from: libraryAccessFrom });

    const result = await repo.findAll({ page: 0, pageSize: 25, sortBy: 'username', sortDir: 'asc' });

    expect(result.total).toBe(2);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toMatchObject({
      id: 10,
      username: 'alice',
      provisioningMethod: 'local',
      permissions: ['library_download', 'kobo_sync'],
      libraryAccessCount: 3,
    });
  });

  it("summary counts every account regardless of the caller's filter", async () => {
    const summaryFrom = vi.fn().mockResolvedValue([{ total: 9, admins: 1, active: 8, inactive: 1, attention: 3 }]);
    select.mockReturnValueOnce({ from: summaryFrom });

    await expect(repo.summary()).resolves.toEqual({ total: 9, admins: 1, active: 8, inactive: 1, attention: 3 });
    expect(summaryFrom).toHaveBeenCalledWith(schema.users);
  });

  it('summary falls back to zeroes when the aggregate returns no row', async () => {
    select.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    await expect(repo.summary()).resolves.toEqual({ total: 0, admins: 0, active: 0, inactive: 0, attention: 0 });
  });

  it('findNeedingAttention ranks locked above never-signed-in above default-password', async () => {
    const later = new Date(Date.now() + 60 * 60_000);
    const rows = [
      {
        id: 1,
        username: 'tom',
        name: 'Tom',
        avatarUrl: null,
        provisioningMethod: 'local',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lockedUntil: later,
        isDefaultPassword: true,
        lastAuthenticatedAt: null,
      },
      {
        id: 2,
        username: 'jules',
        name: 'Jules',
        avatarUrl: null,
        provisioningMethod: 'local',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        lockedUntil: null,
        isDefaultPassword: true,
        lastAuthenticatedAt: null,
      },
      {
        id: 3,
        username: 'test1',
        name: 'test1',
        avatarUrl: null,
        provisioningMethod: 'local',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        lockedUntil: null,
        isDefaultPassword: true,
        lastAuthenticatedAt: new Date('2026-03-02T00:00:00.000Z'),
      },
    ];
    const rowsLimit = vi.fn().mockResolvedValue(rows);
    const rowsOrderBy = vi.fn().mockReturnValue({ limit: rowsLimit });
    const rowsWhere = vi.fn().mockReturnValue({ orderBy: rowsOrderBy });
    const rowsFrom = vi.fn().mockReturnValue({ where: rowsWhere });

    const tokenExpiry = new Date('2026-03-05T00:00:00.000Z');
    const tokenOrderBy = vi.fn().mockResolvedValue([
      { userId: 2, expiresAt: tokenExpiry },
      { userId: 2, expiresAt: new Date('2020-01-01T00:00:00.000Z') },
    ]);
    const tokenWhere = vi.fn().mockReturnValue({ orderBy: tokenOrderBy });
    const tokenFrom = vi.fn().mockReturnValue({ where: tokenWhere });

    select.mockReturnValueOnce({ from: rowsFrom }).mockReturnValueOnce({ from: tokenFrom });

    const result = await repo.findNeedingAttention(8);

    // an expired lock loses to nothing, but a live one outranks both other reasons
    expect(result.map((r) => [r.username, r.reason])).toEqual([
      ['tom', 'locked'],
      ['jules', 'neverSignedIn'],
      ['test1', 'defaultPassword'],
    ]);
    // only the newest unused link is reported, and only for the account that has one
    expect(result[1].resetLinkExpiresAt).toBe(tokenExpiry);
    expect(result[0].resetLinkExpiresAt).toBeNull();
    expect(rowsLimit).toHaveBeenCalledWith(8);
  });

  it('findNeedingAttention skips the reset-token lookup when nothing is flagged', async () => {
    const rowsLimit = vi.fn().mockResolvedValue([]);
    const rowsOrderBy = vi.fn().mockReturnValue({ limit: rowsLimit });
    const rowsWhere = vi.fn().mockReturnValue({ orderBy: rowsOrderBy });
    select.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: rowsWhere }) });

    await expect(repo.findNeedingAttention(8)).resolves.toEqual([]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('findAll filters by search across name, username and email and escapes wildcards', async () => {
    const idOffset = vi.fn().mockResolvedValue([]);
    const idLimit = vi.fn().mockReturnValue({ offset: idOffset });
    const idOrderBy = vi.fn().mockReturnValue({ limit: idLimit });
    const idWhere = vi.fn().mockReturnValue({ orderBy: idOrderBy });
    const idFrom = vi.fn().mockReturnValue({ where: idWhere });

    const countWhere = vi.fn().mockResolvedValue([{ total: 0 }]);
    const countFrom = vi.fn().mockReturnValue({ where: countWhere });

    select.mockReturnValueOnce({ from: idFrom }).mockReturnValueOnce({ from: countFrom });

    await repo.findAll({ page: 0, pageSize: 25, search: ' 50%_off ', sortBy: 'username', sortDir: 'asc' });

    const patterns = vi.mocked(ilike).mock.calls.map(([, pattern]) => pattern);
    expect(patterns).toEqual(['%50\\%\\_off%', '%50\\%\\_off%', '%50\\%\\_off%']);
    expect(vi.mocked(ilike).mock.calls.map(([column]) => column)).toEqual([schema.users.name, schema.users.username, schema.users.email]);
  });

  it('findAll narrows to administrators, active or inactive accounts by state', async () => {
    for (const [state, expected] of [
      ['admins', { column: schema.users.isSuperuser, value: true }],
      ['active', { column: schema.users.active, value: true }],
      ['inactive', { column: schema.users.active, value: false }],
    ] as const) {
      vi.mocked(eq).mockClear();
      const idOffset = vi.fn().mockResolvedValue([]);
      const idLimit = vi.fn().mockReturnValue({ offset: idOffset });
      const idOrderBy = vi.fn().mockReturnValue({ limit: idLimit });
      const idWhere = vi.fn().mockReturnValue({ orderBy: idOrderBy });
      const idFrom = vi.fn().mockReturnValue({ where: idWhere });
      const countWhere = vi.fn().mockResolvedValue([{ total: 0 }]);
      const countFrom = vi.fn().mockReturnValue({ where: countWhere });
      select.mockReturnValueOnce({ from: idFrom }).mockReturnValueOnce({ from: countFrom });

      await repo.findAll({ page: 0, pageSize: 25, state, sortBy: 'username', sortDir: 'asc' });

      expect(vi.mocked(eq)).toHaveBeenCalledWith(expected.column, expected.value);
    }
  });

  it('findByIdWithPermissions returns null when user is missing', async () => {
    const where = vi.fn().mockResolvedValue([]);
    const join = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ leftJoin: join });

    const filterWhere = vi.fn().mockResolvedValue([]);
    const filterFrom = vi.fn().mockReturnValue({ where: filterWhere });

    select.mockReturnValueOnce({ from }).mockReturnValueOnce({ from: filterFrom }).mockReturnValueOnce({ from: filterFrom });

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

    const filterWhere = vi.fn().mockResolvedValue([]);
    const filterFrom = vi.fn().mockReturnValue({ where: filterWhere });

    select.mockReturnValueOnce({ from }).mockReturnValueOnce({ from: filterFrom }).mockReturnValueOnce({ from: filterFrom });

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

  it('delete and setSuperuser issue scoped user updates', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    db.delete.mockReturnValue({ where: deleteWhere });

    await repo.delete(12);
    expect(db.delete).toHaveBeenCalledWith(schema.users);
    expect(deleteWhere).toHaveBeenCalledWith(expect.objectContaining({ op: 'eq', left: schema.users.id, right: 12 }));

    await repo.setSuperuser(12, true);
    expect(db.update).toHaveBeenCalledWith(schema.users);
    expect(updateSet).toHaveBeenCalledWith({ isSuperuser: true });
    expect(updateWhere).toHaveBeenCalledWith(expect.objectContaining({ op: 'eq', left: schema.users.id, right: 12 }));
  });

  it('clearLockout resets the attempt counter and the lock timestamp', async () => {
    await repo.clearLockout(12);

    expect(db.update).toHaveBeenCalledWith(schema.users);
    expect(updateSet).toHaveBeenCalledWith({ failedLoginAttempts: 0, lockedUntil: null });
    expect(updateWhere).toHaveBeenCalledWith(expect.objectContaining({ op: 'eq', left: schema.users.id, right: 12 }));
  });

  it('setPermissions replaces permission rows in one transaction', async () => {
    const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
    const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });
    const txInsertValues = vi.fn().mockResolvedValue(undefined);
    const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });

    db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) =>
      cb({
        delete: txDelete,
        insert: txInsert,
      }),
    );

    await repo.setPermissions(7, []);
    expect(txDelete).toHaveBeenCalledWith(schema.userPermissions);
    expect(txDeleteWhere).toHaveBeenCalledWith(expect.objectContaining({ op: 'eq', left: schema.userPermissions.userId, right: 7 }));
    expect(txInsert).not.toHaveBeenCalled();

    await repo.setPermissions(7, ['library_download' as never, 'kobo_sync' as never]);
    expect(txInsertValues).toHaveBeenCalledWith([
      { userId: 7, permissionName: 'library_download' },
      { userId: 7, permissionName: 'kobo_sync' },
    ]);
  });

  /**
   * Enforced here rather than in the service because this is the one line every assignment path
   * reaches, OIDC auto-provisioning included, and that path skips the service entirely.
   */
  it('setPermissions grants a permission that would otherwise be inert without its dependency', async () => {
    const txInsertValues = vi.fn().mockResolvedValue(undefined);
    db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) =>
      cb({
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        insert: vi.fn().mockReturnValue({ values: txInsertValues }),
      }),
    );

    await repo.setPermissions(7, [Permission.BookRequestSelfFulfill]);

    expect(txInsertValues).toHaveBeenCalledWith([
      { userId: 7, permissionName: Permission.BookRequestSelfFulfill },
      { userId: 7, permissionName: Permission.BookRequestAccess },
    ]);
  });

  /**
   * Moderating the queue is a superset of using it. Without this a `manage_book_requests` grant
   * produced an account the queue websocket rejected and the summary route answered 403 to.
   */
  it('setPermissions pulls book request access in behind the moderator and auto-approve grants', async () => {
    const txInsertValues = vi.fn().mockResolvedValue(undefined);
    db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) =>
      cb({
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        insert: vi.fn().mockReturnValue({ values: txInsertValues }),
      }),
    );

    await repo.setPermissions(7, [Permission.ManageBookRequests]);
    expect(txInsertValues).toHaveBeenCalledWith([
      { userId: 7, permissionName: Permission.ManageBookRequests },
      { userId: 7, permissionName: Permission.BookRequestAccess },
    ]);

    await repo.setPermissions(7, [Permission.BookRequestAutoApprove]);
    expect(txInsertValues).toHaveBeenLastCalledWith([
      { userId: 7, permissionName: Permission.BookRequestAutoApprove },
      { userId: 7, permissionName: Permission.BookRequestAccess },
    ]);
  });

  it('setPermissions does not duplicate a dependency that was already selected', async () => {
    const txInsertValues = vi.fn().mockResolvedValue(undefined);
    db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) =>
      cb({
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        insert: vi.fn().mockReturnValue({ values: txInsertValues }),
      }),
    );

    await repo.setPermissions(7, [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill]);

    expect(txInsertValues).toHaveBeenCalledWith([
      { userId: 7, permissionName: Permission.BookRequestAccess },
      { userId: 7, permissionName: Permission.BookRequestSelfFulfill },
    ]);
  });

  it('incrementTokenVersion updates with SQL expression', async () => {
    await repo.incrementTokenVersion(4);

    expect(db.update).toHaveBeenCalledWith(schema.users);
    expect(updateSet).toHaveBeenCalledWith({ tokenVersion: expect.objectContaining({ op: 'sql' }) });
    expect(updateWhere).toHaveBeenCalledWith(expect.objectContaining({ op: 'eq', left: schema.users.id, right: 4 }));
  });

  it('findByEmail and findByOidcSubject delegate to query helpers', async () => {
    await repo.findByEmail('alice@example.com');
    await repo.findByOidcSubject('sub', 'iss');

    expect(db.query.users.findFirst).toHaveBeenCalledTimes(2);
    expect(db.query.users.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ op: 'eq', left: schema.users.email, right: 'alice@example.com' }),
      }),
    );
    expect(db.query.users.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          op: 'and',
          clauses: [
            { op: 'eq', left: schema.users.oidcSubject, right: 'sub' },
            { op: 'eq', left: schema.users.oidcIssuer, right: 'iss' },
          ],
        }),
      }),
    );
  });

  it('findAvatarStateById selects avatar state columns only', async () => {
    await repo.findAvatarStateById(9);

    expect(db.query.users.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ op: 'eq', left: schema.users.id, right: 9 }),
      columns: {
        id: true,
        avatarUrl: true,
        avatarSource: true,
        avatarVersion: true,
      },
    });
  });

  it('setAvatarSourceAndBumpVersion updates avatar source and increments version', async () => {
    await repo.setAvatarSourceAndBumpVersion(3, 'uploaded');

    expect(db.update).toHaveBeenCalledWith(schema.users);
    expect(updateSet).toHaveBeenCalledWith({
      avatarSource: 'uploaded',
      avatarVersion: expect.objectContaining({ op: 'sql' }),
    });
    expect(updateWhere).toHaveBeenCalledWith(expect.objectContaining({ op: 'eq', left: schema.users.id, right: 3 }));
  });

  it('assignViewerLibraries short-circuits empty lists and inserts viewer rows for non-empty input', async () => {
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    db.insert.mockReturnValue({ values });

    await repo.assignViewerLibraries(5, []);
    expect(db.insert).not.toHaveBeenCalled();

    await repo.assignViewerLibraries(5, [1, 2]);
    expect(db.insert).toHaveBeenCalledWith(schema.userLibraryAccess);
    expect(values).toHaveBeenCalledWith([
      { userId: 5, libraryId: 1, accessLevel: 'viewer' },
      { userId: 5, libraryId: 2, accessLevel: 'viewer' },
    ]);
    expect(onConflictDoNothing).toHaveBeenCalled();
  });

  it('findLibraryIdsByUserId and replaceViewerLibraries manage user-library rows', async () => {
    const where = vi.fn().mockResolvedValue([{ libraryId: 10 }, { libraryId: 11 }]);
    const from = vi.fn().mockReturnValue({ where });
    select.mockReturnValue({ from });

    await expect(repo.findLibraryIdsByUserId(2)).resolves.toEqual([10, 11]);

    const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
    const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });
    const txInsertValues = vi.fn().mockResolvedValue(undefined);
    const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });
    db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) =>
      cb({
        delete: txDelete,
        insert: txInsert,
      }),
    );

    await repo.replaceViewerLibraries(2, []);
    expect(txDelete).toHaveBeenCalledWith(schema.userLibraryAccess);
    expect(txDeleteWhere).toHaveBeenCalledWith(expect.objectContaining({ op: 'eq', left: schema.userLibraryAccess.userId, right: 2 }));
    expect(txInsert).not.toHaveBeenCalled();

    await repo.replaceViewerLibraries(2, [10, 11]);
    expect(txInsertValues).toHaveBeenCalledWith([
      { userId: 2, libraryId: 10, accessLevel: 'viewer' },
      { userId: 2, libraryId: 11, accessLevel: 'viewer' },
    ]);
  });
});
