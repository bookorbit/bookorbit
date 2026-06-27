/**
 * EPUB CFI utilities over htmlparser2/cheerio DOM nodes, mirroring the vendored
 * foliate epubcfi.js (client/public/assets/foliate/epubcfi.js) exactly: same child
 * indexing model (virtual before/first/last/after, text chunks between elements),
 * same tokenizer/parser, same range building. Offsets are UTF-16 code units, as in
 * browser DOM ranges.
 */

export interface CfiPart {
  index: number;
  id?: string;
  offset?: number | null;
}

export interface CfiNode {
  type?: string;
  name?: string;
  attribs?: Record<string, string | undefined>;
  data?: string;
  parent?: CfiNode | null;
  children?: CfiNode[];
}

export interface RangePoint {
  node: CfiNode;
  offset: number;
}

export interface ResolvedCfiPoint {
  node: CfiNode | null;
  offset: number | null;
  before?: boolean;
  after?: boolean;
}

export interface ParsedCfiRange {
  spineStep: number | null;
  start: CfiPart[];
  end: CfiPart[];
}

const CFI_RE = /^epubcfi\((.*)\)$/;
const NUMBER_RE = /\d/;

export function isTextNode(node: CfiNode | null | undefined): boolean {
  return node?.type === 'text' || node?.type === 'cdata';
}

export function isElementNode(node: CfiNode | null | undefined): boolean {
  return node?.type === 'tag' || node?.type === 'script' || node?.type === 'style';
}

function escapeCfi(value: string): string {
  return value.replace(/[\^[\](),;=]/g, '^$&');
}

function wrapCfi(value: string): string {
  return CFI_RE.test(value) ? value : `epubcfi(${value})`;
}

function unwrapCfi(value: string): string {
  return value.match(CFI_RE)?.[1] ?? value;
}

function partToString(part: CfiPart): string {
  return `/${part.index}` + (part.id ? `[${escapeCfi(part.id)}]` : '') + (part.offset != null && part.index % 2 ? `:${part.offset}` : '');
}

function partsToString(parts: CfiPart[]): string {
  return parts.map(partToString).join('');
}

export function getDocumentElement(root: CfiNode): CfiNode | null {
  if (root.type === 'root') {
    return (root.children ?? []).find((child) => isElementNode(child)) ?? null;
  }
  let current = root;
  while (current.parent && current.parent.type !== 'root') {
    current = current.parent;
  }
  return current;
}

function getChildNodes(node: CfiNode): CfiNode[] {
  return (node.children ?? []).filter((child) => isTextNode(child) || isElementNode(child));
}

export type IndexedChild = CfiNode | CfiNode[] | null | 'before' | 'after' | 'first' | 'last';

function isIndexedElement(value: IndexedChild | undefined): value is CfiNode {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && isElementNode(value as CfiNode);
}

export function indexChildNodes(node: CfiNode): IndexedChild[] {
  const nodes = getChildNodes(node).reduce<IndexedChild[]>((arr, child) => {
    const last = arr[arr.length - 1];
    if (!last) {
      arr.push(child);
    } else if (isTextNode(child)) {
      if (Array.isArray(last)) last.push(child);
      else if (typeof last === 'object' && isTextNode(last)) arr[arr.length - 1] = [last, child];
      else arr.push(child);
    } else if (isIndexedElement(last)) {
      arr.push(null, child);
    } else {
      arr.push(child);
    }
    return arr;
  }, []);

  if (isIndexedElement(nodes[0])) nodes.unshift('first');
  if (isIndexedElement(nodes[nodes.length - 1])) nodes.push('last');
  nodes.unshift('before');
  nodes.push('after');
  return nodes;
}

function childMatches(indexed: IndexedChild, node: CfiNode): boolean {
  if (Array.isArray(indexed)) return indexed.includes(node);
  return indexed === node;
}

function nodeTextLength(node: CfiNode): number {
  return node.data?.length ?? 0;
}

