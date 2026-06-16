vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
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
  const service = new PathService();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty for blocked system paths', async () => {
    await expect(service.listDirectories('/proc/1')).resolves.toEqual([]);
    await expect(service.listDirectories('/sys/class')).resolves.toEqual([]);

    expect(readdirMock).not.toHaveBeenCalled();
  });

  it('rejects symlinked root paths', async () => {
    lstatMock.mockResolvedValue({ isSymbolicLink: () => true, isDirectory: () => false } as never);

    await expect(service.listDirectories('/tmp/books')).resolves.toEqual([]);
  });

  it('lists only accessible real (non-symlink) directories and sorts them by name', async () => {
    lstatMock.mockImplementation((fullPath) => {
      if (String(fullPath) === '/tmp/books') {
        return Promise.resolve({ isSymbolicLink: () => false, isDirectory: () => true } as never);
      }
      if (String(fullPath).endsWith('/beta')) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      if (String(fullPath).endsWith('/alpha-link')) {
        return Promise.resolve({ isDirectory: () => true, isSymbolicLink: () => true } as never);
      }
      return Promise.resolve({ isDirectory: () => true, isSymbolicLink: () => false } as never);
    });

    readdirMock.mockResolvedValue([
      entry('notes.txt'),
      entry('.cache', { directory: true }),
      entry('zeta', { directory: true }),
      entry('alpha-link', { directory: true }),
      entry('beta', { directory: true }),
    ] as never);

    await expect(service.listDirectories('/tmp/books')).resolves.toEqual([{ name: 'zeta', path: '/tmp/books/zeta' }]);
  });

  it('excludes entries that appear as directories but are symlinks when lstat confirms it', async () => {
    lstatMock.mockImplementation((fullPath) => {
      if (String(fullPath) === '/tmp/books') {
        return Promise.resolve({ isSymbolicLink: () => false, isDirectory: () => true } as never);
      }
      if (String(fullPath).endsWith('/real-dir')) {
        return Promise.resolve({ isDirectory: () => true, isSymbolicLink: () => false } as never);
      }
      return Promise.resolve({ isDirectory: () => true, isSymbolicLink: () => true } as never);
    });

    readdirMock.mockResolvedValue([entry('real-dir', { directory: true }), entry('sym-dir', { directory: true })] as never);

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

    await expect(service.listDirectories('/does/not/exist')).resolves.toEqual([]);
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

    it('rejects a symlinked parent', async () => {
      lstatMock.mockResolvedValue({ isSymbolicLink: () => true, isDirectory: () => false } as never);

      await expect(service.createDirectory('/tmp/link', 'scifi')).rejects.toBeInstanceOf(ForbiddenException);
      expect(mkdirMock).not.toHaveBeenCalled();
    });

    it('rejects a parent that is not a directory', async () => {
      lstatMock.mockResolvedValue({ isSymbolicLink: () => false, isDirectory: () => false } as never);

      await expect(service.createDirectory('/tmp/file.txt', 'scifi')).rejects.toBeInstanceOf(BadRequestException);
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

      await expect(service.createDirectory('/tmp/gone', 'scifi')).rejects.toBeInstanceOf(BadRequestException);
      expect(mkdirMock).not.toHaveBeenCalled();
    });
  });
});
