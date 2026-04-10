import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { IAudioMetadata } from 'music-metadata';

vi.mock('music-metadata', () => ({
  parseFile: vi.fn(),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    open: vi.fn(),
  };
});

vi.mock('mediainfo.js', () => ({
  default: vi.fn(),
}));

import * as mm from 'music-metadata';
import { open } from 'fs/promises';
import mediaInfoFactory from 'mediainfo.js';
import { extractAudioMetadata, parseAudioDuration } from './audio.extractor';

const mockParseFile = mm.parseFile as ReturnType<typeof vi.fn>;
const mockOpen = open as unknown as ReturnType<typeof vi.fn>;
const mockMediaInfoFactory = mediaInfoFactory as unknown as ReturnType<typeof vi.fn>;

function makeMetadata(overrides: Partial<IAudioMetadata> = {}): IAudioMetadata {
  const base = {
    common: {
      track: { no: null, of: null },
      disk: { no: null, of: null },
      movementIndex: {},
    },
    format: {
      tagTypes: [],
      lossless: false,
    },
    native: {},
    quality: { warnings: [] },
  };

  return {
    ...base,
    ...overrides,
    common: { ...base.common, ...(overrides.common ?? {}) },
    format: { ...base.format, ...(overrides.format ?? {}) },
  } as unknown as IAudioMetadata;
}

function resetAudioMocks() {
  vi.resetAllMocks();
  mockOpen.mockRejectedValue(new Error('no mediainfo file handle'));
  mockMediaInfoFactory.mockResolvedValue({
    analyzeData: vi.fn().mockResolvedValue({ media: { track: [] } }),
    close: vi.fn(),
  });
}

// ── AUTHOR / NARRATOR SPLIT ───────────────────────────────────────────────────

describe('extractAudioMetadata — author/narrator split', () => {
  beforeEach(() => resetAudioMocks());

  it('uses albumartist as author and artists as narrators', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        common: {
          albumartist: 'J.R.R. Tolkien',
          artists: ['Andy Serkis'],
          album: 'The Lord of the Rings',
        } as unknown as IAudioMetadata['common'],
      }),
    );

    const result = await extractAudioMetadata('/path/lotr.m4b');
    expect(result.authors).toEqual([{ name: 'J.R.R. Tolkien', sortName: null }]);
    expect(result.narrators).toEqual(['Andy Serkis']);
  });

  it('uses artist as author and leaves narrators empty when albumartist is absent', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        common: {
          artist: 'Douglas Adams',
          album: "The Hitchhiker's Guide",
        } as unknown as IAudioMetadata['common'],
      }),
    );

    const result = await extractAudioMetadata('/path/hhg.mp3');
    expect(result.authors).toEqual([{ name: 'Douglas Adams', sortName: null }]);
    expect(result.narrators).toEqual([]);
  });

  it('splits multiple albumartists by semicolons and slashes', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        common: {
          albumartist: 'Terry Pratchett; Neil Gaiman',
          album: 'Good Omens',
        } as unknown as IAudioMetadata['common'],
      }),
    );

    const result = await extractAudioMetadata('/path/good-omens.m4b');
    expect(result.authors).toHaveLength(2);
    expect(result.authors[0].name).toBe('Terry Pratchett');
    expect(result.authors[1].name).toBe('Neil Gaiman');
  });

  it('splits narrators by slash', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        common: {
          albumartist: 'Frank Herbert',
          artists: ['Scott Brick / Oliver Wyman'],
          album: 'Dune',
        } as unknown as IAudioMetadata['common'],
      }),
    );

    const result = await extractAudioMetadata('/path/dune.m4b');
    expect(result.narrators).toHaveLength(2);
    expect(result.narrators[0]).toBe('Scott Brick');
    expect(result.narrators[1]).toBe('Oliver Wyman');
  });
});

// ── TITLE RESOLUTION ─────────────────────────────────────────────────────────

