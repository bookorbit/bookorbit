import { READ_ALONG_FORMAT_PRIORITY, withoutImplicitReadAlongFormatPriority, withReadAlongFormatPriority } from '@bookorbit/types';

import { rankFileRowsByBook, rankFilesByFormatPriority, selectPrimaryFile, selectPrimaryFileKeepingCurrent } from './primary-file-selection.utils';

describe('selectPrimaryFile', () => {
  const plainEpub = { id: 1, format: 'epub', sizeBytes: 100, mediaOverlayAvailable: false };
  const readAlongEpub = { id: 2, format: 'epub', sizeBytes: 200, mediaOverlayAvailable: true };
  const audiobook = { id: 3, format: 'm4b', sizeBytes: 300, mediaOverlayAvailable: false };

  it('prefers a read-aloud EPUB over a plain EPUB of the same preferred format', () => {
    expect(selectPrimaryFile([plainEpub, readAlongEpub, audiobook], ['epub', 'm4b'])).toBe(readAlongEpub);
  });

  it('still honors format priority before read-aloud capability', () => {
    expect(selectPrimaryFile([plainEpub, readAlongEpub, audiobook], ['m4b', 'epub'])).toBe(audiobook);
  });

  describe('with the read-along entry', () => {
    const readAlongFirst = [READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub'];

    it('ranks a read-along EPUB above audio when the entry is placed first', () => {
      expect(selectPrimaryFile([plainEpub, audiobook, readAlongEpub], readAlongFirst)).toBe(readAlongEpub);
    });

    it('ranks a plain EPUB by its own entry, below audio', () => {
      expect(selectPrimaryFile([plainEpub, audiobook], readAlongFirst)).toBe(audiobook);
    });

    it('prefers a plain EPUB over a read-along one when plain EPUB is ranked higher', () => {
      expect(selectPrimaryFile([readAlongEpub, plainEpub], ['epub', READ_ALONG_FORMAT_PRIORITY])).toBe(plainEpub);
    });

    it('falls through to the read-along entry when no plain EPUB exists', () => {
      expect(selectPrimaryFile([readAlongEpub, audiobook], ['epub', 'pdf', READ_ALONG_FORMAT_PRIORITY, 'm4b'])).toBe(readAlongEpub);
    });

    it('treats an EPUB whose overlay state is unknown as a plain EPUB', () => {
      const unknownEpub = { id: 4, format: 'epub', sizeBytes: 100 };
      expect(selectPrimaryFile([unknownEpub, audiobook], readAlongFirst)).toBe(audiobook);
    });

    it('matches the stored list without the entry when it sits directly before epub', () => {
      const files = [plainEpub, readAlongEpub, audiobook];
      expect(selectPrimaryFile(files, ['m4b', READ_ALONG_FORMAT_PRIORITY, 'epub'])).toBe(selectPrimaryFile(files, ['m4b', 'epub']));
      expect(selectPrimaryFile([plainEpub, readAlongEpub], [READ_ALONG_FORMAT_PRIORITY, 'epub'])).toBe(
        selectPrimaryFile([plainEpub, readAlongEpub], ['epub']),
      );
    });
  });

  it('rejects zero-byte candidates unless fallback is explicitly enabled', () => {
    const empty = { ...readAlongEpub, sizeBytes: 0 };
    expect(selectPrimaryFile([empty], ['epub'])).toBeNull();
    expect(selectPrimaryFile([empty], ['epub'], { allowZeroByteFallback: true })).toBe(empty);
  });
});

describe('selectPrimaryFileKeepingCurrent', () => {
  const firstEpub = { id: 1, format: 'epub', sizeBytes: 100, mediaOverlayAvailable: false };
  const secondEpub = { id: 2, format: 'epub', sizeBytes: 100, mediaOverlayAvailable: false };
  const audiobook = { id: 3, format: 'm4b', sizeBytes: 300, mediaOverlayAvailable: false };

  it('keeps the current primary over a file that only ties with it', () => {
    expect(selectPrimaryFile([firstEpub, secondEpub], ['epub'])).toBe(firstEpub);
    expect(selectPrimaryFileKeepingCurrent([firstEpub, secondEpub], secondEpub.id, ['epub'])).toBe(secondEpub);
  });

  it('replaces the current primary with a better-ranked format', () => {
    expect(selectPrimaryFileKeepingCurrent([firstEpub, audiobook], firstEpub.id, ['m4b', 'epub'])).toBe(audiobook);
  });

  it('still lets a read-along EPUB outrank a plain current one of the same format', () => {
    const readAlong = { ...secondEpub, mediaOverlayAvailable: true };
    expect(selectPrimaryFileKeepingCurrent([firstEpub, readAlong], firstEpub.id, ['epub'])).toBe(readAlong);
  });

  it('ranks normally when there is no current primary, or it is not among the files', () => {
    expect(selectPrimaryFileKeepingCurrent([firstEpub, secondEpub], null, ['epub'])).toBe(firstEpub);
    expect(selectPrimaryFileKeepingCurrent([firstEpub, secondEpub], 99, ['epub'])).toBe(firstEpub);
  });

  it('does not keep an empty current primary', () => {
    const emptyCurrent = { ...secondEpub, sizeBytes: 0 };
    expect(selectPrimaryFileKeepingCurrent([firstEpub, emptyCurrent], emptyCurrent.id, ['epub'])).toBe(firstEpub);
  });
});

describe('read-along format priority helpers', () => {
  it('shows the read-along entry directly before epub when a stored list lacks it', () => {
    expect(withReadAlongFormatPriority(['m4b', 'epub', 'pdf'])).toEqual(['m4b', READ_ALONG_FORMAT_PRIORITY, 'epub', 'pdf']);
  });

  it('keeps a stored read-along position and appends the entry when epub is missing', () => {
    expect(withReadAlongFormatPriority([READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub'])).toEqual([READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub']);
    expect(withReadAlongFormatPriority(['pdf'])).toEqual(['pdf', READ_ALONG_FORMAT_PRIORITY]);
  });

  it('saves the list without the entry only while it sits in its implicit slot', () => {
    expect(withoutImplicitReadAlongFormatPriority(['m4b', READ_ALONG_FORMAT_PRIORITY, 'epub'])).toEqual(['m4b', 'epub']);
    expect(withoutImplicitReadAlongFormatPriority([READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub'])).toEqual([READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub']);
    expect(withoutImplicitReadAlongFormatPriority(['m4b', 'epub'])).toEqual(['m4b', 'epub']);
  });

  it('round-trips a legacy list unchanged', () => {
    const legacy = ['m4b', 'm4a', 'mp3', 'epub', 'pdf'];
    expect(withoutImplicitReadAlongFormatPriority(withReadAlongFormatPriority(legacy))).toEqual(legacy);
  });
});

describe('rankFilesByFormatPriority', () => {
  const files = [
    { id: 1, format: 'jpg', role: 'cover', sizeBytes: 10 },
    { id: 2, format: 'mp3', role: 'content', sizeBytes: 10 },
    { id: 3, format: 'epub', role: 'content', sizeBytes: 10, mediaOverlayAvailable: true },
    { id: 4, format: 'mp3', role: 'content', sizeBytes: 10 },
    { id: 5, format: 'epub', role: 'content', sizeBytes: 10 },
  ];

  it('puts the primary first, then content by priority, then covers and sidecars', () => {
    const ranked = rankFilesByFormatPriority(files, ['m4b', 'mp3', 'epub'], 5);
    expect(ranked.map((file) => file.id)).toEqual([5, 2, 4, 3, 1]);
  });

  it('ranks a read-along EPUB by its own entry and keeps audio tracks in order', () => {
    const ranked = rankFilesByFormatPriority(files, [READ_ALONG_FORMAT_PRIORITY, 'mp3', 'epub'], null);
    expect(ranked.map((file) => file.id)).toEqual([3, 2, 4, 5, 1]);
  });

  it('ranks by the default priority when the library has none', () => {
    expect(rankFilesByFormatPriority(files, null).map((file) => file.id)).toEqual([3, 5, 2, 4, 1]);
  });
});

describe('rankFileRowsByBook', () => {
  it("ranks each book's rows with that book's own priority", () => {
    const rows = [
      { bookId: 1, id: 10, format: 'epub', role: 'content', sizeBytes: 1 },
      { bookId: 1, id: 11, format: 'm4b', role: 'content', sizeBytes: 1 },
      { bookId: 2, id: 20, format: 'epub', role: 'content', sizeBytes: 1 },
      { bookId: 2, id: 21, format: 'm4b', role: 'content', sizeBytes: 1 },
    ];
    const ranked = rankFileRowsByBook(
      rows,
      new Map([
        [1, { formatPriority: ['m4b', 'epub'], primaryFileId: null }],
        [2, { formatPriority: ['epub', 'm4b'], primaryFileId: null }],
      ]),
    );
    expect(ranked.map((row) => row.id)).toEqual([11, 10, 20, 21]);
  });
});
