import archiver from 'archiver';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { PDFDocument } from 'pdf-lib';

import { getSevenZip } from '../../../src/common/sevenzip';

export interface MetadataWriteFixtureRoot {
  rootPath: string;
  booksPath: string;
  cleanup: () => Promise<void>;
}

interface ZipEntryInput {
  path: string;
  content: string | Buffer;
  store?: boolean;
}

interface EpubFixtureInput {
  title?: string;
  language?: string;
  uid?: string;
}

interface ComicFixtureInput {
  title?: string;
  author?: string;
  publisher?: string;
  year?: number;
}

function assertRelativePath(path: string): void {
  if (path.startsWith('/')) {
    throw new Error(`Fixture paths must be relative. Received "${path}"`);
  }
}

export async function createMetadataWriteFixtureRoot(prefix = 'metadata-write-e2e-'): Promise<MetadataWriteFixtureRoot> {
  const rootPath = await mkdtemp(join(tmpdir(), prefix));
  const booksPath = join(rootPath, 'books');
  await mkdir(booksPath, { recursive: true });

  return {
    rootPath,
    booksPath,
    cleanup: async () => {
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}

export async function writeFixtureFile(rootPath: string, relativePath: string, content: string | Buffer): Promise<string> {
  assertRelativePath(relativePath);

  const absolutePath = join(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  return absolutePath;
}

export async function createPdfFixture(rootPath: string, relativePath: string, title = 'Fixture PDF Title'): Promise<string> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([360, 240]);
  page.drawText('metadata write fixture');
  pdf.setTitle(title);
  const bytes = await pdf.save();
  return writeFixtureFile(rootPath, relativePath, Buffer.from(bytes));
}

export async function createEpubFixture(rootPath: string, relativePath: string, input: EpubFixtureInput = {}): Promise<string> {
  assertRelativePath(relativePath);
  const absolutePath = join(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });

  const uid = input.uid ?? `urn:uuid:${randomUUID()}`;
  const title = input.title ?? 'Fixture EPUB Title';
  const language = input.language ?? 'en';

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
  ]);

  return absolutePath;
}

export async function createCbzFixture(rootPath: string, relativePath: string, input: ComicFixtureInput = {}): Promise<string> {
  assertRelativePath(relativePath);
  const absolutePath = join(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });

  const xml = buildComicInfoXml(input);
  await writeZipArchive(absolutePath, [
    { path: 'ComicInfo.xml', content: xml },
    { path: 'page-001.txt', content: 'fixture page' },
  ]);

  return absolutePath;
}

export async function createCb7Fixture(rootPath: string, relativePath: string, input: ComicFixtureInput = {}): Promise<string> {
  const xml = buildComicInfoXml(input);
  const archiveBytes = await buildCb7Archive(xml);
  return writeFixtureFile(rootPath, relativePath, archiveBytes);
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

async function buildCb7Archive(comicInfoXml: string): Promise<Buffer> {
  const sevenZip = await getSevenZip();
  const archivePath = `/metadata-write-${randomUUID().replaceAll('-', '')}.cb7`;
  const xmlPath = '/ComicInfo.xml';
  const xmlBytes = Buffer.from(comicInfoXml, 'utf8');

  try {
    safeVfsUnlink(sevenZip.FS, xmlPath);
    safeVfsUnlink(sevenZip.FS, archivePath);

    const fd = sevenZip.FS.open(xmlPath, 'w+');
    sevenZip.FS.write(fd, xmlBytes, 0, xmlBytes.length);
    sevenZip.FS.close(fd);

    sevenZip.callMain(['a', archivePath, xmlPath]);
    return Buffer.from(sevenZip.FS.readFile(archivePath));
  } finally {
    safeVfsUnlink(sevenZip.FS, xmlPath);
    safeVfsUnlink(sevenZip.FS, archivePath);
  }
}

function safeVfsUnlink(vfs: { unlink: (path: string) => void }, path: string): void {
  try {
    vfs.unlink(path);
  } catch {
    // no-op: path may not exist
  }
}

function buildComicInfoXml(input: ComicFixtureInput): string {
  const title = escapeXml(input.title ?? 'Fixture Comic Title');
  const author = escapeXml(input.author ?? 'Fixture Author');
  const publisher = escapeXml(input.publisher ?? 'Fixture Publisher');
  const year = input.year ?? 2024;

  return `<?xml version="1.0" encoding="UTF-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>${title}</Title>
  <Writer>${author}</Writer>
  <Publisher>${publisher}</Publisher>
  <Year>${year}</Year>
</ComicInfo>`;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
