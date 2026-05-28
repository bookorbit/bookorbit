import archiver from 'archiver';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';
import { dirname, join } from 'path';

export async function createEpubFile(absolutePath: string, title = 'Fixture Title'): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });

  const uid = `urn:uuid:${randomUUID()}`;
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${uid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`;

  const chapterXml = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(title)}</title></head><body><p>test content</p></body></html>`;

  await writeZip(absolutePath, [
    { path: 'mimetype', content: 'application/epub+zip', store: true },
    { path: 'META-INF/container.xml', content: containerXml },
    { path: 'OPS/content.opf', content: opfXml },
    { path: 'OPS/chapter.xhtml', content: chapterXml },
  ]);
}

export async function createPdfFile(absolutePath: string, title = 'Fixture PDF'): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([360, 240]);
  page.drawText(title);
  pdf.setTitle(title);
  const bytes = await pdf.save();
  await writeFile(absolutePath, Buffer.from(bytes));
}

export async function createDummyFile(absolutePath: string, content = 'placeholder'): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface ZipEntry {
  path: string;
  content: string | Buffer;
  store?: boolean;
}

async function writeZip(outPath: string, entries: ZipEntry[]): Promise<void> {
  const output = createWriteStream(outPath);
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

// ── Factory helpers ──────────────────────────────────────────────────────────

export async function buildBookPerFileFlat(libraryRoot: string): Promise<Array<{ relPath: string; stem: string }>> {
  const books = [
    { relPath: 'old-book-alpha.epub', stem: 'old-book-alpha' },
    { relPath: 'old-book-beta.epub', stem: 'old-book-beta' },
    { relPath: 'old-book-gamma.epub', stem: 'old-book-gamma' },
    { relPath: 'old-book-delta.epub', stem: 'old-book-delta' },
  ];

  for (const book of books) {
    await createEpubFile(join(libraryRoot, book.relPath), book.stem);
  }

  return books;
}

export async function buildBookPerFileWithSubdirs(libraryRoot: string): Promise<Array<{ relPath: string; stem: string }>> {
  const books = [
    { relPath: 'OldAuthorA/title-one.epub', stem: 'title-one' },
    { relPath: 'OldAuthorB/deep/nested/title-two.epub', stem: 'title-two' },
    { relPath: 'title-three-root.epub', stem: 'title-three-root' },
    { relPath: 'OldAuthorC/title-four.pdf', stem: 'title-four' },
  ];

  for (const book of books) {
    if (book.relPath.endsWith('.pdf')) {
      await createPdfFile(join(libraryRoot, book.relPath), book.stem);
    } else {
      await createEpubFile(join(libraryRoot, book.relPath), book.stem);
    }
  }

  return books;
}

export async function buildBookPerFolderFlat(libraryRoot: string): Promise<Array<{ relPath: string; folderName: string }>> {
  const books = [
    { relPath: 'FolderA/book.epub', folderName: 'FolderA' },
    { relPath: 'FolderB/book.epub', folderName: 'FolderB' },
    { relPath: 'FolderC/book.epub', folderName: 'FolderC' },
  ];

  for (const book of books) {
    await createEpubFile(join(libraryRoot, book.relPath), book.folderName);
  }

  return books;
}

export async function buildBookPerFolderNested(libraryRoot: string): Promise<Array<{ relPath: string; folderName: string }>> {
  const books = [
    { relPath: 'AuthorX/SeriesY/vol01/book.epub', folderName: 'vol01' },
    { relPath: 'AuthorX/standalone/book.epub', folderName: 'standalone' },
    { relPath: 'AuthorZ/TitleZ/TitleZ.epub', folderName: 'TitleZ' },
  ];

  for (const book of books) {
    await createEpubFile(join(libraryRoot, book.relPath), book.folderName);
  }

  return books;
}

export async function buildBookPerFolderMultiFile(
  libraryRoot: string,
): Promise<Array<{ primaryRelPath: string; extraRelPaths: string[]; folderName: string }>> {
  const books = [
    {
      primaryRelPath: 'MultiFileBook/book.epub',
      extraRelPaths: ['MultiFileBook/book.pdf', 'MultiFileBook/cover.jpg'],
      folderName: 'MultiFileBook',
    },
  ];

  for (const book of books) {
    await createEpubFile(join(libraryRoot, book.primaryRelPath), book.folderName);
    await createPdfFile(join(libraryRoot, book.extraRelPaths[0]), `${book.folderName}-pdf`);
    await createDummyFile(join(libraryRoot, book.extraRelPaths[1]), 'JPEG_PLACEHOLDER');
  }

  return books;
}

export async function buildCollisionPair(libraryRoot: string): Promise<Array<{ relPath: string }>> {
  const books = [{ relPath: 'collision-src-a.epub' }, { relPath: 'collision-src-b.epub' }];

  for (const book of books) {
    await createEpubFile(join(libraryRoot, book.relPath), book.relPath.replace('.epub', ''));
  }

  return books;
}

export async function buildSpecialCharBook(libraryRoot: string): Promise<string> {
  const relPath = 'special-chars-src.epub';
  await createEpubFile(join(libraryRoot, relPath), 'placeholder');
  return relPath;
}
