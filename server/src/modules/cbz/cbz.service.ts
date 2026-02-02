import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { createInflateRaw } from 'zlib';
import { createExtractorFromData } from 'node-unrar-js';
import { getSevenZip } from '../../common/sevenzip';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';

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
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

// ── CBZ: ZIP byte-offset scan ──────────────────────────────────────────────────

const LFH_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

interface ZipEntry {
  name: string;
  dataStart: number;
  compressedSize: number;
  compression: number; // 0 = STORED, 8 = DEFLATE
}

// Scans local file headers directly — bypasses the central directory, which
// unzipper fails to locate when the ZIP has a large comment (e.g. ComicTagger metadata).
function buildZipIndex(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let pos = 0;

  while (pos < buf.length - 30) {
    const sigPos = buf.indexOf(LFH_SIG, pos);
    if (sigPos === -1) break;

    const compression = buf.readUInt16LE(sigPos + 8);
    const compressedSize = buf.readUInt32LE(sigPos + 18);
    const fileNameLen = buf.readUInt16LE(sigPos + 26);
    const extraLen = buf.readUInt16LE(sigPos + 28);
    const dataStart = sigPos + 30 + fileNameLen + extraLen;
    const fileName = buf.subarray(sigPos + 30, sigPos + 30 + fileNameLen).toString('utf-8');

    if (!fileName.endsWith('/') && !isHidden(fileName) && isImage(fileName)) {
      if (compression === 0 || compression === 8) {
        entries.push({ name: fileName, dataStart, compressedSize, compression });
      }
    }

    pos = dataStart + compressedSize;
    if (compressedSize === 0) pos = sigPos + 4;
  }

  entries.sort((a, b) => naturalSort(a.name, b.name));
  return entries;
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
      const pages = [...fileHeaders]
        .filter((h) => !h.flags.directory && isImage(h.name) && !isHidden(h.name))
        .map((h) => h.name)
        .sort(naturalSort);

      this.rarCache.set(fileId, { buffer: ab, pages });
    }
    return this.rarCache.get(fileId)!;
  }

  private async extractRarPage(buffer: ArrayBuffer, pageName: string): Promise<Uint8Array> {
    const extractor = await createExtractorFromData({ data: buffer });
    const { files } = extractor.extract({ files: (h) => h.name === pageName });

    // Generators MUST be fully drained to avoid WASM memory leak
    let result: Uint8Array | undefined;
    for (const file of files) {
      if (!file.fileHeader.flags.directory) result = file.extraction;
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