describe('extractAudioMetadata — title', () => {
  beforeEach(() => resetAudioMocks());

  it('prefers album tag over track title', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        common: {
          album: 'Foundation',
          title: 'Part 1',
        } as unknown as IAudioMetadata['common'],
      }),
    );

    const result = await extractAudioMetadata('/path/file.mp3');
    expect(result.title).toBe('Foundation');
  });

  it('falls back to track title when album is absent', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        common: {
          title: 'Standalone Track',
        } as unknown as IAudioMetadata['common'],
      }),
    );

    const result = await extractAudioMetadata('/path/track.mp3');
    expect(result.title).toBe('Standalone Track');
  });

  it('returns null title when neither album nor title is present', async () => {
    mockParseFile.mockResolvedValue(makeMetadata());
    const result = await extractAudioMetadata('/path/noname.flac');
    expect(result.title).toBeNull();
  });
});

// ── DURATION ─────────────────────────────────────────────────────────────────

describe('extractAudioMetadata — duration', () => {
  beforeEach(() => resetAudioMocks());

  it('rounds duration to integer seconds', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        format: { duration: 3661.7 } as unknown as IAudioMetadata['format'],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');
    expect(result.durationSeconds).toBe(3662);
  });

  it('returns null duration when not present', async () => {
    mockParseFile.mockResolvedValue(makeMetadata());
    const result = await extractAudioMetadata('/path/book.m4b');
    expect(result.durationSeconds).toBeNull();
  });
});

// ── CHAPTERS ─────────────────────────────────────────────────────────────────

describe('extractAudioMetadata — chapters', () => {
  beforeEach(() => resetAudioMocks());

  it('prefers chapter markers extracted by mediainfo and sorts them by timestamp', async () => {
    const close = vi.fn();
    const read = vi.fn().mockResolvedValue(undefined);
    const stat = vi.fn().mockResolvedValue({ size: 4096 });
    mockOpen.mockResolvedValue({ stat, read, close });
    mockMediaInfoFactory.mockResolvedValue({
      analyzeData: vi.fn().mockResolvedValue({
        media: {
          track: [
            {
              '@type': 'Menu',
              extra: {
                _00_00_10_500: 'Chapter 2',
                _00_00_00_000: 'Introduction',
              },
            },
          ],
        },
      }),
      close: vi.fn(),
    });
    mockParseFile.mockResolvedValue(makeMetadata());

    const result = await extractAudioMetadata('/path/mediainfo.m4b');
    expect(result.chapters).toEqual([
      { title: 'Introduction', startMs: 0 },
      { title: 'Chapter 2', startMs: 10500 },
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('converts chapter sampleOffset to startMs using sampleRate', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        format: {
          sampleRate: 44100,
          chapters: [
            { title: 'Introduction', sampleOffset: 0, sampleLength: 44100 },
            { title: 'Chapter 1', sampleOffset: 44100, sampleLength: 88200 },
            { title: 'Chapter 2', sampleOffset: 132300, sampleLength: 44100 },
          ],
        } as unknown as IAudioMetadata['format'],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0]).toEqual({ title: 'Introduction', startMs: 0 });
    expect(result.chapters[1]).toEqual({ title: 'Chapter 1', startMs: 1000 });
    expect(result.chapters[2]).toEqual({ title: 'Chapter 2', startMs: 3000 });
  });

  it('uses default sampleRate of 44100 when not specified', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        format: {
          chapters: [{ title: 'Ch1', sampleOffset: 44100, sampleLength: 44100 }],
        } as unknown as IAudioMetadata['format'],
      }),
    );

    const result = await extractAudioMetadata('/path/book.mp3');
    expect(result.chapters[0].startMs).toBe(1000);
  });

  it('returns empty chapters when none are present', async () => {
    mockParseFile.mockResolvedValue(makeMetadata());
    const result = await extractAudioMetadata('/path/no-chapters.mp3');
    expect(result.chapters).toEqual([]);
  });
});

// ── COVER ─────────────────────────────────────────────────────────────────────

