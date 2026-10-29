// @vitest-environment node
import { AUDIOBOOK_CHAPTER_LIMITS, type AudiobookChapter } from '@bookorbit/types'
import { describe, expect, it } from 'vitest'
import {
  CHAPTER_IMPORT_MAX_BYTES,
  chapterExportFilename,
  detectChapterFormat,
  parseChapters,
  serializeChapters,
  type ChapterExportFormat,
  type ChapterFormat,
} from '../chapter-io'

const BOM = String.fromCharCode(0xfeff)
const NUL = String.fromCharCode(0)
const EN_DASH = String.fromCharCode(0x2013)
const EM_DASH = String.fromCharCode(0x2014)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e)

const lines = (...rows: string[]) => rows.join('\n')

function chaptersOf(text: string, format?: ChapterFormat): AudiobookChapter[] | undefined {
  return parseChapters(text, format)?.chapters
}

const CUE_SAMPLE = lines(
  'REM GENRE Audiobook',
  'PERFORMER "Narrator"',
  'TITLE "The Book"',
  'FILE "book.m4b" MP4',
  '  TRACK 01 AUDIO',
  '    TITLE "Opening Credits"',
  '    PERFORMER "Narrator"',
  '    INDEX 01 00:00:00',
  '  TRACK 02 AUDIO',
  '    TITLE "Chapter 1"',
  '    INDEX 00 00:30:00',
  '    INDEX 01 00:31:37',
  '  TRACK 03 AUDIO',
  '    TITLE "Chapter 2"',
  '    INDEX 01 125:30:74',
)

const FFMETADATA_SAMPLE = lines(
  ';FFMETADATA1',
  'title=The Book',
  'artist=Someone',
  '',
  '[CHAPTER]',
  'TIMEBASE=1/1000',
  'START=0',
  'END=60000',
  'title=Opening',
  '',
  '[CHAPTER]',
  'TIMEBASE=1/1000',
  'START=60000',
  'END=120500',
  'title=Chapter 1',
)

const AUDACITY_SAMPLE = lines('0.000000\t312.500000\tOpening', '312.500000\t900.000000\tChapter 1')
const TIMESTAMPS_SAMPLE = lines('00:00:00.000 Opening', '00:05:12.500 Chapter 1', '01:02:03.456 Chapter 2')
const TITLES_SAMPLE = lines('Opening', '', 'Chapter 1', 'Chapter 2')
const JSON_SAMPLE = '[{"title":"Opening","startMs":0},{"title":"Chapter 1","startMs":312500}]'

describe('detectChapterFormat', () => {
  it.each<{ label: string; text: string; expected: ChapterFormat | null }>([
    { label: 'a startMs JSON array', text: JSON_SAMPLE, expected: 'json' },
    { label: 'an Audiobookshelf metadata.json', text: '{"title":"Book","chapters":[{"id":0,"start":0,"end":5,"title":"Intro"}]}', expected: 'json' },
    { label: 'JSON behind a byte order mark', text: `${BOM}${JSON_SAMPLE}`, expected: 'json' },
    { label: 'ffmetadata with its header', text: FFMETADATA_SAMPLE, expected: 'ffmetadata' },
    { label: 'ffmetadata without its header', text: lines('[CHAPTER]', 'TIMEBASE=1/1000', 'START=0', 'title=Intro'), expected: 'ffmetadata' },
    { label: 'a cue sheet', text: CUE_SAMPLE, expected: 'cue' },
    { label: 'Audacity labels', text: AUDACITY_SAMPLE, expected: 'audacity' },
    {
      label: 'Audacity labels with spectral lines',
      text: lines('0.0\t5.0\tIntro', '\\\t100.0\t2000.0', '5.0\t9.0\tOne', '\\\t100.0\t2000.0'),
      expected: 'audacity',
    },
    { label: 'timestamped lines', text: TIMESTAMPS_SAMPLE, expected: 'timestamps' },
    { label: 'a YouTube chapter list under a heading', text: lines('Chapters:', '0:00 Intro', '5:32 One'), expected: 'timestamps' },
    { label: 'bracketed clocks, which are not JSON', text: lines('[00:00] Intro', '[05:00] One'), expected: 'timestamps' },
    { label: 'titles before their clocks', text: lines('Intro 0:00', 'One - 5:32'), expected: 'timestamps' },
    { label: 'OGM chapter pairs', text: lines('CHAPTER01=00:00:00.000', 'CHAPTER01NAME=Intro'), expected: 'timestamps' },
    { label: 'clock-free lines', text: TITLES_SAMPLE, expected: 'titles' },
    { label: 'mostly prose with one clock', text: lines('Intro', 'Part one', '5:00 Two'), expected: 'titles' },
    { label: 'empty input', text: '', expected: null },
    { label: 'blank input', text: ' \n\t\n ', expected: null },
    { label: 'binary input', text: `ID3${NUL}${NUL}garbage`, expected: null },
    { label: 'a JSON object that does not parse', text: '{"chapters": [', expected: null },
    { label: 'a JSON array that does not parse', text: '[{"title": "Intro"', expected: null },
  ])('reads $label', ({ text, expected }) => {
    expect(detectChapterFormat(text)).toBe(expected)
  })

  it('refuses input over the import limit, counted in UTF-8 bytes', () => {
    expect(detectChapterFormat('a'.repeat(CHAPTER_IMPORT_MAX_BYTES + 1))).toBeNull()
    expect(detectChapterFormat('\u00e9'.repeat(CHAPTER_IMPORT_MAX_BYTES / 2 + 1))).toBeNull()
    expect(detectChapterFormat('\u00e9'.repeat(CHAPTER_IMPORT_MAX_BYTES / 2))).toBe('titles')
  })
})

