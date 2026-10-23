vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  ne: vi.fn((left: unknown, right: unknown) => ({ op: 'ne', left, right })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { and, eq } from 'drizzle-orm';

import { emailPreferences, emailProviders, emailRecipients, emailTemplates } from '../../db/schema';
import { EmailPreferencesRepository } from './email-preferences.repository';

describe('EmailPreferencesRepository', () => {
  it('builds a single-row query by user id', () => {
    const queryResult = Promise.resolve([{ userId: 12 }]);
    const selectBuilder = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockReturnValue(queryResult),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    selectBuilder.where.mockReturnValue(selectBuilder);

    const db = { select: vi.fn().mockReturnValue(selectBuilder) };
    const repo = new EmailPreferencesRepository(db as never);

    const result = repo.findByUserId(12);

    expect(db.select).toHaveBeenCalled();
    expect(selectBuilder.from).toHaveBeenCalledWith(emailPreferences);
    expect(eq).toHaveBeenCalledWith(emailPreferences.userId, 12);
    expect(selectBuilder.where).toHaveBeenCalledWith({ op: 'eq', left: emailPreferences.userId, right: 12 });
    expect(selectBuilder.limit).toHaveBeenCalledWith(1);
    expect(result).toBe(queryResult);
  });

  const makeTx = () => {
    const returningResult = Promise.resolve([{ userId: 9, defaultRecipientId: 5 }]);
    const conflict = { returning: vi.fn().mockReturnValue(returningResult) };
    const values = { onConflictDoUpdate: vi.fn().mockReturnValue(conflict) };
    const insert = { values: vi.fn().mockReturnValue(values) };
    const updates: Array<{ table: unknown; set: Record<string, unknown>; where: unknown }> = [];
    const tx = {
      insert: vi.fn().mockReturnValue(insert),
      update: vi.fn((table: unknown) => {
        const entry = { table, set: {}, where: undefined as unknown };
        updates.push(entry);
        const builder = {
          set: vi.fn((set: Record<string, unknown>) => {
            entry.set = set;
            return builder;
          }),
          where: vi.fn((where: unknown) => {
            entry.where = where;
            return Promise.resolve();
          }),
        };
        return builder;
      }),
    };
    const db = { transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { db, tx, insert, values, updates };
  };

  it('writes only the defaults it was given and moves only those flags', async () => {
    const { db, tx, insert, values, updates } = makeTx();
    const repo = new EmailPreferencesRepository(db as never);

    const row = await repo.setDefaults(9, { defaultRecipientId: 5 });

    expect(row).toEqual({ userId: 9, defaultRecipientId: 5 });
    expect(tx.insert).toHaveBeenCalledWith(emailPreferences);
    expect(insert.values).toHaveBeenCalledWith({ userId: 9, defaultRecipientId: 5 });
    const conflict = values.onConflictDoUpdate.mock.calls[0][0] as { target: unknown; set: Record<string, unknown> };
    expect(conflict.target).toBe(emailPreferences.userId);
    expect(conflict.set.defaultRecipientId).toBe(5);
    // Clear the others first, then set the chosen one: a single flipping UPDATE trips the
    // one-default-per-user unique index.
    expect(updates.map((u) => u.table)).toEqual([emailRecipients, emailRecipients]);
    expect(updates[0].set.isDefault).toBe(false);
    expect(updates[0].where).toEqual({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailRecipients.userId, right: 9 },
        { op: 'eq', left: emailRecipients.isDefault, right: true },
        { op: 'ne', left: emailRecipients.id, right: 5 },
      ],
    });
    expect(updates[1].set.isDefault).toBe(true);
    expect(updates[1].where).toEqual({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailRecipients.userId, right: 9 },
        { op: 'eq', left: emailRecipients.id, right: 5 },
      ],
    });
  });

  it("clears every flag of a kind when the default is cleared or not the caller's own row", async () => {
    const { db, updates } = makeTx();
    const repo = new EmailPreferencesRepository(db as never);

    await repo.setDefaults(9, { defaultProviderId: null, defaultTemplateId: 31 });

    expect(updates.map((u) => u.table)).toEqual([emailProviders, emailTemplates, emailTemplates]);
    expect(updates[0].set.isDefault).toBe(false);
    expect(updates[0].where).toEqual({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailProviders.userId, right: 9 },
        { op: 'eq', left: emailProviders.isDefault, right: true },
      ],
    });
    expect(updates[2].set.isDefault).toBe(true);
    expect(updates[2].where).toEqual({
      op: 'and',
      clauses: [
        { op: 'eq', left: emailTemplates.userId, right: 9 },
        { op: 'eq', left: emailTemplates.id, right: 31 },
      ],
    });
  });

  it('reads the rows still flagged isDefault, one per kind, for the owner', async () => {
    const limits: unknown[] = [];
    const rows = [[{ id: 4 }], [], [{ id: 31 }]];
    const db = {
      select: vi.fn(() => {
        const builder = {
          from: vi.fn(() => builder),
          where: vi.fn(() => builder),
          limit: vi.fn((n: unknown) => {
            limits.push(n);
            return Promise.resolve(rows[limits.length - 1]);
          }),
        };
        return builder;
      }),
    };
    const repo = new EmailPreferencesRepository(db as never);

    expect(await repo.findFlaggedDefaults(9)).toEqual({ providerId: 4, recipientId: null, templateId: 31 });
    expect(and).toHaveBeenCalledWith({ op: 'eq', left: emailProviders.userId, right: 9 }, { op: 'eq', left: emailProviders.isDefault, right: true });
    expect(limits).toEqual([1, 1, 1]);
  });
});
