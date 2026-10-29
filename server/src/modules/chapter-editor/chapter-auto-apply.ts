import {
  AUDIOBOOK_CHAPTER_LIMITS,
  type AudiobookChapter,
  type ChapterLookupNode,
  type ChapterLookupResult,
  type ChapterLookupReviewReason,
} from '@bookorbit/types';

import { normalizeAudiobookChapters } from '../../common/utils/audiobook-chapters.utils';

/** How far the runtimes may differ for the timings to be taken as they are, without a stretch. */
const RUNTIME_TOLERANCE_MS = 2_000;
/** Chapters averaging shorter than this read as a list of tracks or sections, not chapters. */
const MIN_AVERAGE_CHAPTER_MS = 30_000;

export type AutoApplyPlan = { kind: 'apply'; chapters: AudiobookChapter[]; offsetMs: number } | { kind: 'review'; reason: ChapterLookupReviewReason };

/** Audible's tree as one list, part headings kept as chapters of their own, as the review sheet does by default. */
export function flattenLookupTree(nodes: readonly ChapterLookupNode[]): AudiobookChapter[] {
  return nodes.flatMap((node) => {
    const children = flattenLookupTree(node.children);
    if (children[0]?.startMs === node.startMs) {
      return [{ ...children[0], title: `${node.title}: ${children[0].title}` }, ...children.slice(1)];
    }
    return [{ title: node.title, startMs: node.startMs }, ...children];
  });
}

/**
 * Whether a lookup can be applied with nobody looking. Only when Audible calls its timings exact,
 * the book's length matches Audible's runtime either with its branding or without it, and the list
 * looks like chapters. Anything else is left for a person with the reason it stopped.
 */
export function planAutoApply(lookup: ChapterLookupResult, totalDurationMs: number | null): AutoApplyPlan {
  if (!totalDurationMs || totalDurationMs <= 0) return { kind: 'review', reason: 'unknown_length' };
  if (lookup.truncated) return { kind: 'review', reason: 'implausible' };
  if (lookup.isAccurate !== true) return { kind: 'review', reason: 'not_exact' };
  if (lookup.runtimeMs === null) return { kind: 'review', reason: 'runtime_mismatch' };

  const withoutBranding = lookup.runtimeMs - lookup.brandIntroMs - lookup.brandOutroMs;
  const strippedError = Math.abs(totalDurationMs - withoutBranding);
  const fullError = Math.abs(totalDurationMs - lookup.runtimeMs);
  if (Math.min(strippedError, fullError) > RUNTIME_TOLERANCE_MS) return { kind: 'review', reason: 'runtime_mismatch' };
  if (strippedError === fullError && lookup.brandIntroMs > 0) return { kind: 'review', reason: 'runtime_mismatch' };
  const offsetMs = strippedError < fullError ? -lookup.brandIntroMs : 0;

  const shifted = flattenLookupTree(lookup.chapters)
    .map((chapter) => ({ title: chapter.title.trim(), startMs: Math.max(0, Math.round(chapter.startMs + offsetMs)) }))
    .filter((chapter) => chapter.startMs < totalDurationMs);
  if (shifted.some((chapter) => !chapter.title || chapter.title.length > AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength))
    return { kind: 'review', reason: 'implausible' };
  // Judged after normalizing: chapters the shift clamps onto one start collapse into one.
  const chapters = normalizeAudiobookChapters(shifted);
  if (chapters.length < 2 || totalDurationMs / chapters.length < MIN_AVERAGE_CHAPTER_MS) return { kind: 'review', reason: 'implausible' };
  chapters[0] = { ...chapters[0]!, startMs: 0 };
  return { kind: 'apply', chapters, offsetMs };
}
