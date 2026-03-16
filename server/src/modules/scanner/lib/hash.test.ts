import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { fingerprintFile } from './hash';

const EMPTY_MD5 = 'd41d8cd98f00b204e9800998ecf8427e';
// 1 KB = 1024 bytes. The first read position is BASE (1024), so files <= 1024 bytes produce empty hash.
const FIRST_READ_POSITION = 1024;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'scanner-hash-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── SMALL FILES ───────────────────────────────────────────────────────────────

describe('files smaller than the first read position', () => {
  it('returns MD5 of empty string for a file with 0 bytes', async () => {
    await writeFile(join(tmpDir, 'empty.epub'), Buffer.alloc(0));
    const hash = await fingerprintFile(join(tmpDir, 'empty.epub'));
    expect(hash).toBe(EMPTY_MD5);
  });

  it('returns MD5 of empty string for a file with exactly 1024 bytes', async () => {
    // Position 1024 >= size 1024 → no read
    await writeFile(join(tmpDir, 'exact.epub'), Buffer.alloc(FIRST_READ_POSITION, 'A'));
    const hash = await fingerprintFile(join(tmpDir, 'exact.epub'));
    expect(hash).toBe(EMPTY_MD5);
  });
});

// ── FILES LARGE ENOUGH TO BE SAMPLED ─────────────────────────────────────────

describe('files large enough for sampling', () => {
  it('returns a 32-char hex string (MD5)', async () => {
    await writeFile(join(tmpDir, 'book.epub'), Buffer.alloc(2048, 'A'));
    const hash = await fingerprintFile(join(tmpDir, 'book.epub'));
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('identical content produces identical fingerprint', async () => {
    const content = Buffer.alloc(4096, 'Z');
    await writeFile(join(tmpDir, 'a.epub'), content);
    await writeFile(join(tmpDir, 'b.epub'), content);

    const [h1, h2] = await Promise.all([fingerprintFile(join(tmpDir, 'a.epub')), fingerprintFile(join(tmpDir, 'b.epub'))]);
    expect(h1).toBe(h2);
  });

  it('different content at sampled position produces different fingerprint', async () => {
    const base = Buffer.alloc(4096, 'A');
    const different = Buffer.from(base);
    different.write('Z', FIRST_READ_POSITION, 'ascii'); // change byte at the sampled position

    await writeFile(join(tmpDir, 'a.epub'), base);
    await writeFile(join(tmpDir, 'b.epub'), different);

    const [h1, h2] = await Promise.all([fingerprintFile(join(tmpDir, 'a.epub')), fingerprintFile(join(tmpDir, 'b.epub'))]);
    expect(h1).not.toBe(h2);
  });

  it('fingerprint is deterministic across calls', async () => {
    await writeFile(join(tmpDir, 'book.epub'), Buffer.alloc(8192, 'X'));
    const [h1, h2] = await Promise.all([fingerprintFile(join(tmpDir, 'book.epub')), fingerprintFile(join(tmpDir, 'book.epub'))]);
    expect(h1).toBe(h2);
  });
});

// ── ERROR HANDLING ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws when the file does not exist', async () => {
    await expect(fingerprintFile(join(tmpDir, 'nonexistent.epub'))).rejects.toThrow();
  });
});
