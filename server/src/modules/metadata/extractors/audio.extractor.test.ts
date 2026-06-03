import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: vi.fn(), spawn: vi.fn() };
});

import { execFile as execFileCallback, spawn } from 'child_process';
import { extractAudioMetadata, parseAudioDuration } from './audio.extractor';
import { EventEmitter } from 'events';

const mockExecFile = execFileCallback as unknown as Mock;
const mockSpawn = spawn as unknown as Mock;

interface FfprobeOutput {
  format?: {
    duration?: string;
    tags?: Record<string, string>;
  };
  streams?: Array<{ codec_type: string; codec_name?: string; tags?: Record<string, string> }>;
  chapters?: Array<{ start_time: string; tags?: { title?: string } }>;
}

function makeProbeOutput(overrides: FfprobeOutput = {}): string {
  const base: FfprobeOutput = {
    format: { duration: '3600', tags: {} },
    streams: [{ codec_type: 'audio', codec_name: 'aac' }],
    chapters: [],
  };
  return JSON.stringify({
    format: { ...base.format, ...overrides.format, tags: { ...(base.format?.tags ?? {}), ...(overrides.format?.tags ?? {}) } },
    streams: overrides.streams ?? base.streams,
    chapters: overrides.chapters ?? base.chapters,
  });
}

type ExecFileCallback = (err: Error | null, result: { stdout: string; stderr: string } | string) => void;

function makeExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation((_bin: string, _args: string[], callback: ExecFileCallback) => {
    callback(null, { stdout, stderr: '' });
  });
}

function makeExecFileError(message: string) {
  mockExecFile.mockImplementation((_bin: string, _args: string[], callback: ExecFileCallback) => {
    callback(new Error(message), '');
  });
}

function makeSpawnProcess(coverBytes: Buffer | null): EventEmitter & { stdout: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
  proc.stdout = new EventEmitter();
  setImmediate(() => {
    if (coverBytes) proc.stdout.emit('data', coverBytes);
    proc.emit('close', coverBytes ? 0 : 1);
  });
  return proc;
}

function makeSpawnError() {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
  proc.stdout = new EventEmitter();
  setImmediate(() => proc.emit('error', new Error('spawn failed')));
  return proc;
}

function resetMocks() {
  vi.resetAllMocks();
  mockSpawn.mockReturnValue(makeSpawnProcess(null));
}

// ── AUTHOR / NARRATOR SPLIT ───────────────────────────────────────────────────

