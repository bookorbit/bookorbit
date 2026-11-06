import { describe, expect, it } from 'vitest';

import {
  authorScore,
  bestAuthorName,
  coverLines,
  coverPhrases,
  normalizeCoverText,
  normalizeIsbn,
  rankCandidates,
  trigramSimilarity,
  type VisualMatchCandidate,
  wordSimilarity,
} from './visual-match.core';

const book = (bookId: number, title: string, authors: string[], subtitle: string | null = null): VisualMatchCandidate => ({
  bookId,
  title,
  subtitle,
  authors,
});

const LIBRARY: VisualMatchCandidate[] = [
  book(1, 'The Name of the Wind', ['Patrick Rothfuss']),
  book(2, "The Wise Man's Fear", ['Patrick Rothfuss']),
  book(3, 'Dune', ['Frank Herbert']),
  book(4, 'Dune Messiah', ['Frank Herbert']),
  book(5, 'It', ['Stephen King']),
  book(6, 'Emma', ['Jane Austen']),
  book(7, 'Project Hail Mary', ['Andy Weir']),
  book(8, 'Atomic Habits', ['James Clear'], 'An Easy & Proven Way to Build Good Habits & Break Bad Ones'),
  book(9, 'Les Misérables', ['Victor Hugo']),
  book(10, 'The Name of the Rose', ['Umberto Eco']),
];

const ids = (lines: string[], candidates = LIBRARY) => rankCandidates(candidates, lines, 4).map((score) => score.bookId);

describe('normalizeCoverText', () => {
  it('folds case, accents, apostrophes and punctuation', () => {
    expect(normalizeCoverText('  LES MISÉRABLES  ')).toBe('les miserables');
    expect(normalizeCoverText('ENDER’S GAME')).toBe('enders game');
    expect(normalizeCoverText('Pride & Prejudice!')).toBe('pride and prejudice');
    expect(normalizeCoverText('ﬁre\u2014and blood')).toBe('fire and blood');
  });
});

describe('coverLines', () => {
  it('drops a line that points at another book, and the title on the line after it', () => {
    expect(coverLines(['Author of', 'THE NAME OF THE WIND', "THE WISE MAN'S FEAR", 'PATRICK ROTHFUSS'])).toEqual([
      'the wise mans fear',
      'patrick rothfuss',
    ]);
  });

  it('drops the reference line alone when it carries the other title itself', () => {
    expect(coverLines(['From the author of The Martian', 'PROJECT HAIL MARY', 'ANDY WEIR'])).toEqual(['project hail mary', 'andy weir']);
  });

  it('takes off a leading "by", and drops numbers and repeats', () => {
    expect(coverLines(['DUNE', '1965', 'by Frank Herbert', 'Dune'])).toEqual(['dune', 'frank herbert']);
  });
});

describe('coverPhrases', () => {
  it('joins runs of up to three adjacent lines', () => {
    expect(coverPhrases(['a b', 'c', 'd', 'e']).map((phrase) => phrase.text)).toEqual([
      'a b',
      'a b c',
      'a b c d',
      'c',
      'c d',
      'c d e',
      'd',
      'd e',
      'e',
    ]);
  });
});

describe('trigramSimilarity', () => {
  it('is 1 for equal text and 0 for text with nothing in common', () => {
    expect(trigramSimilarity('dune', 'dune')).toBe(1);
    expect(trigramSimilarity('dune', 'xyz')).toBe(0);
  });
});

describe('wordSimilarity', () => {
  it('forgives one wrong letter and digits read for letters', () => {
    expect(wordSimilarity('mary', 'marv')).toBe(0.75);
    expect(wordSimilarity('project', 'pr0ject')).toBe(1);
    expect(wordSimilarity('1984', '1984')).toBe(1);
    expect(wordSimilarity('wind', 'rose')).toBe(0);
  });
});

