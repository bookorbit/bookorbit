import { getCoverMedia } from '@bookorbit/types';
import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import { bookMetadata, books } from '../../db/schema';
import {
  activeCoverSlotSql,
  coverMediaSql,
  didKoboCoverChange,
  getCoverMediaFromDatabaseFiles,
  type BookCoverSlotRow,
} from './book-cover-store.repository';

const fixtures = [
  { name: 'plain ebook', files: [{ format: 'epub', role: 'content', mediaOverlayAvailable: false }], expected: { hasEbook: true, hasAudio: false } },
  { name: 'audiobook', files: [{ format: 'm4b', role: 'primary', mediaOverlayAvailable: false }], expected: { hasEbook: false, hasAudio: true } },
  {
    name: 'mixed media',
    files: [
      { format: 'pdf', role: 'content', mediaOverlayAvailable: false },
      { format: 'mp3', role: 'content', mediaOverlayAvailable: false },
    ],
    expected: { hasEbook: true, hasAudio: true },
  },
  {
    name: 'EPUB media overlay',
    files: [{ format: 'epub', role: 'content', mediaOverlayAvailable: true }],
    expected: { hasEbook: true, hasAudio: true },
  },
  {
    name: 'non-content files',
    files: [{ format: 'jpg', role: 'cover', mediaOverlayAvailable: false }],
    expected: { hasEbook: false, hasAudio: false },
  },
] as const;

describe('cover media parity', () => {
  it.each(fixtures)('$name', ({ files, expected }) => {
    expect(getCoverMedia(files.map((file) => ({ ...file, mediaOverlay: file.mediaOverlayAvailable ? { available: true } : null })))).toEqual(
      expected,
    );
    expect(getCoverMediaFromDatabaseFiles(files)).toEqual(expected);
  });
});

describe('cover media SQL', () => {
  // Rendering only; the connection string is never dialled.
  const db = drizzle('postgres://unused@localhost:1/unused', { schema });

  it('ties the subqueries to the outer book even when the outer query reads a single table', () => {
    const { hasEbook, hasAudio } = coverMediaSql(books.id);
    const fromBooks = db.select({ hasEbook, hasAudio }).from(books).toSQL().sql;
    expect(fromBooks.match(/"book_id" = "books"\."id"/g)).toHaveLength(2);
    expect(fromBooks).not.toMatch(/= "id"/);

    const fromMetadata = db
      .select({ audio: activeCoverSlotSql(bookMetadata.bookId, 'audio'), hasAudio: coverMediaSql(bookMetadata.bookId).hasAudio })
      .from(bookMetadata)
      .toSQL().sql;
    expect(fromMetadata.match(/"book_id" = "book_metadata"\."book_id"/g)).toHaveLength(2);
  });

  it('binds a literal book id as a parameter', () => {
    const query = db
      .select({ audio: activeCoverSlotSql(42, 'audio') })
      .from(books)
      .toSQL();
    expect(query.params).toContain(42);
  });
});

function slot(medium: 'ebook' | 'audio'): BookCoverSlotRow {
  return {
    bookId: 1,
    medium,
    source: 'extracted',
    origin: 'embedded',
    width: null,
    height: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    dormantSince: null,
  };
}

describe('Kobo-visible cover changes', () => {
  const mixedMedia = { hasEbook: true, hasAudio: true };

  it('does not move the Kobo stamp when only the audio slot bytes change behind an ebook slot', () => {
    const rows = [slot('ebook'), slot('audio')];
    expect(didKoboCoverChange(rows, rows, mixedMedia, 'audio', true)).toBe(false);
  });

  it('moves the Kobo stamp when deleting the ebook slot falls back to audio', () => {
    expect(didKoboCoverChange([slot('ebook'), slot('audio')], [slot('audio')], mixedMedia, 'ebook', true)).toBe(true);
  });

  it('moves the Kobo stamp when the ebook leaves and its slot goes dormant behind an audio slot', () => {
    const dormantEbook = { ...slot('ebook'), dormantSince: new Date('2026-02-01T00:00:00.000Z') };

    expect(
      didKoboCoverChange(
        [slot('ebook'), slot('audio')],
        [dormantEbook, slot('audio')],
        { hasEbook: false, hasAudio: true },
        'ebook',
        false,
        mixedMedia,
      ),
    ).toBe(true);
  });

  it('leaves the Kobo stamp alone when the audio slot goes dormant behind an ebook slot', () => {
    const dormantAudio = { ...slot('audio'), dormantSince: new Date('2026-02-01T00:00:00.000Z') };

    expect(
      didKoboCoverChange(
        [slot('ebook'), slot('audio')],
        [slot('ebook'), dormantAudio],
        { hasEbook: true, hasAudio: false },
        'audio',
        false,
        mixedMedia,
      ),
    ).toBe(false);
  });
});
