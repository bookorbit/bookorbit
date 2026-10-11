import { describe, expect, it } from 'vitest';

import { amazonLocaleCookies } from './amazon-locale-cookies';

describe('amazonLocaleCookies', () => {
  it('keeps only the cookies that choose language and currency', () => {
    const cookie = 'session-id=123-456; session-token="abc=def"; ubid-main=789; lc-main=en_GB; i18n-prefs=GBP; lc-acbuk=en_GB; x-main=secret';

    expect(amazonLocaleCookies(cookie)).toEqual({ 'lc-main': 'en_GB', 'i18n-prefs': 'GBP', 'lc-acbuk': 'en_GB' });
  });

  it('returns nothing for an empty or malformed cookie string', () => {
    expect(amazonLocaleCookies('')).toEqual({});
    expect(amazonLocaleCookies(undefined)).toEqual({});
    expect(amazonLocaleCookies('lc-main; =en_US; ;')).toEqual({});
  });
});
