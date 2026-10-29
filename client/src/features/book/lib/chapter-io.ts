import { AUDIOBOOK_CHAPTER_LIMITS, type AudiobookChapter } from '@bookorbit/types'

export type ChapterFormat = 'cue' | 'ffmetadata' | 'audacity' | 'timestamps' | 'titles' | 'json'
export type ChapterExportFormat = Exclude<ChapterFormat, 'titles'>

export interface ChapterParseResult {
  format: ChapterFormat
  /** Sorted ascending by startMs, each rounded to a whole millisecond. */
  chapters: AudiobookChapter[]
  /** True when the input carried titles only (format 'titles'); startMs are then 0 placeholders and callers map titles by position. */
  titlesOnly: boolean
  /**
   * 1-based line numbers the parser skipped as unreadable, so the UI can say "3 lines ignored". JSON entries do not map
   * to lines, so for JSON these are 1-based positions in the chapter array instead.
   */
  skippedLines: number[]
  /** True when the input held more than `AUDIOBOOK_CHAPTER_LIMITS.maxChapters` chapters and only the earliest were kept. */
  truncated: boolean
}

export interface ChapterSerializeOptions {
  totalDurationMs?: number | null
  title?: string | null
}

/** Input beyond this many UTF-8 bytes is refused rather than parsed. */
export const CHAPTER_IMPORT_MAX_BYTES = 2 * 1024 * 1024

interface RawChapter {
  /** Reported back in `skippedLines` when the entry turns out to be unusable. */
  line: number
  startMs: number
  title: string
}

interface RawParse {
  entries: RawChapter[]
  skipped: number[]
}

/** Longer lines are never a chapter, and capping them keeps the clock patterns cheap. */
const MAX_LINE_LENGTH = 4096
const CUE_FRAMES_PER_SECOND = 75
const MAX_FILENAME_STEM_BYTES = 200
const FALLBACK_FILENAME_STEM = 'chapters'
const FALLBACK_CUE_FILE = 'audiobook'

const CLOCK = String.raw`(\d{1,4}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,9}))?`
const SEPARATOR = String.raw`[\s\-|:\u2013\u2014]`
const LEADING_CLOCK = new RegExp(String.raw`^[\[(]?${CLOCK}(?:[\])]|(?=${SEPARATOR}|$))(.*)$`)
const TRAILING_CLOCK = new RegExp(String.raw`^(.*?)(?:${SEPARATOR}[\[(]?|[\[(])${CLOCK}[\])]?$`)
const BARE_CLOCK = new RegExp(`^${CLOCK}$`)
const LEADING_SEPARATORS = new RegExp(`^${SEPARATOR}+`)
const TRAILING_SEPARATORS = new RegExp(`${SEPARATOR}+$`)
const OGM_TIME = /^CHAPTER(\d+)\s*=\s*(\S+)$/i
const OGM_NAME = /^CHAPTER(\d+)NAME\s*=(.*)$/i

const AUDACITY_LABEL = /^(\d+(?:[.,]\d+)?)\t(\d+(?:[.,]\d+)?)(?:\t(.*))?$/

const CUE_TRACK_LINE = /^\s*TRACK\s+\d+/im
const CUE_INDEX_LINE = /^\s*INDEX\s+\d+\s+\d+:\d+:\d+/im
const CUE_TRACK = /^TRACK\s+\d+(?:\s+\S+)?$/i
const CUE_INDEX = /^INDEX\s+(\d{1,2})\s+(\d+):(\d{1,2}):(\d{1,2})$/i
const CUE_IGNORED_COMMANDS = new Set([
  'REM',
  'PERFORMER',
  'SONGWRITER',
  'COMPOSER',
  'ARRANGER',
  'MESSAGE',
  'CATALOG',
  'CDTEXTFILE',
  'FLAGS',
  'ISRC',
  'PREGAP',
  'POSTGAP',
  'GENRE',
  'DISC_ID',
  'UPC_EAN',
])

