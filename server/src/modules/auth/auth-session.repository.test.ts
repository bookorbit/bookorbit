import { Test } from '@nestjs/testing';
import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { AuthSessionRepository } from './auth-session.repository';

const now = new Date('2026-09-12T12:00:00Z');
const expiresAt = new Date(now.getTime() + 60_000);
const session = { id: 7, userId: 2, tokenVersion: 3, authenticationMethod: 'password', clientKind: 'native', revokedAt: null, expiresAt };
const token = {
  id: 10,
  sessionId: 7,
  userId: 2,
  tokenHash: 'old',
  authenticationMethod: 'password',
  revokedAt: null,
  rotatedAt: null,
  replacedByTokenHash: null,
  expiresAt,
};
const params = { sessionId: 7, userId: 2, tokenVersion: 3, tokenHashes: ['old', 'next', 'latest'], expiresAt, now, graceMs: 30_000 };

async function fixture(options: { session?: object | null; user?: object | null; tokens?: object[] } = {}) {
  const results = [
    options.user === null ? [] : [options.user ?? { active: true, tokenVersion: 3 }],
    options.session === null ? [] : [options.session ?? session],
    options.tokens ?? [token],
  ];
  const writes: { table: unknown; value: unknown }[] = [];
  const tx = {
    select: vi.fn(() => {
      const result = results.shift();
      const query = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        for: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    }),
    update: vi.fn((table: unknown) => ({
      set: (value: unknown) => {
        writes.push({ table, value });
        return { where: vi.fn().mockResolvedValue({ rowCount: 1 }) };
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: (value: object) => {
        writes.push({ table, value });
        return { returning: vi.fn().mockResolvedValue([{ id: 11, ...value }]) };
      },
    })),
  };
  const db = { transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => Promise.resolve(callback(tx))) };
  const module = await Test.createTestingModule({ providers: [AuthSessionRepository, { provide: DB, useValue: db }] }).compile();
  return { repository: module.get(AuthSessionRepository), tx, writes };
}

describe('AuthSessionRepository refresh transactions', () => {
  it('rotates once, keeps the session identity, and updates only the related OIDC lifetime', async () => {
    const { repository, writes } = await fixture();
    const result = await repository.exchange(params);
    expect(result).toMatchObject({ session: { id: 7 }, refresh: { tokenHash: 'next', sessionId: 7 }, tokenIndex: 1 });
    expect(writes).toContainEqual({ table: schema.refreshTokens, value: { revokedAt: now, rotatedAt: now, replacedByTokenHash: 'next' } });
    expect(writes).toContainEqual({ table: schema.authSessions, value: { expiresAt } });
    expect(writes).toContainEqual({ table: schema.users, value: expect.objectContaining({ lastAuthenticatedAt: now }) });
  });

  it('recovers an already committed replacement without another write', async () => {
    const { repository, writes } = await fixture({
      tokens: [
        { ...token, revokedAt: now, rotatedAt: now, replacedByTokenHash: 'next' },
        { ...token, id: 11, tokenHash: 'next' },
      ],
    });
    expect(await repository.exchange(params)).toMatchObject({ tokenIndex: 1, refresh: { tokenHash: 'next' } });
    expect(writes).toEqual([]);
  });

  it('recovers a bounded chain after another caller has already rotated the replacement', async () => {
    const { repository, writes } = await fixture({
      tokens: [
        { ...token, revokedAt: now, rotatedAt: now, replacedByTokenHash: 'next' },
        { ...token, id: 11, tokenHash: 'next', revokedAt: now, rotatedAt: now, replacedByTokenHash: 'latest' },
        { ...token, id: 12, tokenHash: 'latest' },
      ],
    });
    expect(await repository.exchange(params)).toMatchObject({ tokenIndex: 2 });
    expect(writes).toEqual([]);
  });

  it.each([
    ['expired grace', { revokedAt: now, rotatedAt: new Date(now.getTime() - 30_001), replacedByTokenHash: 'next' }],
    ['explicit revocation', { revokedAt: now }],
    ['future rotation', { revokedAt: now, rotatedAt: new Date(now.getTime() + 1), replacedByTokenHash: 'next' }],
    ['broken successor', { revokedAt: now, rotatedAt: now, replacedByTokenHash: 'different' }],
  ])('revokes only the affected family after %s', async (_name, changes) => {
    const { repository, writes, tx } = await fixture({
      tokens: [
        { ...token, ...changes },
        { ...token, tokenHash: 'next' },
      ],
    });
    expect(await repository.exchange(params)).toBeNull();
    expect(writes).toContainEqual({ table: schema.authSessions, value: { revokedAt: now } });
    expect(tx.update).not.toHaveBeenCalledWith(schema.users);
  });

  it.each([
    { session: null },
    { session: { ...session, revokedAt: now } },
    { session: { ...session, expiresAt: now } },
    { session: { ...session, tokenVersion: 2 } },
    { user: null },
    { user: { active: false, tokenVersion: 3 } },
    { user: { active: true, tokenVersion: 4 } },
    { tokens: [] },
    { tokens: [{ ...token, expiresAt: now }] },
  ])('refuses an invalid session/account/token without minting or mutating credentials: %j', async (options) => {
    const { repository, writes } = await fixture(options);
    expect(await repository.exchange(params)).toBeNull();
    expect(writes).toEqual([]);
  });

  it('cannot recover through a successor explicitly revoked after rotation', async () => {
    const { repository, writes } = await fixture({
      tokens: [
        { ...token, revokedAt: now, rotatedAt: now, replacedByTokenHash: 'next' },
        { ...token, tokenHash: 'next', revokedAt: now },
      ],
    });
    expect(await repository.exchange(params)).toBeNull();
    expect(writes.some((write) => write.table === schema.users)).toBe(false);
  });
});
