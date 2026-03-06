describe('getSevenZip', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('initializes once and reuses the cached module for subsequent calls', async () => {
    const instance = {
      FS: {
        open: jest.fn(),
        write: jest.fn(),
        close: jest.fn(),
        mkdir: jest.fn(),
        readdir: jest.fn(),
        readFile: jest.fn(),
        unlink: jest.fn(),
        rmdir: jest.fn(),
      },
      callMain: jest.fn(),
    };
    const factory = jest.fn().mockResolvedValue(instance);

    jest.doMock('7z-wasm', () => factory);

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
        open: jest.fn(),
        write: jest.fn(),
        close: jest.fn(),
        mkdir: jest.fn(),
        readdir: jest.fn(),
        readFile: jest.fn(),
        unlink: jest.fn(),
        rmdir: jest.fn(),
      },
      callMain: jest.fn(),
    };

    let resolveFactory!: (value: typeof instance) => void;
    const pending = new Promise<typeof instance>((resolve) => {
      resolveFactory = resolve;
    });
    const factory = jest.fn().mockReturnValue(pending);

    jest.doMock('7z-wasm', () => factory);

    const { getSevenZip } = await import('./sevenzip');

    const first = getSevenZip();
    const second = getSevenZip();

    expect(factory).toHaveBeenCalledTimes(1);

    resolveFactory(instance);

    await expect(Promise.all([first, second])).resolves.toEqual([instance, instance]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('clears failed initialization state so the next call can retry', async () => {
    const instance = {
      FS: {
        open: jest.fn(),
        write: jest.fn(),
        close: jest.fn(),
        mkdir: jest.fn(),
        readdir: jest.fn(),
        readFile: jest.fn(),
        unlink: jest.fn(),
        rmdir: jest.fn(),
      },
      callMain: jest.fn(),
    };

    const factory = jest.fn().mockRejectedValueOnce(new Error('7z init failed')).mockResolvedValueOnce(instance);

    jest.doMock('7z-wasm', () => factory);

    const { getSevenZip } = await import('./sevenzip');

    await expect(getSevenZip()).rejects.toThrow('7z init failed');
    await expect(getSevenZip()).resolves.toBe(instance);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
