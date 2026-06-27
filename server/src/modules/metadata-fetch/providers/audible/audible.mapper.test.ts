import { describe, it, expect } from 'vitest';
import { MetadataProviderKey } from '@bookorbit/types';
import { mapAudibleProduct } from './audible.mapper';
import type { AudibleProduct } from './audible.types';

function makeProduct(overrides: Partial<AudibleProduct> = {}): AudibleProduct {
  return {
    asin: 'B001234567',
    title: 'The Name of the Wind',
    ...overrides,
  };
}

// ── BASIC MAPPING ─────────────────────────────────────────────────────────────

describe('mapAudibleProduct — basic fields', () => {
  it('sets provider and providerId', () => {
    const result = mapAudibleProduct(makeProduct());
    expect(result.provider).toBe(MetadataProviderKey.AUDIBLE);
    expect(result.providerId).toBe('B001234567');
    expect(result.audibleId).toBe('B001234567');
  });

  it('maps title', () => {
    const result = mapAudibleProduct(makeProduct({ title: 'Dune' }));
    expect(result.title).toBe('Dune');
  });

  it('maps subtitle', () => {
    const result = mapAudibleProduct(makeProduct({ subtitle: 'Deluxe Edition' }));
    expect(result.subtitle).toBe('Deluxe Edition');
  });

  it('maps authors array', () => {
    const result = mapAudibleProduct(makeProduct({ authors: [{ name: 'Patrick Rothfuss' }] }));
    expect(result.authors).toEqual(['Patrick Rothfuss']);
  });

  it('defaults authors to empty array when absent', () => {
    const result = mapAudibleProduct(makeProduct());
    expect(result.authors).toEqual([]);
  });

  it('maps narrators', () => {
    const result = mapAudibleProduct(makeProduct({ narrators: [{ name: 'Nick Podehl' }] }));
    expect(result.narrators).toEqual(['Nick Podehl']);
  });

  it('defaults narrators to empty array when absent', () => {
    const result = mapAudibleProduct(makeProduct());
    expect(result.narrators).toEqual([]);
  });

  it('maps description from publisher_summary (full synopsis)', () => {
    const result = mapAudibleProduct(makeProduct({ publisher_summary: 'The full synopsis.' }));
    expect(result.description).toBe('The full synopsis.');
  });

  it('prefers publisher_summary over merchandising_summary', () => {
    const result = mapAudibleProduct(makeProduct({ publisher_summary: 'Full synopsis.', merchandising_summary: 'Short blurb.' }));
    expect(result.description).toBe('Full synopsis.');
  });

  it('falls back to merchandising_summary when publisher_summary absent', () => {
    const result = mapAudibleProduct(makeProduct({ merchandising_summary: 'Short blurb.' }));
    expect(result.description).toBe('Short blurb.');
  });

  it('strips HTML tags from publisher_summary', () => {
    const result = mapAudibleProduct(makeProduct({ publisher_summary: '<p>An <b>epic</b> fantasy.</p>' }));
    expect(result.description).toBe('An epic fantasy.');
  });

  it('decodes common HTML entities', () => {
    const result = mapAudibleProduct(makeProduct({ publisher_summary: 'Fish &amp; Chips' }));
    expect(result.description).toBe('Fish & Chips');
  });

  it('returns undefined description when both summary fields absent', () => {
    const result = mapAudibleProduct(makeProduct());
    expect(result.description).toBeUndefined();
  });

  it('maps publisher_name', () => {
    const result = mapAudibleProduct(makeProduct({ publisher_name: 'Macmillan Audio' }));
    expect(result.publisher).toBe('Macmillan Audio');
  });

  it('maps language', () => {
    const result = mapAudibleProduct(makeProduct({ language: 'english' }));
    expect(result.language).toBe('english');
  });

  it('maps overall community rating and rating count', () => {
    const result = mapAudibleProduct(
      makeProduct({
        rating: {
          overall_distribution: {
            average_rating: 4.936869108034913,
            num_ratings: 125913,
          },
        },
      }),
    );

    expect(result.communityRating).toBe(4.936869108034913);
    expect(result.communityRatingCount).toBe(125913);
  });
});

// ── COVER URL ────────────────────────────────────────────────────────────────

describe('mapAudibleProduct — cover URL', () => {
  it('prefers 1024px cover', () => {
    const result = mapAudibleProduct(
      makeProduct({
        product_images: { 1024: 'https://img.example.com/1024.jpg', 500: 'https://img.example.com/500.jpg' },
      }),
    );
    expect(result.coverUrl).toBe('https://img.example.com/1024.jpg');
  });

  it('falls back to 500px cover when 1024 absent', () => {
    const result = mapAudibleProduct(
      makeProduct({
        product_images: { 500: 'https://img.example.com/500.jpg' },
      }),
    );
    expect(result.coverUrl).toBe('https://img.example.com/500.jpg');
  });

  it('returns undefined when no images', () => {
    const result = mapAudibleProduct(makeProduct());
    expect(result.coverUrl).toBeUndefined();
  });
});

// ── PUBLISHED YEAR ────────────────────────────────────────────────────────────

describe('mapAudibleProduct — publishedYear', () => {
  it('extracts year from ISO release_date', () => {
    const result = mapAudibleProduct(makeProduct({ release_date: '2007-03-27' }));
    expect(result.publishedYear).toBe(2007);
  });

  it('returns undefined for invalid date string', () => {
    const result = mapAudibleProduct(makeProduct({ release_date: 'not-a-date' }));
    expect(result.publishedYear).toBeUndefined();
  });

  it('returns undefined when release_date is absent', () => {
    const result = mapAudibleProduct(makeProduct());
    expect(result.publishedYear).toBeUndefined();
  });
});

