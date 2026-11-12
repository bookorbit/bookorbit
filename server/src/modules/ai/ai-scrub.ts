const REDACTED = '[redacted]';
const MAX_SCRUBBED_LENGTH = 500;
/** Shorter values are too likely to match ordinary text, and too short to be a credential. */
const MIN_SECRET_LENGTH = 6;

const SECRET_SHAPES: RegExp[] = [
  /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(x-api-key|api-key|authorization|x-goog-api-key)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
];

/**
 * Removes stored secrets and anything shaped like a credential from text a provider sent back,
 * before it is logged, stored in a test result or shown. A provider that echoes the key in its
 * error must not get it onto the page or into the logs.
 */
export function scrubSecrets(text: string, secrets: Iterable<string | null | undefined> = []): string {
  let scrubbed = text;
  const known = [...secrets].filter((secret): secret is string => typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH);
  // Longest first, so a secret that contains another is removed whole.
  known.sort((a, b) => b.length - a.length);
  for (const secret of known) {
    scrubbed = scrubbed.split(secret).join(REDACTED);
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) scrubbed = scrubbed.split(encoded).join(REDACTED);
  }

  for (const shape of SECRET_SHAPES) {
    scrubbed = scrubbed.replace(shape, (match: string, label?: string, separator?: string) => {
      if (typeof label === 'string' && typeof separator === 'string') return `${label}${separator}${REDACTED}`;
      if (typeof label === 'string' && /^(bearer|basic)$/i.test(label)) return `${label} ${REDACTED}`;
      return match.length > 0 ? REDACTED : match;
    });
  }

  return scrubbed.length > MAX_SCRUBBED_LENGTH ? `${scrubbed.slice(0, MAX_SCRUBBED_LENGTH)}...` : scrubbed;
}
