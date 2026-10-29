import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import { isAudioFormat, type AudiobookChapter, type AudiobookChapterSource } from '@bookorbit/types';

import { compareAudioTracks } from './book-media.utils';
import { naturalCompare } from './natural-sort.utils';

type ChapterTrackRow = { absolutePath: string; format: string | null; durationSeconds: number | null; sortOrder?: number | null };

type RevisionFileRow = { publicId: string; sizeBytes: number | null; durationSeconds: number | null; mtime: Date | null; updatedAt: Date };

/** Sources an automated pass may clear or re-derive, because the files themselves produced them. */
const FILE_DERIVED_CHAPTER_SOURCES: ReadonlySet<AudiobookChapterSource> = new Set(['embedded', 'tracks']);

export function isFileDerivedChapterSource(source: AudiobookChapterSource | null | undefined): boolean {
  return source == null || FILE_DERIVED_CHAPTER_SOURCES.has(source);
}

/**
 * The chapter list a book serves before cleanup: the stored list, or one chapter per track when
 * nothing is stored and every track length is known. The manifest revision hashes exactly this,
 * so its output must stay what earlier releases computed.
 */
export function resolveStoredAudiobookChapters(
  stored: AudiobookChapter[] | null | undefined,
  fileRows: readonly ChapterTrackRow[],
): AudiobookChapter[] | null {
  if (stored && stored.length > 0) return stored;

  const audioFiles = fileRows
    .filter((f) => f.format && isAudioFormat(f.format))
    .sort((a, b) => naturalCompare(basename(a.absolutePath), basename(b.absolutePath)))
    .sort(compareAudioTracks);
  if (audioFiles.length < 2) return stored ?? null;
  // Offsets past a track of unknown length would be wrong; clients fall back to one entry per track.
  if (audioFiles.some((f) => f.durationSeconds === null || f.durationSeconds <= 0)) return stored ?? null;

  const chapters: AudiobookChapter[] = [];
  let offsetMs = 0;
  for (const f of audioFiles) {
    const title = basename(f.absolutePath).replace(/\.[^.]+$/, '');
    chapters.push({ title, startMs: offsetMs });
    offsetMs += Math.round((f.durationSeconds ?? 0) * 1000);
  }
  return chapters;
}

/**
 * Cleans a chapter list for storage and for clients: whole non-negative milliseconds, ascending,
 * one chapter per start, and a title on every row. Released iOS rejects a list with an empty title
 * or a duplicate start (Watch transfer, offline snapshot) and mis-tracks an unsorted one. A missing
 * title becomes "Chapter N", the same fallback the iOS app uses for untitled embedded markers.
 */
export function normalizeAudiobookChapters(chapters: readonly unknown[]): AudiobookChapter[] {
  const parsed: AudiobookChapter[] = [];
  for (const item of chapters) {
    if (!item || typeof item !== 'object') continue;
    const { title, startMs } = item as { title?: unknown; startMs?: unknown };
    if (typeof startMs !== 'number' || !Number.isFinite(startMs)) continue;
    parsed.push({ title: typeof title === 'string' ? title.trim() : '', startMs: Math.max(0, Math.round(startMs)) });
  }
  parsed.sort((left, right) => left.startMs - right.startMs);

  const unique: AudiobookChapter[] = [];
  for (const chapter of parsed) {
    const previous = unique[unique.length - 1];
    if (previous && previous.startMs === chapter.startMs) {
      if (!previous.title && chapter.title) previous.title = chapter.title;
      continue;
    }
    unique.push(chapter);
  }
  return unique.map((chapter, index) => (chapter.title ? chapter : { title: `Chapter ${index + 1}`, startMs: chapter.startMs }));
}

export function sameAudiobookChapters(left: readonly AudiobookChapter[] | null, right: readonly AudiobookChapter[] | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.length === right.length && left.every((chapter, index) => chapter.title === right[index]!.title && chapter.startMs === right[index]!.startMs)
  );
}

/** A book's audio tracks in playback order, as the manifest lists them. */
export function orderAudiobookTracks<T extends { format: string | null; sortOrder?: number | null; absolutePath: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.format !== null && isAudioFormat(row.format)).sort(compareAudioTracks);
}

/** Provenance columns for a chapter write; only a person's edit names who made it. */
export function chapterProvenance(
  chapters: readonly AudiobookChapter[] | null,
  source: AudiobookChapterSource,
  userId: number | null = null,
): { chaptersSource: AudiobookChapterSource | null; chaptersUpdatedAt: Date; chaptersUpdatedBy: number | null } {
  return {
    chaptersSource: chapters ? source : null,
    chaptersUpdatedAt: new Date(),
    chaptersUpdatedBy: chapters && source === 'manual' ? userId : null,
  };
}

