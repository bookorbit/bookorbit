describe('getSevenZip', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('initializes once and reuses the cached module for subsequent calls', async () => {
    const instance = {
      FS: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        mkdir: vi.fn(),
        readdir: vi.fn(),
        readFile: vi.fn(),
        unlink: vi.fn(),
        rmdir: vi.fn(),
      },
      callMain: vi.fn(),
    };
    const factory = vi.fn().mockResolvedValue(instance);

    vi.doMock('7z-wasm', () => ({ default: factory }));

    const { getSevenZip } = await import('./sevenzip');

    const first = await getSevenZip();
    const second = await getSevenZip();

    expect(first).toBe(instance);
    expect(second).toBe(instance);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('shares a single in-flight initialization across concurrent callers', async () => {
    const instance = {
      FS: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        mkdir: vi.fn(),
        readdir: vi.fn(),
        readFile: vi.fn(),
        unlink: vi.fn(),
        rmdir: vi.fn(),
      },
      callMain: vi.fn(),
    };

    let resolveFactory!: (value: typeof instance) => void;
    const pending = new Promise<typeof instance>((resolve) => {
      resolveFactory = resolve;
    });
    const factory = vi.fn().mockReturnValue(pending);

    vi.doMock('7z-wasm', () => ({ default: factory }));

    const { getSevenZip } = await import('./sevenzip');

    const first = getSevenZip();
    const second = getSevenZip();

    resolveFactory(instance);

    await expect(Promise.all([first, second])).resolves.toEqual([instance, instance]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('clears failed initialization state so the next call can retry', async () => {
    const instance = {
      FS: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        mkdir: vi.fn(),
        readdir: vi.fn(),
        readFile: vi.fn(),
        unlink: vi.fn(),
        rmdir: vi.fn(),
      },
      callMain: vi.fn(),
    };

    const factory = vi.fn().mockRejectedValueOnce(new Error('7z init failed')).mockResolvedValueOnce(instance);

    vi.doMock('7z-wasm', () => ({ default: factory }));

    const { getSevenZip } = await import('./sevenzip');

    await expect(getSevenZip()).rejects.toThrow('7z init failed');
    await expect(getSevenZip()).resolves.toBe(instance);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