const FFMETADATA_CHAPTER_HEADER = /^\s*\[CHAPTER\]\s*$/im
const FFMETADATA_SECTION = /^\[[^\]]*\]$/
const FFMETADATA_TIMEBASE = /^(\d+)\/(\d+)$/
const FFMETADATA_SPECIAL = /[=;#\\\n]/g
/** ffmpeg reads START and END as nanoseconds when a chapter declares no TIMEBASE. */
const FFMETADATA_DEFAULT_TIMEBASE = { num: 1, den: 1_000_000_000 }

const NUMERIC_STRING = /^\s*\d+(?:\.\d+)?\s*$/
const UNREADABLE_TITLE_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]+/gu
const UNSAFE_FILENAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>:"/\\|?*]+/gu
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i

const EXPORT_SUFFIXES: Record<ChapterExportFormat, string> = {
  cue: '.cue',
  ffmetadata: '.ffmetadata.txt',
  audacity: '.labels.txt',
  timestamps: '.chapters.txt',
  json: '.chapters.json',
}

export function detectChapterFormat(text: string): ChapterFormat | null {
  const normalized = normalizeInput(text)
  return normalized == null ? null : detectNormalized(normalized)
}

/** Returns null when the input is oversized, binary, of another format than the one asked for, or holds no usable chapter. */
export function parseChapters(text: string, format?: ChapterFormat): ChapterParseResult | null {
  const normalized = normalizeInput(text)
  if (normalized == null) return null
  const resolved = format ?? detectNormalized(normalized)
  if (resolved == null) return null
  const raw = parseRaw(resolved, normalized)
  return raw == null ? null : finalize(resolved, raw)
}

export function serializeChapters(chapters: readonly AudiobookChapter[], format: ChapterExportFormat, options: ChapterSerializeOptions = {}): string {
  const ordered = chapters
    .map((chapter) => ({ title: chapter.title, startMs: Math.max(0, Math.round(chapter.startMs)) }))
    .sort((a, b) => a.startMs - b.startMs)
  const totalDurationMs = options.totalDurationMs != null && Number.isFinite(options.totalDurationMs) ? Math.round(options.totalDurationMs) : null
  const bookTitle = flattenTitle(options.title ?? '')
  switch (format) {
    case 'cue':
      return serializeCue(ordered, bookTitle)
    case 'ffmetadata':
      return serializeFfmetadata(ordered, totalDurationMs, bookTitle)
    case 'audacity':
      return serializeAudacity(ordered, totalDurationMs)
    case 'timestamps':
      return serializeTimestamps(ordered)
    case 'json':
      return `${JSON.stringify({ chapters: ordered }, null, 2)}\n`
  }
}

export function chapterExportFilename(bookTitle: string | null, format: ChapterExportFormat): string {
  return `${filenameStem(bookTitle)}${EXPORT_SUFFIXES[format]}`
}

