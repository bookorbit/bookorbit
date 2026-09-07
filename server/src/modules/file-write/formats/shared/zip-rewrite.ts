import { createWriteStream } from 'fs';
import type { Readable } from 'stream';
import { ZipArchive, type Archiver } from 'archiver';

const ZLIB_COMPRESSION_LEVEL = 6;

export interface ZipRewriteEntry {
  name: string;
  source: Buffer | (() => Readable);
  store?: boolean;
}

export interface ZipRewriteOptions {
  comment?: string;
}

/**
 * Archiver pipes an appended stream into its queue immediately, so appending every entry of a large
 * archive up front holds one descriptor and one decompression buffer per entry until the rewrite
 * finishes. Entries are appended one at a time and their sources opened only once archiver is ready
 * for them, which keeps descriptors and memory flat regardless of entry count.
 */
export async function writeZipArchive(tmpPath: string, entries: Iterable<ZipRewriteEntry>, options: ZipRewriteOptions = {}): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: ZLIB_COMPRESSION_LEVEL }, comment: options.comment });
  const output = createWriteStream(tmpPath);

  let fail!: (error: Error) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  // The losing side of every race below stays rejected; keep it handled so it can never surface as
  // an unhandled rejection.
  failure.catch(() => {});

  archive.on('error', fail);
  output.on('error', fail);
  const closed = new Promise<void>((resolve) => output.once('close', resolve));
  archive.pipe(output);

  try {
    for (const entry of entries) {
      await Promise.race([appendEntry(archive, entry, fail), failure]);
    }
    void archive.finalize();
    await Promise.race([closed, failure]);
  } catch (error) {
    output.destroy();
    throw error;
  }
}

function appendEntry(archive: Archiver, entry: ZipRewriteEntry, fail: (error: Error) => void): Promise<void> {
  return new Promise((resolve) => {
    const source = typeof entry.source === 'function' ? entry.source() : entry.source;
    if (!Buffer.isBuffer(source)) source.once('error', fail);
    archive.once('entry', () => resolve());
    archive.append(source, entry.store ? { name: entry.name, store: true } : { name: entry.name });
  });
}
