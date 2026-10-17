vi.mock('fs/promises', () => ({ mkdir: vi.fn(), mkdtemp: vi.fn(), rename: vi.fn(), rm: vi.fn(), stat: vi.fn() }));
vi.mock('child_process', () => ({ execFile: vi.fn() }));
vi.mock('./kepub-href-decoding', () => ({ findDecodableHrefs: vi.fn(), writeWithDecodedHrefs: vi.fn(), restoreEncodedHrefs: vi.fn() }));

import { Test } from '@nestjs/testing';
import { storageConfig } from '../../../config/config';
import { execFile } from 'child_process';
import { mkdir, mkdtemp, rename, rm, stat } from 'fs/promises';

import { KepubConversionService } from './kepub-conversion.service';
import { findDecodableHrefs, restoreEncodedHrefs, writeWithDecodedHrefs } from './kepub-href-decoding';
import { KepubifyBinaryService } from './kepubify-binary.service';

const execMock = vi.mocked(execFile);
const statMock = vi.mocked(stat);
const input = { sourcePath: '/books/source.epub', fileHash: 'abc', bookId: 44, hyphenate: false };
const cacheDir = '/app-data/.kepub-cache/44';
const tempDir = `${cacheDir}/.conversion-unit-test`;
const tempPath = `${tempDir}/book.kepub.epub`;

function successfulConversion() {
  execMock.mockImplementation((_path, _args, _options, callback) => {
    callback?.(null, '', '');
    return {} as never;
  });
}

