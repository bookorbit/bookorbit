import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import {
  IDENTIFIER_INPUT_KIND_BY_FIELD,
  identifierInputKindForField,
  normalizeAsinInput,
  normalizeIdentifierInput,
  normalizeIsbnInput,
  normalizeProviderIdInput,
} from '@bookorbit/types';

import { PROVIDER_ID_MAX_LENGTHS } from '../utils/provider-id.utils';
import { NormalizeIdentifier } from './normalize-identifier.decorator';

const INVISIBLE_CHARACTERS = {
  'zero-width space': '\u200B',
  'zero-width non-joiner': '\u200C',
  'zero-width joiner': '\u200D',
  'left-to-right mark': '\u200E',
  'right-to-left mark': '\u200F',
  'left-to-right embedding': '\u202A',
  'pop directional formatting': '\u202C',
  'left-to-right isolate': '\u2066',
  'word joiner': '\u2060',
  'byte-order mark': '\uFEFF',
  'soft hyphen': '\u00AD',
  'null character': '\u0000',
  'delete character': '\u007F',
};

const WHITESPACE_CHARACTERS = {
  space: ' ',
  tab: '\t',
  'line feed': '\n',
  'carriage return': '\r',
  'no-break space': '\u00A0',
  'thin space': '\u2009',
  'narrow no-break space': '\u202F',
  'ideographic space': '\u3000',
  'line separator': '\u2028',
};

describe('normalizeIsbnInput', () => {
  it('removes the hyphens Amazon prints in an ISBN-13', () => {
    expect(normalizeIsbnInput('978-3426226223')).toBe('9783426226223');
    expect(normalizeIsbnInput('978-3-426-22622-3')).toBe('9783426226223');
  });

  it('removes every dash and separator an ISBN is printed with', () => {
    for (const separator of ['-', '\u2010', '\u2011', '\u2012', '\u2013', '\u2212', '\uFE63', '\uFF0D', '.', '/', '_', '\u00B7']) {
      expect({ separator, value: normalizeIsbnInput(`978${separator}0${separator}306${separator}40615${separator}7`) }).toEqual({
        separator,
        value: '9780306406157',
      });
    }
  });

  it.each(Object.entries(INVISIBLE_CHARACTERS))('removes a %s wherever it appears', (_name, character) => {
    expect(normalizeIsbnInput(`${character}978030640615${character}7${character}`)).toBe('9780306406157');
  });

  it.each(Object.entries(WHITESPACE_CHARACTERS))('removes a %s wherever it appears', (_name, character) => {
    expect(normalizeIsbnInput(`${character}978 0306${character}406157${character}`)).toBe('9780306406157');
  });

  it('upper-cases the ISBN-10 check character', () => {
    expect(normalizeIsbnInput('0-8044-2957-x')).toBe('080442957X');
    expect(normalizeIsbnInput('080442957X')).toBe('080442957X');
  });

  it('folds full-width digits, hyphens and check characters to ASCII', () => {
    expect(normalizeIsbnInput('\uFF19\uFF17\uFF18\uFF0D\uFF14\uFF10\uFF18\uFF18\uFF10\uFF16\uFF16\uFF13\uFF17\uFF16')).toBe('9784088066376');
    expect(normalizeIsbnInput('080442957\uFF58')).toBe('080442957X');
  });

  it('drops a numbered ISBN label together with its digits', () => {
    expect(normalizeIsbnInput('ISBN-13 : 978-3426226223')).toBe('9783426226223');
    expect(normalizeIsbnInput('ISBN13: 9783426226223')).toBe('9783426226223');
    expect(normalizeIsbnInput('ISBN 13: 9783426226223')).toBe('9783426226223');
    expect(normalizeIsbnInput('isbn-10: 0-306-40615-2')).toBe('0306406152');
    expect(normalizeIsbnInput('ISBN\u201013\uFF1A978-3426226223')).toBe('9783426226223');
    expect(normalizeIsbnInput('\u200BISBN-13 : 978-3426226223')).toBe('9783426226223');
  });

  it('drops a bare ISBN label', () => {
    expect(normalizeIsbnInput('ISBN 978-3-426-22622-3')).toBe('9783426226223');
    expect(normalizeIsbnInput('ISBN: 0-306-40615-2')).toBe('0306406152');
  });

  it('keeps the leading digits of an ISBN-10 that starts with 10 or 13', () => {
    expect(normalizeIsbnInput('1302123456')).toBe('1302123456');
    expect(normalizeIsbnInput('13-02123456')).toBe('1302123456');
    expect(normalizeIsbnInput('ISBN 1302123456')).toBe('1302123456');
    expect(normalizeIsbnInput('ISBN: 1034567890')).toBe('1034567890');
    expect(normalizeIsbnInput('ISBN-1302123456')).toBe('1302123456');
  });

  it('never truncates an over-long value', () => {
    expect(normalizeIsbnInput('978-3426226223-0000')).toBe('97834262262230000');
    expect(normalizeIsbnInput('9'.repeat(40))).toBe('9'.repeat(40));
  });

  it('returns an empty string when nothing of the identifier remains', () => {
    expect(normalizeIsbnInput('')).toBe('');
    expect(normalizeIsbnInput(' \u200B\uFEFF\t')).toBe('');
    expect(normalizeIsbnInput('---')).toBe('');
  });

  it('is idempotent', () => {
    for (const value of ['978-3426226223', '\u200BISBN-13 : 978-3426226223', '0-8044-2957-x', 'ISBN 1302123456', '']) {
      const once = normalizeIsbnInput(value);
      expect(normalizeIsbnInput(once)).toBe(once);
    }
  });
});

