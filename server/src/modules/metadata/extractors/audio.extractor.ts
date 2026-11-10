import { execFile as execFileCallback, spawn } from 'child_process';
import { extname } from 'path';
import { promisify } from 'util';
import { parseSeriesIndex as parseSeriesIndexLabel, type AudiobookChapter } from '@bookorbit/types';
import { parsePublishedDateKey, parsePublishedYear, publishedYearFromDateKey } from '../../../common/utils/published-date.utils';

const execFile = promisify(execFileCallback);

const FFPROBE_PATH = process.env.FFPROBE_PATH?.trim() || 'ffprobe';
const FFMPEG_PATH = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
// A chapter-rich audiobook prints far more than execFile's 1 MB default, and an overflow there
// would surface as a failed read of a perfectly good file.
const FFPROBE_OUTPUT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const MAX_EMBEDDED_COVER_BYTES = 32 * 1_024 * 1_024;

export interface AudioExtractResult {
  title: string | null;
  subtitle: string | null;
  authors: { name: string; sortName: string | null }[];
  narrators: string[];
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  description: string | null;
  language: string | null;
  seriesName: string | null;
  seriesIndex: string | null;
  genres: string[];
  audibleId: string | null;
  librofmId: string | null;
  durationSeconds: number | null;
  chapters: AudiobookChapter[];
  coverBytes: Buffer | null;
}

export interface AudioChapterProbe {
  chapters: AudiobookChapter[];
  durationMs: number | null;
}

export interface AudioFileProbe extends AudioChapterProbe {
  /** Whole seconds, the precision every stored per-file length uses. */
  durationSeconds: number | null;
}

interface FfprobeStream {
  codec_type: string;
  codec_name: string;
  tags?: Record<string, string>;
}

interface FfprobeChapter {
  start_time: string;
  tags?: Record<string, string>;
}

interface FfprobeOutput {
  format?: {
    duration?: string;
    tags?: Record<string, string>;
  };
  streams?: FfprobeStream[];
  chapters?: FfprobeChapter[];
}

// Null means the file could not be read, which is not the same as a file that carries no tags:
// callers persist what they get, so a failed read must never be mistaken for empty metadata.
export async function extractAudioMetadata(absolutePath: string, options: { cover?: boolean } = {}): Promise<AudioExtractResult | null> {
  try {
    const { stdout } = await execFile(
      FFPROBE_PATH,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_chapters', '-show_streams', absolutePath],
      { timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: FFPROBE_OUTPUT_MAX_BUFFER_BYTES },
    );

    const data: FfprobeOutput = JSON.parse(stdout);
    const streams = data.streams ?? [];
    const tags = resolveTags(data.format?.tags, streams);
    const chapters = data.chapters ?? [];

    const rawAlbumArtist = tagValue(tags, 'albumartist') ?? tagValue(tags, 'album_artist');
    const rawArtist = tagValue(tags, 'artist');
    const rawComposer = tagValue(tags, 'composer');

    const authorNames = rawAlbumArtist ? splitArtists(rawAlbumArtist) : rawArtist ? splitArtists(rawArtist) : [];
    const narratorNames = rawComposer
      ? splitNarrators(rawComposer)
      : rawAlbumArtist && rawArtist && normalizePersonTag(rawAlbumArtist) !== normalizePersonTag(rawArtist)
        ? splitNarrators(rawArtist)
        : [];

    // Album tag is the audiobook title; fall back to track title.
    const title = tagValue(tags, 'album') ?? tagValue(tags, 'title');
    const subtitle = tagValue(tags, 'subtitle');

    const publisher = tagValue(tags, 'publisher');
    const rawPublicationDate = tagValue(tags, 'date') ?? tagValue(tags, 'year');
    const publishedDate = parsePublishedDateKey(rawPublicationDate) ?? null;
    const publishedYear = publishedDate ? publishedYearFromDateKey(publishedDate) : (parsePublishedYear(rawPublicationDate) ?? null);
    const description = resolveDescription(
      tagValue(tags, 'comment'),
      tagValue(tags, 'description'),
      tagValue(tags, 'lyrics'),
      tagValue(tags, 'synopsis'),
    );
    const language = resolveLanguage(tags, streams);
    const seriesName = tagValue(tags, 'series') ?? tagValue(tags, 'show');
    const seriesIndex = parseSeriesIndex(
      tagValue(tags, 'series-part') ??
        tagValue(tags, 'part') ??
        tagValue(tags, 'series_part') ??
        tagValue(tags, 'seriespart') ??
        tagValue(tags, 'episode_id') ??
        tagValue(tags, 'episode_sort'),
    );
    const genres = splitTagList(tagValue(tags, 'genre'), ';');
    const audibleId = tagValue(tags, 'asin') ?? tagValue(tags, 'audible_asin');
    const librofmId = tagValue(tags, 'librofm_isbn');
    const durationSeconds = parseDurationSeconds(data.format?.duration);

    const mappedChapters = mapChapters(chapters);

    const coverBytes = options.cover === false ? null : await extractCoverBytes(absolutePath, streams);

    return {
      title,
      subtitle,
      authors: authorNames.map((name) => ({ name, sortName: null })),
      narrators: narratorNames,
      publisher,
      publishedDate,
      publishedYear,
      description,
      language,
      seriesName,
      seriesIndex,
      genres,
      audibleId,
      librofmId,
      durationSeconds,
      chapters: mappedChapters,
      coverBytes,
    };
  } catch {
    return null;
  }
}

