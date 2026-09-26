import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DB } from '../../../db/db.module';
import { OidcSessionRepository } from './oidc-session.repository';

async function fixture() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 2 });
  const db = drizzle({ client: { query } as never });
  const module = await Test.createTestingModule({ providers: [OidcSessionRepository, { provide: DB, useValue: db }] }).compile();
  return { repository: module.get(OidcSessionRepository), query };
}

describe('OIDC session repository', () => {
  it.each([{ sid: 'provider-session' }, { subject: 'subject' }])(
    'revokes application, refresh, and OIDC sessions in one transaction: %j',
    async (selector) => {
      const { repository, query } = await fixture();
      expect(await repository.revokeProviderSessions('https://issuer.example', selector)).toBe(2);
      const statements = query.mock.calls.map(([statement, values]) => ({
        text: typeof statement === 'string' ? statement : statement.text,
        values,
      }));
      expect(statements[0].text).toBe('begin');
      expect(statements.at(-1)?.text).toBe('commit');
      const updates = statements.filter((statement) => statement.text.startsWith('update'));
      expect(updates).toHaveLength(3);
      expect(updates[0].text).toContain('update "auth_sessions"');
      expect(updates[1].text).toContain('update "refresh_tokens"');
      expect(updates[2].text).toContain('update "oidc_sessions"');
      for (const update of updates) {
        expect(update.text).toContain('"oidc_sessions"."oidc_issuer" =');
        expect(update.values).toContain('https://issuer.example');
        expect(update.values).toContain('sid' in selector ? selector.sid : selector.subject);
        expect(update.text).not.toContain('update "users"');
      }
    },
  );

  it('rolls back if any part of session revocation fails', async () => {
    const { repository, query } = await fixture();
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [], rowCount: 2 }).mockRejectedValueOnce(new Error('database failure'));
    await expect(repository.revokeProviderSessions('https://issuer.example', { sid: 'sid' })).rejects.toThrow();
    const last = query.mock.calls.at(-1)?.[0];
    expect(typeof last === 'string' ? last : last.text).toBe('rollback');
  });
});
