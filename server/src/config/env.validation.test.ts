import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateEnv } from './env.validation';

const BASE_ENV = {
  NODE_ENV: 'development',
  JWT_SECRET: '1234567890abcdef',
};

describe('validateEnv', () => {
  it('allows HOST to remain unset', () => {
    expect(validateEnv(BASE_ENV).HOST).toBeUndefined();
  });

  it.each(['', '   ', '0.0.0.0', '127.0.0.1', '192.0.2.10', '::', '::1', '2001:db8::1', ' 127.0.0.1 '])('accepts bind address %j', (HOST) => {
    expect(validateEnv({ ...BASE_ENV, HOST }).HOST).toBe(HOST.trim());
  });

  it.each(['localhost', 'https://127.0.0.1', '127.0.0.1:3000', '[::1]', '256.0.0.1', '127.0.0.1/8', '127. 0.0.1'])(
    'rejects invalid bind address %j',
    (HOST) => {
      expect(() => validateEnv({ ...BASE_ENV, HOST })).toThrow('HOST must be an IPv4 or IPv6 address without a port or brackets');
    },
  );

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

  const PRODUCTION_ENV = {
    ...BASE_ENV,
    NODE_ENV: 'production',
    SETUP_BOOTSTRAP_TOKEN: '1234567890abcdef',
  };

  it('ignores variables it does not know, so a deployment still setting a retired one boots', () => {
    expect(() => validateEnv({ ...PRODUCTION_ENV, RETIRED_SETTING: 'value' })).not.toThrow();
  });

  it('accepts the provider directory URL only as https or off', () => {
    for (const value of ['', 'off', 'OFF', 'https://example.com/directory.json']) {
      expect(() => validateEnv({ ...BASE_ENV, METADATA_PROVIDER_DIRECTORY_URL: value })).not.toThrow();
    }
    expect(() => validateEnv({ ...BASE_ENV, METADATA_PROVIDER_DIRECTORY_URL: 'http://example.com/directory.json' })).toThrow(
      'METADATA_PROVIDER_DIRECTORY_URL',
    );
  });

  describe('read-aloud worker settings', () => {
    const TOKEN = '1234567890abcdef';

    it.each([undefined, '', '   '])('treats a worker token of %j as unset, as compose passes it to installs that have not opted in', (token) => {
      expect(() => validateEnv({ ...BASE_ENV, READ_ALOUD_WORKER_TOKEN: token, READ_ALOUD_WORKER_URL: '' })).not.toThrow();
      expect(() => validateEnv({ ...PRODUCTION_ENV, READ_ALOUD_WORKER_TOKEN: token, READ_ALOUD_WORKER_URL: '' })).not.toThrow();
    });

    it('accepts a configured worker URL with a long enough token', () => {
      expect(() =>
        validateEnv({
          ...BASE_ENV,
          READ_ALOUD_WORKER_URL: 'http://read-aloud-worker:8787',
          READ_ALOUD_WORKER_TOKEN: TOKEN,
          READ_ALOUD_MAX_OUTPUT_BYTES: String(100 * 1024 * 1024 * 1024),
          READ_ALOUD_WORKER_REQUEST_TIMEOUT_MS: String(5 * 60_000),
        }),
      ).not.toThrow();
    });

    it.each(['short', '  0123456789abcde  '])('rejects a non-empty token shorter than 16 characters: %j', (token) => {
      expect(() => validateEnv({ ...BASE_ENV, READ_ALOUD_WORKER_TOKEN: token })).toThrow(
        'READ_ALOUD_WORKER_TOKEN must contain at least 16 characters',
      );
    });

    it.each([undefined, '', '   '])('requires a token once the worker URL is set, even when the token is %j', (token) => {
      expect(() => validateEnv({ ...BASE_ENV, READ_ALOUD_WORKER_URL: 'http://read-aloud-worker:8787', READ_ALOUD_WORKER_TOKEN: token })).toThrow(
        'READ_ALOUD_WORKER_TOKEN is required when the worker URL is configured',
      );
    });

    it.each([
      ['READ_ALOUD_WORKER_URL', 'ftp://worker'],
      ['READ_ALOUD_MAX_OUTPUT_BYTES', String(100 * 1024 * 1024 * 1024 + 1)],
      ['READ_ALOUD_WORKER_REQUEST_TIMEOUT_MS', String(5 * 60_000 + 1)],
    ])('rejects an invalid %s setting', (name, value) => {
      expect(() => validateEnv({ ...BASE_ENV, READ_ALOUD_WORKER_TOKEN: TOKEN, [name]: value })).toThrow(name);
    });

    it('boots with every read-aloud default docker-compose.yml gives the app', () => {
      const compose = readFileSync(resolve(__dirname, '../../../docker-compose.yml'), 'utf8');
      const appStart = compose.indexOf('\n  app:\n');
      const nextService = compose.slice(appStart + 1).search(/\n {2}[a-z][\w-]*:\n/);
      const appService = compose.slice(appStart, nextService < 0 ? undefined : appStart + 1 + nextService);
      const defaults = [...appService.matchAll(/^\s+(READ_ALOUD_\w+): \$\{\1:-([^}]*)\}$/gm)].map(([, name, value]) => [name!, value!] as const);
      expect(defaults.map(([name]) => name)).toEqual(expect.arrayContaining(['READ_ALOUD_WORKER_URL', 'READ_ALOUD_WORKER_TOKEN']));

      const env = { ...PRODUCTION_ENV, ...Object.fromEntries(defaults) };
      expect(() => validateEnv(env)).not.toThrow();
    });
  });
});
