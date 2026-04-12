vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  lstat: vi.fn(),
}));

import { readdir, lstat } from 'fs/promises';

import { PathService } from './path.service';

const readdirMock = vi.mocked(readdir);
const lstatMock = vi.mocked(lstat);

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
});
