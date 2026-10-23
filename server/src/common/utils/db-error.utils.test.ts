import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';

import { isUniqueViolation, queryFailureReason } from './db-error.utils';

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

describe('queryFailureReason', () => {
  const constraintMessage = 'new row for relation "user_book_status" violates check constraint "user_book_status_finished_after_started_chk"';

  function checkViolation(): DatabaseError {
    return Object.assign(new DatabaseError(constraintMessage, 0, 'error'), {
      code: '23514',
      constraint: 'user_book_status_finished_after_started_chk',
      detail: 'Failing row contains (1, 2159, read, manual, ...).',
    });
  }

  it("returns the driver's reason instead of the SQL and parameters Drizzle reports", () => {
    const error = new DrizzleQueryError('insert into "user_book_status" ("user_id", "status") values ($1, $2)', [1, 'read'], checkViolation());

    expect(error.message).toContain('params: 1,read');
    expect(queryFailureReason(error)).toBe(constraintMessage);
  });

  it('leaves the failing row out of the reason', () => {
    expect(queryFailureReason(new DrizzleQueryError('select 1', [], checkViolation()))).not.toContain('Failing row');
  });

  it('returns null when Drizzle has no driver error to report', () => {
    expect(queryFailureReason(new DrizzleQueryError('select 1', []))).toBeNull();
    expect(queryFailureReason(new DrizzleQueryError('select 1', [], new Error('')))).toBeNull();
  });

  it('returns null for errors that are not failed queries, whose own message already explains them', () => {
    expect(queryFailureReason(new Error('Audiobookshelf request failed', { cause: new Error('socket hang up') }))).toBeNull();
    expect(queryFailureReason(checkViolation())).toBeNull();
    expect(queryFailureReason('Failed query')).toBeNull();
    expect(queryFailureReason(null)).toBeNull();
  });
});
