import { link, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { pathsReferToSameEntry, resolveExistingPathSpelling } from './path-identity.utils';

describe('path identity utilities', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-path-identity-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns the directory-entry spelling for an existing path', async () => {
    const actualPath = join(root, 'bell hooks', 'Book.epub');
    await mkdir(join(root, 'bell hooks'), { recursive: true });
    await writeFile(actualPath, 'book');

    const alternatePath = join(root, 'Bell Hooks', 'Book.epub');
    const resolved = await resolveExistingPathSpelling(alternatePath);

    if (resolved === null) {
      expect(await resolveExistingPathSpelling(actualPath)).toBe(actualPath);
      return;
    }

    expect(resolved).toBe(actualPath);
    await expect(pathsReferToSameEntry(actualPath, alternatePath)).resolves.toBe(true);
  });

  it('does not conflate distinct case-sensitive hard links', async () => {
    const firstPath = join(root, 'Book.epub');
    const secondPath = join(root, 'book.epub');
    await writeFile(firstPath, 'book');

    try {
      await link(firstPath, secondPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await expect(pathsReferToSameEntry(firstPath, secondPath)).resolves.toBe(true);
      return;
    }

    await expect(pathsReferToSameEntry(firstPath, secondPath)).resolves.toBe(false);
  });

  it('returns null for a missing path', async () => {
    await expect(resolveExistingPathSpelling(join(root, 'missing.epub'))).resolves.toBeNull();
  });
});
