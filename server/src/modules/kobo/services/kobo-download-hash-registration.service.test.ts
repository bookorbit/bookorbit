import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdir, mkdtemp, opendir, readFile, readdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { storageConfig } from '../../../config/config';
import { KoboDownloadRepository } from '../kobo-download.repository';
import { KoboDownloadHashRegistrationService } from './kobo-download-hash-registration.service';

const HASH = 'a'.repeat(32);

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, opendir: vi.fn(actual.opendir) };
});

describe('KoboDownloadHashRegistrationService', () => {
  let root: string;
  let directory: string;
  let repository: { registerDeliveredHash: ReturnType<typeof vi.fn<(fileId: number, hash: string) => Promise<void>>> };
  let service: KoboDownloadHashRegistrationService;
  let warnings: ReturnType<typeof vi.spyOn>;
  let services: KoboDownloadHashRegistrationService[];

  async function createService() {
    const module = await Test.createTestingModule({
      providers: [
        KoboDownloadHashRegistrationService,
        { provide: KoboDownloadRepository, useValue: repository },
        { provide: storageConfig.KEY, useValue: { appDataPath: root } },
      ],
    }).compile();
    const instance = module.get(KoboDownloadHashRegistrationService);
    services.push(instance);
    return instance;
  }

  beforeEach(async () => {
    services = [];
    vi.mocked(opendir).mockClear();
    root = await mkdtemp(join(tmpdir(), 'kobo-hash-registration-'));
    directory = join(root, '.kobo-download-hashes');
    repository = { registerDeliveredHash: vi.fn().mockResolvedValue(undefined) };
    service = await createService();
    warnings = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await Promise.all(services.map((instance) => instance.onModuleDestroy()));
    warnings.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it('registers immediately without creating a retry directory when the database works', async () => {
    await service.record(22, HASH);
    expect(repository.registerDeliveredHash).toHaveBeenCalledExactlyOnceWith(22, HASH);
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(warnings).not.toHaveBeenCalled();
  });

  it('persists a failed registration without book bytes, paths or metadata', async () => {
    repository.registerDeliveredHash.mockRejectedValue(new Error('Database unavailable'));
    await expect(service.record(22, HASH)).resolves.toBeUndefined();
    expect(await readdir(directory)).toEqual([`22-${HASH}`]);
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining('[fail]'));
  });

  it('deduplicates concurrent deliveries of the same identity', async () => {
    repository.registerDeliveredHash.mockRejectedValue(new Error('Database unavailable'));
    await Promise.all(Array.from({ length: 20 }, () => service.record(22, HASH)));
    expect(await readdir(directory)).toEqual([`22-${HASH}`]);
  });

  it('retains different source files and variants independently', async () => {
    repository.registerDeliveredHash.mockRejectedValue(new Error('Database unavailable'));
    await service.record(22, HASH);
    await service.record(33, HASH);
    await service.record(22, 'b'.repeat(32));
    expect((await readdir(directory)).sort()).toEqual([`22-${HASH}`, `22-${'b'.repeat(32)}`, `33-${HASH}`]);
  });

  it('recovers after restart even if the downloaded temporary archive is gone', async () => {
    repository.registerDeliveredHash.mockRejectedValueOnce(new Error('Database unavailable'));
    await service.record(22, HASH);
    const restarted = await createService();
    await restarted.replay();
    expect(repository.registerDeliveredHash).toHaveBeenLastCalledWith(22, HASH);
    expect(await readdir(directory)).toEqual([]);
  });

  it('retains pending identities through repeated failures and removes them after success', async () => {
    repository.registerDeliveredHash.mockRejectedValue(new Error('Database unavailable'));
    await service.record(22, HASH);
    await service.replay();
    await service.replay();
    expect(await readdir(directory)).toEqual([`22-${HASH}`]);
    repository.registerDeliveredHash.mockResolvedValue(undefined);
    await service.replay();
    expect(await readdir(directory)).toEqual([]);
  });

  it('coalesces overlapping replay requests', async () => {
    await mkdir(directory);
    await writeFile(join(directory, `22-${HASH}`), '');
    let resolve!: () => void;
    repository.registerDeliveredHash.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const first = service.replay();
    expect(service.replay()).toBe(first);
    await vi.waitFor(() => expect(repository.registerDeliveredHash).toHaveBeenCalledTimes(1));
    resolve();
    await first;
    expect(await readdir(directory)).toEqual([]);
  });

  it('bounds replay work and continues the remaining entries on the next tick', async () => {
    await mkdir(directory);
    for (let id = 1; id <= 1005; id++) await writeFile(join(directory, `${id}-${HASH}`), '');
    await service.replay();
    expect(repository.registerDeliveredHash).toHaveBeenCalledTimes(1000);
    expect(await readdir(directory)).toHaveLength(5);
    await service.replay();
    expect(repository.registerDeliveredHash).toHaveBeenCalledTimes(1005);
    expect(await readdir(directory)).toEqual([]);
  });

  it('removes malformed files and symlinks without following them or deleting directories', async () => {
    await mkdir(directory);
    for (const name of ['0-' + HASH, '2147483648-' + HASH, '22-not-a-hash', '-22-' + HASH]) await writeFile(join(directory, name), '');
    await mkdir(join(directory, `22-${HASH}`));
    await symlink(join(root, 'missing'), join(directory, `33-${HASH}`));
    await service.replay();
    expect(repository.registerDeliveredHash).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([`22-${HASH}`]);
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining('removedEntries=5 skippedEntries=1'));
  });

  it.each(['file', 'directory', 'symlink'])('makes bounded forward progress past more than a batch of invalid %s entries', async (kind) => {
    await mkdir(directory);
    const target = join(root, 'outside-entry');
    await writeFile(target, 'preserve outside data');
    for (let i = 0; i < 1001; i++) {
      const path = join(directory, `junk-${i}`);
      if (kind === 'file') await writeFile(path, '');
      else if (kind === 'directory') await mkdir(path);
      else await symlink(target, path);
    }
    const validName = `22-${HASH}`;
    await writeFile(join(directory, validName), '');
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => Number(a.name === validName) - Number(b.name === validName));
    const cursor = { read: vi.fn(() => Promise.resolve(entries.shift() ?? null)), close: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(opendir).mockResolvedValueOnce(cursor as never);

    await service.replay();
    expect(cursor.read).toHaveBeenCalledTimes(1000);
    expect(repository.registerDeliveredHash).not.toHaveBeenCalled();
    expect(cursor.close).not.toHaveBeenCalled();
    await service.replay();
    expect(repository.registerDeliveredHash).toHaveBeenCalledExactlyOnceWith(22, HASH);
    expect(cursor.read).toHaveBeenCalledTimes(1003);
    expect(cursor.close).toHaveBeenCalledTimes(1);
    expect(opendir).toHaveBeenCalledTimes(1);
    expect(await readFile(target, 'utf8')).toBe('preserve outside data');
    expect(await readdir(directory)).toHaveLength(kind === 'directory' ? 1001 : 0);
  });

  it('continues past a failed identity and retries it on the next complete pass', async () => {
    await mkdir(directory);
    await writeFile(join(directory, `22-${HASH}`), '');
    await writeFile(join(directory, `33-${HASH}`), '');
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    vi.mocked(opendir).mockResolvedValueOnce({ read: vi.fn(() => Promise.resolve(entries.shift() ?? null)), close: vi.fn() } as never);
    repository.registerDeliveredHash.mockRejectedValueOnce(new Error('Library locked'));
    await service.replay();
    expect(await readdir(directory)).toHaveLength(2);
    await service.replay();
    expect(repository.registerDeliveredHash).toHaveBeenLastCalledWith(33, HASH);
    expect(await readdir(directory)).toEqual([`22-${HASH}`]);
    await service.replay();
    expect(repository.registerDeliveredHash).toHaveBeenLastCalledWith(22, HASH);
    expect(await readdir(directory)).toEqual([]);
  });

  it('closes a partial traversal on shutdown and does not reopen it', async () => {
    await mkdir(directory);
    const entries = Array.from({ length: 1001 }, () => ({ name: 'directory', isFile: () => false, isSymbolicLink: () => false }));
    const cursor = { read: vi.fn(() => Promise.resolve(entries.shift() ?? null)), close: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(opendir).mockResolvedValueOnce(cursor as never);
    await service.replay();
    await service.onModuleDestroy();
    await service.replay();
    expect(cursor.read).toHaveBeenCalledTimes(1000);
    expect(cursor.close).toHaveBeenCalledTimes(1);
    expect(opendir).toHaveBeenCalledTimes(1);
  });

  it('does not write through a symlink retry directory and still allows the download', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, directory);
    repository.registerDeliveredHash.mockRejectedValue(new Error('Database unavailable'));
    await expect(service.record(22, HASH)).resolves.toBeUndefined();
    await service.replay();
    expect(await readdir(outside)).toEqual([]);
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining('symbolic link'));
  });

  it('allows downloads when both database and retry storage are unavailable and logs both failures', async () => {
    await writeFile(directory, 'not a directory');
    repository.registerDeliveredHash.mockRejectedValue(new Error('Database unavailable'));
    await expect(service.record(22, HASH)).resolves.toBeUndefined();
    expect(warnings).toHaveBeenCalledTimes(2);
    expect(warnings).toHaveBeenLastCalledWith(expect.stringContaining('identity retry could not be persisted'));
  });

  it.each([
    [0, HASH],
    [22, '../unsafe'],
    [2147483648, HASH],
  ])('does not persist invalid identity %s/%s', async (id, hash) => {
    repository.registerDeliveredHash.mockRejectedValue(new Error('Database unavailable'));
    await service.record(id as number, hash as string);
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('tolerates startup with no pending directory', async () => {
    service.onApplicationBootstrap();
    await service.replay();
    expect(warnings).not.toHaveBeenCalled();
    expect(repository.registerDeliveredHash).not.toHaveBeenCalled();
  });
});
