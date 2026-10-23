import {
  compareWriteTargets,
  coverMediumForFormat,
  needsBookFileList,
  resolveAudioTrackContexts,
  resolveWriteTargetSkip,
  selectWriteTargets,
  type FileWriteFormatConfig,
  type WriteTargetFile,
} from './write-target-selector';

const CONFIG: FileWriteFormatConfig = {
  fileWriteEpubEnabled: true,
  fileWriteEpubMaxFileSizeMb: 100,
  fileWriteFb2Enabled: true,
  fileWriteFb2MaxFileSizeMb: 100,
  fileWritePdfEnabled: true,
  fileWritePdfMaxFileSizeMb: 100,
  fileWriteCbxEnabled: true,
  fileWriteCbxMaxFileSizeMb: 500,
  fileWriteKindleEnabled: true,
  fileWriteKindleMaxFileSizeMb: 100,
  fileWriteAudioEnabled: true,
  fileWriteAudioMaxFileSizeMb: 500,
  fileWriteReadAlongEnabled: false,
  fileWriteReadAlongMaxFileSizeMb: 1000,
};

const SUPPORTED = new Set(['epub', 'fb2', 'pdf', 'cbz', 'cb7', 'mobi', 'azw3', 'azw', 'm4b', 'm4a', 'mp3', 'flac']);
const supports = (format: string) => SUPPORTED.has(format);

type File = WriteTargetFile & { absolutePath: string };

function file(id: number, name: string, overrides: Partial<File> = {}): File {
  const format = name.slice(name.lastIndexOf('.') + 1);
  return { id, absolutePath: `/books/b/${name}`, format, sizeBytes: 1024, role: 'content', sortOrder: null, ...overrides };
}

const ids = (files: readonly { id: number }[]) => files.map((entry) => entry.id);

describe('selectWriteTargets', () => {
  describe('primary mode', () => {
    it('writes an ebook primary alone', () => {
      const epub = file(1, 'book.epub');
      const m4b = file(2, 'book.m4b');

      expect(selectWriteTargets({ files: [epub, m4b], primaryFile: epub, mode: 'primary', supports })).toEqual({ targets: [epub], excluded: [] });
    });

    it('writes every audio track of an audio primary, in playback order', () => {
      const tracks = [file(3, 'part-10.mp3'), file(1, 'part-2.mp3'), file(2, 'part-1.mp3')];

      const { targets } = selectWriteTargets({ files: tracks, primaryFile: tracks[1]!, mode: 'primary', supports });

      expect(ids(targets)).toEqual([2, 1, 3]);
    });

    it('falls back to the audio primary when the book lists no audio files', () => {
      const m4b = file(1, 'book.m4b');

      expect(selectWriteTargets({ files: [file(2, 'book.epub')], primaryFile: m4b, mode: 'primary', supports }).targets).toEqual([m4b]);
    });

    it('keeps unsupported audio tracks as members so they can be reported', () => {
      const m4b = file(1, 'a.m4b');
      const opus = file(2, 'b.opus');

      expect(ids(selectWriteTargets({ files: [m4b, opus], primaryFile: m4b, mode: 'primary', supports }).targets)).toEqual([1, 2]);
    });

    it('never writes a supplement-role audio file into an audiobook', () => {
      const m4b = file(1, 'book.m4b');
      const bonus = file(2, 'bonus.mp3', { role: 'supplement' });

      expect(selectWriteTargets({ files: [m4b, bonus], primaryFile: m4b, mode: 'primary', supports })).toEqual({ targets: [m4b], excluded: [] });
    });

    it('writes the primary whatever role it was scanned with', () => {
      const m4b = file(1, 'book.m4b', { role: 'supplement' });

      expect(selectWriteTargets({ files: [m4b], primaryFile: m4b, mode: 'primary', supports }).targets).toEqual([m4b]);
    });

    it('selects nothing without a primary file', () => {
      expect(selectWriteTargets({ files: [file(1, 'book.epub')], primaryFile: null, mode: 'primary', supports })).toEqual({
        targets: [],
        excluded: [],
      });
    });
  });

  describe('all-files mode', () => {
    it('writes an ebook primary and its audiobook sibling', () => {
      const epub = file(1, 'book.epub', { sortOrder: 0 });
      const m4b = file(2, 'book.m4b', { sortOrder: 1 });

      expect(ids(selectWriteTargets({ files: [m4b, epub], primaryFile: epub, mode: 'all_files', supports }).targets)).toEqual([1, 2]);
    });

    it('excludes a supplement and reports it, because a writer could otherwise have touched it', () => {
      const epub = file(1, 'book.epub');
      const workbook = file(2, 'workbook.pdf', { role: 'supplement' });

      expect(selectWriteTargets({ files: [epub, workbook], primaryFile: epub, mode: 'all_files', supports })).toEqual({
        targets: [epub],
        excluded: [workbook],
      });
    });

    it('does not report sidecars no writer could touch', () => {
      const epub = file(1, 'book.epub');
      const cover = file(2, 'cover.jpg', { role: 'cover' });
      const opf = file(3, 'metadata.opf', { role: 'metadata' });

      expect(selectWriteTargets({ files: [epub, cover, opf], primaryFile: epub, mode: 'all_files', supports }).excluded).toEqual([]);
    });

    it('keeps a secondary eligible when the primary is unsupported', () => {
      const djvu = file(1, 'book.djvu');
      const m4b = file(2, 'book.m4b');

      expect(ids(selectWriteTargets({ files: [djvu, m4b], primaryFile: djvu, mode: 'all_files', supports }).targets)).toEqual([1, 2]);
    });

    it('writes content files of a book without a primary', () => {
      const epub = file(5, 'book.epub');

      expect(selectWriteTargets({ files: [epub], primaryFile: null, mode: 'all_files', supports }).targets).toEqual([epub]);
    });

    it('includes the primary even when the loaded file list missed it', () => {
      const epub = file(1, 'book.epub');
      const m4b = file(2, 'book.m4b');

      expect(ids(selectWriteTargets({ files: [m4b], primaryFile: epub, mode: 'all_files', supports }).targets)).toEqual([1, 2]);
    });
  });
});

