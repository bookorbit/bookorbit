import { createHash } from 'crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KepubConversionService } from './kepub-conversion.service';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('KepubConversionService.acquireCachedByDigest', () => {
  let appDataPath: string;
  let service: KepubConversionService;

  beforeEach(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'kepub-digest-'));
    service = new KepubConversionService({ appDataPath } as never, {} as never);
  });

  afterEach(async () => {
    await rm(appDataPath, { recursive: true, force: true });
  });

  it('leases the cached conversion whose bytes match the delivered digest', async () => {
    const cacheDir = join(appDataPath, '.kepub-cache', '3');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'current.kepub.epub'), 'current bytes');
    await writeFile(join(cacheDir, 'delivered.kepub.epub'), 'delivered bytes');

    const lease = await service.acquireCachedByDigest(3, sha256('delivered bytes'));

    expect(lease?.path).toBe(join(cacheDir, 'delivered.kepub.epub'));
    await lease?.release();
    expect(await service.acquireCachedByDigest(3, sha256('evicted bytes'))).toBeNull();
    expect(await service.acquireCachedByDigest(4, sha256('delivered bytes'))).toBeNull();
  });

  it('refuses a cache folder that is a symbolic link', async () => {
    const outside = join(appDataPath, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'delivered.kepub.epub'), 'delivered bytes');
    await mkdir(join(appDataPath, '.kepub-cache'), { recursive: true });
    await symlink(outside, join(appDataPath, '.kepub-cache', '3'));

    expect(await service.acquireCachedByDigest(3, sha256('delivered bytes'))).toBeNull();
  });
});