type MusicMetadata = typeof import('music-metadata');
let musicMetadata: Promise<MusicMetadata> | null = null;
// music-metadata ships only as ESM; a dynamic import loads it from this CommonJS build.
const loadMusicMetadata = (): Promise<MusicMetadata> => (musicMetadata ??= import('music-metadata'));

/** What reads a file's length and chapters: the in-process parser, or ffprobe for every file. */
export type AudioProbeReader = 'builtin' | 'ffprobe';

// Ogg keeps its length only in the last page, so these need the parser's end-of-file read, which
// seeks there rather than scanning. Every other format states its length in the headers.
const AUDIO_FORMATS_READ_TO_END = new Set(['.ogg', '.oga', '.opus']);
// The same allowance ffprobe gets before it is killed. The parser cannot be stopped, but the scan
// moves on to ffprobe instead of waiting on it.
const IN_PROCESS_READ_TIMEOUT_MS = 30_000;
// The parser drops chapters past its cap with only a warning, where ffprobe returns every one.
const IN_PROCESS_MAX_CHAPTERS = 1000;
// No audiobook file runs a week; a longer answer is a misread.
const MAX_PLAUSIBLE_LENGTH_SECONDS = 7 * 24 * 60 * 60;

/**
 * Length and chapters for one file, without tags or cover art. A scan needs both from every file of
 * a multi-file audiobook, so this is its one probe per file. The built-in reader parses the file
 * in-process and hands over to ffprobe for any file it cannot read, or reads implausibly. Null
 * when neither could read it.
 */
export async function probeAudioFile(absolutePath: string, reader: AudioProbeReader = 'ffprobe'): Promise<AudioFileProbe | null> {
  if (reader === 'builtin') {
    const probe = await probeAudioFileInProcess(absolutePath);
    if (probe) return probe;
  }
  return probeAudioFileWithFfprobe(absolutePath);
}

async function probeAudioFileInProcess(absolutePath: string): Promise<AudioFileProbe | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const { parseFile } = await loadMusicMetadata();
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), IN_PROCESS_READ_TIMEOUT_MS);
    });
    const parsed = await Promise.race([
      parseFile(absolutePath, {
        duration: AUDIO_FORMATS_READ_TO_END.has(extname(absolutePath).toLowerCase()),
        includeChapters: true,
        maxChapterCount: IN_PROCESS_MAX_CHAPTERS,
        skipCovers: true,
      }),
      timedOut,
    ]);
    if (!parsed) return null;
    const { format } = parsed;

    // The container's length is what ffprobe reports; an MP4 audio track can run a few
    // milliseconds past it with encoder priming.
    const seconds = [format.containerDuration, format.duration].find((value) => value !== undefined && Number.isFinite(value) && value > 0);
    if (seconds === undefined || seconds > MAX_PLAUSIBLE_LENGTH_SECONDS) return null;

    const chapters = format.chapters ?? [];
    if (chapters.length >= IN_PROCESS_MAX_CHAPTERS) return null;
    const mapped: AudiobookChapter[] = [];
    for (const chapter of chapters) {
      // ID3v2 chapters give seconds and no time scale; MP4 chapters count in their track's units.
      const startMs = Math.round((chapter.start / (chapter.timeScale ?? 1)) * 1000);
      // Out of order or past the end means the chapter table was misread. ffprobe gets the file.
      if (!Number.isFinite(startMs) || startMs < (mapped.at(-1)?.startMs ?? 0) || startMs > seconds * 1000 + 1000) return null;
      // ffprobe names an untitled ID3v2 chapter after its element ID, and chapter writes are
      // verified against that reading, so the name has to match it.
      const title = chapter.timeScale === undefined ? chapter.title || chapter.id || '' : (chapter.title ?? '');
      mapped.push({ title, startMs });
    }

    return { chapters: mapped, durationMs: Math.round(seconds * 1000), durationSeconds: Math.round(seconds) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeAudioFileWithFfprobe(absolutePath: string): Promise<AudioFileProbe | null> {
  try {
    const { stdout } = await execFile(FFPROBE_PATH, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_chapters', absolutePath], {
      timeout: 30_000,
      killSignal: 'SIGKILL',
      maxBuffer: FFPROBE_OUTPUT_MAX_BUFFER_BYTES,
    });
    const data: FfprobeOutput = JSON.parse(stdout);
    return {
      chapters: mapChapters(data.chapters ?? []),
      durationMs: parseDurationMs(data.format?.duration),
      durationSeconds: parseDurationSeconds(data.format?.duration),
    };
  } catch {
    return null;
  }
}

