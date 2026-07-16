import { installPostgresExtensions } from './postgres-extensions';

describe('installPostgresExtensions', () => {
  it('installs every extension required by application queries', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await installPostgresExtensions({ query });

    expect(query).toHaveBeenCalledTimes(1);
    const statement = query.mock.calls[0]?.[0] as string;
    expect(statement).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    expect(statement).toContain('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
    expect(statement).toContain('CREATE EXTENSION IF NOT EXISTS "unaccent"');
    expect(statement).toContain('CREATE EXTENSION IF NOT EXISTS "vector"');
    expect(statement).toContain('CREATE OR REPLACE FUNCTION public.bookorbit_unaccent(value text)');
    expect(statement).toContain("public.unaccent('public.unaccent', value)");
  });
});
