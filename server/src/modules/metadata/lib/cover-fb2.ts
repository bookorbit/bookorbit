import { readFile } from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
});

function attr(obj: unknown, key: string): string {
  if (obj == null || typeof obj !== 'object') return '';
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

function toArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (val != null) return [val];
  return [];
}

/**
 * Extract the cover image bytes from an FB2 file.
 * Finds the image referenced by <coverpage><image l:href="#id"/></coverpage>
 * and decodes the matching <binary id="id"> element.
 */
export async function extractFb2Cover(absolutePath: string): Promise<Buffer | null> {
  try {
    const xml = await readFile(absolutePath, 'utf-8');
    const doc = parser.parse(xml) as Record<string, unknown>;

    const fb = (doc['FictionBook'] ?? doc['fictionbook']) as Record<string, unknown> | undefined;
    if (!fb) return null;

    // Find coverpage image href
    const description = fb['description'] as Record<string, unknown> | undefined;
    const titleInfo = description?.['title-info'] as Record<string, unknown> | undefined;
    const coverpage = titleInfo?.['coverpage'] as Record<string, unknown> | undefined;
    if (!coverpage) return null;

    const images = toArray(coverpage['image']);
    const firstImage = images[0];
    const href = attr(firstImage, '@_href') || attr(firstImage, '@_l:href');
    if (!href) return null;

    const imageId = href.startsWith('#') ? href.slice(1) : href;

    // Find matching binary element
    const binaries = toArray(fb['binary']);
    const binary = binaries.find((b) => attr(b, '@_id') === imageId);
    if (!binary) return null;

    const b64 = (binary as Record<string, unknown>)['#text'];
    if (typeof b64 !== 'string' || !b64.trim()) return null;

    return Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  } catch {
    return null;
  }
}