describe('parseChapters: CUE', () => {
  it('reads tracks, prefers INDEX 01 over the pregap and ignores REM and PERFORMER', () => {
    expect(parseChapters(CUE_SAMPLE)).toEqual({
      format: 'cue',
      chapters: [
        { title: 'Opening Credits', startMs: 0 },
        { title: 'Chapter 1', startMs: 31_493 },
        { title: 'Chapter 2', startMs: 7_530_987 },
      ],
      titlesOnly: false,
      skippedLines: [],
      truncated: false,
    })
  })

  it.each([
    { index: '00:00:01', startMs: 13 },
    { index: '00:00:02', startMs: 27 },
    { index: '00:00:74', startMs: 987 },
    { index: '01:00:00', startMs: 60_000 },
    { index: '99:59:74', startMs: 5_999_987 },
    { index: '600:00:00', startMs: 36_000_000 },
  ])('converts INDEX $index at 75 frames per second', ({ index, startMs }) => {
    expect(chaptersOf(lines('FILE "a" MP4', 'TRACK 01 AUDIO', `INDEX 01 ${index}`), 'cue')).toEqual([{ title: '', startMs }])
  })

  it('falls back to INDEX 00 when a track has no INDEX 01', () => {
    expect(chaptersOf(lines('TRACK 01 AUDIO', 'TITLE "Pregap only"', 'INDEX 00 00:02:00'), 'cue')).toEqual([{ title: 'Pregap only', startMs: 2000 }])
  })

  it('unescapes quoted titles and keeps unquoted ones', () => {
    const cue = lines(
      'TRACK 01 AUDIO',
      'TITLE "Say \\"Hi\\""',
      'INDEX 01 00:00:00',
      'TRACK 02 AUDIO',
      'title   Unquoted title  ',
      'INDEX 01 00:01:00',
    )
    expect(chaptersOf(cue)).toEqual([
      { title: 'Say "Hi"', startMs: 0 },
      { title: 'Unquoted title', startMs: 1000 },
    ])
  })

  it('sorts tracks of a single-file sheet by time', () => {
    const cue = lines(
      'FILE "a" MP4',
      'TRACK 01 AUDIO',
      'TITLE "Later"',
      'INDEX 01 10:00:00',
      'TRACK 02 AUDIO',
      'TITLE "Earlier"',
      'INDEX 01 00:00:00',
    )
    expect(chaptersOf(cue)).toEqual([
      { title: 'Earlier', startMs: 0 },
      { title: 'Later', startMs: 600_000 },
    ])
  })

  it('reports tracks without an index, malformed indexes and unknown lines', () => {
    const cue = lines(
      'FILE "a" MP4',
      'TRACK 01 AUDIO',
      'INDEX 01 00:00:00',
      'TRACK 02 AUDIO',
      'TITLE "No index"',
      'TRACK 03 AUDIO',
      'INDEX 01 00:10:75',
      'TRACK 04 AUDIO',
      'INDEX 01 00:60:00',
      'this is not a cue command',
      'TRACK 05 AUDIO',
      'INDEX 01 01:00:00',
    )
    const result = parseChapters(cue)
    expect(result?.chapters.map((chapter) => chapter.startMs)).toEqual([0, 60_000])
    expect(result?.skippedLines).toEqual([4, 6, 7, 8, 9, 10])
  })

  it('refuses a multi-file sheet whose times restart in each file', () => {
    const cue = lines(
      'FILE "part1.mp3" MP3',
      'TRACK 01 AUDIO',
      'INDEX 01 00:00:00',
      'TRACK 02 AUDIO',
      'INDEX 01 10:00:00',
      'FILE "part2.mp3" MP3',
      'TRACK 03 AUDIO',
      'INDEX 01 00:00:00',
    )
    expect(parseChapters(cue)).toBeNull()
  })

  it('accepts a multi-file sheet whose times already run on one timeline', () => {
    const cue = lines(
      'FILE "part1.mp3" MP3',
      'TRACK 01 AUDIO',
      'INDEX 01 00:00:00',
      'TRACK 02 AUDIO',
      'INDEX 01 10:00:00',
      'FILE "part2.mp3" MP3',
      'TRACK 03 AUDIO',
      'INDEX 01 20:00:00',
    )
    expect(chaptersOf(cue)?.map((chapter) => chapter.startMs)).toEqual([0, 600_000, 1_200_000])
  })

  it('returns null for a sheet without tracks', () => {
    expect(parseChapters(lines('REM nothing here', 'FILE "a" MP4'), 'cue')).toBeNull()
  })
})

