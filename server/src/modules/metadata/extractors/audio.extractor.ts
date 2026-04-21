import { open } from 'fs/promises';

import mediaInfoFactory from 'mediainfo.js';
import * as mm from 'music-metadata';

import type { AudiobookChapter } from '@bookorbit/types';

export interface AudioExtractResult {
  title: string | null;
  authors: { name: string; sortName: string | null }[];
  narrators: string[];
  publisher: string | null;
  publishedYear: number | null;
  description: string | null;
  language: string | null;
  durationSeconds: number | null;
  chapters: AudiobookChapter[];
  coverBytes: Buffer | null;
}

export async function extractAudioMetadata(absolutePath: string): Promise<AudioExtractResult> {
  try {
    const metadata = await mm.parseFile(absolutePath, {
      duration: true,
      skipCovers: false,
      includeChapters: true,
    });
    const { common, format } = metadata;

    // albumartist = book author, artist = narrator.
    // If only artist is set, it is the author.
    const rawAlbumArtist = common.albumartist;
    const rawArtists = common.artists ?? (common.artist ? [common.artist] : []);

    const authors = rawAlbumArtist ? splitArtists(rawAlbumArtist) : rawArtists.flatMap(splitArtists);

    const narrators = rawAlbumArtist ? rawArtists.flatMap(splitArtists) : [];

    // Album tag is the book title for audiobooks; fall back to track title.
    const title = common.album ?? common.title ?? null;

    const publisher = common.label?.[0] ?? null;
    const publishedYear = common.year ?? null;
    const description = extractCommentText(common.comment as unknown);
    const language = common.language ?? null;

    const durationSeconds = format.duration !== undefined ? Math.round(format.duration) : null;

    // music-metadata fails to read M4B chapter tracks reliably (iterates chunks not samples).
    // Try mediainfo first; fall back to music-metadata's chapter data.
    let chapters: AudiobookChapter[] = await extractChaptersWithMediainfo(absolutePath);
    if (chapters.length === 0) {
      chapters = (format.chapters ?? [])
        .filter((ch) => ch.sampleOffset != null || ch.start != null)
        .map((ch) => {
          const startSec = ch.sampleOffset != null ? ch.sampleOffset / (format.sampleRate ?? 44100) : ch.start;
          return { title: ch.title, startMs: Math.round(startSec * 1000) };
        });
    }

    let coverBytes: Buffer | null = null;
    const picture = common.picture?.[0];
    if (picture?.data) {
      coverBytes = Buffer.from(picture.data);
    }

    return {
      title,
      authors: authors.map((name) => ({ name, sortName: null })),
      narrators,
      publisher,
      publishedYear,
      description,
      language,
      durationSeconds,
      chapters,
      coverBytes,
    };
  } catch {
    return {
      title: null,
      authors: [],
      narrators: [],
      publisher: null,
      publishedYear: null,
      description: null,
      language: null,
      durationSeconds: null,
      chapters: [],
      coverBytes: null,
    };
  }
}

export async function parseAudioDuration(absolutePath: string): Promise<number | null> {
  try {
    const metadata = await mm.parseFile(absolutePath, { duration: true, skipCovers: true });
    if (metadata.format.duration === undefined) return null;
    return Math.round(metadata.format.duration);
  } catch {
    return null;
  }
}

async function extractChaptersWithMediainfo(absolutePath: string): Promise<AudiobookChapter[]> {
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
  const mi = await mediaInfoFactory({ format: 'object' });
  try {
    fileHandle = await open(absolutePath, 'r');
    const { size } = await fileHandle.stat();
    const readChunk = async (chunkSize: number, offset: number): Promise<Uint8Array> => {
      const buf = new Uint8Array(chunkSize);
      await fileHandle!.read(buf, 0, chunkSize, offset);
      return buf;
    };
    const result = await mi.analyzeData(() => size, readChunk);
    const menus = (result.media?.track ?? []).filter((t) => t['@type'] === 'Menu' && t.extra);
    const extra = menus.flatMap((t) => Object.entries(t.extra as Record<string, string>));
    return extra
      .filter(([key]) => /^_\d{2}_\d{2}_\d{2}_\d{3}$/.test(key))
      .map(([key, title]) => ({ title, startMs: parseMediainfoTimestamp(key) }))
      .sort((a, b) => a.startMs - b.startMs);
  } catch {
    return [];
  } finally {
    await fileHandle?.close();
    mi.close();
  }
}

function parseMediainfoTimestamp(key: string): number {
  // Key format: _HH_MM_SS_mmm (e.g. _00_13_24_850 = 13 min 24 sec 850 ms)
  const [h, m, s, ms] = key.replace(/^_/, '').split('_').map(Number);
  return h * 3_600_000 + m * 60_000 + s * 1_000 + ms;
}

function splitArtists(raw: string): string[] {
  return raw
    .split(/[;/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractCommentText(rawComments: unknown): string | null {
  if (!Array.isArray(rawComments)) return null;

  for (const comment of rawComments) {
    if (typeof comment === 'string' && comment.trim().length > 0) {
      return comment;
    }

    if (typeof comment === 'object' && comment !== null && 'text' in comment && typeof comment.text === 'string' && comment.text.trim().length > 0) {
      return comment.text;
    }
  }

  return null;
}
