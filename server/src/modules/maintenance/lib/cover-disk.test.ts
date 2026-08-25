import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasServableCover, mapWithConcurrency, measureCoverDir, readCoverDirBookIds } from './cover-disk';

describe('cover-disk', () => {
  let coversRoot: string;

  beforeEach(async () => {
    coversRoot = await mkdtemp(join(tmpdir(), 'bookorbit-covers-'));
  });

  afterEach(async () => {
    await rm(coversRoot, { recursive: true, force: true });
  });

  async function makeCoverDir(bookId: number, files: Record<string, string>): Promise<void> {
    const dir = join(coversRoot, String(bookId));
    await mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  }

  describe('readCoverDirBookIds', () => {
    it('returns an empty set when the covers root does not exist', async () => {
      expect(await readCoverDirBookIds(join(coversRoot, 'nope'))).toEqual(new Set());
    });

    it('collects numeric directory names and ignores everything else', async () => {
      await makeCoverDir(1, { 'cover_extracted.jpg': 'x' });
      await makeCoverDir(42, {});
      await mkdir(join(coversRoot, 'not-a-book'), { recursive: true });
      await writeFile(join(coversRoot, '7'), 'a file, not a directory');

      expect(await readCoverDirBookIds(coversRoot)).toEqual(new Set([1, 42]));
    });
  });

  describe('hasServableCover', () => {
    it('is false when the directory is absent', async () => {
      expect(await hasServableCover(coversRoot, 5)).toBe(false);
    });

    it('is false when the directory holds only a thumbnail', async () => {
      await makeCoverDir(5, { 'thumbnail.jpg': 'thumb' });
      expect(await hasServableCover(coversRoot, 5)).toBe(false);
    });

    it('is true for extracted, custom, and legacy cover files', async () => {
      await makeCoverDir(1, { 'cover_extracted.jpg': 'x' });
      await makeCoverDir(2, { 'cover_custom.png': 'x' });
      await makeCoverDir(3, { 'cover.jpg': 'x' });

      expect(await hasServableCover(coversRoot, 1)).toBe(true);
      expect(await hasServableCover(coversRoot, 2)).toBe(true);
      expect(await hasServableCover(coversRoot, 3)).toBe(true);
    });
  });

  describe('measureCoverDir', () => {
    it('reports zero for a directory that is gone', async () => {
      expect(await measureCoverDir(coversRoot, 9)).toEqual({ fileCount: 0, sizeBytes: 0 });
    });

    it('sums the files it holds', async () => {
      await makeCoverDir(9, { 'cover_custom.jpg': 'abcde', 'thumbnail.jpg': 'xyz' });
      expect(await measureCoverDir(coversRoot, 9)).toEqual({ fileCount: 2, sizeBytes: 8 });
    });
  });

  describe('mapWithConcurrency', () => {
    it('preserves input order and never exceeds the concurrency limit', async () => {
      let inFlight = 0;
      let peak = 0;
      const items = Array.from({ length: 20 }, (_, index) => index);

      const results = await mapWithConcurrency(items, 4, async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        return item * 2;
      });

      expect(results).toEqual(items.map((item) => item * 2));
      expect(peak).toBeLessThanOrEqual(4);
    });

    it('handles an empty input', async () => {
      expect(await mapWithConcurrency([], 4, () => Promise.resolve(1))).toEqual([]);
    });
  });
});
