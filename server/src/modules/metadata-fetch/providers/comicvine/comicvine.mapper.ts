import { ComicMetadataFields, MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { parsePublishedDateKey, parsePublishedYear, publishedYearFromDateKey } from '../../../../common/utils/published-date.utils';
import { ComicVineIssue, ComicVinePersonCredit } from './comicvine.types';

function parseYear(dateStr: string | null | undefined): number | undefined {
  return parsePublishedYear(dateStr ?? undefined);
}

function parseSeriesIndex(issueNumber: string): number | undefined {
  const n = parseFloat(issueNumber);
  return Number.isFinite(n) ? n : undefined;
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

function buildTitle(issue: ComicVineIssue): string {
  const parts = [issue.volume.name, `#${issue.issue_number}`];
  if (issue.name) parts.push(`- ${issue.name}`);
  return parts.join(' ');
}

export function mapIssueToCandidate(issue: ComicVineIssue): MetadataCandidate {
  const writers = extractByRole(issue.person_credits ?? [], 'writer');
  const rawPublishedDate = issue.cover_date ?? issue.store_date;
  const publishedDate = parsePublishedDateKey(rawPublishedDate ?? undefined);

  return {
    provider: MetadataProviderKey.COMICVINE,
    providerId: String(issue.id),
    title: buildTitle(issue),
    subtitle: issue.name ?? undefined,
    authors: writers,
    description: issue.description ?? issue.deck ?? undefined,
    publishedDate,
    publishedYear: publishedDate ? publishedYearFromDateKey(publishedDate) : parseYear(rawPublishedDate),
    seriesName: issue.volume.name,
    seriesIndex: parseSeriesIndex(issue.issue_number),
    coverUrl: issue.image?.original_url,
    sourceUrl: issue.site_detail_url ?? undefined,
    comicMetadata: buildComicMetadata(issue),
  };
}