function normalizeInput(text: string): string | null {
  if (typeof text !== 'string' || exceedsImportLimit(text) || text.includes('\u0000')) return null
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

function exceedsImportLimit(text: string): boolean {
  if (text.length > CHAPTER_IMPORT_MAX_BYTES) return true
  // A UTF-16 unit encodes to at most three UTF-8 bytes, so shorter text cannot reach the limit.
  return text.length * 3 > CHAPTER_IMPORT_MAX_BYTES && new TextEncoder().encode(text).byteLength > CHAPTER_IMPORT_MAX_BYTES
}

function detectNormalized(text: string): ChapterFormat | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && parseJsonValue(trimmed) !== undefined) return 'json'
  if (trimmed.startsWith(';FFMETADATA') || FFMETADATA_CHAPTER_HEADER.test(text)) return 'ffmetadata'
  if (CUE_TRACK_LINE.test(text) && CUE_INDEX_LINE.test(text)) return 'cue'
  const lines = nonBlankLines(text)
  // Audacity writes a backslash-led line under each label that carries a frequency range; it says nothing about the format.
  if (
    isMajority(
      lines.filter((line) => !line.startsWith('\\')),
      (line) => AUDACITY_LABEL.test(line),
    )
  )
    return 'audacity'
  if (isMajority(lines, isTimestampLine)) return 'timestamps'
  // JSON that failed to parse would otherwise come back as one title per line of braces.
  return trimmed.startsWith('{') || /^\[\s*[[{"]/.test(trimmed) ? null : 'titles'
}

function nonBlankLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function isMajority(lines: string[], matches: (line: string) => boolean): boolean {
  if (lines.length === 0) return false
  let count = 0
  for (const line of lines) if (matches(line)) count++
  return count * 2 > lines.length
}

function parseRaw(format: ChapterFormat, text: string): RawParse | null {
  switch (format) {
    case 'json':
      return parseJson(text)
    case 'ffmetadata':
      return parseFfmetadata(text)
    case 'cue':
      return parseCue(text.split('\n'))
    case 'audacity':
      return parseAudacity(text.split('\n'))
    case 'timestamps':
      return parseTimestamps(text.split('\n'))
    case 'titles':
      return parseTitles(text.split('\n'))
    default:
      return null
  }
}

function finalize(format: ChapterFormat, { entries, skipped }: RawParse): ChapterParseResult | null {
  const titlesOnly = format === 'titles'
  const seen = new Set<number>()
  const chapters: AudiobookChapter[] = []
  for (const entry of entries) {
    const rounded = Math.round(entry.startMs)
    if (!Number.isSafeInteger(rounded) || rounded < 0) {
      skipped.push(entry.line)
      continue
    }
    // Normalizes the -0 a tiny negative input rounds to.
    const startMs = rounded === 0 ? 0 : rounded
    if (!titlesOnly) {
      if (seen.has(startMs)) continue
      seen.add(startMs)
    }
    chapters.push({ title: cleanTitle(entry.title), startMs })
  }
  if (chapters.length === 0) return null
  chapters.sort((a, b) => a.startMs - b.startMs)
  const truncated = chapters.length > AUDIOBOOK_CHAPTER_LIMITS.maxChapters
  return {
    format,
    chapters: truncated ? chapters.slice(0, AUDIOBOOK_CHAPTER_LIMITS.maxChapters) : chapters,
    titlesOnly,
    skippedLines: [...new Set(skipped)].sort((a, b) => a - b),
    truncated,
  }
}

function flattenTitle(title: string): string {
  return title.replace(UNREADABLE_TITLE_CHARACTERS, ' ').trim()
}

function cleanTitle(title: string): string {
  const flat = flattenTitle(title)
  if (flat.length <= AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength) return flat
  let cut = flat.slice(0, AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut.trimEnd()
}

// JSON

function parseJsonValue(text: string): object | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? value : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(text: string): RawParse | null {
  const value = parseJsonValue(text.trim())
  const list: unknown[] | null = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.chapters) ? value.chapters : null
  if (list == null) return null
  const entries: RawChapter[] = []
  const skipped: number[] = []
  list.forEach((item, index) => {
    const startMs = isRecord(item) ? jsonStartMs(item) : null
    if (startMs == null || !isRecord(item)) skipped.push(index + 1)
    else entries.push({ line: index + 1, startMs, title: jsonTitle(item) })
  })
  return { entries, skipped }
}

function jsonStartMs(item: Record<string, unknown>): number | null {
  const startMs = toNumber(item.startMs)
  if (startMs != null) return startMs
  // ffprobe -show_chapters: `start` counts time_base ticks, so reading it as seconds would be off by the tick rate.
  if ('time_base' in item) {
    const seconds = toNumber(item.start_time)
    if (seconds != null) return seconds * 1000
    const timebase = parseTimebase(item.time_base)
    const ticks = toNumber(item.start)
    return timebase != null && ticks != null ? (ticks * 1000 * timebase.num) / timebase.den : null
  }
  const seconds = toNumber(item.start)
  return seconds == null ? null : seconds * 1000
}

function jsonTitle(item: Record<string, unknown>): string {
  if (typeof item.title === 'string') return item.title
  return isRecord(item.tags) && typeof item.tags.title === 'string' ? item.tags.title : ''
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return typeof value === 'string' && NUMERIC_STRING.test(value) ? Number(value) : null
}

function parseTimebase(value: unknown): { num: number; den: number } | null {
  const match = typeof value === 'string' ? FFMETADATA_TIMEBASE.exec(value.trim()) : null
  if (match == null) return null
  const num = Number(match[1])
  const den = Number(match[2])
  return num > 0 && den > 0 ? { num, den } : null
}

// ffmetadata

interface FfmetadataLine {
  line: number
  /** Null when the line holds no unescaped `=`. */
  key: string | null
  value: string
}

/** Splits on unescaped newlines and the first unescaped `=`, unescaping as it goes, the way ffmpeg reads the file. */
function readFfmetadataLines(text: string): FfmetadataLine[] {
  const lines: FfmetadataLine[] = []
  let physicalLine = 1
  let startLine = 1
  let key: string | null = null
  let buffer = ''
  let comment = false
  let atLineStart = true
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index)
    if (atLineStart) {
      comment = char === ';' || char === '#'
      atLineStart = false
    }
    if (char === '\\') {
      if (index + 1 >= text.length) break
      const escaped = text.charAt(++index)
      if (escaped === '\n') physicalLine++
      buffer += escaped
    } else if (char === '\n') {
      if (!comment) lines.push({ line: startLine, key, value: buffer })
      physicalLine++
      startLine = physicalLine
      key = null
      buffer = ''
      atLineStart = true
    } else if (char === '=' && key === null) {
      key = buffer
      buffer = ''
    } else {
      buffer += char
    }
  }
  if (!atLineStart && !comment) lines.push({ line: startLine, key, value: buffer })
  return lines
}

interface FfmetadataChapter {
  line: number
  timebase: { num: number; den: number }
  start: number | null
  title: string
  invalid: boolean
}

function parseFfmetadata(text: string): RawParse {
  const entries: RawChapter[] = []
  const skipped: number[] = []
  let chapter: FfmetadataChapter | null = null

  const flush = () => {
    if (chapter == null || chapter.invalid) return
    if (chapter.start == null) skipped.push(chapter.line)
    else entries.push({ line: chapter.line, startMs: (chapter.start * 1000 * chapter.timebase.num) / chapter.timebase.den, title: chapter.title })
  }

  for (const { line, key, value } of readFfmetadataLines(text)) {
    if (key === null) {
      const content = value.trim()
      if (!content) continue
      if (FFMETADATA_SECTION.test(content)) {
        flush()
        chapter =
          content.toUpperCase() === '[CHAPTER]' ? { line, timebase: FFMETADATA_DEFAULT_TIMEBASE, start: null, title: '', invalid: false } : null
      } else {
        skipped.push(line)
      }
      continue
    }
    // Global and stream metadata (the book's own title, artist and so on) are not chapters.
    if (chapter == null) continue
    const name = key.trim().toUpperCase()
    if (name === 'TIMEBASE') {
      const timebase = parseTimebase(value)
      if (timebase == null) {
        skipped.push(line)
        chapter.invalid = true
      } else {
        chapter.timebase = timebase
      }
    } else if (name === 'START') {
      const start = NUMERIC_STRING.test(value) ? Number(value) : null
      if (start == null) {
        skipped.push(line)
        chapter.invalid = true
      } else {
        chapter.start = start
      }
    } else if (name === 'TITLE') {
      chapter.title = value
    }
  }
  flush()
  return { entries, skipped }
}

function escapeFfmetadata(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(FFMETADATA_SPECIAL, (char) => `\\${char}`)
}

// CUE

interface CueTrack {
  line: number
  title: string
  index00: number | null
  index01: number | null
}

function parseCue(lines: string[]): RawParse | null {
  const tracks: CueTrack[] = []
  const skipped: number[] = []
  let files = 0
  let track: CueTrack | null = null

  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line) return
    const lineNumber = index + 1
    const command = line.split(/\s/, 1)[0] ?? ''
    switch (command.toUpperCase()) {
      case 'FILE':
        files++
        return
      case 'TRACK':
        if (CUE_TRACK.test(line)) {
          track = { line: lineNumber, title: '', index00: null, index01: null }
          tracks.push(track)
        } else {
          skipped.push(lineNumber)
        }
        return
      case 'TITLE':
        // A TITLE before the first TRACK names the whole book.
        if (track != null) track.title = unquoteCue(line.slice(command.length))
        return
      case 'INDEX': {
        const time = track == null ? null : cueIndex(line)
        if (track == null || time == null) skipped.push(lineNumber)
        else if (time.number === 1) track.index01 ??= time.ms
        else if (time.number === 0) track.index00 ??= time.ms
        return
      }
      default:
        if (!CUE_IGNORED_COMMANDS.has(command.toUpperCase())) skipped.push(lineNumber)
    }
  })

  const entries: RawChapter[] = []
  for (const { line, title, index00, index01 } of tracks) {
    const startMs = index01 ?? index00
    if (startMs == null) skipped.push(line)
    else entries.push({ line, startMs, title })
  }
  // Each FILE restarts the clock at zero and the file lengths are unknown, so a multi-file sheet is only usable
  // when its times already run on one timeline.
  if (files > 1 && entries.some((entry, index) => index > 0 && entry.startMs <= (entries[index - 1]?.startMs ?? -1))) return null
  return { entries, skipped }
}

