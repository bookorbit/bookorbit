/**
 * Minimal element scanner for FB2 metadata blocks.
 *
 * The FB2 <description> is rewritten by splicing raw text, so the scanner
 * reports byte-accurate spans instead of building a document tree. Comments,
 * CDATA sections and processing instructions are skipped rather than parsed,
 * and quoted attribute values may contain '>' without ending a tag.
 */

export class Fb2StructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Fb2StructureError';
  }
}

export type Fb2Element = {
  name: string;
  /** Offset of '<' that opens the element. */
  start: number;
  /** Offset just past the element's closing tag. */
  end: number;
  /** Offset of the first content character, or -1 when self-closing. */
  contentStart: number;
  /** Offset of '<' that opens the closing tag, or -1 when self-closing. */
  contentEnd: number;
  selfClosing: boolean;
};

const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';
const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE = ']]>';
const PI_OPEN = '<?';
const PI_CLOSE = '?>';

/** Returns the offset of the '>' that closes the tag starting at tagStart. */
export function findTagEnd(text: string, tagStart: number): number {
  let quote: string | null = null;
  for (let i = tagStart + 1; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i;
  }
  throw new Fb2StructureError(`unterminated tag at offset ${tagStart}`);
}

function skipNonElement(text: string, at: number): number | null {
  if (text.startsWith(COMMENT_OPEN, at)) {
    const close = text.indexOf(COMMENT_CLOSE, at + COMMENT_OPEN.length);
    if (close < 0) throw new Fb2StructureError('unterminated comment');
    return close + COMMENT_CLOSE.length;
  }
  if (text.startsWith(CDATA_OPEN, at)) {
    const close = text.indexOf(CDATA_CLOSE, at + CDATA_OPEN.length);
    if (close < 0) throw new Fb2StructureError('unterminated CDATA section');
    return close + CDATA_CLOSE.length;
  }
  if (text.startsWith(PI_OPEN, at)) {
    const close = text.indexOf(PI_CLOSE, at + PI_OPEN.length);
    if (close < 0) throw new Fb2StructureError('unterminated processing instruction');
    return close + PI_CLOSE.length;
  }
  return null;
}

function tagNameAt(text: string, tagStart: number): string {
  const rest = text.slice(tagStart + 1);
  const boundary = /[\s/>]/.exec(rest)?.index ?? -1;
  return boundary < 0 ? '' : rest.slice(0, boundary);
}

/** Returns the offset of '<' opening the tag that closes the element named `name`. */
export function findElementClose(text: string, name: string, contentStart: number): number {
  let depth = 1;
  let cursor = contentStart;
  for (;;) {
    const open = text.indexOf('<', cursor);
    if (open < 0) throw new Fb2StructureError(`unclosed <${name}>`);

    const skipped = skipNonElement(text, open);
    if (skipped !== null) {
      cursor = skipped;
      continue;
    }

    const tagEnd = findTagEnd(text, open);
    if (text.startsWith('</', open)) {
      if (text.slice(open + 2, tagEnd).trim() === name) {
        depth--;
        if (depth === 0) return open;
      }
    } else if (tagNameAt(text, open) === name && text[tagEnd - 1] !== '/') {
      depth++;
    }
    cursor = tagEnd + 1;
  }
}

/** Lists the element children between `from` and `to`, in document order. */
export function scanChildElements(text: string, from: number, to: number): Fb2Element[] {
  const children: Fb2Element[] = [];
  let cursor = from;

  while (cursor < to) {
    const open = text.indexOf('<', cursor);
    if (open < 0 || open >= to) break;

    const skipped = skipNonElement(text, open);
    if (skipped !== null) {
      cursor = skipped;
      continue;
    }
    if (text.startsWith('</', open)) break;

    const name = tagNameAt(text, open);
    if (!name) throw new Fb2StructureError(`malformed tag at offset ${open}`);

    const tagEnd = findTagEnd(text, open);
    if (text[tagEnd - 1] === '/') {
      children.push({ name, start: open, end: tagEnd + 1, contentStart: -1, contentEnd: -1, selfClosing: true });
      cursor = tagEnd + 1;
      continue;
    }

    const contentStart = tagEnd + 1;
    const contentEnd = findElementClose(text, name, contentStart);
    const end = findTagEnd(text, contentEnd) + 1;
    children.push({ name, start: open, end, contentStart, contentEnd, selfClosing: false });
    cursor = end;
  }

  return children;
}

/** Locates the first element named `name` at or after `from`. */
export function locateElement(text: string, name: string, from = 0): Fb2Element | null {
  const pattern = new RegExp(`<${name}(?=[\\s/>])`);
  const match = pattern.exec(text.slice(from));
  if (!match) return null;

  const start = from + match.index;
  const tagEnd = findTagEnd(text, start);
  if (text[tagEnd - 1] === '/') {
    return { name, start, end: tagEnd + 1, contentStart: -1, contentEnd: -1, selfClosing: true };
  }

  const contentStart = tagEnd + 1;
  const contentEnd = findElementClose(text, name, contentStart);
  return { name, start, end: findTagEnd(text, contentEnd) + 1, contentStart, contentEnd, selfClosing: false };
}

/** Reads an attribute value from a start tag, tolerating either quote style. */
export function readAttribute(startTag: string, attributeName: string): string | null {
  const escaped = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = startTag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

export function elementText(text: string, element: Fb2Element): string {
  return text.slice(element.start, element.end);
}

export function startTagOf(text: string, element: Fb2Element): string {
  return text.slice(element.start, findTagEnd(text, element.start) + 1);
}
