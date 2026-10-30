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
  /**
   * Additional allowed redirect URIs - e.g. other hostnames a multi-origin deployment (LAN, VPN,
   * public) is reachable on, or an extra native scheme for a rebranded fork. http(s) entries
   * match by origin + pathname (same as the web callback above); everything else matches by
   * exact string (same as `nativeRedirectUri`, and for the same reason). Empty by default.
   */
  extraRedirectUris?: string[];
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

/**
 * Literal-prefix check, not `new URL(raw).protocol` - a lookalike scheme such as `httpfoo://`
 * would otherwise pass a `.startsWith('http')` check on the parsed protocol and get routed into
 * origin+pathname matching (which treats it as opaque - see the module-level comment) instead of
 * being compared as a custom scheme.
 */
function isWebRedirectUri(raw: string): boolean {
  return raw.startsWith('http://') || raw.startsWith('https://');
}

export function isAllowedRedirectUri(candidate: string, policy: RedirectUriPolicy): boolean {
  const webRedirectUri = `${policy.appUrl.replace(/\/$/, '')}/oauth2-callback`;
  if (normalizeWebRedirectUri(candidate) === normalizeWebRedirectUri(webRedirectUri)) return true;

  // Exact match, deliberately NOT normalized. The WHATWG URL parser reports an origin of the
  // literal string "null" with an empty pathname for every non-special scheme, so normalizing
  // would collapse `bookorbit://oauth2-callback` and `evil://anything` to the same value and
  // accept any private-use scheme an attacker supplied.
  if (candidate === policy.nativeRedirectUri) return true;

  return (policy.extraRedirectUris ?? []).some((entry) =>
    isWebRedirectUri(entry) ? normalizeWebRedirectUri(candidate) === normalizeWebRedirectUri(entry) : candidate === entry,
  );
}
