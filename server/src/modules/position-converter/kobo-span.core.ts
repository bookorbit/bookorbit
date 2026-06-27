/**
 * Kobo kepub span codec core. Kobo positions reference the koboSpan wrappers
 * (<span class="koboSpan" id="kobo.N.M">) that kepubify inserts around sentences;
 * char offsets count UTF-16 code units into the span's concatenated descendant text
 * (Kobo firmware walks raw text nodes). BookOrbit converts epub -> kepub without
 * text-altering options, so the collapsed text of a kepub chapter equals the original
 * epub chapter's; ranges bridge between the two DOMs through collapsed cp indexes.
 * Structure resolves positions, but the stored highlight text is the truth: results
 * are verified by extraction and re-anchored by search, like the xpointer codec.
 */

import { ChapterTextIndex, normalizeForSearch } from './chapter-text-index';
import { CfiNode, isElementNode, isTextNode } from './cfi.utils';
import {
  ChapterDocument,
  CollapsedRange,
  ConversionFailure,
  cfiPointToCollapsedCp,
  cfiRangeToCollapsed,
  collapsedPointToCfi,
  collapsedPointToXPointer,
  collapsedRangeToCfi,
  collapsedRangeToXPointerPair,
} from './position-converter.core';

export const KOBO_SPAN_RESOLVER_VERSION = 1;

const KOBO_SPAN_ID_RE = /^kobo\.\d+\.\d+$/;

export interface KoboSpanRange {
  startId: string;
  startChar: number;
  endId: string;
  endChar: number;
}

export interface KoboSpanEntry {
  id: string;
  element: CfiNode;
  textNodes: CfiNode[];
  utf16Length: number;
  collapsedStart: number;
  collapsedEnd: number;
  /** True when the anchor was borrowed from a neighbor (textless span, e.g. an image). */
  synthetic: boolean;
}

export interface KoboSpanIndex {
  /** Spans that own collapsed text, ordered by collapsedStart. */
  ordered: KoboSpanEntry[];
  byId: Map<string, KoboSpanEntry>;
}

