import { FB2_BOOK_FILE_WRITE_FIELDS } from '@bookorbit/types';

import { BOOKORBIT_NS_PREFIX } from '../shared/bookorbit-ns';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import {
  type Fb2Element,
  Fb2StructureError,
  elementText,
  findElementClose,
  findTagEnd,
  locateElement,
  scanChildElements,
  startTagOf,
} from './fb2-element-scanner';

/**
 * Child order required by the FB2 schema. Real-world files frequently deviate,
 * so the builder reads in any order and always emits in this one.
 */
const TITLE_INFO_ORDER = [
  'genre',
  'author',
  'book-title',
  'annotation',
  'keywords',
  'date',
  'coverpage',
  'lang',
  'src-lang',
  'translator',
  'sequence',
] as const;

const DESCRIPTION_ORDER = ['title-info', 'src-title-info', 'document-info', 'publish-info', 'custom-info', 'output'] as const;

const PUBLISH_INFO_ORDER = ['book-name', 'publisher', 'city', 'year', 'isbn', 'sequence'] as const;

/** Fields with no standard FB2 slot, carried in <custom-info info-type="bookorbit:*">. */
const CUSTOM_INFO_FIELDS = [
  'subtitle',
  'pageCount',
  'rating',
  'isbn10',
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'hardcoverEditionId',
  'openLibraryId',
  'ranobedbId',
  'koboId',
  'lubimyczytacId',
  'aladinId',
  'itunesId',
] as const satisfies readonly BookWritePayloadKey[];

const PUBLISH_INFO_FIELDS = ['publisher', 'publishedDate', 'publishedYear', 'isbn13'] as const satisfies readonly BookWritePayloadKey[];

const FB2_WRITABLE_FIELDS = new Set<BookWritePayloadKey>(FB2_BOOK_FILE_WRITE_FIELDS);
const CUSTOM_INFO_PREFIX = `${BOOKORBIT_NS_PREFIX}:`;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Fb2DescriptionBuild =
  | { status: 'built'; descriptionXml: string; fieldsWritten: BookWritePayloadKey[]; coverEntryId: string | null }
  | { status: 'skipped'; reason: string };

export type BuildFb2DescriptionOptions = {
  /** Namespace prefix bound to xlink in the source document, e.g. 'l' or 'xlink'. */
  xlinkPrefix: string;
  /** Binary id the coverpage must point at, or null to leave the coverpage alone. */
  coverEntryId?: string | null;
};

function escapeText(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string | number): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function splitAuthorName(
  name: string,
  sortName: string | null,
): {
  first: string | null;
  middle: string | null;
  last: string | null;
  nickname: string | null;
} {
  // "Last, First Middle" is the most reliable split we have; fall back to the
  // display name when no sort name was stored.
  if (sortName && sortName.includes(',')) {
    const commaAt = sortName.indexOf(',');
    const last = sortName.slice(0, commaAt).trim();
    const rest = sortName
      .slice(commaAt + 1)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (last) {
      return { first: rest[0] ?? null, middle: rest.slice(1).join(' ') || null, last, nickname: null };
    }
  }

  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, middle: null, last: null, nickname: null };
  if (parts.length === 1) return { first: null, middle: null, last: null, nickname: parts[0]! };
  return { first: parts[0]!, middle: parts.slice(1, -1).join(' ') || null, last: parts[parts.length - 1]!, nickname: null };
}

function buildAuthorElement(author: { name: string; sortName: string | null }, indent: string): string {
  const { first, middle, last, nickname } = splitAuthorName(author.name, author.sortName);
  const parts: string[] = [];
  if (first) parts.push(`<first-name>${escapeText(first)}</first-name>`);
  if (middle) parts.push(`<middle-name>${escapeText(middle)}</middle-name>`);
  if (last) parts.push(`<last-name>${escapeText(last)}</last-name>`);
  if (nickname) parts.push(`<nickname>${escapeText(nickname)}</nickname>`);
  return `${indent}<author>${parts.join('')}</author>`;
}

function buildAnnotationElement(description: string, indent: string): string | null {
  const paragraphs = description
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  return `${indent}<annotation>${paragraphs.map((paragraph) => `<p>${escapeText(paragraph)}</p>`).join('')}</annotation>`;
}

