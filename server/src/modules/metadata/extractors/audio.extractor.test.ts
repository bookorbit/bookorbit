import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: vi.fn(), spawn: vi.fn() };
});
vi.mock('music-metadata', () => ({ parseFile: vi.fn() }));

import { execFile as execFileCallback, spawn } from 'child_process';
import { parseFile } from 'music-metadata';
import { extractAudioMetadata, probeAudioChapters, probeAudioFile } from './audio.extractor';
import { EventEmitter } from 'events';

const mockExecFile = execFileCallback as unknown as Mock;
const mockSpawn = spawn as unknown as Mock;
const mockParseFile = parseFile as unknown as Mock;

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

// execFile is called with an options object, so the callback is the last argument, not the third.
function execFileCallbackOf(args: unknown[]): ExecFileCallback {
  return args[args.length - 1] as ExecFileCallback;
}

function makeExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    execFileCallbackOf(args)(null, { stdout, stderr: '' });
  });
}

function makeExecFileError(message: string) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    execFileCallbackOf(args)(new Error(message), '');
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
  // Unreadable in-process by default, so the ffprobe path stays what these tests exercise.
  mockParseFile.mockRejectedValue(new Error('unsupported file'));
}

function makeParsed(format: Record<string, unknown>) {
  mockParseFile.mockResolvedValue({ format, common: {}, native: {}, quality: { warnings: [] } });
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
            'series-part': '5.10',
            asin: 'B000R34YKC',
            librofm_isbn: '9781234567890',
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
    expect(result.seriesIndex).toBe('5.10');
    expect(result.audibleId).toBe('B000R34YKC');
    expect(result.librofmId).toBe('9781234567890');
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
    ['episode_id', '8.5'],
    ['episode_sort', '9'],
  ])('uses %s as a series index fallback', async (tagName, rawIndex) => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { series: 'Dungeon Crawler Carl', [tagName]: rawIndex } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.seriesName).toBe('Dungeon Crawler Carl');
    expect(result.seriesIndex).toBe(rawIndex);
  });

  it('reads MP4-native series tags when custom tags are absent', async () => {
    makeExecFileSuccess(makeProbeOutput({ format: { tags: { show: 'The Murderbot Diaries', episode_id: '2.5' } } }));

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.seriesName).toBe('The Murderbot Diaries');
    expect(result.seriesIndex).toBe('2.5');
  });

  it('prefers established custom series tags over MP4-native aliases', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: {
          tags: {
            series: 'Custom Series',
            'series-part': '4.5',
            show: 'Native Series',
            episode_id: '9',
          },
        },
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result.seriesName).toBe('Custom Series');
    expect(result.seriesIndex).toBe('4.5');
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

// ── STREAM-LEVEL TAGS (OGG OPUS / VORBIS) ────────────────────────────────────

