import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });

function resolvePath(base: string, rel: string): string {
  const parts = (base + rel).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

function findInZip(zip: unzipper.CentralDirectory, rawHref: string, opfDir: string) {
  const decoded = decodeURIComponent(rawHref);
  const candidates = [resolvePath(opfDir, decoded), resolvePath(opfDir, rawHref), decoded, rawHref];
  const lower = candidates.map((c) => c.toLowerCase());
  return zip.files.find((f) => {
    const p = f.path.startsWith('/') ? f.path.slice(1) : f.path;
    return candidates.includes(p) || lower.includes(p.toLowerCase());
  });
}

/** Extract the first <img src> from an HTML cover page and resolve it to a zip entry. */
async function imageFromHtmlCoverPage(zip: unzipper.CentralDirectory, htmlItem: Record<string, unknown>, opfDir: string): Promise<Buffer | null> {
  const htmlHref = String(htmlItem['@_href'] ?? '');
  if (!htmlHref) return null;
  const htmlFile = findInZip(zip, htmlHref, opfDir);
  if (!htmlFile) return null;
  const html = (await htmlFile.buffer()).toString('utf-8');
  const srcMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!srcMatch) return null;
  const imgSrc = srcMatch[1];
  // Resolve img src relative to the HTML file's directory
  const htmlDir = htmlHref.includes('/') ? htmlHref.substring(0, htmlHref.lastIndexOf('/') + 1) : '';
  const imgFile = findInZip(zip, imgSrc, resolvePath(opfDir, htmlDir));
  if (!imgFile) return null;
  return imgFile.buffer();
}

/**
 * Extract the cover image bytes from an EPUB file.
 * Tries EPUB3 cover-image property, EPUB2 meta cover, guide reference, and id-based fallbacks.
 * Returns null if no cover is found or the file is not a valid EPUB.
 */
export async function extractEpubCover(absolutePath: string): Promise<Buffer | null> {
  try {
    const zip = await unzipper.Open.file(absolutePath);

    // Read container.xml to find OPF path
    const containerFile = zip.files.find((f) => f.path === 'META-INF/container.xml');
    if (!containerFile) return null;

    const containerXml = (await containerFile.buffer()).toString('utf-8');
    const container = parser.parse(containerXml) as Record<string, unknown>;
    const rootfile = (container['container'] as Record<string, unknown>)?.['rootfiles'];
    const rf = (rootfile as Record<string, unknown>)?.['rootfile'];
    const opfPath = ((Array.isArray(rf) ? rf[0] : rf) as Record<string, unknown>)?.['@_full-path'];
    if (typeof opfPath !== 'string') return null;

    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

    const opfFile = zip.files.find((f) => f.path === opfPath);
    if (!opfFile) return null;

    const opfXml = (await opfFile.buffer()).toString('utf-8');
    const opf = parser.parse(opfXml) as Record<string, unknown>;

    const pkg = opf['package'] as Record<string, unknown> | undefined;
    const manifest = pkg?.['manifest'] as Record<string, unknown> | undefined;
    const items = manifest?.['item'];
    const itemList: Record<string, unknown>[] = Array.isArray(items) ? items : items ? [items] : [];

    // Try EPUB3: item with properties="cover-image"
    let coverItem = itemList.find((i) => {
      const props = String(i['@_properties'] ?? '');
      return props.split(' ').includes('cover-image');
    });

    // Try EPUB2: <meta name="cover" content="id"/> → find item by that id
    if (!coverItem) {
      const metadata = pkg?.['metadata'] as Record<string, unknown> | undefined;
      const metaRaw = metadata?.['meta'];
      const metaList: Record<string, unknown>[] = Array.isArray(metaRaw) ? metaRaw : metaRaw ? [metaRaw] : [];
      const coverMeta = metaList.find((m) => String(m['@_name'] ?? '').toLowerCase() === 'cover');
      if (coverMeta) {
        const coverId = String(coverMeta['@_content'] ?? '');
        const found = itemList.find((i) => String(i['@_id'] ?? '') === coverId);
        if (found) {
          const mt = String(found['@_media-type'] ?? '').toLowerCase();
          if (!mt.startsWith('image/')) return imageFromHtmlCoverPage(zip, found, opfDir);
          coverItem = found;
        }
      }
    }

    // Try EPUB2 guide: <guide><reference type="cover" href="..."/></guide>
    if (!coverItem) {
      const guide = pkg?.['guide'] as Record<string, unknown> | undefined;
      const refs = guide?.['reference'];
      const refList: Record<string, unknown>[] = Array.isArray(refs) ? refs : refs ? [refs] : [];
      const coverRef = refList.find((r) =>
        String(r['@_type'] ?? '')
          .toLowerCase()
          .includes('cover'),
      );
      if (coverRef) {
        const guideHref = decodeURIComponent(String(coverRef['@_href'] ?? '').split('#')[0]);
        coverItem = itemList.find((i) => {
          const itemHref = decodeURIComponent(String(i['@_href'] ?? '').split('#')[0]);
          return itemHref === guideHref || resolvePath(opfDir, itemHref) === resolvePath(opfDir, guideHref);
        });
        // If guide points to an HTML cover page, follow the <img> inside it
        if (coverItem) {
          const mt = String(coverItem['@_media-type'] ?? '').toLowerCase();
          if (!mt.startsWith('image/')) return imageFromHtmlCoverPage(zip, coverItem, opfDir);
        }
      }
    }

    // Fallback: item whose id is "cover" or "cover-image"
    if (!coverItem) {
      const found = itemList.find((i) => {
        const id = String(i['@_id'] ?? '').toLowerCase();
        return id === 'cover' || id === 'cover-image';
      });
      if (found) {
        const mt = String(found['@_media-type'] ?? '').toLowerCase();
        if (!mt.startsWith('image/')) return imageFromHtmlCoverPage(zip, found, opfDir);
        coverItem = found;
      }
    }

    // Fallback: item whose href contains "cover" and is an image
    if (!coverItem) {
      coverItem = itemList.find((i) => {
        const mt = String(i['@_media-type'] ?? '').toLowerCase();
        const href = String(i['@_href'] ?? '').toLowerCase();
        return mt.startsWith('image/') && href.includes('cover');
      });
    }

    if (!coverItem) return null;

    const href = String(coverItem['@_href'] ?? '');
    if (!href) return null;

    const imageFile = findInZip(zip, href, opfDir);
    if (!imageFile) return null;

    return await imageFile.buffer();
  } catch {
    return null;
  }
}
