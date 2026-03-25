import { describe, it, expect } from 'vitest';
import { MetadataProviderKey } from '@projectx/types';
import { mapAudNexusBook } from './audnexus.mapper';
import type { AudNexusBook, AudNexusChaptersResponse } from './audnexus.types';

function makeBook(overrides: Partial<AudNexusBook> = {}): AudNexusBook {
  return {
    asin: 'B09ABCDEF1',
    title: 'Project Hail Mary',
    ...overrides,
  };
}

// ── BASIC MAPPING ─────────────────────────────────────────────────────────────

describe('mapAudNexusBook — basic fields', () => {
  it('sets provider as AUDNEXUS', () => {
    expect(mapAudNexusBook(makeBook()).provider).toBe(MetadataProviderKey.AUDNEXUS);
  });

  it('maps asin to both providerId and audibleId', () => {
    const result = mapAudNexusBook(makeBook({ asin: 'B09XYZ1234' }));
    expect(result.providerId).toBe('B09XYZ1234');
    expect(result.audibleId).toBe('B09XYZ1234');
  });

  it('maps title to title', () => {
    const result = mapAudNexusBook(makeBook({ title: 'The Martian' }));
    expect(result.title).toBe('The Martian');
  });

  it('falls back to legacy name when title is missing', () => {
    const result = mapAudNexusBook(makeBook({ title: undefined, name: 'The Martian (Legacy)' }));
    expect(result.title).toBe('The Martian (Legacy)');
  });

  it('maps subtitle', () => {
    const result = mapAudNexusBook(makeBook({ subtitle: 'A Novel' }));
    expect(result.subtitle).toBe('A Novel');
  });

  it('maps authors array', () => {
    const result = mapAudNexusBook(makeBook({ authors: [{ name: 'Andy Weir', asin: 'B000AP9GVK' }] }));
    expect(result.authors).toEqual(['Andy Weir']);
  });

  it('defaults authors to empty array when absent', () => {
    expect(mapAudNexusBook(makeBook()).authors).toEqual([]);
  });

  it('maps narrators', () => {
    const result = mapAudNexusBook(makeBook({ narrators: [{ name: 'Ray Porter' }] }));
    expect(result.narrators).toEqual(['Ray Porter']);
  });

  it('defaults narrators to empty when absent', () => {
    expect(mapAudNexusBook(makeBook()).narrators).toEqual([]);
  });

  it('prefers description over summary', () => {
    const result = mapAudNexusBook(makeBook({ description: 'Plain text description', summary: '<p>HTML summary</p>' }));
    expect(result.description).toBe('Plain text description');
  });

  it('strips HTML from summary when description is absent', () => {
    const result = mapAudNexusBook(makeBook({ summary: '<p>A lone <b>astronaut</b>.</p>' }));
    expect(result.description).toBe('A lone astronaut .');
  });

  it('maps publisherName', () => {
    const result = mapAudNexusBook(makeBook({ publisherName: 'Audible Studios' }));
    expect(result.publisher).toBe('Audible Studios');
  });

  it('maps language', () => {
    const result = mapAudNexusBook(makeBook({ language: 'english' }));
    expect(result.language).toBe('english');
  });

  it('maps image to coverUrl', () => {
    const result = mapAudNexusBook(makeBook({ image: 'https://cdn.audnex.us/cover.jpg' }));
    expect(result.coverUrl).toBe('https://cdn.audnex.us/cover.jpg');
  });
});

// ── PUBLISHED YEAR ────────────────────────────────────────────────────────────

describe('mapAudNexusBook — publishedYear', () => {
  it('extracts year from ISO releaseDate', () => {
    const result = mapAudNexusBook(makeBook({ releaseDate: '2021-05-04T00:00:00Z' }));
    expect(result.publishedYear).toBe(2021);
  });

  it('returns undefined for invalid date', () => {
    const result = mapAudNexusBook(makeBook({ releaseDate: 'not-a-date' }));
    expect(result.publishedYear).toBeUndefined();
  });

  it('returns undefined when absent', () => {
    expect(mapAudNexusBook(makeBook()).publishedYear).toBeUndefined();
  });
});

