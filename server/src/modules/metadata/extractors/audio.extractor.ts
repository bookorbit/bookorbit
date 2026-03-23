import * as mm from 'music-metadata';

import type { AudiobookChapter } from '@projectx/types';

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

    const sampleRate = format.sampleRate ?? 44100;
    const chapters: AudiobookChapter[] = (format.chapters ?? [])
      .filter((ch) => ch.sampleOffset != null)
      .map((ch) => ({
        title: ch.title,
        startMs: Math.round((ch.sampleOffset! / sampleRate) * 1000),
      }));

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
