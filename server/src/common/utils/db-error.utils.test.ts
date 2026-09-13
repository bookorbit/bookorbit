import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from './db-error.utils';

describe('isUniqueViolation', () => {
  it('matches the driver error raised straight off the pool', () => {
    expect(isUniqueViolation(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(true);
  });

  it('matches the driver error Drizzle has wrapped', () => {
    // The shape a real query throws: DrizzleQueryError carries no code of its own and holds the
    // pg DatabaseError on `cause`. Reading only `error.code` here is what turned a 409 into a 500.
    const wrapped = new Error('Failed query', { cause: Object.assign(new Error('duplicate key'), { code: '23505' }) });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it('ignores other Postgres failures', () => {
    expect(isUniqueViolation(Object.assign(new Error('not null'), { code: '23502' }))).toBe(false);
    expect(isUniqueViolation(new Error('boom', { cause: { code: '23503' } }))).toBe(false);
  });

  it('ignores anything that is not an error object', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
