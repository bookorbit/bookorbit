vi.mock('fs/promises', () => ({
  chmod: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

import { chmod, mkdir, stat, writeFile } from 'fs/promises';

import { KepubifyBinaryService } from './kepubify-binary.service';

const chmodMock = vi.mocked(chmod);
const mkdirMock = vi.mocked(mkdir);
const statMock = vi.mocked(stat);
const writeFileMock = vi.mocked(writeFile);

describe('KepubifyBinaryService', () => {
  const config = {
    get: vi.fn().mockReturnValue('/app-data'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('detects expected binary names by platform/arch', () => {
    const service = new KepubifyBinaryService(config as never);

    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64');
    expect((service as any).detectBinaryName()).toBe('kepubify-darwin-arm64');

    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');
    expect((service as any).detectBinaryName()).toBe('kepubify-linux-64bit');
  });

  it('throws for unsupported platforms', () => {
    const service = new KepubifyBinaryService(config as never);
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');

    expect(() => (service as any).detectBinaryName()).toThrow('Unsupported platform');
  });

  it('returns system binary path when kepubify is already installed', async () => {
    const service = new KepubifyBinaryService(config as never);
    statMock.mockResolvedValue({} as never);

    await expect(service.getBinaryPath()).resolves.toBe('/usr/local/bin/kepubify');
    await expect(service.getBinaryPath()).resolves.toBe('/usr/local/bin/kepubify');

    expect(statMock).toHaveBeenCalledTimes(1);
  });

  it('caches computed binary path after first resolution when system binary absent', async () => {
    const service = new KepubifyBinaryService(config as never);
    statMock.mockRejectedValue(new Error('missing'));
    const detectSpy = vi.spyOn(service as any, 'detectBinaryName').mockReturnValue('kepubify-linux-64bit');
    const ensureSpy = vi.spyOn(service as any, 'ensureBinary').mockResolvedValue(undefined);

    await expect(service.getBinaryPath()).resolves.toBe('/app-data/.tools/kepubify/kepubify-linux-64bit');
    await expect(service.getBinaryPath()).resolves.toBe('/app-data/.tools/kepubify/kepubify-linux-64bit');

    expect(detectSpy).toHaveBeenCalledTimes(1);
    expect(ensureSpy).toHaveBeenCalledTimes(1);
  });

  it('ensureBinary keeps executable bit for already-cached binaries', async () => {
    const service = new KepubifyBinaryService(config as never);
    statMock.mockResolvedValue({} as never);

    await expect((service as any).ensureBinary('/tmp/kepubify', 'kepubify-linux-64bit', '/tmp')).resolves.toBeUndefined();

    expect(chmodMock).toHaveBeenCalledWith('/tmp/kepubify', 0o755);
    expect(mkdirMock).not.toHaveBeenCalled();
  });

  it('downloads missing binary and writes executable file', async () => {
    const service = new KepubifyBinaryService(config as never);
    statMock.mockRejectedValue(new Error('missing'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(Uint8Array.from([1, 2, 3]).buffer),
      }),
    );

    await (service as any).ensureBinary('/tmp/kepubify', 'kepubify-linux-64bit', '/tmp');

    expect(mkdirMock).toHaveBeenCalledWith('/tmp', { recursive: true });
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/kepubify', Buffer.from([1, 2, 3]));
    expect(chmodMock).toHaveBeenCalledWith('/tmp/kepubify', 0o755);
  });

  it('throws when binary download returns non-ok status', async () => {
    const service = new KepubifyBinaryService(config as never);
    statMock.mockRejectedValue(new Error('missing'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await expect((service as any).ensureBinary('/tmp/kepubify', 'kepubify-linux-64bit', '/tmp')).rejects.toThrow(
      'Failed to download kepubify: HTTP 503',
    );
  });
});