describe('rankCandidates', () => {
  it('finds a cover that prints the title and the author', () => {
    expect(ids(['THE NAME OF THE WIND', 'PATRICK ROTHFUSS'])).toEqual([1]);
  });

  it('joins a title broken over several lines', () => {
    expect(ids(['THE NAME', 'OF THE', 'WIND', 'Patrick Rothfuss'])).toEqual([1]);
  });

  it('finds a title printed with a series name on the same line', () => {
    expect(ids(['The Kingkiller Chronicle: Day One The Name of the Wind'])).toEqual([1]);
  });

  it('ignores the other book a cover names as the author’s earlier work', () => {
    expect(ids(['#1 New York Times bestseller', "THE WISE MAN'S FEAR", 'Author of', 'The Name of the Wind', 'PATRICK ROTHFUSS'])).toEqual([2]);
  });

  it('survives misread letters', () => {
    expect(ids(['PR0JECT HAIL MARV', 'ANDY WElR'])).toEqual([7]);
  });

  it('matches a long title on its own, without an author in the photo', () => {
    expect(ids(['PROJECT HAIL MARY'])).toEqual([7]);
  });

  it('needs the author for a one-word title', () => {
    expect(ids(['IT'])).toEqual([]);
    expect(ids(['EMMA'])).toEqual([]);
    expect(ids(['IT', 'STEPHEN KING'])).toEqual([5]);
    expect(ids(['DUNE', 'HERBERT'])).toEqual([3]);
  });

  it('prefers the exact title over a longer one that starts the same way', () => {
    expect(ids(['DUNE', 'FRANK HERBERT'])[0]).toBe(3);
    expect(ids(['DUNE MESSIAH', 'FRANK HERBERT'])[0]).toBe(4);
  });

  it('puts the longer of two titles the lines read in full first', () => {
    const games = [book(20, 'Resident Evil', ['S. D. Perry']), book(21, 'Resident Evil 4 (Underworld)', ['S. D. Perry'])];
    expect(ids(['RESIDENT EVIL', '4 (UNDERWORLD)', 'S.D. PERRY'], games)).toEqual([21, 20]);
  });

  it('finds a title with its subtitle and accents', () => {
    expect(ids(['atomic habits', 'An Easy & Proven Way to Build Good Habits & Break Bad Ones', 'JAMES CLEAR'])).toEqual([8]);
    expect(ids(['LES MISERABLES', 'VICTOR HUGO'])).toEqual([9]);
  });

  it('does not take the author alone as a match', () => {
    expect(ids(['PATRICK ROTHFUSS'])).toEqual([]);
  });

  it('returns nothing for text that is not a book in the library', () => {
    expect(ids(['FRESH COFFEE', 'OPEN 7 DAYS'])).toEqual([]);
    expect(ids([])).toEqual([]);
  });

  it('keeps every copy that matches equally, such as an ebook and an audiobook', () => {
    const copies = [...LIBRARY, book(11, 'Project Hail Mary', ['Andy Weir'])];
    expect(ids(['PROJECT HAIL MARY', 'ANDY WEIR'], copies)).toEqual([7, 11]);
  });

  it('does not take a title that differs by a whole word', () => {
    const wind = LIBRARY.filter((candidate) => candidate.bookId !== 10);
    expect(ids(['THE NAME OF THE ROSE'], wind)).toEqual([]);
    expect(ids(['THE NAME OF THE ROSE', 'UMBERTO ECO'], wind)).toEqual([]);
  });

  it('leaves out a weaker title beside a clear match', () => {
    expect(ids(['THE NAME OF THE ROSE', 'UMBERTO ECO'])).toEqual([10]);
  });

  it('keeps at most the limit', () => {
    const many = Array.from({ length: 8 }, (_, index) => book(100 + index, 'Project Hail Mary', ['Andy Weir']));
    expect(rankCandidates(many, ['PROJECT HAIL MARY'], 4)).toHaveLength(4);
  });
});

describe('authorScore', () => {
  it('counts a surname alone, as a spine prints it', () => {
    expect(authorScore(['Patrick Rothfuss'], ['rothfuss'])).toBeGreaterThanOrEqual(0.75);
    expect(authorScore(['Patrick Rothfuss'], ['the name of the wind'])).toBeLessThan(0.3);
  });
});

describe('bestAuthorName', () => {
  it('names the known author a line prints', () => {
    expect(bestAuthorName(['Patrick Rothfuss', 'Andy Weir'], ['THE DOORS OF STONE', 'PATRICK ROTHFUSS'])).toBe('Patrick Rothfuss');
    expect(bestAuthorName(['Andy Weir'], ['THE DOORS OF STONE'])).toBeNull();
  });
});

describe('normalizeIsbn', () => {
  it('reads both lengths and fills in the other', () => {
    expect(normalizeIsbn('978-0-7564-0474-1')).toEqual({ isbn13: '9780756404741', isbn10: '0756404746' });
    expect(normalizeIsbn('0-7564-0474-6')).toEqual({ isbn10: '0756404746', isbn13: '9780756404741' });
    expect(normalizeIsbn('979-1-0000-0000-0')).toEqual({ isbn13: '9791000000000', isbn10: null });
  });

  it('rejects anything else', () => {
    expect(normalizeIsbn('12345')).toBeNull();
    expect(normalizeIsbn(null)).toBeNull();
    expect(normalizeIsbn('97807564047X1')).toBeNull();
  });
});
