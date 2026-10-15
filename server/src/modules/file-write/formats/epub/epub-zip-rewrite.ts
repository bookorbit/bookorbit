import { open, unlink, type FileHandle } from 'fs/promises';
import { promisify } from 'util';
import { crc32, deflateRaw } from 'zlib';
import { Reader, Writer, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter, type CreateReadableOptions, type Entry } from '@zip.js/zip.js';

const MAX_READ_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 100_000;
const COPY_CHUNK_BYTES = 256 * 1024;
const compress = promisify(deflateRaw);

class FileReader extends Reader<FileHandle> {
  constructor(
    private readonly file: FileHandle,
    size: number,
  ) {
    super(file);
    this.size = size;
  }

  override createReadable(options: CreateReadableOptions = {}): ReadableStream<Uint8Array> {
    return super.createReadable({ ...options, chunkSize: COPY_CHUNK_BYTES });
  }

  override async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(length) || index < 0 || index > this.size || length < 0) {
      throw new Error('Invalid EPUB ZIP read range');
    }
    const size = Math.min(length, this.size - index);
    // zip.js reads the central directory in one allocation, but streams unchanged entry records.
    if (size > MAX_READ_BYTES) throw new Error('EPUB ZIP directory exceeds the read limit');
    const buffer = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await this.file.read(buffer, offset, size - offset, index + offset);
      if (!bytesRead) throw new Error('EPUB ZIP was truncated during write-back');
      offset += bytesRead;
    }
    return buffer;
  }
}

class FileWriter extends Writer<void> {
  constructor(private readonly file: FileHandle) {
    super();
  }

  override async writeUint8Array(data: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < data.length) {
      const { bytesWritten } = await this.file.write(data, offset, data.length - offset);
      if (!bytesWritten) throw new Error('EPUB ZIP write made no progress');
      offset += bytesWritten;
    }
  }

  override async getData(): Promise<void> {}
}

export async function rewriteEpubZip(filePath: string, tmpPath: string, patches: ReadonlyMap<string, Buffer>): Promise<void> {
  for (const [name, content] of patches) {
    if (
      !name ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.includes('\0') ||
      /^[a-z][a-z\d+.-]*:/i.test(name) ||
      name.split('/').includes('..')
    ) {
      throw new Error('Invalid EPUB ZIP replacement path');
    }
    if (content.length > MAX_READ_BYTES) throw new Error('EPUB ZIP replacement exceeds the size limit');
  }
  const source = await open(filePath, 'r');
  let output: FileHandle | undefined;
  let completed = false;
  try {
    try {
      const original = await source.stat();
      if (!Number.isSafeInteger(original.size)) throw new Error('EPUB ZIP size exceeds the supported range');
      const reader = new FileReader(source, original.size);
      const readerOptions = { filenameEncoding: 'utf-8' };
      const zipReader = new ZipReader(reader, readerOptions);
      const replacements = new Map<string, Entry>();
      const names = new Set<string>();
      const offsets = new Set<number>();
      try {
        for await (const entry of zipReader.getEntriesGenerator()) {
          if (names.size >= MAX_ENTRIES) throw new Error('EPUB ZIP entry count exceeds the limit');
          if (names.has(entry.filename) || offsets.has(entry.offset)) throw new Error('EPUB ZIP contains duplicate entries');
          names.add(entry.filename);
          offsets.add(entry.offset);
          if (!entry.directory) {
            // Validate header agreement and bounds without reading or inflating the entry payload.
            await entry.getData(new Uint8ArrayWriter(), {
              passThrough: true,
              checkLocalDirectory: true,
              checkLocalFilename: true,
              checkOverlappingEntryOnly: true,
            });
          }
          if (patches.has(entry.filename)) replacements.set(entry.filename, entry);
        }
      } finally {
        await zipReader.close();
      }
      const addedCount = [...patches.keys()].filter((name) => name !== 'mimetype' && !names.has(name)).length;
      if (names.size + addedCount + Number(!names.has('mimetype')) > MAX_ENTRIES) throw new Error('EPUB ZIP entry count exceeds the limit');

      output = await open(tmpPath, 'wx');
      const writer = new ZipWriter(new FileWriter(output), { useWebWorkers: false, extendedTimestamp: false, dataDescriptor: false });
      const mimetype = Buffer.from('application/epub+zip');
      await writer.add('mimetype', new Uint8ArrayReader(mimetype), {
        passThrough: true,
        compressionMethod: 0,
        uncompressedSize: mimetype.length,
        crc32: crc32(mimetype),
        zip64: false,
      });
      // Copy local headers, compressed bytes and descriptors verbatim; only directory offsets change.
      await writer.appendZip(reader, { readerOptions, filter: (entry) => entry.filename !== 'mimetype' && !patches.has(entry.filename) });
      for (const [name, content] of patches) {
        if (name === 'mimetype') continue;
        const compressed = await compress(content, { level: 6 });
        const stored = compressed.length >= content.length;
        const previous = replacements.get(name);
        await writer.add(name, new Uint8ArrayReader(stored ? content : compressed), {
          passThrough: true,
          compressionMethod: stored ? 0 : 8,
          uncompressedSize: content.length,
          crc32: crc32(content),
          rawLastModDate: previous ? Number(previous.rawLastModDate) : undefined,
          externalFileAttributes: previous?.externalFileAttributes,
          internalFileAttributes: previous?.internalFileAttributes,
          versionMadeBy: previous?.versionMadeBy,
          comment: previous?.comment,
        });
      }
      await writer.close(zipReader.comment);
      const current = await source.stat();
      if (current.size !== original.size || current.mtimeMs !== original.mtimeMs || current.ctimeMs !== original.ctimeMs) {
        throw new Error('EPUB changed during write-back');
      }
      await output.sync();
    } finally {
      try {
        await output?.close();
      } finally {
        await source.close();
      }
    }
    completed = true;
  } finally {
    if (!completed && output) await unlink(tmpPath).catch(() => {});
  }
}