describe('KepubConversionService', () => {
  let service: KepubConversionService;
  let binary: { getBinaryPath: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.resetAllMocks();
    binary = { getBinaryPath: vi.fn().mockResolvedValue('/tools/kepubify') };
    statMock.mockRejectedValue(Object.assign(new Error('No cached file'), { code: 'ENOENT' }));
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(mkdtemp).mockImplementation((prefix) => Promise.resolve(`${prefix}unit-test`) as never);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    successfulConversion();
    vi.mocked(findDecodableHrefs).mockResolvedValue(new Map());
    vi.mocked(writeWithDecodedHrefs).mockResolvedValue(undefined);
    vi.mocked(restoreEncodedHrefs).mockResolvedValue(1);
    const module = await Test.createTestingModule({
      providers: [
        KepubConversionService,
        { provide: storageConfig.KEY, useValue: { appDataPath: '/app-data' } },
        { provide: KepubifyBinaryService, useValue: binary },
      ],
    }).compile();
    service = module.get(KepubConversionService);
  });

  it('returns existing conversions without invoking the binary or altering the cache', async () => {
    statMock.mockResolvedValue({} as never);
    await expect(service.getKepubPath(input)).resolves.toBe(`${cacheDir}/abc.kepub.epub`);
    expect(binary.getBinaryPath).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it.each([
    { hash: 'abc', hyphenate: false, audioless: false, key: 'abc' },
    { hash: 'abc', hyphenate: true, audioless: false, key: 'abc-hyph' },
    { hash: 'abc', hyphenate: false, audioless: true, key: 'abc-noaudio-v1' },
    { hash: 'abc', hyphenate: true, audioless: true, key: 'abc-noaudio-v1-hyph' },
    { hash: null, hyphenate: false, audioless: false, key: 'nohash' },
    { hash: undefined, hyphenate: false, audioless: false, key: 'nohash' },
  ])('publishes a complete conversion with the compatible $key cache key', async ({ hash, hyphenate, audioless, key }) => {
    await expect(service.getKepubPath({ ...input, fileHash: hash, hyphenate, audioless })).resolves.toBe(`${cacheDir}/${key}.kepub.epub`);
    expect(mkdir).toHaveBeenCalledWith(cacheDir, { recursive: true });
    expect(mkdtemp).toHaveBeenCalledWith(`${cacheDir}/.conversion-`);
    expect(execMock).toHaveBeenCalledWith(
      '/tools/kepubify',
      [...(hyphenate ? ['--hyphenate'] : []), '--output', tempPath, input.sourcePath],
      { timeout: 60_000 },
      expect.any(Function),
    );
    expect(rename).toHaveBeenCalledExactlyOnceWith(tempPath, `${cacheDir}/${key}.kepub.epub`);
    expect(rm).toHaveBeenCalledExactlyOnceWith(tempDir, { recursive: true, force: true });
    expect(execMock.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(rename).mock.invocationCallOrder[0]!);
    expect(vi.mocked(rename).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(rm).mock.invocationCallOrder[0]!);
  });

  it('coalesces simultaneous misses and publishes only after conversion finishes', async () => {
    let complete!: () => void;
    execMock.mockImplementation((_path, _args, _options, callback) => {
      complete = () => callback?.(null, '', '');
      return {} as never;
    });
    const first = service.getKepubPath(input);
    const second = service.getKepubPath(input);
    await vi.waitFor(() => expect(execMock).toHaveBeenCalledTimes(1));
    const third = service.getKepubPath(input);
    expect(rename).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
    complete();
    await expect(Promise.all([first, second, third])).resolves.toEqual(Array(3).fill(`${cacheDir}/abc.kepub.epub`));
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce different source hashes, books, or conversion options', async () => {
    await Promise.all([
      service.getKepubPath(input),
      service.getKepubPath({ ...input, fileHash: 'def' }),
      service.getKepubPath({ ...input, bookId: 45 }),
      service.getKepubPath({ ...input, hyphenate: true }),
      service.getKepubPath({ ...input, audioless: true }),
    ]);
    expect(execMock).toHaveBeenCalledTimes(5);
    expect(rename).toHaveBeenCalledTimes(5);
  });

  it('cleans up a failed conversion without publishing it, and permits a retry', async () => {
    execMock.mockImplementationOnce((_path, _args, _options, callback) => {
      callback?.(new Error('Conversion failed'), '', '');
      return {} as never;
    });
    await expect(service.getKepubPath(input)).rejects.toThrow('Conversion failed');
    expect(rename).not.toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith(tempDir, { recursive: true, force: true });
    await expect(service.getKepubPath(input)).resolves.toBe(`${cacheDir}/abc.kepub.epub`);
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('cleans up when atomic publication fails and allows a retry', async () => {
    vi.mocked(rename).mockRejectedValueOnce(new Error('Rename failed'));
    await expect(service.getKepubPath(input)).rejects.toThrow('Rename failed');
    expect(rm).toHaveBeenCalledWith(tempDir, { recursive: true, force: true });
    await expect(service.getKepubPath(input)).resolves.toBe(`${cacheDir}/abc.kepub.epub`);
  });

  it.each(['binary', 'directory', 'temporary-directory'])('does not publish after %s preparation fails', async (stage) => {
    const error = new Error('Preparation failed');
    if (stage === 'binary') binary.getBinaryPath.mockRejectedValue(error);
    if (stage === 'directory') vi.mocked(mkdir).mockRejectedValue(error);
    if (stage === 'temporary-directory') vi.mocked(mkdtemp).mockRejectedValue(error);
    await expect(service.getKepubPath(input)).rejects.toThrow('Preparation failed');
    expect(execMock).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  describe('books listing chapters by percent-encoded hrefs (#1136)', () => {
    const decoded = new Map([['text/chapter one.xhtml', 'text/chapter%20one.xhtml']]);

    it('converts them through a decoded copy, restores their hrefs, and caches them under their own key', async () => {
      vi.mocked(findDecodableHrefs).mockResolvedValue(decoded);

      await expect(service.getKepubPath(input)).resolves.toBe(`${cacheDir}/abc-hrefs.kepub.epub`);

      expect(writeWithDecodedHrefs).toHaveBeenCalledWith(input.sourcePath, `${tempDir}/source.epub`, decoded);
      expect(execMock).toHaveBeenCalledWith(
        '/tools/kepubify',
        ['--output', `${tempDir}/converted.kepub.epub`, `${tempDir}/source.epub`],
        { timeout: 60_000 },
        expect.any(Function),
      );
      expect(restoreEncodedHrefs).toHaveBeenCalledWith(`${tempDir}/converted.kepub.epub`, tempPath, decoded);
      expect(rename).toHaveBeenCalledExactlyOnceWith(tempPath, `${cacheDir}/abc-hrefs.kepub.epub`);
    });

    it('inspects a source once, not on every lookup', async () => {
      statMock.mockResolvedValue({} as never);

      await service.getKepubPath(input);
      await service.getKepubPath(input);

      expect(findDecodableHrefs).toHaveBeenCalledTimes(1);
    });

    it('converts a source it cannot inspect as is, under the key it always had', async () => {
      vi.mocked(findDecodableHrefs).mockRejectedValue(new Error('not a zip'));

      await expect(service.getKepubPath(input)).resolves.toBe(`${cacheDir}/abc.kepub.epub`);

      expect(writeWithDecodedHrefs).not.toHaveBeenCalled();
      expect(execMock).toHaveBeenCalledWith('/tools/kepubify', ['--output', tempPath, input.sourcePath], { timeout: 60_000 }, expect.any(Function));
    });
  });
});