describe('extractAudioMetadata — author/narrator split', () => {
  beforeEach(() => resetMocks());

  it('uses albumartist as author and composer as narrator for modern tags', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: { tags: { album: 'The Lord of the Rings', albumartist: 'J.R.R. Tolkien', artist: 'J.R.R. Tolkien', composer: 'Andy Serkis' } },
      }),
    );

    const result = await extractAudioMetadata('/path/lotr.m4b');

    expect(result.authors).toEqual([{ name: 'J.R.R. Tolkien', sortName: null }]);
    expect(result.narrators).toEqual(['Andy Serkis']);
  });

  it('uses artist as narrator for old BookOrbit tags when albumartist exists and composer is absent', async () => {
    makeExecFileSuccess(
      makeProbeOutput({ format: { tags: { album: 'The Lord of the Rings', albumartist: 'J.R.R. Tolkien', artist: 'Andy Serkis' } } }),
    );

    const result = await extractAudioMetadata('/path/lotr.m4b');

    expect(result.authors).toEqual([{ name: 'J.R.R. Tolkien', sortName: null }]);
    expect(result.narrators).toEqual(['Andy Serkis']);
  });

  it('does not use artist as narrator when it matches albumartist', async () => {
    makeExecFileSuccess(
      makeProbeOutput({ format: { tags: { album: 'The Lord of the Rings', albumartist: 'J.R.R. Tolkien', artist: ' j.r.r. tolkien ' } } }),
    );

    const result = await extractAudioMetadata('/path/lotr.m4b');

    expect(result.authors).toEqual([{ name: 'J.R.R. Tolkien', sortName: null }]);
    expect(result.narrators).toEqual([]);
  });

  it('uses artist as author and leaves narrators empty when albumartist is absent', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { album: "The Hitchhiker's Guide", artist: 'Douglas Adams' } } }));

    const result = await extractAudioMetadata('/path/hhg.mp3');

    expect(result.authors).toEqual([{ name: 'Douglas Adams', sortName: null }]);
    expect(result.narrators).toEqual([]);
  });

  it('uses artist as author and composer as narrator when albumartist is absent', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { album: 'Project Hail Mary', artist: 'Andy Weir', composer: 'Ray Porter' } } }));

    const result = await extractAudioMetadata('/path/project-hail-mary.m4b');

    expect(result.authors).toEqual([{ name: 'Andy Weir', sortName: null }]);
    expect(result.narrators).toEqual(['Ray Porter']);
  });

  it('splits composer narrators by comma', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: { tags: { album: 'The Eye of the Bedlam Bride', artist: 'Matt Dinniman', composer: 'Jeff Hays, Patrick Warburton, Travis Baldree' } },
      }),
    );

    const result = await extractAudioMetadata('/path/bedlam-bride.m4b');

    expect(result.narrators).toEqual(['Jeff Hays', 'Patrick Warburton', 'Travis Baldree']);
  });

  it('does not split authors by comma', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { album: 'Star Surgeon', artist: 'Nourse, Alan E.' } } }));

    const result = await extractAudioMetadata('/path/star-surgeon.m4b');

    expect(result.authors).toEqual([{ name: 'Nourse, Alan E.', sortName: null }]);
  });

  it('splits albumartist by semicolons', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { album: 'Good Omens', albumartist: 'Terry Pratchett; Neil Gaiman' } } }));

    const result = await extractAudioMetadata('/path/good-omens.m4b');

    expect(result.authors).toHaveLength(2);
    expect(result.authors[0].name).toBe('Terry Pratchett');
    expect(result.authors[1].name).toBe('Neil Gaiman');
  });

  it('splits albumartist by slashes', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { albumartist: 'Auth A / Auth B', artist: 'Narrator' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.authors).toHaveLength(2);
    expect(result.authors[0].name).toBe('Auth A');
    expect(result.authors[1].name).toBe('Auth B');
  });

  it('splits narrators by slash when albumartist is set', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { album: 'Dune', albumartist: 'Frank Herbert', artist: 'Scott Brick / Oliver Wyman' } } }));

    const result = await extractAudioMetadata('/path/dune.m4b');

    expect(result.narrators).toHaveLength(2);
    expect(result.narrators[0]).toBe('Scott Brick');
    expect(result.narrators[1]).toBe('Oliver Wyman');
  });

  it('returns empty authors and narrators when neither albumartist nor artist is set', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { album: 'Unknown Book' } } }));

    const result = await extractAudioMetadata('/path/unknown.m4b');

    expect(result.authors).toEqual([]);
    expect(result.narrators).toEqual([]);
  });

  it('handles album_artist tag as fallback for albumartist', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { album: 'Foundation', album_artist: 'Isaac Asimov' } } }));

    const result = await extractAudioMetadata('/path/foundation.m4b');

    expect(result.authors).toEqual([{ name: 'Isaac Asimov', sortName: null }]);
  });

  it('all sortNames are null', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { albumartist: 'Author One' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    result.authors.forEach((a) => expect(a.sortName).toBeNull());
  });
});

// ── TITLE RESOLUTION ─────────────────────────────────────────────────────────

