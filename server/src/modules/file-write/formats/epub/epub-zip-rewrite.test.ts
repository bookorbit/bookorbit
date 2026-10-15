import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { crc32, deflateRawSync, inflateRawSync } from 'zlib';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter, type ZipWriterConstructorOptions } from '@zip.js/zip.js';
import * as unzipper from 'unzipper';
import { patch } from './epub-zip-patcher';
import { rewriteEpubZip } from './epub-zip-rewrite';

vi.mock('fs/promises', async () => ({ ...(await vi.importActual<typeof fs>('fs/promises')) }));

let root: string;
let filePath: string;
let tmpPath: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'epub-raw-copy-'));
  filePath = join(root, 'book.epub');
  tmpPath = join(root, 'rewrite.tmp');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

const contents = new Map([
  ['mimetype', Buffer.from('application/epub+zip')],
  ['OPS/content.opf', Buffer.from('<package><title>Old</title></package>')],
  ['OPS/images/stored.jpg', Buffer.from('original JPEG bytes'.repeat(100))],
  ['OPS/images/packed.png', Buffer.alloc(10_000)],
  ['OPS/chapter.xhtml', Buffer.from('<html>chapter</html>'.repeat(1000))],
  ['OPS/fonts/文書.otf', Buffer.from('obfuscated font bytes'.repeat(100))],
  ['OPS/empty', Buffer.alloc(0)],
  ['OPS/directory/', Buffer.alloc(0)],
]);

async function fixture(options: ZipWriterConstructorOptions = {}): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, extendedTimestamp: false, ...options });
  for (const [name, content] of contents) {
    const stored = name === 'mimetype' || name.endsWith('.jpg') || name.endsWith('/') || name.endsWith('empty');
    await writer.add(name, new Uint8ArrayReader(stored ? content : deflateRawSync(content, { level: 1 })), {
      passThrough: true,
      compressionMethod: stored ? 0 : 8,
      uncompressedSize: content.length,
      crc32: crc32(content),
      directory: name.endsWith('/'),
      lastModDate: new Date('2020-01-02T03:04:06Z'),
      comment: 'entry comment',
      extraField: new Map([[0xcafe, new Uint8Array([1, 2, 3])]]),
      externalFileAttributes: 0x81a40000,
      internalFileAttributes: 1,
    });
  }
  return Buffer.from(await writer.close(new Uint8Array([0xff, 0, 0x42])));
}

async function snapshot(bytes: Buffer) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const entries = await reader.getEntries();
  const ordered = [...entries].sort((a, b) => a.offset - b.offset);
  const records = new Map(
    ordered.map((entry, index) => [entry.filename, bytes.subarray(entry.offset, ordered[index + 1]?.offset ?? reader.directoryOffset)]),
  );
  await reader.close();
  return { entries: new Map(entries.map((entry) => [entry.filename, entry])), records, comment: reader.comment };
}