describe('parseChapters: ffmetadata', () => {
  it('reads chapters and ignores the global metadata', () => {
    expect(parseChapters(FFMETADATA_SAMPLE)).toEqual({
      format: 'ffmetadata',
      chapters: [
        { title: 'Opening', startMs: 0 },
        { title: 'Chapter 1', startMs: 60_000 },
      ],
      titlesOnly: false,
      skippedLines: [],
      truncated: false,
    })
  })

  it.each([
    { timebase: 'TIMEBASE=1/1', start: '90', startMs: 90_000 },
    { timebase: 'TIMEBASE=1/44100', start: '44100', startMs: 1000 },
    { timebase: 'TIMEBASE=1/44100', start: '100', startMs: 2 },
    { timebase: 'TIMEBASE=1/1000000', start: '1234567', startMs: 1235 },
    { timebase: 'TIMEBASE = 1/1000 ', start: ' 2500 ', startMs: 2500 },
    { timebase: '', start: '1500000000', startMs: 1500 },
  ])('scales START=$start by "$timebase"', ({ timebase, start, startMs }) => {
    const text = lines('[CHAPTER]', ...(timebase ? [timebase] : []), `START=${start}`, 'title=Chapter')
    expect(chaptersOf(text, 'ffmetadata')).toEqual([{ title: 'Chapter', startMs }])
  })

  it('unescapes =, ;, #, and backslash', () => {
    const text = lines('[CHAPTER]', 'TIMEBASE=1/1000', 'START=0', 'title=A\\=B\\;C\\#D\\\\E')
    expect(chaptersOf(text)).toEqual([{ title: 'A=B;C#D\\E', startMs: 0 }])
  })

  it('follows an escaped newline and keeps counting physical lines', () => {
    const text = lines(
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      'START=0',
      'title=Line one\\',
      'Line two',
      'not a key value line',
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      'START=1000',
      'title=Next',
    )
    expect(parseChapters(text)).toMatchObject({
      chapters: [
        { title: 'Line one Line two', startMs: 0 },
        { title: 'Next', startMs: 1000 },
      ],
      skippedLines: [6],
    })
  })

  it('skips comments and stream sections, and reads keys in any case', () => {
    const text = lines(
      ';FFMETADATA1',
      '# a comment with = in it',
      'title=Book',
      '[STREAM]',
      'title=Stream title',
      '[CHAPTER]',
      'timebase=1/1000',
      'start=500',
      'TITLE=Only',
    )
    expect(parseChapters(text)).toMatchObject({ chapters: [{ title: 'Only', startMs: 500 }], skippedLines: [] })
  })

  it('reports chapters with a missing or unreadable START or TIMEBASE', () => {
    const text = lines(
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      'title=No start',
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      'START=soon',
      'title=Bad start',
      '[CHAPTER]',
      'TIMEBASE=0/1000',
      'START=1000',
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      'START=2000',
      'title=Good',
    )
    expect(parseChapters(text)).toMatchObject({ chapters: [{ title: 'Good', startMs: 2000 }], skippedLines: [1, 6, 9] })
  })

  it('returns null when no chapter has a start', () => {
    expect(parseChapters(lines(';FFMETADATA1', 'title=Book'), 'ffmetadata')).toBeNull()
  })
})

