import { canonicalizeIsbn, isbn10ToIsbn13, isValidIsbn10, isValidIsbn13, mediaFamilyForFormat, normalizeIsbn } from './book-duplicate-normalize';

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
    expect(mediaFamilyForFormat('cbz')).toBe('comic');
    expect(mediaFamilyForFormat('m4b')).toBe('audiobook');
    expect(mediaFamilyForFormat(null)).toBe('unknown');
    expect(mediaFamilyForFormat('txt')).toBe('unknown');
  });
});
