import type { BookMetadataFetchConfig } from '@projectx/types';

import { BookMetadataFetchEligibilityService, type BookEligibilityData } from './book-metadata-fetch-eligibility.service';

const baseBook = (): BookEligibilityData => ({
  metadataScore: 80,
  lastMetadataFetchAt: new Date('2026-01-01T00:00:00.000Z'),
  title: 'Book',
  subtitle: 'Subtitle',
  description: 'Description',
  publisher: 'Publisher',
  publishedYear: 2020,
  language: 'en',
  pageCount: 320,
  seriesName: 'Series',
  seriesIndex: 1,
  coverSource: 'cover.jpg',
  hasAuthors: true,
  hasGenres: true,
  hasNarrators: true,
  durationSeconds: 10_000,
  abridged: false,
});

const baseConfig = (): BookMetadataFetchConfig => ({
  enabled: true,
  triggerOnImport: true,
  conditions: {
    neverFetched: { enabled: false },
    scoreThreshold: { enabled: false, threshold: 60 },
    missingFields: { enabled: false, fields: [] },
  },
});

describe('BookMetadataFetchEligibilityService', () => {
  let service: BookMetadataFetchEligibilityService;

  beforeEach(() => {
    service = new BookMetadataFetchEligibilityService();
  });

  it('returns true when never fetched condition matches', () => {
    const book = { ...baseBook(), lastMetadataFetchAt: null };
    const config = baseConfig();
    config.conditions.neverFetched.enabled = true;

    expect(service.isEligible(book, config)).toBe(true);
  });

  it('returns true when score threshold is enabled and score is null', () => {
    const book = { ...baseBook(), metadataScore: null };
    const config = baseConfig();
    config.conditions.scoreThreshold.enabled = true;
    config.conditions.scoreThreshold.threshold = 70;

    expect(service.isEligible(book, config)).toBe(true);
  });

  it('returns true when score threshold is enabled and score is below threshold', () => {
    const book = { ...baseBook(), metadataScore: 55 };
    const config = baseConfig();
    config.conditions.scoreThreshold.enabled = true;
    config.conditions.scoreThreshold.threshold = 60;

    expect(service.isEligible(book, config)).toBe(true);
  });

  it('returns false when all enabled conditions do not match', () => {
    const book = baseBook();
    const config = baseConfig();
    config.conditions.neverFetched.enabled = true;
    config.conditions.scoreThreshold.enabled = true;
    config.conditions.missingFields.enabled = true;
    config.conditions.missingFields.fields = ['description', 'cover'];

    expect(service.isEligible(book, config)).toBe(false);
  });

  it('treats new missing-field types as eligible (narrators, duration, abridged)', () => {
    const config = baseConfig();
    config.conditions.missingFields.enabled = true;

    const missingNarrators = { ...baseBook(), hasNarrators: false };
    config.conditions.missingFields.fields = ['narrators'];
    expect(service.isEligible(missingNarrators, config)).toBe(true);

    const missingDuration = { ...baseBook(), durationSeconds: null };
    config.conditions.missingFields.fields = ['duration'];
    expect(service.isEligible(missingDuration, config)).toBe(true);

    const missingAbridged = { ...baseBook(), abridged: null };
    config.conditions.missingFields.fields = ['abridged'];
    expect(service.isEligible(missingAbridged, config)).toBe(true);
  });

  it('treats empty strings as missing for scalar text fields', () => {
    const book = { ...baseBook(), title: '' };
    const config = baseConfig();
    config.conditions.missingFields.enabled = true;
    config.conditions.missingFields.fields = ['title'];

    expect(service.isEligible(book, config)).toBe(true);
  });

  it('does not treat numeric zero values as missing', () => {
    const book = { ...baseBook(), pageCount: 0, seriesIndex: 0 };
    const config = baseConfig();
    config.conditions.missingFields.enabled = true;
    config.conditions.missingFields.fields = ['pageCount', 'seriesIndex'];

    expect(service.isEligible(book, config)).toBe(false);
  });

  it('ignores missing-fields condition when the field list is empty', () => {
    const book = { ...baseBook(), description: null };
    const config = baseConfig();
    config.conditions.missingFields.enabled = true;
    config.conditions.missingFields.fields = [];

    expect(service.isEligible(book, config)).toBe(false);
  });
});