export function nodeToParts(node: CfiNode, offset: number | null = null): CfiPart[] {
  const parent = node.parent;
  if (!parent) throw new Error('Cannot build CFI for node without parent');

  const indexed = indexChildNodes(parent);
  const index = indexed.findIndex((child) => childMatches(child, node));
  if (index < 0) throw new Error('Cannot locate node in parent CFI index');

  let adjustedOffset = offset;
  const chunk = indexed[index];
  if (Array.isArray(chunk) && offset != null) {
    let sum = 0;
    for (const child of chunk) {
      if (child === node) {
        sum += offset;
        break;
      }
      sum += nodeTextLength(child);
    }
    adjustedOffset = sum;
  }

  const part: CfiPart = { index };
  const id = node.attribs?.id;
  if (id) part.id = id;
  if (adjustedOffset != null) part.offset = adjustedOffset;

  const documentElement = getDocumentElement(node);
  return parent !== documentElement && parent.type !== 'root' ? nodeToParts(parent).concat(part) : [part];
}

function buildRange(from: CfiPart[], to: CfiPart[]): string {
  const parent: CfiPart[] = [];
  const start: CfiPart[] = [];
  const end: CfiPart[] = [];
  let pushToParent = true;
  const len = Math.max(from.length, to.length);

  for (let index = 0; index < len; index += 1) {
    const a = from[index];
    const b = to[index];
    pushToParent &&= a?.index === b?.index && !a?.offset && !b?.offset;
    if (pushToParent) {
      if (a) parent.push(a);
    } else {
      if (a) start.push(a);
      if (b) end.push(b);
    }
  }

  return wrapCfi(`${partsToString(parent)},${partsToString(start)},${partsToString(end)}`);
}

export function joinCfiIndirection(...parts: string[]): string {
  return wrapCfi(parts.map(unwrapCfi).join('!'));
}

export function spineCfiForChapterIndex(chapterIndex: number): string {
  return wrapCfi(`/6/${(chapterIndex + 1) * 2}`);
}

export function cfiFromRangePoints(start: RangePoint, end: RangePoint): string {
  const startParts = nodeToParts(start.node, start.offset);
  const endParts = nodeToParts(end.node, end.offset);
  return buildRange(startParts, endParts);
}

export function cfiFromPoint(point: RangePoint): string {
  return wrapCfi(partsToString(nodeToParts(point.node, point.offset)));
}

export function findElementById(root: CfiNode, id: string): CfiNode | null {
  if (isElementNode(root) && root.attribs?.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findElementById(child, id);
    if (found) return found;
  }
  return null;
}

type Token = [string, string | number | null];

function tokenize(str: string): Token[] {
  const tokens: Token[] = [];
  let state: string | null = null;
  let escape = false;
  let value = '';
  const push = (token: Token) => {
    tokens.push(token);
    state = null;
    value = '';
  };
  const cat = (char: string) => {
    value += char;
    escape = false;
  };
  for (const char of Array.from(str.trim()).concat('')) {
    if (char === '^' && !escape) {
      escape = true;
      continue;
    }
    if (state === '!') push(['!', null]);
    else if (state === ',') push([',', null]);
    else if (state === '/' || state === ':') {
      if (NUMBER_RE.test(char)) {
        cat(char);
        continue;
      } else push([state, parseInt(value, 10)]);
    } else if (state === '~') {
      if (NUMBER_RE.test(char) || char === '.') {
        cat(char);
        continue;
      } else push(['~', parseFloat(value)]);
    } else if (state === '@') {
      if (char === ':') {
        push(['@', parseFloat(value)]);
        state = '@';
        continue;
      }
      if (NUMBER_RE.test(char) || char === '.') {
        cat(char);
        continue;
      } else push(['@', parseFloat(value)]);
    } else if (state === '[') {
      if ((char === ';' || char === ',' || char === ']') && !escape) {
        push(['[', value]);
        if (char === ';') state = ';';
        if (char === ',') state = '[';
      } else {
        cat(char);
      }
      continue;
    } else if (state?.startsWith(';')) {
      if (char === ']' && !escape) push([state, value]);
      else cat(char);
      continue;
    }
    if (char === '/' || char === ':' || char === '~' || char === '@' || char === '[' || char === '!' || char === ',') state = char;
  }
  return tokens;
}

