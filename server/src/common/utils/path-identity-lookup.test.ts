vi.mock('fs/promises', () => ({ lstat: vi.fn(), readdir: vi.fn() }));

import { lstat, readdir } from 'fs/promises';

import { pathsReferToSameEntry, resolveExistingPathSpelling } from './path-identity.utils';

const mockLstat = vi.mocked(lstat);
const mockReaddir = vi.mocked(readdir);

function seedDirectories(entriesByPath: Record<string, string[]>): void {
  mockReaddir.mockImplementation((path) => {
    const entries = entriesByPath[String(path)];
    if (!entries) return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })) as never;
    return Promise.resolve(entries) as never;
  });
}

describe('resolveExistingPathSpelling', () => {
  beforeEach(() => {
    mockLstat.mockReset();
    mockReaddir.mockReset();
    mockLstat.mockResolvedValue({ dev: 1, ino: 42 } as never);
  });

  it('resolves a case-only difference to the spelling stored on disk', async () => {
    seedDirectories({
      '/library': ['bell hooks'],
      '/library/bell hooks': ['Dune.epub'],
    });

    await expect(resolveExistingPathSpelling('/library/Bell Hooks/Dune.epub', '/library')).resolves.toBe('/library/bell hooks/Dune.epub');
  });

  it('resolves a Unicode normalization difference to the spelling stored on disk', async () => {
    const storedName = 'José Saramago'.normalize('NFD');
    seedDirectories({
      '/library': [storedName],
      [`/library/${storedName}`]: ['Blindness.epub'],
    });

    await expect(resolveExistingPathSpelling('/library/José Saramago/Blindness.epub'.normalize('NFC'), '/library')).resolves.toBe(
      `/library/${storedName}/Blindness.epub`,
    );
  });

  it('never lists directories above the given base path', async () => {
    seedDirectories({
      '/library': ['bell hooks'],
      '/library/bell hooks': ['Dune.epub'],
    });

    await resolveExistingPathSpelling('/library/bell hooks/Dune.epub', '/library');

    expect(mockReaddir).not.toHaveBeenCalledWith('/');
    expect(mockReaddir).not.toHaveBeenCalledWith('/library', expect.anything());
    expect(mockReaddir.mock.calls.map((call) => call[0])).toEqual(['/library', '/library/bell hooks']);
  });

  it('walks up from the filesystem root when no base path is given', async () => {
    seedDirectories({
      '/': ['library'],
      '/library': ['bell hooks'],
      '/library/bell hooks': ['Dune.epub'],
    });

    await expect(resolveExistingPathSpelling('/library/Bell Hooks/Dune.epub')).resolves.toBe('/library/bell hooks/Dune.epub');
    expect(mockReaddir.mock.calls.map((call) => call[0])).toEqual(['/', '/library', '/library/bell hooks']);
  });

  it('prefers an exact match when both spellings exist', async () => {
    seedDirectories({
      '/library': ['bell hooks', 'Bell Hooks'],
      '/library/Bell Hooks': ['Dune.epub'],
    });

    await expect(resolveExistingPathSpelling('/library/Bell Hooks/Dune.epub', '/library')).resolves.toBe('/library/Bell Hooks/Dune.epub');
  });

  it('gives up when more than one entry matches case-insensitively', async () => {
    seedDirectories({ '/library': ['bell hooks', 'BELL HOOKS'] });

    await expect(resolveExistingPathSpelling('/library/Bell Hooks/Dune.epub', '/library')).resolves.toBeNull();
  });

  it('returns null for a path outside the base path', async () => {
    seedDirectories({ '/library': ['bell hooks'] });

    await expect(resolveExistingPathSpelling('/other/bell hooks/Dune.epub', '/library')).resolves.toBeNull();
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('returns null when the path does not exist', async () => {
    mockLstat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }) as never);
    seedDirectories({ '/library': ['bell hooks'] });

    await expect(resolveExistingPathSpelling('/library/bell hooks/Dune.epub', '/library')).resolves.toBeNull();
  });
});

describe('pathsReferToSameEntry', () => {
  beforeEach(() => {
    mockLstat.mockReset();
    mockReaddir.mockReset();
    mockLstat.mockResolvedValue({ dev: 1, ino: 42 } as never);
    seedDirectories({
      '/': ['library'],
      '/library': ['bell hooks'],
      '/library/bell hooks': ['Dune.epub'],
    });
  });

  it('treats identical paths as the same entry without touching the filesystem', async () => {
    await expect(pathsReferToSameEntry('/library/bell hooks/Dune.epub', '/library/bell hooks/Dune.epub')).resolves.toBe(true);
    expect(mockLstat).not.toHaveBeenCalled();
  });

  it('treats a case-only alias of the same inode as the same entry', async () => {
    await expect(pathsReferToSameEntry('/library/Bell Hooks/Dune.epub', '/library/bell hooks/Dune.epub')).resolves.toBe(true);
  });

  it('treats a normalization-only alias of the same inode as the same entry', async () => {
    const storedName = 'José Saramago'.normalize('NFD');
    seedDirectories({
      '/': ['library'],
      '/library': [storedName],
      [`/library/${storedName}`]: ['Blindness.epub'],
    });

    await expect(
      pathsReferToSameEntry(`/library/${storedName}/Blindness.epub`, '/library/José Saramago/Blindness.epub'.normalize('NFC')),
    ).resolves.toBe(true);
  });

  it('treats different inodes behind the same spelling fold as distinct entries', async () => {
    mockLstat.mockImplementation((path) =>
      Promise.resolve(String(path) === '/library/bell hooks/Dune.epub' ? { dev: 1, ino: 42 } : { dev: 1, ino: 43 }),
    );

    await expect(pathsReferToSameEntry('/library/Bell Hooks/Dune.epub', '/library/bell hooks/Dune.epub')).resolves.toBe(false);
  });

  it('does not compare paths that differ by more than case and normalization', async () => {
    await expect(pathsReferToSameEntry('/library/bell hooks/Dune.epub', '/library/bell hooks/Other.epub')).resolves.toBe(false);
    expect(mockLstat).not.toHaveBeenCalled();
  });
});
