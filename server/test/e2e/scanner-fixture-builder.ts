import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

export type FixtureEntry = { kind: 'file'; path: string; content?: string } | { kind: 'dir'; path: string };

export interface FixtureTree {
  rootPath: string;
  cleanup: () => Promise<void>;
}

function assertRelativePath(path: string): void {
  if (path.startsWith('/')) {
    throw new Error(`Fixture paths must be relative. Received "${path}"`);
  }
}

export function file(path: string, content?: string): FixtureEntry {
  assertRelativePath(path);
  return { kind: 'file', path, content: content ?? `${path}\n`.repeat(600) };
}

export function dir(path: string): FixtureEntry {
  assertRelativePath(path);
  return { kind: 'dir', path };
}

export async function createFixtureTree(entries: FixtureEntry[], prefix = 'scanner-e2e-'): Promise<FixtureTree> {
  const rootPath = await mkdtemp(join(tmpdir(), prefix));

  for (const entry of entries) {
    const fullPath = join(rootPath, entry.path);
    if (entry.kind === 'dir') {
      await mkdir(fullPath, { recursive: true });
      continue;
    }

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, entry.content);
  }

  return {
    rootPath,
    cleanup: async () => {
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}
