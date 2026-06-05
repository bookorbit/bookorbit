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

export function filterGenresAgainstBlocklist(genres: readonly string[] | undefined, blockedTokens: ReadonlySet<string>): string[] {
  if (!genres?.length) return [];

  const filtered: string[] = [];
  for (const raw of genres) {
    const genre = raw.trim();
    if (!genre) continue;
    if (blockedTokens.has(genre.toLowerCase())) continue;
    filtered.push(genre);
  }
  return filtered;
}

export function filterCandidateGenresAgainstBlocklist<T extends { genres?: string[] }>(candidate: T, blockedTokens: ReadonlySet<string>): T {
  if (!candidate.genres?.length || blockedTokens.size === 0) return candidate;

  const filtered = filterGenresAgainstBlocklist(candidate.genres, blockedTokens);
  if (filtered.length === candidate.genres.length && filtered.every((genre, index) => genre === candidate.genres?.[index])) {
    return candidate;
  }

  return {
    ...candidate,
    genres: filtered.length ? filtered : undefined,
  };
}
