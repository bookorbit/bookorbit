jest.mock('fs/promises', () => ({
  copyFile: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
}));

jest.mock('fs', () => ({ createWriteStream: jest.fn() }));
jest.mock('os', () => ({ tmpdir: () => '/tmp' }));
jest.mock('crypto', () => ({ randomUUID: () => 'unit-test-id' }));

import { PassThrough } from 'stream';
import { PayloadTooLargeException } from '@nestjs/common';
import { copyFile, mkdir, rename, stat, unlink } from 'fs/promises';
import { createWriteStream } from 'fs';

import { UploadStorageService } from './upload-storage.service';

const mockCopyFile = copyFile as jest.MockedFunction<typeof copyFile>;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockRename = rename as jest.MockedFunction<typeof rename>;
const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockCreateWriteStream = createWriteStream as jest.MockedFunction<typeof createWriteStream>;

describe('UploadStorageService', () => {
  let service: UploadStorageService;

  beforeEach(() => {
    jest.resetAllMocks();
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

    await expect(p).resolves.toEqual({ tempPath: '/tmp/projectx-upload-unit-test-id', sizeBytes: 123, truncated: false });
  });

  it('throws PayloadTooLargeException and cleans up when busboy truncates stream', async () => {
    const source = new PassThrough() as PassThrough & { truncated?: boolean };
    source.truncated = true;
    const sink = new PassThrough();
    mockCreateWriteStream.mockReturnValue(sink as unknown as ReturnType<typeof createWriteStream>);

    const p = service.streamToTemp(source);
    source.end(Buffer.from('x'));

    await expect(p).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/projectx-upload-unit-test-id');
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
    const warn = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation();

    mockUnlink.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));
    await service.cleanup('/tmp/missing');
    expect(warn).not.toHaveBeenCalled();

    mockUnlink.mockRejectedValueOnce(Object.assign(new Error('io fail'), { code: 'EIO' }));
    await service.cleanup('/tmp/bad');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('io fail'));
  });
});
