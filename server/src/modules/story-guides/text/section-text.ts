import { createHash } from 'crypto';

/**
 * The block selector, invisible characters and flattening of the app's reader index. Anchors only
 * land on the phone when these match it exactly, so change them only together with the readers
 * and the extraction version.
 */
export const BLOCK_SELECTOR = 'p, li, blockquote, dd, dt, td, th, figcaption, h1, h2, h3, h4, h5, h6, pre, div, section, article, aside';

const INVISIBLES = /[\u200B\u00AD\u2060\uFEFF]/g;
const WHITESPACE_RUNS = /\s+/g;

export function flattenSectionText(text: string): string {
  return text.replace(WHITESPACE_RUNS, ' ').replace(INVISIBLES, '').trim();
}

export function sectionHash(text: string): string {
  return createHash('sha256').update(flattenSectionText(text)).digest('hex').slice(0, 8);
}

interface TextNodeLike {
  nodeType: number;
  nodeValue: string | null;
  parentElement: ElementLike | null;
  firstChild: TextNodeLike | null;
  nextSibling: TextNodeLike | null;
  localName?: string;
}

interface ElementLike extends TextNodeLike {
  closest(selector: string): ElementLike | null;
}

interface DocumentLike {
  body: TextNodeLike | null;
  documentElement: (TextNodeLike & { childNodes: ArrayLike<TextNodeLike> }) | null;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function rootOf(doc: DocumentLike): TextNodeLike | null {
  if (doc.body) return doc.body;
  const html = doc.documentElement;
  if (!html) return null;
  const body = Array.from(html.childNodes).find((node) => node.nodeType === ELEMENT_NODE && node.localName === 'body');
  return body ?? html;
}

function* textNodes(node: TextNodeLike): Generator<TextNodeLike> {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === TEXT_NODE) {
      if (!child.parentElement?.closest('script, style')) yield child;
    } else if (child.nodeType === ELEMENT_NODE) {
      yield* textNodes(child);
    }
  }
}

/** A section document's raw text and block starts, as `storyRawText` in the app's reader computes them. */
export function rawSectionText(doc: DocumentLike): { text: string; blocks: number[] } {
  const root = rootOf(doc);
  const blocks: number[] = [];
  if (!root) return { text: '', blocks };
  const parts: string[] = [];
  let length = 0;
  let block: ElementLike | null = null;
  for (const node of textNodes(root)) {
    const value = node.nodeValue ?? '';
    if (!value) continue;
    const nodeBlock = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
    if (blocks.length === 0 || nodeBlock !== block) {
      blocks.push(length);
      block = nodeBlock;
    }
    parts.push(value);
    length += value.length;
  }
  return { text: parts.join(''), blocks };
}
