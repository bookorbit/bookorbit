import { mkdir, mkdtemp, rm, symlink as symlinkFs, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

export type FixtureEntry =
  | { kind: 'file'; path: string; content?: string }
  | { kind: 'dir'; path: string }
  | { kind: 'symlink'; path: string; content?: string }
  | { kind: 'symlinkDir'; path: string; entries: FixtureEntry[] };

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

// Creates a symlink pointing at a real file kept outside the fixture root,
// mirroring how debrid/rclone-backed libraries publish content.
export function symlink(path: string, content?: string): FixtureEntry {
  assertRelativePath(path);
  return { kind: 'symlink', path, content: content ?? `${path}\n`.repeat(600) };
}

// Creates a symlink pointing at a real directory (containing `entries`) kept
// outside the fixture root, to verify symlinked directories are still excluded.
export function symlinkDir(path: string, entries: FixtureEntry[]): FixtureEntry {
  assertRelativePath(path);
  return { kind: 'symlinkDir', path, entries };
}

async function materialize(rootPath: string, targetsPath: string, entries: FixtureEntry[]): Promise<void> {
  for (const entry of entries) {
    const fullPath = join(rootPath, entry.path);

    if (entry.kind === 'dir') {
      await mkdir(fullPath, { recursive: true });
      continue;
    }

    if (entry.kind === 'file') {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, entry.content);
      continue;
    }

    if (entry.kind === 'symlink') {
      const targetPath = join(targetsPath, entry.path);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, entry.content);
      await mkdir(dirname(fullPath), { recursive: true });
      await symlinkFs(targetPath, fullPath);
      continue;
    }

    const targetDirPath = join(targetsPath, entry.path);
    await mkdir(targetDirPath, { recursive: true });
    await materialize(targetDirPath, targetsPath, entry.entries);
    await mkdir(dirname(fullPath), { recursive: true });
    await symlinkFs(targetDirPath, fullPath);
  }
}

export async function createFixtureTree(entries: FixtureEntry[], prefix = 'scanner-e2e-'): Promise<FixtureTree> {
  const rootPath = await mkdtemp(join(tmpdir(), prefix));
  const targetsPath = await mkdtemp(join(tmpdir(), `${prefix}targets-`));

  await materialize(rootPath, targetsPath, entries);

  return {
    rootPath,
    cleanup: async () => {
      await rm(rootPath, { recursive: true, force: true });
      await rm(targetsPath, { recursive: true, force: true });
    },
  };
}
