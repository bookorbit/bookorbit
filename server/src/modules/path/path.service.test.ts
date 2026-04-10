vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

import { readdir, stat } from 'fs/promises';

import { PathService } from './path.service';

const readdirMock = vi.mocked(readdir);
const statMock = vi.mocked(stat);

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

  it('lists only accessible non-hidden directories and sorts them by name', async () => {
    readdirMock.mockResolvedValue([
      entry('notes.txt'),
      entry('.cache', { directory: true }),
      entry('zeta', { directory: true }),
      entry('alpha-link', { symbolicLink: true }),
      entry('beta', { directory: true }),
    ] as never);

    statMock.mockImplementation((fullPath) => {
      if (String(fullPath).endsWith('/beta')) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }

      return Promise.resolve({
        isDirectory: () => true,
      } as never);
    });

    await expect(service.listDirectories('/tmp/books')).resolves.toEqual([
      { name: 'alpha-link', path: '/tmp/books/alpha-link' },
      { name: 'zeta', path: '/tmp/books/zeta' },
    ]);
  });

  it('returns empty when reading the target directory fails', async () => {
    readdirMock.mockRejectedValue(new Error('missing'));

    await expect(service.listDirectories('/does/not/exist')).resolves.toEqual([]);
  });
});
