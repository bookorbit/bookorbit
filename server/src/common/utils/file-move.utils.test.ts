import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renameMock = vi.hoisted(() => ({ crossDevice: false, failWith: null as NodeJS.ErrnoException | null }));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    rename: vi.fn(async (from: string, to: string) => {
      if (renameMock.failWith) throw renameMock.failWith;
      if (renameMock.crossDevice) throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
      return actual.rename(from, to);
    }),
  };
});

import { moveFile, moveFileBack } from './file-move.utils';

describe('moveFile across devices', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-move-'));
    renameMock.crossDevice = false;
    renameMock.failWith = null;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renames on one device and reports it', async () => {
    const from = join(dir, 'a', 'book.epub');
    const to = join(dir, 'b', 'book.epub');
    await writeFixture(from, 'same device');

    const outcome = await moveFile(from, to);

    expect(outcome.crossDevice).toBe(false);
    expect(await readFile(to, 'utf8')).toBe('same device');
    await expect(stat(from)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('falls back to a verified copy when rename fails with EXDEV, then removes the source', async () => {
    renameMock.crossDevice = true;
    const from = join(dir, 'library-a', 'Author', 'Book', 'book.m4b');
    const to = join(dir, 'library-b', 'Author', 'Book', 'book.m4b');
    const bytes = Buffer.alloc(256 * 1024, 7);
    await writeFixture(from, bytes);
    const progress: number[] = [];

    const outcome = await moveFile(from, to, (copied) => progress.push(copied));

    expect(outcome.crossDevice).toBe(true);
    expect(outcome.stat.sizeBytes).toBe(bytes.length);
    expect((await readFile(to)).equals(bytes)).toBe(true);
    await expect(stat(from)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(progress.at(-1)).toBe(bytes.length);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('leaves the source and no partial copy when the cross-device copy cannot be written', async () => {
    renameMock.crossDevice = true;
    const from = join(dir, 'library-a', 'book.epub');
    await writeFixture(from, 'keep me');
    // A directory where the copy's file should go makes the write fail.
    const to = join(dir, 'library-b', 'book.epub');
    await writeFixture(join(to, 'occupied'), 'x');

    await expect(moveFile(from, to)).rejects.toThrow();

    expect(await readFile(from, 'utf8')).toBe('keep me');
    expect((await stat(to)).isDirectory()).toBe(true);
  });

  it('rethrows a rename failure that is not EXDEV without copying', async () => {
    renameMock.failWith = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const from = join(dir, 'a', 'book.epub');
    const to = join(dir, 'b', 'book.epub');
    await writeFixture(from, 'locked');

    await expect(moveFile(from, to)).rejects.toMatchObject({ code: 'EACCES' });

    expect(await readFile(from, 'utf8')).toBe('locked');
    await expect(stat(to)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('moves a file back across devices for a rollback', async () => {
    renameMock.crossDevice = true;
    const moved = join(dir, 'library-b', 'book.epub');
    const original = join(dir, 'library-a', 'book.epub');
    await writeFixture(moved, 'roll me back');

    await moveFileBack(moved, original);

    expect(await readFile(original, 'utf8')).toBe('roll me back');
    await expect(stat(moved)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function writeFixture(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
