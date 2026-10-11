const LOCALE_COOKIE_NAMES = new Set(['lc-main', 'i18n-prefs']);
const LOCALE_COOKIE_PREFIX = 'lc-acb';

/**
 * The cookies that pick the language and currency Amazon renders its pages in. Everything else in a
 * pasted cookie string is session state or credentials, which must never reach a cache fingerprint.
 */
export function amazonLocaleCookies(cookie: string | undefined): Record<string, string> {
  const locale: Record<string, string> = {};
  if (!cookie) return locale;
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!LOCALE_COOKIE_NAMES.has(name) && !name.startsWith(LOCALE_COOKIE_PREFIX)) continue;
    locale[name] = part.slice(separator + 1).trim();
  }
  return locale;
}
