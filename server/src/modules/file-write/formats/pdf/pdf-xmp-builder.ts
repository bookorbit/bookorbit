import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { PROJECTX_NS_PREFIX, PROJECTX_NS_URI } from '../shared/projectx-ns';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function elem(tag: string, value: string): string {
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

function seqElem(tag: string, items: string[]): string {
  const lis = items.map((i) => `          <rdf:li>${escapeXml(i)}</rdf:li>`).join('\n');
  return `<${tag}>\n          <rdf:Seq>\n${lis}\n          </rdf:Seq>\n        </${tag}>`;
}

function bagElem(tag: string, items: string[]): string {
  const lis = items.map((i) => `          <rdf:li>${escapeXml(i)}</rdf:li>`).join('\n');
  return `<${tag}>\n          <rdf:Bag>\n${lis}\n          </rdf:Bag>\n        </${tag}>`;
}

function normalizeGoodreadsId(id: string): string {
  const dash = id.indexOf('-');
  if (dash > 0) {
    const numeric = id.slice(0, dash);
    if (/^\d+$/.test(numeric)) return numeric;
  }
  return id;
}

export function buildXmp(payload: BookWritePayload, fieldMask: Set<BookWritePayloadKey>): string {
  const px = PROJECTX_NS_PREFIX;
  const now = new Date().toISOString();
  const lines: string[] = [];

  if (fieldMask.has('title') && payload.title != null) {
    lines.push(elem('dc:title', payload.title));
  }
  if (fieldMask.has('authors') && payload.authors?.length) {
    lines.push(
      seqElem(
        'dc:creator',
        payload.authors.map((a) => a.name),
      ),
    );
  }
  if (fieldMask.has('description') && payload.description != null) {
    lines.push(elem('dc:description', payload.description));
  }
  if (fieldMask.has('publisher') && payload.publisher != null) {
    lines.push(elem('dc:publisher', payload.publisher));
  }
  if (fieldMask.has('publishedYear') && payload.publishedYear != null) {
    lines.push(elem('dc:date', `${payload.publishedYear}-01-01`));
  }
  if (fieldMask.has('language') && payload.language != null) {
    lines.push(elem('dc:language', payload.language));
  }
  if (fieldMask.has('genres') && payload.genres?.length) {
    lines.push(seqElem('dc:subject', payload.genres));
  }

  lines.push(elem('xmp:CreatorTool', px));
  lines.push(elem('xmp:MetadataDate', now));
  lines.push(elem('xmp:ModifyDate', now));

  if (fieldMask.has('subtitle') && payload.subtitle != null) {
    lines.push(elem(`${px}:subtitle`, payload.subtitle));
  }

  if (fieldMask.has('seriesName') && fieldMask.has('seriesIndex') && payload.seriesName != null && payload.seriesIndex != null) {
    lines.push(elem(`${px}:seriesName`, payload.seriesName));
    lines.push(elem(`${px}:seriesIndex`, String(payload.seriesIndex)));
  }

  if (fieldMask.has('isbn13') && payload.isbn13 != null) {
    lines.push(elem(`${px}:isbn13`, payload.isbn13));
  }
  if (fieldMask.has('isbn10') && payload.isbn10 != null) {
    lines.push(elem(`${px}:isbn10`, payload.isbn10));
  }
  if (fieldMask.has('pageCount') && payload.pageCount != null) {
    lines.push(elem(`${px}:pageCount`, String(payload.pageCount)));
  }
  if (fieldMask.has('rating') && payload.rating != null) {
    lines.push(elem(`${px}:rating`, String(payload.rating)));
  }
  if (fieldMask.has('goodreadsId') && payload.goodreadsId != null) {
    lines.push(elem(`${px}:goodreadsId`, normalizeGoodreadsId(payload.goodreadsId)));
  }
  if (fieldMask.has('googleBooksId') && payload.googleBooksId != null) {
    lines.push(elem(`${px}:googleBooksId`, payload.googleBooksId));
  }
  if (fieldMask.has('amazonId') && payload.amazonId != null) {
    lines.push(elem(`${px}:amazonId`, payload.amazonId));
  }
  if (fieldMask.has('hardcoverId') && payload.hardcoverId != null) {
    lines.push(elem(`${px}:hardcoverId`, payload.hardcoverId));
  }
  if (fieldMask.has('openLibraryId') && payload.openLibraryId != null) {
    lines.push(elem(`${px}:openLibraryId`, payload.openLibraryId));
  }
  if (fieldMask.has('itunesId') && payload.itunesId != null) {
    lines.push(elem(`${px}:itunesId`, payload.itunesId));
  }
  if (fieldMask.has('tags') && payload.tags?.length) {
    lines.push(bagElem(`${px}:tags`, payload.tags));
  }

  const body = lines.map((l) => `        ${l}`).join('\n');

  // XMP packet wrapper is required by the XMP spec - many readers (Calibre, Adobe) silently
  // ignore XMP that lacks the <?xpacket?> processing instructions. The U+FEFF BOM in the
  // begin PI signals UTF-8 encoding; id is the standard fixed identifier.
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '    <rdf:Description',
    '      rdf:about=""',
    '      xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '      xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    `      xmlns:${px}="${PROJECTX_NS_URI}">`,
    body,
    '    </rdf:Description>',
    '  </rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
}
