import { describe, expect, it } from 'vitest';

import { parseConnectionConfig, PASSWORD_REDACTED_SENTINEL } from './connection-config';

describe('parseConnectionConfig', () => {
  it('parses booklore config via parseBookloreConnectionConfig', () => {
    const config = parseConnectionConfig('booklore', {
      host: 'db.example.com',
      port: 3306,
      user: 'admin',
      password: 'secret',
      database: 'booklore',
    });
    expect(config).toMatchObject({
      host: 'db.example.com',
      port: 3306,
      user: 'admin',
      password: 'secret',
      database: 'booklore',
    });
  });

  it('returns asRecord for non-booklore types', () => {
    const raw = { host: 'localhost', token: 'abc' };
    const config = parseConnectionConfig('calibre', raw);
    expect(config).toEqual(raw);
  });

  it('returns empty object for non-booklore type with null raw', () => {
    const config = parseConnectionConfig('calibre', null);
    expect(config).toEqual({});
  });

  it('returns empty object for non-booklore type with array raw', () => {
    const config = parseConnectionConfig('calibre', [1, 2, 3]);
    expect(config).toEqual({});
  });
});

describe('PASSWORD_REDACTED_SENTINEL', () => {
  it('is defined as redaction mask', () => {
    expect(PASSWORD_REDACTED_SENTINEL).toBe('********');
  });
});