// ── DURATION ─────────────────────────────────────────────────────────────────

describe('mapAudNexusBook — durationSeconds', () => {
  it('converts runtimeLengthMin to seconds', () => {
    const result = mapAudNexusBook(makeBook({ runtimeLengthMin: 450 }));
    expect(result.durationSeconds).toBe(27000);
  });

  it('returns undefined when runtimeLengthMin is absent', () => {
    expect(mapAudNexusBook(makeBook()).durationSeconds).toBeUndefined();
  });
});

// ── ABRIDGED ─────────────────────────────────────────────────────────────────

describe('mapAudNexusBook — abridged', () => {
  it('returns true when formatType is "abridged" (case-insensitive)', () => {
    expect(mapAudNexusBook(makeBook({ formatType: 'abridged' })).abridged).toBe(true);
    expect(mapAudNexusBook(makeBook({ formatType: 'Abridged' })).abridged).toBe(true);
  });

  it('returns false when formatType is "unabridged"', () => {
    expect(mapAudNexusBook(makeBook({ formatType: 'unabridged' })).abridged).toBe(false);
  });

  it('returns undefined when formatType is absent', () => {
    expect(mapAudNexusBook(makeBook()).abridged).toBeUndefined();
  });
});

// ── SERIES ───────────────────────────────────────────────────────────────────

describe('mapAudNexusBook — series', () => {
  it('maps seriesPrimary and numeric position from current payload', () => {
    const result = mapAudNexusBook(
      makeBook({
        seriesPrimary: { asin: 'B0SERIES', name: 'The Expanse', position: '3' },
      }),
    );
    expect(result.seriesName).toBe('The Expanse');
    expect(result.seriesIndex).toBe(3);
  });

  it('maps seriesName and numeric seriesPart', () => {
    const result = mapAudNexusBook(makeBook({ seriesName: 'The Expanse', seriesPart: '3' }));
    expect(result.seriesName).toBe('The Expanse');
    expect(result.seriesIndex).toBe(3);
  });

  it('handles decimal seriesPart', () => {
    const result = mapAudNexusBook(makeBook({ seriesPart: '1.5' }));
    expect(result.seriesIndex).toBe(1.5);
  });

  it('leaves seriesIndex undefined when seriesPart is absent', () => {
    const result = mapAudNexusBook(makeBook({ seriesName: 'A Series' }));
    expect(result.seriesIndex).toBeUndefined();
  });
});

// ── CHAPTERS ─────────────────────────────────────────────────────────────────

describe('mapAudNexusBook — chapters', () => {
  it('maps chapters from chaptersResponse', () => {
    const chaptersResponse: AudNexusChaptersResponse = {
      asin: 'B09ABCDEF1',
      chapters: [
        { title: 'Chapter 1', startOffsetMs: 0, startOffsetSec: 0, lengthMs: 300000 },
        { title: 'Chapter 2', startOffsetMs: 300000, startOffsetSec: 300, lengthMs: 400000 },
      ],
    };

    const result = mapAudNexusBook(makeBook(), chaptersResponse);
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters![0]).toEqual({ title: 'Chapter 1', startMs: 0, durationMs: 300000 });
    expect(result.chapters![1]).toEqual({ title: 'Chapter 2', startMs: 300000, durationMs: 400000 });
  });

  it('returns undefined chapters when chaptersResponse is absent', () => {
    const result = mapAudNexusBook(makeBook());
    expect(result.chapters).toBeUndefined();
  });

  it('returns undefined chapters when chaptersResponse has no chapters array', () => {
    const result = mapAudNexusBook(makeBook(), { asin: 'X' });
    expect(result.chapters).toBeUndefined();
  });
});
