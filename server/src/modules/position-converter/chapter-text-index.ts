/**
 * Collapsed-text index over a chapter DOM, approximating how crengine builds its
 * text nodes (whitespace runs collapse to single spaces, leading whitespace after
 * block boundaries drops). Every collapsed CODE POINT maps back to its raw text
 * node + UTF-16 offset, so positions can be translated between:
 * - crengine xpointer offsets (code points in the collapsed view of a text run)
 * - browser/CFI offsets (UTF-16 code units in the raw text nodes)
 * Synthetic separators are inserted between blocks for search quality; they map to
 * no raw position and are skipped when resolving range endpoints.
 */

import { CfiNode, getDocumentElement, isElementNode, isTextNode } from './cfi.utils';

const BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const WHITESPACE_RE = /\s/;

export interface TextRun {
  parts: { node: CfiNode; rawLength: number }[];
  parent: CfiNode;
  runIndex: number;
  runCount: number;
  collapsedStart: number;
  collapsedLength: number;
}

export interface RawPoint {
  node: CfiNode;
  offset: number;
}

export interface SearchMatch {
  startCp: number;
  endCp: number;
  distance: number | null;
}

interface BuildState {
  collapsedPoints: string[];
  runByPoint: number[];
  rawOffsetByPoint: number[];
  atBoundary: boolean;
  lastWasSpace: boolean;
  separatorPending: boolean;
}