describe('normalizeAsinInput', () => {
  it('removes the zero-width space Amazon copies in front of an ASIN', () => {
    expect(normalizeAsinInput('\u200BB00X47ZVXM')).toBe('B00X47ZVXM');
  });

  it.each(Object.entries(INVISIBLE_CHARACTERS))('removes a %s wherever it appears', (_name, character) => {
    expect(normalizeAsinInput(`${character}B00X4${character}7ZVXM${character}`)).toBe('B00X47ZVXM');
  });

  it.each(Object.entries(WHITESPACE_CHARACTERS))('removes a %s wherever it appears', (_name, character) => {
    expect(normalizeAsinInput(`${character}B00X4${character}7ZVXM${character}`)).toBe('B00X47ZVXM');
  });

  it('removes separators and upper-cases the result', () => {
    expect(normalizeAsinInput('b00x-47zv-xm')).toBe('B00X47ZVXM');
    expect(normalizeAsinInput('B00X47ZVXM.')).toBe('B00X47ZVXM');
  });

  it('keeps an ISBN-10 shaped ASIN intact, including its check character', () => {
    expect(normalizeAsinInput('0-8044-2957-x')).toBe('080442957X');
  });

  it('folds full-width characters to ASCII', () => {
    expect(normalizeAsinInput('\uFF22\uFF10\uFF10\uFF58\uFF14\uFF17\uFF3A\uFF36\uFF38\uFF2D')).toBe('B00X47ZVXM');
  });

  it('never truncates an over-long value', () => {
    expect(normalizeAsinInput('B00X47ZVXM-B00X47ZVXM')).toBe('B00X47ZVXMB00X47ZVXM');
  });

  it('is idempotent', () => {
    for (const value of ['\u200Bb00x47zvxm ', 'B00X47ZVXM', '']) {
      const once = normalizeAsinInput(value);
      expect(normalizeAsinInput(once)).toBe(once);
    }
  });
});

