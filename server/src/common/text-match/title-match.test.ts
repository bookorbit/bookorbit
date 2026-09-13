import { describe, expect, it } from 'vitest';

import {
  containsWord,
  normalizeTitleText,
  scoreTitleMatch,
  shareSignificantToken,
  significantTokens,
  startsWithWord,
  tokenizeTitleText,
} from './title-match';

describe('title-match', () => {
  describe('containsWord', () => {
    it('matches a whole word', () => {
      expect(containsWord('the hobbit cookbook', 'hobbit')).toBe(true);
    });

    it('matches at the start and at the end', () => {
      expect(containsWord('hobbit tales', 'hobbit')).toBe(true);
      expect(containsWord('tales hobbit', 'hobbit')).toBe(true);
    });

    it('does not match inside a longer word', () => {
      expect(containsWord('rubik cube solutions', 'ubik')).toBe(false);
      expect(containsWord('italian cooking basics', 'it')).toBe(false);
    });

    it('keeps scanning past a non-boundary hit to find a real one', () => {
      expect(containsWord('rubik ubik', 'ubik')).toBe(true);
    });

    it('rejects an empty needle', () => {
      expect(containsWord('anything', '')).toBe(false);
    });
  });

  describe('startsWithWord', () => {
    it('matches a leading whole word', () => {
      expect(startsWithWord('the hobbit or there and back again', 'the hobbit')).toBe(true);
    });

    it('matches an identical string', () => {
      expect(startsWithWord('dune', 'dune')).toBe(true);
    });

    it('does not match a partial leading word', () => {
      expect(startsWithWord('foundation and empire', 'found')).toBe(false);
    });
  });

  describe('significantTokens', () => {
    it('drops stopwords', () => {
      expect(significantTokens(['the', 'way', 'of', 'kings'])).toEqual(['way', 'kings']);
    });

    it('falls back to the raw tokens when every token is a stopword', () => {
      expect(significantTokens(['it'])).toEqual(['it']);
      expect(significantTokens(['the', 'the'])).toEqual(['the', 'the']);
    });
  });

  describe('scoreTitleMatch', () => {
    it('scores an exact match highest', () => {
      expect(scoreTitleMatch('Dune', 'dune')).toBe(10);
    });

    it('scores a subtitle extension as a prefix match', () => {
      expect(scoreTitleMatch('The Hobbit', 'The Hobbit: Or There and Back Again')).toBe(8);
    });

    it('scores a contained title as a substring match', () => {
      expect(scoreTitleMatch('The Fellowship of the Ring', 'The Lord of the Rings: The Fellowship of the Ring')).toBe(7);
    });

    it('gives no credit for sharing only stopwords', () => {
      expect(scoreTitleMatch('The Hobbit', 'The Girl on the Train')).toBe(0);
      expect(scoreTitleMatch('The Hobbit', 'The Silence of the Lambs')).toBe(0);
    });

    it('gives no credit for a minority of shared meaningful words', () => {
      expect(scoreTitleMatch('The Way of Kings', 'The Way We Were')).toBe(0);
    });

    it('credits full overlap of the meaningful words regardless of order', () => {
      expect(scoreTitleMatch('The Way of Kings', 'Kings Way')).toBe(6);
    });

    it('does not match a title inside an unrelated longer word', () => {
      expect(scoreTitleMatch('Ubik', 'Rubik Cube Solutions')).toBe(0);
      expect(scoreTitleMatch('It', 'Italian Cooking Basics')).toBe(0);
    });

    it('still tolerates a typo through fuzzy matching', () => {
      expect(scoreTitleMatch('Foundatun', 'Foundation')).toBeGreaterThan(0);
    });

    it('returns zero when either side is empty after normalization', () => {
      expect(scoreTitleMatch('', 'Dune')).toBe(0);
      expect(scoreTitleMatch('Dune', '???')).toBe(0);
    });
  });

  describe('shareSignificantToken', () => {
    it('matches an author across formatting differences', () => {
      expect(shareSignificantToken(['J.R.R. Tolkien'], ['Tolkien, J. R. R.'])).toBe(true);
    });

    it('does not match unrelated authors', () => {
      expect(shareSignificantToken(['J.R.R. Tolkien'], ['Paula Hawkins'])).toBe(false);
    });

    it('ignores short tokens such as initials', () => {
      expect(shareSignificantToken(['J. R. Smith'], ['J. R. Jones'])).toBe(false);
    });

    it('returns false when there is nothing significant to compare', () => {
      expect(shareSignificantToken([], ['Tolkien'])).toBe(false);
    });
  });

  describe('non-Latin scripts and diacritics', () => {
    it('matches identical titles written in a non-Latin script', () => {
      expect(scoreTitleMatch('こころ', 'こころ')).toBe(10);
      expect(scoreTitleMatch('战争与和平', '战争与和平')).toBe(10);
      expect(scoreTitleMatch('Война и мир', 'Война и мир')).toBe(10);
      expect(scoreTitleMatch('Ο Άρχοντας των Δαχτυλιδιών', 'Ο Άρχοντας των Δαχτυλιδιών')).toBe(10);
    });

    it('keeps a non-Latin title scoreable rather than emptying it', () => {
      expect(normalizeTitleText('こころ')).toBe('こころ');
      expect(normalizeTitleText('夏目漱石')).toBe('夏目漱石');
    });

    it('folds diacritics so transliteration differences still match', () => {
      expect(scoreTitleMatch('Sōseki', 'Soseki')).toBe(10);
      expect(scoreTitleMatch('Les Misérables', 'Les Miserables')).toBe(10);
      expect(scoreTitleMatch('Die Vermessung der Welt', 'Die Vermessung der Welt')).toBe(10);
    });

    it('still separates different non-Latin titles', () => {
      expect(scoreTitleMatch('こころ', '吾輩は猫である')).toBe(0);
    });

    it('matches an author name across a diacritic difference', () => {
      expect(shareSignificantToken(['Natsume Sōseki'], ['Natsume Soseki'])).toBe(true);
    });
  });

  describe('normalizeTitleText and tokenizeTitleText', () => {
    it('lowercases, strips punctuation, and collapses whitespace', () => {
      expect(normalizeTitleText('  The   Hobbit: Or, There & Back Again!  ')).toBe('the hobbit or there back again');
    });

    it('drops single-character tokens', () => {
      expect(tokenizeTitleText('a tale of 2 cities')).toEqual(['tale', 'of', 'cities']);
    });
  });
});
