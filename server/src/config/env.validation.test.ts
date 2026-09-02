import { validateEnv } from './env.validation';

const BASE_ENV = {
  NODE_ENV: 'development',
  JWT_SECRET: '1234567890abcdef',
};

describe('validateEnv', () => {
  it('accepts common postgres URL formats used by existing setups', () => {
    const urls = [
      'postgres://bookorbit:bookorbit@localhost:5432/bookorbit',
      'postgres://localhost',
      'postgresql://bookorbit:bookorbit@db.internal:5432/bookorbit?sslmode=require',
    ];

    for (const DATABASE_URL of urls) {
      expect(() =>
        validateEnv({
          ...BASE_ENV,
          DATABASE_URL,
        }),
      ).not.toThrow();
    }
  });

  it('accepts a postgres socket connection string with query host and no authority host', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        DATABASE_URL: 'postgres://bookorbit:testpw%40bookorbit@/bookorbit?host=/run/postgresql&port=5432',
      }),
    ).not.toThrow();
  });

  it('accepts a postgres connection string with localhost and query socket host', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        DATABASE_URL: 'postgres://bookorbit:testpw%40bookorbit@localhost/bookorbit?host=/run/postgresql&port=5432',
      }),
    ).not.toThrow();
  });

  it('rejects malformed postgres connection strings', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        DATABASE_URL: 'postgres://bookorbit@/bookorbit?host=/run/postgresql&port=abc',
      }),
    ).toThrow('DATABASE_URL must be a valid PostgreSQL connection string');
  });

  it('rejects non-postgres URLs', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        DATABASE_URL: 'https://example.com/database',
      }),
    ).toThrow('DATABASE_URL must be a valid PostgreSQL connection string');
  });

  it('accepts boolean-like values for OIDC_ALLOW_LOCAL_ISSUERS', () => {
    for (const OIDC_ALLOW_LOCAL_ISSUERS of ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off']) {
      expect(() =>
        validateEnv({
          ...BASE_ENV,
          OIDC_ALLOW_LOCAL_ISSUERS,
        }),
      ).not.toThrow();
    }
  });

  it('rejects invalid OIDC_ALLOW_LOCAL_ISSUERS values', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        OIDC_ALLOW_LOCAL_ISSUERS: 'maybe',
      }),
    ).toThrow('OIDC_ALLOW_LOCAL_ISSUERS must be one of true/false/1/0/yes/no/on/off');
  });

  it('accepts boolean-like values for DISABLE_LOCAL_AUTH', () => {
    for (const DISABLE_LOCAL_AUTH of ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off']) {
      expect(() => validateEnv({ ...BASE_ENV, DISABLE_LOCAL_AUTH })).not.toThrow();
    }
  });

  it('rejects invalid DISABLE_LOCAL_AUTH values', () => {
    expect(() => validateEnv({ ...BASE_ENV, DISABLE_LOCAL_AUTH: 'maybe' })).toThrow('DISABLE_LOCAL_AUTH must be one of true/false/1/0/yes/no/on/off');
  });

  it('accepts boolean-like values for SWAGGER_ENABLED', () => {
    for (const SWAGGER_ENABLED of ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off']) {
      expect(() =>
        validateEnv({
          ...BASE_ENV,
          SWAGGER_ENABLED,
        }),
      ).not.toThrow();
    }
  });

  it('rejects invalid SWAGGER_ENABLED values', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        SWAGGER_ENABLED: 'maybe',
      }),
    ).toThrow('SWAGGER_ENABLED must be one of true/false/1/0/yes/no/on/off');
  });

  it('accepts explicit trusted proxy addresses and boolean values', () => {
    for (const TRUST_PROXY of ['', 'true', 'false', 'yes', 'no', 'on', 'off', 'loopback,linklocal,uniquelocal', '127.0.0.1', '10.0.0.0/8']) {
      expect(() => validateEnv({ ...BASE_ENV, TRUST_PROXY })).not.toThrow();
    }
  });

  it.each(['0', '1', '2', '10', '1.5', '-1', '1e2'])('rejects numeric TRUST_PROXY hop count %s', (TRUST_PROXY) => {
    expect(() => validateEnv({ ...BASE_ENV, TRUST_PROXY })).toThrow(
      'TRUST_PROXY must be a boolean value or trusted proxy IP/CIDR; numeric hop counts are not supported',
    );
  });

  it('accepts a custom Book Dock container path', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        BOOK_DOCK_PATH: '/books/bookdrop',
      }),
    ).not.toThrow();
  });

  it('accepts an empty custom Book Dock container path as an unset override', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        BOOK_DOCK_PATH: '',
      }),
    ).not.toThrow();
  });

  it('accepts a custom library browse root path', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        LIBRARY_BROWSE_ROOT: '/books',
      }),
    ).not.toThrow();
  });

  it('accepts an empty library browse root as an unset override', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        LIBRARY_BROWSE_ROOT: '',
      }),
    ).not.toThrow();
  });

  it('accepts an absolute or empty migration import root', () => {
    expect(() => validateEnv({ ...BASE_ENV, MIGRATION_IMPORT_ROOT: '/imports' })).not.toThrow();
    expect(() => validateEnv({ ...BASE_ENV, MIGRATION_IMPORT_ROOT: '' })).not.toThrow();
  });

  it('rejects a relative migration import root', () => {
    expect(() => validateEnv({ ...BASE_ENV, MIGRATION_IMPORT_ROOT: './imports' })).toThrow('MIGRATION_IMPORT_ROOT must be an absolute path');
  });
});
