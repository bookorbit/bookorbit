import { Injectable, NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { createInflateRaw } from 'zlib';

import { BookRepository } from '../book/book.repository';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);
const LFH_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function isImage(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.substring(dot).toLowerCase());
}

function isHidden(name: string): boolean {
  return name.split('/').some((p) => p.startsWith('.'));
}

interface PageEntry {
  name: string;
  dataStart: number; // byte offset of compressed data in the ZIP file
  compressedSize: number;
  compression: number; // 0 = STORED, 8 = DEFLATE
}

// Scan all local file headers in the buffer and return image entries sorted naturally.
// Same technique as cover-cbz.ts — bypasses the central directory, which unzipper
// fails to locate when the ZIP has a large comment (e.g. ComicTagger JSON metadata).
function buildPageIndex(buf: Buffer): PageEntry[] {
  const entries: PageEntry[] = [];
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
    if (compressedSize === 0) pos = sigPos + 4; // guard against infinite loop on data descriptors
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return entries;
}

@Injectable()
export class CbzService {
  // Caches sorted page entries per fileId — built once on first access, held for server lifetime.
  private readonly indexCache = new Map<number, PageEntry[]>();

  constructor(private readonly bookRepo: BookRepository) {}

  private async getIndex(fileId: number): Promise<{ path: string; entries: PageEntry[] }> {
    const file = await this.bookRepo.findFileById(fileId);
    if (!file) throw new NotFoundException(`File ${fileId} not found`);

    if (!this.indexCache.has(fileId)) {
      const buf = await readFile(file.absolutePath);
      this.indexCache.set(fileId, buildPageIndex(buf));
    }

    return { path: file.absolutePath, entries: this.indexCache.get(fileId)! };
  }

  async getPageCount(fileId: number): Promise<number> {
    const { entries } = await this.getIndex(fileId);
    return entries.length;
  }

  async streamPage(fileId: number, pageIndex: number): Promise<{ stream: NodeJS.ReadableStream; mimeType: string }> {
    const { path, entries } = await this.getIndex(fileId);

    if (pageIndex < 0 || pageIndex >= entries.length) {
      throw new NotFoundException(`Page ${pageIndex} out of range (0–${entries.length - 1})`);
    }

    const entry = entries[pageIndex];
    const ext = entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    const raw = createReadStream(path, { start: entry.dataStart, end: entry.dataStart + entry.compressedSize - 1 });
    const stream = entry.compression === 0 ? raw : raw.pipe(createInflateRaw());

    return { stream, mimeType };
  }
}