/** Extracts the span id from a Kobo selector path like "span#kobo\.3\.2". */
export function parseSpanSelector(path: string): string | null {
  const hashIndex = path.lastIndexOf('#');
  if (hashIndex < 0) return null;
  const raw = path
    .slice(hashIndex + 1)
    .trim()
    .split(/[\s>[/:]/)[0]
    ?.replace(/\\/g, '');
  return raw || null;
}

export function spanSelectorFromId(id: string): string {
  return `span#${id.replace(/\./g, '\\.')}`;
}

function isKoboSpanElement(node: CfiNode): boolean {
  if (!isElementNode(node) || (node.name ?? '').toLowerCase() !== 'span') return false;
  const className = node.attribs?.class ?? '';
  if (!/\bkoboSpan\b/.test(className)) return false;
  return KOBO_SPAN_ID_RE.test(node.attribs?.id ?? '');
}

function collectTextNodes(node: CfiNode, out: CfiNode[]): void {
  for (const child of node.children ?? []) {
    if (isTextNode(child)) out.push(child);
    else if (isElementNode(child)) collectTextNodes(child, out);
  }
}

export function buildKoboSpanIndex(doc: ChapterDocument): KoboSpanIndex {
  const entries: KoboSpanEntry[] = [];

  const walk = (node: CfiNode): void => {
    for (const child of node.children ?? []) {
      if (!isElementNode(child)) continue;
      if (isKoboSpanElement(child)) {
        const textNodes: CfiNode[] = [];
        collectTextNodes(child, textNodes);
        const first = textNodes[0];
        const last = textNodes[textNodes.length - 1];
        const start = first ? doc.index.collapsedFromNodePoint(first, 0) : null;
        const end = last ? doc.index.collapsedFromNodePoint(last, last.data?.length ?? 0) : null;
        const hasText = start != null && end != null && end > start;
        entries.push({
          id: child.attribs!.id!,
          element: child,
          textNodes,
          utf16Length: textNodes.reduce((sum, n) => sum + (n.data?.length ?? 0), 0),
          collapsedStart: hasText ? start : -1,
          collapsedEnd: hasText ? end : -1,
          synthetic: !hasText,
        });
      }
      walk(child);
    }
  };
  walk(doc.root);

  const ordered = entries.filter((entry) => !entry.synthetic).sort((a, b) => a.collapsedStart - b.collapsedStart);

  // Textless spans (image wrappers, collapsed whitespace) borrow the nearest
  // text-owning neighbor's anchor so point lookups still land somewhere sane.
  // entries and ordered share document order, so a single advancing cursor works.
  let lastSeen: KoboSpanEntry | null = null;
  let nextIdx = 0;
  for (const entry of entries) {
    if (!entry.synthetic) {
      lastSeen = entry;
      nextIdx += 1;
      continue;
    }
    const next = ordered[nextIdx] ?? null;
    const anchor = next ?? lastSeen;
    if (anchor) {
      entry.collapsedStart = next ? anchor.collapsedStart : anchor.collapsedEnd;
      entry.collapsedEnd = entry.collapsedStart;
    }
  }

  return { ordered, byId: new Map(entries.map((entry) => [entry.id, entry])) };
}

function spanText(span: KoboSpanEntry): string {
  return span.textNodes.map((node) => node.data ?? '').join('');
}

export function utf16OffsetForCodePointCount(text: string, count: number): number {
  let codePoints = 0;
  let utf16 = 0;
  for (const ch of text) {
    if (codePoints >= count) break;
    codePoints += 1;
    utf16 += ch.length;
  }
  return utf16;
}

interface SpanCollapsedPoint {
  cp: number;
  withinBounds: boolean;
}

/** Maps a Kobo char offset (UTF-16 units into the span's concatenated text) to a collapsed cp. */
export function spanCharToCollapsed(index: ChapterTextIndex, span: KoboSpanEntry, charUtf16: number): SpanCollapsedPoint | null {
  let remaining = Math.max(0, charUtf16);
  for (const node of span.textNodes) {
    const length = node.data?.length ?? 0;
    if (remaining <= length) {
      const cp = index.collapsedFromNodePoint(node, remaining);
      return cp == null ? null : { cp, withinBounds: charUtf16 >= 0 };
    }
    remaining -= length;
  }
  const last = span.textNodes[span.textNodes.length - 1];
  if (!last) return null;
  const cp = index.collapsedFromNodePoint(last, last.data?.length ?? 0);
  return cp == null ? null : { cp, withinBounds: false };
}

interface SpanCharPoint {
  spanId: string;
  char: number;
}

/** Maps a collapsed cp (kepub space) to the owning span and Kobo char offset, snapping into the nearest span. */
export function collapsedToSpanChar(index: ChapterTextIndex, spanIndex: KoboSpanIndex, cp: number, exclusiveEnd: boolean): SpanCharPoint | null {
  const spans = spanIndex.ordered;
  if (spans.length === 0) return null;

  let span: KoboSpanEntry;
  if (exclusiveEnd) {
    span = findLast(spans, (s) => s.collapsedStart < cp) ?? spans[0];
  } else {
    span = spans.find((s) => s.collapsedEnd > cp) ?? spans[spans.length - 1];
  }

  const clamped = Math.max(span.collapsedStart, Math.min(cp, span.collapsedEnd));
  const point = exclusiveEnd ? index.endPointFromCollapsed(clamped) : index.startPointFromCollapsed(clamped);
  if (!point) return null;

  let sum = 0;
  for (const node of span.textNodes) {
    if (node === point.node) return { spanId: span.id, char: Math.min(sum + point.offset, span.utf16Length) };
    sum += node.data?.length ?? 0;
  }
  return { spanId: span.id, char: exclusiveEnd ? span.utf16Length : 0 };
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) return items[i];
  }
  return null;
}

export interface KoboToCanonicalSuccess {
  status: 'exact' | 'repaired';
  cfi: string;
  xpointerPos0: string;
  xpointerPos1: string;
  startCp: number;
  endCp: number;
  aligned: boolean;
}

export type KoboToCanonicalResult = KoboToCanonicalSuccess | ConversionFailure;

