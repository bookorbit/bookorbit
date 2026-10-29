import { normalizeMetadataTextKey } from './metadata-text-normalize.utils';

const RUN_YEAR_SUFFIX = /^(.*\S)\s*\(((?:19|20)\d{2})\)$/u;

export interface SeriesRunYear {
  base: string;
  year: number;
}

/**
 * Comic runs that share a title are told apart by the year the run started, written the way
 * Mylar, Komga and Kavita name series folders: "Batman (2016)". Returns null for a name without it.
 */
export function splitSeriesRunYear(name: string | null | undefined): SeriesRunYear | null {
  const match = name ? RUN_YEAR_SUFFIX.exec(name.trim()) : null;
  if (!match) return null;
  return { base: match[1], year: Number(match[2]) };
}

/**
 * True when `qualified` is `bare` plus a run year, so replacing it with `bare` would only drop
 * the year that keeps two runs of one title apart.
 */
export function isRunYearQualifiedName(qualified: string | null | undefined, bare: string | null | undefined): boolean {
  const run = splitSeriesRunYear(qualified);
  if (!run) return false;
  const bareKey = normalizeMetadataTextKey(bare);
  return bareKey !== null && bareKey === normalizeMetadataTextKey(run.base);
}
