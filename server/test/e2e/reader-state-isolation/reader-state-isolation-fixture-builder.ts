import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

export { createCbzFixture, createEpubFixture, createZipArchiveFixture } from '../metadata-write/metadata-write-fixture-builder';

export interface ReaderStateIsolationFixtureRoot {
  rootPath: string;
  booksPath: string;
  bookBucketPath: string;
  cleanup: () => Promise<void>;
}

function assertRelativePath(path: string): void {
  if (path.startsWith('/')) {
    throw new Error(`Fixture paths must be relative. Received "${path}"`);
  }
}

export async function createReaderStateIsolationFixtureRoot(prefix = 'reader-state-isolation-e2e-'): Promise<ReaderStateIsolationFixtureRoot> {
  const rootPath = await mkdtemp(join(tmpdir(), prefix));
  const booksPath = join(rootPath, 'books');
  const bookBucketPath = join(booksPath, 'book-bucket');
  await mkdir(bookBucketPath, { recursive: true });

  return {
    rootPath,
    booksPath,
    bookBucketPath,
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