function parseParts(tokens: Token[]): CfiPart[] {
  const parts: CfiPart[] = [];
  let state: string | null = null;
  for (const [type, val] of tokens) {
    if (type === '/') {
      parts.push({ index: val as number });
    } else {
      const last = parts[parts.length - 1];
      if (!last) continue;
      if (type === ':') last.offset = val as number;
      else if (type === '[' && state === '/' && val) last.id = val as string;
    }
    state = type;
  }
  return parts;
}

function splitTokens(tokens: Token[], type: string): Token[][] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token[0] === type) {
      groups.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  groups.push(current);
  return groups;
}

/**
 * Parses a CFI string (plain or range) into spine step + doc-local start/end parts.
 * Range CFIs collapse like foliate: start = parent + start segment, end = parent + end.
 * The spine step is the index of the second part of the first indirection segment
 * (epubcfi(/6/12!...) -> 12); chapterIndex = step / 2 - 1.
 */
export function parseCfi(cfi: string): ParsedCfiRange | null {
  const tokens = tokenize(unwrapCfi(cfi));
  if (tokens.length === 0) return null;

  const commaGroups = splitTokens(tokens, ',');
  const parseIndirection = (group: Token[]): CfiPart[][] => splitTokens(group, '!').map(parseParts);

  let startSegments: CfiPart[][];
  let endSegments: CfiPart[][];
  if (commaGroups.length === 3) {
    const [parent, start, end] = commaGroups.map(parseIndirection);
    const concat = (tail: CfiPart[][]): CfiPart[][] => {
      const merged = parent.map((segment) => [...segment]);
      merged[merged.length - 1] = merged[merged.length - 1].concat(tail[0] ?? []);
      return merged.concat(tail.slice(1));
    };
    startSegments = concat(start);
    endSegments = concat(end);
  } else if (commaGroups.length === 1) {
    startSegments = parseIndirection(commaGroups[0]);
    endSegments = startSegments;
  } else {
    return null;
  }

  const spineStep = startSegments.length > 1 ? (startSegments[0][1]?.index ?? null) : null;
  return {
    spineStep,
    start: startSegments[startSegments.length - 1],
    end: endSegments[endSegments.length - 1],
  };
}

export function chapterIndexFromSpineStep(spineStep: number | null): number | null {
  if (spineStep == null || spineStep % 2 !== 0 || spineStep < 2) return null;
  return spineStep / 2 - 1;
}

/**
 * Resolves doc-local CFI parts against a chapter document, foliate partsToNode style.
 * Returns the concrete text node and UTF-16 offset within it for text positions, or
 * the element for element positions.
 */
export function resolveCfiParts(root: CfiNode, parts: CfiPart[]): ResolvedCfiPoint | null {
  if (parts.length === 0) return null;
  const documentElement = getDocumentElement(root);
  if (!documentElement) return null;

  const lastId = parts[parts.length - 1].id;
  if (lastId) {
    const byId = findElementById(documentElement, lastId);
    if (byId) return { node: byId, offset: 0 };
  }

  let node: IndexedChild | undefined = documentElement;
  for (const { index } of parts) {
    const next: IndexedChild | undefined = node && typeof node === 'object' && !Array.isArray(node) ? indexChildNodes(node)[index] : undefined;
    if (next === 'first') return { node: (node as CfiNode).children?.[0] ?? (node as CfiNode), offset: null };
    if (next === 'last') {
      const children = (node as CfiNode).children ?? [];
      return { node: children[children.length - 1] ?? (node as CfiNode), offset: null };
    }
    if (next === 'before') return { node: node as CfiNode, offset: null, before: true };
    if (next === 'after') return { node: node as CfiNode, offset: null, after: true };
    node = next;
  }

  const offset = parts[parts.length - 1].offset ?? null;
  if (node == null) return null;
  if (!Array.isArray(node)) {
    return { node, offset };
  }

  let sum = 0;
  const target = offset ?? 0;
  for (const part of node) {
    const length = nodeTextLength(part);
    if (sum + length >= target) return { node: part, offset: target - sum };
    sum += length;
  }
  const lastNode = node[node.length - 1];
  return lastNode ? { node: lastNode, offset: nodeTextLength(lastNode) } : null;
}
