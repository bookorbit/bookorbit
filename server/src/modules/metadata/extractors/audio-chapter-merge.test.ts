import { describe, expect, it } from 'vitest';

import { chaptersReachLastFile, mergeAudioChapters, type AudioChapterSource } from './audio-chapter-merge';

function source(overrides: Partial<AudioChapterSource> & Pick<AudioChapterSource, 'absolutePath'>): AudioChapterSource {
  return { chapters: [], durationMs: null, ...overrides };
}

describe('mergeAudioChapters', () => {
  it('offsets each file by the combined length of the files before it', () => {
    const merged = mergeAudioChapters([
      source({
        absolutePath: '/books/Red Rising/Red Rising - 01.m4b',
        durationMs: 360_000,
        chapters: [
          { title: 'Chapter 1', startMs: 0 },
          { title: 'Chapter 2', startMs: 120_000 },
          { title: 'Chapter 3', startMs: 240_000 },
        ],
      }),
      source({
        absolutePath: '/books/Red Rising/Red Rising - 02.m4b',
        durationMs: 240_000,
        chapters: [
          { title: 'Chapter 4', startMs: 0 },
          { title: 'Chapter 5', startMs: 120_000 },
        ],
      }),
    ]);

    expect(merged).toEqual([
      { title: 'Chapter 1', startMs: 0 },
      { title: 'Chapter 2', startMs: 120_000 },
      { title: 'Chapter 3', startMs: 240_000 },
      { title: 'Chapter 4', startMs: 360_000 },
      { title: 'Chapter 5', startMs: 480_000 },
    ]);
  });

  it('ends the first file last chapter where the second file starts', () => {
    const totalMs = 360_000 + 240_000;
    const merged = mergeAudioChapters([
      source({ absolutePath: '/books/Book/01.m4b', durationMs: 360_000, chapters: [{ title: 'Last of part one', startMs: 240_000 }] }),
      source({ absolutePath: '/books/Book/02.m4b', durationMs: 240_000, chapters: [{ title: 'First of part two', startMs: 0 }] }),
    ])!;

    const lastOfPartOne = merged[0]!;
    const firstOfPartTwo = merged[1]!;

    // Without the merge this chapter would run to the end of the whole book.
    expect(firstOfPartTwo.startMs - lastOfPartOne.startMs).toBe(120_000);
    expect(totalMs - lastOfPartOne.startMs).toBe(360_000);
  });

  it('accumulates offsets across more than two files', () => {
    const merged = mergeAudioChapters([
      source({ absolutePath: '/books/Book/01.mp3', durationMs: 100_000, chapters: [{ title: 'One', startMs: 0 }] }),
      source({ absolutePath: '/books/Book/02.mp3', durationMs: 200_000, chapters: [{ title: 'Two', startMs: 50_000 }] }),
      source({ absolutePath: '/books/Book/03.mp3', durationMs: 300_000, chapters: [{ title: 'Three', startMs: 10_000 }] }),
    ]);

    expect(merged).toEqual([
      { title: 'One', startMs: 0 },
      { title: 'Two', startMs: 150_000 },
      { title: 'Three', startMs: 310_000 },
    ]);
  });

  it('gives a chapterless file its own chapter so the previous file does not swallow it', () => {
    const merged = mergeAudioChapters([
      source({ absolutePath: '/books/Book/Part 01.m4b', durationMs: 60_000, chapters: [{ title: 'Opening', startMs: 0 }] }),
      source({ absolutePath: '/books/Book/Part 02.m4b', durationMs: 90_000 }),
      source({ absolutePath: '/books/Book/Part 03.m4b', durationMs: 30_000, chapters: [{ title: 'Closing', startMs: 0 }] }),
    ]);

    expect(merged).toEqual([
      { title: 'Opening', startMs: 0 },
      { title: 'Part 02', startMs: 60_000 },
      { title: 'Closing', startMs: 150_000 },
    ]);
  });

  it('returns nothing to store when no file carries chapters', () => {
    const merged = mergeAudioChapters([
      source({ absolutePath: '/books/Book/01.mp3', durationMs: 60_000 }),
      source({ absolutePath: '/books/Book/02.mp3', durationMs: 60_000 }),
    ]);

    expect(merged).toEqual([]);
  });

  it('returns nothing to store for an empty file list', () => {
    expect(mergeAudioChapters([])).toEqual([]);
  });

  it('refuses to merge when a file that others follow has no readable length', () => {
    const merged = mergeAudioChapters([
      source({ absolutePath: '/books/Book/01.m4b', durationMs: null, chapters: [{ title: 'One', startMs: 0 }] }),
      source({ absolutePath: '/books/Book/02.m4b', durationMs: 240_000, chapters: [{ title: 'Two', startMs: 0 }] }),
    ]);

    expect(merged).toBeNull();
  });

  it('merges when only the last file has no readable length, since nothing follows it', () => {
    const merged = mergeAudioChapters([
      source({ absolutePath: '/books/Book/01.m4b', durationMs: 360_000, chapters: [{ title: 'One', startMs: 0 }] }),
      source({ absolutePath: '/books/Book/02.m4b', durationMs: null, chapters: [{ title: 'Two', startMs: 0 }] }),
    ]);

    expect(merged).toEqual([
      { title: 'One', startMs: 0 },
      { title: 'Two', startMs: 360_000 },
    ]);
  });

  it('orders chapters within a file before offsetting them', () => {
    const merged = mergeAudioChapters([
      source({
        absolutePath: '/books/Book/01.m4b',
        durationMs: 100_000,
        chapters: [
          { title: 'Second', startMs: 50_000 },
          { title: 'First', startMs: 0 },
        ],
      }),
      source({ absolutePath: '/books/Book/02.m4b', durationMs: 100_000, chapters: [{ title: 'Third', startMs: 0 }] }),
    ]);

    expect(merged).toEqual([
      { title: 'First', startMs: 0 },
      { title: 'Second', startMs: 50_000 },
      { title: 'Third', startMs: 100_000 },
    ]);
  });

  it('drops chapters that start before the file does', () => {
    const merged = mergeAudioChapters([
      source({
        absolutePath: '/books/Book/01.m4b',
        durationMs: 100_000,
        chapters: [
          { title: 'Bogus', startMs: -5_000 },
          { title: 'Real', startMs: 0 },
        ],
      }),
      source({ absolutePath: '/books/Book/02.m4b', durationMs: 100_000, chapters: [{ title: 'Next', startMs: 0 }] }),
    ]);

    expect(merged).toEqual([
      { title: 'Real', startMs: 0 },
      { title: 'Next', startMs: 100_000 },
    ]);
  });

  it('names a chapterless file after the file itself when every chapter of it was dropped', () => {
    const merged = mergeAudioChapters([
      source({ absolutePath: '/books/Book/Part 01.m4b', durationMs: 100_000, chapters: [{ title: 'Bogus', startMs: -1 }] }),
      source({ absolutePath: '/books/Book/Part 02.m4b', durationMs: 100_000, chapters: [{ title: 'Real', startMs: 0 }] }),
    ]);

    expect(merged).toEqual([
      { title: 'Part 01', startMs: 0 },
      { title: 'Real', startMs: 100_000 },
    ]);
  });

  it('leaves a single file unchanged', () => {
    const merged = mergeAudioChapters([
      source({
        absolutePath: '/books/Book/book.m4b',
        durationMs: 3_600_000,
        chapters: [
          { title: 'One', startMs: 0 },
          { title: 'Two', startMs: 60_000 },
        ],
      }),
    ]);

    expect(merged).toEqual([
      { title: 'One', startMs: 0 },
      { title: 'Two', startMs: 60_000 },
    ]);
  });

  it('keeps merged chapters in ascending order', () => {
    const merged = mergeAudioChapters([
      source({
        absolutePath: '/books/Book/01.m4b',
        durationMs: 200_000,
        chapters: [
          { title: 'a', startMs: 0 },
          { title: 'b', startMs: 199_999 },
        ],
      }),
      source({ absolutePath: '/books/Book/02.m4b', durationMs: 200_000, chapters: [{ title: 'c', startMs: 1 }] }),
    ])!;

    const startTimes = merged.map((chapter) => chapter.startMs);
    expect(startTimes).toEqual([...startTimes].sort((a, b) => a - b));
  });
});

