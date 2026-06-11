/**
 * crengine XPointer utilities (KOReader EPUB positions), matching lvtinydom's
 * toStringV2 serialization: /body/DocFragment[N]/body/.../p[k]/text()[t].offset
 * - element steps are 1-based among SAME-NAME element siblings; [k] is emitted
 *   only when more than one same-named sibling exists
 * - text() steps are 1-based among text-node children; [t] only when more than one
 * - offsets count Unicode CODE POINTS in crengine's (whitespace-collapsed) text node
 */

import { CfiNode, getDocumentElement, isElementNode, isTextNode } from './cfi.utils';

export interface XPointerStep {
  name: string;
  index: number;
}

export interface ParsedXPointer {
  docFragmentIndex: number;
  steps: XPointerStep[];
  textIndex: number | null;
  offset: number | null;
}

const XPOINTER_RE = /^\/body\/DocFragment(?:\[(\d+)\])?(.*)$/;
const STEP_RE = /^([A-Za-z][\w:-]*)(?:\[(\d+)\])?$/;
const TEXT_STEP_RE = /^text\(\)(?:\[(\d+)\])?$/;

export function parseXPointer(raw: string): ParsedXPointer | null {
  if (!raw) return null;
  const match = XPOINTER_RE.exec(raw.trim());
  if (!match) return null;
  const docFragmentIndex = match[1] ? parseInt(match[1], 10) : 1;

  let rest = match[2] ?? '';
  let offset: number | null = null;
  const offsetMatch = /\.(\d+)$/.exec(rest);
  if (offsetMatch) {
    offset = parseInt(offsetMatch[1], 10);
    rest = rest.slice(0, -offsetMatch[0].length);
  }

  const steps: XPointerStep[] = [];
  let textIndex: number | null = null;
  for (const segment of rest.split('/')) {
    if (!segment) continue;
    const textMatch = TEXT_STEP_RE.exec(segment);
    if (textMatch) {
      textIndex = textMatch[1] ? parseInt(textMatch[1], 10) : 1;
      continue;
    }
    if (textIndex != null) return null;
    const stepMatch = STEP_RE.exec(segment);
    if (!stepMatch) return null;
    steps.push({ name: stepMatch[1], index: stepMatch[2] ? parseInt(stepMatch[2], 10) : 1 });
  }

  if (offset != null && textIndex == null) {
    // crengine can emit element-level offsets (rare); treat as first text node.
    textIndex = 1;
  }

  return { docFragmentIndex, steps, textIndex, offset };
}

/**
 * Resolves the element path of a parsed xpointer against a chapter document.
 * The first step (usually "body") is resolved among the document element's children,
 * mirroring crengine's DocFragment > body nesting.
 */
export function resolveXPointerElement(root: CfiNode, steps: XPointerStep[]): CfiNode | null {
  const documentElement = getDocumentElement(root);
  if (!documentElement) return null;
  let current: CfiNode = documentElement;

  for (const step of steps) {
    const children = (current.children ?? []).filter(
      (child): child is CfiNode => isElementNode(child) && (child.name ?? '').toLowerCase() === step.name.toLowerCase(),
    );
    const next = children[step.index - 1];
    if (!next) return null;
    current = next;
  }
  return current;
}

function sameNameElementIndex(element: CfiNode): { index: number; count: number } {
  const name = (element.name ?? '').toLowerCase();
  const siblings = (element.parent?.children ?? []).filter(
    (child): child is CfiNode => isElementNode(child) && (child.name ?? '').toLowerCase() === name,
  );
  return { index: siblings.indexOf(element) + 1, count: siblings.length };
}

/**
 * Serializes the path from the chapter's document element down to the given element,
 * crengine style. The document element itself (html) is not part of the path; the
 * first emitted step is its child (body).
 */
export function buildXPointerPath(element: CfiNode, docFragmentIndex: number): string | null {
  const documentElement = getDocumentElement(element);
  if (!documentElement) return null;

  const segments: string[] = [];
  let current: CfiNode | null = element;
  while (current && current !== documentElement) {
    if (!isElementNode(current)) return null;
    const { index, count } = sameNameElementIndex(current);
    if (index === 0) return null;
    const name = current.name ?? '';
    segments.unshift(count > 1 ? `${name}[${index}]` : name);
    current = current.parent ?? null;
  }
  if (current !== documentElement) return null;

  return `/body/DocFragment[${docFragmentIndex}]/${segments.join('/')}`;
}

export function buildXPointer(
  element: CfiNode,
  docFragmentIndex: number,
  textIndex: number | null,
  textNodeCount: number,
  offset: number | null,
): string | null {
  const path = buildXPointerPath(element, docFragmentIndex);
  if (!path) return null;
  if (textIndex == null) return path;
  const textStep = textNodeCount > 1 ? `text()[${textIndex}]` : 'text()';
  const suffix = offset != null ? `.${offset}` : '';
  return `${path}/${textStep}${suffix}`;
}

/** Text-node children of an element, in document order (crengine text node candidates). */
export function elementTextNodes(element: CfiNode): CfiNode[] {
  return (element.children ?? []).filter((child) => isTextNode(child));
}
