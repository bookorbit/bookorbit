import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

import { attr, findInZip, toRecordArray } from './epub-zip-utils';
import { findIsbnInText, type IsbnHit, type IsbnResult, markupToScanText, mergeIsbnHits, pickSingleIsbn } from './isbn-detect';

const SPINE_WINDOW_FRONT = 10;
const SPINE_WINDOW_BACK = 5;
const PER_DOC_BYTE_CAP = 2 * 1024 * 1024;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) => name === 'item' || name === 'itemref',
});

async function readEntryCapped(file: unzipper.File): Promise<string> {
  const size = file.uncompressedSize ?? 0;
  if (size === 0 || size <= PER_DOC_BYTE_CAP) {
    return (await file.buffer()).toString('utf-8');
  }
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let len = 0;
    const stream = file.stream();
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      len += chunk.length;
      if (len >= PER_DOC_BYTE_CAP) stream.destroy();
    });
    const finish = () => resolve(Buffer.concat(chunks).toString('utf-8'));
    stream.on('close', finish);
    stream.on('end', finish);
    stream.on('error', reject);
  });
}

function resolveContentDocs(opfXml: string, opfDir: string, zip: unzipper.CentralDirectory): unzipper.File[] {
  const opf = parser.parse(opfXml) as Record<string, unknown>;
  const pkg = opf['package'] as Record<string, unknown> | undefined;
  const manifest = pkg?.['manifest'] as Record<string, unknown> | undefined;
  const spine = pkg?.['spine'] as Record<string, unknown> | undefined;

  const byId = new Map<string, Record<string, unknown>>();
  for (const item of toRecordArray(manifest?.['item'])) byId.set(attr(item, '@_id'), item);

  const docs: unzipper.File[] = [];
  for (const ref of toRecordArray(spine?.['itemref'])) {
    const item = byId.get(attr(ref, '@_idref'));
    if (!item) continue;
    const mediaType = attr(item, '@_media-type').toLowerCase();
    const href = attr(item, '@_href');
    const isHtml = mediaType.includes('xhtml') || mediaType.includes('html') || /\.x?html?$/i.test(href);
    if (!isHtml || !href) continue;
    const entry = findInZip(zip, href, opfDir);
    if (entry) docs.push(entry);
  }
  return docs;
}

function windowDocs(docs: unzipper.File[]): unzipper.File[] {
  if (docs.length <= SPINE_WINDOW_FRONT + SPINE_WINDOW_BACK) return docs;
  return [...docs.slice(0, SPINE_WINDOW_FRONT), ...docs.slice(docs.length - SPINE_WINDOW_BACK)];
}

/**
 * Every ISBN printed in a bounded window of spine content documents: front and back matter, where
 * the copyright page and colophon live. Reuses the already-open zip and skips a document it cannot
 * read; never throws.
 */
export async function collectEpubIsbnHits(zip: unzipper.CentralDirectory, opfXml: string, opfPath: string): Promise<IsbnHit[]> {
  const passages: IsbnHit[][] = [];
  try {
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    for (const doc of windowDocs(resolveContentDocs(opfXml, opfDir, zip))) {
      try {
        passages.push(findIsbnInText(markupToScanText(await readEntryCapped(doc))));
      } catch {
        continue;
      }
    }
  } catch {
    // A malformed OPF or zip leaves whatever was read so far.
  }
  return mergeIsbnHits(passages);
}

/** Fallback ISBN for an EPUB whose OPF carries none: the one ISBN its pages print, if they print exactly one. */
export async function scanEpubSpineForIsbn(zip: unzipper.CentralDirectory, opfXml: string, opfPath: string): Promise<IsbnResult> {
  return pickSingleIsbn(await collectEpubIsbnHits(zip, opfXml, opfPath));
}
