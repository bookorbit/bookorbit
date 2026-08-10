import { describe, expect, it } from 'vitest';

import { isPagedReadingFormat, parseKoreaderPageNumber } from './koreader-progress-position.util';

describe('isPagedReadingFormat', () => {
  it.each(['pdf', 'PDF', 'cbz', 'cbr', 'cb7', 'cbx', 'CBZ'])('treats %s as paged', (format) => {
    expect(isPagedReadingFormat(format)).toBe(true);
  });

  it.each(['epub', 'mobi', 'azw3', 'azw', 'fb2', 'txt', 'EPUB'])('treats %s as reflowable', (format) => {
    expect(isPagedReadingFormat(format)).toBe(false);
  });

  it.each(['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'])('treats %s as non-paged', (format) => {
    expect(isPagedReadingFormat(format)).toBe(false);
  });

  it.each([null, undefined, '', '   ', 'djvu'])('falls back to non-paged for %s', (format) => {
    expect(isPagedReadingFormat(format)).toBe(false);
  });
});

describe('parseKoreaderPageNumber', () => {
  it('parses the page number KOReader sends for a paged document', () => {
    expect(parseKoreaderPageNumber('117')).toBe(117);
  });

  it('accepts the first page', () => {
    expect(parseKoreaderPageNumber('1')).toBe(1);
  });

  it('tolerates surrounding whitespace and leading zeros', () => {
    expect(parseKoreaderPageNumber('  42  ')).toBe(42);
    expect(parseKoreaderPageNumber('0042')).toBe(42);
  });

  it('rejects an xpointer that reached a paged file by mistake', () => {
    expect(parseKoreaderPageNumber('/body/DocFragment[8]/body/p[12]/text().0')).toBeNull();
  });

  it.each([null, undefined, '', '   '])('returns null for %s so the stored page is cleared', (progress) => {
    expect(parseKoreaderPageNumber(progress)).toBeNull();
  });

  it.each(['0', '-1', '-12'])('rejects %s because KOReader pages start at 1', (progress) => {
    expect(parseKoreaderPageNumber(progress)).toBeNull();
  });

  it.each(['12.5', '12.0', '1e3', '0x2a', '4 2', '12abc', 'NaN', 'Infinity', '+7'])('rejects the non-integer %s', (progress) => {
    expect(parseKoreaderPageNumber(progress)).toBeNull();
  });

  it('accepts the largest page a PostgreSQL integer column can hold', () => {
    expect(parseKoreaderPageNumber('2147483647')).toBe(2_147_483_647);
  });

  it('rejects a page that would overflow the integer column', () => {
    expect(parseKoreaderPageNumber('2147483648')).toBeNull();
  });

  it('rejects a digit string too long to survive as a safe integer', () => {
    expect(parseKoreaderPageNumber('9'.repeat(400))).toBeNull();
  });

  it('rejects non-string input defensively', () => {
    expect(parseKoreaderPageNumber(42 as unknown as string)).toBeNull();
  });
});