describe('extractAudioMetadata — title', () => {
  beforeEach(() => resetMocks());

  it('prefers album tag over title tag', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { album: 'Foundation', title: 'Part 1' } } }));

    const result = await extractAudioMetadata('/path/file.mp3');

    expect(result.title).toBe('Foundation');
  });

  it('falls back to title tag when album is absent', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { title: 'Standalone Track' } } }));

    const result = await extractAudioMetadata('/path/track.mp3');

    expect(result.title).toBe('Standalone Track');
  });

  it('returns null title when neither album nor title is present', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: {} } }));

    const result = await extractAudioMetadata('/path/noname.flac');

    expect(result.title).toBeNull();
  });

  it('maps subtitle tag separately from title', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { album: 'Dungeon Crawler Carl', subtitle: 'A LitRPG/Gamelit Adventure' } } }));

    const result = await extractAudioMetadata('/path/dcc.m4b');

    expect(result.title).toBe('Dungeon Crawler Carl');
    expect(result.subtitle).toBe('A LitRPG/Gamelit Adventure');
  });
});

// ── DURATION ─────────────────────────────────────────────────────────────────

describe('extractAudioMetadata — duration', () => {
  beforeEach(() => resetMocks());

  it('rounds duration to integer seconds', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { duration: '3661.7', tags: {} } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.durationSeconds).toBe(3662);
  });

  it('returns null duration when format.duration is absent', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { tags: {} }, streams: [], chapters: [] }));

    const result = await extractAudioMetadata('/path/no-duration.m4b');

    expect(result.durationSeconds).toBeNull();
  });

  it('returns null duration when format.duration is not numeric', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { duration: 'N/A', tags: {} } }));

    const result = await extractAudioMetadata('/path/bad-duration.m4b');

    expect(result.durationSeconds).toBeNull();
  });
});

// ── CHAPTERS ─────────────────────────────────────────────────────────────────

describe('extractAudioMetadata — chapters', () => {
  beforeEach(() => resetMocks());

  it('maps ffprobe chapters to startMs and title', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        chapters: [
          { start_time: '0.000000', tags: { title: 'Introduction' } },
          { start_time: '945.530000', tags: { title: 'Chapter 2' } },
          { start_time: '2263.696667', tags: { title: 'Chapter 3' } },
        ],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0]).toEqual({ title: 'Introduction', startMs: 0 });
    expect(result.chapters[1]).toEqual({ title: 'Chapter 2', startMs: 945530 });
    expect(result.chapters[2]).toEqual({ title: 'Chapter 3', startMs: 2263697 });
  });

  it('handles chapters with no title tag', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        chapters: [{ start_time: '100.000', tags: {} }],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.chapters[0]).toEqual({ title: '', startMs: 100000 });
  });

  it('returns empty chapters array when none present', async () => {
    makeExecFileSuccess(makeProbeOutput({ chapters: [] }));

    const result = await extractAudioMetadata('/path/no-chapters.mp3');

    expect(result.chapters).toEqual([]);
  });

  it('skips chapters with non-numeric start times', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        chapters: [
          { start_time: 'N/A', tags: { title: 'Bad Chapter' } },
          { start_time: '42.500', tags: { title: 'Good Chapter' } },
        ],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.chapters).toEqual([{ title: 'Good Chapter', startMs: 42500 }]);
  });
});

// ── COVER ─────────────────────────────────────────────────────────────────────

