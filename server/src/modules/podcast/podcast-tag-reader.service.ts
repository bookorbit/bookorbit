import { Injectable, Logger } from '@nestjs/common';
import { execFile as execFileCallback, spawn } from 'child_process';
import { basename, extname } from 'path';
import { promisify } from 'util';

import type { PodcastChapter } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

const execFile = promisify(execFileCallback);

const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_TIMEOUT_MS = 30_000;
const FFPROBE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const FFMPEG_COVER_TIMEOUT_MS = 30_000;
const MAX_EMBEDDED_COVER_BYTES = 10 * 1024 * 1024;
/** The same ceiling an edited episode is held to, so an import cannot write chapters an edit could not. */
const MAX_IMPORTED_CHAPTERS = 1000;

const MAX_GUID_LENGTH = 1000;
const MAX_URL_LENGTH = 8192;
const MAX_TEXT_LENGTH = 2000;

/**
 * Apple's podcast tags under every name ffprobe is known to publish them by. ID3 frames come
 * through with their raw four-character id when FFmpeg has no mapping for them, while the MP4
 * demuxer renames the same fields to readable keys, so both spellings have to be accepted.
 */
const EPISODE_GUID_KEYS = ['tgid', 'egid', 'episode_uid'];
const FEED_URL_KEYS = ['wfed', 'purl', 'podcast_url'];
const PODCAST_FLAG_KEYS = ['pcst', 'podcast'];
const DESCRIPTION_KEYS = ['tdes', 'ldes', 'desc', 'description', 'synopsis'];
const DATE_KEYS = ['date', 'year', 'originaldate', 'creation_time'];

/** `YYYY-MM-DD` at the start of a name, optionally followed by a separator. Both conventions BookOrbit meets. */
const FILE_NAME_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:\s*[-_.]\s*|\s+)?/;
/** The `[<id>]` suffix BookOrbit's own downloads carry, on files and on show folders alike. */
const ID_SUFFIX_PATTERN = /\s*\[(\d{1,9})\]$/;

export interface PodcastFileTags {
  /** Apple `TGID`/`egid`: the feed's own episode GUID, and the strongest signal a file can carry. */
  episodeGuid: string | null;
  /** Apple `WFED`/`purl`: the feed the file was downloaded from. */
  feedUrl: string | null;
  title: string | null;
  album: string | null;
  artist: string | null;
  description: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  /** The Apple `pcst` flag. Informational: a missing flag never disqualifies a file. */
  podcastFlag: boolean;
}

export interface PodcastFileNameHints {
  publishedAt: Date | null;
  /** The episode id BookOrbit wrote into the name. Always re-checked against the database before it is trusted. */
  episodeId: number | null;
  title: string | null;
}

/**
 * What creating an episode out of a file needs on top of the matching tags: the chapter marks the
 * file carries, and whether it holds an image that could become the show's artwork.
 */
export interface PodcastLocalFileProbe extends PodcastFileTags {
  chapters: PodcastChapter[];
  hasEmbeddedCover: boolean;
  /** The `track` tag's leading number, which is what a numbered show's own ordering is written in. */
  trackNumber: string | null;
}

interface FfprobeStream {
  codec_type?: string;
  tags?: Record<string, unknown>;
}

interface FfprobeChapter {
  start_time?: string;
  end_time?: string;
  tags?: Record<string, unknown>;
}

interface FfprobeOutput {
  format?: { duration?: string; tags?: Record<string, unknown> };
  streams?: FfprobeStream[];
  chapters?: FfprobeChapter[];
}

/**
 * Reads the tags the importer matches on out of one audio file.
 *
 * Everything this returns is untrusted third-party input: values are length-capped and stripped of
 * control characters here so no caller has to remember to, and nothing read here is ever used to
 * build a filesystem path.
 */
@Injectable()
export class PodcastTagReaderService {
  private readonly logger = new Logger(PodcastTagReaderService.name);

  /** Returns null when the file cannot be probed at all; a file with no tags returns an empty record. */
  async read(absolutePath: string): Promise<PodcastFileTags | null> {
    // Vorbis comments reach ffprobe as stream metadata in Ogg and Opus containers, so the stream
    // tags have to be read as well or those files would look untagged. Chapters are deliberately
    // not requested here: nothing in the matcher or the attach reads them.
    const data = await this.probe(absolutePath, false);
    return data === null ? null : mapFfprobeOutput(data);
  }