export function koboSpanRangeToCanonical(
  epubDoc: ChapterDocument,
  kepubDoc: ChapterDocument,
  spanIndex: KoboSpanIndex,
  chapterIndex: number,
  range: KoboSpanRange,
  text: string | null,
): KoboToCanonicalResult {
  const aligned = kepubDoc.index.collapsed === epubDoc.index.collapsed;
  const normalizedText = text ? normalizeForSearch(text) : '';

  const emit = (startCp: number, endCp: number, status: 'exact' | 'repaired'): KoboToCanonicalResult => {
    const cfi = collapsedRangeToCfi(epubDoc, chapterIndex, startCp, endCp);
    const pair = collapsedRangeToXPointerPair(epubDoc, chapterIndex, startCp, endCp);
    if (!cfi || !pair) return { status: 'failed', reason: 'position_generation_failed' };
    return { status, cfi, xpointerPos0: pair.pos0, xpointerPos1: pair.pos1, startCp, endCp, aligned };
  };

  const startSpan = spanIndex.byId.get(range.startId) ?? null;
  const endSpan = spanIndex.byId.get(range.endId) ?? null;
  let structural: { startCp: number; endCp: number; withinBounds: boolean } | null = null;

  if (aligned && startSpan && endSpan && !startSpan.synthetic && !endSpan.synthetic) {
    const start = spanCharToCollapsed(kepubDoc.index, startSpan, range.startChar);
    const end = spanCharToCollapsed(kepubDoc.index, endSpan, range.endChar);
    if (start && end && end.cp > start.cp) {
      structural = { startCp: start.cp, endCp: end.cp, withinBounds: start.withinBounds && end.withinBounds };
    }
  }

  if (!normalizedText) {
    if (structural) return emit(structural.startCp, structural.endCp, structural.withinBounds ? 'exact' : 'repaired');
    return { status: 'failed', reason: aligned ? 'span_not_found' : 'kepub_text_mismatch' };
  }

  if (structural) {
    const extracted = epubDoc.index.extractCollapsed(structural.startCp, structural.endCp);
    if (normalizeForSearch(extracted) === normalizedText) return emit(structural.startCp, structural.endCp, 'exact');

    // Offset-unit ambiguity: retry interpreting char offsets as code points.
    const startRetry = spanCharToCollapsed(kepubDoc.index, startSpan!, utf16OffsetForCodePointCount(spanText(startSpan!), range.startChar));
    const endRetry = spanCharToCollapsed(kepubDoc.index, endSpan!, utf16OffsetForCodePointCount(spanText(endSpan!), range.endChar));
    if (startRetry && endRetry && endRetry.cp > startRetry.cp) {
      const retried = epubDoc.index.extractCollapsed(startRetry.cp, endRetry.cp);
      if (normalizeForSearch(retried) === normalizedText) return emit(startRetry.cp, endRetry.cp, 'exact');
    }
  }

  const hint = structural?.startCp ?? scaledHint(startSpan, kepubDoc.index, epubDoc.index);
  const match = epubDoc.index.searchNormalized(normalizedText, hint);
  if (match) return emit(match.startCp, match.endCp, 'repaired');

  if (!aligned) return { status: 'failed', reason: 'kepub_text_mismatch' };
  return { status: 'failed', reason: structural ? 'text_mismatch' : startSpan && endSpan ? 'text_not_found' : 'span_not_found' };
}

function scaledHint(span: KoboSpanEntry | null, from: ChapterTextIndex, to: ChapterTextIndex): number | null {
  if (!span || span.collapsedStart < 0 || from.collapsedCpLength === 0) return null;
  return Math.round((span.collapsedStart * to.collapsedCpLength) / from.collapsedCpLength);
}

export interface CanonicalToKoboSuccess {
  status: 'exact' | 'repaired';
  startId: string;
  startChar: number;
  endId: string;
  endChar: number;
  startCp: number;
  endCp: number;
  aligned: boolean;
}

export type CanonicalToKoboResult = CanonicalToKoboSuccess | ConversionFailure;

export function canonicalCfiToKoboSpan(
  epubDoc: ChapterDocument,
  kepubDoc: ChapterDocument,
  spanIndex: KoboSpanIndex,
  cfi: string,
  text: string | null,
): CanonicalToKoboResult {
  const aligned = kepubDoc.index.collapsed === epubDoc.index.collapsed;
  const normalizedText = text ? normalizeForSearch(text) : '';

  // Structural resolution against the epub DOM; legacy CFIs minted while the web
  // reader rendered kepubs resolve against the kepub DOM instead.
  let candidate: CollapsedRange | null = null;
  const fromEpub = cfiRangeToCollapsed(epubDoc, cfi);
  if (fromEpub && aligned) candidate = fromEpub;
  if (!candidate) candidate = cfiRangeToCollapsed(kepubDoc, cfi);

  let status: 'exact' | 'repaired' = 'exact';
  if (normalizedText) {
    const verified = candidate && normalizeForSearch(kepubDoc.index.extractCollapsed(candidate.startCp, candidate.endCp)) === normalizedText;
    if (!verified) {
      const match = kepubDoc.index.searchNormalized(normalizedText, candidate?.startCp ?? null);
      if (!match) return { status: 'failed', reason: candidate ? 'text_mismatch' : 'text_not_found' };
      candidate = { startCp: match.startCp, endCp: match.endCp };
      status = 'repaired';
    }
  } else if (!candidate) {
    return { status: 'failed', reason: 'unresolvable_structure' };
  }

  const start = collapsedToSpanChar(kepubDoc.index, spanIndex, candidate!.startCp, false);
  const end = collapsedToSpanChar(kepubDoc.index, spanIndex, candidate!.endCp, true);
  if (!start || !end) return { status: 'failed', reason: 'span_not_found' };

  return {
    status,
    startId: start.spanId,
    startChar: start.char,
    endId: end.spanId,
    endChar: end.char,
    startCp: candidate!.startCp,
    endCp: candidate!.endCp,
    aligned,
  };
}