describe('extractAudioMetadata — cover', () => {
  beforeEach(() => resetMocks());

  it('extracts cover bytes when a video stream is present', async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    makeExecFileSuccess(
      makeProbeOutput({
        streams: [
          { codec_type: 'audio', codec_name: 'aac' },
          { codec_type: 'video', codec_name: 'mjpeg' },
        ],
      }),
    );
    mockSpawn.mockReturnValue(makeSpawnProcess(fakeJpeg));

    const result = await extractAudioMetadata('/path/with-cover.m4b');

    expect(result.coverBytes).toBeInstanceOf(Buffer);
    expect(result.coverBytes).toEqual(fakeJpeg);
  });

  it('returns null cover when no video stream present', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        streams: [{ codec_type: 'audio', codec_name: 'aac' }],
      }),
    );

    const result = await extractAudioMetadata('/path/no-cover.mp3');

    expect(result.coverBytes).toBeNull();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns null cover when ffmpeg exits with non-zero code', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        streams: [{ codec_type: 'video', codec_name: 'mjpeg' }],
      }),
    );
    mockSpawn.mockReturnValue(makeSpawnProcess(null));

    const result = await extractAudioMetadata('/path/broken-cover.m4b');

    expect(result.coverBytes).toBeNull();
  });

  it('returns null cover when ffmpeg spawn emits an error', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        streams: [{ codec_type: 'video', codec_name: 'mjpeg' }],
      }),
    );
    mockSpawn.mockReturnValue(makeSpawnError());

    const result = await extractAudioMetadata('/path/spawn-error.m4b');

    expect(result.coverBytes).toBeNull();
  });

  it('spawns ffmpeg with correct arguments', async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8]);
    makeExecFileSuccess(
      makeProbeOutput({
        streams: [{ codec_type: 'video', codec_name: 'mjpeg' }],
      }),
    );
    mockSpawn.mockReturnValue(makeSpawnProcess(fakeJpeg));

    await extractAudioMetadata('/books/test.m4b');

    expect(mockSpawn).toHaveBeenCalledWith(
      'ffmpeg',
      ['-y', '-i', '/books/test.m4b', '-map', '0:v', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'ignore'] }),
    );
  });
});

// ── OTHER FIELDS ─────────────────────────────────────────────────────────────

describe('extractAudioMetadata — misc fields', () => {
  beforeEach(() => resetMocks());

  it('maps publisher, publishedYear from date tag, description, and language from tags', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: {
          duration: '100',
          tags: {
            publisher: 'Macmillan Audio',
            date: '2006-04-15',
            comment: 'An epic sci-fi audiobook',
            language: 'eng',
            genre: 'Science Fiction; Adventure',
            series: 'Dune',
            'series-part': '1.5',
            asin: 'B000R34YKC',
          },
        },
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.publisher).toBe('Macmillan Audio');
    expect(result.publishedYear).toBe(2006);
    expect(result.description).toBe('An epic sci-fi audiobook');
    expect(result.language).toBe('eng');
    expect(result.genres).toEqual(['Science Fiction', 'Adventure']);
    expect(result.seriesName).toBe('Dune');
    expect(result.seriesIndex).toBe(1.5);
    expect(result.audibleId).toBe('B000R34YKC');
  });

  it('uses audible_asin when asin is absent and deduplicates semicolon-separated genres', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { genre: 'Mystery; mystery; Thriller', audible_asin: 'AUDIBLE123' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.genres).toEqual(['Mystery', 'Thriller']);
    expect(result.audibleId).toBe('AUDIBLE123');
  });

  it.each([
    ['part', '6'],
    ['series_part', '7'],
    ['seriespart', '8'],
  ])('uses %s as a series index fallback', async (tagName, rawIndex) => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { series: 'Dungeon Crawler Carl', [tagName]: rawIndex } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.seriesName).toBe('Dungeon Crawler Carl');
    expect(result.seriesIndex).toBe(Number(rawIndex));
  });

  it('parses year from a plain year string', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { year: '1984' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.publishedYear).toBe(1984);
  });

  it('returns null publishedYear when date tag is absent', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: {} } }));

    const result = await extractAudioMetadata('/path/no-year.mp3');

    expect(result.publishedYear).toBeNull();
  });

  it('returns null publisher when tag is absent', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: {} } }));

    const result = await extractAudioMetadata('/path/book.mp3');

    expect(result.publisher).toBeNull();
  });

  it('returns null description when comment tag is absent', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: {} } }));

    const result = await extractAudioMetadata('/path/no-desc.mp3');

    expect(result.description).toBeNull();
  });

  it('resolves language from audio stream tags when format tag is absent', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        streams: [{ codec_type: 'audio', codec_name: 'aac', tags: { language: 'fra' } }],
      }),
    );

    const result = await extractAudioMetadata('/path/french.m4b');

    expect(result.language).toBe('fra');
  });

  it('ignores undefined format language and falls back to stream language', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: { duration: '100', tags: { language: 'und' } },
        streams: [{ codec_type: 'audio', codec_name: 'aac', tags: { language: 'eng' } }],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.language).toBe('eng');
  });

  it('returns null when language tags are unknown placeholders', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: { duration: '100', tags: { language: 'unknown' } },
        streams: [{ codec_type: 'audio', codec_name: 'aac', tags: { language: 'und' } }],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.language).toBeNull();
  });

  it('prefers format language tag over stream language', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: { duration: '100', tags: { language: 'eng' } },
        streams: [{ codec_type: 'audio', codec_name: 'aac', tags: { language: 'fra' } }],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.language).toBe('eng');
  });

  it('returns null language when neither format nor stream has a language tag', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        streams: [{ codec_type: 'audio', codec_name: 'aac' }],
      }),
    );

    const result = await extractAudioMetadata('/path/no-lang.mp3');

    expect(result.language).toBeNull();
  });

  it('handles uppercase tag keys by normalizing to lowercase', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { ALBUM: 'Normalized Title', ARTIST: 'Normalized Author' } } }));

    const result = await extractAudioMetadata('/path/uppercase-tags.mp3');

    expect(result.title).toBe('Normalized Title');
    expect(result.authors).toEqual([{ name: 'Normalized Author', sortName: null }]);
  });
});