describe('chaptersReachLastFile', () => {
  it('reports a list extracted from the first file alone as short', () => {
    const partOneChapters = [
      { title: 'Chapter 1', startMs: 0 },
      { title: 'Chapter 2', startMs: 120_000 },
      { title: 'Chapter 3', startMs: 240_000 },
    ];

    expect(chaptersReachLastFile(partOneChapters, [360_000, 240_000])).toBe(false);
  });

  it('accepts a merged list that reaches into the last file', () => {
    const merged = [
      { title: 'Chapter 1', startMs: 0 },
      { title: 'Chapter 4', startMs: 360_000 },
    ];

    expect(chaptersReachLastFile(merged, [360_000, 240_000])).toBe(true);
  });

  it('accepts a merged list whose last chapter sits a rounded second before the last file', () => {
    // Per-file lengths round to whole seconds, so a merge writes offsets slightly off the durations
    // this check can see. Without slack the same book would be rebuilt on every scan.
    const merged = [{ title: 'Part two', startMs: 359_500 }];

    expect(chaptersReachLastFile(merged, [360_000, 240_000])).toBe(true);
  });

  it('keeps its slack proportional to the number of files before the last one', () => {
    const merged = [{ title: 'Part four', startMs: 297_000 }];

    expect(chaptersReachLastFile(merged, [100_000, 100_000, 100_000, 100_000])).toBe(true);
    expect(chaptersReachLastFile([{ title: 'Part two', startMs: 100_000 }], [100_000, 100_000, 100_000, 100_000])).toBe(false);
  });

  it('says yes for a single file, which has nothing to fall short of', () => {
    expect(chaptersReachLastFile([{ title: 'Chapter 1', startMs: 0 }], [3_600_000])).toBe(true);
  });

  it('says yes for an empty list, which the per-file fallback owns', () => {
    expect(chaptersReachLastFile([], [360_000, 240_000])).toBe(true);
  });

  it('says yes when a length before the last file is unknown', () => {
    expect(chaptersReachLastFile([{ title: 'Chapter 1', startMs: 0 }], [null, 240_000])).toBe(true);
  });

  it('ignores an unknown length on the last file, which no offset depends on', () => {
    expect(chaptersReachLastFile([{ title: 'Chapter 1', startMs: 0 }], [360_000, null])).toBe(false);
  });
});
