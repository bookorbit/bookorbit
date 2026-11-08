import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  canonicalizeIsbn,
  canonicalSeriesIndex,
  crossFormatPersonKey,
  crossFormatTitleKey,
  isbn10ToIsbn13,
  isValidIsbn10,
  isValidIsbn13,
  mediaFamilyForFormat,
  mediaFamilySql,
  normalizeIsbn,
} from './book-duplicate-normalize';

describe('book duplicate normalization', () => {
  it('canonicalizes equivalent valid ISBN-10 and ISBN-13 values', () => {
    expect(isValidIsbn10('0306406152')).toBe(true);
    expect(isValidIsbn13('9780306406157')).toBe(true);
    expect(isbn10ToIsbn13('0306406152')).toBe('9780306406157');
    expect(canonicalizeIsbn('0-306-40615-2', null)).toBe('9780306406157');
    expect(canonicalizeIsbn(null, '978-0-306-40615-7')).toBe('9780306406157');
  });

  it('rejects malformed and checksum-invalid ISBN values', () => {
    expect(normalizeIsbn(null)).toBeNull();
    expect(normalizeIsbn('---')).toBeNull();
    expect(normalizeIsbn('0-8044-2957-x')).toBe('080442957X');
    expect(isValidIsbn10('short')).toBe(false);
    expect(isValidIsbn10('080442957X')).toBe(true);
    expect(isValidIsbn13('9780306406158')).toBe(false);
    expect(canonicalizeIsbn('0306406153', '9780306406158')).toBeNull();
    expect(canonicalizeIsbn(null, '1230306406157')).toBeNull();
  });

  it('maps formats into duplicate media families', () => {
    expect(mediaFamilyForFormat('EPUB')).toBe('ebook');
    expect(mediaFamilyForFormat('DJVU')).toBe('ebook');
    expect(mediaFamilyForFormat('cbz')).toBe('comic');
    expect(mediaFamilyForFormat('m4b')).toBe('audiobook');
    expect(mediaFamilyForFormat(null)).toBe('unknown');
    expect(mediaFamilyForFormat('txt')).toBe('unknown');
  });

  it('builds the SQL family mapping from the same format lists', () => {
    const query = new PgDialect().sqlToQuery(mediaFamilySql(sql`f.format`));

    expect(query.sql).toContain("WHEN lower(coalesce(f.format, '')) IN (");
    expect(query.sql).toContain("'m4b'");
    expect(query.sql).toContain("THEN 'audiobook'");
    expect(query.sql).toContain("'cbz'");
    expect(query.sql).toContain("ELSE 'unknown' END");
    expect(query.params).toEqual([]);
  });

  describe('cross-format title key (H10)', () => {
    const hobbit = crossFormatTitleKey('The Hobbit');

    it.each([
      'The Hobbit (Unabridged)',
      'The Hobbit: Unabridged',
      'The Hobbit [Unabridged]',
      'The Hobbit - Unabridged Audiobook',
      'The Hobbit, Unabridged',
      'THE HOBBIT',
      'The Hobbit: or There and Back Again',
      'The Hobbit: A Novel',
      'The Hobbit (Abridged)',
      'The Hobbit (Audio Book)',
    ])('matches %s to the ebook title', (title) => {
      expect(crossFormatTitleKey(title)).toBe(hobbit);
    });

    it('keeps the title when nothing precedes the colon', () => {
      expect(crossFormatTitleKey(': Dune')).toBe(crossFormatTitleKey('Dune'));
    });

    it('does not strip a marker inside another word', () => {
      expect(crossFormatTitleKey('Unabridgedness')).not.toBe('');
      expect(crossFormatTitleKey('Unabridgedness')).toBe('unabridgedness');
    });

    it('keeps distinct works apart', () => {
      expect(crossFormatTitleKey('The Two Towers')).not.toBe(crossFormatTitleKey('The Return of the King'));
    });

    it('folds accents and punctuation the same way on both sides', () => {
      expect(crossFormatTitleKey('Les Misérables (Unabridged)')).toBe(crossFormatTitleKey('Les Miserables'));
    });

    it('has no key for an empty title', () => {
      expect(crossFormatTitleKey('   ')).toBe('');
      expect(crossFormatTitleKey(null)).toBe('');
    });
  });

  it('matches an author on one side with a narrator spelled differently on the other', () => {
    expect(crossFormatPersonKey('Neil Gaiman')).toBe(crossFormatPersonKey('neil  gaiman'));
    expect(crossFormatPersonKey('J.R.R. Tolkien')).toBe(crossFormatPersonKey('JRR Tolkien'));
    expect(crossFormatPersonKey('')).toBe('');
  });

  it.each([
    ['1', '1'],
    ['01', '1'],
    ['1.0', '1'],
    [' 2.50 ', '2.5'],
    ['0.5', '0.5'],
  ])('canonicalizes series index %s to %s', (index, expected) => {
    expect(canonicalSeriesIndex(index)).toBe(expected);
  });

  it('has no series position for a blank or non-numeric index', () => {
    expect(canonicalSeriesIndex(null)).toBeNull();
    expect(canonicalSeriesIndex('  ')).toBeNull();
    expect(canonicalSeriesIndex('II')).toBeNull();
  });
});
