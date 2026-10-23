import { createHash } from 'crypto';
import { mkdtemp, open, rename, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { computeFileHash, computeFileHashFromHandle } from './file-hash.utils';

describe('KOReader hash from an open file', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'open-file-hash-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('matches path hashing and leaves ownership and stream offset with the caller', async () => {
    const path = join(root, 'book.epub');
    const bytes = Buffer.alloc(8192, 'A');
    bytes.fill('B', 1024, 2048);
    bytes.fill('C', 4096, 5120);
    await writeFile(path, bytes);
    const handle = await open(path, 'r');
    try {
      const expected = createHash('md5')
        .update(Buffer.concat([Buffer.alloc(1024, 'A'), Buffer.alloc(1024, 'B'), Buffer.alloc(1024, 'C')]))
        .digest('hex');
      await expect(computeFileHashFromHandle(handle)).resolves.toBe(expected);
      await expect(computeFileHash(path)).resolves.toBe(expected);
      const buffer = Buffer.alloc(1);
      await handle.read(buffer, 0, 1, null);
      expect(buffer.toString()).toBe('A');
      await expect(handle.stat()).resolves.toEqual(expect.objectContaining({ size: 8192 }));
    } finally {
      await handle.close();
    }
  });

  it('hashes the opened artifact after its path is atomically replaced', async () => {
    const path = join(root, 'book.epub');
    const bytes = Buffer.from('original bytes');
    await writeFile(path, bytes);
    const handle = await open(path, 'r');
    try {
      await rename(path, join(root, 'previous.epub'));
      await writeFile(path, 'replacement bytes');
      await expect(computeFileHashFromHandle(handle)).resolves.toBe(createHash('md5').update(bytes).digest('hex'));
      expect(await computeFileHash(path)).not.toBe(await computeFileHashFromHandle(handle));
    } finally {
      await handle.close();
    }
  });

  it('propagates descriptor failures without closing a caller-owned handle', async () => {
    const failure = new Error('Read failed');
    const handle = { stat: vi.fn().mockResolvedValue({ size: 100 }), read: vi.fn().mockRejectedValue(failure), close: vi.fn() };
    await expect(computeFileHashFromHandle(handle as never)).rejects.toBe(failure);
    expect(handle.close).not.toHaveBeenCalled();
  });
});
