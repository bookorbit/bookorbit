import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

import {
  createCbzFixture,
  createEpubFixture,
  createMetadataWriteFixtureRoot,
  createPdfFixture,
  type MetadataWriteFixtureRoot,
  writeFixtureFile,
} from '../metadata-write/metadata-write-fixture-builder';

interface ZipEntryInput {
  path: string;
  content: string | Buffer;
  store?: boolean;
}

interface EpubWithCoverInput {
  title?: string;
  language?: string;
  uid?: string;
  coverBytes?: Buffer;
  coverFileName?: string;
}

export type MetadataLockFixtureRoot = MetadataWriteFixtureRoot;

export const RED_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGP4z8DwH4QZMBgAoXkL9U3EmgcAAAAASUVORK5CYII=',
  'base64',
);
export const GREEN_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVR4nGNg+A+FGAwAm38L9SgUsAQAAAAASUVORK5CYII=',
  'base64',
);
export const BLUE_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVR4nGNgYPj/H4LRGQCVhQv15UfOvQAAAABJRU5ErkJggg==',
  'base64',
);

export async function createMetadataLockFixtureRoot(prefix = 'metadata-lock-e2e-'): Promise<MetadataLockFixtureRoot> {
  return createMetadataWriteFixtureRoot(prefix);
}

export { createCbzFixture, createEpubFixture, createPdfFixture, writeFixtureFile };

export async function createEpubWithCoverFixture(rootPath: string, relativePath: string, input: EpubWithCoverInput = {}): Promise<string> {
  assertRelativePath(relativePath);

  const absolutePath = join(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });

  const uid = input.uid ?? `urn:uuid:${randomUUID()}`;
  const title = input.title ?? 'Fixture EPUB With Cover Title';
  const language = input.language ?? 'en';
  const coverBytes = input.coverBytes ?? GREEN_PNG_BYTES;
  const coverFileName = input.coverFileName ?? 'cover.png';

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`;

  const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${escapeXml(uid)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="cover-image" href="images/${escapeXml(coverFileName)}" media-type="image/png" properties="cover-image" />
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="chapter" />
  </spine>
</package>`;

  const chapterXml = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(title)}</title></head><body><p>fixture</p></body></html>`;

  await writeZipArchive(absolutePath, [
    { path: 'mimetype', content: 'application/epub+zip', store: true },
    { path: 'META-INF/container.xml', content: containerXml },
    { path: 'OPS/content.opf', content: opfXml },
    { path: 'OPS/chapter.xhtml', content: chapterXml },
    { path: `OPS/images/${coverFileName}`, content: coverBytes },
  ]);

  return absolutePath;
}

function assertRelativePath(path: string): void {
  if (path.startsWith('/')) {
    throw new Error(`Fixture paths must be relative. Received "${path}"`);
  }
}

async function writeZipArchive(absolutePath: string, entries: ZipEntryInput[]): Promise<void> {
  const output = createWriteStream(absolutePath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    for (const entry of entries) {
      archive.append(typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf8') : entry.content, {
        name: entry.path,
        store: entry.store ?? false,
      });
    }

    void archive.finalize();
  });
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