// ── DURATION ─────────────────────────────────────────────────────────────────

describe('mapAudibleProduct — durationSeconds', () => {
  it('converts runtime_length_min to seconds', () => {
    const result = mapAudibleProduct(makeProduct({ runtime_length_min: 120 }));
    expect(result.durationSeconds).toBe(7200);
  });

  it('returns undefined when runtime_length_min is absent', () => {
    const result = mapAudibleProduct(makeProduct());
    expect(result.durationSeconds).toBeUndefined();
  });
});

// ── ABRIDGED ─────────────────────────────────────────────────────────────────

describe('mapAudibleProduct — abridged', () => {
  it('returns true when format_type is "abridged" (case-insensitive)', () => {
    expect(mapAudibleProduct(makeProduct({ format_type: 'abridged' })).abridged).toBe(true);
    expect(mapAudibleProduct(makeProduct({ format_type: 'Abridged' })).abridged).toBe(true);
    expect(mapAudibleProduct(makeProduct({ format_type: 'ABRIDGED' })).abridged).toBe(true);
  });

  it('returns false when format_type is "unabridged"', () => {
    expect(mapAudibleProduct(makeProduct({ format_type: 'unabridged' })).abridged).toBe(false);
  });

  it('returns undefined when format_type is absent', () => {
    expect(mapAudibleProduct(makeProduct()).abridged).toBeUndefined();
  });
});

// ── SERIES ───────────────────────────────────────────────────────────────────

describe('mapAudibleProduct — series', () => {
  it('maps first series title and numeric sequence', () => {
    const result = mapAudibleProduct(
      makeProduct({
        series: [{ title: 'Kingkiller Chronicle', sequence: '1' }],
      }),
    );
    expect(result.seriesName).toBe('Kingkiller Chronicle');
    expect(result.seriesIndex).toBe(1);
    expect(result.seriesMemberships).toEqual([{ seriesName: 'Kingkiller Chronicle', seriesIndex: 1 }]);
  });

  it('handles decimal series index', () => {
    const result = mapAudibleProduct(
      makeProduct({
        series: [{ title: 'Wheel of Time', sequence: '2.5' }],
      }),
    );
    expect(result.seriesIndex).toBe(2.5);
    expect(result.seriesMemberships).toEqual([{ seriesName: 'Wheel of Time', seriesIndex: 2.5 }]);
  });

  it('leaves seriesIndex undefined when sequence is absent', () => {
    const result = mapAudibleProduct(makeProduct({ series: [{ title: 'A Series', sequence: undefined }] }));
    expect(result.seriesIndex).toBeUndefined();
    expect(result.seriesMemberships).toEqual([{ seriesName: 'A Series' }]);
  });

  it('maps all series memberships from the Audible Confessor fixture', () => {
    const result = mapAudibleProduct(
      makeProduct({
        asin: 'B002V1NSN2',
        title: 'Confessor',
        subtitle: 'Chainfire Trilogy, Part 3, Sword of Truth, Book 11',
        authors: [{ name: 'Terry Goodkind' }],
        series: [
          {
            asin: 'B005NB27MK',
            sequence: '11',
            title: 'Sword of Truth',
            url: '/pd/Sword-of-Truth-Audiobook/B005NB27MK',
          },
          {
            asin: 'B014QFZEPK',
            sequence: '3',
            title: 'Chainfire Trilogy',
            url: '/pd/Chainfire-Trilogy-Audiobook/B014QFZEPK',
          },
        ],
      }),
    );

    expect(result.seriesName).toBe('Sword of Truth');
    expect(result.seriesIndex).toBe(11);
    expect(result.seriesMemberships).toEqual([
      { seriesName: 'Sword of Truth', seriesIndex: 11 },
      { seriesName: 'Chainfire Trilogy', seriesIndex: 3 },
    ]);
  });

  it('returns undefined series fields when series array is absent', () => {
    const result = mapAudibleProduct(makeProduct());
    expect(result.seriesName).toBeUndefined();
    expect(result.seriesIndex).toBeUndefined();
    expect(result.seriesMemberships).toBeUndefined();
  });
});

// ── GENRES ───────────────────────────────────────────────────────────────────

describe('mapAudibleProduct — genres', () => {
  it('extracts leaf category from each ladder', () => {
    const result = mapAudibleProduct(
      makeProduct({
        category_ladders: [
          {
            ladder: [
              { id: '1', name: 'Audible Books & Originals' },
              { id: '2', name: 'Science Fiction & Fantasy' },
              { id: '3', name: 'Science Fiction' },
            ],
          },
        ],
      }),
    );
    expect(result.genres).toEqual(['Science Fiction']);
  });

  it('deduplicates genres across ladders', () => {
    const result = mapAudibleProduct(
      makeProduct({
        category_ladders: [
          {
            ladder: [
              { id: '1', name: 'Audible Books & Originals' },
              { id: '2', name: 'Fantasy' },
            ],
          },
          {
            ladder: [
              { id: '3', name: 'Books' },
              { id: '4', name: 'Fantasy' },
            ],
          },
        ],
      }),
    );
    expect(result.genres).toEqual(['Fantasy']);
  });

  it('filters out generic top-level categories', () => {
    const result = mapAudibleProduct(
      makeProduct({
        category_ladders: [{ ladder: [{ id: '1', name: 'Audible Books & Originals' }] }],
      }),
    );
    expect(result.genres).toBeUndefined();
  });

  it('returns undefined when category_ladders absent', () => {
    const result = mapAudibleProduct(makeProduct());
    expect(result.genres).toBeUndefined();
  });

  it('returns undefined when all ladders are empty', () => {
    const result = mapAudibleProduct(makeProduct({ category_ladders: [] }));
    expect(result.genres).toBeUndefined();
  });
});