describe('extractAudioMetadata - stream-level tags', () => {
  beforeEach(() => resetMocks());

  it('reads every mapped field from the audio stream when the format carries no tags', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: { duration: '1800', tags: {} },
        streams: [
          {
            codec_type: 'audio',
            codec_name: 'opus',
            tags: {
              title: 'Track One',
              album: 'Blinkist Summary',
              artist: 'Jane Author',
              albumartist: 'Jane Author',
              composer: 'Sam Narrator',
              date: '2021-05-04',
              genre: 'Business; Self-help',
              comment: 'A short summary',
              publisher: 'Blinkist',
              series: 'Summaries',
              'series-part': '3',
              language: 'eng',
            },
          },
        ],
      }),
    );

    const result = await extractAudioMetadata('/path/summary.opus');

    expect(result?.title).toBe('Blinkist Summary');
    expect(result?.authors).toEqual([{ name: 'Jane Author', sortName: null }]);
    expect(result?.narrators).toEqual(['Sam Narrator']);
    expect(result?.publishedYear).toBe(2021);
    expect(result?.genres).toEqual(['Business', 'Self-help']);
    expect(result?.description).toBe('A short summary');
    expect(result?.publisher).toBe('Blinkist');
    expect(result?.seriesName).toBe('Summaries');
    expect(result?.seriesIndex).toBe('3');
    expect(result?.language).toBe('eng');
    expect(result?.durationSeconds).toBe(1800);
  });

  it('normalizes the upper-case keys Vorbis comments use', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        streams: [{ codec_type: 'audio', codec_name: 'vorbis', tags: { ALBUM: 'Upper Album', ARTIST: 'Upper Artist', ALBUMARTIST: 'Upper Author' } }],
      }),
    );

    const result = await extractAudioMetadata('/path/upper.ogg');

    expect(result?.title).toBe('Upper Album');
    expect(result?.authors).toEqual([{ name: 'Upper Author', sortName: null }]);
    expect(result?.narrators).toEqual(['Upper Artist']);
  });

  it('prefers a format tag over the same tag on the stream', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: { tags: { album: 'Format Album' } },
        streams: [{ codec_type: 'audio', codec_name: 'aac', tags: { album: 'Stream Album' } }],
      }),
    );

    const result = await extractAudioMetadata('/path/book.m4b');

    expect(result?.title).toBe('Format Album');
  });

  it('fills a tag the format lacks from the stream while keeping the format tags it has', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: { tags: { album: 'Format Album' } },
        streams: [{ codec_type: 'audio', codec_name: 'opus', tags: { album: 'Stream Album', artist: 'Stream Artist' } }],
      }),
    );

    const result = await extractAudioMetadata('/path/mixed.opus');

    expect(result?.title).toBe('Format Album');
    expect(result?.authors).toEqual([{ name: 'Stream Artist', sortName: null }]);
  });

  it('takes the stream value when the format tag is blank', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        format: { tags: { album: '   ' } },
        streams: [{ codec_type: 'audio', codec_name: 'opus', tags: { album: 'Stream Album' } }],
      }),
    );

    const result = await extractAudioMetadata('/path/blank.opus');

    expect(result?.title).toBe('Stream Album');
  });

  it('prefers the earlier audio stream when several carry the same tag', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        streams: [
          { codec_type: 'audio', codec_name: 'vorbis', tags: { album: 'First Stream' } },
          { codec_type: 'audio', codec_name: 'vorbis', tags: { album: 'Second Stream', publisher: 'Second Publisher' } },
        ],
      }),
    );

    const result = await extractAudioMetadata('/path/chained.ogg');

    expect(result?.title).toBe('First Stream');
    expect(result?.publisher).toBe('Second Publisher');
  });

  it('ignores the tags of an attached cover picture', async () => {
    makeExecFileSuccess(
      makeProbeOutput({
        streams: [
          { codec_type: 'audio', codec_name: 'opus', tags: { album: 'Real Album' } },
          { codec_type: 'video', codec_name: 'mjpeg', tags: { title: 'Cover', comment: 'Cover (front)' } },
        ],
      }),
    );

    const result = await extractAudioMetadata('/path/with-cover.opus');

    expect(result?.title).toBe('Real Album');
    expect(result?.description).toBeNull();
  });

  it('still reads as untagged when neither the format nor the audio stream has tags', async () => {
    makeExecFileSuccess(makeProbeOutput({ streams: [{ codec_type: 'audio', codec_name: 'opus' }] }));

    const result = await extractAudioMetadata('/path/untagged.opus');

    expect(result).not.toBeNull();
    expect(result?.title).toBeNull();
    expect(result?.authors).toEqual([]);
  });
});

// ── FAILURE TOLERANCE ────────────────────────────────────────────────────────

describe('extractAudioMetadata — failure tolerance', () => {
  beforeEach(() => resetMocks());

  // Null, never an all-null result: callers persist what they are handed, so a file that could not
  // be read must not look like a file whose tags are empty.
  it('returns null when ffprobe exits with an error', async () => {
    makeExecFileError('ffprobe: command not found');

    expect(await extractAudioMetadata('/path/corrupted.mp3')).toBeNull();
  });

  it('returns null when ffprobe outputs invalid JSON', async () => {
    makeExecFileSuccess('not valid json at all {{}}');

    expect(await extractAudioMetadata('/path/bad-output.mp3')).toBeNull();
  });

  it('returns null for a non-audio file', async () => {
    makeExecFileError('Invalid data found when processing input');

    expect(await extractAudioMetadata('/path/notaudio.txt')).toBeNull();
  });

  it('returns an empty result rather than null when the file has no tags', async () => {
    makeExecFileSuccess(makeProbeOutput());

    const result = await extractAudioMetadata('/path/untagged.mp3');

    expect(result).not.toBeNull();
    expect(result?.title).toBeNull();
  });

  it('invokes ffprobe with correct arguments', async () => {
    makeExecFileSuccess(makeProbeOutput());

    await extractAudioMetadata('/books/my-audiobook.m4b');

    expect(mockExecFile).toHaveBeenCalledWith(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_chapters', '-show_streams', '/books/my-audiobook.m4b'],
      expect.objectContaining({ maxBuffer: expect.any(Number) }),
      expect.any(Function),
    );
  });
});

