import { MetadataProviderKey, type BookDockMetadata } from '@bookorbit/types';

import { normalizeBookDockMetadata, normalizeBookDockMetadataSources } from './book-dock-metadata.utils';

describe('BookDock metadata normalization', () => {
  it('preserves every supported field while mapping legacy duration and removing unknown nested fields', () => {
    const input = {
      title: 'Dune',
      subtitle: 'Deluxe',
      authors: ['Frank Herbert'],
      narrators: ['Simon Vance'],
      description: 'Description',
      publisher: 'Ace',
      publishedDate: '1965-08-01',
      publishedYear: 1965,
      language: 'en',
      pageCount: 688,
      isbn10: '0441172717',
      isbn13: '9780441172719',
      seriesName: 'Dune',
      seriesIndex: 1,
      seriesMemberships: [{ seriesName: 'Dune', seriesIndex: 1, unknown: true }],
      genres: ['Science Fiction'],
      coverUrl: 'https://example.test/dune.jpg',
      duration: 1200,
      abridged: false,
      chapters: [{ title: 'Chapter 1', startMs: 0, durationMs: 500, unknown: true }],
      communityRatings: [
        {
          provider: MetadataProviderKey.HARDCOVER,
          rating: 4.5,
          ratingCount: 1000,
          updatedAt: '2026-07-22T00:00:00.000Z',
          unknown: true,
        },
      ],
      googleBooksId: 'google-id',
      goodreadsId: 'goodreads-id',
      amazonId: 'amazon-id',
      hardcoverId: 'hardcover-id',
      hardcoverEditionId: 'hardcover-edition-id',
      openLibraryId: 'OL1W',
      itunesId: 'itunes-id',
      audibleId: 'audible-id',
      librofmId: 'librofm-id',
      koboId: 'kobo-id',
      comicvineId: 'comicvine-id',
      ranobedbId: 'ranobedb-id',
      lubimyczytacId: 'lubimyczytac-id',
      aladinId: 'aladin-id',
      comicMetadata: { issueNumber: '1', pencillers: ['Artist'], unknown: true },
      unknown: 'remove me',
    };

    const expected: BookDockMetadata = {
      title: 'Dune',
      subtitle: 'Deluxe',
      authors: ['Frank Herbert'],
      narrators: ['Simon Vance'],
      description: 'Description',
      publisher: 'Ace',
      publishedDate: '1965-08-01',
      publishedYear: 1965,
      language: 'en',
      pageCount: 688,
      isbn10: '0441172717',
      isbn13: '9780441172719',
      seriesName: 'Dune',
      seriesIndex: 1,
      seriesMemberships: [{ seriesName: 'Dune', seriesIndex: 1 }],
      genres: ['Science Fiction'],
      coverUrl: 'https://example.test/dune.jpg',
      durationSeconds: 1200,
      abridged: false,
      chapters: [{ title: 'Chapter 1', startMs: 0, durationMs: 500 }],
      communityRatings: [{ provider: MetadataProviderKey.HARDCOVER, rating: 4.5, ratingCount: 1000 }],
      googleBooksId: 'google-id',
      goodreadsId: 'goodreads-id',
      amazonId: 'amazon-id',
      hardcoverId: 'hardcover-id',
      hardcoverEditionId: 'hardcover-edition-id',
      openLibraryId: 'OL1W',
      itunesId: 'itunes-id',
      audibleId: 'audible-id',
      librofmId: 'librofm-id',
      koboId: 'kobo-id',
      comicvineId: 'comicvine-id',
      ranobedbId: 'ranobedb-id',
      lubimyczytacId: 'lubimyczytac-id',
      aladinId: 'aladin-id',
      comicMetadata: { issueNumber: '1', pencillers: ['Artist'] },
    };

    expect(normalizeBookDockMetadata(input)).toEqual(expected);
  });

  it('prefers the canonical durationSeconds field when both duration forms exist', () => {
    expect(normalizeBookDockMetadata({ duration: 1200, durationSeconds: 2400 })).toEqual({ durationSeconds: 2400 });
  });

  it('normalizes pipeline source names to the BookDock contract and drops unknown fields', () => {
    expect(
      normalizeBookDockMetadataSources({
        title: 'goodreads',
        duration: 'audible',
        communityRating: 'goodreads|audible',
        cover: 'itunes',
        unknown: 'provider',
      }),
    ).toEqual({
      title: 'goodreads',
      durationSeconds: 'audible',
      communityRatings: 'goodreads|audible',
      coverUrl: 'itunes',
    });
  });

  it('returns null for non-object metadata and preserves explicit nullable structured fields', () => {
    expect(normalizeBookDockMetadata(null)).toBeNull();
    expect(
      normalizeBookDockMetadata({
        chapters: null,
        seriesMemberships: null,
        communityRatings: null,
        comicMetadata: null,
      }),
    ).toEqual({
      chapters: null,
      seriesMemberships: null,
      communityRatings: null,
      comicMetadata: null,
    });
  });
});
