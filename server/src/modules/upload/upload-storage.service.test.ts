import { Test, type TestingModule } from '@nestjs/testing';
import { PayloadTooLargeException } from '@nestjs/common';
import { createReadStream, type WriteStream } from 'fs';
import { copyFile, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { PassThrough, Readable, Writable } from 'stream';
import { randomUUID } from 'crypto';

import { AppSettingsService } from '../app-settings/app-settings.service';
import { UploadStorageService } from './upload-storage.service';

const control = vi.hoisted(() => ({ tempDir: '' }));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    copyFile: vi.fn(actual.copyFile),
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
    stat: vi.fn(actual.stat),
    unlink: vi.fn(actual.unlink),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, tmpdir: () => control.tempDir };
});

const realFs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
const realOs = await vi.importActual<typeof import('os')>('os');
const ioError = (code: string) => Object.assign(new Error(`Injected ${code}`), { code });

describe('UploadStorageService', () => {
  let module: TestingModule;
  let service: UploadStorageService;
  let source: string;
  let destination: string;
  let destinationDir: string;
  const payload = Buffer.from('Book upload content\n');
  const settings = { getMaxUploadSizeMb: vi.fn().mockResolvedValue(500) };

  beforeEach(async () => {
    vi.resetAllMocks();
    control.tempDir = await mkdtemp(join(realOs.tmpdir(), 'bookorbit-upload-test-'));
    source = join(control.tempDir, 'source.epub');
    destinationDir = join(control.tempDir, 'dock');
    destination = join(destinationDir, 'book.epub');
    await writeFile(source, payload);
    module = await Test.createTestingModule({
      providers: [UploadStorageService, { provide: AppSettingsService, useValue: settings }],
    }).compile();
    service = module.get(UploadStorageService);
  });

  afterEach(async () => {
    await module.close();
    await rm(control.tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function crossDeviceMove() {
    vi.mocked(rename).mockRejectedValueOnce(ioError('EXDEV'));
    return service.moveToPath(source, destination);
  }

  async function expectPreservedSource() {
    expect(await readFile(source)).toEqual(payload);
    expect(vi.mocked(unlink).mock.calls.flat()).not.toContain(source);
  }

  async function expectEmptyDestination() {
    expect(await readdir(destinationDir)).toEqual([]);
  }

  it('streams multipart input to a temporary file and reports its actual size', async () => {
    const result = await service.streamToTemp(Readable.from(payload));
    expect(result.sizeBytes).toBe(payload.length);
    expect(await readFile(result.tempPath)).toEqual(payload);
  });

  it('rejects a truncated multipart stream and removes its temporary file', async () => {
    const input = Object.assign(Readable.from(payload), { truncated: true });
    await expect(service.streamToTemp(input)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(await readdir(control.tempDir)).toEqual(['source.epub']);
    expect(settings.getMaxUploadSizeMb).toHaveBeenCalledOnce();
  });

  it('preserves the stream error and removes the incomplete temporary upload', async () => {
    const failure = ioError('ECONNRESET');
    const input = Readable.from(
      (function* () {
        yield payload;
        throw failure;
      })(),
    );
    await expect(service.streamToTemp(input)).rejects.toBe(failure);
    expect(await readdir(control.tempDir)).toEqual(['source.epub']);
  });

  it('uses rename directly on the same filesystem, without opening a staging file', async () => {
    await service.moveToPath(source, destination);
    expect(await readFile(destination)).toEqual(payload);
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(rename).toHaveBeenCalledExactlyOnceWith(source, destination);
    expect(open).not.toHaveBeenCalled();
    expect(createReadStream).not.toHaveBeenCalled();
  });

  it.each(['EACCES', 'EPERM', 'ENOENT', 'EIO'])('propagates %s from rename without attempting a copy', async (code) => {
    const failure = ioError(code);
    vi.mocked(rename).mockRejectedValueOnce(failure);
    await expect(service.moveToPath(source, destination)).rejects.toBe(failure);
    expect(open).not.toHaveBeenCalled();
    await expectPreservedSource();
    await expectEmptyDestination();
  });

  it('does not move or delete the source when the destination directory cannot be created', async () => {
    await writeFile(destinationDir, 'not a directory');
    await expect(service.moveToPath(source, destination)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(rename).not.toHaveBeenCalled();
    await expectPreservedSource();
  });

  it('copies bytes across devices without requiring permission-copying support', async () => {
    vi.mocked(copyFile).mockRejectedValue(ioError('EPERM'));
    await crossDeviceMove();
    expect(await readFile(destination)).toEqual(payload);
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(destinationDir)).toEqual(['book.epub']);
    expect(copyFile).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\.bookorbit-upload-.*\.tmp$/), 'wx');
    expect(unlink).toHaveBeenCalledExactlyOnceWith(source);
    expect(vi.mocked(rename).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(unlink).mock.invocationCallOrder[0]);
  });

  it('keeps the final filename absent and the source intact until the stream has finished', async () => {
    const input = new PassThrough();
    vi.mocked(createReadStream).mockReturnValueOnce(input as ReturnType<typeof createReadStream>);
    const moving = crossDeviceMove();
    try {
      await vi.waitFor(() => expect(input.listenerCount('data')).toBeGreaterThan(0));
      input.write(payload);
      await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
      await expectPreservedSource();
      expect(await readdir(destinationDir)).toEqual([expect.stringMatching(/^\.bookorbit-upload-.*\.tmp$/)]);
      expect(rename).toHaveBeenCalledOnce();
    } finally {
      input.end();
      await moving;
    }
    expect(await readFile(destination)).toEqual(payload);
  });

  it('copies a multi-chunk binary file without altering its contents', async () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    await writeFile(source, bytes);
    await crossDeviceMove();
    expect((await readFile(destination)).equals(bytes)).toBe(true);
  });

  it('supports empty files', async () => {
    await writeFile(source, '');
    await crossDeviceMove();
    expect((await stat(destination)).size).toBe(0);
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not copy restrictive source permissions to the destination', async () => {
    await realFs.chmod(source, 0o400);
    await mkdir(destinationDir);
    const reference = join(destinationDir, 'reference');
    await writeFile(reference, '');
    const expectedMode = (await stat(reference)).mode & 0o777;
    await crossDeviceMove();
    expect((await stat(destination)).mode & 0o777).toBe(expectedMode);
  });

  it.each(['EACCES', 'ENOSPC'])('preserves the source when staging creation fails with %s', async (code) => {
    const failure = ioError(code);
    vi.mocked(open).mockRejectedValueOnce(failure);
    await expect(crossDeviceMove()).rejects.toBe(failure);
    await expectPreservedSource();
    await expectEmptyDestination();
    expect(unlink).not.toHaveBeenCalled();
  });

  it.each(['file', 'symlink'])('does not overwrite or delete a colliding staging %s', async (kind) => {
    const id = '00000000-0000-4000-8000-000000000000';
    vi.mocked(randomUUID).mockReturnValueOnce(id);
    await mkdir(destinationDir);
    const staging = join(destinationDir, `.bookorbit-upload-${id}.tmp`);
    if (kind === 'symlink') await symlink(source, staging);
    else await writeFile(staging, 'existing data');
    await expect(crossDeviceMove()).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(staging)).toEqual(kind === 'symlink' ? payload : Buffer.from('existing data'));
    await expectPreservedSource();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('removes staging and preserves the source after a read error mid-copy', async () => {
    const failure = ioError('EIO');
    const input = Readable.from(
      (function* () {
        yield payload;
        throw failure;
      })(),
    );
    vi.mocked(createReadStream).mockReturnValueOnce(input as ReturnType<typeof createReadStream>);
    await expect(crossDeviceMove()).rejects.toBe(failure);
    await expectPreservedSource();
    await expectEmptyDestination();
    expect(rename).toHaveBeenCalledOnce();
  });

  it('closes staging and preserves the source when opening the read stream throws', async () => {
    const failure = ioError('EIO');
    vi.mocked(createReadStream).mockImplementationOnce(() => {
      throw failure;
    });
    await expect(crossDeviceMove()).rejects.toBe(failure);
    const handle = await vi.mocked(open).mock.results[0].value;
    expect(handle.fd).toBe(-1);
    await expectPreservedSource();
    await expectEmptyDestination();
  });

  it('closes staging and preserves the source when the destination stream runs out of space', async () => {
    const failure = ioError('ENOSPC');
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await realFs.open(...args);
      vi.spyOn(handle, 'createWriteStream').mockReturnValueOnce(
        new Writable({
          write(_chunk, _encoding, callback) {
            callback(failure);
          },
        }) as WriteStream,
      );
      return handle;
    });
    await expect(crossDeviceMove()).rejects.toBe(failure);
    const handle = await vi.mocked(open).mock.results[0].value;
    expect(handle.fd).toBe(-1);
    await expectPreservedSource();
    await expectEmptyDestination();
    expect(rename).toHaveBeenCalledOnce();
  });

  it('preserves an existing destination and source when final placement fails', async () => {
    await mkdir(destinationDir);
    await writeFile(destination, 'existing book');
    const failure = ioError('EACCES');
    vi.mocked(rename).mockRejectedValueOnce(ioError('EXDEV')).mockRejectedValueOnce(failure);
    await expect(service.moveToPath(source, destination)).rejects.toBe(failure);
    expect(await readFile(destination, 'utf8')).toBe('existing book');
    expect(await readdir(destinationDir)).toEqual(['book.epub']);
    await expectPreservedSource();
  });

  it('retains rename replacement semantics after a successful cross-device copy', async () => {
    await mkdir(destinationDir);
    await writeFile(destination, 'old content');
    await crossDeviceMove();
    expect(await readFile(destination)).toEqual(payload);
    expect(await readdir(destinationDir)).toEqual(['book.epub']);
  });

  it('preserves the primary error and logs a staging cleanup failure', async () => {
    const warn = vi.spyOn(service['logger'], 'warn').mockImplementation(() => {});
    const failure = ioError('EACCES');
    vi.mocked(rename).mockRejectedValueOnce(ioError('EXDEV')).mockRejectedValueOnce(failure);
    vi.mocked(unlink).mockRejectedValueOnce(ioError('EBUSY'));
    await expect(service.moveToPath(source, destination)).rejects.toBe(failure);
    await expectPreservedSource();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EBUSY'));
  });

  it('keeps the completed destination and logs when source cleanup fails', async () => {
    const warn = vi.spyOn(service['logger'], 'warn').mockImplementation(() => {});
    vi.mocked(unlink).mockRejectedValueOnce(ioError('EBUSY'));
    await crossDeviceMove();
    expect(await readFile(destination)).toEqual(payload);
    expect(await readFile(source)).toEqual(payload);
    expect(await readdir(destinationDir)).toEqual(['book.epub']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EBUSY'));
  });

  it('handles concurrent cross-device moves using distinct staging files', async () => {
    const otherSource = join(control.tempDir, 'other.epub');
    const otherDestination = join(destinationDir, 'other.epub');
    await writeFile(otherSource, 'another book');
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (from === source || from === otherSource) throw ioError('EXDEV');
      return realFs.rename(from, to);
    });
    await Promise.all([service.moveToPath(source, destination), service.moveToPath(otherSource, otherDestination)]);
    expect(await readFile(destination)).toEqual(payload);
    expect(await readFile(otherDestination, 'utf8')).toBe('another book');
    expect((await readdir(destinationDir)).sort()).toEqual(['book.epub', 'other.epub']);
    expect(new Set(vi.mocked(open).mock.calls.map(([path]) => path)).size).toBe(2);
  });

  it('ignores missing files during concurrent cleanup', async () => {
    const warn = vi.spyOn(service['logger'], 'warn').mockImplementation(() => {});
    await Promise.all([service.cleanup(source), service.cleanup(source), service.cleanup(source)]);
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(warn).not.toHaveBeenCalled();
  });
});