export interface SpanPointToCanonicalSuccess {
  status: 'exact' | 'repaired';
  cfi: string;
  xpointer: string;
  cp: number;
  /** Position within the chapter's collapsed text, 0..1 (epub space). */
  chapterFraction: number;
}

export type SpanPointToCanonicalResult = SpanPointToCanonicalSuccess | ConversionFailure;

/** Converts a Kobo progress bookmark span id (no char offset) to canonical point positions. */
export function koboSpanPointToCanonical(
  epubDoc: ChapterDocument,
  kepubDoc: ChapterDocument,
  spanIndex: KoboSpanIndex,
  chapterIndex: number,
  spanId: string,
): SpanPointToCanonicalResult {
  const aligned = kepubDoc.index.collapsed === epubDoc.index.collapsed;
  const span = spanIndex.byId.get(spanId);
  if (!span || span.collapsedStart < 0) return { status: 'failed', reason: 'span_not_found' };

  let cp = span.collapsedStart;
  let status: 'exact' | 'repaired' = span.synthetic ? 'repaired' : 'exact';
  if (!aligned) {
    if (kepubDoc.index.collapsedCpLength === 0) return { status: 'failed', reason: 'kepub_text_mismatch' };
    cp = Math.round((cp * epubDoc.index.collapsedCpLength) / kepubDoc.index.collapsedCpLength);
    status = 'repaired';
  }
  cp = Math.max(0, Math.min(cp, Math.max(0, epubDoc.index.collapsedCpLength - 1)));

  const cfi = collapsedPointToCfi(epubDoc, chapterIndex, cp);
  const xpointer = collapsedPointToXPointer(epubDoc, chapterIndex, cp);
  if (!cfi || !xpointer) return { status: 'failed', reason: 'position_generation_failed' };

  const chapterFraction = epubDoc.index.collapsedCpLength > 0 ? cp / epubDoc.index.collapsedCpLength : 0;
  return { status, cfi, xpointer, cp, chapterFraction };
}

export interface CfiPointToSpanSuccess {
  status: 'exact' | 'repaired';
  spanId: string;
  /** Position within the chapter's collapsed text, 0..1 (kepub space). */
  chapterFraction: number;
}

export type CfiPointToSpanResult = CfiPointToSpanSuccess | ConversionFailure;

/** Converts a canonical point CFI to the nearest Kobo span id for a progress bookmark. */
export function cfiPointToKoboSpanPoint(
  epubDoc: ChapterDocument,
  kepubDoc: ChapterDocument,
  spanIndex: KoboSpanIndex,
  cfi: string,
): CfiPointToSpanResult {
  const aligned = kepubDoc.index.collapsed === epubDoc.index.collapsed;

  let cp: number | null = null;
  let status: 'exact' | 'repaired' = 'exact';
  const fromEpub = cfiPointToCollapsedCp(epubDoc, cfi);
  if (fromEpub != null) {
    if (aligned) {
      cp = fromEpub;
    } else if (epubDoc.index.collapsedCpLength > 0) {
      cp = Math.round((fromEpub * kepubDoc.index.collapsedCpLength) / epubDoc.index.collapsedCpLength);
      status = 'repaired';
    }
  }
  if (cp == null) {
    cp = cfiPointToCollapsedCp(kepubDoc, cfi);
    if (cp != null && !aligned) status = 'repaired';
  }
  if (cp == null) return { status: 'failed', reason: 'unresolvable_structure' };

  const spans = spanIndex.ordered;
  if (spans.length === 0) return { status: 'failed', reason: 'span_not_found' };
  const span = spans.find((s) => s.collapsedEnd > cp!) ?? spans[spans.length - 1];

  const chapterFraction = kepubDoc.index.collapsedCpLength > 0 ? Math.max(0, Math.min(1, cp / kepubDoc.index.collapsedCpLength)) : 0;
  return { status, spanId: span.id, chapterFraction };
}
