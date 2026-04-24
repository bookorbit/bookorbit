import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Readable } from 'stream';
import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { createInflateRaw } from 'zlib';
import { createExtractorFromData, UnrarError } from 'node-unrar-js';
import { getSevenZip } from '../../../common/sevenzip';
import { imageContentTypeFromPath } from '../../../common/image-content-type';

import type { RequestUser } from '../../../common/types/request-user';
import { BookService } from '../../book/book.service';

// ── Shared helpers ─────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

function isImage(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.substring(dot).toLowerCase());
}

function isHidden(name: string): boolean {
  return name.split('/').some((p) => p.startsWith('.'));
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function mimeForExt(name: string): string {
  return imageContentTypeFromPath(name);
}

// ── CBZ: ZIP byte-offset scan ──────────────────────────────────────────────────

const LFH_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// Data descriptor signature (optional but written by most tools)
const DD_SIG = Buffer.from([0x50, 0x4b, 0x07, 0x08]);

interface ZipEntry {
  name: string;
  dataStart: number;
  compressedSize: number;
  compression: number; // 0 = STORED, 8 = DEFLATE
}

// Scans local file headers directly — bypasses the central directory, which
// unzipper fails to locate when the ZIP has a large comment (e.g. ComicTagger metadata).
//
// When general purpose bit flag bit 3 is set the local header stores
// compressedSize=0 and the real size is in a data descriptor after the data.
// We resolve that by scanning for the descriptor signature and verifying the
// size field is self-consistent (dataStart + cSize === descriptorOffset).
function buildZipIndex(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let pos = 0;

  while (pos < buf.length - 30) {
    const sigPos = buf.indexOf(LFH_SIG, pos);
    if (sigPos === -1) break;

    const flags = buf.readUInt16LE(sigPos + 6);
    const compression = buf.readUInt16LE(sigPos + 8);
    let compressedSize = buf.readUInt32LE(sigPos + 18);
    const fileNameLen = buf.readUInt16LE(sigPos + 26);
    const extraLen = buf.readUInt16LE(sigPos + 28);
    const dataStart = sigPos + 30 + fileNameLen + extraLen;
    const fileName = buf.subarray(sigPos + 30, sigPos + 30 + fileNameLen).toString('utf-8');

    // Bit 3: data descriptor present — local header has size=0.
    if ((flags & 0x0008) !== 0 && compressedSize === 0) {
      compressedSize = resolveDataDescriptorSize(buf, dataStart);
    }

    if (!fileName.endsWith('/') && !isHidden(fileName) && isImage(fileName)) {
      // Only add entries whose size we were able to resolve.
      if ((compression === 0 || compression === 8) && compressedSize > 0) {
        entries.push({ name: fileName, dataStart, compressedSize, compression });
      }
    }

    pos = compressedSize > 0 ? dataStart + compressedSize : sigPos + 4;
  }

  entries.sort((a, b) => naturalSort(a.name, b.name));
  return entries;
}

// Scans forward from dataStart for the data descriptor signature PK\x07\x08.
// Verifies self-consistency: the compressed-size field stored in the descriptor
// must equal (descriptorOffset - dataStart). This eliminates false positives
// where the compressed payload itself happens to contain the signature bytes.
function resolveDataDescriptorSize(buf: Buffer, dataStart: number): number {
  let search = dataStart;
  while (search < buf.length - 16) {
    const idx = buf.indexOf(DD_SIG, search);
    if (idx === -1) break;
    const cSize = buf.readUInt32LE(idx + 8);
    if (idx === dataStart + cSize) return cSize;
    search = idx + 1;
  }
  return 0;
}

// ── CBR: node-unrar-js ─────────────────────────────────────────────────────────

// Buffer.buffer is a shared pool; slice out only the bytes for this buffer.
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ── Service ────────────────────────────────────────────────────────────────────

interface RarCache {
  buffer: ArrayBuffer;
  pages: string[];
}

@Injectable()
export class CbzService {
  // CBZ: byte-offset index per fileId
  private readonly zipIndex = new Map<number, ZipEntry[]>();
  // CBR: archive ArrayBuffer + sorted page names per fileId
  private readonly rarCache = new Map<number, RarCache>();
  // CB7: sorted page names per fileId (extracted files live in WASM VFS)
  private readonly sevenZPages = new Map<number, string[]>();

  constructor(private readonly bookService: BookService) {}

  private async getFile(fileId: number, user: RequestUser) {
    return this.bookService.verifyFileAccess(fileId, user);
  }

  // ── CBZ ──────────────────────────────────────────────────────────────────────

  private async getCbzIndex(fileId: number, filePath: string): Promise<ZipEntry[]> {
    if (!this.zipIndex.has(fileId)) {
      const buf = await readFile(filePath);
      this.zipIndex.set(fileId, buildZipIndex(buf));
    }
    return this.zipIndex.get(fileId)!;
  }

  // ── CBR ──────────────────────────────────────────────────────────────────────

  private async getRarCache(fileId: number, filePath: string): Promise<RarCache> {
    if (!this.rarCache.has(fileId)) {
      const buf = await readFile(filePath);
      const ab = toArrayBuffer(buf);

      const extractor = await createExtractorFromData({ data: ab });
      const { fileHeaders } = extractor.getFileList();

      const pages: string[] = [];
      try {
        for (const h of fileHeaders) {
          if (!h.flags.directory && isImage(h.name) && !isHidden(h.name)) {
            pages.push(h.name);
          }
        }
      } catch (err) {
        // Some RAR 1.5 archives throw ERAR_BAD_DATA at the end-of-archive
        // marker instead of returning ERAR_END_ARCHIVE. If we already have
        // pages, the archive is readable — accept the partial list.
        if (!(err instanceof UnrarError) || pages.length === 0) {
          throw err instanceof UnrarError ? new UnprocessableEntityException(`CBR archive is unreadable: ${err.message}`) : err;
        }
      }

      pages.sort(naturalSort);
      this.rarCache.set(fileId, { buffer: ab, pages });
    }
    return this.rarCache.get(fileId)!;
  }

  private async extractRarPage(buffer: ArrayBuffer, pageName: string): Promise<Uint8Array> {
    const extractor = await createExtractorFromData({ data: buffer });
    // Pass an array so the extractor stops after the first match and never
    // hits the malformed end-of-archive marker present in some RAR 1.5 files.
    const { files } = extractor.extract({ files: [pageName] });

    // Generators MUST be fully drained to avoid WASM memory leak
    let result: Uint8Array | undefined;
    try {
      for (const file of files) {
        if (!file.fileHeader.flags.directory) result = file.extraction;
      }
    } catch (err) {
      if (err instanceof UnrarError) {
        throw new UnprocessableEntityException(`CBR page is unreadable: ${err.message}`);
      }
      throw err;
    }
    if (result === undefined) throw new NotFoundException(`Page not found in RAR archive`);
    return result;
  }

  // ── CB7 ──────────────────────────────────────────────────────────────────────

  private async getSevenZPages(fileId: number, filePath: string): Promise<string[]> {
    if (!this.sevenZPages.has(fileId)) {
      const sz = await getSevenZip();
      const archivePath = `/a${fileId}`;
      const outDir = `/p${fileId}`;

      const buf = await readFile(filePath);
      const fd = sz.FS.open(archivePath, 'w+');
      sz.FS.write(fd, buf, 0, buf.length);
      sz.FS.close(fd);

      try {
        sz.FS.mkdir(outDir);
      } catch {
        // already exists from a previous run
      }

      // callMain is synchronous — blocks the event loop while 7z extracts.
      // Acceptable for a local single-user server; revisit with worker_threads if needed.
      sz.callMain(['e', archivePath, `-o${outDir}`, '-y']);

      const files = sz.FS.readdir(outDir);
      const pages = files.filter((f) => f !== '.' && f !== '..' && isImage(f) && !isHidden(f)).sort(naturalSort);

      this.sevenZPages.set(fileId, pages);
    }
    return this.sevenZPages.get(fileId)!;
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  async getPageCount(fileId: number, user: RequestUser): Promise<number> {
    const file = await this.getFile(fileId, user);
    const fmt = file.format ?? '';

    if (fmt === 'cbz') return (await this.getCbzIndex(fileId, file.absolutePath)).length;
    if (fmt === 'cbr') return (await this.getRarCache(fileId, file.absolutePath)).pages.length;
    if (fmt === 'cb7') return (await this.getSevenZPages(fileId, file.absolutePath)).length;

    throw new NotFoundException(`Unsupported comic format: ${fmt}`);
  }

  async streamPage(fileId: number, pageIndex: number, user: RequestUser): Promise<{ stream: NodeJS.ReadableStream; mimeType: string }> {
    const file = await this.getFile(fileId, user);
    const fmt = file.format ?? '';

    if (fmt === 'cbz') {
      const entries = await this.getCbzIndex(fileId, file.absolutePath);
      if (pageIndex < 0 || pageIndex >= entries.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const entry = entries[pageIndex];
      if (entry.compressedSize === 0) {
        throw new NotFoundException(`Page ${pageIndex} data could not be located in archive`);
      }
      const raw = createReadStream(file.absolutePath, {
        start: entry.dataStart,
        end: entry.dataStart + entry.compressedSize - 1,
      });
      const stream = entry.compression === 0 ? raw : raw.pipe(createInflateRaw());
      return { stream, mimeType: mimeForExt(entry.name) };
    }

    if (fmt === 'cbr') {
      const { buffer, pages } = await this.getRarCache(fileId, file.absolutePath);
      if (pageIndex < 0 || pageIndex >= pages.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const data = await this.extractRarPage(buffer, pages[pageIndex]);
      return { stream: Readable.from(Buffer.from(data)), mimeType: mimeForExt(pages[pageIndex]) };
    }

    if (fmt === 'cb7') {
      const pages = await this.getSevenZPages(fileId, file.absolutePath);
      if (pageIndex < 0 || pageIndex >= pages.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const sz = await getSevenZip();
      const data = sz.FS.readFile(`/p${fileId}/${pages[pageIndex]}`);
      return { stream: Readable.from(Buffer.from(data)), mimeType: mimeForExt(pages[pageIndex]) };
    }

    throw new NotFoundException(`Unsupported comic format: ${fmt}`);
  }
}
