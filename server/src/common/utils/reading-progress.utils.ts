/** A reading progress snapshot from any source (in-app, audiobook, Kobo, etc.) */
export type ProgressCandidate = {
  percentage: number;
  updatedAt: Date;
};

/**
 * Extract the reading progress percentage from a Kobo bookmark JSON value.
 * Checks ProgressPercent first, then ContentSourceProgressPercent as a fallback.
 */
export function extractKoboProgressPercent(bookmark: unknown): number | null {
  if (!bookmark || typeof bookmark !== 'object') return null;
  const { ProgressPercent: progressPercent, ContentSourceProgressPercent: contentSourceProgressPercent } = bookmark as {
    ProgressPercent?: unknown;
    ContentSourceProgressPercent?: unknown;
  };
  const value = progressPercent ?? contentSourceProgressPercent;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

/**
 * Pick the most recently updated progress candidate.
 * Returns null when all candidates are null.
 */
export function latestProgressCandidate(...candidates: Array<ProgressCandidate | null>): ProgressCandidate | null {
  return candidates.reduce<ProgressCandidate | null>((best, candidate) => {
    if (!candidate) return best;
    if (!best || candidate.updatedAt >= best.updatedAt) return candidate;
    return best;
  }, null);
}
