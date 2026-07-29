import type { FileHandle } from 'fs/promises';

import { readAttribute } from './fb2-element-scanner';

/**
 * FB2 embeds images as base64 <binary> elements after the book body, and a
 * single cover can be hundreds of kilobytes. These helpers locate spans by
 * scanning the file in fixed-size chunks so replacing a cover never needs the
 * whole document in memory.
 */

const CHUNK_BYTES = 256 * 1024;
const BINARY_OPEN = '<binary';
const BINARY_CLOSE = '</binary>';
const ROOT_CLOSE = '</FictionBook';
/**
 * Chunks overlap by this much so any marker or <binary> start tag that straddles
 * a boundary appears whole in the following chunk. Re-seeing an element in the
 * overlap is harmless: a non-matching id is skipped either way.
 */
const OVERLAP_BYTES = 1024;

export type ByteSpan = { start: number; end: number };

/**
 * Finds the full span of the <binary> element carrying the given id, searching
 * from `from` to the end of the file. Returns null when no such element exists.
 */
export async function findBinarySpan(handle: FileHandle, id: string, from: number, fileSize: number): Promise<ByteSpan | null> {
  const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, Math.max(fileSize - from, 1)));
  let position = from;
  let carry = '';
  let carryStart = from;
  let openAt: number | null = null;

  while (position < fileSize) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, fileSize - position), position);
    if (bytesRead === 0) break;

    // Markup is ASCII in every encoding this writer accepts, so latin1 keeps one
    // character per byte and offsets stay byte-accurate.
    const chunk = carry + buffer.subarray(0, bytesRead).toString('latin1');
    const chunkStart = carryStart;
    const isLastChunk = position + bytesRead >= fileSize;
    let cursor = 0;

    while (cursor < chunk.length) {
      if (openAt === null) {
        const at = chunk.indexOf(BINARY_OPEN, cursor);
        if (at < 0) break;
        const tagEnd = chunk.indexOf('>', at);
        if (tagEnd < 0) break;
        if (readAttribute(chunk.slice(at, tagEnd + 1), 'id') === id) {
          openAt = chunkStart + at;
        }
        cursor = tagEnd + 1;
        continue;
      }

      const closeAt = chunk.indexOf(BINARY_CLOSE, cursor);
      if (closeAt < 0) break;
      return { start: openAt, end: chunkStart + closeAt + BINARY_CLOSE.length };
    }

    if (isLastChunk) break;
    position += bytesRead;
    carry = chunk.slice(Math.max(0, chunk.length - OVERLAP_BYTES));
    carryStart = position - carry.length;
  }

  return null;
}

/** Finds the offset of the root closing tag, scanning backwards from the end. */
export async function findRootCloseOffset(handle: FileHandle, fileSize: number): Promise<number | null> {
  const window = Math.min(CHUNK_BYTES, fileSize);
  const buffer = Buffer.alloc(Math.max(window, 1));
  const windowStart = Math.max(0, fileSize - window);
  const { bytesRead } = await handle.read(buffer, 0, window, windowStart);
  const at = buffer.subarray(0, bytesRead).toString('latin1').lastIndexOf(ROOT_CLOSE);
  if (at < 0) return null;
  return windowStart + at;
}

/** Serializes cover bytes as a base64 <binary> element, wrapped at 76 columns. */
export function buildBinaryElement(id: string, contentType: string, bytes: Buffer): string {
  const base64 = bytes
    .toString('base64')
    .replace(/(.{76})/g, '$1\n')
    .replace(/\n$/, '');
  const escapedId = id.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<binary id="${escapedId}" content-type="${contentType}">${base64}</binary>`;
}
