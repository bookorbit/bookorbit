import { basename } from 'path';

import type { AudiobookChapter } from '@bookorbit/types';

export interface AudioChapterSource {
  absolutePath: string;
  chapters: AudiobookChapter[];
  durationMs: number | null;
}

// Per-file lengths are stored rounded to whole seconds, so offsets derived from them drift from the
// exact millisecond offsets a merge writes. A second of slack per file keeps a freshly merged list
// from reading as short and being rebuilt on every scan.
const COVERAGE_SLACK_MS_PER_FILE = 1000;

/**
 * Builds one chapter list for an audiobook split across several files.
 *
 * Each file embeds its own chapters starting at zero, but playback is the files concatenated in
 * natural order, so every file's chapters shift by the combined length of the files before it.
 * Sources must already be in playback order.
 *
 * Returns an empty list when no file carries chapters, leaving the per-file fallback in charge, and
 * null when a length is missing for a file that others follow, because every later offset would be
 * wrong; callers keep the stored chapters instead.
 */
export function mergeAudioChapters(sources: AudioChapterSource[]): AudiobookChapter[] | null {
  if (sources.every((source) => source.chapters.length === 0)) return [];

  const merged: AudiobookChapter[] = [];
  let offsetMs = 0;

  for (const [index, source] of sources.entries()) {
    const isLast = index === sources.length - 1;
    if (source.durationMs === null && !isLast) return null;

    const ordered = source.chapters.filter((chapter) => chapter.startMs >= 0).sort((a, b) => a.startMs - b.startMs);

    if (ordered.length > 0) {
      for (const chapter of ordered) {
        merged.push({ title: chapter.title, startMs: offsetMs + chapter.startMs });
      }
    } else {
      // A file with no chapters of its own still gets one, so the previous file's last chapter ends
      // where this file starts instead of swallowing it.
      merged.push({ title: fileStem(source.absolutePath), startMs: offsetMs });
    }

    offsetMs += source.durationMs ?? 0;
  }

  return merged;
}

/**
 * Answers whether a stored chapter list describes the whole of a multi-file audiobook.
 *
 * A list extracted from a single file stops at that file, leaving the rest of the book with no
 * chapters of its own. Catching that is what lets a book scanned before chapters were merged be
 * rebuilt once, without re-probing every audiobook on every scan.
 *
 * Durations must be in playback order. Says yes whenever it cannot tell: an empty list belongs to
 * the per-file fallback, and an unknown length makes the last file's start unknowable.
 */
export function chaptersReachLastFile(chapters: AudiobookChapter[], orderedDurationsMs: (number | null)[]): boolean {
  if (orderedDurationsMs.length < 2) return true;
  if (chapters.length === 0) return true;

  const leadingDurations = orderedDurationsMs.slice(0, -1);
  if (leadingDurations.some((duration) => duration === null)) return true;

  const lastFileStartMs = leadingDurations.reduce((total: number, duration) => total + duration!, 0);
  const slackMs = COVERAGE_SLACK_MS_PER_FILE * leadingDurations.length;
  return chapters.some((chapter) => chapter.startMs >= lastFileStartMs - slackMs);
}

function fileStem(absolutePath: string): string {
  return basename(absolutePath).replace(/\.[^.]+$/, '');
}
