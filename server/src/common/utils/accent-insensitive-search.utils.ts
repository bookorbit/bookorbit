import { SQL, SQLWrapper, sql } from 'drizzle-orm';

export function accentInsensitiveIlike(value: SQLWrapper, pattern: string): SQL {
  return sql`public.bookorbit_unaccent(${value}) ILIKE public.bookorbit_unaccent(${pattern})`;
}
