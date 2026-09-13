import { BadRequestException } from '@nestjs/common';
import { chmod, mkdtemp, mkdir, readdir, symlink, writeFile } from 'fs/promises';
import { realpath } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { PathMappingService } from './path-mapping.service';

function makeService(mappings: Array<{ remotePath: string; localPath: string }>) {
  const repo = {
    // The repository sorts longest-prefix-first; mirror that here so the service under test sees
    // the same ordering it does in production.
    findPathMappings: vi.fn().mockResolvedValue([...mappings].sort((a, b) => b.remotePath.length - a.remotePath.length)),
  };
  return { service: new PathMappingService(repo as never), repo };
}

describe('PathMappingService.toLocalPath', () => {
  it('translates a path under the mapped prefix', async () => {
    const { service } = makeService([{ remotePath: '/downloads', localPath: '/data/torrents' }]);
    await expect(service.toLocalPath(1, '/downloads/books/dune.epub')).resolves.toMatchObject({
      localPath: '/data/torrents/books/dune.epub',
      containmentRoot: '/data/torrents',
    });
  });

  it('translates the prefix itself', async () => {
    const { service } = makeService([{ remotePath: '/downloads', localPath: '/data/torrents' }]);
    await expect(service.toLocalPath(1, '/downloads')).resolves.toMatchObject({ localPath: '/data/torrents' });
  });

  it('prefers the longest matching prefix', async () => {
    const { service } = makeService([
      { remotePath: '/downloads', localPath: '/data/all' },
      { remotePath: '/downloads/books', localPath: '/data/books' },
    ]);
    await expect(service.toLocalPath(1, '/downloads/books/dune.epub')).resolves.toMatchObject({ localPath: '/data/books/dune.epub' });
  });

  it('matches on segment boundaries, so a sibling directory is not swallowed', async () => {
    const { service } = makeService([{ remotePath: '/downloads/complete', localPath: '/data/complete' }]);
    await expect(service.toLocalPath(1, '/downloads/completed-books/dune.epub')).rejects.toThrow(BadRequestException);
  });

  it('normalizes the backslashes a Windows client reports', async () => {
    const remotePath = ['D:', 'torrents'].join('\\');
    const reportedPath = [remotePath, 'books', 'dune.epub'].join('\\');
    const { service } = makeService([{ remotePath, localPath: '/data/torrents' }]);
    await expect(service.toLocalPath(1, reportedPath)).resolves.toMatchObject({
      localPath: '/data/torrents/books/dune.epub',
    });
  });

  it('rejects traversal out of the mapped local path', async () => {
    const { service } = makeService([{ remotePath: '/downloads', localPath: '/data/torrents' }]);
    await expect(service.toLocalPath(1, '/downloads/../../etc/passwd')).rejects.toThrow(BadRequestException);
  });

  it('rejects a reported path no mapping covers', async () => {
    const { service } = makeService([{ remotePath: '/downloads', localPath: '/data/torrents' }]);
    await expect(service.toLocalPath(1, '/elsewhere/dune.epub')).rejects.toThrow(BadRequestException);
  });

  it('rejects an empty content path', async () => {
    const { service } = makeService([{ remotePath: '/downloads', localPath: '/data/torrents' }]);
    await expect(service.toLocalPath(1, '   ')).rejects.toThrow(BadRequestException);
  });

  /**
   * Without a mapping there is no operator-declared directory to hold the reported path to, so a
   * client that reported `/etc` would have had `/etc` scanned and hardlinked out of.
   */
  it('refuses a client with no mapping rather than trusting whatever it reported', async () => {
    const { service } = makeService([]);
    await expect(service.toLocalPath(1, '/downloads/dune.epub')).rejects.toThrow(BadRequestException);
    await expect(service.toLocalPath(1, '/etc/shadow')).rejects.toThrow(BadRequestException);
  });

  /** The single-host case is an identity mapping, not an absent one, and still imports. */
  it('translates through an identity mapping and roots containment at it', async () => {
    const { service } = makeService([{ remotePath: '/downloads', localPath: '/downloads' }]);
    await expect(service.toLocalPath(1, '/downloads/dune.epub')).resolves.toEqual({
      localPath: '/downloads/dune.epub',
      containmentRoot: '/downloads',
    });
  });

  it('rejects a symlink inside the download directory that points out of it', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'bookorbit-mapping-')));
    const inside = join(root, 'downloads');
    const outside = join(root, 'secrets');
    await mkdir(inside, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'passwd'), 'x');
    await symlink(outside, join(inside, 'escape'));

    const { service } = makeService([{ remotePath: '/remote', localPath: inside }]);
    await expect(service.toLocalPath(1, '/remote/escape/passwd')).rejects.toThrow(BadRequestException);
  });
});

describe('PathMappingService.assertWithinRoot', () => {
  it('accepts a path under the root', async () => {
    const { service } = makeService([]);
    await expect(service.assertWithinRoot('/data/torrents', '/data/torrents/books/dune.epub')).resolves.toBeUndefined();
  });

  it('rejects a path outside the root', async () => {
    const { service } = makeService([]);
    await expect(service.assertWithinRoot('/data/torrents', '/etc/shadow')).rejects.toThrow(BadRequestException);
  });

  /** The release named this file, not the operator, so the symlink is followed before it is used. */
  it('rejects a symlink inside the root that points out of it', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'bookorbit-contain-')));
    const inside = join(root, 'downloads');
    const outside = join(root, 'secrets');
    await mkdir(inside, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'passwd'), 'x');
    await symlink(join(outside, 'passwd'), join(inside, 'dune.epub'));

    const { service } = makeService([]);
    await expect(service.assertWithinRoot(inside, join(inside, 'dune.epub'))).rejects.toThrow(BadRequestException);
  });
});

describe('PathMappingService.testHardlink', () => {
  async function twoDirs() {
    const root = await mkdtemp(join(tmpdir(), 'bookorbit-hardlink-'));
    const a = join(root, 'a');
    const b = join(root, 'b');
    await mkdir(a);
    await mkdir(b);
    return { root, a, b };
  }

  it('reports a working hardlink for two directories on one filesystem', async () => {
    const { a, b } = await twoDirs();

    const { service } = makeService([]);
    await expect(service.testHardlink(a, b)).resolves.toEqual({ localPathExists: true, bookDockPathExists: true, hardlinkWorks: true });
  });

  it('leaves nothing behind on either side', async () => {
    const { a, b } = await twoDirs();

    const { service } = makeService([]);
    await service.testHardlink(a, b);

    await expect(readdir(a)).resolves.toEqual([]);
    await expect(readdir(b)).resolves.toEqual([]);
  });

  it('reports a missing local path rather than throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bookorbit-hardlink-'));
    const { service } = makeService([]);
    await expect(service.testHardlink(join(root, 'nope'), root)).resolves.toMatchObject({ localPathExists: false, hardlinkWorks: false });
  });

  it('separates a download directory it cannot write to from a refused link', async () => {
    if (process.getuid?.() === 0) return; // skip when running as root
    const { a, b } = await twoDirs();
    await chmod(a, 0o500);

    try {
      const { service } = makeService([]);
      const result = await service.testHardlink(a, b);

      expect(result.hardlinkWorks).toBe(false);
      expect(result.failure).toBe('download_dir_unwritable');
      expect(result.errorCode).toBe('EACCES');
    } finally {
      await chmod(a, 0o700);
    }
  });
});