// ── FAILURE TOLERANCE ────────────────────────────────────────────────────────

describe('extractAudioMetadata — failure tolerance', () => {
  beforeEach(() => resetMocks());

  it('returns all-null safe result when ffprobe exits with an error', async () => {
    makeExecFileError('ffprobe: command not found');

    const result = await extractAudioMetadata('/path/corrupted.mp3');

    expect(result.title).toBeNull();
    expect(result.authors).toEqual([]);
    expect(result.narrators).toEqual([]);
    expect(result.durationSeconds).toBeNull();
    expect(result.chapters).toEqual([]);
    expect(result.coverBytes).toBeNull();
  });

  it('returns all-null safe result when ffprobe outputs invalid JSON', async () => {
    makeExecFileSuccess('not valid json at all {{}}');

    const result = await extractAudioMetadata('/path/bad-output.mp3');

    expect(result.title).toBeNull();
    expect(result.durationSeconds).toBeNull();
  });

  it('returns all-null safe result for a non-audio file', async () => {
    makeExecFileError('Invalid data found when processing input');

    const result = await extractAudioMetadata('/path/notaudio.txt');

    expect(result.title).toBeNull();
    expect(result.durationSeconds).toBeNull();
  });

  it('invokes ffprobe with correct arguments', async () => {
    makeExecFileSuccess(makeProbeOutput());

    await extractAudioMetadata('/books/my-audiobook.m4b');

    expect(mockExecFile).toHaveBeenCalledWith(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_chapters', '-show_streams', '/books/my-audiobook.m4b'],
      expect.any(Function),
    );
  });
});

// ── parseAudioDuration ────────────────────────────────────────────────────────

describe('parseAudioDuration', () => {
  beforeEach(() => resetMocks());

  it('returns rounded duration in seconds', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '7200.4' } }));

    const result = await parseAudioDuration('/path/book.m4b');

    expect(result).toBe(7200);
  });

  it('returns null when format.duration is missing', async () => {
    makeExecFileSuccess(JSON.stringify({ format: {} }));

    const result = await parseAudioDuration('/path/no-duration.mp3');

    expect(result).toBeNull();
  });

  it('returns null when format.duration is not numeric', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: 'N/A' } }));

    const result = await parseAudioDuration('/path/bad-duration.mp3');

    expect(result).toBeNull();
  });

  it('returns null when ffprobe throws', async () => {
    makeExecFileError('read error');

    const result = await parseAudioDuration('/path/bad.mp3');

    expect(result).toBeNull();
  });

  it('invokes ffprobe with format-only arguments (no chapters or streams)', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '100' } }));

    await parseAudioDuration('/books/test.mp3');

    expect(mockExecFile).toHaveBeenCalledWith(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '/books/test.mp3'],
      expect.any(Function),
    );
  });
});