function cueIndex(line: string): { number: number; ms: number } | null {
  const match = CUE_INDEX.exec(line)
  if (match == null) return null
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const frames = Number(match[4])
  if (seconds >= 60 || frames >= CUE_FRAMES_PER_SECOND) return null
  return { number: Number(match[1]), ms: (minutes * 60 + seconds) * 1000 + (frames * 1000) / CUE_FRAMES_PER_SECOND }
}

/** CUE has no escape syntax; quotes inside a title are written `\"`, and everything between the outer quotes is kept. */
function unquoteCue(rest: string): string {
  const value = rest.trim()
  if (!value.startsWith('"')) return value
  const end = value.lastIndexOf('"')
  return (end > 0 ? value.slice(1, end) : value.slice(1)).replace(/\\"/g, '"')
}

function quoteCue(value: string): string {
  return `"${flattenTitle(value).replace(/"/g, '\\"')}"`
}

function cueTime(ms: number): string {
  const frames = Math.round((ms * CUE_FRAMES_PER_SECOND) / 1000)
  const minutes = Math.floor(frames / (CUE_FRAMES_PER_SECOND * 60))
  const seconds = Math.floor(frames / CUE_FRAMES_PER_SECOND) % 60
  return `${pad(minutes, 2)}:${pad(seconds, 2)}:${pad(frames % CUE_FRAMES_PER_SECOND, 2)}`
}

// Audacity labels

function parseAudacity(lines: string[]): RawParse {
  const entries: RawChapter[] = []
  const skipped: number[] = []
  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith('\\')) return
    const match = AUDACITY_LABEL.exec(line)
    if (match == null) skipped.push(index + 1)
    else entries.push({ line: index + 1, startMs: Number(match[1]?.replace(',', '.')) * 1000, title: match[3] ?? '' })
  })
  return { entries, skipped }
}

