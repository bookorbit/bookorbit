import { mkdir, readFile, stat } from 'fs/promises';
import { createWriteStream } from 'fs';
import { extname, join } from 'path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZipArchive } from 'archiver';
import sharp from 'sharp';
import { createExtractorFromData } from 'node-unrar-js';

import { getSevenZip } from '../../../common/sevenzip';
import { imageContentTypeFromPath } from '../../../common/image-content-type';
import { detectComicContainerFormat, type ComicContainerFormat } from '../../../common/comic-format-detect';
import { extractCbzZipEntry, readCbzZipIndex } from '../../../common/cbz-zip-reader';
import { replaceFileAtomically } from '../../file-write/formats/shared/atomic-file-replace';

export interface ComicEpubConversionInput {
  sourcePath: string;
  /** Stored format from bookFiles.format — may be corrected by magic-byte sniffing. */
  storedFormat: ComicContainerFormat;
  fileHash?: string | null;
  bookId: number;
  title?: string | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
}

interface ComicPage {
  name: string;
  data: Buffer;
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

function isImage(name: string): boolean {
  const ext = extname(name).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

function isHidden(name: string): boolean {
  return name.split('/').some((part) => part.startsWith('.'));
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Converts CBZ/CBR/CB7 comic archives into fixed-layout EPUB3 files that Kobo
 * devices render natively (one full-bleed image per "page"), so comics can
 * flow through the same Kobo sync/kepub-conversion pipeline as regular books.
 *
 * Mirrors KepubConversionService's on-disk cache pattern: outputs are cached
 * under appDataPath/.comic-epub-cache/<bookId>/<fileHash>.epub and only
 * regenerated on a cache miss.
 */
@Injectable()
export class ComicEpubConversionService {
  private readonly logger = new Logger(ComicEpubConversionService.name);
  private readonly cacheRoot: string;

  constructor(private readonly config: ConfigService) {
    this.cacheRoot = join(this.config.get<string>('storage.appDataPath')!, '.comic-epub-cache');
  }

  async getComicEpubPath(input: ComicEpubConversionInput): Promise<string> {
    const cacheDir = join(this.cacheRoot, String(input.bookId));
    const fileHash = input.fileHash ?? 'nohash';
    const cachedPath = join(cacheDir, `${fileHash}.epub`);

    try {
      await stat(cachedPath);
      return cachedPath;
    } catch {
      // Cache miss — fall through to conversion.
    }

    const format = await detectComicContainerFormat(input.sourcePath, input.storedFormat);
    const pages = await this.extractPages(format, input.sourcePath);
    if (pages.length === 0) {
      throw new Error(`No image pages found in comic archive: ${input.sourcePath}`);
    }

    await mkdir(cacheDir, { recursive: true });
    const tmpPath = `${cachedPath}.tmp`;
    await this.writeFixedLayoutEpub(tmpPath, pages, {
      title: input.title ?? `Book ${input.bookId}`,
      seriesName: input.seriesName ?? null,
      seriesIndex: input.seriesIndex ?? null,
      identifier: `bookorbit-comic-${input.bookId}-${fileHash}`,
    });
    await replaceFileAtomically(tmpPath, cachedPath);

    this.logger.log(`[comic-epub] converted bookId=${input.bookId} format=${format} pages=${pages.length}`);
    return cachedPath;
  }

  // ── Extraction ────────────────────────────────────────────────────────────

  private async extractPages(format: ComicContainerFormat, sourcePath: string): Promise<ComicPage[]> {
    if (format === 'cbz') return this.extractCbzPages(sourcePath);
    if (format === 'cbr') return this.extractCbrPages(sourcePath);
    return this.extractCb7Pages(sourcePath);
  }

  private async extractCbzPages(sourcePath: string): Promise<ComicPage[]> {
    const index = await readCbzZipIndex(sourcePath);
    const entries =
      index?.entries
        .filter((entry) => !entry.name.endsWith('/') && !isHidden(entry.name) && isImage(entry.name))
        .filter((entry) => (entry.compression === 0 || entry.compression === 8) && entry.compressedSize > 0)
        .sort((a, b) => naturalSort(a.name, b.name)) ?? [];

    const pages: ComicPage[] = [];
    for (const entry of entries) {
      const data = await extractCbzZipEntry(sourcePath, entry);
      if (data) pages.push({ name: entry.name, data });
    }
    return pages;
  }

  private async extractCbrPages(sourcePath: string): Promise<ComicPage[]> {
    const buf = await readFile(sourcePath);
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

    const names: string[] = [];
    const extractor = await createExtractorFromData({ data: arrayBuffer });
    const { fileHeaders } = extractor.getFileList();
    for (const header of fileHeaders) {
      if (!header.flags.directory && isImage(header.name) && !isHidden(header.name)) {
        names.push(header.name);
      }
    }
    names.sort(naturalSort);

    const pages: ComicPage[] = [];
    // node-unrar-js generators must be fully drained per call to avoid WASM leaks,
    // so pages are extracted one at a time (same approach as the CBZ reader module).
    for (const name of names) {
      const singleExtractor = await createExtractorFromData({ data: arrayBuffer });
      const { files } = singleExtractor.extract({ files: [name] });
      for (const file of files) {
        if (!file.fileHeader.flags.directory && file.extraction) {
          pages.push({ name, data: Buffer.from(file.extraction) });
        }
      }
    }
    return pages;
  }

  private async extractCb7Pages(sourcePath: string): Promise<ComicPage[]> {
    const sz = await getSevenZip();
    const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const archivePath = `/conv-a${tag}`;
    const outDir = `/conv-p${tag}`;

    const buf = await readFile(sourcePath);
    const fd = sz.FS.open(archivePath, 'w+');
    sz.FS.write(fd, buf, 0, buf.length);
    sz.FS.close(fd);

    try {
      sz.FS.mkdir(outDir);
    } catch {
      // already exists
    }

    sz.callMain(['e', archivePath, `-o${outDir}`, '-y']);

    const names = sz.FS.readdir(outDir)
      .filter((f) => f !== '.' && f !== '..' && isImage(f) && !isHidden(f))
      .sort(naturalSort);

    const pages: ComicPage[] = names.map((name) => ({
      name,
      data: Buffer.from(sz.FS.readFile(`${outDir}/${name}`)),
    }));

    for (const name of names) {
      try {
        sz.FS.unlink(`${outDir}/${name}`);
      } catch {
        // best-effort cleanup of the WASM VFS scratch area
      }
    }
    try {
      sz.FS.rmdir(outDir);
      sz.FS.unlink(archivePath);
    } catch {
      // best-effort cleanup
    }

    return pages;
  }

  // ── EPUB packaging ───────────────────────────────────────────────────────

  private async writeFixedLayoutEpub(
    outPath: string,
    pages: ComicPage[],
    meta: { title: string; seriesName: string | null; seriesIndex: number | null; identifier: string },
  ): Promise<void> {
    const pageMeta = await Promise.all(
      pages.map(async (page, index) => {
        const info = await sharp(page.data).metadata();
        const ext = extname(page.name).toLowerCase() || '.jpg';
        return {
          index,
          fileName: `image_${String(index + 1).padStart(4, '0')}${ext}`,
          mediaType: imageContentTypeFromPath(page.name),
          width: info.width ?? 1200,
          height: info.height ?? 1600,
          data: page.data,
        };
      }),
    );

    const archive = new ZipArchive({ zlib: { level: 6 } });
    const output = createWriteStream(outPath);

    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);

      archive.append(Buffer.from('application/epub+zip'), { name: 'mimetype', store: true });
      archive.append(this.buildContainerXml(), { name: 'META-INF/container.xml' });
      archive.append(this.buildContentOpf(pageMeta, meta), { name: 'OEBPS/content.opf' });
      archive.append(this.buildNavXhtml(pageMeta, meta.title), { name: 'OEBPS/nav.xhtml' });
      archive.append(this.buildTocNcx(pageMeta, meta), { name: 'OEBPS/toc.ncx' });

      for (const page of pageMeta) {
        archive.append(this.buildPageXhtml(page), { name: `OEBPS/pages/page_${String(page.index + 1).padStart(4, '0')}.xhtml` });
        archive.append(page.data, { name: `OEBPS/images/${page.fileName}` });
      }

      void archive.finalize();
    });
  }

