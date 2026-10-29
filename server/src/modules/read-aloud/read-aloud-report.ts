import type {
  ReadAloudChapterDecision,
  ReadAloudChapterReport,
  ReadAloudChapterStatus,
  ReadAloudNarrationCoverage,
  ReadAloudReportSummary,
  ReadAloudWarningCode,
} from '@bookorbit/types';
import { READ_ALOUD_OUTSIDE_TITLES_SHOWN, readAloudChapterLabel } from '@bookorbit/types';

const SUMMARY_KEYS: (keyof ReadAloudReportSummary)[] = [
  'sentences',
  'matchedSentences',
  'interpolatedSentences',
  'unmatchedSentences',
  'droppedSentences',
  'seconds',
  'matchedSeconds',
  'interpolatedSeconds',
  'looseSeconds',
  'tracks',
  'unalignedTracks',
];
const CHAPTER_STATUSES = new Set<ReadAloudChapterStatus>(['aligned', 'not-found', 'too-short', 'excluded', 'audio-only']);
const DECISIONS = new Set<ReadAloudChapterDecision>(['excluded', 'included', 'approved']);
const ZONES = new Set(['front', 'body', 'back']);
const SNIPPET_LIMIT = 280;
const TITLE_LIMIT = 200;
const MAX_CHAPTERS = 2_000;
/** A chapter this long that mostly matched shows the narration really reaches that part of the book. */
const ANCHOR_MIN_SENTENCES = 20;
const ANCHOR_MIN_COVERED = 0.5;
/** Past this share of the book, unmatched edges point at the wrong audiobook, not front and back matter. */
const OUTSIDE_MAX_SHARE = 0.25;

export class InvalidReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReportError';
  }
}

export type ParsedReport = {
  totals: ReadAloudReportSummary;
  chapters: ReadAloudChapterReport[];
};

/** Reads STAlign's report v4: totals are required, chapters are trimmed to what the review table shows. */
export function parseAlignmentReport(raw: string): ParsedReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidReportError('The alignment report is not valid JSON');
  }
  if (!isRecord(parsed)) throw new InvalidReportError('The alignment report is not an object');
  if (parsed.version !== undefined && parsed.version !== 4)
    throw new InvalidReportError(`Unsupported alignment report version ${typeof parsed.version === 'number' ? parsed.version : 'unknown'}`);
  return { totals: parseTotals(parsed.totals), chapters: parseChapters(parsed.spine) };
}

/**
 * Judges the text the narration covers, not the whole EPUB. An audiobook starts at the first chapter
 * and ends at the last: the copyright page, contents, acknowledgments and a bonus excerpt of another
 * book are never read, and counting them flagged cleanly aligned books.
 */
export function reportWarnings(
  totals: ReadAloudReportSummary,
  coverage: ReadAloudNarrationCoverage | null,
): { warnings: ReadAloudWarningCode[]; requiresReview: boolean } {
  const sentences = coverage ? coverage.storySentences : totals.sentences;
  const unmatched = coverage ? coverage.storyUnmatchedSentences : totals.unmatchedSentences;
  const base = Math.max(1, sentences);
  const warnings: ReadAloudWarningCode[] = [];
  if (totals.unalignedTracks > 0) warnings.push('unaligned_tracks');
  if (unmatched / base > 0.05) warnings.push('unmatched_text');
  if (totals.interpolatedSentences / base > 0.2) warnings.push('interpolated_text');
  if (totals.droppedSentences / base > 0.02) warnings.push('dropped_text');
  const requiresReview = totals.matchedSentences === 0 || totals.unalignedTracks > 0 || unmatched / base > 0.1;
  return { warnings, requiresReview };
}

/**
 * Marks the chapters outside the narration and measures the text inside it. The narration runs from
 * the first to the last chapter that clearly matched; unmatched front or back matter beyond those
 * is outside it. Unmatched text between them is a real gap and stays in the story count. Without a
 * chapter list (an older report) there is nothing to measure, and the totals stand as they are.
 */