function audacitySeconds(ms: number): string {
  return (ms / 1000).toFixed(6)
}

// Timestamped lines

function clockToMs(first: string | undefined, second: string | undefined, third: string | undefined, fraction: string | undefined): number | null {
  const hasHours = third !== undefined
  const hours = hasHours ? Number(first) : 0
  const minutes = Number(hasHours ? second : first)
  const seconds = Number(hasHours ? third : second)
  if (!Number.isFinite(hours + minutes + seconds) || seconds >= 60 || (hasHours && minutes >= 60)) return null
  const fractionMs = fraction ? Number(`0.${fraction}`) * 1000 : 0
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + fractionMs
}

function parseClockLine(line: string): { startMs: number; title: string } | null {
  const leading = LEADING_CLOCK.exec(line)
  const leadingMs = leading == null ? null : clockToMs(leading[1], leading[2], leading[3], leading[4])
  if (leading != null && leadingMs != null) return { startMs: leadingMs, title: (leading[5] ?? '').replace(LEADING_SEPARATORS, '') }
  const trailing = TRAILING_CLOCK.exec(line)
  const trailingMs = trailing == null ? null : clockToMs(trailing[2], trailing[3], trailing[4], trailing[5])
  if (trailing != null && trailingMs != null) return { startMs: trailingMs, title: (trailing[1] ?? '').replace(TRAILING_SEPARATORS, '') }
  return null
}

/** The OGM simple chapter format (mkvmerge, mp4v2): `CHAPTER01=00:00:00.000` followed by `CHAPTER01NAME=Title`. */
function parseOgmTime(line: string): { number: number; startMs: number } | null {
  const match = OGM_TIME.exec(line)
  const clock = match == null ? null : BARE_CLOCK.exec(match[2] ?? '')
  const startMs = clock == null ? null : clockToMs(clock[1], clock[2], clock[3], clock[4])
  return match == null || startMs == null ? null : { number: Number(match[1]), startMs }
}

function isTimestampLine(line: string): boolean {
  return line.length <= MAX_LINE_LENGTH && (OGM_NAME.test(line) || parseOgmTime(line) != null || parseClockLine(line) != null)
}

