import { ForbiddenException } from '@nestjs/common';
import { mkdtemp, mkdir, rm, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { PathPolicyService } from './path-policy.service';

describe('PathPolicyService', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('uses the configured browse root when no path is provided', async () => {
    const root = await makeTempRoot();
    const service = makeService(root);

    await expect(service.resolveBrowsePath()).resolves.toBe(root);
    expect(service.getBrowseRoot()).toBe(root);
  });

  it('allows paths equal to or below the configured browse root', async () => {
    const root = await makeTempRoot();
    const child = join(root, 'authors');
    await mkdir(child);
    const service = makeService(root);

    await expect(service.assertWithinBrowseRoot(root)).resolves.toBe(root);
    await expect(service.assertWithinBrowseRoot(child)).resolves.toBe(child);
    await expect(service.isWithinBrowseRoot(child)).resolves.toBe(true);
  });

  it('rejects sibling paths with the same prefix as the configured browse root', async () => {
    const parent = await makeTempRoot();
    const root = join(parent, 'books');
    const sibling = join(parent, 'bookshelf');
    await mkdir(root);
    await mkdir(sibling);
    const service = makeService(root);

    await expect(service.assertWithinBrowseRoot(sibling)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.isWithinBrowseRoot(sibling)).resolves.toBe(false);
  });

  it('rejects paths that escape through a symlinked existing ancestor', async () => {
    const parent = await makeTempRoot();
    const root = join(parent, 'books');
    const outside = join(parent, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, join(root, 'escape'));
    const service = makeService(root);

    await expect(service.assertWithinBrowseRoot(join(root, 'escape', 'new-library'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  async function makeTempRoot(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), 'bookorbit-path-policy-'));
    tempRoots.push(path);
    return resolve(path);
  }

  function makeService(root: string): PathPolicyService {
    return new PathPolicyService({ libraryBrowseRoot: root } as never);
  }
});
