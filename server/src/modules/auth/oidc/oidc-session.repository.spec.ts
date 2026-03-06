jest.mock('drizzle-orm', () => ({
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
}));

import { and, eq } from 'drizzle-orm';

import * as schema from '../../../db/schema';
import { OidcSessionRepository } from './oidc-session.repository';

describe('OidcSessionRepository', () => {
  const makeDb = () => {
    const findFirst = jest.fn();
    const findMany = jest.fn();

    const insertReturning = jest.fn().mockResolvedValue([]);
    const insertValues = jest.fn().mockReturnValue({ returning: insertReturning });
    const insert = jest.fn().mockReturnValue({ values: insertValues });

    const updateWhere = jest.fn().mockResolvedValue(undefined);
    const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
    const update = jest.fn().mockReturnValue({ set: updateSet });

    return {
      db: {
        insert,
        update,
        query: {
          oidcSessions: {
            findFirst,
            findMany,
          },
        },
      },
      findFirst,
      findMany,
      insert,
      insertValues,
      insertReturning,
      update,
      updateSet,
      updateWhere,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates an OIDC session and returns the inserted row', async () => {
    const { db, insert, insertValues, insertReturning } = makeDb();
    const repository = new OidcSessionRepository(db as never);
    const payload = { userId: 2, oidcSubject: 'sub', oidcIssuer: 'issuer', oidcSessionId: 'sid-1' };
    const created = { id: 7, ...payload };

    insertReturning.mockResolvedValue([created]);

    await expect(repository.create(payload as never)).resolves.toEqual(created);
    expect(insert).toHaveBeenCalledWith(schema.oidcSessions);
    expect(insertValues).toHaveBeenCalledWith(payload);
    expect(insertReturning).toHaveBeenCalledTimes(1);
  });

  it('finds an active session by sid and always filters out revoked rows', async () => {
    const { db, findFirst } = makeDb();
    const repository = new OidcSessionRepository(db as never);

    await repository.findActiveBySid('sid-123');

    expect(eq).toHaveBeenCalledWith(schema.oidcSessions.oidcSessionId, 'sid-123');
    expect(eq).toHaveBeenCalledWith(schema.oidcSessions.revoked, false);
    expect(and).toHaveBeenCalledWith(
      { op: 'eq', left: schema.oidcSessions.oidcSessionId, right: 'sid-123' },
      { op: 'eq', left: schema.oidcSessions.revoked, right: false },
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        op: 'and',
        clauses: [
          { op: 'eq', left: schema.oidcSessions.oidcSessionId, right: 'sid-123' },
          { op: 'eq', left: schema.oidcSessions.revoked, right: false },
        ],
      },
    });
  });

  it('finds active sessions by subject + issuer for backchannel logout fan-out', async () => {
    const { db, findMany } = makeDb();
    const repository = new OidcSessionRepository(db as never);

    await repository.findActiveBySubjectAndIssuer('subject-a', 'https://issuer.example');

    expect(findMany).toHaveBeenCalledWith({
      where: {
        op: 'and',
        clauses: [
          { op: 'eq', left: schema.oidcSessions.oidcSubject, right: 'subject-a' },
          { op: 'eq', left: schema.oidcSessions.oidcIssuer, right: 'https://issuer.example' },
          { op: 'eq', left: schema.oidcSessions.revoked, right: false },
        ],
      },
    });
  });

  it('finds latest active session by user id using descending createdAt ordering', async () => {
    const { db, findFirst } = makeDb();
    const repository = new OidcSessionRepository(db as never);

    await repository.findActiveByUserId(42);

    const [query] = findFirst.mock.calls[0];
    expect(query.where).toEqual({
      op: 'and',
      clauses: [
        { op: 'eq', left: schema.oidcSessions.userId, right: 42 },
        { op: 'eq', left: schema.oidcSessions.revoked, right: false },
      ],
    });

    const desc = jest.fn((value: unknown) => `desc:${String(value)}`);
    const ordering = query.orderBy({ createdAt: 'created_at_column' }, { desc });
    expect(desc).toHaveBeenCalledWith('created_at_column');
    expect(ordering).toEqual(['desc:created_at_column']);
  });

  it('revokes sessions by sid, by subject+issuer, and by user id', async () => {
    const { db, update, updateSet, updateWhere } = makeDb();
    const repository = new OidcSessionRepository(db as never);

    await repository.revokeBySid('sid-x');
    await repository.revokeBySubjectAndIssuer('sub-x', 'issuer-x');
    await repository.revokeByUserId(91);

    expect(update).toHaveBeenNthCalledWith(1, schema.oidcSessions);
    expect(update).toHaveBeenNthCalledWith(2, schema.oidcSessions);
    expect(update).toHaveBeenNthCalledWith(3, schema.oidcSessions);
    expect(updateSet).toHaveBeenNthCalledWith(1, { revoked: true });
    expect(updateSet).toHaveBeenNthCalledWith(2, { revoked: true });
    expect(updateSet).toHaveBeenNthCalledWith(3, { revoked: true });
    expect(updateWhere).toHaveBeenNthCalledWith(1, { op: 'eq', left: schema.oidcSessions.oidcSessionId, right: 'sid-x' });
    expect(updateWhere).toHaveBeenNthCalledWith(2, {
      op: 'and',
      clauses: [
        { op: 'eq', left: schema.oidcSessions.oidcSubject, right: 'sub-x' },
        { op: 'eq', left: schema.oidcSessions.oidcIssuer, right: 'issuer-x' },
      ],
    });
    expect(updateWhere).toHaveBeenNthCalledWith(3, { op: 'eq', left: schema.oidcSessions.userId, right: 91 });
  });
});