function parseTimestamps(lines: string[]): RawParse {
  const entries: RawChapter[] = []
  const skipped: number[] = []
  const ogmChapters = new Map<number, RawChapter>()
  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line) return
    const lineNumber = index + 1
    if (line.length > MAX_LINE_LENGTH) {
      skipped.push(lineNumber)
      return
    }
    const ogmName = OGM_NAME.exec(line)
    if (ogmName != null) {
      const chapter = ogmChapters.get(Number(ogmName[1]))
      if (chapter == null) skipped.push(lineNumber)
      else chapter.title = ogmName[2] ?? ''
      return
    }
    const ogmTime = parseOgmTime(line)
    if (ogmTime != null) {
      const chapter = { line: lineNumber, startMs: ogmTime.startMs, title: '' }
      ogmChapters.set(ogmTime.number, chapter)
      entries.push(chapter)
      return
    }
    const parsed = parseClockLine(line)
    if (parsed == null) skipped.push(lineNumber)
    else entries.push({ line: lineNumber, ...parsed })
  })
  return { entries, skipped }
}

function timestampClock(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor(ms / 60_000) % 60
  const seconds = Math.floor(ms / 1000) % 60
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(ms % 1000, 3)}`
}

// Titles only

function parseTitles(lines: string[]): RawParse {
  const entries: RawChapter[] = []
  const skipped: number[] = []
  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line) return
    if (line.length > MAX_LINE_LENGTH) skipped.push(index + 1)
    else entries.push({ line: index + 1, startMs: 0, title: line })
  })
  return { entries, skipped }
}

// Serializers

function chapterEnd(chapters: AudiobookChapter[], index: number, totalDurationMs: number | null): number {
  const start = chapters[index]?.startMs ?? 0
  const next = chapters[index + 1]
  if (next != null) return next.startMs
  return totalDurationMs != null && totalDurationMs > start ? totalDurationMs : start
}

function serializeCue(chapters: AudiobookChapter[], bookTitle: string): string {
  const lines: string[] = []
  if (bookTitle) lines.push(`TITLE ${quoteCue(bookTitle)}`)
  lines.push(`FILE ${quoteCue(bookTitle || FALLBACK_CUE_FILE)} MP4`)
  chapters.forEach((chapter, index) => {
    lines.push(`  TRACK ${pad(index + 1, 2)} AUDIO`, `    TITLE ${quoteCue(chapter.title)}`, `    INDEX 01 ${cueTime(chapter.startMs)}`)
  })
  return `${lines.join('\n')}\n`
}

function serializeFfmetadata(chapters: AudiobookChapter[], totalDurationMs: number | null, bookTitle: string): string {
  const lines = [';FFMETADATA1']
  if (bookTitle) lines.push(`title=${escapeFfmetadata(bookTitle)}`)
  chapters.forEach((chapter, index) => {
    lines.push(
      '',
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${chapter.startMs}`,
      `END=${chapterEnd(chapters, index, totalDurationMs)}`,
      `title=${escapeFfmetadata(chapter.title)}`,
    )
  })
  return `${lines.join('\n')}\n`
}

function serializeAudacity(chapters: AudiobookChapter[], totalDurationMs: number | null): string {
  return chapters
    .map(
      (chapter, index) =>
        `${audacitySeconds(chapter.startMs)}\t${audacitySeconds(chapterEnd(chapters, index, totalDurationMs))}\t${flattenTitle(chapter.title)}\n`,
    )
    .join('')
}

function serializeTimestamps(chapters: AudiobookChapter[]): string {
  return chapters.map((chapter) => [timestampClock(chapter.startMs), flattenTitle(chapter.title)].filter(Boolean).join(' ') + '\n').join('')
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

// Filenames

function filenameStem(bookTitle: string | null): string {
  const cleaned = (bookTitle ?? '')
    .replace(UNSAFE_FILENAME_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
  // Windows refuses names ending in a dot or space, and a leading dot would hide the file.
  const stem = truncateUtf8(cleaned, MAX_FILENAME_STEM_BYTES).replace(/[\s.]+$/, '')
  return stem && !WINDOWS_RESERVED_NAME.test(stem) ? stem : FALLBACK_FILENAME_STEM
}

/** Filesystems cap names in bytes, so a title in a multi-byte script needs a byte budget rather than a character one. */
function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0
  let end = 0
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (bytes > maxBytes) break
    end += char.length
  }
  return value.slice(0, end)
}