function centralRecords(bytes: Buffer): number[] {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const offsets: number[] = [];
  let offset = bytes.readUInt32LE(eocd + 16);
  while (bytes.readUInt32LE(offset) === 0x02014b50) {
    offsets.push(offset);
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return offsets;
}

describe('raw EPUB ZIP rewrite', () => {
  it.each([
    { dataDescriptor: false },
    { dataDescriptor: true, dataDescriptorSignature: true },
    { dataDescriptor: true, dataDescriptorSignature: false },
    { zip64: true, dataDescriptor: true, dataDescriptorSignature: true },
    { zip64: true, dataDescriptor: true, dataDescriptorSignature: false },
  ])('preserves complete unchanged local records with %j', async (options) => {
    const original = await fixture(options);
    await fs.writeFile(filePath, original);
    await fs.chmod(filePath, 0o640);
    const before = await snapshot(original);
    const newOpf = Buffer.from('<package><title>Updated title</title></package>');
    const cover = Buffer.from('new cover image bytes');
    for (let save = 0; save < 2; save++) {
      await patch(
        filePath,
        new Map([
          ['OPS/content.opf', newOpf],
          ['OPS/images/new-cover.jpg', cover],
        ]),
      );
      const bytes = await fs.readFile(filePath);
      const after = await snapshot(bytes);
      const independent = await unzipper.Open.file(filePath);
      const decoded = new Map(independent.files.map((entry) => [entry.path, entry]));
      expect(after.comment).toEqual(before.comment);
      expect(after.entries.size).toBe(contents.size + 1);
      for (const [name, content] of contents) {
        if (name === 'mimetype' || name.endsWith('.opf')) continue;
        const oldEntry = before.entries.get(name)!;
        const newEntry = after.entries.get(name)!;
        expect(after.records.get(name), name).toEqual(before.records.get(name));
        expect(newEntry.compressionMethod).toBe(oldEntry.compressionMethod);
        expect(newEntry.compressedSize).toBe(oldEntry.compressedSize);
        expect(newEntry.crc32).toBe(oldEntry.crc32);
        expect(newEntry.rawExtraField).toEqual(oldEntry.rawExtraField);
        expect(newEntry.rawComment).toEqual(oldEntry.rawComment);
        expect(newEntry.externalFileAttributes).toBe(oldEntry.externalFileAttributes);
        expect(newEntry.internalFileAttributes).toBe(oldEntry.internalFileAttributes);
        const record = after.records.get(name)!;
        const dataOffset = 30 + record.readUInt16LE(26) + record.readUInt16LE(28);
        const payload = record.subarray(dataOffset, dataOffset + newEntry.compressedSize);
        const decodedBytes = newEntry.compressionMethod === 0 ? payload : inflateRawSync(payload);
        expect(decodedBytes).toEqual(content);
        expect(crc32(decodedBytes)).toBe(newEntry.crc32);
        // unzipper cannot read empty stored entries with unsigned descriptors; native decoding covers them.
        if (content.length > 0) await expect(decoded.get(name)!.buffer()).resolves.toEqual(content);
      }
      await expect(decoded.get('OPS/content.opf')!.buffer()).resolves.toEqual(newOpf);
      await expect(decoded.get('OPS/images/new-cover.jpg')!.buffer()).resolves.toEqual(cover);
      expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
      expect(bytes.readUInt16LE(8)).toBe(0);
      expect(bytes.readUInt16LE(6) & 9).toBe(0);
      expect(bytes.readUInt16LE(28)).toBe(0);
      expect(bytes.subarray(30, 38).toString()).toBe('mimetype');
      expect(bytes.subarray(38, 58).toString()).toBe('application/epub+zip');
      expect((await fs.stat(filePath)).mode & 0o777).toBe(0o640);
    }
    expect(await fs.readdir(root)).toEqual(['book.epub']);
  });

  it('retains UTF-8 filenames from producers that omit the UTF-8 flag', async () => {
    const original = await fixture();
    const before = await snapshot(original);
    const name = 'OPS/fonts/文書.otf';
    const entry = before.entries.get(name)!;
    original.writeUInt16LE(original.readUInt16LE(entry.offset + 6) & ~0x800, entry.offset + 6);
    const central = centralRecords(original).find(
      (offset) => original.subarray(offset + 46, offset + 46 + original.readUInt16LE(offset + 28)).toString() === name,
    )!;
    original.writeUInt16LE(original.readUInt16LE(central + 8) & ~0x800, central + 8);
    await fs.writeFile(filePath, original);
    await patch(filePath, new Map());
    const after = await unzipper.Open.file(filePath);
    await expect(after.files.find((entry) => entry.path === name)!.buffer()).resolves.toEqual(contents.get(name));
  });

  it.each([
    'local signature',
    'local filename',
    'local compression',
    'local flags',
    'overlap',
    'duplicate name',
    'duplicate offset',
    'truncated directory',
  ])('keeps the original intact for %s corruption', async (kind) => {
    const original = await fixture({ dataDescriptor: false });
    const records = centralRecords(original);
    const before = await snapshot(original);
    const chapterOffset = before.entries.get('OPS/chapter.xhtml')!.offset;
    if (kind === 'local signature') original.writeUInt32LE(0, chapterOffset);
    if (kind === 'local filename') original[chapterOffset + 30] = 0x2e;
    if (kind === 'local compression') original.writeUInt16LE(0, chapterOffset + 8);
    if (kind === 'local flags') original.writeUInt16LE(1, chapterOffset + 6);
    if (kind === 'overlap') original.writeUInt32LE(original.length, records[4]! + 20);
    if (kind === 'duplicate name') {
      const first = records[2]!;
      const second = records[3]!;
      const name = original.subarray(first + 46, first + 46 + original.readUInt16LE(first + 28));
      expect(name.length).toBe(original.readUInt16LE(second + 28));
      name.copy(original, second + 46);
    }
    if (kind === 'duplicate offset') original.writeUInt32LE(original.readUInt32LE(records[2]! + 42), records[3]! + 42);
    const input = kind === 'truncated directory' ? original.subarray(0, original.length - 10) : original;
    await fs.writeFile(filePath, input);
    await expect(patch(filePath, new Map([['OPS/content.opf', Buffer.from('updated')]]))).rejects.toThrow();
    await expect(fs.readFile(filePath)).resolves.toEqual(input);
    expect(await fs.readdir(root)).toEqual(['book.epub']);
  });

  it.each(['../escape', '/path/to/escape', 'file:escape', 'OPS/../../escape', 'OPS\\escape', 'OPS/\0escape'])(
    'rejects unsafe replacement path %j',
    async (name) => {
      const original = await fixture();
      await fs.writeFile(filePath, original);
      await expect(patch(filePath, new Map([[name, Buffer.from('unsafe')]]))).rejects.toThrow('replacement path');
      await expect(fs.readFile(filePath)).resolves.toEqual(original);
      expect(await fs.readdir(root)).toEqual(['book.epub']);
    },
  );

  it('never overwrites or removes an existing temporary file', async () => {
    await fs.writeFile(filePath, await fixture());
    await fs.writeFile(tmpPath, 'user-owned');
    await expect(rewriteEpubZip(filePath, tmpPath, new Map())).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(fs.readFile(tmpPath, 'utf8')).resolves.toBe('user-owned');
  });

  it.each(['read', 'write', 'sync', 'zero read', 'zero write', 'changed source', 'source close', 'output close'])(
    'preserves the source and closes handles after %s failure',
    async (failure) => {
      const original = await fixture();
      await fs.writeFile(filePath, original);
      const open = fs.open;
      const handles: fs.FileHandle[] = [];
      const closed: ReturnType<typeof vi.spyOn>[] = [];
      vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        handles.push(handle);
        const close = handle.close.bind(handle);
        const closeSpy = vi.spyOn(handle, 'close');
        closed.push(closeSpy);
        if ((failure === 'source close' && args[1] === 'r') || (failure === 'output close' && args[1] !== 'r')) {
          closeSpy.mockImplementation(async () => {
            await close();
            throw new Error('injected close failure');
          });
        }
        if (args[1] === 'r') {
          if (failure === 'read') vi.spyOn(handle, 'read').mockRejectedValue(new Error('injected read failure'));
          if (failure === 'zero read') vi.spyOn(handle, 'read').mockResolvedValue({ bytesRead: 0, buffer: Buffer.alloc(0) } as never);
          if (failure === 'changed source') {
            const stat = handle.stat.bind(handle);
            let calls = 0;
            vi.spyOn(handle, 'stat').mockImplementation(async () => {
              const result = await stat();
              if (++calls > 1) result.mtimeMs += 1000;
              return result;
            });
          }
        } else {
          if (failure === 'write') vi.spyOn(handle, 'write').mockRejectedValue(new Error('injected write failure'));
          if (failure === 'zero write') vi.spyOn(handle, 'write').mockResolvedValue({ bytesWritten: 0, buffer: Buffer.alloc(0) } as never);
          if (failure === 'sync') vi.spyOn(handle, 'sync').mockRejectedValue(new Error('injected sync failure'));
        }
        return handle;
      });
      await expect(patch(filePath, new Map())).rejects.toThrow();
      for (const close of closed) expect(close).toHaveBeenCalledOnce();
      vi.restoreAllMocks();
      await expect(fs.readFile(filePath)).resolves.toEqual(original);
      expect(await fs.readdir(root)).toEqual(['book.epub']);
      expect(handles.length).toBeGreaterThan(0);
    },
  );

  it('handles short filesystem reads and writes without losing bytes', async () => {
    const original = await fixture();
    await fs.writeFile(filePath, original);
    const open = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (args[1] === 'r') {
        const read = handle.read.bind(handle);
        vi.spyOn(handle, 'read').mockImplementation(((buffer: Buffer, offset: number, length: number, position: number) =>
          read(buffer, offset, Math.min(length, 97), position)) as never);
      } else {
        const write = handle.write.bind(handle);
        vi.spyOn(handle, 'write').mockImplementation(((buffer: Buffer, offset: number, length: number) =>
          write(buffer, offset, Math.min(length, 71))) as never);
      }
      return handle;
    });
    await patch(filePath, new Map());
    vi.restoreAllMocks();
    const before = await snapshot(original);
    const after = await snapshot(await fs.readFile(filePath));
    for (const [name, bytes] of before.records) {
      if (name !== 'mimetype') expect(after.records.get(name)).toEqual(bytes);
    }
  });

  it('bounds directory allocation before reading a large declared directory', async () => {
    const file = await fs.open(filePath, 'w');
    const directoryLength = 64 * 1024 * 1024 + 1;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(directoryLength, 12);
    await file.write(eocd, 0, eocd.length, directoryLength);
    await file.close();
    await expect(patch(filePath, new Map())).rejects.toThrow('read limit');
    expect((await fs.stat(filePath)).size).toBe(directoryLength + 22);
    expect(await fs.readdir(root)).toEqual(['book.epub']);
  });
});
