import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

export { createEpubFixture } from '../metadata-write/metadata-write-fixture-builder';

export interface OpdsFixtureRoot {
  rootPath: string;
  booksPath: string;
  bookDockPath: string;
  cleanup: () => Promise<void>;
}

function assertRelativePath(path: string): void {
  if (path.startsWith('/')) {
    throw new Error(`Fixture paths must be relative. Received "${path}"`);
  }
}

export async function createOpdsFixtureRoot(prefix = 'opds-e2e-'): Promise<OpdsFixtureRoot> {
  const rootPath = await mkdtemp(join(tmpdir(), prefix));
  const booksPath = join(rootPath, 'books');
  const bookDockPath = join(booksPath, 'book-dock');
  await mkdir(bookDockPath, { recursive: true });

  return {
    rootPath,
    booksPath,
    bookDockPath,
    cleanup: async () => {
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}

export async function writeFixtureFile(rootPath: string, relativePath: string, content: string | Buffer): Promise<string> {
  assertRelativePath(relativePath);

  const absolutePath = join(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  return absolutePath;
}
