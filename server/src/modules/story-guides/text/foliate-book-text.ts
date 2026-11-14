import { openAsBlob } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

import { JSDOM } from 'jsdom';

import { BOOK_TEXT_LIMITS, type BookTextLimits } from './book-text-limits';
import { BookTextError, type BookText, type BookTextKind, type BookTextSection } from './book-text.types';
import { rawSectionText, sectionHash } from './section-text';

/**
 * The vendored foliate-js, the same copy the app's reader ships (`vendor/foliate/README.md`).
 * Resolved from the working directory, which is the server folder in development and the
 * application folder in the container image.
 */
export const FOLIATE_DIR = join(process.cwd(), 'vendor', 'foliate');

interface FoliateSection {
  linear?: string;
  /** What the section's document unpacks to, from the zip directory. */
  size?: number;
  createDocument?: () => Promise<Document>;
}

interface FoliateTocItem {
  label?: string;
  href?: string;
  subitems?: FoliateTocItem[] | null;
}

interface FoliateBook {
  sections: FoliateSection[];
  toc?: FoliateTocItem[] | null;
  metadata?: { language?: string | string[] | null } | null;
  resolveHref(href: string): { index: number } | null | undefined | Promise<{ index: number } | null | undefined>;
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval -- keeps a real dynamic import in the CommonJS build
const importViaFunction = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<unknown>;

async function importFoliate<T>(foliateDir: string, file: string): Promise<T> {
  const specifier = pathToFileURL(join(foliateDir, file)).href;
  try {
    return (await import(specifier)) as T;
  } catch {
    return (await importViaFunction(specifier)) as T;
  }
}

let globalsInstalled = false;

/** The browser globals foliate-js reaches for, from jsdom, with the CSSOM `CSS.escape` that KF8 fragment selectors use. */
export function installFoliateGlobals(): void {
  if (globalsInstalled) return;
  globalsInstalled = true;
  const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const target = globalThis as Record<string, unknown>;
  target.window ??= window;
  target.document = window.document;
  target.DOMParser = window.DOMParser;
  target.XMLSerializer = window.XMLSerializer;
  target.Node ??= window.Node;
  target.CSS ??= { escape: cssEscape };
  const url = URL as unknown as Record<string, unknown>;
  url.createObjectURL ??= () => 'blob:node-stub';
  url.revokeObjectURL ??= () => undefined;
}

export function cssEscape(value: unknown): string {
  const s = String(value);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) out += '\uFFFD';
    else if (
      (c >= 0x1 && c <= 0x1f) ||
      c === 0x7f ||
      (i === 0 && c >= 0x30 && c <= 0x39) ||
      (i === 1 && c >= 0x30 && c <= 0x39 && s.charCodeAt(0) === 0x2d)
    )
      out += '\\' + c.toString(16) + ' ';
    else if (i === 0 && s.length === 1 && c === 0x2d) out += '\\' + s[i];
    else if (c >= 0x80 || c === 0x2d || c === 0x5f || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) out += s[i];
    else out += '\\' + s[i];
  }
  return out;
}

async function openBook(blob: Blob, foliateDir: string, limits: BookTextLimits): Promise<{ kind: BookTextKind; book: FoliateBook }> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const zip = await importFoliate<ZipModule>(foliateDir, 'vendor/zip.js');
    zip.configure({ useWebWorkers: false });
    const entries = await new zip.ZipReader(new zip.BlobReader(blob)).getEntries();
    if (entries.length > limits.maxEntries) throw new BookTextError('too-large', `the zip has ${entries.length} entries`);
    const map = new Map(entries.map((entry) => [entry.filename, entry]));
    const load =
      <A extends unknown[], R>(read: (entry: ZipEntry, ...args: A) => R) =>
      (name: string, ...args: A): R | null => {
        const entry = map.get(name);
        return entry ? read(entry, ...args) : null;
      };
    const loader = {
      entries,
      loadText: load((entry) => entry.getData(new zip.TextWriter())),
      loadBlob: load((entry, type: string) => entry.getData(new zip.BlobWriter(type))),
      getSize: (name: string) => map.get(name)?.uncompressedSize ?? 0,
    };
    const { EPUB } = await importFoliate<{ EPUB: new (loader: unknown) => { init(): Promise<FoliateBook> } }>(foliateDir, 'epub.js');
    const book = await new EPUB(loader).init();
    refuseSpinePastLimits(book, limits);
    return { kind: 'epub', book };
  }
  const mobi = await importFoliate<MobiModule>(foliateDir, 'mobi.js');
  if (await mobi.isMOBI(blob)) {
    if (blob.size > limits.maxFileBytes) throw new BookTextError('too-large', `file is ${blob.size} bytes`);
    const fflate = await importFoliate<{ unzlibSync: unknown }>(foliateDir, 'vendor/fflate.js');
    return { kind: 'mobi', book: await new mobi.MOBI({ unzlib: fflate.unzlibSync }).open(blob) };
  }
  throw new Error('not an EPUB or MOBI file');
}

