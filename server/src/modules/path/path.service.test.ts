vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  realpath: vi.fn(),
}));

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { readdir, lstat, mkdir } from 'fs/promises';

import { PathService } from './path.service';

const readdirMock = vi.mocked(readdir);
const lstatMock = vi.mocked(lstat);
const mkdirMock = vi.mocked(mkdir);

function dirStat() {
  return { isSymbolicLink: () => false, isDirectory: () => true } as never;
}

function entry(name: string, options: { directory?: boolean; symbolicLink?: boolean } = {}) {
  return {
    name,
    isDirectory: () => options.directory ?? false,
    isSymbolicLink: () => options.symbolicLink ?? false,
  };
}

describe('PathService', () => {
  const pathPolicy = {
    getBrowseRoot: vi.fn(() => '/tmp/books'),
    resolveBrowsePath: vi.fn((path?: string) => Promise.resolve(path || '/tmp/books')),
    assertWithinBrowseRoot: vi.fn((path: string) => Promise.resolve(path)),
  };
  let service: PathService;

  beforeEach(() => {
    vi.resetAllMocks();
    pathPolicy.getBrowseRoot.mockReturnValue('/tmp/books');
    pathPolicy.resolveBrowsePath.mockImplementation((path?: string) => Promise.resolve(path || '/tmp/books'));
    pathPolicy.assertWithinBrowseRoot.mockImplementation((path: string) => Promise.resolve(path));
    service = new PathService(pathPolicy as never);
  });

  it('returns the configured browse root in config', () => {
    expect(service.getConfig()).toEqual({ root: '/tmp/books' });
  });

  it('returns empty for blocked system paths', async () => {
    await expect(service.listDirectories('/proc/1')).resolves.toEqual([]);
    await expect(service.listDirectories('/sys/class')).resolves.toEqual([]);

    expect(readdirMock).not.toHaveBeenCalled();
  });

  it('uses the configured browse root when listing without a path', async () => {
    lstatMock.mockResolvedValue({ isSymbolicLink: () => false, isDirectory: () => true } as never);
    readdirMock.mockResolvedValue([] as never);

    await expect(service.listDirectories()).resolves.toEqual([]);

    expect(pathPolicy.resolveBrowsePath).toHaveBeenCalledWith(undefined);
    expect(lstatMock).toHaveBeenCalledWith('/tmp/books');
  });

  it('rejects symlinked root paths', async () => {
    lstatMock.mockResolvedValue({ isSymbolicLink: () => true, isDirectory: () => false } as never);

    await expect(service.listDirectories('/tmp/books')).resolves.toEqual([]);
  });

  it('lists only accessible real (non-symlink) directories and sorts them by name', async () => {
    lstatMock.mockResolvedValue({ isSymbolicLink: () => false, isDirectory: () => true } as never);

    readdirMock.mockResolvedValue([
      entry('notes.txt'),
      entry('.cache', { directory: true }),
      entry('zeta', { directory: true }),
      entry('alpha-link', { directory: true, symbolicLink: true }),
      entry('beta', { directory: true }),
    ] as never);

    await expect(service.listDirectories('/tmp/books')).resolves.toEqual([
      { name: 'beta', path: '/tmp/books/beta' },
      { name: 'zeta', path: '/tmp/books/zeta' },
    ]);
    expect(lstatMock).toHaveBeenCalledTimes(1);
  });

  it('excludes entries that appear as directories but are symlinks when lstat confirms it', async () => {
    lstatMock.mockResolvedValue({ isSymbolicLink: () => false, isDirectory: () => true } as never);

    readdirMock.mockResolvedValue([entry('real-dir', { directory: true }), entry('sym-dir', { directory: true, symbolicLink: true })] as never);

    await expect(service.listDirectories('/tmp/books')).resolves.toEqual([{ name: 'real-dir', path: '/tmp/books/real-dir' }]);
  });

  it('rejects /etc and /root as blocked paths', async () => {
    await expect(service.listDirectories('/etc')).resolves.toEqual([]);
    await expect(service.listDirectories('/root')).resolves.toEqual([]);
    await expect(service.listDirectories('/etc/passwd')).resolves.toEqual([]);
    expect(readdirMock).not.toHaveBeenCalled();
  });

  it('returns empty when reading the target directory fails', async () => {
    lstatMock.mockResolvedValue({ isSymbolicLink: () => false, isDirectory: () => true } as never);
    readdirMock.mockRejectedValue(new Error('missing'));

    await expect(service.listDirectories('/tmp/books/does/not/exist')).resolves.toEqual([]);
  });

  it('rechecks browse-root containment before accessing the filesystem', async () => {
    pathPolicy.getBrowseRoot.mockReturnValue('/books');
    pathPolicy.resolveBrowsePath.mockResolvedValue('/etc');

    await expect(service.listDirectories('/books/../../etc')).resolves.toEqual([]);
    expect(lstatMock).not.toHaveBeenCalled();
    expect(readdirMock).not.toHaveBeenCalled();
  });

  describe('createDirectory', () => {
    it('creates a folder under an accessible parent and returns its name and path', async () => {
      lstatMock.mockResolvedValue(dirStat());
      mkdirMock.mockResolvedValue(undefined as never);

      await expect(service.createDirectory('/tmp/books', 'scifi')).resolves.toEqual({
        name: 'scifi',
        path: '/tmp/books/scifi',
      });
      expect(mkdirMock).toHaveBeenCalledWith('/tmp/books/scifi');
    });

    it('trims the folder name before creating', async () => {
      lstatMock.mockResolvedValue(dirStat());
      mkdirMock.mockResolvedValue(undefined as never);

      await expect(service.createDirectory('/tmp/books', '  scifi  ')).resolves.toEqual({
        name: 'scifi',
        path: '/tmp/books/scifi',
      });
      expect(mkdirMock).toHaveBeenCalledWith('/tmp/books/scifi');
    });

    it('rejects blocked parent paths without touching the filesystem', async () => {
      await expect(service.createDirectory('/etc', 'evil')).rejects.toBeInstanceOf(ForbiddenException);
      expect(lstatMock).not.toHaveBeenCalled();
      expect(mkdirMock).not.toHaveBeenCalled();
    });

    it('rejects parent paths outside the configured browse root', async () => {
      pathPolicy.resolveBrowsePath.mockRejectedValue(new ForbiddenException('outside root'));

      await expect(service.createDirectory('/tmp/books', 'scifi')).rejects.toBeInstanceOf(ForbiddenException);
      expect(lstatMock).not.toHaveBeenCalled();
      expect(mkdirMock).not.toHaveBeenCalled();
    });

    it('rejects a symlinked parent', async () => {
      lstatMock.mockResolvedValue({ isSymbolicLink: () => true, isDirectory: () => false } as never);

      await expect(service.createDirectory('/tmp/books/link', 'scifi')).rejects.toBeInstanceOf(ForbiddenException);
      expect(mkdirMock).not.toHaveBeenCalled();
    });

    it('rejects a parent that is not a directory', async () => {
      lstatMock.mockResolvedValue({ isSymbolicLink: () => false, isDirectory: () => false } as never);

      await expect(service.createDirectory('/tmp/books/file.txt', 'scifi')).rejects.toBeInstanceOf(BadRequestException);
      expect(mkdirMock).not.toHaveBeenCalled();
    });

    it.each(['', '   ', '..', '.', '.hidden', 'a/b', 'a\\b'])('rejects unsafe folder name %j before any filesystem access', async (name) => {
      await expect(service.createDirectory('/tmp/books', name)).rejects.toBeInstanceOf(BadRequestException);
      expect(lstatMock).not.toHaveBeenCalled();
      expect(mkdirMock).not.toHaveBeenCalled();
    });

    it('maps EEXIST to a conflict', async () => {
      lstatMock.mockResolvedValue(dirStat());
      mkdirMock.mockRejectedValue(Object.assign(new Error('exists'), { code: 'EEXIST' }));

      await expect(service.createDirectory('/tmp/books', 'scifi')).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps EACCES to forbidden', async () => {
      lstatMock.mockResolvedValue(dirStat());
      mkdirMock.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

      await expect(service.createDirectory('/tmp/books', 'scifi')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('maps EROFS to a bad request', async () => {
      lstatMock.mockResolvedValue(dirStat());
      mkdirMock.mockRejectedValue(Object.assign(new Error('read-only'), { code: 'EROFS' }));

      await expect(service.createDirectory('/tmp/books', 'scifi')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps a missing parent (ENOENT) to a bad request', async () => {
      lstatMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

      await expect(service.createDirectory('/tmp/books/gone', 'scifi')).rejects.toBeInstanceOf(BadRequestException);
      expect(mkdirMock).not.toHaveBeenCalled();
    });

    it('rechecks browse-root containment before accessing the filesystem', async () => {
      pathPolicy.getBrowseRoot.mockReturnValue('/books');
      pathPolicy.resolveBrowsePath.mockResolvedValue('/etc');

      await expect(service.createDirectory('/books/../../etc', 'scifi')).rejects.toBeInstanceOf(ForbiddenException);
      expect(lstatMock).not.toHaveBeenCalled();
      expect(mkdirMock).not.toHaveBeenCalled();
    });
  });
});
