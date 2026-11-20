import { describe, expect, it } from 'vitest';

import { amazonRequestHeaders } from './amazon-http.utils';

describe('amazonRequestHeaders', () => {
  it('never sends a Referer header', () => {
    const headers = new Headers(amazonRequestHeaders('session-id=abc'));

    expect(headers.has('referer')).toBe(false);
  });

  it('sends the cookie only when one is configured', () => {
    expect(new Headers(amazonRequestHeaders('session-id=abc')).get('cookie')).toBe('session-id=abc');
    expect(new Headers(amazonRequestHeaders()).has('cookie')).toBe(false);
    expect(new Headers(amazonRequestHeaders('')).has('cookie')).toBe(false);
  });

  it('keeps the browser user agent', () => {
    expect(new Headers(amazonRequestHeaders()).get('user-agent')).toContain('Chrome/');
  });
});