describe('parseChapters: Audacity labels', () => {
  it('reads tab-separated seconds', () => {
    expect(parseChapters(AUDACITY_SAMPLE)).toEqual({
      format: 'audacity',
      chapters: [
        { title: 'Opening', startMs: 0 },
        { title: 'Chapter 1', startMs: 312_500 },
      ],
      titlesOnly: false,
      skippedLines: [],
      truncated: false,
    })
  })

  it('reads comma decimals, point labels and missing labels', () => {
    expect(chaptersOf(lines('0,000000\t0,000000\tIntro', '1,500000\t3,000000', '2.0004\t2.0004\tRounded'), 'audacity')).toEqual([
      { title: 'Intro', startMs: 0 },
      { title: '', startMs: 1500 },
      { title: 'Rounded', startMs: 2000 },
    ])
  })

  it('ignores spectral lines and reports unreadable ones', () => {
    const result = parseChapters(lines('0.0\t5.0\tIntro', '\\\t100.0\t2000.0', 'garbage', '5.0\t9.0\tOne'), 'audacity')
    expect(result).toMatchObject({ chapters: [{ title: 'Intro' }, { title: 'One', startMs: 5000 }], skippedLines: [3] })
  })
})

describe('parseChapters: timestamped lines', () => {
  it.each([
    { line: '00:00:00.000 Title', startMs: 0, title: 'Title' },
    { line: '0:05 Title', startMs: 5000, title: 'Title' },
    { line: '1:02:03 - Title', startMs: 3_723_000, title: 'Title' },
    { line: '1:02:03 | Title', startMs: 3_723_000, title: 'Title' },
    { line: '1:02:03: Title', startMs: 3_723_000, title: 'Title' },
    { line: `1:02:03 ${EN_DASH} Title`, startMs: 3_723_000, title: 'Title' },
    { line: `1:02:03 ${EM_DASH} Title`, startMs: 3_723_000, title: 'Title' },
    { line: '[01:02:03] Title', startMs: 3_723_000, title: 'Title' },
    { line: '(01:02:03) Title', startMs: 3_723_000, title: 'Title' },
    { line: '[00:05]Title', startMs: 5000, title: 'Title' },
    { line: '01:02:03,500 Title', startMs: 3_723_500, title: 'Title' },
    { line: '01:02:03.5 Title', startMs: 3_723_500, title: 'Title' },
    { line: '01:02:03.123456 Title', startMs: 3_723_123, title: 'Title' },
    { line: '01:02:03.1239 Title', startMs: 3_723_124, title: 'Title' },
    { line: '00:01,5 Title', startMs: 1500, title: 'Title' },
    { line: '75:30 Title', startMs: 4_530_000, title: 'Title' },
    { line: '100:00:00 Title', startMs: 360_000_000, title: 'Title' },
    { line: 'Title 1:02:03', startMs: 3_723_000, title: 'Title' },
    { line: 'Title - 1:02:03', startMs: 3_723_000, title: 'Title' },
    { line: 'Title (1:02:03)', startMs: 3_723_000, title: 'Title' },
    { line: 'Title [1:02:03]', startMs: 3_723_000, title: 'Title' },
    { line: 'Chapter 12 1:02:03', startMs: 3_723_000, title: 'Chapter 12' },
    { line: '0:00 Part 1: 10:15 Train', startMs: 0, title: 'Part 1: 10:15 Train' },
    { line: '0:00', startMs: 0, title: '' },
  ])('reads "$line"', ({ line, startMs, title }) => {
    expect(chaptersOf(line, 'timestamps')).toEqual([{ title, startMs }])
  })

  it.each(['0:75 Title', '1:60:00 Title', '0:00Title', 'Chapter one', '1.02.03 Title'])('skips "%s"', (line) => {
    expect(parseChapters(lines('0:00 Intro', line), 'timestamps')?.skippedLines).toEqual([2])
  })

  it('reads a pasted YouTube description and reports its heading', () => {
    const text = lines('Chapters:', '0:00 Intro', '5:32 The Long Road', '1:02:03 - Finale')
    expect(parseChapters(text)).toEqual({
      format: 'timestamps',
      chapters: [
        { title: 'Intro', startMs: 0 },
        { title: 'The Long Road', startMs: 332_000 },
        { title: 'Finale', startMs: 3_723_000 },
      ],
      titlesOnly: false,
      skippedLines: [1],
      truncated: false,
    })
  })

  it('sorts unsorted lines and keeps the first of duplicate starts', () => {
    expect(chaptersOf(lines('0:10 Second', '0:00 First', '0:10 Duplicate', '0:05 Middle'))).toEqual([
      { title: 'First', startMs: 0 },
      { title: 'Middle', startMs: 5000 },
      { title: 'Second', startMs: 10_000 },
    ])
  })

  it('reads OGM chapter pairs and reports a name without its time', () => {
    const text = lines('CHAPTER01=00:00:00.000', 'CHAPTER01NAME=Intro', 'CHAPTER02=00:10:00.500', 'CHAPTER02NAME=Chapter 1', 'CHAPTER03NAME=Orphan')
    expect(parseChapters(text)).toMatchObject({
      format: 'timestamps',
      chapters: [
        { title: 'Intro', startMs: 0 },
        { title: 'Chapter 1', startMs: 600_500 },
      ],
      skippedLines: [5],
    })
  })
})