describe('extractAudioMetadata — cover', () => {
  beforeEach(() => resetAudioMocks());

  it('extracts cover bytes from embedded picture', async () => {
    const imageData = Buffer.from('fake-image-data');
    mockParseFile.mockResolvedValue(
      makeMetadata({
        common: {
          picture: [{ format: 'image/jpeg', data: new Uint8Array(imageData) }],
        } as unknown as IAudioMetadata['common'],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');
    expect(result.coverBytes).toBeInstanceOf(Buffer);
    expect(result.coverBytes?.toString()).toBe('fake-image-data');
  });

  it('returns null cover when no embedded picture', async () => {
    mockParseFile.mockResolvedValue(makeMetadata());
    const result = await extractAudioMetadata('/path/no-cover.mp3');
    expect(result.coverBytes).toBeNull();
  });
});

// ── OTHER FIELDS ─────────────────────────────────────────────────────────────

describe('extractAudioMetadata — misc fields', () => {
  beforeEach(() => resetAudioMocks());

  it('maps publisher, publishedYear, description, language', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        common: {
          label: ['Macmillan Audio'],
          year: 2006,
          comment: ['An epic sci-fi audiobook'],
          language: 'eng',
        } as unknown as IAudioMetadata['common'],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');
    expect(result.publisher).toBe('Macmillan Audio');
    expect(result.publishedYear).toBe(2006);
    expect(result.description).toBe('An epic sci-fi audiobook');
    expect(result.language).toBe('eng');
  });

  it('reads description from object comments and returns null when comment entries are blank', async () => {
    mockParseFile.mockResolvedValueOnce(
      makeMetadata({
        common: {
          comment: [{ text: 'Object-based comment' }],
        } as unknown as IAudioMetadata['common'],
      }),
    );
    mockParseFile.mockResolvedValueOnce(
      makeMetadata({
        common: {
          comment: ['  ', { text: '   ' }],
        } as unknown as IAudioMetadata['common'],
      }),
    );

    const withObjectComment = await extractAudioMetadata('/path/object-comment.m4b');
    const withBlankComments = await extractAudioMetadata('/path/blank-comment.m4b');

    expect(withObjectComment.description).toBe('Object-based comment');
    expect(withBlankComments.description).toBeNull();
  });
});

// ── FAILURE TOLERANCE ────────────────────────────────────────────────────────

describe('extractAudioMetadata — failure tolerance', () => {
  beforeEach(() => resetAudioMocks());

  it('returns safe empty result when parseFile throws', async () => {
    mockParseFile.mockRejectedValue(new Error('Cannot read file'));

    const result = await extractAudioMetadata('/path/corrupted.mp3');
    expect(result.title).toBeNull();
    expect(result.authors).toEqual([]);
    expect(result.narrators).toEqual([]);
    expect(result.durationSeconds).toBeNull();
    expect(result.chapters).toEqual([]);
    expect(result.coverBytes).toBeNull();
  });

  it('returns safe empty result for a non-audio file', async () => {
    mockParseFile.mockRejectedValue(new Error('Not an audio file'));

    const result = await extractAudioMetadata('/path/notaudio.txt');
    expect(result.title).toBeNull();
    expect(result.durationSeconds).toBeNull();
  });
});

// ── parseAudioDuration ────────────────────────────────────────────────────────

describe('parseAudioDuration', () => {
  beforeEach(() => resetAudioMocks());

  it('returns rounded duration in seconds', async () => {
    mockParseFile.mockResolvedValue(
      makeMetadata({
        format: { duration: 7200.4 } as unknown as IAudioMetadata['format'],
      }),
    );

    const result = await parseAudioDuration('/path/book.m4b');
    expect(result).toBe(7200);
  });

  it('returns null when duration is undefined', async () => {
    mockParseFile.mockResolvedValue(makeMetadata());
    const result = await parseAudioDuration('/path/book.mp3');
    expect(result).toBeNull();
  });

  it('returns null when parseFile throws', async () => {
    mockParseFile.mockRejectedValue(new Error('read error'));
    const result = await parseAudioDuration('/path/bad.mp3');
    expect(result).toBeNull();
  });
});
