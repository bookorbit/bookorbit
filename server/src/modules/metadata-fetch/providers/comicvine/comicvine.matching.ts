import { parseSeriesIndex, type MetadataCandidate } from '@bookorbit/types';

import { normalizeTitleText, scoreTitleMatch } from '../../../../common/text-match/title-match';
import { splitSeriesRunYear } from '../../../../common/utils/series-run-year.utils';
import type { MetadataSearchParams } from '../metadata-search-params';
import { ComicVineVolume } from './comicvine.types';

const LEADING_ARTICLE = /^(?:the|a|an)\s+/;
const LEADING_ZEROS = /^0+(?=\d)/;
const ISSUE_PATTERN = /^(.*?)\s*#(\d[\d.]*)(.*)$/;

interface ParsedIssueTitle {
  seriesName: string;
  issueNumber: string;
  /** The run's start year when the series was named "Title (Year)". */
  startYear?: number;
}

/** An explicit issue target wins; a typed series overrides the stored series but keeps its issue. */
export function resolveComicVineIssueQuery(params: MetadataSearchParams): ParsedIssueTitle | null {
  const match = params.title ? ISSUE_PATTERN.exec(params.title.trim()) : null;
  if (match?.[1].trim()) return issueQuery(match[1], match[2]);

  const issueNumber = parseSeriesIndex(params.seriesIndex);
  const typedSeriesName = params.titleIsExplicitQuery ? params.title?.trim() : undefined;
  if (typedSeriesName) return issueNumber ? issueQuery(typedSeriesName, issueNumber) : null;

  const seriesName = params.seriesName?.trim();
  return seriesName && issueNumber ? issueQuery(seriesName, issueNumber) : null;
}

/**
 * ComicVine names a run without its year and `filter=name:` is a substring match, so a series
 * folder named "Batman (2016)" would find nothing. The year moves into ranking instead.
 */
function issueQuery(seriesName: string, issueNumber: string): ParsedIssueTitle {
  const trimmed = seriesName.trim();
  const run = splitSeriesRunYear(trimmed);
  return run
    ? { seriesName: run.base, issueNumber: normalizeIssueNumber(issueNumber), startYear: run.year }
    : { seriesName: trimmed, issueNumber: normalizeIssueNumber(issueNumber) };
}

/** An issue subtitle is not evidence that a different run is a better series/number match. */
export function scoreComicVineIssue(candidate: MetadataCandidate, params: MetadataSearchParams): number | null {
  const query = resolveComicVineIssueQuery(params);
  const seriesName = candidate.comicMetadata?.volumeName ?? candidate.seriesName;
  const issueNumber = candidate.comicMetadata?.issueNumber ?? parseSeriesIndex(candidate.seriesIndex);
  if (!query || !seriesName || !issueNumber) return null;
  if (normalizeIssueNumber(issueNumber) !== query.issueNumber) return 0;
  return scoreTitleMatch(normalizeName(query.seriesName), normalizeName(seriesName));
}

/**
 * ComicVine stores issue numbers unpadded, so a padded number lifted from a filename
 * ("... Issue 067.cbr") matches nothing. The lookahead keeps the final digit so issue #0,
 * which real series do publish, survives.
 */
export function normalizeIssueNumber(raw: string): string {
  return raw.trim().replace(LEADING_ZEROS, '');
}

function normalizeName(name: string): string {
  return normalizeTitleText(name).replace(LEADING_ARTICLE, '');
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

function volumeStartYear(volume: ComicVineVolume): number {
  const year = volume.start_year ? parseInt(volume.start_year, 10) : NaN;
  return Number.isFinite(year) ? year : 0;
}

export function volumeMatchScore(volume: ComicVineVolume, seriesName: string, issueNumber: string, startYear?: number): number {
  const yearMatches = startYear !== undefined && startYear === volumeStartYear(volume);
  return nameScore(volume.name, seriesName) * 4 + (yearMatches ? 2 : 0) + (holdsIssuePlausibly(volume, issueNumber) ? 1 : 0);
}

/**
 * Orders candidate volumes by how likely each is to hold the wanted issue: name match first, then
 * the run year the series was named with, then whether the volume ran long enough, then the most
 * recent run. Stable within equal scores.
 */
export function rankVolumes(volumes: ComicVineVolume[], seriesName: string, issueNumber: string, startYear?: number): ComicVineVolume[] {
  return volumes
    .map((volume, index) => ({ volume, index, score: volumeMatchScore(volume, seriesName, issueNumber, startYear) }))
    .sort((a, b) => b.score - a.score || volumeStartYear(b.volume) - volumeStartYear(a.volume) || a.index - b.index)
    .map((entry) => entry.volume);
}
