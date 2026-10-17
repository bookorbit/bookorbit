import { createReadStream } from 'fs';
import { pipeline, Readable } from 'stream';
import type * as unzipper from 'unzipper';
import { createInflateRaw } from 'zlib';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_FILE_HEADER_LENGTH = 30;
const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATED = 8;
const FLAG_ENCRYPTED = 0x01;

async function readBytes(path: string, start: number, length: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(path, { start, end: start + length - 1 })) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** The entry's data follows its local header, whose name and extra field can differ in length from the central directory's. */
async function entryDataOffset(archivePath: string, entry: unzipper.File): Promise<number> {
  const header = await readBytes(archivePath, entry.offsetToLocalFileHeader, LOCAL_FILE_HEADER_LENGTH);
  if (header.length < LOCAL_FILE_HEADER_LENGTH || header.readUInt32LE(0) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`Invalid local file header for zip entry: ${entry.path}`);
  }
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  return entry.offsetToLocalFileHeader + LOCAL_FILE_HEADER_LENGTH + nameLength + extraLength;
}

async function* inflatedSlice(archivePath: string, dataStart: number, compressedSize: number, skip: number, take: number): AsyncGenerator<Buffer> {
  // Leaving the loop early destroys the inflater, and pipeline then closes the file.
  const inflated = pipeline(createReadStream(archivePath, { start: dataStart, end: dataStart + compressedSize - 1 }), createInflateRaw(), () => {});
  let toSkip = skip;
  let remaining = take;
  for await (const chunk of inflated as AsyncIterable<Buffer>) {
    if (toSkip >= chunk.length) {
      toSkip -= chunk.length;
      continue;
    }
    const slice = chunk.subarray(toSkip, toSkip + remaining);
    toSkip = 0;
    remaining -= slice.length;
    yield slice;
    if (remaining === 0) return;
  }
  throw new Error('Zip entry ended before the requested range');
}

/**
 * Bytes `start` to `end` (inclusive) of a zip entry's uncompressed content, read without holding
 * the entry in memory. A stored entry, as narration audio usually is, is read straight from its
 * offset; a deflated one is inflated from the start and the bytes before `start` dropped.
 */
export async function openEpubZipEntryRange(archivePath: string, entry: unzipper.File, start: number, end: number): Promise<Readable> {
  if (start < 0 || end < start || end >= entry.uncompressedSize) {
    throw new RangeError(`Range ${start}-${end} is outside zip entry ${entry.path}`);
  }
  if (entry.flags & FLAG_ENCRYPTED) throw new Error(`Encrypted zip entry: ${entry.path}`);
  const dataStart = await entryDataOffset(archivePath, entry);

  if (entry.compressionMethod === COMPRESSION_STORED) {
    if (entry.compressedSize !== entry.uncompressedSize) throw new Error(`Stored zip entry sizes disagree: ${entry.path}`);
    return createReadStream(archivePath, { start: dataStart + start, end: dataStart + end });
  }
  if (entry.compressionMethod === COMPRESSION_DEFLATED) {
    return Readable.from(inflatedSlice(archivePath, dataStart, entry.compressedSize, start, end - start + 1), { objectMode: false });
  }
  throw new Error(`Unsupported compression method ${entry.compressionMethod} for zip entry: ${entry.path}`);
}