/**
 * Identifies a manifest. Phones store this value with every download and send it back with each
 * playback write, so its inputs and their serialization must never change.
 */
export function computeAudiobookManifestRevision(files: readonly RevisionFileRow[], chapters: readonly unknown[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        files: files.map((file) => [file.publicId, file.sizeBytes, file.durationSeconds, file.mtime?.toISOString(), file.updatedAt.toISOString()]),
        chapters,
      }),
    )
    .digest('hex');
}

/**
 * Identifies where the audio sits: which tracks, in which order, and how long each is. A position
 * recorded against one manifest revision stays valid under any other revision with the same key.
 */
export function computeAudiobookPositionsKey(files: readonly Pick<RevisionFileRow, 'publicId' | 'durationSeconds'>[]): string {
  return createHash('sha256')
    .update(JSON.stringify(files.map((file) => [file.publicId, file.durationSeconds])))
    .digest('hex');
}

/** New revisions retain an opaque 64-character contract while identifying their audio layout. */
export function computeLayoutManifestRevision(files: readonly RevisionFileRow[], chapters: readonly unknown[]): string {
  return computeAudiobookPositionsKey(files).slice(0, 32) + computeAudiobookManifestRevision(files, chapters).slice(32);
}

/** One file's place in a write: where the editor's timeline puts it, and how long it really is. */
export interface ChapterSliceFile {
  id: number;
  timelineStartMs: number;
  /** Probed, not the whole seconds stored for the file, so no chapter is placed past its end. */
  actualDurationMs: number;
}

export interface FileChapterSpan {
  title: string;
  startMs: number;
  endMs: number;
  continuation?: boolean;
}

/**
 * Lays a book's chapters onto each of its files, on each file's own clock. A chapter is placed by
 * the same timeline the editor and the player use, so it lands in the file and at the offset the
 * player would seek to. Every file's list starts at 0: a file that opens partway through a chapter
 * gets a marker carrying that chapter's title, because a list starting later reads back as starting
 * at 0 in MP4 and would put the next title over the end of the previous chapter. A start that falls
 * past a file's real end, in the sliver its rounded length adds, moves to the start of the next file.
 */
export function sliceChaptersAcrossFiles(chapters: readonly AudiobookChapter[], files: readonly ChapterSliceFile[]): Map<number, FileChapterSpan[]> {
  const perFile: { title: string; startMs: number; continuation?: boolean }[][] = files.map(() => []);
  for (const chapter of [...chapters].sort((left, right) => left.startMs - right.startMs)) {
    let index = 0;
    while (index < files.length - 1 && files[index + 1]!.timelineStartMs <= chapter.startMs) index += 1;
    let local = Math.max(0, chapter.startMs - files[index]!.timelineStartMs);
    while (local >= files[index]!.actualDurationMs && index < files.length - 1) {
      index += 1;
      local = 0;
    }
    if (local >= files[index]!.actualDurationMs) continue;
    const list = perFile[index]!;
    // Two starts on the same spot, as when both fall in a rounding sliver: the later chapter wins.
    if (list.length > 0 && list[list.length - 1]!.startMs === local) list.pop();
    list.push({ title: chapter.title, startMs: local });
  }

  const result = new Map<number, FileChapterSpan[]>();
  let running: string | null = null;
  for (const [index, file] of files.entries()) {
    const list = perFile[index]!;
    if (index > 0 && running !== null && (list.length === 0 || list[0]!.startMs > 0))
      list.unshift({ title: running, startMs: 0, continuation: true });
    if (list.length > 0) running = list[list.length - 1]!.title;
    result.set(
      file.id,
      list
        .map((span, position) => ({ ...span, endMs: list[position + 1]?.startMs ?? file.actualDurationMs }))
        .filter((span) => span.endMs > span.startMs),
    );
  }
  return result;
}

export function computeChapterEditorRevision(
  state: { chapters: readonly AudiobookChapter[] | null; source: AudiobookChapterSource | null; updatedAt: Date | null } | null,
  rows: readonly {
    id: number;
    absolutePath: string;
    format: string | null;
    durationSeconds: number | null;
    sortOrder?: number | null;
    fileHash?: string | null;
  }[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        state?.chapters ?? null,
        state?.source ?? null,
        state?.updatedAt?.toISOString() ?? null,
        orderAudiobookTracks([...rows]).map((track) => [
          track.id,
          track.absolutePath,
          track.format,
          track.durationSeconds,
          track.sortOrder ?? null,
          track.fileHash ?? null,
        ]),
      ]),
    )
    .digest('hex');
}
