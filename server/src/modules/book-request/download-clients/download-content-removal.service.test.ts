import { BadRequestException } from '@nestjs/common';
import { access, chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { DownloadContentRemovalService } from './download-content-removal.service';
import { PathMappingService } from './path-mapping.service';

const CLIENT_ID = 3;
const runsAsRoot = process.getuid?.() === 0;

/** The real mapping service over a real temporary directory standing in for rTorrent's /downloads. */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'bookorbit-content-removal-'));
  const downloads = join(root, 'downloads');
  const outside = join(root, 'outside');
  await mkdir(downloads);
  await mkdir(outside);
  const repo = { findPathMappings: vi.fn().mockResolvedValue([{ remotePath: '/downloads', localPath: downloads }]) };
  const service = new DownloadContentRemovalService(new PathMappingService(repo as never));
  return { root, downloads, outside, service };
}

async function put(path: string, contents = 'x'): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, contents);
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe('DownloadContentRemovalService', () => {
  let env: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    env = await setup();
  });

  afterEach(async () => {
    await chmod(env.downloads, 0o755).catch(() => undefined);
    await rm(env.root, { recursive: true, force: true });
  });

  it('deletes a multi-file download and the folders it leaves empty', async () => {
    const folder = join(env.downloads, 'bookorbit', "Agnes & Friends <Box Set> 'Vol 1'");
    await put(join(folder, '01 - Agnes.epub'));
    await put(join(folder, 'Extras', 'Art', 'Cover.jpg'));

    const plan = await env.service.plan(CLIENT_ID, {
      root: "/downloads/bookorbit/Agnes & Friends <Box Set> 'Vol 1'",
      files: ['01 - Agnes.epub', 'Extras/Art/Cover.jpg'],
      multiFile: true,
      expectOnDisk: true,
    });
    const outcome = await env.service.execute(plan);

    expect(outcome).toEqual({ deleted: 2, failures: [], topDirectoryRemoved: true });
    expect(await readdir(join(env.downloads, 'bookorbit'))).toEqual([]);
  });

  it('leaves what a person put beside the download, and the folder holding it', async () => {
    const folder = join(env.downloads, 'bookorbit', 'Ocean');
    await put(join(folder, 'Ocean.m4b'));
    await put(join(folder, 'my notes.txt'));

    const outcome = await env.service.execute(
      await env.service.plan(CLIENT_ID, { root: '/downloads/bookorbit/Ocean', files: ['Ocean.m4b'], multiFile: true, expectOnDisk: true }),
    );

    expect(outcome).toEqual({ deleted: 1, failures: [], topDirectoryRemoved: false });
    expect(await readdir(folder)).toEqual(['my notes.txt']);
  });

  it('deletes a single file and nothing next to it', async () => {
    await put(join(env.downloads, 'bookorbit', 'Hex.m4b'));
    await put(join(env.downloads, 'bookorbit', 'Other.epub'));

    const plan = await env.service.plan(CLIENT_ID, { root: '/downloads/bookorbit/Hex.m4b', files: [], multiFile: false, expectOnDisk: true });
    const outcome = await env.service.execute(plan);

    expect(plan.topDirectory).toBeNull();
    expect(outcome.deleted).toBe(1);
    expect(await readdir(join(env.downloads, 'bookorbit'))).toEqual(['Other.epub']);
  });

  it('removes a symlink inside the download as a link, never what it points at', async () => {
    const folder = join(env.downloads, 'bookorbit', 'Linked');
    await put(join(folder, 'book.epub'));
    await put(join(folder, 'target.jpg'));
    await symlink(join(folder, 'target.jpg'), join(folder, 'cover.jpg'));

    const outcome = await env.service.execute(
      await env.service.plan(CLIENT_ID, {
        root: '/downloads/bookorbit/Linked',
        files: ['book.epub', 'cover.jpg'],
        multiFile: true,
        expectOnDisk: true,
      }),
    );

    expect(outcome.deleted).toBe(2);
    expect(await readdir(folder)).toEqual(['target.jpg']);
  });

  it('refuses the whole removal when a file leads outside the mapped directory', async () => {
    const folder = join(env.downloads, 'bookorbit', 'Escape');
    await put(join(folder, 'book.epub'));
    await put(join(env.outside, 'precious.epub'));
    await symlink(join(env.outside, 'precious.epub'), join(folder, 'link.epub'));

    await expect(
      env.service.plan(CLIENT_ID, { root: '/downloads/bookorbit/Escape', files: ['book.epub', 'link.epub'], multiFile: true, expectOnDisk: true }),
    ).rejects.toThrow('outside the directory it was downloaded into');
    expect(await exists(join(folder, 'book.epub'))).toBe(true);
  });

  it('refuses a file list that climbs out of the download it belongs to', async () => {
    await put(join(env.downloads, 'bookorbit', 'Other', 'keep.epub'));
    await put(join(env.downloads, 'bookorbit', 'Mine', 'book.epub'));

    await expect(
      env.service.plan(CLIENT_ID, {
        root: '/downloads/bookorbit/Mine',
        files: ['book.epub', '../Other/keep.epub'],
        multiFile: true,
        expectOnDisk: true,
      }),
    ).rejects.toThrow('listed a file outside the download it belongs to');
  });

  it('refuses a path no mapping covers', async () => {
    await expect(env.service.plan(CLIENT_ID, { root: '/srv/torrents/book.epub', files: [], multiFile: false, expectOnDisk: true })).rejects.toThrow(
      'No path mapping covers',
    );
  });

  it('refuses when the files the client wrote are not where the mapping puts them', async () => {
    await expect(
      env.service.plan(CLIENT_ID, { root: '/downloads/bookorbit/Missing.epub', files: [], multiFile: false, expectOnDisk: true }),
    ).rejects.toThrow('cannot find this download');
  });

  it('accepts a download that never wrote anything, which has nothing to find', async () => {
    const plan = await env.service.plan(CLIENT_ID, { root: '/downloads/bookorbit/Empty', files: ['a.epub'], multiFile: true, expectOnDisk: false });

    await expect(env.service.execute(plan)).resolves.toEqual({ deleted: 0, failures: [], topDirectoryRemoved: true });
  });

  it('refuses a download whose folder is the mapped directory itself', async () => {
    await put(join(env.downloads, 'book.epub'));

    await expect(env.service.plan(CLIENT_ID, { root: '/downloads', files: ['book.epub'], multiFile: true, expectOnDisk: true })).rejects.toThrow(
      BadRequestException,
    );
    expect(await exists(join(env.downloads, 'book.epub'))).toBe(true);
  });

  it.skipIf(runsAsRoot)('refuses before anything is erased when the folder is not writable', async () => {
    const folder = join(env.downloads, 'bookorbit');
    await put(join(folder, 'book.epub'));
    await chmod(folder, 0o555);

    try {
      await expect(
        env.service.plan(CLIENT_ID, { root: '/downloads/bookorbit/book.epub', files: [], multiFile: false, expectOnDisk: true }),
      ).rejects.toThrow('may not write to the download directory (EACCES). Nothing was removed.');
    } finally {
      await chmod(folder, 0o755);
    }
  });

  it('counts a file already gone as done, and a folder where a file was listed as a failure', async () => {
    const folder = join(env.downloads, 'bookorbit', 'Odd');
    await put(join(folder, 'book.epub'));
    await mkdir(join(folder, 'was-a-file.jpg'));

    const outcome = await env.service.execute(
      await env.service.plan(CLIENT_ID, {
        root: '/downloads/bookorbit/Odd',
        files: ['book.epub', 'gone.epub', 'was-a-file.jpg'],
        multiFile: true,
        expectOnDisk: true,
      }),
    );

    expect(outcome.deleted).toBe(1);
    expect(outcome.failures).toEqual([{ path: expect.stringContaining('was-a-file.jpg'), code: 'EISDIR' }]);
    expect(outcome.topDirectoryRemoved).toBe(false);
  });
});
