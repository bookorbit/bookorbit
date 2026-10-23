import { UnprocessableEntityException } from '@nestjs/common';
import type { FileHandle } from 'fs/promises';

export const DJVU_LIMITS = {
  maxPages: 20_000,
  maxChunks: 200_000,
  maxSourcePixels: 40_000_000,
  maxRenderSize: 2560,
  maxOutputBytes: 64 * 1024 * 1024,
  maxDocuments: 4,
  maxSourceCacheBytes: 512 * 1024 * 1024,
  maxPageCacheEntries: 128,
  maxKnownPageCounts: 1024,
  maxQueuedRequests: 16,
  coverRenderSize: 1280,
} as const;

function invalid(): never {
  throw new UnprocessableEntityException({ code: 'DJVU_INVALID', message: 'Unsupported or invalid self-contained DjVu document' });
}

async function bytes(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const result = await handle.read(buffer, 0, length, position);
  if (result.bytesRead !== length) invalid();
  return buffer;
}

/** Validate the IFF structure before native decoding; component references must stay internal. */
export async function validateDjvuContainer(handle: FileHandle, size: number): Promise<number> {
  if (size < 16) invalid();
  const header = await bytes(handle, 0, 16);
  const kind = header.toString('ascii', 12, 16);
  // DjVuLibre ignores bytes after the top-level form, and some encoders leave padding there.
  const formEnd = header.readUInt32BE(8) + 12;
  if (header.toString('ascii', 0, 8) !== 'AT&TFORM' || !['DJVU', 'DJVM'].includes(kind) || formEnd > size) invalid();
  let pages = 0;
  let chunks = 0;
  let directory = false;
  let references = 0;
  const componentOffsets: number[] = [];
  const directoryOffsets: number[] = [];

  async function scan(start: number, end: number, form: string, depth: number): Promise<void> {
    let info = false;
    if (depth > 1) invalid();
    for (let offset = start; offset < end;) {
      if (++chunks > DJVU_LIMITS.maxChunks || end - offset < 8) invalid();
      const chunk = await bytes(handle, offset, 8);
      const id = chunk.toString('ascii', 0, 4);
      const length = chunk.readUInt32BE(4);
      const payload = offset + 8;
      const next = payload + length;
      if (next > end) invalid();
      if (id === 'FORM') {
        if (form !== 'DJVM' || length < 4) invalid();
        const child = (await bytes(handle, payload, 4)).toString('ascii');
        if (!['DJVU', 'DJVI', 'THUM'].includes(child)) invalid();
        componentOffsets.push(offset);
        await scan(payload + 4, next, child, depth + 1);
      } else if (id === 'DIRM') {
        if (form !== 'DJVM' || directory || length < 3) invalid();
        const flags = await bytes(handle, payload, 3);
        if ((flags[0] & 0x80) === 0 || (flags[0] & 0x7f) !== 1) invalid();
        const count = flags.readUInt16BE(1);
        if (!count || count > DJVU_LIMITS.maxPages * 2 || length < 3 + count * 4) invalid();
        const offsets = await bytes(handle, payload + 3, count * 4);
        for (let index = 0; index < count; index++) directoryOffsets.push(offsets.readUInt32BE(index * 4));
        directory = true;
      } else if (id === 'INCL') {
        if (length === 0 || length > 255 || form === 'THUM') invalid();
        const name = (await bytes(handle, payload, length)).toString('utf8');
        if (
          name === '.' ||
          name === '..' ||
          [...name].some((character) => '/\\:'.includes(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
        )
          invalid();
        references++;
      } else if (id === 'INFO') {
        if (form !== 'DJVU' || info || length < 10) invalid();
        const dimensions = await bytes(handle, payload, 4);
        const width = dimensions.readUInt16BE(0);
        const height = dimensions.readUInt16BE(2);
        if (!width || !height || width * height > DJVU_LIMITS.maxSourcePixels) invalid();
        info = true;
      }
      offset = next + (length % 2 && next < end ? 1 : 0);
    }
    if (form === 'DJVU') {
      if (!info || ++pages > DJVU_LIMITS.maxPages) invalid();
    }
  }

  await scan(16, formEnd, kind, 0);
  if (!pages || (kind === 'DJVM' && !directory) || (kind === 'DJVU' && references)) invalid();
  const components = new Set(componentOffsets);
  if (
    kind === 'DJVM' &&
    (directoryOffsets.length !== componentOffsets.length ||
      new Set(directoryOffsets).size !== directoryOffsets.length ||
      directoryOffsets.some((offset) => !components.has(offset)))
  )
    invalid();
  return pages;
}
