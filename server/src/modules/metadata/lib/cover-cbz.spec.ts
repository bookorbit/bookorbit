jest.mock('fs/promises', () => ({ readFile: jest.fn() }));

import { readFile } from 'fs/promises';
import { deflateRawSync } from 'zlib';

import { extractCbzCover } from './cover-cbz';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

function localZipEntry(name: string, data: Buffer, compression: 0 | 8 = 0): Buffer {
  const nameBuf = Buffer.from(name, 'utf-8');
  const payload = compression === 8 ? deflateRawSync(data) : data;
  const header = Buffer.alloc(30 + nameBuf.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(compression, 8);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(payload.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  nameBuf.copy(header, 30);
  return Buffer.concat([header, payload]);
}

describe('extractCbzCover', () => {
  beforeEach(() => jest.resetAllMocks());

  it('skips hidden image files and returns first visible image bytes', async () => {
    const hidden = localZipEntry('.hidden.jpg', Buffer.from([0xaa]));
    const visible = localZipEntry('001.jpg', Buffer.from([0xff, 0xd8, 0xff]));
    mockReadFile.mockResolvedValue(Buffer.concat([hidden, visible]) as unknown as Awaited<ReturnType<typeof readFile>>);

    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('inflates DEFLATE entries', async () => {
    const entry = localZipEntry('page1.png', Buffer.from([1, 2, 3, 4]), 8);
    mockReadFile.mockResolvedValue(entry as unknown as Awaited<ReturnType<typeof readFile>>);

    await expect(extractCbzCover('/book.cbz')).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('returns null when no image entry exists', async () => {
    const txt = localZipEntry('notes.txt', Buffer.from('x'));
    mockReadFile.mockResolvedValue(txt as unknown as Awaited<ReturnType<typeof readFile>>);

    await expect(extractCbzCover('/book.cbz')).resolves.toBeNull();
  });

  it('returns null on I/O failure', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    await expect(extractCbzCover('/missing.cbz')).resolves.toBeNull();
  });
});