function resolveIndent(descriptionXml: string, firstChild: Fb2Element | undefined): string {
  if (!firstChild) return '  ';
  const lineStart = descriptionXml.lastIndexOf('\n', firstChild.start) + 1;
  const lead = descriptionXml.slice(lineStart, firstChild.start);
  return /^[ \t]+$/.test(lead) ? lead : '  ';
}

function groupByName(children: Fb2Element[]): Map<string, Fb2Element[]> {
  const grouped = new Map<string, Fb2Element[]>();
  for (const child of children) {
    const existing = grouped.get(child.name);
    if (existing) existing.push(child);
    else grouped.set(child.name, [child]);
  }
  return grouped;
}

function reindent(raw: string, indent: string): string {
  return indent + raw.trim();
}

/**
 * Rewrites an FB2 <description> block from a write payload.
 *
 * Managed elements are regenerated; everything else (document-info, src-title-info,
 * foreign custom-info, publish-info extras) is copied verbatim from the source so
 * unrelated metadata keeps its exact bytes.
 */
export function buildFb2Description(
  descriptionXml: string,
  payload: BookWritePayload,
  fieldMask: Set<BookWritePayloadKey>,
  options: BuildFb2DescriptionOptions,
): Fb2DescriptionBuild {
  const mask = new Set([...fieldMask].filter((field) => FB2_WRITABLE_FIELDS.has(field)));
  const writes = (field: BookWritePayloadKey): boolean => mask.has(field) && hasValue(payload[field]);
  const fieldsWritten: BookWritePayloadKey[] = [];
  const record = (field: BookWritePayloadKey): void => {
    if (!fieldsWritten.includes(field)) fieldsWritten.push(field);
  };

  let openTagEnd: number;
  let closeTagStart: number;
  try {
    openTagEnd = findTagEnd(descriptionXml, 0);
    closeTagStart = findElementClose(descriptionXml, 'description', openTagEnd + 1);
  } catch (error) {
    return { status: 'skipped', reason: error instanceof Fb2StructureError ? error.message : 'unreadable description block' };
  }

  const children = scanChildElements(descriptionXml, openTagEnd + 1, closeTagStart);
  const grouped = groupByName(children);
  const titleInfo = grouped.get('title-info')?.[0];
  if (!titleInfo || titleInfo.selfClosing) {
    return { status: 'skipped', reason: 'description has no title-info' };
  }

  const indent = resolveIndent(descriptionXml, children[0]);
  const childIndent = indent + indent;
  const newline = descriptionXml.includes('\r\n') ? '\r\n' : '\n';

  // ── title-info ─────────────────────────────────────────────────────────────
  const titleInfoChildren = scanChildElements(descriptionXml, titleInfo.contentStart, titleInfo.contentEnd);
  const titleInfoGroups = groupByName(titleInfoChildren);
  const slots = new Map<string, string[]>();
  for (const name of TITLE_INFO_ORDER) {
    slots.set(
      name,
      (titleInfoGroups.get(name) ?? []).map((child) => reindent(elementText(descriptionXml, child), childIndent)),
    );
  }
  const foreignTitleInfoChildren = titleInfoChildren
    .filter((child) => !TITLE_INFO_ORDER.includes(child.name as (typeof TITLE_INFO_ORDER)[number]))
    .map((child) => reindent(elementText(descriptionXml, child), childIndent));

  if (writes('title')) {
    slots.set('book-title', [`${childIndent}<book-title>${escapeText(payload.title!.trim())}</book-title>`]);
    record('title');
  }

  if (writes('authors')) {
    const authors = payload.authors!.filter((author) => author?.name?.trim());
    if (authors.length > 0) {
      slots.set(
        'author',
        authors.map((author) => buildAuthorElement(author, childIndent)),
      );
      record('authors');
    }
  }

  if (writes('genres')) {
    const genres = payload.genres!.map((genre) => genre.trim()).filter(Boolean);
    if (genres.length > 0) {
      slots.set(
        'genre',
        genres.map((genre) => `${childIndent}<genre>${escapeText(genre)}</genre>`),
      );
      record('genres');
    }
  }

  if (writes('description')) {
    const annotation = buildAnnotationElement(payload.description!, childIndent);
    if (annotation) {
      slots.set('annotation', [annotation]);
      record('description');
    }
  }

  if (writes('tags')) {
    const tags = payload.tags!.map((tag) => tag.trim()).filter(Boolean);
    if (tags.length > 0) {
      slots.set('keywords', [`${childIndent}<keywords>${escapeText(tags.join(', '))}</keywords>`]);
      record('tags');
    }
  }

  if (writes('language')) {
    slots.set('lang', [`${childIndent}<lang>${escapeText(payload.language!.trim())}</lang>`]);
    record('language');
  }

  const isoDate = writes('publishedDate') && ISO_DATE_RE.test(payload.publishedDate!.trim()) ? payload.publishedDate!.trim() : null;
  const publishedYear = resolvePublishedYear(payload, mask);
  const yearFromPayload = mask.has('publishedYear') && typeof payload.publishedYear === 'number' && Number.isFinite(payload.publishedYear);
  if (isoDate) {
    slots.set('date', [`${childIndent}<date value="${escapeAttribute(isoDate)}">${escapeText(isoDate)}</date>`]);
    record('publishedDate');
  } else if (publishedYear !== null) {
    slots.set('date', [`${childIndent}<date>${escapeText(publishedYear)}</date>`]);
  }
  if (publishedYear !== null) {
    record(yearFromPayload ? 'publishedYear' : 'publishedDate');
  }

  if (writes('seriesName')) {
    const seriesName = payload.seriesName!.trim();
    const index = payload.seriesIndex;
    const writeIndex = mask.has('seriesIndex') && typeof index === 'number' && Number.isFinite(index);
    const numberAttribute = writeIndex ? ` number="${escapeAttribute(String(index))}"` : '';
    slots.set('sequence', [`${childIndent}<sequence name="${escapeAttribute(seriesName)}"${numberAttribute}/>`]);
    record('seriesName');
    if (writeIndex) record('seriesIndex');
  }

  if (options.coverEntryId) {
    const href = `#${escapeAttribute(options.coverEntryId)}`;
    slots.set('coverpage', [`${childIndent}<coverpage><image ${options.xlinkPrefix}:href="${href}"/></coverpage>`]);
  }

  const titleInfoBody = TITLE_INFO_ORDER.flatMap((name) => slots.get(name) ?? []).concat(foreignTitleInfoChildren);
  const newTitleInfo = [`${indent}${startTagOf(descriptionXml, titleInfo)}`, ...titleInfoBody, `${indent}</title-info>`].join(newline);

  // ── publish-info ───────────────────────────────────────────────────────────
  const publishInfo = grouped.get('publish-info')?.[0];
  let newPublishInfo = publishInfo ? reindent(elementText(descriptionXml, publishInfo), indent) : null;
  if (PUBLISH_INFO_FIELDS.some((field) => writes(field))) {
    const publishInfoChildren =
      publishInfo && !publishInfo.selfClosing ? scanChildElements(descriptionXml, publishInfo.contentStart, publishInfo.contentEnd) : [];
    const publishGroups = groupByName(publishInfoChildren);
    const publishSlots = new Map<string, string[]>();
    for (const name of PUBLISH_INFO_ORDER) {
      publishSlots.set(
        name,
        (publishGroups.get(name) ?? []).map((child) => reindent(elementText(descriptionXml, child), childIndent)),
      );
    }

    if (writes('publisher')) {
      publishSlots.set('publisher', [`${childIndent}<publisher>${escapeText(payload.publisher!.trim())}</publisher>`]);
      record('publisher');
    }
    if (publishedYear !== null) {
      publishSlots.set('year', [`${childIndent}<year>${escapeText(publishedYear)}</year>`]);
    }
    if (writes('isbn13')) {
      publishSlots.set('isbn', [`${childIndent}<isbn>${escapeText(payload.isbn13!.trim())}</isbn>`]);
      record('isbn13');
    }

    const publishBody = PUBLISH_INFO_ORDER.flatMap((name) => publishSlots.get(name) ?? []);
    const publishOpenTag = publishInfo && !publishInfo.selfClosing ? startTagOf(descriptionXml, publishInfo) : '<publish-info>';
    newPublishInfo = [`${indent}${publishOpenTag}`, ...publishBody, `${indent}</publish-info>`].join(newline);
  }

  // ── custom-info ────────────────────────────────────────────────────────────
  const foreignCustomInfo = (grouped.get('custom-info') ?? [])
    .map((child) => elementText(descriptionXml, child))
    .filter((raw) => !raw.includes(`info-type="${CUSTOM_INFO_PREFIX}`) && !raw.includes(`info-type='${CUSTOM_INFO_PREFIX}`))
    .map((raw) => reindent(raw, indent));

  const managedCustomInfo: string[] = [];
  for (const field of CUSTOM_INFO_FIELDS) {
    if (!writes(field)) continue;
    managedCustomInfo.push(customInfoElement(field, payload[field] as string | number, indent));
    record(field);
  }
  for (const entry of payload.customMetadata ?? []) {
    if (entry.value === null || entry.value === undefined) continue;
    managedCustomInfo.push(customInfoElement(`custom:${entry.key}`, String(entry.value), indent));
  }

  // ── reassemble ─────────────────────────────────────────────────────────────
  const blocks: string[] = [];
  for (const name of DESCRIPTION_ORDER) {
    if (name === 'title-info') {
      blocks.push(newTitleInfo);
    } else if (name === 'publish-info') {
      if (newPublishInfo) blocks.push(newPublishInfo);
    } else if (name === 'custom-info') {
      blocks.push(...foreignCustomInfo, ...managedCustomInfo);
    } else {
      blocks.push(...(grouped.get(name) ?? []).map((child) => reindent(elementText(descriptionXml, child), indent)));
    }
  }
  blocks.push(
    ...children
      .filter((child) => !DESCRIPTION_ORDER.includes(child.name as (typeof DESCRIPTION_ORDER)[number]))
      .map((child) => reindent(elementText(descriptionXml, child), indent)),
  );

  const openTag = descriptionXml.slice(0, openTagEnd + 1);
  const closeTag = descriptionXml.slice(closeTagStart);
  const descriptionOut = [openTag, ...blocks, closeTag].join(newline);

  return { status: 'built', descriptionXml: descriptionOut, fieldsWritten, coverEntryId: options.coverEntryId ?? null };
}

