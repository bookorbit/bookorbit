import { describe, expect, it } from 'vitest';
import { normalizeKoboLanguage, selectKoboIsbn } from './kobo-metadata.utils';

describe('normalizeKoboLanguage', () => {
  it.each([
    ['English', 'en'],
    ['english', 'en'],
    [' en ', 'en'],
    ['eng', 'en'],
    ['en-US', 'en'],
    ['EN_us', 'en'],
    ['Spanish; Castilian', 'es'],
    ['Espa\u00f1ol', 'es'],
    ['deu', 'de'],
    ['ger', 'de'],
    ['zh-Hant', 'zh'],
  ])('normalizes %j to %s', (value, expected) => {
    expect(normalizeKoboLanguage(value)).toBe(expected);
  });

  it.each([null, '', '   ', 'Custom language'])('falls back to English for unsupported value %j', (value) => {
    expect(normalizeKoboLanguage(value)).toBe('en');
  });
});

describe('selectKoboIsbn', () => {
  it('prefers a valid normalized ISBN-13 over ISBN-10', () => {
    expect(selectKoboIsbn('978-0-306-40615-7', '0-306-40615-2')).toBe('9780306406157');
  });

  it('falls back to a valid ISBN-10, including an X check digit', () => {
    expect(selectKoboIsbn(null, '0-9752298-0-X')).toBe('097522980X');
    expect(selectKoboIsbn('9780306406158', '0306406152')).toBe('0306406152');
  });

  it.each([
    [null, null],
    ['', ''],
    ['9780306406158', null],
    [null, '0306406153'],
  ])('returns null when neither ISBN is valid', (isbn13, isbn10) => {
    expect(selectKoboIsbn(isbn13, isbn10)).toBeNull();
  });
});