export function normalizeForSearch(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export class ChapterTextIndex {
  readonly collapsed: string;
  readonly collapsedCpLength: number;
  readonly runs: TextRun[];

  private readonly runByPoint: Int32Array;
  private readonly rawOffsetByPoint: Int32Array;
  private readonly cpByUtf16: Int32Array;
  private readonly runsByParent = new Map<CfiNode, TextRun[]>();
  private readonly runInfoByNode = new Map<CfiNode, { run: TextRun; rawStart: number }>();

  constructor(root: CfiNode) {
    const state: BuildState = {
      collapsedPoints: [],
      runByPoint: [],
      rawOffsetByPoint: [],
      atBoundary: true,
      lastWasSpace: false,
      separatorPending: false,
    };
    const runs: TextRun[] = [];

    const documentElement = getDocumentElement(root);
    const body =
      (documentElement?.children ?? []).find((child): child is CfiNode => isElementNode(child) && (child.name ?? '').toLowerCase() === 'body') ??
      documentElement;
    if (body) this.walkElement(body, state, runs);

    this.runs = runs;
    this.collapsed = state.collapsedPoints.join('');
    this.collapsedCpLength = state.collapsedPoints.length;
    this.runByPoint = Int32Array.from(state.runByPoint);
    this.rawOffsetByPoint = Int32Array.from(state.rawOffsetByPoint);

    this.cpByUtf16 = new Int32Array(this.collapsed.length + 1);
    let utf16 = 0;
    for (let cp = 0; cp < state.collapsedPoints.length; cp += 1) {
      const len = state.collapsedPoints[cp].length;
      for (let k = 0; k < len; k += 1) this.cpByUtf16[utf16 + k] = cp;
      utf16 += len;
    }
    this.cpByUtf16[this.collapsed.length] = state.collapsedPoints.length;

    for (const run of runs) {
      const list = this.runsByParent.get(run.parent) ?? [];
      list.push(run);
      this.runsByParent.set(run.parent, list);
    }
    for (const [, list] of this.runsByParent) {
      for (let i = 0; i < list.length; i += 1) {
        list[i].runIndex = i + 1;
        list[i].runCount = list.length;
      }
    }
  }

  private walkElement(element: CfiNode, state: BuildState, runs: TextRun[]): void {
    const children = element.children ?? [];
    let i = 0;
    while (i < children.length) {
      const child = children[i];
      if (isTextNode(child)) {
        const parts: CfiNode[] = [];
        while (i < children.length && isTextNode(children[i])) {
          parts.push(children[i]);
          i += 1;
        }
        this.emitRun(parts, element, state, runs);
        continue;
      }
      if (isElementNode(child)) {
        const isBlock = BLOCK_ELEMENTS.has((child.name ?? '').toLowerCase());
        if (isBlock) {
          state.atBoundary = true;
          state.separatorPending = state.collapsedPoints.length > 0;
        }
        this.walkElement(child, state, runs);
        if (isBlock) {
          state.atBoundary = true;
          state.separatorPending = state.collapsedPoints.length > 0;
        }
      }
      i += 1;
    }
  }

  private emitRun(partNodes: CfiNode[], parent: CfiNode, state: BuildState, runs: TextRun[]): void {
    const run: TextRun = {
      parts: partNodes.map((node) => ({ node, rawLength: node.data?.length ?? 0 })),
      parent,
      runIndex: 0,
      runCount: 0,
      collapsedStart: state.collapsedPoints.length,
      collapsedLength: 0,
    };
    const runIdx = runs.length;
    let emittedAny = false;
    let rawConcatOffset = 0;

    for (const part of run.parts) {
      this.runInfoByNode.set(part.node, { run, rawStart: rawConcatOffset });
      const raw = part.node.data ?? '';
      for (const cp of raw) {
        if (WHITESPACE_RE.test(cp)) {
          if (!state.atBoundary && !state.lastWasSpace) {
            state.collapsedPoints.push(' ');
            state.runByPoint.push(runIdx);
            state.rawOffsetByPoint.push(rawConcatOffset);
            state.lastWasSpace = true;
            if (!emittedAny) {
              run.collapsedStart = state.collapsedPoints.length - 1;
              emittedAny = true;
            }
          }
        } else {
          if (state.separatorPending) {
            state.collapsedPoints.push(' ');
            state.runByPoint.push(-1);
            state.rawOffsetByPoint.push(-1);
            state.separatorPending = false;
          }
          if (!emittedAny) {
            run.collapsedStart = state.collapsedPoints.length;
            emittedAny = true;
          }
          state.collapsedPoints.push(cp);
          state.runByPoint.push(runIdx);
          state.rawOffsetByPoint.push(rawConcatOffset);
          state.atBoundary = false;
          state.lastWasSpace = false;
        }
        rawConcatOffset += cp.length;
      }
    }

    run.collapsedLength = emittedAny ? state.collapsedPoints.length - run.collapsedStart : 0;
    runs.push(run);
  }

  runsOfParent(element: CfiNode): TextRun[] {
    return this.runsByParent.get(element) ?? [];
  }

  /** First text run inside the element (any depth), for chapter/element-level hints. */
  firstRunWithin(element: CfiNode): TextRun | null {
    if (isTextNode(element)) {
      return this.runInfoByNode.get(element)?.run ?? null;
    }
    for (const child of element.children ?? []) {
      const found = this.firstRunWithin(child);
      if (found) return found;
    }
    return null;
  }

  runOfTextNode(node: CfiNode): TextRun | null {
    return this.runInfoByNode.get(node)?.run ?? null;
  }

  collapsedForRunOffset(run: TextRun, cpOffset: number): number {
    return run.collapsedStart + Math.max(0, Math.min(cpOffset, run.collapsedLength));
  }

  /** Inclusive start point: resolves the collapsed cp index to (raw text node, UTF-16 offset). */
  startPointFromCollapsed(cpIndex: number): RawPoint | null {
    let i = Math.max(0, Math.min(cpIndex, this.collapsedCpLength - 1));
    while (i < this.collapsedCpLength && this.runByPoint[i] < 0) i += 1;
    if (i >= this.collapsedCpLength) return null;
    return this.rawPointAt(i);
  }

  /** Exclusive end point: maps to just after the last collapsed cp of the range. */
  endPointFromCollapsed(cpIndexExclusive: number): RawPoint | null {
    let i = Math.min(cpIndexExclusive, this.collapsedCpLength) - 1;
    while (i >= 0 && this.runByPoint[i] < 0) i -= 1;
    if (i < 0) return null;
    const point = this.rawPointAt(i);
    if (!point) return null;
    const cpLength = String.fromCodePoint(this.collapsed.codePointAt(this.utf16IndexOfCp(i)) ?? 32).length;
    return { node: point.node, offset: point.offset + cpLength };
  }

  private utf16IndexOfCp(cpIndex: number): number {
    // cpByUtf16 is monotonic; binary search the first utf16 index mapping to cpIndex.
    let lo = 0;
    let hi = this.collapsed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cpByUtf16[mid] < cpIndex) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private rawPointAt(cpIndex: number): RawPoint | null {
    const runIdx = this.runByPoint[cpIndex];
    if (runIdx < 0) return null;
    const run = this.runs[runIdx];
    let rawOffset = this.rawOffsetByPoint[cpIndex];
    for (const part of run.parts) {
      if (rawOffset <= part.rawLength) {
        if (rawOffset === part.rawLength && part !== run.parts[run.parts.length - 1]) {
          rawOffset = 0;
          continue;
        }
        return { node: part.node, offset: rawOffset };
      }
      rawOffset -= part.rawLength;
    }
    return null;
  }

  /** Maps a raw (text node, UTF-16 offset) to the collapsed cp index at or after it. */
  collapsedFromNodePoint(node: CfiNode, utf16Offset: number): number | null {
    const info = this.runInfoByNode.get(node);
    if (!info) return null;
    const { run, rawStart } = info;
    const target = rawStart + utf16Offset;
    const startIdx = run.collapsedStart;
    const endIdx = run.collapsedStart + run.collapsedLength;
    let lo = startIdx;
    let hi = endIdx;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.rawOffsetByPoint[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Run-relative crengine offset (code points) for a collapsed cp index. */
  runOffsetOfCollapsed(cpIndex: number, run: TextRun): number {
    return Math.max(0, Math.min(cpIndex, run.collapsedStart + run.collapsedLength) - run.collapsedStart);
  }

  runAtCollapsed(cpIndex: number, direction: 'forward' | 'backward' = 'forward'): TextRun | null {
    let i = Math.max(0, Math.min(cpIndex, this.collapsedCpLength - 1));
    if (direction === 'forward') {
      while (i < this.collapsedCpLength && this.runByPoint[i] < 0) i += 1;
      if (i >= this.collapsedCpLength) return null;
    } else {
      while (i >= 0 && this.runByPoint[i] < 0) i -= 1;
      if (i < 0) return null;
    }
    return this.runs[this.runByPoint[i]];
  }

  extractCollapsed(startCp: number, endCpExclusive: number): string {
    const startUtf16 = this.utf16IndexOfCp(Math.max(0, startCp));
    const endUtf16 = this.utf16IndexOfCp(Math.min(endCpExclusive, this.collapsedCpLength));
    return this.collapsed.slice(startUtf16, endUtf16);
  }

  /**
   * Whitespace-tolerant search of the normalized needle in the collapsed text.
   * Returns the match nearest to the hint (collapsed cp index), if any.
   */
  searchNormalized(needle: string, hintCp: number | null): SearchMatch | null {
    const normalized = normalizeForSearch(needle);
    if (!normalized) return null;
    const tokens = normalized.split(' ').map(escapeRegExp);
    let regex: RegExp;
    try {
      regex = new RegExp(tokens.join('\\s+'), 'g');
    } catch {
      return null;
    }

    let best: SearchMatch | null = null;
    for (const match of this.collapsed.matchAll(regex)) {
      const startCp = this.cpByUtf16[match.index];
      const endCp = this.cpByUtf16[match.index + match[0].length - 1] + 1;
      const distance = hintCp == null ? null : Math.abs(startCp - hintCp);
      const candidate: SearchMatch = { startCp, endCp, distance };
      if (!best) {
        best = candidate;
        if (hintCp == null) break;
      } else if (distance != null && best.distance != null && distance < best.distance) {
        best = candidate;
      }
    }
    return best;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