describe('parseChapters: titles only', () => {
  it('reads one title per non-blank line with placeholder starts', () => {
    expect(parseChapters(TITLES_SAMPLE)).toEqual({
      format: 'titles',
      chapters: [
        { title: 'Opening', startMs: 0 },
        { title: 'Chapter 1', startMs: 0 },
        { title: 'Chapter 2', startMs: 0 },
      ],
      titlesOnly: true,
      skippedLines: [],
      truncated: false,
    })
  })

  it('keeps whole lines, clocks included, when asked for titles', () => {
    expect(chaptersOf(lines('  0:00 Intro  ', '5:00 One'), 'titles')).toEqual([
      { title: '0:00 Intro', startMs: 0 },
      { title: '5:00 One', startMs: 0 },
    ])
  })

  it('skips lines too long to be a title', () => {
    expect(parseChapters(lines('Intro', 'x'.repeat(5000), 'One'), 'titles')).toMatchObject({
      chapters: [{ title: 'Intro' }, { title: 'One' }],
      skippedLines: [2],
    })
  })
})

describe('parseChapters: JSON', () => {
  it('reads a startMs array, trimming titles and rounding starts', () => {
    expect(parseChapters('[{"title":" Intro ","startMs":0},{"title":"One","startMs":1500.4}]')).toEqual({
      format: 'json',
      chapters: [
        { title: 'Intro', startMs: 0 },
        { title: 'One', startMs: 1500 },
      ],
      titlesOnly: false,
      skippedLines: [],
      truncated: false,
    })
  })

  it('reads Audiobookshelf chapter objects in seconds', () => {
    const text = '[{"id":0,"start":0,"end":12.5,"title":"Intro"},{"id":1,"start":12.3456,"end":30,"title":"One"}]'
    expect(chaptersOf(text)).toEqual([
      { title: 'Intro', startMs: 0 },
      { title: 'One', startMs: 12_346 },
    ])
  })

  it('reads the chapters of an Audiobookshelf metadata.json', () => {
    const text = JSON.stringify({ tags: [], title: 'Book', authors: ['A'], chapters: [{ id: 0, start: 0, end: 10, title: 'Intro' }] })
    expect(chaptersOf(text)).toEqual([{ title: 'Intro', startMs: 0 }])
  })

  it('reads ffprobe chapters by start_time, or by start in time_base ticks', () => {
    const text = JSON.stringify({
      chapters: [
        { id: 0, time_base: '1/1000', start: 0, start_time: '0.000000', end: 10_000, end_time: '10.000000', tags: { title: 'Intro' } },
        { id: 1, time_base: '1/44100', start: 441_000, end: 882_000, tags: { title: 'Ten' } },
      ],
    })
    expect(chaptersOf(text)).toEqual([
      { title: 'Intro', startMs: 0 },
      { title: 'Ten', startMs: 10_000 },
    ])
  })

  it('prefers startMs over start', () => {
    expect(chaptersOf('[{"title":"x","startMs":1000,"start":5}]')).toEqual([{ title: 'x', startMs: 1000 }])
  })

  it('reports unusable entries by their position in the array', () => {
    const text = '[{"title":"No start"},{"title":"Ok","startMs":0},null,"text",{"startMs":-5},{"start":"12.5"},{"startMs":1e300}]'
    expect(parseChapters(text)).toMatchObject({
      chapters: [
        { title: 'Ok', startMs: 0 },
        { title: '', startMs: 12_500 },
      ],
      skippedLines: [1, 3, 4, 5, 7],
    })
  })

  it.each(['{"title":"Book"}', '[]', '[1,2,3]', '{"chapters":"nope"}', '[{"title":"no start"}]', '"just a string"'])(
    'returns null for %s',
    (text) => {
      expect(parseChapters(text, 'json')).toBeNull()
    },
  )
})

