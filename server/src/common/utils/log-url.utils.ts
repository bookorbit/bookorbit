const SENSITIVE_QUERY_KEYS = new Set(['ticket', 'token', 't']);

/**
 * Replaces credential-bearing query values before a URL reaches a log line or an error body.
 * `ticket` grants podcast audio access and `t`/`token` grant OPDS image access, so neither may be
 * written to disk where the rest of the request line is already recorded.
 */
export function redactUrlCredentials(url: string): string {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return url;
  const path = url.slice(0, queryIndex);
  const query = url.slice(queryIndex + 1);
  const redacted = query
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=');
      if (separator === -1) return pair;
      const key = pair.slice(0, separator);
      return SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? `${key}=[REDACTED]` : pair;
    })
    .join('&');
  return `${path}?${redacted}`;
}