describe('normalizeProviderIdInput', () => {
  it.each(Object.entries(INVISIBLE_CHARACTERS))('removes a %s wherever it appears', (_name, character) => {
    expect(normalizeProviderIdInput(`${character}zyTC${character}AlFPjgYC${character}`)).toBe('zyTCAlFPjgYC');
  });

  it.each(Object.entries(WHITESPACE_CHARACTERS))('removes a %s wherever it appears', (_name, character) => {
    expect(normalizeProviderIdInput(`${character}12345${character}678${character}`)).toBe('12345678');
  });

  it('keeps the punctuation and case that provider ids legitimately use', () => {
    expect(normalizeProviderIdInput('zyTC-Al_FPjgYC')).toBe('zyTC-Al_FPjgYC');
    expect(normalizeProviderIdInput('the-name-of-the-wind')).toBe('the-name-of-the-wind');
    expect(normalizeProviderIdInput('OL7353617M')).toBe('OL7353617M');
    expect(normalizeProviderIdInput('12345.The_Book')).toBe('12345.The_Book');
  });

  it('never truncates an over-long value', () => {
    expect(normalizeProviderIdInput(` ${'a'.repeat(600)} `)).toBe('a'.repeat(600));
  });
});

describe('normalizeIdentifierInput', () => {
  it('applies the rule for the requested kind', () => {
    expect(normalizeIdentifierInput('isbn', ' 978-3426226223 ')).toBe('9783426226223');
    expect(normalizeIdentifierInput('asin', '\u200Bb00x47zvxm')).toBe('B00X47ZVXM');
    expect(normalizeIdentifierInput('provider-id', '\u200Bzy-TC ')).toBe('zy-TC');
  });
});

describe('identifierInputKindForField', () => {
  it('cleans ISBNs as ISBNs and Amazon and Audible ids as ASINs', () => {
    expect(identifierInputKindForField('isbn10')).toBe('isbn');
    expect(identifierInputKindForField('isbn13')).toBe('isbn');
    expect(identifierInputKindForField('amazonId')).toBe('asin');
    expect(identifierInputKindForField('audibleId')).toBe('asin');
  });

  // A provider id column without a rule would reach the DTO decorator and throw at boot.
  it('has a rule for every stored provider id', () => {
    for (const field of Object.keys(PROVIDER_ID_MAX_LENGTHS)) {
      expect({ field, kind: identifierInputKindForField(field) }).toEqual({ field, kind: expect.any(String) });
    }
    expect(Object.keys(IDENTIFIER_INPUT_KIND_BY_FIELD).sort()).toEqual([...Object.keys(PROVIDER_ID_MAX_LENGTHS), 'isbn10', 'isbn13'].sort());
  });

  it('returns null for fields that are not identifiers, including inherited object keys', () => {
    for (const field of ['title', 'publisher', 'toString', 'constructor', '__proto__', 'hasOwnProperty', '']) {
      expect({ field, kind: identifierInputKindForField(field) }).toEqual({ field, kind: null });
    }
  });
});

describe('NormalizeIdentifier', () => {
  class IdentifierProbe {
    @NormalizeIdentifier() isbn13?: unknown;
    @NormalizeIdentifier() amazonId?: unknown;
    @NormalizeIdentifier() googleBooksId?: unknown;
  }

  it('cleans each string by the rule its property name selects', () => {
    const probe = plainToInstance(IdentifierProbe, {
      isbn13: '\u200B978-3426226223',
      amazonId: '\u200Bb00x47zvxm ',
      googleBooksId: ' zyTC-Al_FPjgYC\u200E',
    });

    expect(probe).toEqual({ isbn13: '9783426226223', amazonId: 'B00X47ZVXM', googleBooksId: 'zyTC-Al_FPjgYC' });
  });

  it('passes non-string values through for the validators to judge', () => {
    expect(plainToInstance(IdentifierProbe, { isbn13: null, amazonId: 9780306406157, googleBooksId: ['x'] })).toEqual({
      isbn13: null,
      amazonId: 9780306406157,
      googleBooksId: ['x'],
    });
    expect(plainToInstance(IdentifierProbe, {}).isbn13).toBeUndefined();
  });

  it('refuses a property that has no identifier rule', () => {
    expect(() => NormalizeIdentifier()(Object.prototype, 'title')).toThrow('@NormalizeIdentifier() has no identifier rule for "title"');
  });
});
