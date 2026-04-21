vi.mock('fs/promises', () => ({
  copyFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('fs', () => ({ createWriteStream: vi.fn() }));
vi.mock('os', () => ({ tmpdir: () => '/tmp' }));
vi.mock('crypto', () => ({ randomUUID: () => 'unit-test-id' }));

import { PassThrough } from 'stream';
import { PayloadTooLargeException } from '@nestjs/common';
import { copyFile, mkdir, rename, stat, unlink } from 'fs/promises';
import { createWriteStream } from 'fs';

import { UploadStorageService } from './upload-storage.service';

const mockCopyFile = copyFile as MockedFunction<typeof copyFile>;
const mockMkdir = mkdir as MockedFunction<typeof mkdir>;
const mockRename = rename as MockedFunction<typeof rename>;
const mockStat = stat as MockedFunction<typeof stat>;
const mockUnlink = unlink as MockedFunction<typeof unlink>;
const mockCreateWriteStream = createWriteStream as MockedFunction<typeof createWriteStream>;

describe('UploadStorageService', () => {
  let service: UploadStorageService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new UploadStorageService();
    mockMkdir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 123 } as Awaited<ReturnType<typeof stat>>);
  });

  it('streams multipart input to temp file and reports size', async () => {
    const source = new PassThrough();
    const sink = new PassThrough();
    mockCreateWriteStream.mockReturnValue(sink as unknown as ReturnType<typeof createWriteStream>);

    const p = service.streamToTemp(source);
    source.end(Buffer.from('abc'));

    await expect(p).resolves.toEqual({ tempPath: '/tmp/bookorbit-upload-unit-test-id', sizeBytes: 123 });
  });

  it('throws PayloadTooLargeException and cleans up when busboy truncates stream', async () => {
    const source = new PassThrough() as PassThrough & { truncated?: boolean };
    source.truncated = true;
    const sink = new PassThrough();
    mockCreateWriteStream.mockReturnValue(sink as unknown as ReturnType<typeof createWriteStream>);

    const p = service.streamToTemp(source);
    source.end(Buffer.from('x'));

    await expect(p).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/bookorbit-upload-unit-test-id');
  });

  it('cleans up temp file when the source stream errors', async () => {
    const source = new PassThrough();
    const sink = new PassThrough();
    mockCreateWriteStream.mockReturnValue(sink as unknown as ReturnType<typeof createWriteStream>);

    const p = service.streamToTemp(source);
    source.destroy(new Error('stream read failed'));

    await expect(p).rejects.toThrow('stream read failed');
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/bookorbit-upload-unit-test-id');
  });

  it('falls back to copy+unlink when rename fails with EXDEV', async () => {
    mockRename.mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));

    await service.moveToPath('/tmp/a', '/books/x/file.epub');

    expect(mockMkdir).toHaveBeenCalledWith('/books/x', { recursive: true });
    expect(mockCopyFile).toHaveBeenCalledWith('/tmp/a', '/books/x/file.epub');
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/a');
  });

  it('rethrows non-EXDEV rename errors', async () => {
    mockRename.mockRejectedValue(new Error('permission denied'));

    await expect(service.moveToPath('/tmp/a', '/books/x/file.epub')).rejects.toThrow('permission denied');
    expect(mockCopyFile).not.toHaveBeenCalled();
  });

  it('cleanup ignores ENOENT and warns on other unlink failures', async () => {
    const warn = vi.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation();

    mockUnlink.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));
    await service.cleanup('/tmp/missing');
    expect(warn).not.toHaveBeenCalled();

    mockUnlink.mockRejectedValueOnce(Object.assign(new Error('io fail'), { code: 'EIO' }));
    await service.cleanup('/tmp/bad');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('io fail'));
  });

  it('propagates stat error after successful write in streamToTemp', async () => {
    const source = new PassThrough();
    const sink = new PassThrough();
    mockCreateWriteStream.mockReturnValue(sink as unknown as ReturnType<typeof createWriteStream>);
    mockStat.mockRejectedValue(new Error('stat failed'));

    const p = service.streamToTemp(source);
    source.end(Buffer.from('data'));

    await expect(p).rejects.toThrow('stat failed');
  });

  it('propagates mkdir error in moveToPath', async () => {
    mockMkdir.mockRejectedValue(new Error('mkdir failed'));

    await expect(service.moveToPath('/tmp/a', '/books/x/file.epub')).rejects.toThrow('mkdir failed');
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('propagates copyFile error during EXDEV fallback', async () => {
    mockRename.mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
    mockCopyFile.mockRejectedValue(new Error('copy failed'));

    await expect(service.moveToPath('/tmp/a', '/books/x/file.epub')).rejects.toThrow('copy failed');
  });

  it('propagates unlink error after copy in EXDEV fallback', async () => {
    mockRename.mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
    mockCopyFile.mockResolvedValue(undefined);
    mockUnlink.mockRejectedValue(Object.assign(new Error('unlink failed'), { code: 'EBUSY' }));

    await service.moveToPath('/tmp/a', '/books/x/file.epub');
    expect(mockCopyFile).toHaveBeenCalledWith('/tmp/a', '/books/x/file.epub');
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/a');
  });

  it('concurrent cleanup calls are safe', async () => {
    mockUnlink.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }));

    await Promise.all([service.cleanup('/tmp/file'), service.cleanup('/tmp/file'), service.cleanup('/tmp/file')]);
    expect(mockUnlink).toHaveBeenCalledTimes(3);
  });
});
