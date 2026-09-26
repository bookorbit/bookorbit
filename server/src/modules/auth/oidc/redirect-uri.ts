/**
 * Redirect URI allowlist shared by the OIDC callback and by RP-initiated logout.
 *
 * Lives outside both services because `OidcService` already depends on `AuthService`, so the
 * check cannot hang off either one without creating a cycle.
 */

export interface RedirectUriPolicy {
  /** Web client origin, e.g. `https://books.example.com`. Trailing slash already stripped. */
  appUrl: string;
  /** Private-use scheme the native clients hand to the IdP, e.g. `bookorbit://oauth2-callback`. */
  nativeRedirectUri: string;
}

/**
 * Compares only origin plus path, so a differing query or fragment on the web callback does not
 * reject an otherwise legitimate redirect.
 *
 * Only ever applied to http(s) URIs. See `isAllowedRedirectUri` for why.
 */
function normalizeWebRedirectUri(raw: string): string {
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw;
  }
}

export function isAllowedRedirectUri(candidate: string, policy: RedirectUriPolicy): boolean {
  const webRedirectUri = `${policy.appUrl.replace(/\/$/, '')}/oauth2-callback`;
  if (normalizeWebRedirectUri(candidate) === normalizeWebRedirectUri(webRedirectUri)) return true;

  // Exact match, deliberately NOT normalized. The WHATWG URL parser reports an origin of the
  // literal string "null" with an empty pathname for every non-special scheme, so normalizing
  // would collapse `bookorbit://oauth2-callback` and `evil://anything` to the same value and
  // accept any private-use scheme an attacker supplied.
  return candidate === policy.nativeRedirectUri;
}