// ── probeAudioFile ────────────────────────────────────────────────────────────

describe('probeAudioFile', () => {
  beforeEach(() => resetMocks());

  it('returns the rounded length in seconds alongside the exact milliseconds and chapters', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '7200.4' }, chapters: [{ start_time: '0.000000', tags: { title: 'Opening' } }] }));

    const result = await probeAudioFile('/path/book.m4b');

    expect(result).toEqual({ durationSeconds: 7200, durationMs: 7_200_400, chapters: [{ title: 'Opening', startMs: 0 }] });
  });

  it('rounds seconds from the raw value, not from the rounded milliseconds', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '2.4996' } }));

    const result = await probeAudioFile('/path/book.m4b');

    expect(result).toMatchObject({ durationSeconds: 2, durationMs: 2_500 });
  });

  it('reports an unknown length when format.duration is missing', async () => {
    makeExecFileSuccess(JSON.stringify({ format: {} }));

    const result = await probeAudioFile('/path/no-duration.mp3');

    expect(result).toEqual({ durationSeconds: null, durationMs: null, chapters: [] });
  });

  it('reports an unknown length when format.duration is not numeric', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: 'N/A' } }));

    const result = await probeAudioFile('/path/bad-duration.mp3');

    expect(result).toEqual({ durationSeconds: null, durationMs: null, chapters: [] });
  });

  it('returns null when ffprobe throws, so a failed read is never taken for a chapterless file', async () => {
    makeExecFileError('read error');

    const result = await probeAudioFile('/path/bad.mp3');

    expect(result).toBeNull();
  });

  it('reads format and chapters in one ffprobe run, and never extracts a cover', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '100' }, chapters: [] }));

    await probeAudioFile('/books/test.mp3');

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledWith(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_chapters', '/books/test.mp3'],
      expect.objectContaining({ maxBuffer: expect.any(Number) }),
      expect.any(Function),
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe('probeAudioFile with the built-in reader', () => {
  beforeEach(() => resetMocks());

  it('reads length and MP4 chapters without launching ffprobe, counting chapter starts in their time scale', async () => {
    makeParsed({
      duration: 21148.235464,
      containerDuration: 21148.235011,
      chapters: [
        { title: 'Chapter 1', timeScale: 44100, start: 0 },
        { title: 'Chapter 2', timeScale: 44100, start: 24227702 },
      ],
    });

    const result = await probeAudioFile('/books/Book/book.m4b', 'builtin');

    expect(result).toEqual({
      durationSeconds: 21148,
      durationMs: 21_148_235,
      chapters: [
        { title: 'Chapter 1', startMs: 0 },
        { title: 'Chapter 2', startMs: 549_381 },
      ],
    });
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockParseFile).toHaveBeenCalledWith('/books/Book/book.m4b', {
      duration: false,
      includeChapters: true,
      maxChapterCount: 1000,
      skipCovers: true,
    });
  });

  it('takes ID3v2 chapter starts as seconds and names an untitled one after its element ID, as ffprobe does', async () => {
    makeParsed({
      duration: 180,
      chapters: [
        { id: 'ch0', title: 'Opening', start: 0 },
        { id: 'ch1', title: '', start: 61.5 },
        { id: 'ch2', start: 125.25 },
      ],
    });

    const result = await probeAudioFile('/books/Book/part-01.mp3', 'builtin');

    expect(result?.chapters).toEqual([
      { title: 'Opening', startMs: 0 },
      { title: 'ch1', startMs: 61_500 },
      { title: 'ch2', startMs: 125_250 },
    ]);
  });

  it('keeps an untitled MP4 chapter untitled, as ffprobe does', async () => {
    makeParsed({ duration: 180, chapters: [{ title: '', timeScale: 1000, start: 0 }] });

    expect((await probeAudioFile('/books/Book/book.m4b', 'builtin'))?.chapters).toEqual([{ title: '', startMs: 0 }]);
  });

  it('prefers the container length, which is what ffprobe reports for MP4', async () => {
    makeParsed({ duration: 180.023, containerDuration: 180 });

    expect(await probeAudioFile('/books/Book/book.m4b', 'builtin')).toMatchObject({ durationSeconds: 180, durationMs: 180_000 });
  });

  it('asks for the end-of-file read only for Ogg, whose length is in its last page', async () => {
    makeParsed({ duration: 228.107 });

    await probeAudioFile('/books/Book/part.opus', 'builtin');
    await probeAudioFile('/books/Book/part.OGG', 'builtin');
    await probeAudioFile('/books/Book/part.flac', 'builtin');

    expect(mockParseFile.mock.calls.map(([, options]) => (options as { duration: boolean }).duration)).toEqual([true, true, false]);
  });

  it('falls back to ffprobe when the parser states no length', async () => {
    makeParsed({ duration: undefined, chapters: [{ title: 'Ignored', start: 0 }] });
    makeExecFileSuccess(JSON.stringify({ format: { duration: '142.958' }, chapters: [] }));

    const result = await probeAudioFile('/books/Book/part.ogg', 'builtin');

    expect(result).toEqual({ durationSeconds: 143, durationMs: 142_958, chapters: [] });
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('falls back to ffprobe when the parser cannot read the file', async () => {
    mockParseFile.mockRejectedValue(new Error('Unexpected end of stream'));
    makeExecFileSuccess(JSON.stringify({ format: { duration: '60' }, chapters: [] }));

    expect(await probeAudioFile('/books/Book/odd.m4a', 'builtin')).toMatchObject({ durationSeconds: 60 });
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a chapter starts before the one ahead of it',
      [
        { title: 'B', start: 20 },
        { title: 'A', start: 10 },
      ],
    ],
    [
      'a chapter starts past the end of the file',
      [
        { title: 'A', start: 0 },
        { title: 'B', start: 102 },
      ],
    ],
    ['a chapter start is not a number', [{ title: 'A', start: Number.NaN }]],
    ['a chapter starts before zero', [{ title: 'A', start: -1 }]],
  ])('hands the file to ffprobe when %s', async (_case, chapters) => {
    makeParsed({ duration: 100, chapters });
    makeExecFileSuccess(JSON.stringify({ format: { duration: '100' }, chapters: [{ start_time: '0.000000', tags: { title: 'From ffprobe' } }] }));

    expect((await probeAudioFile('/books/Book/part.mp3', 'builtin'))?.chapters).toEqual([{ title: 'From ffprobe', startMs: 0 }]);
  });

  it('hands the file to ffprobe when the parser hits its chapter cap, which drops the rest', async () => {
    makeParsed({ duration: 100_000, chapters: Array.from({ length: 1000 }, (_, index) => ({ title: `C${index}`, timeScale: 1, start: index })) });
    makeExecFileSuccess(JSON.stringify({ format: { duration: '100000' }, chapters: [] }));

    await probeAudioFile('/books/Book/huge.m4b', 'builtin');

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('hands the file to ffprobe when the length is implausibly long', async () => {
    makeParsed({ duration: 8 * 24 * 60 * 60 });
    makeExecFileSuccess(JSON.stringify({ format: { duration: '3600' }, chapters: [] }));

    expect(await probeAudioFile('/books/Book/part.mp3', 'builtin')).toMatchObject({ durationSeconds: 3600 });
  });

  it('hands the file to ffprobe when the parser has not answered within 30 seconds', async () => {
    vi.useFakeTimers();
    try {
      mockParseFile.mockReturnValue(new Promise(() => undefined));
      makeExecFileSuccess(JSON.stringify({ format: { duration: '60' }, chapters: [] }));

      const pending = probeAudioFile('/books/Book/stuck.mp3', 'builtin');
      await vi.advanceTimersByTimeAsync(30_000);

      expect(await pending).toMatchObject({ durationSeconds: 60 });
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads with ffprobe alone unless the built-in reader is asked for', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '60' }, chapters: [] }));

    await probeAudioFile('/books/Book/part.mp3');

    expect(mockParseFile).not.toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});

// ── probeAudioChapters ────────────────────────────────────────────────────────

describe('probeAudioChapters', () => {
  beforeEach(() => resetMocks());

  it('returns the embedded chapters and the file length in milliseconds', async () => {
    makeExecFileSuccess(
      JSON.stringify({
        format: { duration: '360.5' },
        chapters: [
          { start_time: '0.000000', tags: { title: 'Chapter 1' } },
          { start_time: '120.000000', tags: { title: 'Chapter 2' } },
        ],
      }),
    );

    const result = await probeAudioChapters('/books/Book/01.m4b');

    expect(result).toEqual({
      chapters: [
        { title: 'Chapter 1', startMs: 0 },
        { title: 'Chapter 2', startMs: 120_000 },
      ],
      durationMs: 360_500,
    });
  });

  it('keeps sub-second precision that the per-file duration rounds away', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '119.994000' }, chapters: [] }));

    const result = await probeAudioChapters('/books/Book/01.m4b');

    expect(result.durationMs).toBe(119_994);
  });

  it('returns an empty chapter list for a file with no embedded chapters', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '60' }, chapters: [] }));

    const result = await probeAudioChapters('/books/Book/02.mp3');

    expect(result).toEqual({ chapters: [], durationMs: 60_000 });
  });

  it('reports an unknown length rather than guessing when duration is missing', async () => {
    makeExecFileSuccess(JSON.stringify({ format: {}, chapters: [{ start_time: '0.000000', tags: { title: 'Only' } }] }));

    const result = await probeAudioChapters('/books/Book/03.m4b');

    expect(result).toEqual({ chapters: [{ title: 'Only', startMs: 0 }], durationMs: null });
  });

  it('titles a chapter with an empty string when the file does not name it', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '10' }, chapters: [{ start_time: '0.000000' }] }));

    const result = await probeAudioChapters('/books/Book/04.m4b');

    expect(result.chapters).toEqual([{ title: '', startMs: 0 }]);
  });

  it('drops a chapter whose start time is not numeric', async () => {
    makeExecFileSuccess(
      JSON.stringify({
        format: { duration: '10' },
        chapters: [
          { start_time: 'N/A', tags: { title: 'Broken' } },
          { start_time: '5.000000', tags: { title: 'Fine' } },
        ],
      }),
    );

    const result = await probeAudioChapters('/books/Book/05.m4b');

    expect(result.chapters).toEqual([{ title: 'Fine', startMs: 5_000 }]);
  });

  it('returns empty results when ffprobe throws', async () => {
    makeExecFileError('read error');

    const result = await probeAudioChapters('/books/Book/missing.m4b');

    expect(result).toEqual({ chapters: [], durationMs: null });
  });

  it('asks ffprobe for chapters and format only, and never extracts a cover', async () => {
    makeExecFileSuccess(JSON.stringify({ format: { duration: '10' }, chapters: [] }));

    await probeAudioChapters('/books/Book/01.m4b');

    expect(mockExecFile).toHaveBeenCalledWith(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_chapters', '/books/Book/01.m4b'],
      expect.objectContaining({ maxBuffer: expect.any(Number) }),
      expect.any(Function),
    );
    expect(mockSpawn).not.toHaveBeenCalled();
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
    (execFileMock as unknown as Mock).mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, r: { stdout: string }) => void;
      cb(null, { stdout: JSON.stringify({ format: { duration: '100', tags: {} }, streams: [], chapters: [] }) });
    });
    (spawnMock as unknown as Mock).mockReturnValue(makeSpawnProcess(null));

    const { extractAudioMetadata: extract } = await import('./audio.extractor');
    await extract('/path/test.m4b');

    expect(execFileMock).toHaveBeenCalledWith('/opt/bin/ffprobe', expect.any(Array), expect.any(Object), expect.any(Function));
  });

  it('uses FFMPEG_PATH env var when set', async () => {
    vi.stubEnv('FFMPEG_PATH', '/opt/bin/ffmpeg');
    vi.resetModules();

    const { execFile: execFileMock, spawn: spawnMock } = await import('child_process');
    (execFileMock as unknown as Mock).mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, r: { stdout: string }) => void;
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
    (execFileMock as unknown as Mock).mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, r: { stdout: string }) => void;
      cb(null, { stdout: JSON.stringify({ format: { duration: '100', tags: {} }, streams: [], chapters: [] }) });
    });
    (spawnMock as unknown as Mock).mockReturnValue(makeSpawnProcess(null));

    const { extractAudioMetadata: extract } = await import('./audio.extractor');
    await extract('/path/test.m4b');

    expect(execFileMock).toHaveBeenCalledWith('ffprobe', expect.any(Array), expect.any(Object), expect.any(Function));
  });
});
