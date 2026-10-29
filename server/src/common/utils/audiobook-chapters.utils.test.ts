import {
  chapterProvenance,
  computeAudiobookManifestRevision,
  computeAudiobookPositionsKey,
  isFileDerivedChapterSource,
  normalizeAudiobookChapters,
  orderAudiobookTracks,
  resolveStoredAudiobookChapters,
  sameAudiobookChapters,
  sliceChaptersAcrossFiles,
} from './audiobook-chapters.utils';

function track(absolutePath: string, durationSeconds: number | null, sortOrder: number | null = null) {
  return { absolutePath, format: 'mp3', durationSeconds, sortOrder };
}

describe('normalizeAudiobookChapters', () => {
  it('sorts, rounds, clamps and drops entries without a usable start', () => {
    expect(
      normalizeAudiobookChapters([
        { title: 'Two', startMs: 2_000.6 },
        { title: 'Zero', startMs: -40 },
        { title: 'No start' },
        { title: 'Text start', startMs: '3000' },
        null,
        'garbage',
        { title: 'Infinite', startMs: Number.POSITIVE_INFINITY },
      ]),
    ).toEqual([
      { title: 'Zero', startMs: 0 },
      { title: 'Two', startMs: 2_001 },
    ]);
  });

  it('keeps one chapter per start, preferring a titled duplicate', () => {
    expect(
      normalizeAudiobookChapters([
        { title: '', startMs: 0 },
        { title: 'Opening', startMs: 0 },
        { title: 'Later', startMs: 500 },
        { title: 'Later again', startMs: 500 },
      ]),
    ).toEqual([
      { title: 'Opening', startMs: 0 },
      { title: 'Later', startMs: 500 },
    ]);
  });

  it('numbers untitled chapters by their final position and drops extra keys', () => {
    expect(
      normalizeAudiobookChapters([{ title: '  Prologue  ', startMs: 0, durationMs: 9 }, { title: '   ', startMs: 1_000 }, { startMs: 2_000 }]),
    ).toEqual([
      { title: 'Prologue', startMs: 0 },
      { title: 'Chapter 2', startMs: 1_000 },
      { title: 'Chapter 3', startMs: 2_000 },
    ]);
  });
});

describe('resolveStoredAudiobookChapters', () => {
  it('returns a stored list untouched, extra keys and all', () => {
    const stored = [{ title: 'Kept', startMs: 0, durationMs: 1 }] as never;

    expect(resolveStoredAudiobookChapters(stored, [track('/a.mp3', 10), track('/b.mp3', 10)])).toBe(stored);
  });

  it('derives one chapter per track in playback order when nothing is stored', () => {
    expect(
      resolveStoredAudiobookChapters(null, [
        track('/b/Part 2.mp3', 20, 2),
        track('/b/Part 1.mp3', 10.4, 1),
        { ...track('/b/cover.jpg', null), format: 'jpg' },
      ]),
    ).toEqual([
      { title: 'Part 1', startMs: 0 },
      { title: 'Part 2', startMs: 10_400 },
    ]);
  });

  it('derives nothing for one track or a track of unknown length', () => {
    expect(resolveStoredAudiobookChapters([], [track('/one.mp3', 10)])).toEqual([]);
    expect(resolveStoredAudiobookChapters(undefined, [track('/a.mp3', 10), track('/b.mp3', null)])).toBeNull();
  });
});

