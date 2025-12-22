import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/**
 * Extract the cover image bytes from an EPUB file.
 * Looks for cover-image in manifest (EPUB3 properties or EPUB2 meta cover).
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
        coverItem = itemList.find((i) => String(i['@_id'] ?? '') === coverId);
      }
    }

    // Fallback: item whose id is "cover" or "cover-image"
    if (!coverItem) {
      coverItem = itemList.find((i) => {
        const id = String(i['@_id'] ?? '').toLowerCase();
        return id === 'cover' || id === 'cover-image';
      });
    }

    if (!coverItem) return null;

    const href = String(coverItem['@_href'] ?? '');
    if (!href) return null;

    const imagePath = opfDir + href;
    const imageFile = zip.files.find((f) => f.path === imagePath || f.path === '/' + imagePath);
    if (!imageFile) return null;

    return await imageFile.buffer();
  } catch {
    return null;
  }
}
