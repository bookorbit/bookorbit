/**
 * Pure conversion core between KOReader XPointer ranges and EPUB CFI ranges over a
 * parsed chapter document. Structure resolves positions, but the stored highlight
 * text is the truth: every conversion is verified by extracting the resolved range
 * and comparing normalized text, with search-based re-anchoring as repair.
 */

import * as cheerio from 'cheerio';

import { ChapterTextIndex, normalizeForSearch, TextRun } from './chapter-text-index';
import {
  CfiNode,
  ResolvedCfiPoint,
  cfiFromPoint,
  cfiFromRangePoints,
  isTextNode,
  joinCfiIndirection,
  parseCfi,
  resolveCfiParts,
  spineCfiForChapterIndex,
} from './cfi.utils';
import { buildXPointer, parseXPointer, resolveXPointerElement } from './xpointer.utils';

export const CONVERTER_VERSION = 1;

/** KOReader sidecar text is truncated at 10000 chars; treat near-limit text as a prefix. */
const TRUNCATED_TEXT_THRESHOLD = 9990;
const EXACT_HINT_TOLERANCE_CP = 2;

export interface ChapterDocument {
  root: CfiNode;
  index: ChapterTextIndex;
}

export interface ConversionSuccess {
  status: 'exact' | 'repaired';
  pos0: string;
  pos1: string | null;
}

export interface ConversionFailure {
  status: 'failed';
  reason: string;
}

export type ConversionResult = ConversionSuccess | ConversionFailure;

export function parseChapterDocument(xhtml: string): ChapterDocument {
  const $ = cheerio.load(xhtml, { xml: true });
  const root = $.root()[0] as unknown as CfiNode;
  return { root, index: new ChapterTextIndex(root) };
}

interface StructuralAnchor {
  cp: number;
  resolved: boolean;
}

function xpointerAnchor(doc: ChapterDocument, pos: string, exclusiveEnd: boolean): StructuralAnchor | null {
  const parsed = parseXPointer(pos);
  if (!parsed) return null;
  const element = resolveXPointerElement(doc.root, parsed.steps);
  if (!element) return null;

  const directRuns = doc.index.runsOfParent(element);
  const run: TextRun | null = (parsed.textIndex != null ? directRuns[parsed.textIndex - 1] : null) ?? doc.index.firstRunWithin(element);
  if (!run) return null;

  if (parsed.offset == null) {
    return { cp: exclusiveEnd ? run.collapsedStart + run.collapsedLength : run.collapsedStart, resolved: false };
  }
  const withinRange = parsed.offset <= run.collapsedLength;
  return { cp: doc.index.collapsedForRunOffset(run, parsed.offset), resolved: withinRange };
}

/**
 * Converts a KOReader xpointer range to a foliate range CFI.
 * The returned pos0 carries the full range CFI; pos1 is always null.
 */
