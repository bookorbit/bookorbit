import { ComicMetadataFields, MetadataCandidate, MetadataProviderKey, parseSeriesIndex as parseSeriesIndexLabel } from '@bookorbit/types';

import { parsePublishedDateKey, parsePublishedYear, publishedYearFromDateKey } from '../../../../common/utils/published-date.utils';
import { normalizeSeriesTotalBooks } from '../../../../common/utils/series-total-books.utils';
import { ComicVineIssue, ComicVinePersonCredit, ComicVineVolume } from './comicvine.types';

function parseYear(dateStr: string | null | undefined): number | undefined {
  return parsePublishedYear(dateStr ?? undefined);
}

function parseSeriesIndex(issueNumber: string): string | undefined {
  return parseSeriesIndexLabel(issueNumber) ?? undefined;
}

function extractByRole(credits: ComicVinePersonCredit[], ...roles: string[]): string[] {
  const roleSet = new Set(roles.map((r) => r.toLowerCase()));
  return credits.filter((c) => c.role.split(',').some((r) => roleSet.has(r.trim().toLowerCase()))).map((c) => c.name);
}

function buildComicMetadata(issue: ComicVineIssue): ComicMetadataFields {
  const personCredits = issue.person_credits ?? [];
  return {
    issueNumber: issue.issue_number,
    volumeName: issue.volume.name,
    pencillers: extractByRole(personCredits, 'penciller', 'penciler', 'artist'),
    inkers: extractByRole(personCredits, 'inker'),
    colorists: extractByRole(personCredits, 'colorist', 'colourist'),
    letterers: extractByRole(personCredits, 'letterer'),
    coverArtists: extractByRole(personCredits, 'cover', 'cover artist'),
    characters: (issue.character_credits ?? []).map((c) => c.name),
    teams: (issue.team_credits ?? []).map((t) => t.name),
    locations: (issue.location_credits ?? []).map((l) => l.name),
    storyArcs: (issue.story_arc_credits ?? []).map((s) => s.name),
  };
}

function buildTitle(issue: ComicVineIssue): string | undefined {
  return issue.name?.trim() || undefined;
}

function buildDisplayTitle(issue: ComicVineIssue): string {
  const parts = [issue.volume.name, `#${issue.issue_number}`];
  if (issue.name) parts.push(`- ${issue.name}`);
  return parts.join(' ');
}

function publisherName(volume: ComicVineVolume | undefined): string | undefined {
  const name: unknown = volume?.publisher?.name;
  return typeof name === 'string' ? name.trim() || undefined : undefined;
}

/**
 * The issue payload only carries its volume's id and name, so volume-level fields have to come
 * from the linked volume record. The id check prevents a mismatched search result from leaking
 * another run's publisher or issue count into the candidate.
 */
export function mapIssueToCandidate(issue: ComicVineIssue, options?: { volume?: ComicVineVolume }): MetadataCandidate {
  const writers = extractByRole(issue.person_credits ?? [], 'writer');
  const rawPublishedDate = issue.cover_date ?? issue.store_date;
  const publishedDate = parsePublishedDateKey(rawPublishedDate ?? undefined);
  const volume = options?.volume?.id === issue.volume.id ? options.volume : undefined;

  return {
    provider: MetadataProviderKey.COMICVINE,
    providerId: String(issue.id),
    title: buildTitle(issue),
    displayTitle: buildDisplayTitle(issue),
    authors: writers,
    description: issue.description ?? issue.deck ?? undefined,
    publisher: publisherName(volume),
    publishedDate,
    publishedYear: publishedDate ? publishedYearFromDateKey(publishedDate) : parseYear(rawPublishedDate),
    seriesName: issue.volume.name,
    seriesIndex: parseSeriesIndex(issue.issue_number),
    seriesTotalBooks: normalizeSeriesTotalBooks(volume?.count_of_issues),
    coverUrl: issue.image?.original_url,
    sourceUrl: issue.site_detail_url ?? undefined,
    comicMetadata: buildComicMetadata(issue),
  };
}
