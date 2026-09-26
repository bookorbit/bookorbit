import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildNameExcludeMatcher, walkDirectoryTree, type WalkedDirectory } from './fs-walk.utils';

describe('buildNameExcludeMatcher', () => {
  it('matches nothing when no patterns are given', () => {
    const matcher = buildNameExcludeMatcher([]);

    expect(matcher('anything')).toBe(false);
  });

  it('matches a literal name exactly and a wildcard pattern loosely', () => {
    const matcher = buildNameExcludeMatcher(['@eaDir', '*.part']);

    expect(matcher('@eaDir')).toBe(true);
    expect(matcher('@eaDirectory')).toBe(false);
    expect(matcher('episode.mp3.part')).toBe(true);
    expect(matcher('episode.mp3')).toBe(false);
  });

  it('treats regex metacharacters in a pattern as literal text', () => {
    const matcher = buildNameExcludeMatcher(['a.b*']);

    expect(matcher('a.bc')).toBe(true);
    expect(matcher('axbc')).toBe(false);
  });
});

describe('walkDirectoryTree', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fs-walk-'));
  });

  afterEach(async () => {
    await chmod(join(root, 'locked'), 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  async function collect(
    options: Parameters<typeof walkDirectoryTree>[1] extends never ? never : Partial<Parameters<typeof walkDirectoryTree>[1]> = {},
  ) {
    const visited: WalkedDirectory[] = [];
    const result = await walkDirectoryTree(root, { ...options, visit: (directory) => void visited.push(directory) });
    return { visited, ...result };
  }

  it('visits every directory, parents before children, and lists only regular files', async () => {
    await mkdir(join(root, 'show', 'season'), { recursive: true });
    await writeFile(join(root, 'root.mp3'), 'a');
    await writeFile(join(root, 'show', 'one.mp3'), 'b');
    await writeFile(join(root, 'show', 'season', 'two.mp3'), 'c');

    const { visited } = await collect();

    expect(visited.map((directory) => basename(directory.path))).toEqual([basename(root), 'show', 'season']);
    expect(visited[0]!.filePaths.map((file) => basename(file))).toEqual(['root.mp3']);
    expect(visited[0]!.subdirectoryPaths.map((directory) => basename(directory))).toEqual(['show']);
  });

  it('skips dotfiles, dot directories, and excluded names', async () => {
    await mkdir(join(root, '.hidden'), { recursive: true });
    await mkdir(join(root, '@eaDir'), { recursive: true });
    await writeFile(join(root, '.secret.mp3'), 'a');
    await writeFile(join(root, '.hidden', 'inside.mp3'), 'b');
    await writeFile(join(root, 'kept.mp3'), 'c');

    const { visited } = await collect({ shouldExclude: buildNameExcludeMatcher(['@eaDir']) });

    expect(visited).toHaveLength(1);
    expect(visited[0]!.filePaths.map((file) => basename(file))).toEqual(['kept.mp3']);
  });

  it('reports symlinked entries instead of following them', async () => {
    await writeFile(join(root, 'real.mp3'), 'a');
    await mkdir(join(root, 'target'), { recursive: true });
    await writeFile(join(root, 'target', 'inner.mp3'), 'b');
    await symlink(join(root, 'real.mp3'), join(root, 'link.mp3'));
    await symlink(join(root, 'target'), join(root, 'linkdir'));

    const skipped: Array<{ path: string; reason: string }> = [];
    const { visited } = await collect({ onSkippedEntry: (entry) => skipped.push(entry) });

    expect(skipped.map((entry) => `${basename(entry.path)}:${entry.reason}`).sort()).toEqual(['link.mp3:symlink', 'linkdir:symlink']);
    expect(visited.map((directory) => basename(directory.path)).sort()).toEqual([basename(root), 'target'].sort());
  });

  it('reports a path over the ceiling rather than handing it to the caller', async () => {
    await writeFile(join(root, 'short.mp3'), 'a');
    const skipped: Array<{ path: string; reason: string }> = [];

    const { visited } = await collect({ maxPathLength: root.length + 3, onSkippedEntry: (entry) => skipped.push(entry) });

    expect(visited[0]!.filePaths).toEqual([]);
    expect(skipped).toEqual([{ path: join(root, 'short.mp3'), reason: 'path_too_long' }]);
  });

  it('tolerates an unreadable directory and names it in the result', async () => {
    await mkdir(join(root, 'locked'), { recursive: true });
    await writeFile(join(root, 'locked', 'inside.mp3'), 'a');
    await writeFile(join(root, 'readable.mp3'), 'b');
    await chmod(join(root, 'locked'), 0o000);

    const { visited, skippedDirs } = await collect();

    expect([...skippedDirs]).toEqual([join(root, 'locked')]);
    expect(visited.map((directory) => basename(directory.path))).toEqual([basename(root)]);
  });
});
