type SqlExecutor = {
  query(sql: string): Promise<unknown>;
};

export async function installPostgresExtensions(executor: SqlExecutor): Promise<void> {
  await executor.query(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";
    CREATE EXTENSION IF NOT EXISTS "unaccent";
    CREATE EXTENSION IF NOT EXISTS "vector";

    CREATE OR REPLACE FUNCTION public.bookorbit_unaccent(value text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    STRICT
    AS $function$ SELECT public.unaccent('public.unaccent', value) $function$;
  `);
}