function customInfoElement(infoType: string, value: string | number, indent: string): string {
  return `${indent}<custom-info info-type="${escapeAttribute(`${BOOKORBIT_NS_PREFIX}:${infoType}`)}">${escapeText(value)}</custom-info>`;
}

function resolvePublishedYear(payload: BookWritePayload, mask: Set<BookWritePayloadKey>): number | null {
  if (mask.has('publishedYear') && typeof payload.publishedYear === 'number' && Number.isFinite(payload.publishedYear)) {
    return payload.publishedYear;
  }
  if (mask.has('publishedDate') && payload.publishedDate) {
    const year = Number.parseInt(payload.publishedDate.slice(0, 4), 10);
    if (Number.isFinite(year)) return year;
  }
  return null;
}

/** Reads the binary id referenced by <coverpage>, when the document has one. */
export function readCoverEntryId(descriptionXml: string, xlinkPrefix: string): string | null {
  const titleInfo = locateElement(descriptionXml, 'title-info');
  if (!titleInfo || titleInfo.selfClosing) return null;

  const coverpage = locateElement(descriptionXml, 'coverpage', titleInfo.contentStart);
  if (!coverpage || coverpage.end > titleInfo.contentEnd) return null;

  const image = descriptionXml.slice(coverpage.start, coverpage.end).match(/<image\b[^>]*>/)?.[0];
  if (!image) return null;

  const href =
    image.match(new RegExp(`(?:^|\\s)${xlinkPrefix}:href\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')) ??
    image.match(/(?:^|\s)(?:[\w-]+:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const value = href?.[1] ?? href?.[2] ?? null;
  if (!value) return null;

  return value.startsWith('#') ? value.slice(1) : value;
}