export function xpointerRangeToCfi(
  doc: ChapterDocument,
  chapterIndex: number,
  pos0: string,
  pos1: string | null,
  text: string | null,
): ConversionResult {
  const p0 = parseXPointer(pos0);
  if (!p0) return { status: 'failed', reason: 'unparsable_pos0' };
  if (p0.docFragmentIndex !== chapterIndex + 1) return { status: 'failed', reason: 'fragment_mismatch' };
  const p1 = pos1 ? parseXPointer(pos1) : null;
  if (pos1 && !p1) return { status: 'failed', reason: 'unparsable_pos1' };
  if (p1 && p1.docFragmentIndex !== p0.docFragmentIndex) return { status: 'failed', reason: 'cross_fragment_range' };

  const anchor0 = xpointerAnchor(doc, pos0, false);
  const anchor1 = pos1 ? xpointerAnchor(doc, pos1, true) : null;

  let startCp: number | null;
  let endCp: number | null;
  let status: 'exact' | 'repaired';

  const normalizedText = text ? normalizeForSearch(text) : '';
  if (normalizedText) {
    const truncated = text!.length >= TRUNCATED_TEXT_THRESHOLD;
    const match = doc.index.searchNormalized(normalizedText, anchor0?.cp ?? null);
    if (match) {
      startCp = match.startCp;
      endCp = truncated && anchor1 ? anchor1.cp : match.endCp;
      const startAgrees = anchor0 != null && anchor0.resolved && Math.abs(match.startCp - anchor0.cp) <= EXACT_HINT_TOLERANCE_CP;
      status = startAgrees && (!truncated || (anchor1?.resolved ?? false)) ? 'exact' : 'repaired';
    } else if (anchor0 && anchor1) {
      startCp = anchor0.cp;
      endCp = anchor1.cp;
      const extracted = doc.index.extractCollapsed(startCp, endCp);
      if (normalizeForSearch(extracted) !== normalizedText) return { status: 'failed', reason: 'text_mismatch' };
      status = 'exact';
    } else {
      return { status: 'failed', reason: 'text_not_found' };
    }
  } else {
    if (!anchor0 || !anchor1) return { status: 'failed', reason: 'unresolvable_structure' };
    startCp = anchor0.cp;
    endCp = anchor1.cp;
    status = anchor0.resolved && anchor1.resolved ? 'exact' : 'repaired';
  }

  if (startCp == null || endCp == null || endCp <= startCp) return { status: 'failed', reason: 'empty_range' };

  const cfi = collapsedRangeToCfi(doc, chapterIndex, startCp, endCp);
  if (!cfi) return { status: 'failed', reason: 'cfi_generation_failed' };
  return { status, pos0: cfi, pos1: null };
}

/** Builds a full range CFI (with spine indirection) from a collapsed cp range. */
export function collapsedRangeToCfi(doc: ChapterDocument, chapterIndex: number, startCp: number, endCp: number): string | null {
  const startPoint = doc.index.startPointFromCollapsed(startCp);
  const endPoint = doc.index.endPointFromCollapsed(endCp);
  if (!startPoint || !endPoint) return null;
  try {
    const localCfi = cfiFromRangePoints(startPoint, endPoint);
    return joinCfiIndirection(spineCfiForChapterIndex(chapterIndex), localCfi);
  } catch {
    return null;
  }
}

/** Builds a full point CFI (with spine indirection) from a collapsed cp index. */
export function collapsedPointToCfi(doc: ChapterDocument, chapterIndex: number, cp: number): string | null {
  const point = doc.index.startPointFromCollapsed(cp);
  if (!point) return null;
  try {
    return joinCfiIndirection(spineCfiForChapterIndex(chapterIndex), cfiFromPoint(point));
  } catch {
    return null;
  }
}

/** Builds a point xpointer from a collapsed cp index. */
export function collapsedPointToXPointer(doc: ChapterDocument, chapterIndex: number, cp: number): string | null {
  const run = doc.index.runAtCollapsed(cp, 'forward') ?? doc.index.runAtCollapsed(cp, 'backward');
  if (!run) return null;
  return buildXPointer(run.parent, chapterIndex + 1, run.runIndex, run.runCount, doc.index.runOffsetOfCollapsed(cp, run));
}

/** Resolves a point xpointer to its collapsed cp index (null when structure is unresolvable). */
export function xpointerPointToCollapsed(doc: ChapterDocument, pos: string): number | null {
  return xpointerAnchor(doc, pos, false)?.cp ?? null;
}

function cfiPointToCollapsed(doc: ChapterDocument, point: ResolvedCfiPoint | null, exclusiveEnd: boolean): number | null {
  if (!point?.node) return null;
  if (isTextNode(point.node)) {
    return doc.index.collapsedFromNodePoint(point.node, point.offset ?? 0);
  }
  const run = doc.index.firstRunWithin(point.node);
  if (!run) return null;
  if (exclusiveEnd) {
    const last = lastRunWithin(doc, point.node) ?? run;
    return last.collapsedStart + last.collapsedLength;
  }
  return run.collapsedStart;
}

function lastRunWithin(doc: ChapterDocument, element: CfiNode): TextRun | null {
  if (isTextNode(element)) return doc.index.runOfTextNode(element);
  const children = element.children ?? [];
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const found = lastRunWithin(doc, children[i]);
    if (found) return found;
  }
  return null;
}

