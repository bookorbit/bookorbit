jest.mock('drizzle-orm', () => ({
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { eq, sql } from 'drizzle-orm';

import { emailPreferences } from '../../db/schema';
import { EmailPreferencesRepository } from './email-preferences.repository';

describe('EmailPreferencesRepository', () => {
  it('builds a single-row query by user id', () => {
    const queryResult = Promise.resolve([{ userId: 12 }]);
    const selectBuilder = {
      from: jest.fn(),
      where: jest.fn(),
      limit: jest.fn().mockReturnValue(queryResult),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    selectBuilder.where.mockReturnValue(selectBuilder);

    const db = { select: jest.fn().mockReturnValue(selectBuilder) };
    const repo = new EmailPreferencesRepository(db as never);

    const result = repo.findByUserId(12);

    expect(db.select).toHaveBeenCalled();
    expect(selectBuilder.from).toHaveBeenCalledWith(emailPreferences);
    expect(eq).toHaveBeenCalledWith(emailPreferences.userId, 12);
    expect(selectBuilder.where).toHaveBeenCalledWith({ op: 'eq', left: emailPreferences.userId, right: 12 });
    expect(selectBuilder.limit).toHaveBeenCalledWith(1);
    expect(result).toBe(queryResult);
  });

  it('upserts by user id and bumps updatedAt', () => {
    const returningResult = Promise.resolve([{ userId: 9, defaultProviderId: 88 }]);
    const conflictBuilder = {
      returning: jest.fn().mockReturnValue(returningResult),
    };
    const insertBuilder = {
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockReturnValue(conflictBuilder),
      }),
    };

    const db = { insert: jest.fn().mockReturnValue(insertBuilder) };
    const repo = new EmailPreferencesRepository(db as never);

    const result = repo.upsert(9, { defaultProviderId: 88 });

    expect(db.insert).toHaveBeenCalledWith(emailPreferences);
    expect(insertBuilder.values).toHaveBeenCalledWith({ userId: 9, defaultProviderId: 88 });

    const onConflictDoUpdate = insertBuilder.values.mock.results[0].value.onConflictDoUpdate as jest.Mock;
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflictArg = onConflictDoUpdate.mock.calls[0][0] as {
      target: unknown;
      set: Record<string, unknown>;
    };

    expect(conflictArg.target).toBe(emailPreferences.userId);
    expect(conflictArg.set.defaultProviderId).toBe(88);
    expect(conflictArg.set.updatedAt).toEqual(expect.objectContaining({ op: 'sql', text: 'now()' }));
    expect(sql).toHaveBeenCalled();
    expect(conflictBuilder.returning).toHaveBeenCalled();
    expect(result).toBe(returningResult);
  });
});
