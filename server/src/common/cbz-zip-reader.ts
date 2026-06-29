import { createReadStream } from 'fs';
import { open } from 'fs/promises';
import { Readable } from 'stream';
import { createInflateRaw, inflateRawSync } from 'zlib';

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const UINT32_MAX = 0xffffffff;
const UINT16_MAX = 0xffff;
const MAX_EOCD_SEARCH_BYTES = 65_535 + 22;

type FileHandle = Awaited<ReturnType<typeof open>>;

export interface CbzZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataStart: number;
}

export interface CbzZipIndex {
  entries: CbzZipEntry[];
  comment: string | null;
}

interface EocdInfo {
  cdOffset: number;
  cdSize: number;
  comment: string | null;
}

interface Zip64EntryFields {
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isRangeInside(start: number, length: number, totalSize: number): boolean {
  return isSafeNonNegativeInteger(start) && isSafeNonNegativeInteger(length) && start <= totalSize && length <= totalSize - start;
}

function readUInt64AsSafeNumber(buf: Buffer, offset: number): number | null {
  const value = buf.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

async function readExactly(fh: FileHandle, position: number, length: number): Promise<Buffer | null> {
  if (!isSafeNonNegativeInteger(position) || !isSafeNonNegativeInteger(length)) return null;
  const buf = Buffer.allocUnsafe(length);
  let bytesRead = 0;

  while (bytesRead < length) {
    const result = await fh.read(buf, bytesRead, length - bytesRead, position + bytesRead);
    if (result.bytesRead === 0) return null;
    bytesRead += result.bytesRead;
  }

  return buf;
}

async function readZip64Eocd(fh: FileHandle, eocdOffset: number): Promise<Pick<EocdInfo, 'cdOffset' | 'cdSize'> | null> {
  if (eocdOffset < 20) return null;

  const locator = await readExactly(fh, eocdOffset - 20, 20);
  if (!locator || locator.readUInt32LE(0) !== ZIP64_EOCD_LOCATOR_SIG) return null;

  const zip64EocdOffset = readUInt64AsSafeNumber(locator, 8);
  if (zip64EocdOffset == null) return null;

  const record = await readExactly(fh, zip64EocdOffset, 56);
  if (!record || record.readUInt32LE(0) !== ZIP64_EOCD_SIG) return null;

  const cdSize = readUInt64AsSafeNumber(record, 40);
  const cdOffset = readUInt64AsSafeNumber(record, 48);
  if (cdSize == null || cdOffset == null) return null;

  return { cdOffset, cdSize };
}

async function readEocd(fh: FileHandle, fileSize: number): Promise<EocdInfo | null> {
  if (fileSize < 22) return null;

  const tailLength = Math.min(fileSize, MAX_EOCD_SEARCH_BYTES);
  const tailOffset = fileSize - tailLength;
  const tail = await readExactly(fh, tailOffset, tailLength);
  if (!tail) return null;

  for (let pos = tail.length - 22; pos >= 0; pos--) {
    if (tail.readUInt32LE(pos) !== EOCD_SIG) continue;

    const commentLength = tail.readUInt16LE(pos + 20);
    if (pos + 22 + commentLength !== tail.length) continue;

    const eocdOffset = tailOffset + pos;
    const rawCdSize = tail.readUInt32LE(pos + 12);
    const rawCdOffset = tail.readUInt32LE(pos + 16);
    const totalEntries = tail.readUInt16LE(pos + 10);
    const comment = commentLength > 0 ? tail.subarray(pos + 22).toString('utf-8') : null;

    if (rawCdSize === UINT32_MAX || rawCdOffset === UINT32_MAX || totalEntries === UINT16_MAX) {
      const zip64 = await readZip64Eocd(fh, eocdOffset);
      return zip64 ? { ...zip64, comment } : null;
    }

    return { cdOffset: rawCdOffset, cdSize: rawCdSize, comment };
  }

  return null;
}

function findZip64Extra(extra: Buffer): Buffer | null {
  let pos = 0;

  while (pos + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(pos);
    const dataSize = extra.readUInt16LE(pos + 2);
    const dataStart = pos + 4;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > extra.length) return null;
    if (headerId === ZIP64_EXTRA_FIELD_ID) return extra.subarray(dataStart, dataEnd);
    pos = dataEnd;
  }

  return null;
}

function parseZip64EntryFields(
  rawCompressedSize: number,
  rawUncompressedSize: number,
  rawLocalHeaderOffset: number,
  extra: Buffer,
): Zip64EntryFields | null {
  const needsCompressedSize = rawCompressedSize === UINT32_MAX;
  const needsUncompressedSize = rawUncompressedSize === UINT32_MAX;
  const needsLocalHeaderOffset = rawLocalHeaderOffset === UINT32_MAX;

  if (!needsCompressedSize && !needsUncompressedSize && !needsLocalHeaderOffset) {
    return {
      compressedSize: rawCompressedSize,
      uncompressedSize: rawUncompressedSize,
      localHeaderOffset: rawLocalHeaderOffset,
    };
  }

  const zip64 = findZip64Extra(extra);
  if (!zip64) return null;

  let pos = 0;
  const readNext = (): number | null => {
    if (pos + 8 > zip64.length) return null;
    const value = readUInt64AsSafeNumber(zip64, pos);
    pos += 8;
    return value;
  };

  const uncompressedSize = needsUncompressedSize ? readNext() : rawUncompressedSize;
  const compressedSize = needsCompressedSize ? readNext() : rawCompressedSize;
  const localHeaderOffset = needsLocalHeaderOffset ? readNext() : rawLocalHeaderOffset;

  if (uncompressedSize == null || compressedSize == null || localHeaderOffset == null) return null;
  return { compressedSize, uncompressedSize, localHeaderOffset };
}

async function readDataStart(fh: FileHandle, fileSize: number, localHeaderOffset: number): Promise<number | null> {
  if (!isRangeInside(localHeaderOffset, 30, fileSize)) return null;

  const header = await readExactly(fh, localHeaderOffset, 30);
  if (!header || header.readUInt32LE(0) !== LFH_SIG) return null;

  const fileNameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  if (!isRangeInside(localHeaderOffset, dataStart - localHeaderOffset, fileSize)) return null;

  return dataStart;
}

export async function readCbzZipIndex(filePath: string): Promise<CbzZipIndex | null> {
  let fh: FileHandle | undefined;

  try {
    fh = await open(filePath, 'r');
    const stat = await fh.stat();
    const fileSize = stat.size;
    if (!isSafeNonNegativeInteger(fileSize)) return null;

    const eocd = await readEocd(fh, fileSize);
    if (!eocd || !isRangeInside(eocd.cdOffset, eocd.cdSize, fileSize)) return null;

    const entries: CbzZipEntry[] = [];
    const cdEnd = eocd.cdOffset + eocd.cdSize;
    let pos = eocd.cdOffset;

    while (pos + 46 <= cdEnd) {
      const fixed = await readExactly(fh, pos, 46);
      if (!fixed) return null;
      if (fixed.readUInt32LE(0) !== CDFH_SIG) break;

      const compression = fixed.readUInt16LE(10);
      const rawCompressedSize = fixed.readUInt32LE(20);
      const rawUncompressedSize = fixed.readUInt32LE(24);
      const fileNameLength = fixed.readUInt16LE(28);
      const extraLength = fixed.readUInt16LE(30);
      const commentLength = fixed.readUInt16LE(32);
      const rawLocalHeaderOffset = fixed.readUInt32LE(42);
      const variableLength = fileNameLength + extraLength + commentLength;
      const nextPos = pos + 46 + variableLength;

      if (nextPos > cdEnd) return null;

      const variable = await readExactly(fh, pos + 46, variableLength);
      if (!variable) return null;

      const name = variable.subarray(0, fileNameLength).toString('utf-8');
      const extra = variable.subarray(fileNameLength, fileNameLength + extraLength);
      const zip64Fields = parseZip64EntryFields(rawCompressedSize, rawUncompressedSize, rawLocalHeaderOffset, extra);
      if (zip64Fields && isRangeInside(zip64Fields.localHeaderOffset, 30, fileSize)) {
        const dataStart = await readDataStart(fh, fileSize, zip64Fields.localHeaderOffset);
        if (dataStart != null && isRangeInside(dataStart, zip64Fields.compressedSize, fileSize)) {
          entries.push({
            name,
            compression,
            compressedSize: zip64Fields.compressedSize,
            uncompressedSize: zip64Fields.uncompressedSize,
            localHeaderOffset: zip64Fields.localHeaderOffset,
            dataStart,
          });
        }
      }

      pos = nextPos;
    }

    return { entries, comment: eocd.comment };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

export function isSupportedCbzZipCompression(entry: CbzZipEntry): boolean {
  return entry.compression === 0 || entry.compression === 8;
}

export function createCbzZipEntryReadStream(filePath: string, entry: CbzZipEntry): NodeJS.ReadableStream {
  if (!isSupportedCbzZipCompression(entry)) {
    throw new Error(`Unsupported ZIP compression method: ${entry.compression}`);
  }
  if (entry.compressedSize === 0) {
    return Readable.from(Buffer.alloc(0));
  }

  const raw = createReadStream(filePath, {
    start: entry.dataStart,
    end: entry.dataStart + entry.compressedSize - 1,
  });

  return entry.compression === 0 ? raw : raw.pipe(createInflateRaw());
}

export async function extractCbzZipEntry(filePath: string, entry: CbzZipEntry): Promise<Buffer | null> {
  if (!isSupportedCbzZipCompression(entry)) return null;

  let fh: FileHandle | undefined;
  try {
    fh = await open(filePath, 'r');
    const payload = await readExactly(fh, entry.dataStart, entry.compressedSize);
    if (!payload) return null;
    return entry.compression === 0 ? payload : inflateRawSync(payload);
  } finally {
    await fh?.close();
  }
}