describe('manifest revision and positions key', () => {
  const files = [
    { publicId: 'p1', sizeBytes: 100, durationSeconds: 10, mtime: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
    { publicId: 'p2', sizeBytes: 200, durationSeconds: 20, mtime: null, updatedAt: new Date('2026-01-02T00:00:00Z') },
  ];

  it('changes the revision with chapters, while the positions key ignores chapters, size and times', () => {
    const before = computeAudiobookManifestRevision(files, [{ title: 'A', startMs: 0 }]);
    const after = computeAudiobookManifestRevision(files, [{ title: 'B', startMs: 0 }]);
    const rewritten = files.map((file) => ({ ...file, sizeBytes: 999, mtime: new Date(), updatedAt: new Date() }));

    expect(before).not.toBe(after);
    expect(computeAudiobookPositionsKey(rewritten)).toBe(computeAudiobookPositionsKey(files));
  });

  it('changes the positions key when a track length or the track order changes', () => {
    const key = computeAudiobookPositionsKey(files);

    expect(computeAudiobookPositionsKey([files[0]!, { ...files[1]!, durationSeconds: 21 }])).not.toBe(key);
    expect(computeAudiobookPositionsKey([files[1]!, files[0]!])).not.toBe(key);
  });
});

describe('chapter helpers', () => {
  it('orders only audio tracks, by sort order then natural file name', () => {
    const rows = [
      { absolutePath: '/b/10.mp3', format: 'mp3', sortOrder: null },
      { absolutePath: '/b/2.mp3', format: 'mp3', sortOrder: null },
      { absolutePath: '/b/intro.m4b', format: 'm4b', sortOrder: 0 },
      { absolutePath: '/b/book.epub', format: 'epub', sortOrder: 1 },
    ];

    expect(orderAudiobookTracks(rows).map((row) => row.absolutePath)).toEqual(['/b/intro.m4b', '/b/2.mp3', '/b/10.mp3']);
  });

  it('treats only file-derived and unknown sources as safe to clear', () => {
    expect(isFileDerivedChapterSource('embedded')).toBe(true);
    expect(isFileDerivedChapterSource('tracks')).toBe(true);
    expect(isFileDerivedChapterSource(null)).toBe(true);
    expect(isFileDerivedChapterSource('provider')).toBe(false);
    expect(isFileDerivedChapterSource('manual')).toBe(false);
    expect(isFileDerivedChapterSource('migration')).toBe(false);
  });

  it('names the editor only for a manual write and clears the source with the list', () => {
    const chapters = [{ title: 'A', startMs: 0 }];

    expect(chapterProvenance(chapters, 'manual', 5)).toMatchObject({ chaptersSource: 'manual', chaptersUpdatedBy: 5 });
    expect(chapterProvenance(chapters, 'provider', 5)).toMatchObject({ chaptersSource: 'provider', chaptersUpdatedBy: null });
    expect(chapterProvenance(null, 'manual', 5)).toMatchObject({ chaptersSource: null, chaptersUpdatedBy: null });
  });

  it('compares lists by title and start only', () => {
    expect(sameAudiobookChapters([{ title: 'A', startMs: 0 }], [{ title: 'A', startMs: 0 }])).toBe(true);
    expect(sameAudiobookChapters([{ title: 'A', startMs: 0 }], [{ title: 'A', startMs: 1 }])).toBe(false);
    expect(sameAudiobookChapters(null, null)).toBe(true);
    expect(sameAudiobookChapters(null, [])).toBe(false);
  });
});

describe('sliceChaptersAcrossFiles', () => {
  function file(id: number, timelineStartMs: number, actualDurationMs: number) {
    return { id, timelineStartMs, actualDurationMs };
  }

  const THREE_FILES = [file(1, 0, 60_000), file(2, 60_000, 60_000), file(3, 120_000, 60_000)];

  it('lays a single file out in order, each chapter ending where the next starts', () => {
    const slices = sliceChaptersAcrossFiles(
      [
        { title: 'Three', startMs: 70_000 },
        { title: 'One', startMs: 0 },
        { title: 'Two', startMs: 30_000 },
      ],
      [file(1, 0, 100_000)],
    );

    expect([...slices.entries()]).toEqual([
      [
        1,
        [
          { title: 'One', startMs: 0, endMs: 30_000 },
          { title: 'Two', startMs: 30_000, endMs: 70_000 },
          { title: 'Three', startMs: 70_000, endMs: 100_000 },
        ],
      ],
    ]);
  });

  it('opens every later file with a marker for the chapter still running into it', () => {
    const slices = sliceChaptersAcrossFiles(
      [
        { title: 'One', startMs: 0 },
        { title: 'Two', startMs: 40_000 },
        { title: 'Three', startMs: 90_000 },
        { title: 'Four', startMs: 150_000 },
      ],
      THREE_FILES,
    );

    expect(slices.get(1)).toEqual([
      { title: 'One', startMs: 0, endMs: 40_000 },
      { title: 'Two', startMs: 40_000, endMs: 60_000 },
    ]);
    expect(slices.get(2)).toEqual([
      { title: 'Two', startMs: 0, endMs: 30_000, continuation: true },
      { title: 'Three', startMs: 30_000, endMs: 60_000 },
    ]);
    expect(slices.get(3)).toEqual([
      { title: 'Three', startMs: 0, endMs: 30_000, continuation: true },
      { title: 'Four', startMs: 30_000, endMs: 60_000 },
    ]);
  });

  it('carries a chapter across a whole file, marking both files it runs into', () => {
    const slices = sliceChaptersAcrossFiles(
      [
        { title: 'Opening', startMs: 0 },
        { title: 'Marathon', startMs: 30_000 },
        { title: 'Finale', startMs: 150_000 },
      ],
      THREE_FILES,
    );

    expect(slices.get(1)).toEqual([
      { title: 'Opening', startMs: 0, endMs: 30_000 },
      { title: 'Marathon', startMs: 30_000, endMs: 60_000 },
    ]);
    expect(slices.get(2)).toEqual([{ title: 'Marathon', startMs: 0, endMs: 60_000, continuation: true }]);
    expect(slices.get(3)).toEqual([
      { title: 'Marathon', startMs: 0, endMs: 30_000, continuation: true },
      { title: 'Finale', startMs: 30_000, endMs: 60_000 },
    ]);
  });

  it('adds no marker when a chapter starts exactly where a file does', () => {
    const slices = sliceChaptersAcrossFiles(
      [
        { title: 'One', startMs: 0 },
        { title: 'Two', startMs: 60_000 },
      ],
      [file(1, 0, 60_000), file(2, 60_000, 40_000)],
    );

    expect(slices.get(1)).toEqual([{ title: 'One', startMs: 0, endMs: 60_000 }]);
    expect(slices.get(2)).toEqual([{ title: 'Two', startMs: 0, endMs: 40_000 }]);
  });

  it('moves a start in the sliver past the real end of a file to the start of the next file', () => {
    // The timeline gives the first file a rounded 60 s; the audio really ends at 59.6 s.
    const slices = sliceChaptersAcrossFiles(
      [
        { title: 'One', startMs: 0 },
        { title: 'Two', startMs: 59_800 },
        { title: 'Three', startMs: 75_000 },
      ],
      [file(1, 0, 59_600), file(2, 60_000, 40_000)],
    );

    expect(slices.get(1)).toEqual([{ title: 'One', startMs: 0, endMs: 59_600 }]);
    expect(slices.get(2)).toEqual([
      { title: 'Two', startMs: 0, endMs: 15_000 },
      { title: 'Three', startMs: 15_000, endMs: 40_000 },
    ]);
  });

  it('keeps the later chapter when two starts land on the same spot', () => {
    const slices = sliceChaptersAcrossFiles(
      [
        { title: 'One', startMs: 0 },
        { title: 'Sliver', startMs: 59_800 },
        { title: 'Two', startMs: 60_000 },
      ],
      [file(1, 0, 59_600), file(2, 60_000, 40_000)],
    );

    expect(slices.get(2)).toEqual([{ title: 'Two', startMs: 0, endMs: 40_000 }]);
  });

  it('drops a start past the real end of the last file, which has no next file to move to', () => {
    const slices = sliceChaptersAcrossFiles(
      [
        { title: 'One', startMs: 0 },
        { title: 'Two', startMs: 70_000 },
        { title: 'Too late', startMs: 99_800 },
      ],
      [file(1, 0, 60_000), file(2, 60_000, 39_500)],
    );

    expect(slices.get(2)).toEqual([
      { title: 'One', startMs: 0, endMs: 10_000, continuation: true },
      { title: 'Two', startMs: 10_000, endMs: 39_500 },
    ]);
  });

  it('ends each file at its probed length, not the whole seconds on the timeline', () => {
    const slices = sliceChaptersAcrossFiles(
      [
        { title: 'One', startMs: 0 },
        { title: 'Two', startMs: 80_000 },
      ],
      [file(1, 0, 60_400), file(2, 60_000, 39_700)],
    );

    expect(slices.get(1)).toEqual([{ title: 'One', startMs: 0, endMs: 60_400 }]);
    expect(slices.get(2)).toEqual([
      { title: 'One', startMs: 0, endMs: 20_000, continuation: true },
      { title: 'Two', startMs: 20_000, endMs: 39_700 },
    ]);
  });
});
