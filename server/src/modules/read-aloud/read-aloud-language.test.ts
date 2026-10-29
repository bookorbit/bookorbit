import { languageSubtagOf, READ_ALOUD_QUARTZNET_LANGUAGES } from '@bookorbit/types';
import { describe, expect, it } from 'vitest';

describe('languageSubtagOf', () => {
  it.each([
    ['English', 'en'],
    ['english', 'en'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['eng', 'en'],
    ['ja-jp', 'ja'],
    ['Spanish', 'es'],
    ['español', 'es'],
    ['Deutsch', 'de'],
    ['ger', 'de'],
  ])('reads %s as %s', (value, code) => {
    expect(languageSubtagOf(value)).toBe(code);
  });

  it('names nothing for empty, undetermined and unrecognised values', () => {
    for (const value of [null, undefined, '', '  ', 'und', 'UND', 'mul', 'zxx', 'Klingon', 'not a language']) {
      expect(languageSubtagOf(value)).toBeNull();
    }
  });

  it('matches names of languages the request list does not offer when asked to', () => {
    expect(languageSubtagOf('Faroese')).toBeNull();
    expect(languageSubtagOf('Faroese', READ_ALOUD_QUARTZNET_LANGUAGES)).toBe('fo');
    expect(languageSubtagOf('Kazakh', READ_ALOUD_QUARTZNET_LANGUAGES)).toBe('kk');
  });
});