export function assessCoverage(
  totals: ReadAloudReportSummary,
  chapters: ReadAloudChapterReport[],
): { coverage: ReadAloudNarrationCoverage | null; chapters: ReadAloudChapterReport[] } {
  if (chapters.length === 0) return { coverage: null, chapters };
  const covered = (chapter: ReadAloudChapterReport) => chapter.matchedSentenceCount + chapter.interpolatedSentenceCount;
  const unmatched = (chapter: ReadAloudChapterReport) => Math.max(0, chapter.sentenceCount - covered(chapter) - chapter.droppedSentenceCount);
  const anchors = chapters.flatMap((chapter, position) =>
    chapter.status === 'aligned' && chapter.sentenceCount >= ANCHOR_MIN_SENTENCES && covered(chapter) / chapter.sentenceCount >= ANCHOR_MIN_COVERED
      ? [position]
      : [],
  );
  const first = anchors[0];
  const last = anchors.at(-1);
  let outside = new Set<number>();
  if (first !== undefined && last !== undefined) {
    chapters.forEach((chapter, position) => {
      const atEdge = (position < first && chapter.zone === 'front') || (position > last && chapter.zone === 'back');
      if (atEdge && chapter.status !== 'excluded' && chapter.status !== 'audio-only' && unmatched(chapter) > 0) outside.add(position);
    });
  }
  let outsideSentences = [...outside].reduce((total, position) => total + unmatched(chapters[position]!), 0);
  if (outsideSentences > totals.sentences * OUTSIDE_MAX_SHARE) {
    outside = new Set();
    outsideSentences = 0;
  }
  const marked = chapters.map((chapter, position) => ({ ...chapter, outsideNarration: outside.has(position) }));
  const outsideChapters = marked.filter((chapter) => chapter.outsideNarration);
  return {
    chapters: marked,
    coverage: {
      storySentences: Math.max(0, totals.sentences - outsideSentences),
      storyUnmatchedSentences: Math.max(0, totals.unmatchedSentences - outsideSentences),
      outsideSentences,
      outsideChapterCount: outsideChapters.length,
      outsideTitles: outsideChapters.slice(0, READ_ALOUD_OUTSIDE_TITLES_SHOWN).map(readAloudChapterLabel),
    },
  };
}

function parseTotals(value: unknown): ReadAloudReportSummary {
  if (!isRecord(value)) throw new InvalidReportError('The alignment report has no totals');
  const totals = {} as ReadAloudReportSummary;
  for (const key of SUMMARY_KEYS) {
    const number = value[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
      throw new InvalidReportError(`The alignment report total "${key}" is invalid`);
    }
    totals[key] = number;
  }
  return totals;
}

function parseChapters(value: unknown): ReadAloudChapterReport[] {
  if (!Array.isArray(value)) return [];
  const chapters: ReadAloudChapterReport[] = [];
  for (const item of value.slice(0, MAX_CHAPTERS)) {
    if (!isRecord(item) || typeof item.href !== 'string') continue;
    const status = CHAPTER_STATUSES.has(item.status as ReadAloudChapterStatus) ? (item.status as ReadAloudChapterStatus) : null;
    if (!status) continue;
    const classification = isRecord(item.classification) ? item.classification : null;
    chapters.push({
      index: count(item.index),
      href: item.href.slice(0, 500),
      title: text(item.title, TITLE_LIMIT),
      zone: classification && ZONES.has(classification.zone as string) ? (classification.zone as 'front' | 'body' | 'back') : null,
      status,
      decision: DECISIONS.has(item.decision as ReadAloudChapterDecision) ? (item.decision as ReadAloudChapterDecision) : null,
      sentenceCount: count(item.sentenceCount),
      matchedSentenceCount: count(item.matchedSentenceCount),
      interpolatedSentenceCount: count(item.interpolatedSentenceCount),
      droppedSentenceCount: count(item.droppedSentenceCount),
      matchedSeconds: count(item.matchedSeconds),
      score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : null,
      preview: text(item.preview, SNIPPET_LIMIT),
      firstMatch: isRecord(item.firstMatch) ? text(item.firstMatch.matchedSentence, SNIPPET_LIMIT) : null,
      lastMatch: isRecord(item.lastMatch) ? text(item.lastMatch.matchedSentence, SNIPPET_LIMIT) : null,
      outsideNarration: false,
    });
  }
  return chapters;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
