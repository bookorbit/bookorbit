import { ComicVineVolume } from './comicvine.types';

const LEADING_ARTICLE = /^(?:the|a|an)\s+/;
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;
const LEADING_ZEROS = /^0+(?=\d)/;

/**
 * ComicVine stores issue numbers unpadded, so a padded number lifted from a filename
 * ("... Issue 067.cbr") matches nothing. The lookahead keeps the final digit so issue #0,
 * which real series do publish, survives.
 */
export function normalizeIssueNumber(raw: string): string {
  return raw.trim().replace(LEADING_ZEROS, '');
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(LEADING_ARTICLE, '').replace(NON_ALPHANUMERIC, ' ').trim();
}

/**
 * `filter=name:` on /volumes/ is a substring match, so a common series name returns spin-offs,
 * annuals and collections alongside the runs themselves. Scoring them before spending a request
 * each is what keeps the search inside its budget.
 */
function nameScore(volumeName: string, seriesName: string): number {
  const volume = normalizeName(volumeName);
  const series = normalizeName(seriesName);
  if (!volume || !series) return 0;
  if (volume === series) return 2;
  if (volume.startsWith(`${series} `) || volume.includes(series)) return 1;
  return 0;
}

/**
 * A volume that never ran this long cannot hold the issue. Treated as a ranking signal rather than
 * a filter because publishers restart numbering and then reissue legacy numbers far above the
 * volume's own count.
 */
function holdsIssuePlausibly(volume: ComicVineVolume, issueNumber: string): boolean {
  const target = parseFloat(issueNumber);
  if (!Number.isFinite(target)) return true;
  if (!Number.isFinite(volume.count_of_issues) || volume.count_of_issues <= 0) return true;
  return volume.count_of_issues >= target;
}

function startYear(volume: ComicVineVolume): number {
  const year = volume.start_year ? parseInt(volume.start_year, 10) : NaN;
  return Number.isFinite(year) ? year : 0;
}

function score(volume: ComicVineVolume, seriesName: string, issueNumber: string): number {
  return nameScore(volume.name, seriesName) * 2 + (holdsIssuePlausibly(volume, issueNumber) ? 1 : 0);
}

/**
 * Orders candidate volumes by how likely each is to hold the wanted issue: name match first, then
 * whether the volume ran long enough, then the most recent run. Stable within equal scores.
 */
export function rankVolumes(volumes: ComicVineVolume[], seriesName: string, issueNumber: string): ComicVineVolume[] {
  return volumes
    .map((volume, index) => ({ volume, index, score: score(volume, seriesName, issueNumber) }))
    .sort((a, b) => b.score - a.score || startYear(b.volume) - startYear(a.volume) || a.index - b.index)
    .map((entry) => entry.volume);
}
