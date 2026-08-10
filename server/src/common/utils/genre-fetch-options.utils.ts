export function normalizeGenreBlocklist(value: unknown, fallback: readonly string[] = []): string[] {
  if (!Array.isArray(value)) return [...fallback];

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const token = trimmed.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    normalized.push(trimmed);
  }
  return normalized;
}

export function createGenreBlocklistTokenSet(blocklist: readonly string[] | undefined): Set<string> {
  return new Set(normalizeGenreBlocklist(blocklist).map((genre) => genre.toLowerCase()));
}

export function applyGenreFetchOptions(
  genres: readonly string[] | undefined,
  blockedTokens: ReadonlySet<string>,
  maxCount: number | null | undefined,
): string[] {
  if (!genres?.length) return [];

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const raw of genres) {
    const genre = raw.trim();
    const token = genre.toLowerCase();
    if (!genre || blockedTokens.has(token) || seen.has(token)) continue;

    seen.add(token);
    resolved.push(genre);
    if (maxCount !== null && maxCount !== undefined && resolved.length >= maxCount) break;
  }
  return resolved;
}

export function applyGenreFetchOptionsToCandidate<T extends { genres?: string[] }>(
  candidate: T,
  blockedTokens: ReadonlySet<string>,
  maxCount: number | null | undefined,
): T {
  if (!candidate.genres?.length) return candidate;

  const resolved = applyGenreFetchOptions(candidate.genres, blockedTokens, maxCount);
  if (resolved.length === candidate.genres.length && resolved.every((genre, index) => genre === candidate.genres?.[index])) {
    return candidate;
  }

  return {
    ...candidate,
    genres: resolved.length ? resolved : undefined,
  };
}
