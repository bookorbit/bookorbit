import type { ReleaseCandidate, ResolvedIndexerConfig } from './indexer-adapter';

/** A details page is a short address. One longer than this is carrying something other than a page. */
export const MAX_RELEASE_INFO_URL_LENGTH = 2_048;

/** Below this a credential is too short to search a URL for without matching ordinary text. */
const MIN_SECRET_LENGTH = 6;

/**
 * Whether a query parameter name is one a credential travels under. Matched per word of the name,
 * so `jackett_apikey`, `api_key`, `torrent_pass` and `access_token` all fall to it while `author`
 * does not. Deliberately broad: a page link wrongly dropped costs the approver a search on the
 * tracker, while a key wrongly shown costs the account.
 */
function isSecretParamName(name: string): boolean {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => /key$|^pass|token$|^secret|^auth$|^sig(nature)?$/.test(word));
}

/**
 * The link a client may be shown for a release's page, or undefined where there is none it may.
 *
 * The value comes from a feed or a plugin nobody vets and lands in an `href`, so only http(s)
 * passes: anything else is either useless or `javascript:`. A link that could be carrying a
 * credential is dropped rather than cleaned. Rewriting one means knowing every tracker's
 * parameter names, and a key embedded in a path survives any rewrite; the indexer's own secrets
 * are matched anywhere in the address instead, which catches a key wherever it sits.
 */
export function safeReleaseInfoUrl(raw: string | undefined, secrets: readonly string[]): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.length > MAX_RELEASE_INFO_URL_LENGTH) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;
  for (const name of url.searchParams.keys()) {
    if (isSecretParamName(name)) return undefined;
  }

  const haystacks = [url.href, safeDecode(url.href)];
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH && haystacks.some((haystack) => haystack.includes(secret))) return undefined;
  }

  // Newznab points `comments` at the thread at the foot of the details page. The page itself,
  // with the description at the top, is what an approver opens it for.
  if (url.hash.toLowerCase() === '#comments') url.hash = '';
  return url.href;
}

/**
 * Every value the server holds for this indexer that must never reach a client: the stored
 * credential, and any key the operator pasted into the base URL's own query string, which some
 * proxies hand out as the endpoint to configure.
 */
export function indexerSecrets(config: Pick<ResolvedIndexerConfig, 'credential' | 'baseUrl'>): string[] {
  const secrets = config.credential ? [config.credential] : [];
  try {
    for (const [name, value] of new URL(config.baseUrl).searchParams) {
      if (value && isSecretParamName(name)) secrets.push(value);
    }
  } catch {
    // An unparseable base URL cannot have been searched, so it has nothing to leak.
  }
  return secrets;
}

/** The candidate with its page link vetted, or with no page link at all. */
export function withSafeInfoUrl(candidate: ReleaseCandidate, secrets: readonly string[]): ReleaseCandidate {
  if (candidate.infoUrl === undefined) return candidate;
  const infoUrl = safeReleaseInfoUrl(candidate.infoUrl, secrets);
  return infoUrl === candidate.infoUrl ? candidate : { ...candidate, infoUrl };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
