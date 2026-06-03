import { execFile as execFileCallback, spawn } from 'child_process';
import { promisify } from 'util';
import type { AudiobookChapter } from '@bookorbit/types';

const execFile = promisify(execFileCallback);

const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

export interface AudioExtractResult {
  title: string | null;
  subtitle: string | null;
  authors: { name: string; sortName: string | null }[];
  narrators: string[];
  publisher: string | null;
  publishedYear: number | null;
  description: string | null;
  language: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  genres: string[];
  audibleId: string | null;
  durationSeconds: number | null;
  chapters: AudiobookChapter[];
  coverBytes: Buffer | null;
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

export async function extractAudioMetadata(absolutePath: string): Promise<AudioExtractResult> {
  try {
    const { stdout } = await execFile(FFPROBE_PATH, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_chapters',
      '-show_streams',
      absolutePath,
    ]);

    const data: FfprobeOutput = JSON.parse(stdout);
    const tags = normalizeTags(data.format?.tags ?? {});
    const streams = data.streams ?? [];
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
    const publishedYear = parseYear(tagValue(tags, 'date') ?? tagValue(tags, 'year'));
    const description = resolveDescription(
      tagValue(tags, 'comment'),
      tagValue(tags, 'description'),
      tagValue(tags, 'lyrics'),
      tagValue(tags, 'synopsis'),
    );
    const language = resolveLanguage(tags, streams);
    const seriesName = tagValue(tags, 'series');
    const seriesIndex = parseSeriesIndex(
      tagValue(tags, 'series-part') ?? tagValue(tags, 'part') ?? tagValue(tags, 'series_part') ?? tagValue(tags, 'seriespart'),
    );
    const genres = splitTagList(tagValue(tags, 'genre'), ';');
    const audibleId = tagValue(tags, 'asin') ?? tagValue(tags, 'audible_asin');
    const durationSeconds = parseDurationSeconds(data.format?.duration);

    const mappedChapters: AudiobookChapter[] = chapters.flatMap((ch) => {
      const startMs = parseChapterStartMs(ch.start_time);
      if (startMs === null) return [];
      return [{ title: ch.tags?.title ?? '', startMs }];
    });

    const coverBytes = await extractCoverBytes(absolutePath, streams);

    return {
      title,
      subtitle,
      authors: authorNames.map((name) => ({ name, sortName: null })),
      narrators: narratorNames,
      publisher,
      publishedYear,
      description,
      language,
      seriesName,
      seriesIndex,
      genres,
      audibleId,
      durationSeconds,
      chapters: mappedChapters,
      coverBytes,
    };
  } catch {
    return emptyResult();
  }
}

export async function parseAudioDuration(absolutePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFile(FFPROBE_PATH, ['-v', 'quiet', '-print_format', 'json', '-show_format', absolutePath]);
    const data: FfprobeOutput = JSON.parse(stdout);
    return parseDurationSeconds(data.format?.duration);
  } catch {
    return null;
  }
}

async function extractCoverBytes(absolutePath: string, streams: FfprobeStream[]): Promise<Buffer | null> {
  const hasEmbeddedImage = streams.some((s) => s.codec_type === 'video');
  if (!hasEmbeddedImage) return null;

  return new Promise<Buffer | null>((resolve) => {
    const chunks: Buffer[] = [];
    const proc = spawn(FFMPEG_PATH, ['-y', '-i', absolutePath, '-map', '0:v', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

function normalizeTags(tags: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
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

function parseYear(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/\d{4}/);
  return match ? parseInt(match[0], 10) : null;
}

function parseDurationSeconds(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parseChapterStartMs(raw: string): number | null {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? Math.round(parsed * 1000) : null;
}

function parseSeriesIndex(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
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

function emptyResult(): AudioExtractResult {
  return {
    title: null,
    subtitle: null,
    authors: [],
    narrators: [],
    publisher: null,
    publishedYear: null,
    description: null,
    language: null,
    seriesName: null,
    seriesIndex: null,
    genres: [],
    audibleId: null,
    durationSeconds: null,
    chapters: [],
    coverBytes: null,
  };
}
