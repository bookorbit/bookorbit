/**
 * Postgres error inspection that survives the ORM wrapper.
 *
 * Drizzle wraps every failed query in a `DrizzleQueryError` and hangs the driver's error off
 * `cause`, so a predicate that only reads `error.code` silently stops matching the moment a
 * query goes through Drizzle rather than the raw pool. That failure is invisible in tests that
 * reject with a hand-built `{ code }` object, and shows up in production as a 500 where a
 * translated conflict was expected. Both shapes are checked here so neither can regress.
 */

import { DrizzleQueryError } from 'drizzle-orm';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) return true;

  return (error as { cause?: { code?: unknown } }).cause?.code === UNIQUE_VIOLATION;
}

/**
 * The driver's reason for a failed query, such as the constraint it violated. A
 * `DrizzleQueryError` message is only the SQL and its bound parameters, which reads as if a row
 * value were the problem; null for anything else, whose own message already says what happened.
 */
export function queryFailureReason(error: unknown): string | null {
  if (!(error instanceof DrizzleQueryError)) return null;
  return error.cause?.message || null;
}
