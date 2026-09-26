import { describe, expect, it } from 'vitest';

import { redactUrlCredentials } from './log-url.utils';

describe('redactUrlCredentials', () => {
  it('leaves a url without a query string untouched', () => {
    expect(redactUrlCredentials('/api/v1/podcast-episodes/12/stream')).toBe('/api/v1/podcast-episodes/12/stream');
  });

  it('redacts a podcast stream ticket', () => {
    expect(redactUrlCredentials('/api/v1/podcast-episodes/12/stream?ticket=eyJhbGciOi.signed.value')).toBe(
      '/api/v1/podcast-episodes/12/stream?ticket=[REDACTED]',
    );
  });

  it('redacts opds image tokens and keeps other parameters', () => {
    expect(redactUrlCredentials('/api/v1/opds/9/cover?t=9.abcdef&width=300')).toBe('/api/v1/opds/9/cover?t=[REDACTED]&width=300');
  });

  it('matches sensitive keys case insensitively', () => {
    expect(redactUrlCredentials('/stream?Ticket=secret')).toBe('/stream?Ticket=[REDACTED]');
  });

  it('leaves valueless and unrelated parameters alone', () => {
    expect(redactUrlCredentials('/api/v1/books?flag&page=2')).toBe('/api/v1/books?flag&page=2');
  });
});
