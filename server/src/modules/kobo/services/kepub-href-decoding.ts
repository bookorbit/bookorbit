import { createWriteStream } from 'fs';
import { posix } from 'path';
import { ZipArchive } from 'archiver';
import * as unzipper from 'unzipper';

// kepubify looks a manifest href up in the archive exactly as written, so a chapter listed as
// `Text/My%20Chapter.xhtml` but stored as `Text/My Chapter.xhtml` is shipped unconverted. With no
// KoboSpans in it a Kobo can only bookmark the chapter's start, and every synced position snaps
// back there (#1136). The fix converts a copy whose OPF names those files as stored, then puts the
// book's own spelling back so the Kobo still reports the paths it always did.

const HREF_ATTRIBUTE = /\bhref=(["'])([^"']*)\1/g;
const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/;
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

/** The book's own href attribute text, keyed by the href as stored in the archive. */
export type DecodedHrefs = ReadonlyMap<string, string>;

interface PackageDocument {
  files: unzipper.File[];
  opfPath: string;
  opf: string;
}

/** The hrefs that resolve only once decoded, or an empty map when kepubify can read the book as is. */
export async function findDecodableHrefs(epubPath: string): Promise<Map<string, string>> {
  const pkg = await readPackageDocument(epubPath);
  const decoded = new Map<string, string>();
  if (!pkg) return decoded;
  const names = new Set(pkg.files.map((file) => file.path));
  const opfDir = posix.dirname(pkg.opfPath);
  for (const [, , raw] of pkg.opf.matchAll(HREF_ATTRIBUTE)) {
    if (!PERCENT_ESCAPE.test(raw)) continue;
    const href = unescapeXml(raw);
    const plain = decodeHref(href);
    if (!plain || plain === href) continue;
    if (names.has(resolveHref(opfDir, hrefPath(href))) || !names.has(resolveHref(opfDir, decodeHref(hrefPath(href)) ?? ''))) continue;
    decoded.set(plain, raw);
  }
  return decoded;
}

/** Copies the book with the given hrefs decoded in its OPF, for kepubify to convert. */
export async function writeWithDecodedHrefs(epubPath: string, outputPath: string, decoded: DecodedHrefs): Promise<void> {
  await rewriteOpf(epubPath, outputPath, (opf) =>
    opf.replace(HREF_ATTRIBUTE, (match, quote: string, raw: string) => {
      const plain = decodeHref(unescapeXml(raw));
      return plain !== null && decoded.get(plain) === raw ? `href=${quote}${escapeXml(plain)}${quote}` : match;
    }),
  );
}

/** Puts the book's own href spelling back into kepubify's output; returns how many it restored. */
export async function restoreEncodedHrefs(kepubPath: string, outputPath: string, decoded: DecodedHrefs): Promise<number> {
  let restored = 0;
  await rewriteOpf(kepubPath, outputPath, (opf) =>
    // kepubify re-serializes the package, so match on the attribute's value rather than its text.
    opf.replace(HREF_ATTRIBUTE, (match, quote: string, raw: string) => {
      const original = decoded.get(unescapeXml(raw));
      if (original === undefined) return match;
      restored++;
      return `href=${quote}${original}${quote}`;
    }),
  );
  return restored;
}

async function rewriteOpf(epubPath: string, outputPath: string, rewrite: (opf: string) => string): Promise<void> {
  const pkg = await readPackageDocument(epubPath);
  if (!pkg) throw new Error('EPUB package document not found');
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = createWriteStream(outputPath);
  let fail!: (error: Error) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  failure.catch(() => {});
  archive.on('error', fail);
  output.on('error', fail);
  const closed = new Promise<void>((resolve) => output.once('close', resolve));
  archive.pipe(output);

  // One entry at a time: appending them all up front opens a read stream per entry at once.
  const append = (source: Buffer | NodeJS.ReadableStream, options: { name: string; store?: boolean }) =>
    Promise.race([
      new Promise<void>((resolve) => {
        archive.once('entry', () => resolve());
        if (!Buffer.isBuffer(source)) source.once('error', fail);
        archive.append(source as Buffer, options);
      }),
      failure,
    ]);

  try {
    const mimetype = pkg.files.find((file) => file.path === 'mimetype');
    if (mimetype) await append(await readBounded(mimetype), { name: 'mimetype', store: true });
    for (const file of pkg.files) {
      if (file.type !== 'File' || file.path === 'mimetype') continue;
      await append(file.path === pkg.opfPath ? Buffer.from(rewrite(pkg.opf), 'utf8') : file.stream(), { name: file.path });
    }
    void archive.finalize();
    await Promise.race([closed, failure]);
  } catch (error) {
    output.destroy();
    throw error;
  }
}

async function readPackageDocument(epubPath: string): Promise<PackageDocument | null> {
  const zip = await unzipper.Open.file(epubPath);
  if (zip.files.length > MAX_ENTRIES) return null;
  const container = zip.files.find((file) => file.path === 'META-INF/container.xml');
  if (!container) return null;
  const opfPath = /full-path=(["'])([^"']+)\1/.exec((await readBounded(container)).toString('utf8'))?.[2];
  const opfEntry = opfPath ? zip.files.find((file) => file.path === opfPath) : undefined;
  if (!opfPath || !opfEntry) return null;
  return { files: zip.files, opfPath, opf: (await readBounded(opfEntry)).toString('utf8') };
}

async function readBounded(file: unzipper.File): Promise<Buffer> {
  if (file.uncompressedSize > MAX_PACKAGE_BYTES) throw new Error(`EPUB entry ${file.path} is too large to read`);
  return file.buffer();
}

/** Decodes the path of an href; a fragment is left as written. */
function decodeHref(href: string): string | null {
  const path = hrefPath(href);
  try {
    return decodeURIComponent(path) + href.slice(path.length);
  } catch {
    return null;
  }
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9A-Fa-f]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    if (!entity.startsWith('#')) return XML_ENTITIES[entity] ?? match;
    const codePoint = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
  });
}

/** The href without its fragment, cut at the first literal `#` so an encoded `%23` stays in the path. */
function hrefPath(href: string): string {
  const hash = href.indexOf('#');
  return hash === -1 ? href : href.slice(0, hash);
}

function resolveHref(opfDir: string, path: string): string {
  return posix.normalize(posix.join(opfDir, path));
}
