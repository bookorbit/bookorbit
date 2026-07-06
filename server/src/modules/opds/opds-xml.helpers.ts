// Code points the XML 1.0 Char production forbids: C0 controls except tab/LF/CR
// and the noncharacters U+FFFE/U+FFFF. Ebook metadata extracted from EPUB/PDF/MOBI
// often carries these; leaving them in produces a not-well-formed feed that lenient
// OPDS clients mis-parse, shifting entry boundaries onto the wrong acquisition link.
// eslint-disable-next-line no-control-regex -- matching these control characters is the intent
const XML_INVALID_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]', 'g');

// Unpaired surrogates are also illegal in XML 1.0 (the surrogate range is excluded
// from the Char production) and appear in metadata mis-decoded from UTF-16. Valid
// surrogate pairs (astral characters such as emoji) must be left intact.
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(XML_INVALID_CHARS, '')
    .replace(LONE_SURROGATES, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function xmlEl(tag: string, text: string | null | undefined): string {
  return `<${tag}>${esc(text)}</${tag}>`;
}

export function xmlLink(rel: string, href: string, type: string, title?: string): string {
  const t = title ? ` title="${esc(title)}"` : '';
  return `<link rel="${esc(rel)}" href="${esc(href)}" type="${esc(type)}"${t}/>`;
}

export const OPDS_PSE_NS = 'http://vaemendis.net/opds-pse/ns';
export const OPDS_PSE_STREAM_REL = 'http://vaemendis.net/opds-pse/stream';

const PSE_STREAMABLE_FORMATS = new Set(['cbz', 'cbr', 'cb7', 'pdf']);

/** EPUB is HTML/CSS, not page images — PSE only applies to paginated-image content. */
export function isPseStreamableFormat(format: string): boolean {
  return PSE_STREAMABLE_FORMATS.has(format.toLowerCase());
}

export interface PseLastRead {
  page: number;
  date: Date;
}

/**
 * `href` must already contain the literal `{pageNumber}` client-substitution
 * token. `esc()` only XML-escapes `&`/`<`/`>`/`"`/`'`, so the token passes
 * through unencoded, per the OPDS-PSE spec.
 */
export function xmlPseStreamLink(href: string, type: string, count: number, lastRead?: PseLastRead): string {
  const attrs = [`rel="${esc(OPDS_PSE_STREAM_REL)}"`, `href="${esc(href)}"`, `type="${esc(type)}"`, `pse:count="${count}"`];
  if (lastRead) {
    attrs.push(`pse:lastRead="${lastRead.page}"`, `pse:lastReadDate="${esc(lastRead.date.toISOString())}"`);
  }
  return `<link ${attrs.join(' ')}/>`;
}

export function fileMimeType(format: string): string {
  switch (format.toLowerCase()) {
    case 'epub':
      return 'application/epub+zip';
    case 'pdf':
      return 'application/pdf';
    case 'mobi':
      return 'application/x-mobipocket-ebook';
    case 'azw3':
      return 'application/vnd.amazon.ebook';
    case 'fb2':
      return 'application/x-fictionbook+xml';
    case 'cbz':
      return 'application/vnd.comicbook+zip';
    case 'cbr':
      return 'application/vnd.comicbook-rar';
    default:
      return 'application/octet-stream';
  }
}

export const OPDS_MIME_NAV = 'application/atom+xml;profile=opds-catalog;kind=navigation';
export const OPDS_MIME_ACQ = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
export const OPDS_MIME_SEARCH = 'application/opensearchdescription+xml';