describe('parseChapters: shared rules', () => {
  const samples: { format: ChapterFormat; text: string }[] = [
    { format: 'cue', text: CUE_SAMPLE },
    { format: 'ffmetadata', text: FFMETADATA_SAMPLE },
    { format: 'audacity', text: AUDACITY_SAMPLE },
    { format: 'timestamps', text: TIMESTAMPS_SAMPLE },
    { format: 'titles', text: TITLES_SAMPLE },
    { format: 'json', text: JSON_SAMPLE },
  ]

  it.each(samples)('reads $format the same with CRLF, CR and a byte order mark', ({ format, text }) => {
    const expected = parseChapters(text)
    expect(expected?.format).toBe(format)
    expect(parseChapters(`${BOM}${text.replace(/\n/g, '\r\n')}`)).toEqual(expected)
    expect(parseChapters(text.replace(/\n/g, '\r'))).toEqual(expected)
  })

  it.each<{ format: ChapterFormat; text: string }>([
    { format: 'cue', text: 'complete nonsense\n%%%' },
    { format: 'ffmetadata', text: 'complete nonsense\n%%%' },
    { format: 'audacity', text: 'complete nonsense\n%%%' },
    { format: 'timestamps', text: 'complete nonsense\n%%%' },
    { format: 'json', text: 'complete nonsense\n%%%' },
    { format: 'titles', text: '\n  \n' },
  ])('returns null for garbage read as $format', ({ format, text }) => {
    expect(parseChapters(text, format)).toBeNull()
  })

  it('returns null for oversized or binary input', () => {
    expect(parseChapters(`0:00 Intro\n${'x'.repeat(CHAPTER_IMPORT_MAX_BYTES)}`)).toBeNull()
    expect(parseChapters(`0:00 Intro${NUL}`, 'timestamps')).toBeNull()
  })

  const malformed = [
    '\\',
    '[CHAPTER]\nSTART=\\',
    '[CHAPTER]\nSTART=1e400\ntitle=x',
    '{"chapters":null}',
    '[null, 1, "x", {}, []]',
    '[{"startMs": 1e400}]',
    '[{"start": "NaN"}]',
    'TRACK',
    'INDEX 01 00:00:00',
    'TRACK 01 AUDIO\nINDEX 01 99999999999999999999:00:00',
    '\t\t\t',
    '99999999999:00 Title',
    `${'1:'.repeat(3000)}00 Title`,
    `${'['.repeat(5000)}`,
    String.fromCharCode(0xd800),
  ]
  const formats: (ChapterFormat | undefined)[] = [undefined, 'cue', 'ffmetadata', 'audacity', 'timestamps', 'titles', 'json']

  it.each(formats)('never throws on malformed input read as %s', (format) => {
    for (const text of malformed) expect(() => parseChapters(text, format)).not.toThrow()
  })

  it('trims titles, flattens line breaks and caps them at the title limit', () => {
    const long = 'y'.repeat(AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength + 100)
    const surrogate = `${'a'.repeat(AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength - 1)}\u{1F600}`
    const text = JSON.stringify([
      { title: '  Spaced  ', startMs: 0 },
      { title: 'Line\nBreak\tTab', startMs: 1 },
      { title: long, startMs: 2 },
      { title: surrogate, startMs: 3 },
    ])
    expect(chaptersOf(text)?.map((chapter) => chapter.title)).toEqual([
      'Spaced',
      'Line Break Tab',
      'y'.repeat(AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength),
      'a'.repeat(AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength - 1),
    ])
  })

  it('keeps the first chapter of starts that round to the same millisecond', () => {
    expect(chaptersOf('[{"title":"A","startMs":1000.4},{"title":"B","startMs":1000.2},{"title":"C","startMs":0}]')).toEqual([
      { title: 'C', startMs: 0 },
      { title: 'A', startMs: 1000 },
    ])
  })

  const clockLine = (second: number) => `${Math.floor(second / 60)}:${String(second % 60).padStart(2, '0')} Chapter ${second}`

  it('keeps the earliest chapters up to the limit and flags the rest', () => {
    const max = AUDIOBOOK_CHAPTER_LIMITS.maxChapters
    const text = Array.from({ length: max + 5 }, (_, second) => clockLine(second))
      .reverse()
      .join('\n')
    const result = parseChapters(text)
    expect(result?.chapters).toHaveLength(max)
    expect(result?.truncated).toBe(true)
    expect(result?.chapters[0]?.title).toBe('Chapter 0')
    expect(result?.chapters[max - 1]?.title).toBe(`Chapter ${max - 1}`)
  })

  it('does not flag a list exactly at the limit', () => {
    const max = AUDIOBOOK_CHAPTER_LIMITS.maxChapters
    const result = parseChapters(Array.from({ length: max }, (_, second) => clockLine(second)).join('\n'))
    expect(result?.chapters).toHaveLength(max)
    expect(result?.truncated).toBe(false)
  })

  it('caps a titles-only list at the limit in input order', () => {
    const max = AUDIOBOOK_CHAPTER_LIMITS.maxChapters
    const result = parseChapters(Array.from({ length: max + 1 }, (_, index) => `Title ${index}`).join('\n'), 'titles')
    expect(result?.chapters).toHaveLength(max)
    expect(result?.truncated).toBe(true)
    expect(result?.chapters[max - 1]?.title).toBe(`Title ${max - 1}`)
  })
})

