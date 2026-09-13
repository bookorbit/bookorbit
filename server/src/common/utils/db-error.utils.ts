/**
 * Postgres error inspection that survives the ORM wrapper.
 *
 * Drizzle wraps every failed query in a `DrizzleQueryError` and hangs the driver's error off
 * `cause`, so a predicate that only reads `error.code` silently stops matching the moment a
 * query goes through Drizzle rather than the raw pool. That failure is invisible in tests that
 * reject with a hand-built `{ code }` object, and shows up in production as a 500 where a
 * translated conflict was expected. Both shapes are checked here so neither can regress.
 */

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) return true;

  return (error as { cause?: { code?: unknown } }).cause?.code === UNIQUE_VIOLATION;
}
