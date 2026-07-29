import { describe, expect, it } from 'vitest';

import { createPostgresClientConfig } from './postgres-connection-config';

describe('createPostgresClientConfig', () => {
  it('provides an IP connection host to TLS certificate validation', () => {
    const config = createPostgresClientConfig('postgres://bookorbit:secret@203.0.113.7:5432/bookorbit?sslmode=verify-full');

    expect(config.host).toBe('203.0.113.7');
    expect(config.ssl).toEqual({ host: '203.0.113.7' });
  });

  it('preserves explicit TLS and pool options while adding the validation host', () => {
    const config = createPostgresClientConfig('postgres://bookorbit:secret@db.example.test:5432/bookorbit', {
      connectionTimeoutMillis: 5_000,
      ssl: {
        ca: 'test-ca',
        servername: 'certificate.example.test',
      },
    });

    expect(config.connectionTimeoutMillis).toBe(5_000);
    expect(config.ssl).toEqual({
      ca: 'test-ca',
      host: 'db.example.test',
      servername: 'certificate.example.test',
    });
  });

  it('keeps connection-string settings authoritative over application defaults', () => {
    const config = createPostgresClientConfig('postgres://bookorbit:secret@db.example.test:5432/bookorbit?statement_timeout=9000', {
      statement_timeout: 30_000,
    });

    expect(config.statement_timeout).toBe('9000');
  });

  it('does not enable TLS when the connection string disables it', () => {
    const config = createPostgresClientConfig('postgres://bookorbit:secret@203.0.113.7:5432/bookorbit?sslmode=disable');

    expect(config.ssl).toBe(false);
  });

  it('preserves driver-specific string TLS settings', () => {
    const config = createPostgresClientConfig('postgres://bookorbit:secret@203.0.113.7:5432/bookorbit?ssl=no-verify');

    expect(config.ssl).toEqual({
      host: '203.0.113.7',
      rejectUnauthorized: false,
    });
  });
});
