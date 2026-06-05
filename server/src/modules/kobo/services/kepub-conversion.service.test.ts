vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'child_process';
import { mkdir, stat } from 'fs/promises';

import { KepubConversionService } from './kepub-conversion.service';

const statMock = vi.mocked(stat);
const mkdirMock = vi.mocked(mkdir);
const execFileMock = vi.mocked(execFile);

function makeService() {
  const config = { get: vi.fn().mockReturnValue('/app-data') };
  const kepubifyBinaryService = { getBinaryPath: vi.fn().mockResolvedValue('/tools/kepubify') };
  return { service: new KepubConversionService(config as never, kepubifyBinaryService as never), kepubifyBinaryService };
}

describe('KepubConversionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an existing cached kepub path without running kepubify', async () => {
    const { service, kepubifyBinaryService } = makeService();
    statMock.mockResolvedValueOnce({} as never);

    await expect(service.getKepubPath({ sourcePath: '/books/source.epub', fileHash: 'abc', bookId: 44, hyphenate: false })).resolves.toBe(
      '/app-data/.kepub-cache/44/abc.kepub.epub',
    );

    expect(kepubifyBinaryService.getBinaryPath).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('converts and caches a kepub when the cache is missing', async () => {
    const { service } = makeService();
    statMock.mockRejectedValueOnce(new Error('cache miss'));
    execFileMock.mockImplementation((_path, _args, _options, cb) => {
      cb?.(null, '', '');
      return {} as never;
    });

    await expect(service.getKepubPath({ sourcePath: '/books/source.epub', fileHash: 'hash', bookId: 44, hyphenate: true })).resolves.toBe(
      '/app-data/.kepub-cache/44/hash-hyph.kepub.epub',
    );

    expect(mkdirMock).toHaveBeenCalledWith('/app-data/.kepub-cache/44', { recursive: true });
    expect(execFileMock).toHaveBeenCalledWith(
      '/tools/kepubify',
      ['--hyphenate', '--output', '/app-data/.kepub-cache/44/hash-hyph.kepub.epub', '/books/source.epub'],
      { timeout: 60_000 },
      expect.any(Function),
    );
  });

  it('uses a stable nohash cache key when file hash is unavailable', async () => {
    const { service } = makeService();
    statMock.mockRejectedValueOnce(new Error('cache miss'));
    execFileMock.mockImplementation((_path, _args, _options, cb) => {
      cb?.(null, '', '');
      return {} as never;
    });

    await expect(service.getKepubPath({ sourcePath: '/books/source.epub', fileHash: null, bookId: 44, hyphenate: false })).resolves.toBe(
      '/app-data/.kepub-cache/44/nohash.kepub.epub',
    );

    expect(execFileMock).toHaveBeenCalledWith(
      '/tools/kepubify',
      ['--output', '/app-data/.kepub-cache/44/nohash.kepub.epub', '/books/source.epub'],
      { timeout: 60_000 },
      expect.any(Function),
    );
  });
});