describe('compareWriteTargets', () => {
  it('orders by sort order, unset last, then natural file name, then id', () => {
    const files = [
      file(1, 'track-10.mp3'),
      file(2, 'track-9.mp3'),
      file(3, 'z.mp3', { sortOrder: 0 }),
      file(4, 'a.mp3', { sortOrder: 1 }),
      file(6, 'same.mp3'),
      file(5, 'same.mp3'),
    ];

    expect(ids([...files].sort(compareWriteTargets))).toEqual([3, 4, 5, 6, 2, 1]);
  });

  it('orders rows without a path by id', () => {
    expect(
      ids(
        [
          { id: 2, format: 'mp3', sizeBytes: 1 },
          { id: 1, format: 'mp3', sizeBytes: 1 },
        ].sort(compareWriteTargets),
      ),
    ).toEqual([1, 2]);
  });
});

describe('resolveWriteTargetSkip', () => {
  it('accepts a supported, enabled file within its limit', () => {
    expect(resolveWriteTargetSkip({ format: 'EPUB', sizeBytes: 10 }, CONFIG, supports)).toBeNull();
  });

  it('skips a format without a writer', () => {
    expect(resolveWriteTargetSkip({ format: 'opus', sizeBytes: 10 }, CONFIG, supports)).toBe('format not supported');
    expect(resolveWriteTargetSkip({ format: null, sizeBytes: 10 }, CONFIG, supports)).toBe('format not supported');
  });

  it('skips a disabled format family', () => {
    expect(resolveWriteTargetSkip({ format: 'mp3', sizeBytes: 10 }, { ...CONFIG, fileWriteAudioEnabled: false }, supports)).toBe('format disabled');
  });

  it('skips a file over its family size limit', () => {
    expect(resolveWriteTargetSkip({ format: 'epub', sizeBytes: 2 * 1024 * 1024 }, { ...CONFIG, fileWriteEpubMaxFileSizeMb: 1 }, supports)).toBe(
      'file exceeds size limit',
    );
  });

  it('routes a read-along EPUB to its own toggle and limit', () => {
    const readAlong = { format: 'epub', sizeBytes: 400 * 1024 * 1024, mediaOverlayAvailable: true };

    expect(resolveWriteTargetSkip(readAlong, CONFIG, supports)).toBe('format disabled');
    expect(resolveWriteTargetSkip(readAlong, { ...CONFIG, fileWriteReadAlongEnabled: true }, supports)).toBeNull();
    expect(resolveWriteTargetSkip(readAlong, { ...CONFIG, fileWriteReadAlongEnabled: true, fileWriteReadAlongMaxFileSizeMb: 100 }, supports)).toBe(
      'file exceeds size limit',
    );
    expect(resolveWriteTargetSkip(readAlong, { ...CONFIG, fileWriteReadAlongEnabled: true, fileWriteEpubEnabled: false }, supports)).toBeNull();
  });

  it('keeps a plain EPUB on the EPUB settings whatever the read-along toggle says', () => {
    expect(
      resolveWriteTargetSkip(
        { format: 'epub', sizeBytes: 10, mediaOverlayAvailable: false },
        { ...CONFIG, fileWriteReadAlongEnabled: true, fileWriteEpubEnabled: false },
        supports,
      ),
    ).toBe('format disabled');
  });

  it('treats an unknown size as within the limit', () => {
    expect(resolveWriteTargetSkip({ format: 'epub', sizeBytes: null }, { ...CONFIG, fileWriteEpubMaxFileSizeMb: 1 }, supports)).toBeNull();
  });
});

describe('coverMediumForFormat', () => {
  it.each([
    ['m4b', 'audio'],
    ['MP3', 'audio'],
    ['epub', 'ebook'],
    ['cbz', 'ebook'],
    [null, 'ebook'],
  ] as const)('routes %s to the %s cover slot', (format, medium) => {
    expect(coverMediumForFormat(format)).toBe(medium);
  });
});