const EXPORT_CHAPTERS: AudiobookChapter[] = [
  { title: 'Opening Credits', startMs: 0 },
  { title: 'Chapter 1: "Hello"', startMs: 31_493 },
  { title: 'A=B; C#D \\ E', startMs: 3_723_456 },
  { title: '\u4e09\u4f53', startMs: 7_530_987 },
]

describe('serializeChapters', () => {
  it('writes a single-file cue sheet in frames', () => {
    expect(serializeChapters(EXPORT_CHAPTERS, 'cue', { title: 'The "Book"' })).toBe(
      lines(
        'TITLE "The \\"Book\\""',
        'FILE "The \\"Book\\"" MP4',
        '  TRACK 01 AUDIO',
        '    TITLE "Opening Credits"',
        '    INDEX 01 00:00:00',
        '  TRACK 02 AUDIO',
        '    TITLE "Chapter 1: \\"Hello\\""',
        '    INDEX 01 00:31:37',
        '  TRACK 03 AUDIO',
        '    TITLE "A=B; C#D \\ E"',
        '    INDEX 01 62:03:34',
        '  TRACK 04 AUDIO',
        '    TITLE "\u4e09\u4f53"',
        '    INDEX 01 125:30:74',
        '',
      ),
    )
  })

  it('names the cue file "audiobook" when no title is given', () => {
    expect(serializeChapters([{ title: 'Intro', startMs: 0 }], 'cue')).toBe(
      lines('FILE "audiobook" MP4', '  TRACK 01 AUDIO', '    TITLE "Intro"', '    INDEX 01 00:00:00', ''),
    )
  })

  it('writes ffmetadata with escapes and ends at the next chapter or the book end', () => {
    expect(serializeChapters(EXPORT_CHAPTERS, 'ffmetadata', { title: 'The Book', totalDurationMs: 9_000_000 })).toBe(
      lines(
        ';FFMETADATA1',
        'title=The Book',
        '',
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        'START=0',
        'END=31493',
        'title=Opening Credits',
        '',
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        'START=31493',
        'END=3723456',
        'title=Chapter 1: "Hello"',
        '',
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        'START=3723456',
        'END=7530987',
        'title=A\\=B\\; C\\#D \\\\ E',
        '',
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        'START=7530987',
        'END=9000000',
        'title=\u4e09\u4f53',
        '',
      ),
    )
  })

  it('ends the last ffmetadata chapter at its start without a usable duration, and escapes newlines', () => {
    const chapters = [{ title: 'Line one\nLine two', startMs: 5000 }]
    for (const totalDurationMs of [undefined, null, 1000]) {
      expect(serializeChapters(chapters, 'ffmetadata', { totalDurationMs })).toBe(
        lines(';FFMETADATA1', '', '[CHAPTER]', 'TIMEBASE=1/1000', 'START=5000', 'END=5000', 'title=Line one\\', 'Line two', ''),
      )
    }
  })

  it('writes Audacity region labels in seconds', () => {
    expect(serializeChapters(EXPORT_CHAPTERS, 'audacity', { totalDurationMs: 9_000_000 })).toBe(
      lines(
        '0.000000\t31.493000\tOpening Credits',
        '31.493000\t3723.456000\tChapter 1: "Hello"',
        '3723.456000\t7530.987000\tA=B; C#D \\ E',
        '7530.987000\t9000.000000\t\u4e09\u4f53',
        '',
      ),
    )
  })

  it('writes timestamped lines', () => {
    expect(serializeChapters(EXPORT_CHAPTERS, 'timestamps')).toBe(
      lines('00:00:00.000 Opening Credits', '00:00:31.493 Chapter 1: "Hello"', '01:02:03.456 A=B; C#D \\ E', '02:05:30.987 \u4e09\u4f53', ''),
    )
  })

  it('writes pretty-printed JSON with a chapters array', () => {
    const json = serializeChapters(EXPORT_CHAPTERS, 'json')
    expect(JSON.parse(json)).toEqual({ chapters: EXPORT_CHAPTERS })
    expect(json.startsWith('{\n  "chapters": [\n    {\n      "title": "Opening Credits",\n      "startMs": 0\n    },')).toBe(true)
  })

  it.each<ChapterExportFormat>(['cue', 'audacity', 'timestamps'])('keeps each %s chapter on one line', (format) => {
    const text = serializeChapters([{ title: 'Tab\there\nand newline', startMs: 0 }], format)
    expect(text).toContain('Tab here and newline')
  })

  it('sorts its input and rounds fractional starts', () => {
    const text = serializeChapters(
      [
        { title: 'Later', startMs: 2000.6 },
        { title: 'Earlier', startMs: 0 },
      ],
      'timestamps',
    )
    expect(text).toBe(lines('00:00:00.000 Earlier', '00:00:02.001 Later', ''))
  })
})