// ── DESCRIPTION TAG FALLBACK ──────────────────────────────────────────────────

describe('extractAudioMetadata — description tag fallback', () => {
  beforeEach(() => resetMocks());

  it('uses description tag when comment tag is absent', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { description: 'A great book' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.description).toBe('A great book');
  });

  it('uses description tag when it is longer than comment tag', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { comment: 'Truncated text', description: 'Longer complete description text' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.description).toBe('Longer complete description text');
  });

  it('uses comment tag when it is longer than description tag', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { comment: 'Longer complete comment text', description: 'Short text' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.description).toBe('Longer complete comment text');
  });

  it('uses lyrics tag when it is longer than comment and description tags', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: { tags: { comment: 'Short comment', description: 'Short description', lyrics: 'Longer complete synopsis from lyrics tag' } },
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.description).toBe('Longer complete synopsis from lyrics tag');
  });

  it('uses lyrics tag when comment and description tags are absent', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { lyrics: 'LibriVox synopsis' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.description).toBe('LibriVox synopsis');
  });

  it('uses synopsis tag when it is the longest description-like tag', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { comment: 'Short comment', synopsis: 'Longer long-description synopsis text' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.description).toBe('Longer long-description synopsis text');
  });

  it('returns null description when no description-like tags are present', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: {} } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.description).toBeNull();
  });
});

// ── OPTIONAL FFPROBE OUTPUT FIELDS ───────────────────────────────────────────

describe('extractAudioMetadata — optional ffprobe output fields', () => {
  beforeEach(() => resetMocks());

  it('handles completely absent streams field gracefully', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '100', tags: { album: 'No Streams' } } }));

    const result = await extractAudioMetadata('/path/no-streams.mp3');

    expect(result.title).toBe('No Streams');
    expect(result.durationSeconds).toBe(100);
    expect(result.coverBytes).toBeNull();
    expect(result.language).toBeNull();
  });

  it('handles completely absent chapters field gracefully', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '200', tags: { album: 'No Chapters' } }, streams: [] }));

    const result = await extractAudioMetadata('/path/no-chapters.mp3');

    expect(result.title).toBe('No Chapters');
    expect(result.chapters).toEqual([]);
  });

  it('handles a chapter with no tags property at all', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        chapters: [{ start_time: '60.000' }],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]).toEqual({ title: '', startMs: 60000 });
  });

  it('parses year from an ISO date string', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { date: '2003-07-21' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.publishedYear).toBe(2003);
  });

  it('returns null publishedYear when date string contains no 4-digit sequence', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { date: 'unknown' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.publishedYear).toBeNull();
  });

  it('handles format object with no tags property at all', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '300' }, streams: [], chapters: [] }));

    const result = await extractAudioMetadata('/path/no-tags.m4b');

    expect(result.title).toBeNull();
    expect(result.authors).toEqual([]);
    expect(result.durationSeconds).toBe(300);
  });
});

// ── COVER MULTI-CHUNK CONCATENATION ──────────────────────────────────────────

