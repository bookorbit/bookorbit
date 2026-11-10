/**
 * Rows for a multi-row insert into a table whose `name` is unique, sorted by that name.
 *
 * An insert that conflicts with a row another open transaction just inserted waits for that
 * transaction, row by row. Two books saved at once that list the same new names in different
 * orders (genres `[Fiction, Classics]` and `[Classics, Fiction]`) can each end up waiting on the
 * other, and Postgres aborts one of them as a deadlock. Inserting in one shared order rules that out.
 */
export function inNameOrder<T extends { name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
