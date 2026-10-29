import { describe, expect, it } from 'vitest';

import { authorKeys, koreaderAuthorKeys, linkSuggestionTextKey, sameAuthorKeys } from './koreader-link-suggestion.utils';

describe('linkSuggestionTextKey', () => {
  it('folds case, compatibility forms and whitespace only', () => {
    expect(linkSuggestionTextKey('  The   Hobbit\t')).toBe('the hobbit');
    expect(linkSuggestionTextKey('ＴＨＥ Ｈｏｂｂｉｔ')).toBe('the hobbit');
    expect(linkSuggestionTextKey('Ofﬁce')).toBe('office');
  });

  it('keeps punctuation, so near-identical titles stay distinct', () => {
    expect(linkSuggestionTextKey("Ender's Game")).not.toBe(linkSuggestionTextKey('Ender’s Game'));
    expect(linkSuggestionTextKey('It')).not.toBe(linkSuggestionTextKey('It!'));
    expect(linkSuggestionTextKey('Dune: Messiah')).not.toBe(linkSuggestionTextKey('Dune Messiah'));
  });

  it('returns null for missing or blank values', () => {
    expect(linkSuggestionTextKey(null)).toBeNull();
    expect(linkSuggestionTextKey(undefined)).toBeNull();
    expect(linkSuggestionTextKey('   ')).toBeNull();
  });
});

describe('author keys', () => {
  it('splits KOReader authors on new lines and ignores order, case and duplicates', () => {
    expect(koreaderAuthorKeys('Bo Sample\nAda  Tester\n\nada tester')).toEqual(['ada tester', 'bo sample']);
    expect(authorKeys(['Ada Tester', 'Bo Sample'])).toEqual(['ada tester', 'bo sample']);
  });

  it('does not split on commas, which belong to "Last, First" names', () => {
    expect(koreaderAuthorKeys('Tester, Ada')).toEqual(['tester, ada']);
  });

  it('compares author sets exactly', () => {
    expect(sameAuthorKeys(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameAuthorKeys(['a'], ['a', 'b'])).toBe(false);
    expect(sameAuthorKeys(['a', 'b'], ['a'])).toBe(false);
    expect(sameAuthorKeys([], [])).toBe(false);
  });
});