export async function probeAudioChapters(absolutePath: string, reader: AudioProbeReader = 'ffprobe'): Promise<AudioChapterProbe> {
  const probe = await probeAudioFile(absolutePath, reader);
  return probe ? { chapters: probe.chapters, durationMs: probe.durationMs } : { chapters: [], durationMs: null };
}

function mapChapters(chapters: FfprobeChapter[]): AudiobookChapter[] {
  return chapters.flatMap((ch) => {
    const startMs = parseChapterStartMs(ch.start_time);
    if (startMs === null) return [];
    return [{ title: ch.tags?.title ?? '', startMs }];
  });
}

/** Reads only the embedded picture, for callers that need a cover without the rest of the tags. */
export async function extractAudioCover(absolutePath: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execFile(FFPROBE_PATH, ['-v', 'quiet', '-print_format', 'json', '-show_streams', absolutePath], {
      timeout: 30_000,
      killSignal: 'SIGKILL',
      maxBuffer: FFPROBE_OUTPUT_MAX_BUFFER_BYTES,
    });
    const data: FfprobeOutput = JSON.parse(stdout);
    return await extractCoverBytes(absolutePath, data.streams ?? []);
  } catch {
    return null;
  }
}

async function extractCoverBytes(absolutePath: string, streams: FfprobeStream[]): Promise<Buffer | null> {
  const hasEmbeddedImage = streams.some((s) => s.codec_type === 'video');
  if (!hasEmbeddedImage) return null;

  return new Promise<Buffer | null>((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    const proc = spawn(FFMPEG_PATH, ['-y', '-i', absolutePath, '-map', '0:v', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const finish = (value: Buffer | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    proc.stdout.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_EMBEDDED_COVER_BYTES) {
        proc.kill();
        chunks.length = 0;
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    proc.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        finish(Buffer.concat(chunks, totalBytes));
      } else {
        finish(null);
      }
    });
    proc.on('error', () => finish(null));
  });
}

function normalizeTags(tags: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
}

// Ogg files (Opus, Vorbis) carry their comments on the audio stream and leave the format's own tags
// empty, so a file that reads as untagged here may simply keep its tags one level down. Only audio
// streams count: an attached cover picture carries its own title and comment, which are not the book's.
function resolveTags(formatTags: Record<string, string> | undefined, streams: FfprobeStream[]): Record<string, string> {
  const tags = normalizeTags(formatTags ?? {});
  for (const stream of streams) {
    if (stream.codec_type !== 'audio') continue;
    for (const [key, value] of Object.entries(normalizeTags(stream.tags ?? {}))) {
      if (tagValue(tags, key) === null) tags[key] = value;
    }
  }
  return tags;
}

function tagValue(tags: Record<string, string>, key: string): string | null {
  const value = tags[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitArtists(raw: string): string[] {
  return splitTagList(raw, ';/');
}

function splitNarrators(raw: string): string[] {
  return splitTagList(raw, ',;/');
}

function normalizePersonTag(raw: string): string {
  return raw.trim().toLowerCase();
}

function splitTagList(raw: string | null, separators: string): string[] {
  if (!raw) return [];
  const pattern = new RegExp(`[${escapeCharClass(separators)}]`);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of raw.split(pattern)) {
    const value = part.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values;
}

function escapeCharClass(value: string): string {
  return value.replace(/[\\\]^/-]/g, '\\$&');
}

function parseDurationSeconds(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

// Milliseconds, not the rounded seconds stored per file: chapter offsets accumulate across files,
// so half-second rounding errors would compound down the book.
function parseDurationMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? Math.round(parsed * 1000) : null;
}

function parseChapterStartMs(raw: string): number | null {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? Math.round(parsed * 1000) : null;
}

function parseSeriesIndex(raw: string | null): string | null {
  if (!raw) return null;
  return parseSeriesIndexLabel(raw);
}

function resolveDescription(...values: (string | null)[]): string | null {
  return values.filter((value): value is string => Boolean(value)).sort((a, b) => b.length - a.length)[0] ?? null;
}

function resolveLanguage(tags: Record<string, string>, streams: FfprobeStream[]): string | null {
  const formatLanguage = normalizeLanguageValue(tagValue(tags, 'language'));
  if (formatLanguage) return formatLanguage;
  for (const stream of streams) {
    const streamTags = normalizeTags(stream.tags ?? {});
    const streamLanguage = normalizeLanguageValue(tagValue(streamTags, 'language'));
    if (stream.codec_type === 'audio' && streamLanguage) {
      return streamLanguage;
    }
  }
  return null;
}

function normalizeLanguageValue(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  return lower === 'und' || lower === 'unknown' ? null : normalized;
}