  private buildContainerXml(): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
      `  <rootfiles>\n` +
      `    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n` +
      `  </rootfiles>\n` +
      `</container>\n`
    );
  }

  private buildContentOpf(
    pages: { index: number; fileName: string; mediaType: string; width: number; height: number }[],
    meta: { title: string; seriesName: string | null; seriesIndex: number | null; identifier: string },
  ): string {
    const manifestItems = pages
      .map(
        (p) =>
          `    <item id="page_${p.index + 1}" href="pages/page_${String(p.index + 1).padStart(4, '0')}.xhtml" media-type="application/xhtml+xml"/>\n` +
          `    <item id="img_${p.index + 1}" href="images/${p.fileName}" media-type="${p.mediaType}"/>`,
      )
      .join('\n');
    const spineItems = pages.map((p) => `    <itemref idref="page_${p.index + 1}" properties="rendition:layout-pre-paginated"/>`).join('\n');
    const seriesMeta =
      meta.seriesName != null
        ? `  <meta property="belongs-to-collection" id="series">${xmlEscape(meta.seriesName)}</meta>\n` +
          `  <meta refines="#series" property="collection-type">series</meta>\n` +
          (meta.seriesIndex != null ? `  <meta refines="#series" property="group-position">${meta.seriesIndex}</meta>\n` : '')
        : '';
    const firstPage = pages[0];
    const coverHref = firstPage ? `pages/page_${String(firstPage.index + 1).padStart(4, '0')}.xhtml` : 'pages/page_0001.xhtml';

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">\n` +
      `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
      `    <dc:identifier id="pub-id">${xmlEscape(meta.identifier)}</dc:identifier>\n` +
      `    <dc:title>${xmlEscape(meta.title)}</dc:title>\n` +
      `    <dc:language>en</dc:language>\n` +
      `    <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>\n` +
      `    <meta property="rendition:layout">pre-paginated</meta>\n` +
      `    <meta property="rendition:spread">landscape</meta>\n` +
      `    <meta property="rendition:orientation">portrait</meta>\n` +
      seriesMeta +
      `  </metadata>\n` +
      `  <manifest>\n` +
      `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n` +
      manifestItems +
      `\n  </manifest>\n` +
      `  <spine page-progression-direction="ltr">\n` +
      spineItems +
      `\n  </spine>\n` +
      `  <guide>\n` +
      `    <reference type="cover" title="Cover" href="${coverHref}"/>\n` +
      `  </guide>\n` +
      `</package>\n`
    );
  }

  private buildPageXhtml(page: { fileName: string; mediaType: string; width: number; height: number }): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE html>\n` +
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n` +
      `<head>\n` +
      `  <meta charset="utf-8"/>\n` +
      `  <meta name="viewport" content="width=${page.width}, height=${page.height}"/>\n` +
      `  <style>html,body{margin:0;padding:0} img{width:100%;height:100%;object-fit:contain}</style>\n` +
      `</head>\n` +
      `<body>\n` +
      `  <div style="width:100%;height:100%">\n` +
      `    <img src="../images/${page.fileName}" alt=""/>\n` +
      `  </div>\n` +
      `</body>\n` +
      `</html>\n`
    );
  }

  private buildNavXhtml(pages: { index: number }[], title: string): string {
    const firstHref = pages.length > 0 ? `pages/page_${String(pages[0].index + 1).padStart(4, '0')}.xhtml` : 'pages/page_0001.xhtml';
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE html>\n` +
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n` +
      `<head><meta charset="utf-8"/><title>${xmlEscape(title)}</title></head>\n` +
      `<body>\n` +
      `  <nav epub:type="toc" id="toc">\n` +
      `    <ol>\n` +
      `      <li><a href="${firstHref}">${xmlEscape(title)}</a></li>\n` +
      `    </ol>\n` +
      `  </nav>\n` +
      `</body>\n` +
      `</html>\n`
    );
  }

  private buildTocNcx(pages: { index: number }[], meta: { title: string; identifier: string }): string {
    const firstHref = pages.length > 0 ? `pages/page_${String(pages[0].index + 1).padStart(4, '0')}.xhtml` : 'pages/page_0001.xhtml';
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n` +
      `  <head>\n` +
      `    <meta name="dtb:uid" content="${xmlEscape(meta.identifier)}"/>\n` +
      `  </head>\n` +
      `  <docTitle><text>${xmlEscape(meta.title)}</text></docTitle>\n` +
      `  <navMap>\n` +
      `    <navPoint id="navpoint-1" playOrder="1">\n` +
      `      <navLabel><text>${xmlEscape(meta.title)}</text></navLabel>\n` +
      `      <content src="${firstHref}"/>\n` +
      `    </navPoint>\n` +
      `  </navMap>\n` +
      `</ncx>\n`
    );
  }
}