describe('round trips', () => {
  const chapters: AudiobookChapter[] = [
    { title: 'Opening', startMs: 0 },
    { title: '', startMs: 999 },
    { title: 'Say "Hi"', startMs: 59_999 },
    { title: 'A=B; C#D \\ E\\', startMs: 3_599_999 },
    { title: 'Ten hours [and] a millisecond', startMs: 36_000_001 },
    { title: '\u4e09\u4f53 \u{1F600}', startMs: 359_999_999 },
  ]

  it.each<ChapterExportFormat>(['ffmetadata', 'audacity', 'timestamps', 'json'])('%s keeps every millisecond', (format) => {
    const text = serializeChapters(chapters, format, { title: 'Book', totalDurationMs: 400_000_000 })
    expect(detectChapterFormat(text)).toBe(format)
    expect(parseChapters(text)).toEqual({ format, chapters, titlesOnly: false, skippedLines: [], truncated: false })
  })

  it('cue keeps titles and lands within half a frame', () => {
    const parsed = parseChapters(serializeChapters(chapters, 'cue', { title: 'Book' }))
    expect(parsed?.format).toBe('cue')
    expect(parsed?.chapters.map((chapter) => chapter.title)).toEqual(chapters.map((chapter) => chapter.title))
    parsed?.chapters.forEach((chapter, index) => {
      expect(Math.abs(chapter.startMs - (chapters[index]?.startMs ?? 0))).toBeLessThanOrEqual(7)
    })
  })
})

describe('chapterExportFilename', () => {
  it.each<{ format: ChapterExportFormat; expected: string }>([
    { format: 'cue', expected: 'The Hobbit.cue' },
    { format: 'ffmetadata', expected: 'The Hobbit.ffmetadata.txt' },
    { format: 'audacity', expected: 'The Hobbit.labels.txt' },
    { format: 'timestamps', expected: 'The Hobbit.chapters.txt' },
    { format: 'json', expected: 'The Hobbit.chapters.json' },
  ])('names a $format export', ({ format, expected }) => {
    expect(chapterExportFilename('The Hobbit', format)).toBe(expected)
  })

  it.each<{ title: string | null; expected: string }>([
    { title: '../../etc/passwd', expected: 'etc passwd.cue' },
    { title: 'C:\\Windows\\System32', expected: 'C Windows System32.cue' },
    { title: 'Dune: Messiah', expected: 'Dune Messiah.cue' },
    { title: 'What? <Really> "Yes" | No*', expected: 'What Really Yes No.cue' },
    { title: 'Line\nBreak\tTab', expected: 'Line Break Tab.cue' },
    { title: `Evil${RIGHT_TO_LEFT_OVERRIDE}txt.exe`, expected: 'Evil txt.exe.cue' },
    { title: '...hidden', expected: 'hidden.cue' },
    { title: 'Trailing dots... ', expected: 'Trailing dots.cue' },
    { title: '\u4e09\u4f53', expected: '\u4e09\u4f53.cue' },
    { title: null, expected: 'chapters.cue' },
    { title: '', expected: 'chapters.cue' },
    { title: '   ', expected: 'chapters.cue' },
    { title: '///', expected: 'chapters.cue' },
    { title: 'CON', expected: 'chapters.cue' },
    { title: 'lpt1', expected: 'chapters.cue' },
  ])('sanitizes $title', ({ title, expected }) => {
    expect(chapterExportFilename(title, 'cue')).toBe(expected)
  })

  it('caps the name in UTF-8 bytes without splitting a character', () => {
    expect(chapterExportFilename('x'.repeat(500), 'json')).toBe(`${'x'.repeat(200)}.chapters.json`)
    expect(chapterExportFilename('\u4f53'.repeat(100), 'cue')).toBe(`${'\u4f53'.repeat(66)}.cue`)
    expect(chapterExportFilename('\u{1F600}'.repeat(60), 'cue')).toBe(`${'\u{1F600}'.repeat(50)}.cue`)
  })

  it('never leaves a path separator or control character in the name', () => {
    const hostile = ['a/b\\c', `x${NUL}y`, '\u0007bell', 'tab\there', '..\\..\\boot.ini']
    for (const title of hostile) {
      expect(chapterExportFilename(title, 'timestamps')).not.toMatch(/[/\\\p{Cc}]/u)
    }
  })
})
