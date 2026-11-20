import { link, mkdir, mkdtemp, readdir, realpath, rename, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { probeFiling } from './library-dock-fs';

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, link: vi.fn(actual.link), rename: vi.fn(actual.rename) };
});

const failWith = (code: string) => Object.assign(new Error(`Injected ${code}`), { code });

describe('probeFiling', () => {
  let root: string;
  let dock: string;
  let shelf: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'library-dock-probe-')));
    dock = join(root, 'dock');
    shelf = join(root, 'shelf');
    await mkdir(dock);
    await mkdir(shelf);
  });

  afterEach(async () => {
    vi.mocked(link).mockClear();
    vi.mocked(rename).mockClear();
    await rm(root, { recursive: true, force: true });
  });

  async function leftovers(): Promise<string[]> {
    return [...(await readdir(dock)), ...(await readdir(shelf))];
  }

  it.each(['rename', 'link'] as const)('reports an instant move when a %s works, and removes the probe', async (placement) => {
    await expect(probeFiling(dock, shelf, placement)).resolves.toEqual({ filing: 'move' });
    expect(await leftovers()).toEqual([]);
  });

  it('reports a copy when a rename crosses a filesystem or mount', async () => {
    vi.mocked(rename).mockRejectedValueOnce(failWith('EXDEV'));

    await expect(probeFiling(dock, shelf, 'rename')).resolves.toEqual({ filing: 'copy', errorCode: 'EXDEV' });
    expect(await leftovers()).toEqual([]);
  });

  it.each(['EXDEV', 'EPERM', 'ENOTSUP', 'EMLINK'])('reports a copy when a hardlink is refused with %s', async (code) => {
    vi.mocked(link).mockRejectedValueOnce(failWith(code));

    await expect(probeFiling(dock, shelf, 'link')).resolves.toEqual({ filing: 'copy', errorCode: code });
    expect(await leftovers()).toEqual([]);
  });

  it('cannot tell when a rename fails for another reason', async () => {
    vi.mocked(rename).mockRejectedValueOnce(failWith('EACCES'));

    await expect(probeFiling(dock, shelf, 'rename')).resolves.toEqual({ filing: 'unknown', errorCode: 'EACCES' });
    expect(await leftovers()).toEqual([]);
  });

  it('cannot tell when either folder is missing', async () => {
    await expect(probeFiling(join(root, 'gone'), shelf, 'rename')).resolves.toEqual({ filing: 'unknown', errorCode: 'ENOENT' });
    await expect(probeFiling(dock, join(root, 'gone'), 'link')).resolves.toEqual({ filing: 'unknown', errorCode: 'ENOENT' });
    expect(await leftovers()).toEqual([]);
  });
});