describe('extractAudioMetadata — cover multi-chunk', () => {
  beforeEach(() => resetMocks());

  it('concatenates multiple stdout chunks into one cover buffer', async () => {
    const chunk1 = Buffer.from([0xff, 0xd8]);
    const chunk2 = Buffer.from([0xff, 0xe0]);
    const chunk3 = Buffer.from([0x01, 0x02]);
    const expected = Buffer.concat([chunk1, chunk2, chunk3]);

    makeExecFileSuccess(
      makeProbeOutput({
        streams: [{ codec_type: 'video', codec_name: 'mjpeg' }],
      }),
    );

    const proc = new (await import('events')).EventEmitter() as ReturnType<typeof makeSpawnProcess>;
    proc.stdout = new (await import('events')).EventEmitter();
    setImmediate(() => {
      proc.stdout.emit('data', chunk1);
      proc.stdout.emit('data', chunk2);
      proc.stdout.emit('data', chunk3);
      proc.emit('close', 0);
    });
    mockSpawn.mockReturnValue(proc);

    const result = await extractAudioMetadata('/path/multi-chunk.m4b');

    expect(result.coverBytes).toEqual(expected);
  });
});

// ── ENV VAR BINARY PATH OVERRIDE ─────────────────────────────────────────────

describe('binary path env var override', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses FFPROBE_PATH env var when set', async () => {
    vi.stubEnv('FFPROBE_PATH', '/opt/bin/ffprobe');
    vi.resetModules();

    const { execFile: execFileMock, spawn: spawnMock } = await import('child_process');
    (execFileMock as unknown as Mock).mockImplementation((_bin: string, _args: string[], cb: (err: null, r: { stdout: string }) => void) => {
      cb(null, { stdout: JSON.stringify({ format: { duration: '100', tags: {} }, streams: [], chapters: [] }) });
    });
    (spawnMock as unknown as Mock).mockReturnValue(makeSpawnProcess(null));

    const { extractAudioMetadata: extract } = await import('./audio.extractor');
    await extract('/path/test.m4b');

    expect(execFileMock).toHaveBeenCalledWith('/opt/bin/ffprobe', expect.any(Array), expect.any(Function));
  });

  it('uses FFMPEG_PATH env var when set', async () => {
    vi.stubEnv('FFMPEG_PATH', '/opt/bin/ffmpeg');
    vi.resetModules();

    const { execFile: execFileMock, spawn: spawnMock } = await import('child_process');
    (execFileMock as unknown as Mock).mockImplementation((_bin: string, _args: string[], cb: (err: null, r: { stdout: string }) => void) => {
      cb(null, {
        stdout: JSON.stringify({
          format: { duration: '100', tags: {} },
          streams: [{ codec_type: 'video', codec_name: 'mjpeg' }],
          chapters: [],
        }),
      });
    });

    const proc = new (await import('events')).EventEmitter() as ReturnType<typeof makeSpawnProcess>;
    proc.stdout = new (await import('events')).EventEmitter();
    setImmediate(() => proc.emit('close', 1));
    (spawnMock as unknown as Mock).mockReturnValue(proc);

    const { extractAudioMetadata: extract } = await import('./audio.extractor');
    await extract('/path/test.m4b');

    expect(spawnMock).toHaveBeenCalledWith('/opt/bin/ffmpeg', expect.any(Array), expect.objectContaining({ stdio: ['ignore', 'pipe', 'ignore'] }));
  });

  it('falls back to bare ffprobe command when FFPROBE_PATH is not set', async () => {
    vi.stubEnv('FFPROBE_PATH', '');
    vi.resetModules();

    const { execFile: execFileMock, spawn: spawnMock } = await import('child_process');
    (execFileMock as unknown as Mock).mockImplementation((_bin: string, _args: string[], cb: (err: null, r: { stdout: string }) => void) => {
      cb(null, { stdout: JSON.stringify({ format: { duration: '100', tags: {} }, streams: [], chapters: [] }) });
    });
    (spawnMock as unknown as Mock).mockReturnValue(makeSpawnProcess(null));

    const { extractAudioMetadata: extract } = await import('./audio.extractor');
    await extract('/path/test.m4b');

    expect(execFileMock).toHaveBeenCalledWith('ffprobe', expect.any(Array), expect.any(Function));
  });
});