export interface XPointerPair {
  status: 'exact' | 'repaired';
  pos0: string;
  pos1: string;
}

export type CfiToXPointerResult = XPointerPair | ConversionFailure;

export interface CollapsedRange {
  startCp: number;
  endCp: number;
}

/** Structurally resolves a range (or point) CFI to its collapsed cp range, without text repair. */
export function cfiRangeToCollapsed(doc: ChapterDocument, cfi: string): CollapsedRange | null {
  const parsed = parseCfi(cfi);
  if (!parsed) return null;
  const startResolved = resolveCfiParts(doc.root, parsed.start);
  const endResolved = resolveCfiParts(doc.root, parsed.end);
  const startCp = cfiPointToCollapsed(doc, startResolved, false);
  const endCp = cfiPointToCollapsed(doc, endResolved, true);
  if (startCp == null || endCp == null || endCp <= startCp) return null;
  return { startCp, endCp };
}

/** Structurally resolves a point CFI (or range start) to its collapsed cp index. */
export function cfiPointToCollapsedCp(doc: ChapterDocument, cfi: string): number | null {
  const parsed = parseCfi(cfi);
  if (!parsed) return null;
  const startResolved = resolveCfiParts(doc.root, parsed.start);
  return cfiPointToCollapsed(doc, startResolved, false);
}

/** Builds an xpointer pair from a collapsed cp range. */
export function collapsedRangeToXPointerPair(
  doc: ChapterDocument,
  chapterIndex: number,
  startCp: number,
  endCp: number,
): { pos0: string; pos1: string } | null {
  const startRun = doc.index.runAtCollapsed(startCp, 'forward');
  const endRun = doc.index.runAtCollapsed(endCp - 1, 'backward');
  if (!startRun || !endRun) return null;

  const docFragmentIndex = chapterIndex + 1;
  const pos0 = buildXPointer(
    startRun.parent,
    docFragmentIndex,
    startRun.runIndex,
    startRun.runCount,
    doc.index.runOffsetOfCollapsed(startCp, startRun),
  );
  const pos1 = buildXPointer(endRun.parent, docFragmentIndex, endRun.runIndex, endRun.runCount, doc.index.runOffsetOfCollapsed(endCp, endRun));
  if (!pos0 || !pos1) return null;
  return { pos0, pos1 };
}

/** Converts a foliate range CFI (doc-local parts already split by caller) to xpointers. */
export function cfiRangeToXPointer(doc: ChapterDocument, chapterIndex: number, cfi: string, text: string | null): CfiToXPointerResult {
  const parsed = parseCfi(cfi);
  if (!parsed) return { status: 'failed', reason: 'unparsable_cfi' };

  const startResolved = resolveCfiParts(doc.root, parsed.start);
  const endResolved = resolveCfiParts(doc.root, parsed.end);
  let startCp = cfiPointToCollapsed(doc, startResolved, false);
  let endCp = cfiPointToCollapsed(doc, endResolved, true);
  const structuralOk = startCp != null && endCp != null && endCp > startCp;

  let status: 'exact' | 'repaired' = 'repaired';
  const normalizedText = text ? normalizeForSearch(text) : '';
  if (normalizedText) {
    const extracted = structuralOk ? doc.index.extractCollapsed(startCp!, endCp!) : '';
    if (structuralOk && normalizeForSearch(extracted) === normalizedText) {
      status = 'exact';
    } else {
      const match = doc.index.searchNormalized(normalizedText, startCp);
      if (match) {
        startCp = match.startCp;
        endCp = match.endCp;
        status = 'repaired';
      } else if (!structuralOk) {
        return { status: 'failed', reason: 'text_not_found' };
      }
    }
  } else if (!structuralOk) {
    return { status: 'failed', reason: 'unresolvable_structure' };
  } else {
    status = 'exact';
  }

  if (startCp == null || endCp == null || endCp <= startCp) return { status: 'failed', reason: 'empty_range' };

  const pair = collapsedRangeToXPointerPair(doc, chapterIndex, startCp, endCp);
  if (!pair) return { status: 'failed', reason: 'xpointer_generation_failed' };

  return { status, pos0: pair.pos0, pos1: pair.pos1 };
}