  /**
   * The fuller read a file needs when it becomes an episode rather than being matched to one:
   * chapter marks, and whether the file carries an image the show could use as artwork.
   */
  async readForImport(absolutePath: string): Promise<PodcastLocalFileProbe | null> {
    const data = await this.probe(absolutePath, true);
    if (data === null) return null;
    return {
      ...mapFfprobeOutput(data),
      chapters: mapFfprobeChapters(data.chapters ?? []),
      hasEmbeddedCover: (data.streams ?? []).some((stream) => stream.codec_type === 'video'),
      trackNumber: parseTrackNumber(boundedTag(collectTags(data), ['track', 'tracknumber'], 20)),
    };
  }

  /**
   * The first embedded image in the file, re-encoded to JPEG. Bounded in both time and size, so a
   * file with an enormous or endless image stream cannot hold the import open or fill memory.
   */
  async extractEmbeddedCover(absolutePath: string): Promise<Buffer | null> {
    return new Promise<Buffer | null>((resolve) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let settled = false;
      const child = spawn(
        FFMPEG_PATH,
        ['-y', '-i', absolutePath, '-map', '0:v', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        finish(null);
      }, FFMPEG_COVER_TIMEOUT_MS);
      const finish = (value: Buffer | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      child.stdout.on('data', (chunk: Buffer) => {
        totalBytes += chunk.byteLength;
        if (totalBytes > MAX_EMBEDDED_COVER_BYTES) {
          child.kill('SIGKILL');
          chunks.length = 0;
          finish(null);
          return;
        }
        chunks.push(chunk);
      });
      child.on('error', () => finish(null));
      child.on('close', (code) => finish(code === 0 && chunks.length > 0 ? Buffer.concat(chunks, totalBytes) : null));
    });
  }

  private async probe(absolutePath: string, includeChapters: boolean): Promise<FfprobeOutput | null> {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams'];
    if (includeChapters) args.push('-show_chapters');
    let stdout: string;
    try {
      ({ stdout } = await execFile(FFPROBE_PATH, [...args, '-i', absolutePath], {
        timeout: FFPROBE_TIMEOUT_MS,
        maxBuffer: FFPROBE_MAX_OUTPUT_BYTES,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `[podcast.read_tags] [fail] errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - podcast file could not be probed`,
      );
      return null;
    }
    try {
      return JSON.parse(stdout) as FfprobeOutput;
    } catch {
      return null;
    }
  }
}

/** Chapters as the episode schema stores them: titled, ordered by start, and capped. */
export function mapFfprobeChapters(chapters: FfprobeChapter[]): PodcastChapter[] {
  const mapped: PodcastChapter[] = [];
  for (const chapter of chapters) {
    const startSeconds = parseDurationSeconds(chapter.start_time);
    if (startSeconds === null) continue;
    const endSeconds = parseDurationSeconds(chapter.end_time);
    const rawTitle = chapter.tags?.['title'];
    const title = typeof rawTitle === 'string' ? stripControlCharacters(rawTitle).trim().slice(0, 500) : '';
    mapped.push({
      title: title || `Chapter ${mapped.length + 1}`,
      startSeconds,
      ...(endSeconds !== null && endSeconds > startSeconds ? { endSeconds } : {}),
    });
    if (mapped.length === MAX_IMPORTED_CHAPTERS) break;
  }
  return mapped.sort((left, right) => left.startSeconds - right.startSeconds);
}

/** Exported for the matcher's fixtures: the mapping is pure, so it is testable without a real ffprobe. */
export function mapFfprobeOutput(data: FfprobeOutput): PodcastFileTags {
  const tags = collectTags(data);
  return {
    episodeGuid: boundedTag(tags, EPISODE_GUID_KEYS, MAX_GUID_LENGTH),
    feedUrl: boundedTag(tags, FEED_URL_KEYS, MAX_URL_LENGTH),
    title: boundedTag(tags, ['title'], MAX_TEXT_LENGTH),
    album: boundedTag(tags, ['album'], MAX_TEXT_LENGTH),
    artist: boundedTag(tags, ['artist', 'album_artist', 'albumartist'], MAX_TEXT_LENGTH),
    description: boundedTag(tags, DESCRIPTION_KEYS, MAX_TEXT_LENGTH),
    publishedAt: parseTagDate(boundedTag(tags, DATE_KEYS, 100)),
    durationSeconds: parseDurationSeconds(data.format?.duration),
    podcastFlag: parseFlag(boundedTag(tags, PODCAST_FLAG_KEYS, 20)),
  };
}

/**
 * Format tags win over stream tags: when a container carries both, the format-level value is the
 * file's own metadata and the stream-level one describes a single track inside it.
 */
function collectTags(data: FfprobeOutput): Map<string, string> {
  const collected = new Map<string, string>();
  for (const stream of data.streams ?? []) {
    if (stream.codec_type !== undefined && stream.codec_type !== 'audio') continue;
    addTags(collected, stream.tags);
  }
  addTags(collected, data.format?.tags, true);
  return collected;
}

function addTags(collected: Map<string, string>, tags: Record<string, unknown> | undefined, overwrite = false): void {
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (typeof value !== 'string') continue;
    const normalizedKey = key.toLowerCase();
    if (!overwrite && collected.has(normalizedKey)) continue;
    collected.set(normalizedKey, value);
  }
}

function boundedTag(tags: Map<string, string>, keys: string[], maxLength: number): string | null {
  for (const key of keys) {
    const value = tags.get(key);
    if (typeof value !== 'string') continue;
    const cleaned = stripControlCharacters(value).trim().slice(0, maxLength);
    if (cleaned.length > 0) return cleaned;
  }
  return null;
}

function stripControlCharacters(value: string): string {
  let result = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    result += codePoint <= 31 || codePoint === 127 ? ' ' : character;
  }
  return result;
}