/** Checks the spine's declared sizes before any section is parsed. */
function refuseSpinePastLimits(book: FoliateBook, limits: BookTextLimits): void {
  let total = 0;
  for (const section of book.sections) {
    const size = section.size ?? 0;
    if (size > limits.maxDocumentBytes) throw new BookTextError('too-large', `a section unpacks to ${size} bytes`);
    total += size;
  }
  if (total > limits.maxTextBytes) throw new BookTextError('too-large', `the sections unpack to ${total} bytes`);
}

interface ZipEntry {
  filename: string;
  uncompressedSize: number;
  getData(writer: unknown): Promise<unknown>;
}

interface ZipModule {
  configure(options: { useWebWorkers: boolean }): void;
  ZipReader: new (reader: unknown) => { getEntries(): Promise<ZipEntry[]> };
  BlobReader: new (blob: Blob) => unknown;
  TextWriter: new () => unknown;
  BlobWriter: new (type: string) => unknown;
}

interface MobiModule {
  isMOBI(blob: Blob): Promise<boolean>;
  MOBI: new (options: { unzlib: unknown }) => { open(blob: Blob): Promise<FoliateBook> };
}

async function sectionTitles(book: FoliateBook): Promise<Map<number, string[]>> {
  const titles = new Map<number, string[]>();
  const visit = async (items: FoliateTocItem[] | null | undefined): Promise<void> => {
    for (const item of items ?? []) {
      const label = item.label?.replace(/\s+/g, ' ').trim();
      if (label && item.href) {
        try {
          const resolved = await book.resolveHref(item.href);
          if (resolved && resolved.index >= 0) titles.set(resolved.index, [...(titles.get(resolved.index) ?? []), label]);
        } catch {
          // A contents entry foliate cannot resolve names no section.
        }
      }
      await visit(item.subitems);
    }
  };
  await visit(book.toc);
  return titles;
}

function languagesOf(book: FoliateBook): string[] {
  const value = book.metadata?.language;
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

/**
 * Opens a book with foliate-js and reads every section's text. Runs inside the text worker. Throws
 * `BookTextError` with `too-large` for a book past `limits`, before any section is parsed.
 */
export async function extractBookText(
  filePath: string,
  foliateDir: string = FOLIATE_DIR,
  limits: BookTextLimits = BOOK_TEXT_LIMITS,
): Promise<BookText> {
  installFoliateGlobals();
  const blob = await openAsBlob(filePath);
  const { kind, book } = await openBook(blob, foliateDir, limits);
  const titles = await sectionTitles(book);
  const sections: BookTextSection[] = [];
  for (const [index, section] of book.sections.entries()) {
    const entry: BookTextSection = {
      index,
      linear: section.linear !== 'no',
      titles: titles.get(index) ?? [],
      text: '',
      blocks: [],
      hash: sectionHash(''),
      error: null,
    };
    try {
      const doc = section.createDocument ? await section.createDocument() : null;
      if (doc) {
        const { text, blocks } = rawSectionText(doc);
        entry.text = text;
        entry.blocks = blocks;
        entry.hash = sectionHash(text);
      }
    } catch (error) {
      entry.error = String((error as Error)?.message ?? error).slice(0, 200);
    }
    sections.push(entry);
  }
  return { kind, languages: languagesOf(book), sections };
}
