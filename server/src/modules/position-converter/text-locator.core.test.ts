import { describe, expect, it } from 'vitest';

import { buildLocateIndex, findDensestMatch, prepareRecognisedText, resolveLocatedRange, tokenizeWords } from './text-locator.core';

const OPENING =
  'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. ' +
  'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well ' +
  'fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.';

const MIDDLE =
  'Mr. Bennet was so odd a mixture of quick parts, sarcastic humour, reserve, and caprice, that the experience of three and twenty ' +
  'years had been insufficient to make his wife understand his character. Her mind was less difficult to develop. She was a woman ' +
  'of mean understanding, little information, and uncertain temper. When she was discontented, she fancied herself nervous.';

const LATER =
  'Not all that Mrs. Bennet, however, with the assistance of her five daughters, could ask on the subject, was sufficient to draw ' +
  'from her husband any satisfactory description of Mr. Bingley. They attacked him in various ways; with barefaced questions, ' +
  'ingenious suppositions, and distant surmises; but he eluded the skill of them all.';

function words(text: string): string[] {
  return tokenizeWords(prepareRecognisedText(text)).words;
}

describe('tokenizeWords', () => {
  it('folds case, accents, ligatures and apostrophes into plain words', () => {
    expect(tokenizeWords('The ﬁnal Café’s door–open').words).toEqual(['the', 'final', 'cafes', 'door', 'open']);
  });

  it('keeps soft hyphens and combining marks inside a word', () => {
    expect(tokenizeWords('inter­national café').words).toEqual(['international', 'cafe']);
  });

  it('reports code point offsets, counting a surrogate pair as one', () => {
    const sequence = tokenizeWords('a \u{1F600} bee');
    expect(sequence.words).toEqual(['a', 'bee']);
    expect(sequence.starts).toEqual([0, 4]);
    expect(sequence.ends).toEqual([1, 7]);
  });

  it('ends a word at an apostrophe that does not sit between letters', () => {
    expect(tokenizeWords("'tis the dogs' bone").words).toEqual(['tis', 'the', 'dogs', 'bone']);
  });
});

describe('prepareRecognisedText', () => {
  it('joins a word hyphenated across a line break', () => {
    expect(words('she remem-\nbered it')).toEqual(['she', 'remembered', 'it']);
  });

  it('keeps a hyphen before a capitalised line apart', () => {
    expect(words('Jean-\nPaul')).toEqual(['jean', 'paul']);
  });
});

describe('findDensestMatch', () => {
  const book = words(`${OPENING} ${MIDDLE} ${LATER}`);
  const middleStart = words(OPENING).length;

  it('finds a clean page at its exact place', () => {
    const match = findDensestMatch(book, words(MIDDLE));
    expect(match).not.toBeNull();
    expect(match!.firstWord).toBe(middleStart);
    expect(match!.lastWord).toBe(middleStart + words(MIDDLE).length - 1);
    expect(match!.share).toBe(1);
  });

  it('tolerates misread letters, a page number and a running head', () => {
    const noisy = `PRIDE AND PREJUDICE\n12\n${MIDDLE.replace('sarcastic', 'sarcastlc').replace('understand', 'undcrstand').replace('nervous', 'ncrvous')}`;
    const match = findDensestMatch(book, words(noisy));
    expect(match).not.toBeNull();
    expect(match!.firstWord).toBe(middleStart);
    expect(match!.share).toBeGreaterThan(0.6);
  });

  it('finds a page whose lines were hyphenated by the typesetter', () => {
    const typeset =
      'Mr. Bennet was so odd a mix-\nture of quick parts, sarcastic hu-\nmour, reserve, and caprice, that the ex-\nperience of three and twenty years';
    expect(findDensestMatch(book, words(typeset))?.firstWord).toBe(middleStart);
  });

  it('returns null for text that is not in the book', () => {
    const elsewhere = 'Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse.';
    expect(findDensestMatch(book, words(elsewhere))).toBeNull();
  });

  it('returns null when the page has too few words to place', () => {
    expect(findDensestMatch(book, words('a single man'))).toBeNull();
  });

  it('does not start early at a phrase from the page that also occurs just before it', () => {
    const lead = 'three and twenty years had been';
    const withEcho = words(`${OPENING} ${lead} ${MIDDLE} ${LATER}`);
    expect(findDensestMatch(withEcho, words(MIDDLE))?.firstWord).toBe(words(`${OPENING} ${lead}`).length);
  });

  it('chooses the place sharing the most word groups when a phrase repeats', () => {
    const repeated = words(`the subject was sufficient to draw ${OPENING} ${LATER} ${MIDDLE}`);
    const match = findDensestMatch(repeated, words(LATER));
    expect(match?.firstWord).toBe(words(`the subject was sufficient to draw ${OPENING}`).length);
  });
});

describe('buildLocateIndex and resolveLocatedRange', () => {
  const chapters = [
    { chapterIndex: 0, text: '' },
    { chapterIndex: 1, text: OPENING },
    { chapterIndex: 2, text: MIDDLE },
    { chapterIndex: 3, text: LATER },
  ];

  it('skips empty chapters and maps a match back to its chapter offsets', () => {
    const index = buildLocateIndex(chapters, 10_000);
    expect(index.chapters.map((chapter) => chapter.chapterIndex)).toEqual([1, 2, 3]);

    const match = findDensestMatch(index.words, words(MIDDLE));
    const range = resolveLocatedRange(index, match!);
    expect(range).toEqual({ chapterIndex: 2, startCp: 0, endCp: Array.from(MIDDLE).length - 1 });
  });

  it('cuts a match that runs over a chapter end at that end', () => {
    const index = buildLocateIndex(chapters, 10_000);
    const middleWords = words(MIDDLE);
    const spanning = words(`${middleWords.slice(-20).join(' ')} ${words(LATER).slice(0, 4).join(' ')}`);
    const match = findDensestMatch(index.words, spanning);
    const range = resolveLocatedRange(index, match!);
    expect(range?.chapterIndex).toBe(2);
    expect(range?.endCp).toBe(Array.from(MIDDLE).length - 1);
  });

  it('stops at the word limit and says so', () => {
    const index = buildLocateIndex(chapters, 30);
    expect(index.words).toHaveLength(30);
    expect(index.truncated).toBe(true);
  });
});