function parseDurationSeconds(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** A bare `YYYY` is accepted as that year's first day; anything Date cannot read is dropped. */
function parseTagDate(raw: string | null): Date | null {
  if (!raw) return null;
  const yearOnly = /^\d{4}$/.exec(raw);
  const parsed = new Date(yearOnly ? `${raw}-01-01T00:00:00Z` : raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  return year >= 1900 && year <= 2200 ? parsed : null;
}

/**
 * The number out of a `track` tag, which may be written `7`, `07`, or `7/64`.
 *
 * Normalised to its decimal form so a numbered local show reads the same as a feed that publishes
 * `<itunes:episode>`, including after a merge puts both kinds of episode under one show.
 */
function parseTrackNumber(raw: string | null): string | null {
  if (!raw) return null;
  const match = /^(\d{1,5})(?:\s*\/.*)?$/.exec(raw.trim());
  if (!match) return null;
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function parseFlag(raw: string | null): boolean {
  if (!raw) return false;
  const value = raw.toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * Reads what a file name alone can say: BookOrbit's own `[<episodeId>]` suffix, the
 * `YYYY-MM-DD` prefix its downloads and the common convention both use, and the title between them.
 */
export function parsePodcastFileNameHints(fileName: string): PodcastFileNameHints {
  const stem = basename(fileName, extname(fileName));
  const idMatch = ID_SUFFIX_PATTERN.exec(stem);
  const withoutId = idMatch ? stem.slice(0, idMatch.index) : stem;
  const episodeId = idMatch ? safeId(idMatch[1]!) : null;

  const dateMatch = FILE_NAME_DATE_PATTERN.exec(withoutId);
  const publishedAt = dateMatch ? parseCalendarDate(dateMatch[1]!, dateMatch[2]!, dateMatch[3]!) : null;
  const remainder = dateMatch ? withoutId.slice(dateMatch[0].length) : withoutId;
  const title = remainder
    .trim()
    .replace(/^[-_.\s]+/, '')
    .trim();

  return { publishedAt, episodeId, title: title.length > 0 ? title.slice(0, MAX_TEXT_LENGTH) : null };
}

/** The `<Show title> [<podcastId>]` folder BookOrbit's own downloads live in. */
export function parsePodcastFolderId(folderName: string): number | null {
  const match = ID_SUFFIX_PATTERN.exec(folderName);
  return match ? safeId(match[1]!) : null;
}

function safeId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * A filename carries a calendar date, not an instant. Anchoring it at UTC midnight made every zone
 * west of Greenwich render the day before, so `2024-02-01 - Episode.mp3` read as Jan 31 across the
 * Americas. Midday leaves twelve hours of slack either side, which covers every zone from UTC-12 to
 * UTC+11; the far-eastern offsets past UTC+12 still land on the following day, and no single instant
 * can satisfy both ends at once.
 */
function parseCalendarDate(year: string, month: string, day: string): Date | null {
  const parsed = new Date(`${year}-${month}-${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // `new Date` rolls 2024-02-31 forward into March rather than rejecting it, so the parsed parts
  // are compared back against the text before the date is trusted.
  const matches = parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() + 1 === Number(month) && parsed.getUTCDate() === Number(day);
  return matches ? parsed : null;
}