describe('needsBookFileList', () => {
  it('skips the file list only for an ebook primary in primary mode', () => {
    expect(needsBookFileList({ format: 'epub' }, 'primary')).toBe(false);
    expect(needsBookFileList({ format: 'm4b' }, 'primary')).toBe(true);
    expect(needsBookFileList({ format: 'epub' }, 'all_files')).toBe(true);
    expect(needsBookFileList(null, 'all_files')).toBe(true);
  });
});

describe('resolveAudioTrackContexts', () => {
  it('numbers the tracks of a real multi-track recording', () => {
    const tracks = [file(1, '01 Opening.mp3'), file(2, '02 Middle.mp3'), file(3, '03 End.mp3')];

    expect([...resolveAudioTrackContexts(tracks, tracks[0]!).entries()]).toEqual([
      [1, { trackNumber: 1, trackTotal: 3, trackTitle: '01 Opening', isMultiTrackAudio: true }],
      [2, { trackNumber: 2, trackTotal: 3, trackTitle: '02 Middle', isMultiTrackAudio: true }],
      [3, { trackNumber: 3, trackTotal: 3, trackTitle: '03 End', isMultiTrackAudio: true }],
    ]);
  });

  it('keeps each file of an ebook with several audio files as it is, rather than inventing a recording', () => {
    const epub = file(1, 'book.epub');
    const unabridged = file(2, 'book (Unabridged).m4b');
    const abridged = file(3, 'book (Abridged).m4b');

    const contexts = resolveAudioTrackContexts([epub, unabridged, abridged], epub);

    expect(contexts.get(2)).toEqual({ preserveTrackIdentity: true });
    expect(contexts.get(3)).toEqual({ preserveTrackIdentity: true });
    expect(contexts.has(1)).toBe(false);
  });

  it('holds the position of an unsupported track mid-sequence', () => {
    const tracks = [file(1, '01.mp3'), file(2, '02.opus'), file(3, '03.mp3')];

    expect(resolveAudioTrackContexts(tracks, tracks[0]!).get(3)).toMatchObject({ trackNumber: 3, trackTotal: 3 });
  });

  it('holds the position of an oversized track mid-sequence', () => {
    const tracks = [file(1, '01.mp3'), file(2, '02.mp3', { sizeBytes: Number.MAX_SAFE_INTEGER }), file(3, '03.mp3')];

    expect(resolveAudioTrackContexts(tracks, tracks[0]!).get(3)).toMatchObject({ trackNumber: 3, trackTotal: 3 });
  });

  it('leads each title with its disc folder when tracks span folders', () => {
    const at = (id: number, rel: string) => ({ ...file(id, 'x.mp3'), absolutePath: `/books/b/${rel}`, sortOrder: id });
    const tracks = [at(1, 'CD 1/01.mp3'), at(2, 'CD 1/02.mp3'), at(3, 'CD 2/01.mp3'), at(4, 'CD 2/02.mp3')];

    expect([...resolveAudioTrackContexts(tracks, tracks[0]!).values()].map((context) => context.trackTitle)).toEqual([
      'CD 1 - 01',
      'CD 1 - 02',
      'CD 2 - 01',
      'CD 2 - 02',
    ]);
  });

  it('only prefixes the tracks that sit below the shared folder', () => {
    const at = (id: number, rel: string) => ({ ...file(id, 'x.mp3'), absolutePath: `/books/b/${rel}`, sortOrder: id });
    const tracks = [at(1, '01.mp3'), at(2, '02.mp3'), at(3, 'Bonus/01.mp3'), at(4, 'Part 2/CD 1/01.mp3')];

    expect([...resolveAudioTrackContexts(tracks, tracks[0]!).values()].map((context) => context.trackTitle)).toEqual([
      '01',
      '02',
      'Bonus - 01',
      'Part 2 - CD 1 - 01',
    ]);
  });

  it('keeps plain file names for tracks in a single folder', () => {
    const tracks = [file(1, '01 Opening.mp3'), file(2, '02 Middle.mp3')];

    expect([...resolveAudioTrackContexts(tracks, tracks[0]!).values()].map((context) => context.trackTitle)).toEqual(['01 Opening', '02 Middle']);
  });

  it('keeps the book title on an M4B whose only sibling is an audio format no writer handles', () => {
    const m4b = file(1, 'Book.m4b');
    const opus = file(2, 'Book.opus');

    expect(resolveAudioTrackContexts([m4b, opus], m4b).get(1)).toMatchObject({ isMultiTrackAudio: false });
    expect(resolveAudioTrackContexts([file(3, 'Book.epub'), m4b, opus], file(3, 'Book.epub')).get(1)).toMatchObject({
      isMultiTrackAudio: false,
    });
  });

  it('writes the book title into a single audio file, whatever the primary is', () => {
    const m4b = file(2, 'book.m4b');

    expect(resolveAudioTrackContexts([m4b], m4b).get(2)).toMatchObject({ isMultiTrackAudio: false });
    expect(resolveAudioTrackContexts([file(1, 'book.epub'), m4b], file(1, 'book.epub')).get(2)).toMatchObject({ isMultiTrackAudio: false });
    expect(resolveAudioTrackContexts([m4b], null).get(2)).toMatchObject({ isMultiTrackAudio: false });
  });
});
