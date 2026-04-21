import { type AudiobookChapter, type MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import type { IdentifiableProvider } from '../../../src/modules/metadata-fetch/providers/metadata-provider';

const DEFAULT_TITLE = 'Metadata Lock Fixture';

export function createMetadataLockTestProviders(getCoverUrl: (providerKey: MetadataProviderKey) => string): IdentifiableProvider[] {
  return [
    {
      key: MetadataProviderKey.GOODREADS,
      label: 'Metadata Lock Goodreads',
      identifiable: true,
      search: (params) => Promise.resolve([buildMetadataLockCandidates(params.title, getCoverUrl).goodreads]),
      lookupById: (providerId) => {
        const title = humanizeProviderId(providerId) ?? DEFAULT_TITLE;
        return Promise.resolve({ ...buildMetadataLockCandidates(title, getCoverUrl).goodreads, providerId });
      },
    },
    {
      key: MetadataProviderKey.OPEN_LIBRARY,
      label: 'Metadata Lock Open Library',
      identifiable: true,
      search: (params) => Promise.resolve([buildMetadataLockCandidates(params.title, getCoverUrl).openLibrary]),
      lookupById: (providerId) => {
        const title = humanizeProviderId(providerId) ?? DEFAULT_TITLE;
        return Promise.resolve({ ...buildMetadataLockCandidates(title, getCoverUrl).openLibrary, providerId });
      },
    },
  ];
}

export function buildMetadataLockCandidates(
  queryTitle: string | undefined,
  getCoverUrl: (providerKey: MetadataProviderKey) => string,
): { goodreads: MetadataCandidate; openLibrary: MetadataCandidate } {
  const baseTitle = normalizeTitle(queryTitle);
  const slug = toSlug(baseTitle);

  const chapters: AudiobookChapter[] = [
    { title: 'Refreshed Chapter 1', startMs: 0, durationMs: 120_000 },
    { title: 'Refreshed Chapter 2', startMs: 120_000, durationMs: 150_000 },
  ];

  return {
    goodreads: {
      provider: MetadataProviderKey.GOODREADS,
      providerId: `gr-${slug}`,
      title: `${baseTitle} - refreshed`,
      subtitle: 'Refreshed subtitle',
      authors: ['Refreshed Author'],
      description: 'Refreshed description from fake Goodreads',
      publisher: 'Refreshed Publisher',
      publishedYear: 2024,
      language: 'fr',
      pageCount: 321,
      genres: ['Speculative Fiction', 'Adventure'],
      coverUrl: getCoverUrl(MetadataProviderKey.GOODREADS),
      narrators: ['Refreshed Narrator'],
      durationSeconds: 5432,
      abridged: true,
      chapters,
      comicMetadata: {
        issueNumber: 'ISS-42',
        volumeName: 'Volume Omega',
        storyArcs: ['Arc Alpha'],
      },
    },
    openLibrary: {
      provider: MetadataProviderKey.OPEN_LIBRARY,
      providerId: `ol-${slug}`,
      title: `${baseTitle} - open-library`,
      subtitle: 'Open Library subtitle',
      authors: ['Open Library Author'],
      description: 'Open Library fallback description',
      publisher: 'Open Library Publisher',
      publishedYear: 2023,
      language: 'de',
      pageCount: 222,
      coverUrl: getCoverUrl(MetadataProviderKey.OPEN_LIBRARY),
    },
  };
}

function normalizeTitle(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_TITLE;
}

function toSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'fixture';
}

function humanizeProviderId(providerId: string): string | null {
  const suffix = providerId.split('-').slice(1).join('-').trim();
  if (!suffix) return null;
  return suffix
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}
